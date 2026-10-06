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
 * T-FIX-BUNDLE-4:Expo Go SDK 53+ 移除了 expo-notifications 的 module load。
 *   旧 static `import * as Notifications from 'expo-notifications'` 在 module load 时
 *   直接 throw(不论函数是否调用),Expo Go 用户即使跳过函数调用也报错。
 *   改 lazy require + try/catch + isExpoGo guard:Expo Go 不触发 module load,
 *   函数层 no-op 让 app 正常运行(只是不响通知)。dev build / production / standalone
 *   走真 require,功能完全保留。
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
 *   - `tapListenerSub`:init() 注册的 tap listener 句柄,可被 `_cleanupTapListener()` 清理
 *     (T-FIX-06-A M04 — 防 dev hot-reload / 测试间 sub 引用泄漏)
 *   - `_resetForTests`:jest 测试间重置(不暴露给业务,内部调 `_cleanupTapListener()`)
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { EventSubscription } from 'expo-modules-core';

import type { Database } from '../types/database';

type Task = Database['public']['Tables']['tasks']['Row'];
type FamilySettings = Database['public']['Tables']['family_settings']['Row'];

// ---- T-FIX-BUNDLE-4:Expo Go guard + lazy require --------------------------
//
// Expo Go SDK 53+ 移除了 expo-notifications(在 module load 时直接抛错)。
// 旧 static `import * as Notifications from 'expo-notifications'` 在模块加载阶段
// 就 throw,无论后续函数是否调用 —— 所以仅靠 `_layout.tsx` 用 `isExpoGo` 跳过函数
// 调用是不够的,只要 import 这行存在,Expo Go 启动就会崩。
//
// 修复策略:
//   1. `expo-constants` 用 lazy require + try/catch(原任务 spec 写 `import Constants`,
//      但 jest-expo 不自动 mock expo-constants,真实模块在 jest 环境 throw,
//      故也改成 lazy require —— expo-constants 在 Expo Go / dev build / production
//      都能正常 load,只在测试环境 fall-through)。
//   2. `isExpoGo = Constants.executionEnvironment === 'storeClient'`:
//      - Expo Go:true → 完全跳过 `require('expo-notifications')`
//      - 其他环境:false → 进入 try/catch require
//   3. try/catch 兜底:非 Expo Go 但 require 也可能 throw(dev build 没装 native module),
//      保证 app 不崩,`_Notifications` 保持 null,函数层 no-op。
//   4. 函数层每个 export 函数入口 check `_Notifications` 非 null 才执行,
//      否则 no-op 让 app 正常运行(只是不响通知)。
//
// dev build / production / standalone:expo-notifications 正常工作。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _Constants: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('expo-constants');
  // expo-constants 既支持 default export 也支持 namespace export
  _Constants = (mod && (mod.default ?? mod)) || null;
} catch {
  // expo-constants 不可用(罕见 — 当前仅 jest 测试环境会触发)→ 视为非 Expo Go
  _Constants = null;
}

const isExpoGo = _Constants?.executionEnvironment === 'storeClient';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _Notifications: any = null;
if (!isExpoGo) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _Notifications = require('expo-notifications');
  } catch (e) {
    // eslint-disable-next-line no-console
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[NotificationScheduler] expo-notifications unavailable:', msg);
  }
}

// ---- ID encoding -----------------------------------------------------
//
// expo-notifications 要求 string identifier 唯一。
// 用 `<prefix>:<task_id>` 编码,让 cancelByTaskId / rescheduleAll 容易匹配。
const TASK_REMINDER_PREFIX = 'task-reminder:';
const DIGEST_MORNING = 'digest-morning';
const DIGEST_EVENING = 'digest-evening';

// 默认"无 task_time 时"的提醒时刻(9:00 AM)— PRD 未规定,选家庭日程常用值。
// 模块-scope 常量(export 给 parseHHMM 兜底 + computeTaskReminderDate fallback):
//   - DEFAULT_REMINDER_HOUR = 9   — 9 AM,家庭常用值(早餐 / 出门前 / 上午待办提醒窗口)
//   - DEFAULT_REMINDER_MINUTE = 0 — 整点
// 改名 / 改值会同时影响 3 处派生(parseHHMM fallback + computeTaskReminderDate fallback +
// scheduleDigest 非法时间兜底),所以集中定义 + 注释清楚。
const DEFAULT_REMINDER_HOUR = 9;
const DEFAULT_REMINDER_MINUTE = 0;

// ---- Tap callback registry ------------------------------------------

export type NotificationTapHandler = (taskId: string | null) => void;

let onTapHandler: NotificationTapHandler | null = null;

// Tap listener subscription 句柄 — 持有 addNotificationResponseReceivedListener 的返回值,
// 便于:
//   1. dev hot-reload 时旧 module 已 unload,旧 sub 还活着 → 内存泄漏 + 多次回调
//   2. 测试间清理(tapListenerSub?.remove() 后 sub 不再触发回调)
//   3. `_resetForTests()` 兜底清理,避免测试间污染
// 类型用 `any`(lazy require 后无法静态引用 expo-modules-core NotificationSubscription,
// 见 T-FIX-BUNDLE-4 注释)— runtime check 守住语义契约。
/* eslint-disable @typescript-eslint/no-explicit-any */
let tapListenerSub: any = null;
/* eslint-enable @typescript-eslint/no-explicit-any */

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
 * T-FIX-BUNDLE-4:Expo Go / require failed → no-op,返回 true(幂等 flag 守住,不再重试)。
 *
 * @returns true = 初始化完成(注意:**不**代表权限已 granted,权限状态
 *   应由 `requestNotificationPermission()` 返回值决定)。
 */
export async function init(): Promise<boolean> {
  if (initialized) return true;
  initialized = true;
  // T-FIX-BUNDLE-4:Expo Go / require failed → no-op
  if (isExpoGo) return true;
  if (!_Notifications) return true;

  // Set handler — 决定应用在前台时通知如何呈现
  _Notifications.setNotificationHandler({
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
    await _Notifications.setNotificationChannelAsync('task-reminders', {
      name: '任务提醒',
      description: '到点任务提醒',
      importance: _Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#DC5A24', // 赤陶,DD-002 色板
      sound: 'default',
      enableVibrate: true,
      showBadge: false,
    });
    // digest: 默认优先级(早/晚汇总是低紧迫度信息)
    await _Notifications.setNotificationChannelAsync('digest', {
      name: '家庭汇总',
      description: '每日早 / 晚任务汇总',
      importance: _Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250],
      sound: 'default',
      enableVibrate: true,
      showBadge: false,
    });
  }

  // Tap listener(前台 / 后台已运行)
  // T-FIX-06-A M04:保存 listener 返回的 subscription 句柄到 module-scope,
  // 便于 `_cleanupTapListener()` / `_resetForTests()` / dev hot-reload 时清理,
  // 避免内存泄漏 + 多实例重叠回调。
  tapListenerSub = _Notifications.addNotificationResponseReceivedListener((response: {
    notification: {
      request: { content: { data: unknown } };
    };
  }) => {
    const data = response.notification.request.content.data as
      | { taskId?: string }
      | undefined;
    const taskId = data?.taskId ?? null;
    onTapHandler?.(taskId);
  });

  // Cold-start: 应用因通知被启动时,getLastNotificationResponseAsync 仍能拿到
  const initial = await _Notifications.getLastNotificationResponseAsync();
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
 * T-FIX-BUNDLE-4:Expo Go 上 no-op,返回 true(幂等 flag 守住,不重复进入 gated 路径)。
 * `_layout.tsx` 已经提前用 isExpoGo 跳过调用,这里是防御性兜底。
 *
 * @returns true = 权限 granted,可继续排程;false = 权限被拒或 OS 拒绝。
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (permissionRequested) return true;
  permissionRequested = true;
  // T-FIX-BUNDLE-4:Expo Go / require failed → no-op
  if (isExpoGo) return true;
  if (!_Notifications) return true;

  // iOS + Android 13+:走原生权限申请
  // Android < 13:channel 已在 init() 注册,requestPermissionsAsync 在这种 OS 上
  // 通常直接返回 granted,这里统一兜底
  const { status } = await _Notifications.requestPermissionsAsync({
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
 *   - null:任务已完成 / 提醒时间已过 / Expo Go / require 失败 — 不排程
 *
 * ⚠️ 契约:已完成的任务不会自动取消已存在的 reminder。
 *   调用方(checkin 流程)需显式调 `cancelByTaskId(task.id)`。
 *   理由:scheduleNotificationAsync 同 ID 替换语义在早返回时不会触发,
 *   早返回路径不 cancel 以避免误删未来时刻。
 */
export async function scheduleTaskReminder(task: Task): Promise<string | null> {
  // T-FIX-BUNDLE-4:Expo Go / require failed → no-op
  if (isExpoGo) return null;
  if (!_Notifications) return null;

  if (task.completed_at) return null;

  const triggerDate = computeTaskReminderDate(task);
  if (triggerDate.getTime() <= Date.now()) return null;

  const id = `${TASK_REMINDER_PREFIX}${task.id}`;
  // T-FIX-BUNDLE-4:原 `Notifications.DateTriggerInput` 类型用 any 替代(runtime check 守住类型契约)
  const trigger: any = {
    type: _Notifications.SchedulableTriggerInputTypes.DATE,
    date: triggerDate,
    channelId: 'task-reminders', // Android only — iOS 忽略
  };

  await _Notifications.scheduleNotificationAsync({
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
 * 解析 "HH:MM" 或 "HH:MM:SS" 字符串为 [hour, minute] 元组。
 *
 * 输入约定(与 DB family_settings 的 TIME 列 / DB task_time 列对齐):
 *   - "HH:MM"     — 24h 小时 + 分钟("08:00" / "20:30")
 *   - "HH:MM:SS"  — 同上,带秒("08:00:00" / "20:30:45")— 秒段被忽略(只用 h:m)
 *
 * 解析失败回退(防御性):
 *   - 任一段非数字(`NaN`)→ 返回 `[DEFAULT_REMINDER_HOUR, DEFAULT_REMINDER_MINUTE]`
 *     即 `[9, 0]`(模块顶部常量,见上)。这是因为 scheduleDigest 拿到非法时间字符串
 *     时不能让 RN SchedulableTrigger DAILY 报错(OS 期望合法 0-23 / 0-59),
 *     兜底用家庭常用提醒时刻 9:00 AM。
 *
 * 边界:
 *   - 越界值(h > 23 / m > 59)**不**做 normalize — 交给 OS 排程时报错,触发
 *     rescheduleAll 的 warn 日志;不在客户端静默 mutate(避免掩盖 schema bug)。
 *   - 空字符串 → split 长度 < 2 → parseInt NaN → 走 fallback。
 *
 * @param s — "HH:MM[:SS]" 形态的本地时间字符串
 * @returns `[hour, minute]` 整型元组(0-23 / 0-59)
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
  // T-FIX-BUNDLE-4:Expo Go / require failed → no-op
  if (isExpoGo) return;
  if (!_Notifications) return;

  // 先取消旧的 digest(防时间改了后旧版还在响)
  await _Notifications.cancelScheduledNotificationAsync(DIGEST_MORNING).catch(() => undefined);
  await _Notifications.cancelScheduledNotificationAsync(DIGEST_EVENING).catch(() => undefined);

  const [morningH, morningM] = parseHHMM(morningTime);
  const [eveningH, eveningM] = parseHHMM(eveningTime);

  await _Notifications.scheduleNotificationAsync({
    identifier: DIGEST_MORNING,
    content: {
      title: '早安 ☀️',
      body: '今天的任务已经准备好啦',
      data: { kind: 'digest-morning' },
      sound: 'default',
    },
    trigger: {
      type: _Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: morningH,
      minute: morningM,
      channelId: 'digest',
    },
  });

  await _Notifications.scheduleNotificationAsync({
    identifier: DIGEST_EVENING,
    content: {
      title: '晚上好 🌙',
      body: '看看今天还有没有漏掉的任务',
      data: { kind: 'digest-evening' },
      sound: 'default',
    },
    trigger: {
      type: _Notifications.SchedulableTriggerInputTypes.DAILY,
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
  // T-FIX-BUNDLE-4:Expo Go / require failed → no-op
  if (isExpoGo) return;
  if (!_Notifications) return;

  const id = `${TASK_REMINDER_PREFIX}${taskId}`;
  await _Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
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
  // T-FIX-BUNDLE-4:Expo Go / require failed → no-op
  if (isExpoGo) return { taskReminders: 0, digests: 0 };
  if (!_Notifications) return { taskReminders: 0, digests: 0 };

  // 取消旧的 task-reminder(digest / 其他 ID 不动)
  const scheduled = await _Notifications.getAllScheduledNotificationsAsync();
  const taskReminderIds = scheduled
    .filter((n: { identifier: string }) => n.identifier.startsWith(TASK_REMINDER_PREFIX))
    .map((n: { identifier: string }) => n.identifier);
  await Promise.all(
    taskReminderIds.map((id: string) =>
      _Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined),
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
  // T-FIX-06-A M04:清理上一轮 init 注册的 tap listener subscription,避免测试间
  // listener 引用累积 + mockRemove 调用计数污染。
  // 兜底:即使 tapListenerSub 是 null 也安全(见 _cleanupTapListener)。
  await _cleanupTapListener();
}

/**
 * 清理当前已注册的 tap listener subscription(如有)。
 *
 * 调用场景:
 *   - 测试间重置(`_resetForTests()` 自动调)— 兜底,确保下一个 test case 干净
 *   - dev hot-reload 收尾(若 module load 但 init() 已跑过,旧 sub 还活着)
 *   - 业务侧切换 family / 切换用户的极端情况(留扩展点,当前不强制调)
 *
 * 安全语义:即使没注册过(tapListenerSub === null)也 no-op,不抛。
 * 幂等:连续调两次,第二次仍是 no-op。
 *
 * T-FIX-BUNDLE-4:Expo Go / require failed → `_Notifications` 是 null,init() 早早 return,
 * tapListenerSub 仍是初始 null,本函数 no-op,行为正确。
 */
export async function _cleanupTapListener(): Promise<void> {
  if (tapListenerSub) {
    tapListenerSub.remove();
    tapListenerSub = null;
  }
}

/**
 * 列出当前所有已排程通知 — 供调试菜单 / 设置页 UI 显示用。
 *
 * T-FIX-BUNDLE-4:Expo Go / require failed → 返回空数组(类型用 any[] 替代原
 * Notifications.NotificationRequest[],因为 lazy require 后无法静态引用 expo 类型)。
 */
export async function listScheduled(): Promise<any[]> {
  if (isExpoGo) return [];
  if (!_Notifications) return [];
  return _Notifications.getAllScheduledNotificationsAsync();
}

/**
 * 取消全部已排程通知 — 仅供测试 / 调试菜单。
 * 下划线前缀是约定,业务侧不应调。
 */
export async function _cancelAllForTests(): Promise<void> {
  if (isExpoGo) return;
  if (!_Notifications) return;
  await _Notifications.cancelAllScheduledNotificationsAsync();
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
//
// T-FIX-BUNDLE-4:Expo Go 上 init() 直接 no-op return true,本 hook 不变。

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
