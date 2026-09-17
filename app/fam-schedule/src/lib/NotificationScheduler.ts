/**
 * NotificationScheduler — 本地通知排程(客户端) — T-SETUP-7
 *
 * 职责:
 *   - 配 Android channel + 装 notification handler + 注册 tap listener
 *   - 单独提供 `requestNotificationPermission()`,由 UI 层在合适时机触发
 *   - 排程单条任务提醒(scheduleTaskReminder)
 *   - 排程每日早/晚汇总(scheduleDigest)
 *   - 重排全部通知(rescheduleAll)— 任务或设置变化时调用
 *   - 取消单条提醒(cancelByTaskId)
 *   - 通知点击回调:解析 data.taskId → 通知 UI 层跳任务详情
 *
 * 启动两阶段拆分(T-FIX-03 — 修复首启 UX regression + iOS 审核敏感):
 *   - `init()`:eager 阶段,装 handler / 配 channel / 注册 tap listener / 处理 cold-start。
 *     **不申请权限**,可在 Gate 组件 mount 即调,无副作用。
 *   - `requestNotificationPermission()`:gated 阶段,**仅** `init()` 调 `requestPermissionsAsync` 的迁移出口。
 *     UI 层应在 `session && familyId` 都就绪时调用(用户已登录且加入/创建家庭),
 *     避免 splash 阶段突兀弹权限对话框。
 *
 * 设计依据:
 *   - ADR-006: v1 客户端本地调度,只对"指派给自己"的任务排通知;
 *     已知缺陷(后台被杀、不跨设备等)显式记录在 ADR-006 中。
 *   - ADR-007: 早/晚汇总时间从 family_settings 读(默认 08:00 / 20:00)。
 *
 * ⚠️ HIGH RISK 模块(任务 DoD 标红):
 *   1. Android 12+ Exact Alarm 权限(`SCHEDULE_EXACT_ALARM` 已声明在 manifest):
 *      用户需在"系统设置 → 应用 → 特殊访问 → 闹钟和提醒"手动授权;
 *      拒绝时 `SchedulableTriggerInputTypes.DATE` 触发器会被 OS 静默推迟(变成 inexact)。
 *      缓解:US-016 白名单引导卡片。
 *
 *   2. Android 13+ POST_NOTIFICATIONS 运行时权限:
 *      `init()` 调 `requestPermissionsAsync()` 申请;用户拒后所有排程"排上但不响",
 *      调用方需在 UI 上提示去设置开启。
 *
 *   3. Doze 模式 / Battery Optimization:
 *      设备进入 Doze 后已排程的通知可能延迟 15+ 分钟;
 *      Doze 退出后批量补响。Android 文档保证"不丢"但"不保证准时"。
 *
 *   4. 国产 ROM(Xiaomi/Huawei/Oppo/Vivo/OnePlus/...)后台管控:
 *      锁屏后几分钟到几小时不等,系统会按厂商策略杀进程 / 拦截 AlarmManager;
 *      本地排程可能完全失效。这是 v1 最大妥协,US-016 引导用户加白名单。
 *
 *   5. 用户从"最近任务"上滑 / 系统设置里"强制停止":
 *      AlarmManager 注册被清,已排程全部丢失;下次冷启动需重新排。
 *      解决路径:`rescheduleAll()` 应在每次冷启动 + 任务/设置变更后被调。
 *      本模块不主动调(依赖调用方在合适时机调,避免循环依赖)。
 *
 * 模块状态:
 *   - `initialized`:幂等保护(eager init)
 *   - `permissionRequested`:幂等保护(permission request)
 *   - `onTapHandler`:通知点击回调注册(setNotificationTapHandler 设置)
 *   - `_resetForTests`:jest 测试间重置(不暴露给业务)
 */

import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import type { Database } from '../types/database';

type Task = Database['public']['Tables']['tasks']['Row'];
type FamilySettings = Database['public']['Tables']['family_settings']['Row'];

// ---- ID encoding -----------------------------------------------------
//
// expo-notifications 要求 string identifier 唯一。
// 用 `<prefix>:<task_id>` 编码,让 cancelByTaskId / rescheduleAll 容易匹配。
const TASK_REMINDER_PREFIX = 'task-reminder:';
const DIGEST_MORNING = 'digest-morning';
const DIGEST_EVENING = 'digest-evening';

// 默认"无 task_time 时"的提醒时刻(9:00 AM)— PRD 未规定,选家庭日程常用值
const DEFAULT_REMINDER_HOUR = 9;
const DEFAULT_REMINDER_MINUTE = 0;

// ---- Tap callback registry ------------------------------------------

export type NotificationTapHandler = (taskId: string | null) => void;

let onTapHandler: NotificationTapHandler | null = null;

/**
 * 注册通知点击回调。
 * UI 层(后续 T-US002/T-US003)负责接收 taskId 后跳详情页。
 */
export function setNotificationTapHandler(handler: NotificationTapHandler): void {
  onTapHandler = handler;
}

// ============================================================
// 1. init() + requestNotificationPermission()
// ============================================================
//
// T-FIX-03:把"装系统"和"申请权限"解耦,避免 splash 阶段抢弹权限框。
//   - `init()` 是 eager 阶段,无副作用,可在 app 启动时立刻调;
//     负责装 handler / 配 Android channel / 注册 tap listener / 处理 cold-start。
//   - `requestNotificationPermission()` 是 gated 阶段,必须在
//     `session && familyId` 都就绪后才能调,否则用户会看到突兀的权限弹窗。
//
// 两阶段都用独立 idempotent flag 守护,各自保证只跑一次,顺序不敏感
// (requestNotificationPermission 在 init 之后/之前调均可,内部幂等)。

let initialized = false;
let permissionRequested = false;

/**
 * 初始化通知系统(eager 阶段,无权限申请):
 *   - 装 handler(决定应用在前台时通知是否显示)
 *   - 配 Android channel(task-reminders 高优先级 + digest 默认优先级)
 *   - 注册 tap listener(前台 + cold-start)
 *
 * **不申请权限** —— 由 `requestNotificationPermission()` 单独控制(T-FIX-03)。
 * 因此可在 Gate mount 即调,无副作用。
 *
 * 幂等:重复调用只跑一次。第二次起直接 return true,不重装任何东西。
 *
 * @returns true = 初始化完成(注意:**不**代表权限已 granted,权限状态
 *   应由 `requestNotificationPermission()` 返回值决定)。
 */
export async function init(): Promise<boolean> {
  if (initialized) return true;
  initialized = true;

  // Set handler — 决定应用在前台时通知如何呈现
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  // Android: 配 channel
  if (Platform.OS === 'android') {
    // task-reminders: 高优先级,heads-up + 振动 + 赤陶 LED(品牌色)
    await Notifications.setNotificationChannelAsync('task-reminders', {
      name: '任务提醒',
      description: '到点任务提醒',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#DC5A24', // 赤陶,DD-002 色板
      sound: 'default',
      enableVibrate: true,
      showBadge: false,
    });
    // digest: 默认优先级(早/晚汇总是低紧迫度信息)
    await Notifications.setNotificationChannelAsync('digest', {
      name: '家庭汇总',
      description: '每日早 / 晚任务汇总',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250],
      sound: 'default',
      enableVibrate: true,
      showBadge: false,
    });
  }

  // Tap listener(前台 / 后台已运行)
  Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as
      | { taskId?: string }
      | undefined;
    const taskId = data?.taskId ?? null;
    onTapHandler?.(taskId);
  });

  // Cold-start: 应用因通知被启动时,getLastNotificationResponseAsync 仍能拿到
  const initial = await Notifications.getLastNotificationResponseAsync();
  if (initial) {
    const data = initial.notification.request.content.data as
      | { taskId?: string }
      | undefined;
    onTapHandler?.(data?.taskId ?? null);
  }

  return true;
}

/**
 * 申请通知权限(gated 阶段,T-FIX-03):
 *   - iOS:弹原生 alert dialog(iOS 唯一申请入口)
 *   - Android 13+:弹运行时 POST_NOTIFICATIONS 对话框
 *   - Android < 13:channel 已在 `init()` 注册,无需运行时权限,直接返回 granted
 *
 * **调用约束**:必须在用户已登录且加入/创建家庭(`session && familyId`)
 * 之后调用,避免 splash 阶段突兀弹框(首启 UX regression + iOS 审核敏感)。
 * 当前在 `app/_layout.tsx` Gate 内 `session && familyId` 双条件 useEffect 触发。
 *
 * 幂等:模块级 `permissionRequested` flag 守护,只弹一次。
 * 用户拒后再调不会重弹(OS 限制 —— 重弹需引导用户去系统设置)。
 *
 * @returns true = 权限 granted,可继续排程;false = 权限被拒或 OS 拒绝。
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (permissionRequested) return true;
  permissionRequested = true;

  // iOS + Android 13+:走原生权限申请
  // Android < 13:channel 已在 init() 注册,requestPermissionsAsync 在这种 OS 上
  // 通常直接返回 granted,这里统一兜底
  const { status } = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
    android: {},
  });
  if (status !== 'granted') {
    // eslint-disable-next-line no-console
    console.warn('[NotificationScheduler] permission not granted:', status);
    return false;
  }
  return true;
}

// ============================================================
// 2. scheduleTaskReminder(task)
// ============================================================

/**
 * 给单条任务排到点提醒。
 *
 * 返回:
 *   - 排程 identifier(`task-reminder:<task_id>`)— 用于后续取消
 *   - null:任务已完成 / 提醒时间已过 / init 失败 — 不排程
 *
 * ⚠️ 契约:已完成的任务不会自动取消已存在的 reminder。
 *   调用方(checkin 流程)需显式调 `cancelByTaskId(task.id)`。
 *   理由:scheduleNotificationAsync 同 ID 替换语义在早返回时不会触发,
 *   早返回路径不 cancel 以避免误删未来时刻。
 */
export async function scheduleTaskReminder(task: Task): Promise<string | null> {
  if (task.completed_at) return null;

  const triggerDate = computeTaskReminderDate(task);
  if (triggerDate.getTime() <= Date.now()) return null;

  const id = `${TASK_REMINDER_PREFIX}${task.id}`;
  const trigger: Notifications.DateTriggerInput = {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date: triggerDate,
    channelId: 'task-reminders', // Android only — iOS 忽略
  };

  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: {
      title: task.title,
      body: task.description ?? '该打卡了',
      data: { taskId: task.id, route: 'task-detail' },
      sound: 'default',
    },
    trigger,
  });
  return id;
}

/**
 * 把 task.task_date(Y-M-D)+ task.task_time(HH:MM:SS)合并成 Date 对象。
 * 若 task_time 为 null,fallback 到 DEFAULT_REMINDER_HOUR:DEFAULT_REMINDER_MINUTE。
 *
 * 解析采用本地时区 — 因为早/晚汇总和到点提醒都是"用户感受"的本地时间。
 * 时区变化感知不在 v1 范围内(ADR-006-Q1 open question)。
 */
function computeTaskReminderDate(task: Task): Date {
  const date = new Date(task.task_date);
  if (task.task_time) {
    const parts = task.task_time.split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (!Number.isNaN(h) && !Number.isNaN(m)) {
      date.setHours(h, m, 0, 0);
      return date;
    }
  }
  date.setHours(DEFAULT_REMINDER_HOUR, DEFAULT_REMINDER_MINUTE, 0, 0);
  return date;
}

/**
 * 解析 "HH:MM" 或 "HH:MM:SS" 字符串为 [hour, minute]。
 * 失败回退到 [9, 0](防御性)。
 */
function parseHHMM(s: string): [number, number] {
  const parts = s.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return [DEFAULT_REMINDER_HOUR, DEFAULT_REMINDER_MINUTE];
  return [h, m];
}

// ============================================================
// 3. scheduleDigest(morningTime, eveningTime)
// ============================================================

/**
 * 排每日早/晚汇总。会自动取消旧的同名 digest(防止时间改了后旧版仍响)。
 *
 * @param morningTime "HH:MM" 或 "HH:MM:SS"(DB family_settings 列是 TIME)
 * @param eveningTime 同上
 */
export async function scheduleDigest(
  morningTime: string,
  eveningTime: string,
): Promise<void> {
  // 先取消旧的 digest(防时间改了后旧版还在响)
  await Notifications.cancelScheduledNotificationAsync(DIGEST_MORNING).catch(() => undefined);
  await Notifications.cancelScheduledNotificationAsync(DIGEST_EVENING).catch(() => undefined);

  const [morningH, morningM] = parseHHMM(morningTime);
  const [eveningH, eveningM] = parseHHMM(eveningTime);

  await Notifications.scheduleNotificationAsync({
    identifier: DIGEST_MORNING,
    content: {
      title: '早安 ☀️',
      body: '今天的任务已经准备好啦',
      data: { kind: 'digest-morning' },
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: morningH,
      minute: morningM,
      channelId: 'digest',
    },
  });

  await Notifications.scheduleNotificationAsync({
    identifier: DIGEST_EVENING,
    content: {
      title: '晚上好 🌙',
      body: '看看今天还有没有漏掉的任务',
      data: { kind: 'digest-evening' },
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: eveningH,
      minute: eveningM,
      channelId: 'digest',
    },
  });
}

// ============================================================
// 4. cancelByTaskId(taskId)
// ============================================================

/**
 * 取消某任务的所有提醒(目前每任务最多 1 条 reminder,后续若加提前 X 分钟提醒需扩展)。
 * 静默吞 cancel 异常(任务可能从未排过 / 已过期被系统清理)。
 */
export async function cancelByTaskId(taskId: string): Promise<void> {
  const id = `${TASK_REMINDER_PREFIX}${taskId}`;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
}

// ============================================================
// 5. rescheduleAll(tasks, settings)
// ============================================================

/**
 * 重排所有通知。
 *
 * 调用时机:
 *   - 冷启动后,SyncManager 已拉完任务 + 设置(后续任务接入)
 *   - 任务增/删/改后
 *   - 设置变更后(早/晚时间变化)
 *
 * 流程:
 *   1. 取消当前所有 `task-reminder:` 前缀的已排程(其他 ID 不动)
 *   2. 重新排每条未来 + 未完成的任务
 *   3. 排 digest
 *
 * @returns { taskReminders, digests } 实际成功排程数量,供调用方做 UI 提示
 */
export async function rescheduleAll(
  tasks: Task[],
  settings: FamilySettings,
): Promise<{ taskReminders: number; digests: number }> {
  // 取消旧的 task-reminder(digest / 其他 ID 不动)
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const taskReminderIds = scheduled
    .filter((n) => n.identifier.startsWith(TASK_REMINDER_PREFIX))
    .map((n) => n.identifier);
  await Promise.all(
    taskReminderIds.map((id) =>
      Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined),
    ),
  );

  // 重排 task reminder
  let taskReminders = 0;
  for (const task of tasks) {
    const id = await scheduleTaskReminder(task);
    if (id) taskReminders++;
  }

  // 排 digest
  await scheduleDigest(settings.morning_digest_time, settings.evening_digest_time);

  return { taskReminders, digests: 2 };
}

// ============================================================
// Debug helpers
// ============================================================

/**
 * 测试间重置模块级状态(singleton `initialized` + `permissionRequested` flag + tap handler)。
 * 业务代码不要调。
 */
export async function _resetForTests(): Promise<void> {
  initialized = false;
  permissionRequested = false;
  onTapHandler = null;
}

/**
 * 列出当前所有已排程通知 — 供调试菜单 / 设置页 UI 显示用。
 */
export async function listScheduled(): Promise<Notifications.NotificationRequest[]> {
  return Notifications.getAllScheduledNotificationsAsync();
}

/**
 * 取消全部已排程通知 — 仅供测试 / 调试菜单。
 * 下划线前缀是约定,业务侧不应调。
 */
export async function _cancelAllForTests(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

// ============================================================
// React hook — 启动时自动 init(仅装系统,不弹权限框)
// ============================================================
//
// T-FIX-03:`useNotificationSchedulerInit()` 现在**只**触发 eager 阶段的
// `init()`(handler / channel / listener / cold-start)。权限申请从本 hook 中
// 解耦,改由 `_layout.tsx` Gate 在 `session && familyId` 双条件 useEffect 中
// 显式调 `requestNotificationPermission()`。
//
// 注意:`useNotificationSchedulerInit()` 与 `init()` 是同一层语义 ——
// 调用方只是利用了 useEffect 生命周期。如果未来要更细粒度控制时机
// (比如只在真路由 mount 时 init),可以直接调 `init()`,不用走 hook。

/**
 * 把 eager 阶段的 init 集成到 React 生命周期。
 * 使用:在 `_layout.tsx` 的 Gate(或任何顶层组件)调一次。
 *
 * 副作用:失败仅 warn,不抛。**不会**弹权限框(权限申请已迁出)。
 */
export function useNotificationSchedulerInit(): void {
  useEffect(() => {
    init().catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[NotificationScheduler] init failed:', e);
    });
  }, []);
}