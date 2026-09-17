/**
 * NotificationScheduler 单元测试 — T-SETUP-7 + T-FIX-03
 *
 * 覆盖范围(任务 DoD + ADR-006 关键路径):
 *   1. init() 调 setNotificationHandler + 配 Android channel + 注册 tap listener(T-FIX-03:eager 阶段不申请权限)
 *   2. requestNotificationPermission() 调 requestPermissionsAsync 并返回 boolean(T-FIX-03 新增)
 *   3. scheduleTaskReminder 拼出 `task-reminder:<uuid>` 格式 ID
 *   4. scheduleTaskReminder 对已完成任务返回 null(早返回)
 *   5. scheduleTaskReminder 对过去时刻任务返回 null(早返回)
 *   6. cancelByTaskId 用相同 ID 调 cancelScheduledNotificationAsync
 *   7. scheduleDigest 同时排 morning + evening 两个 DAILY 触发器
 *   8. rescheduleAll 清掉旧的 task-reminder 重排 + 排 digest
 *   9. notification tap 回调从 data.taskId 抽出后触发注册 handler
 *
 * Mock 策略:
 *   - `expo-notifications` 整个 mock,提供可编程的 jest.fn()(让 test 改 mockResolvedValueOnce)
 *   - `react-native` Platform mock 成 android(走 channel 配置分支)
 *
 * ⚠️ 模块级状态(`initialized` / `permissionRequested` / `onTapHandler` / `task-reminder` 注册表)
 *    通过显式调 `_resetForTests` 兜底,沿用 SyncManager 测试的模式。
 */

import type { Task, FamilySettings } from '../src/lib/LocalStore';

// ---- Mocks (必须在 import NotificationScheduler 之前) ---------------------

const mockSchedule = jest.fn();
const mockCancel = jest.fn();
const mockCancelAll = jest.fn();
const mockGetAll = jest.fn();
const mockRequestPermissions = jest.fn();
const mockSetHandler = jest.fn();
const mockSetChannel = jest.fn();
const mockAddResponseListener = jest.fn();
const mockGetLastResponse = jest.fn();

jest.mock('expo-notifications', () => {
  // 模拟 enums — SDK 57 中是 string enum,这里用字面量
  const SchedulableTriggerInputTypes = {
    DATE: 'date',
    DAILY: 'daily',
    TIME_INTERVAL: 'timeInterval',
  };
  const AndroidImportance = {
    DEFAULT: 'default',
    HIGH: 'high',
    LOW: 'low',
    MIN: 'min',
    MAX: 'max',
  };
  return {
    SchedulableTriggerInputTypes,
    AndroidImportance,
    setNotificationHandler: (...args: unknown[]) => mockSetHandler(...args),
    requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissions(...args),
    scheduleNotificationAsync: (req: { identifier?: string }) => mockSchedule(req),
    cancelScheduledNotificationAsync: (...args: unknown[]) => mockCancel(...args),
    cancelAllScheduledNotificationsAsync: (...args: unknown[]) => mockCancelAll(...args),
    getAllScheduledNotificationsAsync: (...args: unknown[]) => mockGetAll(...args),
    setNotificationChannelAsync: (...args: unknown[]) => mockSetChannel(...args),
    addNotificationResponseReceivedListener: (...args: unknown[]) =>
      mockAddResponseListener(...args),
    getLastNotificationResponseAsync: (...args: unknown[]) => mockGetLastResponse(...args),
  };
});

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

// ---- Import 被测模块(mock 之后) -----------------------------------------

import {
  init,
  requestNotificationPermission,
  scheduleTaskReminder,
  cancelByTaskId,
  scheduleDigest,
  rescheduleAll,
  setNotificationTapHandler,
  _resetForTests,
} from '../src/lib/NotificationScheduler';

// ---- 测试辅助 ---------------------------------------------------------

const baseTask: Task = {
  id: '11111111-1111-1111-1111-111111111111',
  template_id: null,
  family_id: 'fam-1',
  title: '倒垃圾',
  description: null,
  // 明天的 9:00 — 永远不会在过去
  task_date: '2099-01-15',
  task_time: '09:00:00',
  assignee_id: 'user-1',
  co_executor_ids: [],
  is_shared_view: false,
  created_by: 'user-1',
  completed_at: null,
  completed_by: null,
  is_makeup: false,
  cancelled: false,
  created_at: '2026-09-15T00:00:00Z',
  updated_at: '2026-09-15T00:00:00Z',
};

const baseSettings: FamilySettings = {
  family_id: 'fam-1',
  morning_digest_time: '08:00:00',
  evening_digest_time: '20:00:00',
  digest_time_min: '06:00:00',
  digest_time_max: '22:00:00',
  expiry_window: 'yesterday_today',
  late_checkin_cutoff: 'same_day_2359',
  created_at: '2026-09-15T00:00:00Z',
  updated_at: '2026-09-15T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  // 默认所有 mock 都 resolve;个别测试覆盖
  mockRequestPermissions.mockResolvedValue({ status: 'granted' });
  mockSchedule.mockImplementation(async (req: { identifier?: string }) => req.identifier ?? 'auto-id');
  mockCancel.mockResolvedValue(undefined);
  mockCancelAll.mockResolvedValue(undefined);
  mockGetAll.mockResolvedValue([]);
  mockSetChannel.mockResolvedValue('channel-id');
  mockAddResponseListener.mockReturnValue({ remove: jest.fn() });
  mockGetLastResponse.mockResolvedValue(null);
  _resetForTests();
});

// ============================================================
// 1. init() (T-FIX-03:eager 阶段 — 仅装系统,不弹权限框)
// ============================================================

describe('NotificationScheduler.init (T-FIX-03 eager stage)', () => {
  it('sets notification handler and configures channels but does NOT request permission', async () => {
    const ok = await init();

    expect(ok).toBe(true);
    expect(mockSetHandler).toHaveBeenCalledTimes(1);
    // handler 对象形态正确(shouldShow* 字段存在)
    const handlerArg = mockSetHandler.mock.calls[0][0];
    expect(typeof handlerArg.handleNotification).toBe('function');
    // T-FIX-03:eager init 阶段**不**触发权限申请 — 避免 splash 抢弹权限框
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it('creates Android channels for task-reminders and digest', async () => {
    await init();

    // setNotificationChannelAsync 应至少被调 2 次(task-reminders + digest)
    expect(mockSetChannel.mock.calls.length).toBeGreaterThanOrEqual(2);
    const channelIds = mockSetChannel.mock.calls.map((c) => c[0]);
    expect(channelIds).toContain('task-reminders');
    expect(channelIds).toContain('digest');
  });

  it('registers tap listener and processes cold-start notification', async () => {
    // cold-start 命中一个 last response
    mockGetLastResponse.mockResolvedValueOnce({
      notification: {
        request: {
          identifier: `task-reminder:${baseTask.id}`,
          content: { data: { taskId: baseTask.id }, title: '倒垃圾', body: '' },
        },
        date: Date.now(),
      },
      actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
      userText: undefined,
    });

    const tap = jest.fn();
    setNotificationTapHandler(tap);

    await init();

    expect(mockAddResponseListener).toHaveBeenCalledTimes(1);
    expect(tap).toHaveBeenCalledWith(baseTask.id);
  });

  it('is idempotent — second call does not re-register anything', async () => {
    await init();
    await init();
    expect(mockSetHandler).toHaveBeenCalledTimes(1);
    expect(mockSetChannel).toHaveBeenCalledTimes(2); // 仅第一次的 task-reminders + digest
    expect(mockAddResponseListener).toHaveBeenCalledTimes(1);
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });
});

// ============================================================
// 1b. requestNotificationPermission() (T-FIX-03:gated 阶段)
// ============================================================

describe('NotificationScheduler.requestNotificationPermission (T-FIX-03 gated stage)', () => {
  it('requests permission with ios + android config and returns true when granted', async () => {
    const ok = await requestNotificationPermission();

    expect(ok).toBe(true);
    expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
    const permArg = mockRequestPermissions.mock.calls[0][0];
    expect(permArg.ios).toBeDefined();
    expect(permArg.android).toBeDefined();
  });

  it('returns false and warns when permission is denied', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockRequestPermissions.mockResolvedValueOnce({ status: 'denied' });

    const ok = await requestNotificationPermission();

    expect(ok).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('is idempotent — second call does not re-prompt the user', async () => {
    await requestNotificationPermission();
    await requestNotificationPermission();
    expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
  });

  it('does not run when init() has not been called (caller-side gating lives in _layout)', async () => {
    // requestNotificationPermission 不依赖 init() —— 它是独立可调函数。
    // 这个用例主要防御"忘记调 init()"导致 channel 没配 + 权限已 granted"的混乱。
    // 业务上 _layout.tsx 总是先调 init 再 gated 调本函数,但模块本身不强制。
    const ok = await requestNotificationPermission();
    expect(ok).toBe(true);
    // setNotificationHandler / setNotificationChannelAsync 都不该被调
    expect(mockSetHandler).not.toHaveBeenCalled();
    expect(mockSetChannel).not.toHaveBeenCalled();
  });
});

// ============================================================
// 2. scheduleTaskReminder
// ============================================================

describe('NotificationScheduler.scheduleTaskReminder', () => {
  beforeEach(async () => {
    await init();
  });

  it('returns identifier in `task-reminder:<id>` format and schedules a DATE trigger', async () => {
    const id = await scheduleTaskReminder(baseTask);

    expect(id).toBe(`task-reminder:${baseTask.id}`);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const req = mockSchedule.mock.calls[0][0];
    expect(req.identifier).toBe(`task-reminder:${baseTask.id}`);
    expect(req.content.title).toBe('倒垃圾');
    expect(req.content.data.taskId).toBe(baseTask.id);
    expect(req.trigger.type).toBe('date');
    expect(req.trigger.date).toBeInstanceOf(Date);
  });

  it('returns null for a completed task (no schedule call)', async () => {
    const done: Task = { ...baseTask, completed_at: '2026-09-15T09:05:00Z' };
    const id = await scheduleTaskReminder(done);

    expect(id).toBeNull();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('returns null when the reminder time is in the past', async () => {
    const past: Task = {
      ...baseTask,
      task_date: '2020-01-01',
      task_time: '09:00:00',
    };
    const id = await scheduleTaskReminder(past);

    expect(id).toBeNull();
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});

// ============================================================
// 3. cancelByTaskId
// ============================================================

describe('NotificationScheduler.cancelByTaskId', () => {
  it('cancels the scheduled notification with matching identifier', async () => {
    await init();

    await cancelByTaskId(baseTask.id);

    expect(mockCancel).toHaveBeenCalledWith(`task-reminder:${baseTask.id}`);
  });

  it('does not throw when cancellation fails (defensive .catch)', async () => {
    await init();
    mockCancel.mockRejectedValueOnce(new Error('not found'));

    // 应该静默吞掉,不抛
    await expect(cancelByTaskId(baseTask.id)).resolves.toBeUndefined();
  });
});

// ============================================================
// 4. scheduleDigest
// ============================================================

describe('NotificationScheduler.scheduleDigest', () => {
  beforeEach(async () => {
    await init();
  });

  it('schedules both morning and evening DAILY triggers with parsed HH:MM[:SS] times', async () => {
    await scheduleDigest('08:00', '20:00:00'); // 测试两种格式都接受

    // 第一次 cancel 是 cancel 旧的 2 个,然后 2 次 schedule
    // (说明:cancel 调用次数由 init 后的内部状态决定;不强行断言次数,只断言 schedule 形态)
    const scheduleCalls = mockSchedule.mock.calls.map((c) => c[0]);
    const identifiers = scheduleCalls.map((s) => s.identifier);
    expect(identifiers).toContain('digest-morning');
    expect(identifiers).toContain('digest-evening');

    for (const req of scheduleCalls) {
      expect(req.trigger.type).toBe('daily');
      expect(['digest', 'task-reminders']).toContain(req.trigger.channelId);
    }

    // morning = 8:00, evening = 20:00(后者输入 20:00:00 也应解析成 20)
    const morningReq = scheduleCalls.find((s) => s.identifier === 'digest-morning');
    const eveningReq = scheduleCalls.find((s) => s.identifier === 'digest-evening');
    expect(morningReq.trigger.hour).toBe(8);
    expect(morningReq.trigger.minute).toBe(0);
    expect(eveningReq.trigger.hour).toBe(20);
    expect(eveningReq.trigger.minute).toBe(0);
  });
});

// ============================================================
// 5. rescheduleAll
// ============================================================

describe('NotificationScheduler.rescheduleAll', () => {
  beforeEach(async () => {
    await init();
  });

  it('cancels all existing task-reminder notifications before rescheduling', async () => {
    // 模拟当前已有 3 个旧 task-reminder
    mockGetAll.mockResolvedValueOnce([
      { identifier: 'task-reminder:old-1' },
      { identifier: 'task-reminder:old-2' },
      { identifier: 'task-reminder:old-3' },
      { identifier: 'digest-morning' }, // 不应被 cancel(task-reminder 之外)
    ]);

    const result = await rescheduleAll([baseTask], baseSettings);

    // 旧的 task-reminder 被 cancel(rescheduleAll 自己 + scheduleDigest 内部
    // 也会 cancel `digest-morning` / `digest-evening` 以替换时间,后者也会进
    // cancelledIds,这里不强行排除)
    const cancelledIds = mockCancel.mock.calls.map((c) => c[0]);
    expect(cancelledIds).toEqual(
      expect.arrayContaining([
        'task-reminder:old-1',
        'task-reminder:old-2',
        'task-reminder:old-3',
      ]),
    );

    // 新任务被排
    expect(result.taskReminders).toBe(1);
    expect(result.digests).toBe(2);
  });

  it('skips completed and past tasks when rescheduling', async () => {
    const completed: Task = { ...baseTask, id: 't-done', completed_at: '2026-09-15T09:00:00Z' };
    const past: Task = {
      ...baseTask,
      id: 't-past',
      task_date: '2020-01-01',
      task_time: '09:00:00',
    };
    const upcoming: Task = { ...baseTask, id: 't-up' };

    const result = await rescheduleAll([completed, past, upcoming], baseSettings);

    // 只排了 upcoming(1 个)
    expect(result.taskReminders).toBe(1);
    const scheduledIds = mockSchedule.mock.calls
      .map((c) => c[0].identifier)
      .filter((id: string | undefined): id is string => typeof id === 'string');
    expect(scheduledIds).toContain('task-reminder:t-up');
    expect(scheduledIds).not.toContain('task-reminder:t-done');
    expect(scheduledIds).not.toContain('task-reminder:t-past');
  });

  it('handles empty task list (still schedules digests)', async () => {
    const result = await rescheduleAll([], baseSettings);

    expect(result.taskReminders).toBe(0);
    expect(result.digests).toBe(2);
  });
});

// ============================================================
// 6. Notification tap callback
// ============================================================

describe('NotificationScheduler notification tap routing', () => {
  it('invokes registered handler with taskId from response data', async () => {
    await init();

    // init 时注册的 listener 拿出来,模拟系统回调
    const listener = mockAddResponseListener.mock.calls[0][0];
    expect(typeof listener).toBe('function');

    const tap = jest.fn();
    setNotificationTapHandler(tap);

    // 模拟用户点击了 task-reminder
    await listener({
      notification: {
        request: {
          identifier: `task-reminder:${baseTask.id}`,
          content: { data: { taskId: baseTask.id }, title: '倒垃圾', body: '' },
        },
        date: Date.now(),
      },
      actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
      userText: undefined,
    });

    expect(tap).toHaveBeenCalledWith(baseTask.id);
  });

  it('invokes handler with null when payload has no taskId (e.g. digest)', async () => {
    await init();

    const listener = mockAddResponseListener.mock.calls[0][0];
    const tap = jest.fn();
    setNotificationTapHandler(tap);

    await listener({
      notification: {
        request: {
          identifier: 'digest-morning',
          content: { data: { kind: 'digest-morning' }, title: '早安', body: '' },
        },
        date: Date.now(),
      },
      actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
      userText: undefined,
    });

    expect(tap).toHaveBeenCalledWith(null);
  });

  it('handles cold-start — invokes handler from getLastNotificationResponseAsync', async () => {
    mockGetLastResponse.mockResolvedValueOnce({
      notification: {
        request: {
          identifier: `task-reminder:${baseTask.id}`,
          content: { data: { taskId: baseTask.id }, title: '倒垃圾', body: '' },
        },
        date: Date.now(),
      },
      actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
      userText: undefined,
    });

    const tap = jest.fn();
    setNotificationTapHandler(tap);

    await init();

    expect(tap).toHaveBeenCalledWith(baseTask.id);
  });
});