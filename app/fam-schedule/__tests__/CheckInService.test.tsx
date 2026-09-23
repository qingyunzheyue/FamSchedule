/**
 * CheckInService 单元测试 — T-US005-1 + T-US005-2
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
 *   **T-US005-2 新增** — 0 行处理 / 配偶先完成:
 *     11. happy (我先完成):refetch 显示 completed_by === currentUserId → checked_in
 *     12. spouse 先完成:refetch 显示 completed_by !== currentUserId → spouse_completed
 *     13. refetch 失败 (network err):fallback 到乐观 checked_in(不弹错)
 *     14. ADR-005 contract 在 spouse_completed path 也守住(supabase.rpc never called)
 *     15. failure 路径下不调 refetch(节省 — pre-check 失败 / 幂等都早 return)
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
 *
 * ⚠️ T-US005-2 sleep(500) 实打实跑(约 500ms / 测试)— 5 个新测试共 ~2.5s 额外耗时;
 *    可接受。jest fake timer 会破坏 Promise.setTimeout 协同,放弃用 fake timer。
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

import { checkin, undoCheckin, _resetForTests } from '../src/services/CheckInService';
import { UNDO_WINDOW_MS } from '../src/lib/checkIn';

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

  it('T-US005-2: performs refetch SELECT after enqueueAndApply (sleep + SELECT round-trip)', async () => {
    const task = buildTaskRow({ id: TASK_ID });
    mockTaskCache[TASK_ID] = task;
    setMockTaskSelect(task);

    await checkin(TASK_ID);

    // 验证 refetch SELECT 确实发生:supabase.from('tasks').select(...).maybeSingle() 至少 2 次
    // (1 次 pre-check + 1 次 refetch)
    expect(mockSupabaseFrom).toHaveBeenCalledWith('tasks');
    // 调用次数:buildTaskRow 的 mockset + maybeSingle calls — 这里只校验 .from('tasks') 被调过多次
    const fromCalls = mockSupabaseFrom.mock.calls.filter(
      ([t]: [string]) => t === 'tasks',
    );
    expect(fromCalls.length).toBeGreaterThanOrEqual(2); // 至少 pre-check + refetch
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

// =====================================================================
// T-US005-2: 0 行处理 / spouse_completed path
// =====================================================================
//
// 设计动机:服务端 RPC `checkin_task` 在配偶已 first-finisher 时返回 0 行
// (ADR-005 first-finisher wins),SyncManager.executeOnServer 对 0 行 result 静默
// 通过(line 512-521)。CheckInService 在 enqueueAndApply 后 sleep(500) + 单 task
// refetch 主动确认 RPC 结果,区分 checked_in(我先)vs spouse_completed(配偶先)。
//
// 关键约束:
//   - ADR-005 contract 仍守住:CheckInService 不直接 supabase.rpc(走 SyncManager + SELECT refetch)
//   - refetch 失败 → fallback 乐观 checked_in(Realtime channel 兜底)
//   - 5 种 reason × task title 边界覆盖到 happy / spouse / refetch fail / ADR-005 / 不调 refetch
// =====================================================================

/**
 * 配置 tasks SELECT 的 2 次响应(pre-check + T-US005-2 refetch)。
 *
 * 与 setMockTaskSelect(单响应 — 用于 pre-check 失败 / 幂等早 return 路径)
 * 区别:本 helper 用 mockResolvedValueOnce 链式排队,确保 1 次调用 = 1 次响应。
 *
 * @param preCheck     — pre-check SELECT 返回的 row data(null = task_not_found)
 * @param preCheckError — pre-check SELECT error message(不传 = 无 error)
 * @param refetch      — T-US005-2 refetch SELECT 返回的 row data(null = 不存在)
 * @param refetchError  — refetch SELECT error message(不传 = 无 error)
 */
function setMockTaskSelectWithRefetch(
  preCheck: Partial<import('../src/types/database').TaskRow> | null,
  refetch: Partial<import('../src/types/database').TaskRow> | null,
  preCheckError?: string | null,
  refetchError?: string | null,
): void {
  const builder = makeQueryBuilder();
  // 1st: pre-check
  builder.maybeSingle.mockResolvedValueOnce(
    preCheckError
      ? { data: null, error: { message: preCheckError } }
      : {
          data: preCheck
            ? {
                id: preCheck.id ?? TASK_ID,
                cancelled: preCheck.cancelled ?? false,
                completed_at: preCheck.completed_at ?? null,
                completed_by: preCheck.completed_by ?? null,
                is_makeup: preCheck.is_makeup ?? false,
              }
            : null,
          error: null,
        },
  );
  // 2nd: refetch(无 cancelled — refetch 不查 cancelled)
  builder.maybeSingle.mockResolvedValueOnce(
    refetchError
      ? { data: null, error: { message: refetchError } }
      : {
          data: refetch
            ? {
                id: refetch.id ?? TASK_ID,
                completed_at: refetch.completed_at ?? null,
                completed_by: refetch.completed_by ?? null,
                is_makeup: refetch.is_makeup ?? false,
              }
            : null,
          error: null,
        },
  );
  mockSupabaseFrom.mockImplementation((t: string) =>
    t === 'tasks' ? builder : makeQueryBuilder(),
  );
}

describe('CheckInService.checkin — T-US005-2 spouse_completed (0 行 RPC 返回处理)', () => {
  it('returns checked_in when refetch shows completed_by === currentUserId (我先完成)', async () => {
    // Happy refetch:配偶未先 → server RPC 写入 current user → refetch 看到我
    const task = buildTaskRow({ id: TASK_ID });
    mockTaskCache[TASK_ID] = task;
    const refetchCompletedAt = '2026-09-23T10:35:00Z';
    setMockTaskSelectWithRefetch(
      { id: TASK_ID, cancelled: false, completed_at: null, completed_by: null, is_makeup: false }, // pre-check: 未完成
      { id: TASK_ID, completed_at: refetchCompletedAt, completed_by: ME_ID, is_makeup: false },     // refetch: 我完成
    );

    const result = await checkin(TASK_ID);

    expect(result.status).toBe('checked_in');
    if (result.status === 'checked_in') {
      expect(result.taskId).toBe(TASK_ID);
      expect(result.completedAt).toBe(refetchCompletedAt);
      expect(result.completedBy).toBe(ME_ID);
      expect(result.isMakeup).toBe(false);
    }
    // ADR-005 contract 守住
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockEnqueueAndApply).toHaveBeenCalledTimes(1);
  });

  it('returns spouse_completed when refetch shows completed_by !== currentUserId (配偶先完成)', async () => {
    // 核心 T-US005-2 case:RPC 0 行 → refetch 显示 spouse 已 first-finisher
    const task = buildTaskRow({ id: TASK_ID });
    mockTaskCache[TASK_ID] = task;
    const spouseCompletedAt = '2026-09-23T10:30:00Z';
    setMockTaskSelectWithRefetch(
      { id: TASK_ID, cancelled: false, completed_at: null, completed_by: null, is_makeup: false }, // pre-check: 未完成
      { id: TASK_ID, completed_at: spouseCompletedAt, completed_by: SPOUSE_ID, is_makeup: false }, // refetch: 配偶先完成
    );

    const result = await checkin(TASK_ID);

    expect(result.status).toBe('spouse_completed');
    if (result.status === 'spouse_completed') {
      expect(result.taskId).toBe(TASK_ID);
      expect(result.completedAt).toBe(spouseCompletedAt);
      expect(result.completedBy).toBe(SPOUSE_ID);
    }
    // spouse_completed path — ADR-005 contract 仍守住
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockEnqueueAndApply).toHaveBeenCalledTimes(1);
  });

  it('returns checked_in (fallback) when refetch SELECT fails with network error', async () => {
    // 网络断/超时 → refetch 失败 → fallback 乐观 checked_in(Realtime 兜底)
    const task = buildTaskRow({ id: TASK_ID });
    mockTaskCache[TASK_ID] = task;
    setMockTaskSelectWithRefetch(
      { id: TASK_ID, cancelled: false, completed_at: null, completed_by: null, is_makeup: false },
      null,
      null,
      'network timeout (PostgREST connection lost)',
    );

    const result = await checkin(TASK_ID);

    expect(result.status).toBe('checked_in');
    if (result.status === 'checked_in') {
      expect(result.taskId).toBe(TASK_ID);
      // completedAt 来自 optimistic cache(由 mock 的 enqueueAndApply 写入)
      expect(result.completedAt).not.toBeNull();
      expect(typeof result.completedAt).toBe('string');
    }
    // ADR-005 contract 守住
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockEnqueueAndApply).toHaveBeenCalledTimes(1);
  });

  it('returns checked_in (fallback) when refetch SELECT returns null row (race / cache miss)', async () => {
    // 防御:refetch 返 null row(理论上不发生)→ fallback 乐观 success
    const task = buildTaskRow({ id: TASK_ID });
    mockTaskCache[TASK_ID] = task;
    setMockTaskSelectWithRefetch(
      { id: TASK_ID, cancelled: false, completed_at: null, completed_by: null, is_makeup: false },
      null, // refetch null row
    );

    const result = await checkin(TASK_ID);

    expect(result.status).toBe('checked_in');
    if (result.status === 'checked_in') {
      expect(result.taskId).toBe(TASK_ID);
      expect(typeof result.completedAt).toBe('string');
    }
  });

  it('preserves ADR-005 contract in spouse_completed path (supabase.rpc never called)', async () => {
    // 关键 ADR-005 契约断言:spouse_completed path 也绝不直接调 supabase.rpc
    // — CheckInService 通过 SyncManager.enqueueAndApply + SELECT refetch 完成所有 RPC/SELECT
    const task = buildTaskRow({ id: TASK_ID });
    mockTaskCache[TASK_ID] = task;
    setMockTaskSelectWithRefetch(
      { id: TASK_ID, cancelled: false, completed_at: null, completed_by: null, is_makeup: false },
      { id: TASK_ID, completed_at: '2026-09-23T10:30:00Z', completed_by: SPOUSE_ID, is_makeup: false },
    );

    await checkin(TASK_ID);

    // 整个测试期间 supabase.rpc 一次都不被 CheckInService 调用
    expect(mockRpc).not.toHaveBeenCalled();
    // SyncManager.enqueueAndApply 必须被调 1 次(走 mutation queue)
    expect(mockEnqueueAndApply).toHaveBeenCalledTimes(1);
    // 验证 .from('tasks') 至少 2 次(pre-check + refetch SELECT)
    const fromTasksCalls = mockSupabaseFrom.mock.calls.filter(
      ([t]: [string]) => t === 'tasks',
    );
    expect(fromTasksCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT call refetch when pre-check fails (no_family path returns early)', async () => {
    // 性能/简洁:pre-check 失败时不应再做 refetch(节省网络往返)
    setMockFamily(null);
    // pre-check 不需要 mock(因为 no_family 在 pre-check 之前返回)
    // 但保险起见,设置一个永远不用的 SELECT mock

    const result = await checkin(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('no_family');
    }
    // enqueueAndApply + refetch SELECT 都不会被调
    expect(mockEnqueueAndApply).not.toHaveBeenCalled();
    // .from('tasks') 0 次(no_family 早 return)
    const fromTasksCalls = mockSupabaseFrom.mock.calls.filter(
      ([t]: [string]) => t === 'tasks',
    );
    expect(fromTasksCalls.length).toBe(0);
  });

  it('does NOT call refetch when pre-check detects task already completed (idempotent early return)', async () => {
    // 幂等:task 已 completed → 早 return,不走 enqueueAndApply 也不走 refetch
    setMockFamily(FAMILY_ID);
    setMockTaskSelect({
      id: TASK_ID,
      cancelled: false,
      completed_at: '2026-09-23T10:05:00Z',
      completed_by: SPOUSE_ID, // 配偶已先打卡
    });

    const result = await checkin(TASK_ID);

    expect(result.status).toBe('checked_in');
    expect(mockEnqueueAndApply).not.toHaveBeenCalled();
    // .from('tasks') 只 1 次(pre-check SELECT — 之后早 return)
    const fromTasksCalls = mockSupabaseFrom.mock.calls.filter(
      ([t]: [string]) => t === 'tasks',
    );
    expect(fromTasksCalls.length).toBe(1);
  });

  it('does NOT call refetch when pre-check fails for task_not_found', async () => {
    setMockFamily(FAMILY_ID);
    setMockTaskSelect(null); // pre-check: row 不存在 → task_not_found

    const result = await checkin(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('task_not_found');
    }
    expect(mockEnqueueAndApply).not.toHaveBeenCalled();
    // .from('tasks') 只 1 次(pre-check)
    const fromTasksCalls = mockSupabaseFrom.mock.calls.filter(
      ([t]: [string]) => t === 'tasks',
    );
    expect(fromTasksCalls.length).toBe(1);
  });
});

// =====================================================================
// T-US005-3: undoCheckin — 撤销打卡(5 分钟内)
// =====================================================================
//
// 设计动机(任务 brief §A-7 + 设计 task-detail-v1.0 §3.3):
//   - 允许用户 5 分钟内反悔(误打卡 / 替配偶打卡后悔)
//   - 走 SyncManager.enqueueAndApply(ADR-005 contract 守住)
//   - 预读 task state 校验 → not_owner / task_not_checked_in / undo_window_expired
//   - 失败原因 8 种 → Alert 弹"撤销失败" + mapUndoCheckInFailureReason 翻译
//
// 关键约束:
//   - **ADR-005 contract**:Test 必须显式 `expect(mockRpc).not.toHaveBeenCalled()`
//     守住 undo 路径不旁路 SyncManager(同 checkin 测试模式)
//   - pre-check 6 字段:id, created_by, completed_at, completed_by, cancelled
//   - refetch 2 字段:id, completed_at
//
// 覆盖范围(~10 cases):
//   - happy path:refetch shows completed_at=null → undone
//   - 失败 7 种:not_authenticated / no_family / task_not_found / not_owner /
//     task_not_checked_in / undo_window_expired / rls_denied / unknown
//   - ADR-005 contract 守卫
//   - refetch 失败 fallback 到 optimistic undone

/**
 * 配置 undoCheckin 的 SELECT 响应序列:
 *   - 1st: pre-check(5-字段 row: id, created_by, completed_at, completed_by, cancelled)
 *   - 2nd: refetch(2-字段 row: id, completed_at)
 */
function setMockUndoSelectWithRefetch(
  preCheck: {
    id?: string;
    created_by?: string;
    cancelled?: boolean;
    completed_at?: string | null;
    completed_by?: string | null;
  } | null,
  refetch: {
    id?: string;
    completed_at?: string | null;
  } | null,
  preCheckError?: string | null,
  refetchError?: string | null,
): void {
  const builder = makeQueryBuilder();
  builder.maybeSingle.mockResolvedValueOnce(
    preCheckError
      ? { data: null, error: { message: preCheckError } }
      : {
          data: preCheck
            ? {
                id: preCheck.id ?? TASK_ID,
                created_by: preCheck.created_by ?? ME_ID,
                cancelled: preCheck.cancelled ?? false,
                completed_at: preCheck.completed_at ?? null,
                completed_by: preCheck.completed_by ?? null,
              }
            : null,
          error: null,
        },
  );
  builder.maybeSingle.mockResolvedValueOnce(
    refetchError
      ? { data: null, error: { message: refetchError } }
      : {
          data: refetch
            ? {
                id: refetch.id ?? TASK_ID,
                completed_at: refetch.completed_at ?? null,
              }
            : null,
          error: null,
        },
  );
  mockSupabaseFrom.mockImplementation((t: string) =>
    t === 'tasks' ? builder : makeQueryBuilder(),
  );
}

/**
 * 默认测试 fixture:任务已 by ME 完成,completed_at = now - 1min(5 分钟内可撤销)。
 */
function setupUndoHappyFixture(): void {
  setMockFamily(FAMILY_ID);
  // completedAt = 1 分钟前(< UNDO_WINDOW_MS)
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
  setMockUndoSelectWithRefetch(
    {
      id: TASK_ID,
      created_by: ME_ID,
      cancelled: false,
      completed_at: oneMinuteAgo,
      completed_by: ME_ID,
    },
    { id: TASK_ID, completed_at: null },
  );
}

describe('CheckInService.undoCheckin — happy path (T-US005-3)', () => {
  it('returns undone when refetch shows completed_at = null', async () => {
    setupUndoHappyFixture();

    const result = await undoCheckin(TASK_ID);

    expect(result.status).toBe('undone');
    if (result.status === 'undone') {
      expect(result.taskId).toBe(TASK_ID);
    }
  });

  it('enqueues undo_checkin mutation with correct shape', async () => {
    setupUndoHappyFixture();

    await undoCheckin(TASK_ID);

    expect(mockEnqueueAndApply).toHaveBeenCalledTimes(1);
    const mutation = mockEnqueueAndApply.mock.calls[0][0];
    expect(mutation.kind).toBe('undo_checkin');
    expect(mutation.taskId).toBe(TASK_ID);
    expect(typeof mutation.queuedAt).toBe('number');
  });

  it('preserves ADR-005 contract: supabase.rpc NEVER called by undoCheckin', async () => {
    setupUndoHappyFixture();

    await undoCheckin(TASK_ID);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockEnqueueAndApply).toHaveBeenCalledTimes(1);
  });

  it('performs pre-check + refetch SELECT round-trip (2 calls to from("tasks"))', async () => {
    setupUndoHappyFixture();

    await undoCheckin(TASK_ID);

    const fromTasksCalls = mockSupabaseFrom.mock.calls.filter(
      ([t]: [string]) => t === 'tasks',
    );
    expect(fromTasksCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to undone when refetch returns completed_at (race — 配偶重新打卡 after 撤销)', async () => {
    // 防御:refetch 显示 completed_at !== null(race / spouse 重新打卡)— 仍返回 undone
    // 让 UI 切回 todo,Realtime 后续推送会自动收敛
    setMockFamily(FAMILY_ID);
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    setMockUndoSelectWithRefetch(
      {
        id: TASK_ID,
        created_by: ME_ID,
        cancelled: false,
        completed_at: oneMinuteAgo,
        completed_by: ME_ID,
      },
      // refetch 显示又有 completed_at(被 spouse 抢回)
      { id: TASK_ID, completed_at: '2026-09-23T10:45:00Z' },
    );

    const result = await undoCheckin(TASK_ID);

    expect(result.status).toBe('undone');
  });
});

describe('CheckInService.undoCheckin — failure paths (T-US005-3, 8 reasons)', () => {
  it('returns failed{reason:"no_family"} when getMyFamily returns null', async () => {
    setMockFamily(null);

    const result = await undoCheckin(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('no_family');
    }
    expect(mockEnqueueAndApply).not.toHaveBeenCalled();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });

  it('returns failed{reason:"not_authenticated"} when getUser returns null user', async () => {
    setMockAuthUser(null);
    setMockFamily(FAMILY_ID);

    const result = await undoCheckin(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('not_authenticated');
    }
    expect(mockEnqueueAndApply).not.toHaveBeenCalled();
  });

  it('returns failed{reason:"task_not_found"} when SELECT returns null row', async () => {
    setMockFamily(FAMILY_ID);
    setMockUndoSelectWithRefetch(null, null);

    const result = await undoCheckin(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('task_not_found');
    }
    expect(mockEnqueueAndApply).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns failed{reason:"task_not_checked_in"} when completed_at is null', async () => {
    setMockFamily(FAMILY_ID);
    setMockUndoSelectWithRefetch(
      {
        id: TASK_ID,
        created_by: ME_ID,
        cancelled: false,
        completed_at: null, // 没打卡
        completed_by: null,
      },
      null,
    );

    const result = await undoCheckin(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('task_not_checked_in');
    }
    expect(mockEnqueueAndApply).not.toHaveBeenCalled();
  });

  it('returns failed{reason:"not_owner"} when completed_by !== currentUserId (配偶完成的任务)', async () => {
    setMockFamily(FAMILY_ID);
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    setMockUndoSelectWithRefetch(
      {
        id: TASK_ID,
        created_by: ME_ID,
        cancelled: false,
        completed_at: oneMinuteAgo,
        completed_by: SPOUSE_ID, // 配偶完成
      },
      null,
    );

    const result = await undoCheckin(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('not_owner');
    }
    expect(mockEnqueueAndApply).not.toHaveBeenCalled();
  });

  it('returns failed{reason:"not_owner"} when completed_by = null (orphan completion)', async () => {
    // 防御:completed_at 非 null + completed_by = null(孤儿完成)— fail-closed,不让自己撤销
    setMockFamily(FAMILY_ID);
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    setMockUndoSelectWithRefetch(
      {
        id: TASK_ID,
        created_by: ME_ID,
        cancelled: false,
        completed_at: oneMinuteAgo,
        completed_by: null,
      },
      null,
    );

    const result = await undoCheckin(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('not_owner');
    }
  });

  it('returns failed{reason:"undo_window_expired"} when elapsed > 5 minutes', async () => {
    setMockFamily(FAMILY_ID);
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    setMockUndoSelectWithRefetch(
      {
        id: TASK_ID,
        created_by: ME_ID,
        cancelled: false,
        completed_at: sixMinutesAgo,
        completed_by: ME_ID,
      },
      null,
    );

    const result = await undoCheckin(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('undo_window_expired');
    }
    expect(mockEnqueueAndApply).not.toHaveBeenCalled();
  });

  it('returns failed{reason:"undo_window_expired"} at boundary elapsed = UNDO_WINDOW_MS + 1ms', async () => {
    // 边界:elapsed > UNDO_WINDOW_MS 触发过期
    setMockFamily(FAMILY_ID);
    const justExpired = new Date(Date.now() - UNDO_WINDOW_MS - 1).toISOString();
    setMockUndoSelectWithRefetch(
      {
        id: TASK_ID,
        created_by: ME_ID,
        cancelled: false,
        completed_at: justExpired,
        completed_by: ME_ID,
      },
      null,
    );

    const result = await undoCheckin(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('undo_window_expired');
    }
  });

  it('allows undo at boundary elapsed = UNDO_WINDOW_MS - 1ms (still within window)', async () => {
    // 边界:elapsed < UNDO_WINDOW_MS 仍可撤销
    setMockFamily(FAMILY_ID);
    const stillValid = new Date(Date.now() - (UNDO_WINDOW_MS - 1)).toISOString();
    setMockUndoSelectWithRefetch(
      {
        id: TASK_ID,
        created_by: ME_ID,
        cancelled: false,
        completed_at: stillValid,
        completed_by: ME_ID,
      },
      { id: TASK_ID, completed_at: null },
    );

    const result = await undoCheckin(TASK_ID);

    expect(result.status).toBe('undone');
  });

  it('returns failed{reason:"rls_denied"} when SELECT error contains "rls"', async () => {
    setMockFamily(FAMILY_ID);
    setMockUndoSelectWithRefetch(
      null,
      null,
      'new row violates row-level security policy for table "tasks"',
    );

    const result = await undoCheckin(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('rls_denied');
    }
    expect(mockEnqueueAndApply).not.toHaveBeenCalled();
  });

  it('returns failed{reason:"unknown"} when SELECT error is non-RLS', async () => {
    setMockFamily(FAMILY_ID);
    setMockUndoSelectWithRefetch(
      null,
      null,
      'network timeout (PostgREST connection lost)',
    );

    const result = await undoCheckin(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('unknown');
    }
  });

  it('falls back to optimistic undone when refetch SELECT fails with network error', async () => {
    // T-US005-3:refetch 失败(network err)→ fallback 乐观 undone(Realtime 兜底)
    setMockFamily(FAMILY_ID);
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    setMockUndoSelectWithRefetch(
      {
        id: TASK_ID,
        created_by: ME_ID,
        cancelled: false,
        completed_at: oneMinuteAgo,
        completed_by: ME_ID,
      },
      null,
      null,
      'network timeout (PostgREST connection lost)',
    );

    const result = await undoCheckin(TASK_ID);

    expect(result.status).toBe('undone');
    if (result.status === 'undone') {
      expect(result.taskId).toBe(TASK_ID);
    }
    // ADR-005 contract 仍守住(refetch fail ≠ 直接调 rpc,只是 fallback 乐观 success)
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockEnqueueAndApply).toHaveBeenCalledTimes(1);
  });
});
