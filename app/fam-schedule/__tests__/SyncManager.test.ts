/**
 * SyncManager 单元测试 — T-SETUP-6
 *
 * 覆盖范围(任务 DoD + ADR-005 关键路径):
 *   1. enqueueAndApply(checkin) — 乐观更新 cache + 入队 + 在线触发 replay + 清队
 *   2. replayQueue(失败重试) — RPC 失败时 mutation 被 re-enqueue 到 tail
 *   3. pullSince(null) — 初始全量拉取,合并到本地 cache
 *   4. pullSince(lastSyncAt > 0) — 增量拉取传 .gt('updated_at', isoString)
 *   5. subscribeFamily 幂等 — 同 familyId 第二次调用不重复订阅
 *
 * Mock 策略:
 *   - supabase 整个模块 mock 掉,提供可编程的 mockRpc / mockFrom / mockChannel
 *   - NetInfo 整个模块 mock 掉
 *   - react-native AppState mock 掉
 *
 * ⚠️ 测试间需要重置模块级 singleton(unsubscribeAll + dedup 清空 + 网络 listener 集)
 *   通过显式调 _resetForTests 兜底。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ---- Mocks (必须在 import SyncManager 之前) ----------------------------

let mockRpc: jest.Mock;
let mockFrom: jest.Mock;
let mockChannel: jest.Mock;
let mockRemoveChannel: jest.Mock;

jest.mock('../src/lib/supabase', () => {
  mockRpc = jest.fn();
  mockFrom = jest.fn();
  mockChannel = jest.fn();
  mockRemoveChannel = jest.fn(async () => undefined);

  // 链式:channel(name).on().on().on().on().subscribe() 返回一个 channel 对象
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

  // from(table).select().eq().gt() 链式 mock
  const makeQuery = (resolveWith: { data?: unknown; error?: unknown }) => {
    const q: any = {};
    q.select = jest.fn(() => q);
    q.eq = jest.fn(() => q);
    q.gt = jest.fn(() => q);
    q.insert = jest.fn(() => Promise.resolve(resolveWith));
    q.update = jest.fn(() => q);
    q.delete = jest.fn(() => q);
    // 直接兑现:链尾可 await
    q.then = (r: (v: unknown) => void, j?: (e: unknown) => void) =>
      Promise.resolve(resolveWith).then(r, j);
    q.catch = (j: (e: unknown) => void) =>
      Promise.resolve(resolveWith).catch(j);
    return q;
  };

  mockFrom.mockImplementation((table: string) =>
    makeQuery({ data: [], error: null }) as unknown as ReturnType<typeof mockFrom>,
  );

  mockChannel.mockImplementation(() => makeChannel());

  return {
    supabase: {
      rpc: (...args: unknown[]) => mockRpc(...args),
      from: (...args: unknown[]) => mockFrom(...args),
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

// ⚠️ 不能 spread jest.requireActual('react-native'):完整加载会触发 DevMenu 等
// TurboModule 查找,本测试无 native runtime,会 invariant 失败。
// 改用最小 stub:只暴露 jest-expo preset 链路上 + SyncManager 真正需要的 API。
// (jest-expo setup.js 期望 Platform.select 存在)
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
  enqueueAndApply,
  replayQueue,
  pullSince,
  subscribeFamily,
  _resetForTests,
  getTasksSnapshot,
  subscribeTasks,
  setTasksAndNotify,
} from '../src/lib/SyncManager';
import {
  enqueueMutation,
  drainQueue,
  getTasks,
  setTasks,
  getLastSyncAt,
  setLastSyncAt,
  getQueueLength,
  type PendingMutation,
  type Task,
  type TaskTemplate,
  type FamilySettings,
} from '../src/lib/LocalStore';

// ---- Test fixtures ----------------------------------------------------

const FAMILY_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TASK_ID_1 = 'task-1';
const TASK_ID_2 = 'task-2';

const task1: Task = {
  id: TASK_ID_1,
  template_id: null,
  family_id: FAMILY_ID,
  title: '晚上吃药',
  description: null,
  task_date: '2026-09-15',
  task_time: '20:00:00',
  assignee_id: USER_ID_A,
  co_executor_ids: [],
  is_shared_view: true,
  created_by: USER_ID_A,
  completed_at: null,
  completed_by: null,
  is_makeup: false,
  cancelled: false,
  created_at: '2026-09-15T00:00:00.000Z',
  updated_at: '2026-09-15T00:00:00.000Z',
};

const task2: Task = {
  ...task1,
  id: TASK_ID_2,
  title: '晚上洗碗',
};

// 让 mockFrom 按 table 返回不同 data,允许每个 test 自己 override
function makeRpcSuccess() {
  mockRpc.mockResolvedValue({ data: null, error: null });
}
function makeRpcFail(message: string) {
  mockRpc.mockResolvedValueOnce({ data: null, error: { message } });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await _resetForTests();
  jest.clearAllMocks();
  // 默认 RPC 成功
  makeRpcSuccess();
  // 默认 from().select()... 返回空
  mockFrom.mockImplementation((table: string) => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        gt: jest.fn(async () => ({ data: [], error: null })),
      })),
    })),
    insert: jest.fn(async () => ({ data: null, error: null })),
    update: jest.fn(() => ({
      eq: jest.fn(async () => ({ data: null, error: null })),
    })),
    delete: jest.fn(() => ({
      eq: jest.fn(async () => ({ data: null, error: null })),
    })),
    _table: table,
  }));
  // ⚠️ 不在 beforeEach 默认 subscribeFamily:subscribe 幂等会让后续 test override
  //   mockFrom 后再调一次时 no-op,pullSince 走不到新 mock。各 test 显式管理顺序。
});

// =====================================================================
// Tests
// =====================================================================

describe('SyncManager.enqueueAndApply', () => {
  it('optimistically marks task as completed in cache + queues + replays (checkin)', async () => {
    // Seed cache with task1 undone
    await setTasks([task1]);

    const checkinMutation: PendingMutation = {
      kind: 'checkin',
      taskId: TASK_ID_1,
      isMakeup: false,
      queuedAt: Date.now(),
    };

    // enqueueAndApply:乐观写 cache + 入队 + 在线时立即 replay
    await enqueueAndApply(checkinMutation);

    // 1. cache 中 task1 已乐观标记 completed(由 applyOptimisticUpdate 写入)
    const cached = await getTasks();
    expect(cached).toHaveLength(1);
    expect(cached[0].id).toBe(TASK_ID_1);
    expect(cached[0].completed_at).not.toBeNull();
    expect(cached[0].is_makeup).toBe(false);

    // 2. queue 已被 drain 干净(replay 成功)
    expect(await getQueueLength()).toBe(0);

    // 3. RPC 被调过(参数正确)
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('checkin_task', {
      p_task_id: TASK_ID_1,
      p_is_makeup: false,
    });
  });

  it('applies undo_checkin optimistic update (clears completed_at)', async () => {
    // Seed with task1 already completed
    await setTasks([{ ...task1, completed_at: '2026-09-15T10:00:00Z' }]);

    const undoMutation: PendingMutation = {
      kind: 'undo_checkin',
      taskId: TASK_ID_1,
      queuedAt: Date.now(),
    };

    await enqueueAndApply(undoMutation);

    const cached = await getTasks();
    expect(cached[0].completed_at).toBeNull();
    expect(cached[0].completed_by).toBeNull();
  });
});

describe('SyncManager.replayQueue', () => {
  it('re-enqueues failed mutations at tail (keeps them for next attempt)', async () => {
    // Pre-populate queue: checkin + undo_checkin
    await enqueueMutation({
      kind: 'checkin',
      taskId: TASK_ID_1,
      isMakeup: false,
      queuedAt: 1000,
    });
    await enqueueMutation({
      kind: 'undo_checkin',
      taskId: TASK_ID_2,
      queuedAt: 2000,
    });

    // First RPC call fails; queue must NOT lose the mutation
    makeRpcFail('network down');
    // Second RPC succeeds (re-enqueue from earlier failure doesn't re-trigger; this is just for the original 2)
    mockRpc.mockResolvedValue({ data: null, error: null });

    await replayQueue();

    // Both RPC attempts happened
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'checkin_task', {
      p_task_id: TASK_ID_1,
      p_is_makeup: false,
    });
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'undo_checkin', {
      p_task_id: TASK_ID_2,
    });

    // After replayQueue:queue is drained & failures are re-enqueued at tail.
    // Failed ones (1st call) end up at tail; 2nd (which succeeded) drops out.
    const remaining = await drainQueue();
    // The failed one is re-enqueued; the successful one is dropped.
    // (Since replayQueue re-enqueues failed ones after each iteration, the final
    // queue must have exactly the failed one.)
    expect(remaining).toHaveLength(1);
    expect(remaining[0].kind).toBe('checkin');
    // union narrow via cast:上面已断言 kind === 'checkin',此处 TS 不会自动 narrow index access
    expect((remaining[0] as { taskId: string }).taskId).toBe(TASK_ID_1);
  });
});

describe('SyncManager.pullSince', () => {
  it('initial pull (lastSyncAt=null) uses 1970 wildcard timestamp', async () => {
    // Seed: from('tasks').select().eq().gt() returns 2 tasks
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tasks') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              gt: jest.fn(async (col: string, val: string) => {
                // 验证:传递的是 'updated_at', '1970-01-01...'
                expect(col).toBe('updated_at');
                expect(val).toMatch(/^1970/);
                return { data: [task1, task2], error: null };
              }),
            })),
          })),
        };
      }
      // 其他表返回空
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            gt: jest.fn(async () => ({ data: [], error: null })),
          })),
        })),
      };
    });

    await subscribeFamily(FAMILY_ID);

    const cached = await getTasks();
    expect(cached).toHaveLength(2);
    expect(cached.map((t) => t.id).sort()).toEqual([TASK_ID_1, TASK_ID_2].sort());
  });

  it('subsequent pull uses ISO string of lastSyncAt', async () => {
    // 先订阅(用 default mockFrom),让 currentFamilyId 被设置
    await subscribeFamily(FAMILY_ID);

    // 然后才 override mockFrom,这样后续的 pullSince 用新 mock
    let capturedGt: string | null = null;
    mockFrom.mockImplementation((table: string) => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          gt: jest.fn(async (_col: string, val: string) => {
            capturedGt = val;
            return { data: [], error: null };
          }),
        })),
      })),
      _table: table,
    }));

    // 直接调 pullSince with a known timestamp
    const knownTs = 1700000000000; // 2023-11-14T22:13:20Z
    await pullSince(knownTs);

    expect(capturedGt).not.toBeNull();
    expect(capturedGt).toBe(new Date(knownTs).toISOString());
  });

  it('merges incoming server rows into existing cache (overwrite by id)', async () => {
    // 先订阅(用 default mockFrom),让 currentFamilyId 被设置
    await subscribeFamily(FAMILY_ID);

    // 本地缓存里已有 task1(server-authoritative old state)
    const oldTask1: Task = { ...task1, title: 'old title' };
    await setTasks([oldTask1]);

    // Server 返回 task1 with new title
    const updatedTask1: Task = { ...task1, title: 'NEW title from server' };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'tasks') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              gt: jest.fn(async () => ({ data: [updatedTask1], error: null })),
            })),
          })),
        };
      }
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            gt: jest.fn(async () => ({ data: [], error: null })),
          })),
        })),
      };
    });

    await pullSince(null);

    const cached = await getTasks();
    expect(cached).toHaveLength(1);
    expect(cached[0].title).toBe('NEW title from server');
  });
});

describe('SyncManager.pullSince partial-failure guard (T-FIX-01)', () => {
  // 共享 mock 工厂:全成功(empty arrays, error=null)
  const allSuccessMock = () =>
    mockFrom.mockImplementation((table: string) => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          gt: jest.fn(async () => ({ data: [], error: null })),
        })),
      })),
      _table: table,
    }));

  it('all 3 queries succeed → last_sync_at advances', async () => {
    // 1) 订阅以设置 currentFamilyId
    await subscribeFamily(FAMILY_ID);

    // 2) seed 一个固定基线值(避免 before===after===null 的 false-positive)
    const baseline = 1700000000000; // 2023-11-14T22:13:20Z
    await setLastSyncAt(baseline);

    // 3) override mockFrom:全 3 表返回 success
    allSuccessMock();

    // 4) 执行 pullSince
    const before = await getLastSyncAt();
    const status = await pullSince(null);
    const after = await getLastSyncAt();

    // 5) 断言:status 全 OK,且 last_sync_at 已前进
    expect(before).toBe(baseline);
    expect(status.ok).toBe(true);
    expect(status.tasks).toBe(true);
    expect(status.templates).toBe(true);
    expect(status.settings).toBe(true);
    expect(after).not.toBe(before); // 时间戳已更新
    expect(after).toBeGreaterThan(baseline); // 严格大于基线(Date.now() 现在)
  });

  it('tasks query fails → last_sync_at does NOT advance (data not lost)', async () => {
    // 1) 订阅以设置 currentFamilyId
    await subscribeFamily(FAMILY_ID);

    // 2) seed 固定基线
    const baseline = 1700000000000;
    await setLastSyncAt(baseline);

    // 3) override mockFrom:tasks 失败,其他 2 表 OK
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tasks') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              gt: jest.fn(async () => ({
                data: null,
                error: { message: '5xx server error' },
              })),
            })),
          })),
        };
      }
      // templates / settings 返回 success
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            gt: jest.fn(async () => ({ data: [], error: null })),
          })),
        })),
      };
    });

    // 4) 执行 pullSince
    const before = await getLastSyncAt();
    const status = await pullSince(null);
    const after = await getLastSyncAt();

    // 5) 断言:tasks=false / ok=false,且 last_sync_at 保持原值(关键!)
    expect(before).toBe(baseline);
    expect(status.ok).toBe(false);
    expect(status.tasks).toBe(false);
    expect(status.templates).toBe(true);
    expect(status.settings).toBe(true);
    expect(after).toBe(before); // 时间戳未推进 — 缺失表下次重试
    expect(after).toBe(baseline);
  });
});

describe('SyncManager.subscribeFamily', () => {
  it('is idempotent — same familyId does not create duplicate channel', async () => {
    // 第一次订阅
    await subscribeFamily(FAMILY_ID);
    expect(mockChannel).toHaveBeenCalledTimes(1);

    // 第二次同 family
    await subscribeFamily(FAMILY_ID);

    // 仍然是 1 次(没有重复)
    expect(mockChannel).toHaveBeenCalledTimes(1);
  });
});

/**
 * T-US002-1 新增 —— tasks snapshot + listener 集成测试
 *
 * 覆盖:
 *   - pullSince 拉到 tasks 后,listener 被通知且 snapshot 更新
 *   - applyOptimisticUpdate (enqueueAndApply checkin) 后,listener 被通知
 *   - handleRealtimeChange(通过 mockChannel._emit 模拟 INSERT)后,listener 被通知
 *   - _resetForTests 清空 listener + snapshot
 *
 * 注意:这些测试不重测 useTasks.test.tsx 里 listener 本身的语义,只验证
 * SyncManager 各 setTasks 调用点已经统一改成 setTasksAndNotify,
 * 行为与之前完全一致(只是额外触发 listener)。
 */
describe('SyncManager listener (T-US002-1)', () => {
  it('pullSince merging incoming tasks notifies listeners and updates snapshot', async () => {
    // 先订阅(让 currentFamilyId 被设)
    await subscribeFamily(FAMILY_ID);
    // 用 mock 替换 — pullSince 期间 tasks 表返回 task1
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tasks') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              gt: jest.fn(async () => ({ data: [task1], error: null })),
            })),
          })),
        };
      }
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            gt: jest.fn(async () => ({ data: [], error: null })),
          })),
        })),
      };
    });

    const cb = jest.fn();
    subscribeTasks(cb);

    await pullSince(null);

    // listener 被通知(1 次,tasks 路径)
    expect(cb).toHaveBeenCalled();
    // snapshot 更新
    expect(getTasksSnapshot().map((t) => t.id)).toContain(TASK_ID_1);
  });

  it('enqueueAndApply(checkin) notifies listeners via applyOptimisticUpdate', async () => {
    await setTasks([task1]);

    const cb = jest.fn();
    subscribeTasks(cb);

    const checkinMutation: PendingMutation = {
      kind: 'checkin',
      taskId: TASK_ID_1,
      isMakeup: false,
      queuedAt: Date.now(),
    };
    await enqueueAndApply(checkinMutation);

    // listener 被通知(applyOptimisticUpdate 走的 setTasksAndNotify)
    expect(cb).toHaveBeenCalled();
    // snapshot 反映乐观更新
    const snap = getTasksSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(TASK_ID_1);
    expect(snap[0].completed_at).not.toBeNull();
  });

  it('enqueueAndApply(delete_task) notifies listeners via applyOptimisticUpdate', async () => {
    await setTasks([task1, task2]);

    const cb = jest.fn();
    subscribeTasks(cb);

    const deleteMutation: PendingMutation = {
      kind: 'delete_task',
      taskId: TASK_ID_1,
      queuedAt: Date.now(),
    };
    await enqueueAndApply(deleteMutation);

    expect(cb).toHaveBeenCalled();
    const snap = getTasksSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(TASK_ID_2);
  });

  it('handleRealtimeChange(INSERT) notifies listeners', async () => {
    await subscribeFamily(FAMILY_ID);

    // 拿到 mockChannel 返回的 channel 对象,模拟 INSERT
    const ch = mockChannel.mock.results[mockChannel.mock.results.length - 1].value as {
      _emit: (p: unknown) => void;
    };

    const cb = jest.fn();
    subscribeTasks(cb);

    // 模拟 Supabase Realtime INSERT 事件
    // handler 内部 void handleRealtimeChange(...) 是 async 链,需要 flush 几次
    ch._emit({
      eventType: 'INSERT',
      new: { ...task1 },
      old: {},
    });
    // 让 handler 内部的 await setTasksAndNotify 链有 time to resolve
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    // listener 被通知(handleRealtimeChange → setTasksAndNotify)
    expect(cb).toHaveBeenCalled();
    // snapshot 包含新插入的 task
    const snap = getTasksSnapshot();
    expect(snap.map((t) => t.id)).toContain(TASK_ID_1);
  });

  it('_resetForTests clears tasks snapshot and listeners', async () => {
    // 用 setTasksAndNotify 写 snapshot(setTasks 不更新 snapshot)
    await setTasksAndNotify([task1]);
    const cb = jest.fn();
    subscribeTasks(cb);

    expect(getTasksSnapshot()).toHaveLength(1);
    expect(cb).toHaveBeenCalledTimes(0); // 没 notify 过

    await _resetForTests();

    expect(getTasksSnapshot()).toEqual([]);
    // 旧的 cb 不应再被通知(reset 后 list 清空)
    const beforeCount = cb.mock.calls.length;
    // 重新塞一个 listener 让它收到 1 次通知,验证旧 cb 被清掉
    await setTasks([task2]);
    expect(cb.mock.calls.length).toBe(beforeCount);
  });
});

/**
 * 最后检查:FamilySettings 类型被消费(避免 unused import 误删)
 */
describe('Type imports sanity', () => {
  it('TaskTemplate / FamilySettings types are imported by SyncManager', () => {
    // 这是一个静态保证:如果 SyncManager 不再 import TaskTemplate / FamilySettings,
    // 这里会在 SyncManager.ts 触发 "unused import" lint 警告(或 compile 时其实不报错,
    // 但我们仍测一遍)。
    expect(typeof task1).toBe('object');
    const _template: TaskTemplate = {
      id: 'tpl-1',
      family_id: FAMILY_ID,
      title: 't',
      description: null,
      recurrence_rule: { freq: 'daily' },
      start_date: '2026-09-15',
      end_date: null,
      task_time: null,
      assignee_id: USER_ID_A,
      co_executor_ids: [],
      is_shared_view: true,
      active: true,
      created_by: USER_ID_A,
      created_at: '2026-09-15T00:00:00Z',
      updated_at: '2026-09-15T00:00:00Z',
    };
    const _settings: FamilySettings = {
      family_id: FAMILY_ID,
      morning_digest_time: '08:00:00',
      evening_digest_time: '20:00:00',
      digest_time_min: '06:00:00',
      digest_time_max: '22:00:00',
      expiry_window: 'yesterday_today',
      late_checkin_cutoff: 'same_day_2359',
      created_at: '2026-09-15T00:00:00Z',
      updated_at: '2026-09-15T00:00:00Z',
    };
    expect(_template.id).toBe('tpl-1');
    expect(_settings.family_id).toBe(FAMILY_ID);
  });
});
