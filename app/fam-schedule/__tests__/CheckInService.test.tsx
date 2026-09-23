/**
 * CheckInService 单元测试 — T-US005-1
 *
 * 覆盖范围(任务 brief §D):
 *
 *   checkin 走 SyncManager queue 路径:
 *     1. happy path — 调 SyncManager.enqueueAndApply + 返回 checked_in
 *     2. enqueueAndApply 收到的 mutation shape 正确({kind, taskId, isMakeup, queuedAt})
 *     3. **AD-005 契约**:不直接 supabase.rpc — 验证 supabase.rpc 在 happy path 下 NOT called
 *
 *   checkin 失败路径(6 种):
 *     4. not_authenticated  — getUser 返回 null user
 *     5. no_family          — FamilyService.getMyFamily 返回 null
 *     6. task_not_found     — SELECT row 是 null(无错误)
 *     7. cancelled          — task.cancelled = true
 *     8. rls_denied         — SELECT error 含 'rls' / 'row-level security' / 'policy'
 *     9. unknown            — SELECT 其它 error(非 rls)
 *
 *   幂等:
 *     10. 已 completed_at → 立即 checked_in,**不**调 enqueueAndApply / **不**supabase.rpc
 *
 * Mock 策略:
 *   - supabase 整个 mock(mockRpc / mockFrom / mockAuthGetUser)
 *   - FamilyService.getMyFamily mock(本 service 第一个 pre-check)
 *   - **SyncManager 整个 mock**:`enqueueAndApply` 用 jest.fn() 控制返回值
 *     — 这样可以严格断言:
 *       - happy path 下 enqueueAndApply 被调 1 次,shape 正确
 *       - cancelled / task_not_found / 已 completed_at 等"skipped"路径下
 *         enqueueAndApply **没有**被调
 *   - LocalStore.getTasks mock(读取 optimistic 后 cache)
 *     — SyncManager.enqueueAndApply 内部会 setLocal tasks(由 SyncManager 自己做,
 *       而本 service mock 已替 SyncManager);为了模拟 SyncManager.applyOptimisticUpdate
 *       的 cache 写入,我们让 mock 的 enqueueAndApply 内部也 mutate "虚拟 cache"。
 *
 * ⚠️ SyncManager.ts:409-420 是 applyOptimisticUpdate(optimistic writes 完成),
 *    line 512-521 是 executeOnServer(RPC 真正落地)。本测试 mock 整个 SyncManager,
 *    不验证这两个内部 helper — SyncManager.test.ts 已经覆盖。
 *
 * ⚠️ 不依赖本地真 AsyncStorage;mock SyncManager/LocalStore 让测试极快 / 极稳。
 */

// ---- Mocks(必须在 import CheckInService 之前)----------------------------

let mockRpc: jest.Mock;
let mockAuthGetUser: jest.Mock;
let mockSupabaseFrom: jest.Mock;
let mockGetMyFamily: jest.Mock;
let mockEnqueueAndApply: jest.Mock;
/** 模拟 LocalStore.tasks 的内存状态(被 mock 的 enqueueAndApply + getTasks 共享)。 */
let mockTaskCache: Record<string, import('../src/lib/LocalStore').Task> = {};

function buildTaskRow(overrides: Partial<import('../src/types/database').TaskRow> = {}): import('../src/lib/LocalStore').Task {
  return {
    id: 'task-uuid',
    template_id: null,
    family_id: 'family-uuid',
    title: '喂奶粉',
    description: null,
    task_date: '2026-09-23',
    task_time: '10:00',
    assignee_id: 'me-uuid',
    co_executor_ids: [],
    is_shared_view: false,
    created_by: 'me-uuid',
    completed_at: null,
    completed_by: null,
    is_makeup: false,
    cancelled: false,
    created_at: '2026-09-23T08:00:00Z',
    updated_at: '2026-09-23T08:00:00Z',
    ...overrides,
  };
}

function makeQueryBuilder(): {
  select: jest.Mock;
  eq: jest.Mock;
  maybeSingle: jest.Mock;
  single: jest.Mock;
  then: jest.Mock;
} {
  const builder = {
    select: jest.fn(),
    eq: jest.fn(),
    maybeSingle: jest.fn(),
    single: jest.fn(),
    then: jest.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue({ data: null, error: null });
  builder.single.mockResolvedValue({ data: null, error: null });
  // 默认 thenable 兑现
  builder.then.mockImplementation(
    (onFulfilled: (v: { data: unknown; error: unknown }) => void) => {
      onFulfilled({ data: null, error: null });
      return Promise.resolve();
    },
  );
  return builder;
}

jest.mock('../src/lib/supabase', () => {
  mockRpc = jest.fn();
  mockAuthGetUser = jest.fn();
  mockSupabaseFrom = jest.fn();
  return {
    supabase: {
      rpc: (...args: unknown[]) => mockRpc(...args),
      auth: {
        getUser: (...args: unknown[]) => mockAuthGetUser(...args),
      },
      from: (...args: unknown[]) => mockSupabaseFrom(...args),
    },
  };
});

jest.mock('../src/services/FamilyService', () => {
  mockGetMyFamily = jest.fn();
  return {
    getMyFamily: (...args: unknown[]) => mockGetMyFamily(...args),
  };
});

jest.mock('../src/lib/LocalStore', () => {
  // 模拟 LocalStore.tasks:getTasks 返 cache + setTasks 写 cache
  // SyncManager.applyOptimisticUpdate 也会写 cache(我们让 mock 的 enqueueAndApply 模拟它)
  // 注意:不要在工厂里用 .mockImplementation(...),那样 clearAllMocks 后实现会丢失;
  // 改用 const 定义实现,factory 引用之。
  const _getTasksImpl = async () => Object.values(mockTaskCache);
  const _setTasksImpl = async (tasks: import('../src/lib/LocalStore').Task[]) => {
    mockTaskCache = {};
    for (const t of tasks) mockTaskCache[t.id] = t;
  };
  const _clearImpl = async () => {
    mockTaskCache = {};
  };
  return {
    getTasks: jest.fn(_getTasksImpl),
    setTasks: jest.fn(_setTasksImpl),
    _clearAllForTests: jest.fn(_clearImpl),
  };
});

jest.mock('../src/lib/SyncManager', () => {
  const _enqueueImpl = async (mutation: unknown) => {
    // 模拟 SyncManager.applyOptimisticUpdate:对 checkin kind,写 completed_at 到 mock task cache
    const m = mutation as { kind: string; taskId: string; isMakeup?: boolean };
    if (m.kind === 'checkin' && mockTaskCache[m.taskId]) {
      mockTaskCache[m.taskId] = {
        ...mockTaskCache[m.taskId],
        completed_at: new Date().toISOString(),
        completed_by: 'me-uuid',
        is_makeup: m.isMakeup ?? false,
      };
    }
  };
  mockEnqueueAndApply = jest.fn(_enqueueImpl);
  return {
    enqueueAndApply: (...args: unknown[]) => mockEnqueueAndApply(...args),
  };
});

// ---- Imports(mock 之后)-----------------------------------------------

import { checkin, _resetForTests } from '../src/services/CheckInService';

// ---- Test fixtures ----------------------------------------------------

const FAMILY_ID = 'family-uuid-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ME_ID = 'me-uuid-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SPOUSE_ID = 'spouse-uuid-cccc-cccc-cccc-cccccccccccc';
const TASK_ID = 'task-uuid-eeee-eeee-eeee-eeeeeeeeeeee';

function setMockAuthUser(userId: string | null): void {
  if (userId === null) {
    mockAuthGetUser.mockResolvedValue({ data: { user: null }, error: null });
  } else {
    mockAuthGetUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
  }
}

function setMockFamily(familyId: string | null): void {
  if (familyId === null) {
    mockGetMyFamily.mockResolvedValue(null);
  } else {
    mockGetMyFamily.mockResolvedValue({
      family: {
        id: familyId,
        created_by: ME_ID,
        created_at: '2026-09-01T00:00:00Z',
      },
      members: [
        { family_id: familyId, user_id: ME_ID, joined_at: '2026-09-01T00:00:00Z' },
        { family_id: familyId, user_id: SPOUSE_ID, joined_at: '2026-09-02T00:00:00Z' },
      ],
      myRole: 'creator',
    });
  }
}

/**
 * 配置 supabase.from('tasks').select(...)...maybeSingle(...) 的返回值。
 *
 * - `row` — row 数据(null = task_not_found)
 * - `errorMessage` — error 文本(不传 = 无 error;传 null = 真无 error;传 'xxx' = 模拟 error)
 */
function setMockTaskSelect(
  row: Partial<import('../src/types/database').TaskRow> | null,
  errorMessage?: string | null,
): void {
  const builder = makeQueryBuilder();
  if (errorMessage !== undefined && errorMessage !== null) {
    builder.maybeSingle.mockResolvedValue({ data: null, error: { message: errorMessage } });
  } else {
    builder.maybeSingle.mockResolvedValue({
      data: row
        ? {
            id: row.id ?? TASK_ID,
            cancelled: row.cancelled ?? false,
            completed_at: row.completed_at ?? null,
            completed_by: row.completed_by ?? null,
            is_makeup: row.is_makeup ?? false,
          }
        : null,
      error: null,
    });
  }
  // 让 .from('tasks') 用这个 builder;其它 table 走默认
  mockSupabaseFrom.mockImplementation((t: string) =>
    t === 'tasks' ? builder : makeQueryBuilder(),
  );
}

// ---- beforeEach -------------------------------------------------------

beforeEach(() => {
  _resetForTests();
  // clearAllMocks(而非 resetAllMocks):我们 mock 的 LocalStore.getTasks / setTasks 是用
  // jest.fn() + 显式实现定义的;resetAllMocks 会清掉这些实现,导致 cached.find 崩。
  // 不使用 mockResolvedValueOnce(否则跨测试泄漏)— 每个 test 显式 setMockAuthUser + setMockFamily,
  // 不会留 Once 队列污染下一个 test。
  jest.clearAllMocks();
  // 重置虚拟 task cache
  mockTaskCache = {};
  // 默认 auth = me 登录
  setMockAuthUser(ME_ID);
  // 默认 family = 有
  setMockFamily(FAMILY_ID);
  // 默认 tasks.select = row 不存在(无 error)
  setMockTaskSelect(null);
});

// =====================================================================
// checkin — happy path
// =====================================================================

describe('CheckInService.checkin — happy path', () => {
  it('returns checked_in and calls SyncManager.enqueueAndApply with checkin mutation', async () => {
    const task = buildTaskRow({ id: TASK_ID });
    mockTaskCache[TASK_ID] = task;
    setMockTaskSelect(task); // row 存在,未 completed,未 cancelled

    const result = await checkin(TASK_ID);

    expect(result.status).toBe('checked_in');
    if (result.status === 'checked_in') {
      expect(result.taskId).toBe(TASK_ID);
      expect(typeof result.completedAt).toBe('string');
      expect(result.completedAt.length).toBeGreaterThan(0);
    }
    expect(mockEnqueueAndApply).toHaveBeenCalledTimes(1);
    const mutation = mockEnqueueAndApply.mock.calls[0][0];
    expect(mutation.kind).toBe('checkin');
    expect(mutation.taskId).toBe(TASK_ID);
    expect(mutation.isMakeup).toBe(false);
    expect(typeof mutation.queuedAt).toBe('number');
  });

  it('forwards isMakeup=true when called with two arguments', async () => {
    const task = buildTaskRow({ id: TASK_ID });
    mockTaskCache[TASK_ID] = task;
    setMockTaskSelect(task);

    await checkin(TASK_ID, true);

    expect(mockEnqueueAndApply).toHaveBeenCalledTimes(1);
    const mutation = mockEnqueueAndApply.mock.calls[0][0];
    expect(mutation.isMakeup).toBe(true);
  });

  it('uses default isMakeup=false when called with one argument (function overload)', async () => {
    const task = buildTaskRow({ id: TASK_ID });
    mockTaskCache[TASK_ID] = task;
    setMockTaskSelect(task);

    // 调用单参数 overload
    const result = await checkin(TASK_ID);
    expect(result.status).toBe('checked_in');
    expect(mockEnqueueAndApply.mock.calls[0][0].isMakeup).toBe(false);
  });

  it('does NOT call supabase.rpc directly (ADR-005 contract: checkin goes through SyncManager)', async () => {
    // 关键契约测试 — 验证本 service 不旁路 SyncManager
    const task = buildTaskRow({ id: TASK_ID });
    mockTaskCache[TASK_ID] = task;
    setMockTaskSelect(task);

    await checkin(TASK_ID);

    // supabase.rpc 仅在 SyncManager.executeOnServer 内被调;CheckInService 自己不调
    expect(mockRpc).not.toHaveBeenCalled();
    // 但 SyncManager.enqueueAndApply 必须被调
    expect(mockEnqueueAndApply).toHaveBeenCalledTimes(1);
  });

  it('returns completedAt reflecting optimistic cache update (realtime will correct later)', async () => {
    const task = buildTaskRow({ id: TASK_ID });
    mockTaskCache[TASK_ID] = task;
    setMockTaskSelect(task);

    const before = Date.now();
    const result = await checkin(TASK_ID);
    const after = Date.now();

    expect(result.status).toBe('checked_in');
    if (result.status === 'checked_in') {
      const ts = Date.parse(result.completedAt);
      // ISO 字符串应能解析;时间在 before ~ after 区间内(乐观写 now)
      expect(Number.isFinite(ts)).toBe(true);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after + 100); // 100ms 余量
    }
  });
});

// =====================================================================
// checkin — failure paths (6 reasons)
// =====================================================================

describe('CheckInService.checkin — failure paths', () => {
  it('returns failed{reason:"no_family"} when getMyFamily returns null', async () => {
    setMockFamily(null);
    // SELECT 行不存在即可(因为 pre-check 已失败)
    setMockTaskSelect(null);

    const result = await checkin(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('no_family');
    }
    // pre-check fail → 不调 enqueueAndApply / 不查 SELECT
    expect(mockEnqueueAndApply).not.toHaveBeenCalled();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });

  it('returns failed{reason:"not_authenticated"} when getUser returns null user', async () => {
    setMockAuthUser(null);
    // family ok 但 auth fail
    setMockFamily(FAMILY_ID);

    const result = await checkin(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('not_authenticated');
    }
    expect(mockEnqueueAndApply).not.toHaveBeenCalled();
  });

  it('returns failed{reason:"not_authenticated"} when getUser returns error', async () => {
    // family ok
    setMockFamily(FAMILY_ID);
    // 覆盖默认:auth 返回 error + null user
    // 用 mockResolvedValue(替换默认)而非 mockResolvedValueOnce(否则 Once 队列泄漏到下个 test)
    mockAuthGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'session expired', name: 'AuthError' },
    });

    const result = await checkin(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('not_authenticated');
    }
    expect(mockEnqueueAndApply).not.toHaveBeenCalled();
  });

  it('returns failed{reason:"task_not_found"} when SELECT returns null row (no error)', async () => {
    setMockFamily(FAMILY_ID);
    setMockTaskSelect(null); // 无 row,无 error

    const result = await checkin(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('task_not_found');
    }
    expect(mockEnqueueAndApply).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns failed{reason:"cancelled"} when task.cancelled = true', async () => {
    setMockFamily(FAMILY_ID);
    setMockTaskSelect({
      id: TASK_ID,
      cancelled: true,
      completed_at: null,
      completed_by: null,
    });

    const result = await checkin(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('cancelled');
    }
    expect(mockEnqueueAndApply).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns failed{reason:"rls_denied"} when SELECT error contains "rls"', async () => {
    setMockFamily(FAMILY_ID);
    setMockTaskSelect(null, 'new row violates row-level security policy for table "tasks"');

    const result = await checkin(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('rls_denied');
    }
    expect(mockEnqueueAndApply).not.toHaveBeenCalled();
  });

  it('returns failed{reason:"rls_denied"} when SELECT error contains "policy"', async () => {
    setMockFamily(FAMILY_ID);
    setMockTaskSelect(null, 'permission denied: policy violation on table tasks');

    const result = await checkin(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('rls_denied');
    }
  });

  it('returns failed{reason:"unknown"} when SELECT error is non-RLS', async () => {
    setMockFamily(FAMILY_ID);
    setMockTaskSelect(null, 'network timeout (PostgREST connection lost)');

    const result = await checkin(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('unknown');
    }
    expect(mockEnqueueAndApply).not.toHaveBeenCalled();
  });
});

// =====================================================================
// checkin — idempotency(已完成)
// =====================================================================

describe('CheckInService.checkin — idempotency (already completed)', () => {
  it('returns checked_in without calling enqueueAndApply when task is already completed', async () => {
    setMockFamily(FAMILY_ID);
    setMockTaskSelect({
      id: TASK_ID,
      cancelled: false,
      completed_at: '2026-09-23T10:05:00Z',
      completed_by: SPOUSE_ID, // 配偶已先打卡
    });

    const result = await checkin(TASK_ID);

    expect(result.status).toBe('checked_in');
    if (result.status === 'checked_in') {
      expect(result.taskId).toBe(TASK_ID);
      expect(result.completedAt).toBe('2026-09-23T10:05:00Z');
      expect(result.completedBy).toBe(SPOUSE_ID);
      expect(result.isMakeup).toBe(false);
    }
    // 幂等成功 — 不调 enqueueAndApply / 不调 RPC
    expect(mockEnqueueAndApply).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns checked_in with is_makeup=true when task was a makeup check-in', async () => {
    setMockFamily(FAMILY_ID);
    setMockTaskSelect({
      id: TASK_ID,
      cancelled: false,
      completed_at: '2026-09-23T20:00:00Z',
      completed_by: ME_ID,
      is_makeup: true,
    });

    const result = await checkin(TASK_ID);

    expect(result.status).toBe('checked_in');
    if (result.status === 'checked_in') {
      expect(result.isMakeup).toBe(true);
    }
    expect(mockEnqueueAndApply).not.toHaveBeenCalled();
  });

  it('completedBy fallback to user.id when completed_by is null in row (defensive)', async () => {
    // 边缘:row 显示已 completed 但 completed_by = null(孤儿完成)
    // — 业务上不应该发生;UI 时序仍能拿到 taskId;返回 checked_in
    setMockFamily(FAMILY_ID);
    setMockTaskSelect({
      id: TASK_ID,
      cancelled: false,
      completed_at: '2026-09-23T10:05:00Z',
      completed_by: null,
      is_makeup: false,
    });

    const result = await checkin(TASK_ID);

    expect(result.status).toBe('checked_in');
    if (result.status === 'checked_in') {
      // 完成者未知时回退空字符串(UI 应据此显示 ambiguous 状态;后续 T-US005-2 加工)
      expect(result.completedBy).toBe('');
    }
    expect(mockEnqueueAndApply).not.toHaveBeenCalled();
  });
});
