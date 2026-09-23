/**
 * Realtime end-to-end 集成测试 — T-US005-4
 *
 * 覆盖范围(brief §D):
 *   1. Realtime INSERT 事件 → subscribeTasks listener 触发 + getTasksSnapshot 含新 task
 *   2. Realtime UPDATE(completed_at 变化,配偶打卡场景)→ snapshot 反映新 completed_at
 *   3. Realtime UPDATE 同 id 行(LWW 行级覆盖)→ snapshot 用新行覆盖旧行
 *   4. Realtime DELETE(配偶删除场景)→ snapshot 移除对应 id 的 task
 *   5. subscribeFamily 幂等:同 familyId 第二次调用直接 return(无重复订阅)
 *
 * 设计动机:
 *   - SyncManager.test.ts 已对 INSERT listener 通知契约做过一次断言(T-US002-1 扩展)
 *   - 本测试聚焦端到端 Realtime 路径在 4 种场景下的契约完整性:
 *     a) useTasks() subscriber 在 Realtime 推送时被通知;
 *     b) snapshot 在 Realtime 推送后反映新行(顺序保证);
 *     c) 幂等性守住(useTasks 在 detail / edit / dashboard 多屏挂同一 useSyncManager 时
 *        不会出现 multi-listener 风暴)
 *
 * Mock 策略:
 *   - supabase 整个模块 mock 掉;channel().on() 注册的 handler 存进数组,通过
 *     `channel._emit(payload)` 模拟 Supabase Realtime postgres_changes 事件
 *   - NetInfo mock 掉
 *   - react-native AppState mock 掉
 *
 * 严格 scope:
 *   - 不测 useSyncExternalStore tearing(React 内部契约,非本模块责任)
 *   - 不测 useTasks hook 自身(useTasks.test.tsx 已覆盖)
 *   - 不测 SyncManager.replayQueue / pullSince 全量逻辑(SyncManager.test.ts 已覆盖)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ---- Mocks (必须在 import SyncManager 之前) ----------------------------

let mockChannel: jest.Mock;
let mockRemoveChannel: jest.Mock;

jest.mock('../src/lib/supabase', () => {
  mockChannel = jest.fn();
  mockRemoveChannel = jest.fn(async () => undefined);

  // channel().on().on()...subscribe() 链式 mock:handlers 数组存所有 .on() 注册的回调,
  // 测试通过 ch._emit(payload) 触发 realtime 事件
  const makeChannel = (): unknown => {
    const handlers: Array<(p: unknown) => void> = [];
    const ch: any = {
      on: (_evt: string, _cfg: unknown, h: (p: unknown) => void) => {
        handlers.push(h);
        return ch;
      },
      subscribe: (cb?: (status: string) => void) => {
        if (cb) cb('SUBSCRIBED');
        return ch;
      },
      _emit: (payload: unknown) => handlers.forEach((h) => h(payload)),
    };
    return ch;
  };

  // from(table).select().eq().gt() 链式 mock(本测试不依赖 from 数据,但 subscribeFamily
  // 内部会触发初始 pullSince,故 notTo 全空即可)
  const makeQuery = (resolveWith: { data?: unknown; error?: unknown }) => {
    const q: any = {};
    q.select = jest.fn(() => q);
    q.eq = jest.fn(() => q);
    q.gt = jest.fn(() => q);
    q.insert = jest.fn(() => Promise.resolve(resolveWith));
    q.update = jest.fn(() => q);
    q.delete = jest.fn(() => q);
    q.then = (r: (v: unknown) => void, j?: (e: unknown) => void) =>
      Promise.resolve(resolveWith).then(r, j);
    q.catch = (j: (e: unknown) => void) =>
      Promise.resolve(resolveWith).catch(j);
    return q;
  };

  mockChannel.mockImplementation(() => makeChannel());

  return {
    supabase: {
      rpc: jest.fn(),
      from: jest.fn(() => makeQuery({ data: [], error: null })),
      channel: (...args: unknown[]) => mockChannel(...args),
      removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
    },
  };
});

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
  },
}));

jest.mock('react-native', () => ({
  Platform: {
    OS: 'android',
    select: (specifics: { android?: unknown; default?: unknown }) =>
      specifics.android ?? specifics.default,
  },
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

// ---- Imports (mock 之后) ----------------------------------------------

import {
  subscribeFamily,
  getTasksSnapshot,
  subscribeTasks,
  setTasksAndNotify,
  _resetForTests,
} from '../src/lib/SyncManager';
import { getTasks, setTasks, type Task } from '../src/lib/LocalStore';

// ---- Test fixtures ----------------------------------------------------

const FAMILY_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_ID_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TASK_ID_1 = 'task-1';
const TASK_ID_2 = 'task-2';

const baseTask: Task = {
  id: TASK_ID_1,
  template_id: null,
  family_id: FAMILY_ID,
  title: '晚上吃药',
  description: null,
  task_date: '2026-09-23',
  task_time: '20:00:00',
  assignee_id: USER_ID_A,
  co_executor_ids: [],
  is_shared_view: true,
  created_by: USER_ID_A,
  completed_at: null,
  completed_by: null,
  is_makeup: false,
  cancelled: false,
  created_at: '2026-09-23T00:00:00.000Z',
  updated_at: '2026-09-23T00:00:00.000Z',
};

const task2: Task = {
  ...baseTask,
  id: TASK_ID_2,
  title: '晚上洗碗',
  assignee_id: USER_ID_B,
};

/**
 * 拿到 mockChannel 最近一次 subscribeFamily 创建的 channel 对象,
 * 通过 _emit 模拟 Supabase Realtime postgres_changes 事件。
 */
function lastChannel(): {
  _emit: (payload: unknown) => void;
} {
  const result = mockChannel.mock.results[mockChannel.mock.results.length - 1];
  if (!result) throw new Error('mockChannel was never called');
  return result.value as { _emit: (p: unknown) => void };
}

/**
 * flush 几次 microtask,让 realtime handler 内部的 async 链
 * (void handleRealtimeChange → setTasksAndNotify → notify)有 time to resolve。
 */
async function flushRealtime(): Promise<void> {
  // handler 是 async 链:setTasksAndNotify → await setTasks → notify
  // 多次 setImmediate 等价于多次 microtask flush,确保 listener 被通知
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await _resetForTests();
  jest.clearAllMocks();
});

afterAll(async () => {
  await _resetForTests();
});

// =====================================================================
// Realtime end-to-end 集成 — T-US005-4
// =====================================================================

describe('T-US005-4 Realtime end-to-end', () => {
  it('Realtime INSERT → subscribeTasks listener notified + snapshot 含新 task', async () => {
    await subscribeFamily(FAMILY_ID);

    const cb = jest.fn();
    subscribeTasks(cb);

    const ch = lastChannel();

    // 模拟 Supabase Realtime INSERT 事件(配偶在 device A 创建新 task 推送过来)
    ch._emit({
      eventType: 'INSERT',
      new: { ...baseTask, id: TASK_ID_1, title: '喂奶粉' },
      old: {},
    });

    await flushRealtime();

    // 1. listener 被通知(useTasks 的 useSyncExternalStore 会触发 React 重渲染)
    expect(cb).toHaveBeenCalled();
    // 2. snapshot 含新 task(getTasksSnapshot 同步读)
    const snap = getTasksSnapshot();
    expect(snap.map((t) => t.id)).toContain(TASK_ID_1);
    // 4. AsyncStorage 也被持久化(setTasksAndNotify 第一步)
    const cached = await getTasks();
    expect(cached.map((t) => t.id)).toContain(TASK_ID_1);
  });

  it('Realtime UPDATE completed_at 变化触达(配偶打卡场景)', async () => {
    // 预先 seed 一个未打卡的 task(等价于 pullSince 拉到本地)
    await setTasksAndNotify([{ ...baseTask }]);
    await subscribeFamily(FAMILY_ID);

    const cb = jest.fn();
    subscribeTasks(cb);

    // 模拟配偶在 device A 打卡:Realtime UPDATE 推 completed_at / completed_by
    const checkedAt = '2026-09-23T20:05:00.000Z';
    const ch = lastChannel();
    ch._emit({
      eventType: 'UPDATE',
      new: {
        ...baseTask,
        completed_at: checkedAt,
        completed_by: USER_ID_B,
        updated_at: checkedAt,
      },
      old: { ...baseTask },
    });

    await flushRealtime();

    // listener 通知
    expect(cb).toHaveBeenCalled();
    // snapshot 反映新 completed_at — 这是 T-US005-1 / T-US005-2 详情页 CheckInButton
    // 切到 completed 视觉态的数据来源
    const snap = getTasksSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(TASK_ID_1);
    expect(snap[0].completed_at).toBe(checkedAt);
    expect(snap[0].completed_by).toBe(USER_ID_B);
  });

  it('Realtime UPDATE 同 id 行 LWW 覆盖(配偶修改 task 字段)', async () => {
    // seed:已有 task1 的旧标题
    const oldTask1: Task = { ...baseTask, title: '倒垃圾' };
    await setTasksAndNotify([oldTask1]);
    await subscribeFamily(FAMILY_ID);

    // 配偶在 device A 改了 title(Realtime UPDATE 推送同 id 的新行)
    const newTask1: Task = { ...baseTask, title: '喂奶粉(NEW)' };
    const ch = lastChannel();
    ch._emit({
      eventType: 'UPDATE',
      new: newTask1,
      old: oldTask1,
    });

    await flushRealtime();

    // snapshot 行级 LWW 覆盖(ADR-005):同 id 用 new 替换
    const snap = getTasksSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(TASK_ID_1);
    expect(snap[0].title).toBe('喂奶粉(NEW)');
  });

  it('Realtime DELETE → task 从 snapshot / LocalStore 消失(配偶删除场景)', async () => {
    // seed:2 个 task
    await setTasksAndNotify([{ ...baseTask }, { ...task2 }]);
    await subscribeFamily(FAMILY_ID);

    const cb = jest.fn();
    subscribeTasks(cb);

    // 配偶在 device A 删了 task1(T-US003-2 已支持),Realtime DELETE 推送
    const ch = lastChannel();
    ch._emit({
      eventType: 'DELETE',
      new: {},
      old: { id: TASK_ID_1 },
    });

    await flushRealtime();

    // listener 通知(EditTaskScreen / TaskDetailScreen "任务不存在" 自动 back)
    expect(cb).toHaveBeenCalled();
    // snapshot 只剩 task2
    const snap = getTasksSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(TASK_ID_2);
    // LocalStore 也已更新(避免下次 pullSince 拉回已删除的行 — 实际上 DELETE 不会重 pull)
    const cached = await getTasks();
    expect(cached.map((t) => t.id)).toEqual([TASK_ID_2]);
  });

  it('subscribeFamily 幂等:同 familyId 第二次调用直接 return,channel 不重复创建', async () => {
    // 第一次订阅
    await subscribeFamily(FAMILY_ID);
    expect(mockChannel).toHaveBeenCalledTimes(1);

    // 第二次同 familyId → 直接 return(no-op,防 multi-listener 风暴)
    await subscribeFamily(FAMILY_ID);
    expect(mockChannel).toHaveBeenCalledTimes(1);

    // 第三次仍然幂等
    await subscribeFamily(FAMILY_ID);
    expect(mockChannel).toHaveBeenCalledTimes(1);

    // 跨 familyId 会触发 unsubscribeAll + 新建 channel
    const OTHER_FAMILY = '22222222-2222-2222-2222-222222222222';
    await subscribeFamily(OTHER_FAMILY);
    expect(mockChannel).toHaveBeenCalledTimes(2);
    // 切换 family 时旧 channel 被释放
    expect(mockRemoveChannel).toHaveBeenCalled();
  });

  it('subscribeFamily 幂等下,realtime INSERT 仍能通知 listener(幂等不等于断流)', async () => {
    // 幂等性守住的同时,不能把 realtime handler 注册给丢了 — 这是 T-US005-4
    // 挂在多屏(mount useSyncManager)的核心 safety net

    // 重复订阅 3 次(模拟 HomeScreen / TaskDetailScreen / EditTaskScreen
    // 在导航过渡中短暂同时挂载的边缘 case)
    await subscribeFamily(FAMILY_ID);
    await subscribeFamily(FAMILY_ID);
    await subscribeFamily(FAMILY_ID);

    const cb = jest.fn();
    subscribeTasks(cb);

    // 触发一次 realtime INSERT
    const ch = lastChannel();
    ch._emit({
      eventType: 'INSERT',
      new: { ...baseTask, id: TASK_ID_1 },
      old: {},
    });

    await flushRealtime();

    // 关键断言:即使重复 subscribeFamily,realtime 仍能触达 listener
    // (handler 注册在第一次 subscribeFamily;后续重复调用 early-return)
    expect(cb).toHaveBeenCalled();
    const snap = getTasksSnapshot();
    expect(snap.map((t) => t.id)).toContain(TASK_ID_1);
  });
});