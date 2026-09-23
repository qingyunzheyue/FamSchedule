/**
 * TaskService 单元测试 — T-US001-1
 *
 * 覆盖范围(任务 DoD + 关键边界):
 *
 *   createTask 主流程:
 *     1. happy path:返回 {status:'created', task: TaskRow}
 *     2. INSERT payload 字段完整性:family_id / title / task_date / task_time /
 *        assignee_id / created_by / template_id / co_executor_ids /
 *        is_shared_view / description
 *     3. template_id 必须为 null(一次性任务,ADR-003)
 *     4. co_executor_ids 必须为 [] (本期固定空数组,US-009 后续)
 *     5. 可空字段处理:taskTime=null / description=null / isSharedView=false
 *
 *   createTask 失败路径:
 *     6. pre-check 失败:getMyFamily 返回 null → failed{reason:'no_family'}
 *     7. auth 失败:getUser 返回 error → failed{reason:'not_authenticated'}
 *     8. insert 抛错 → failed{reason: error.message}
 *     9. insert 返回 null data(防御性兜底)→ failed{reason:'no data'}
 *
 *   _resetForTests:
 *     10. 不抛错,清空(noop 但接口对齐)
 *
 *   TaskService namespace:
 *     11. TaskService.createTask 与命名 export 同一函数引用
 *
 * Mock 策略:
 *   - supabase 整个 mock(mockRpc / mockFrom / mockAuthGetUser)
 *   - 沿用 FamilyService.test.ts 同套 from() builder 模式
 *   - 关键差异:TaskService 的 insert() 链尾是 .select().single() 而不是
 *     .maybeSingle()(server 总是生成 row)
 */

// ---- Mocks (必须在 import TaskService 之前) ----------------------------

let mockRpc: jest.Mock;
let mockAuthGetUser: jest.Mock;
let mockSupabaseFrom: jest.Mock;

function mockMakeQueryBuilder(): {
  select: jest.Mock;
  eq: jest.Mock;
  maybeSingle: jest.Mock;
  single: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  then: jest.Mock;
} {
  const builder: {
    select: jest.Mock;
    eq: jest.Mock;
    maybeSingle: jest.Mock;
    single: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    then: jest.Mock;
  } = {
    select: jest.fn(),
    eq: jest.fn(),
    maybeSingle: jest.fn(),
    single: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    then: jest.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue({ data: null, error: null });
  builder.single.mockResolvedValue({ data: null, error: null });
  builder.insert.mockReturnValue(builder);
  builder.update.mockReturnValue(builder);
  builder.delete.mockReturnValue(builder);
  // 默认 await builder → {data: null, error: null}(thenable)
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

// ---- Imports (mock 之后) ----------------------------------------------

import {
  TaskService,
  createTask,
  updateTask,
  deleteTask,
  _resetForTests,
} from '../src/services/TaskService';

// ---- Test fixtures ----------------------------------------------------

const FAMILY_ID = 'family-uuid-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CREATOR_ID = 'creator-uuid-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SPOUSE_ID = 'spouse-uuid-cccc-cccc-cccc-cccccccccccc';

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

/**
 * Helper:覆盖某张表的 from() 返回结果(单次配置)。
 *
 * 不指定 table 时所有 from() 调用都走同一个 builder。
 */
function setMockFromBuilder(
  table: string | '*',
  builder: ReturnType<typeof mockMakeQueryBuilder>,
): void {
  if (table === '*') {
    mockSupabaseFrom.mockImplementation(() => builder);
  } else {
    mockSupabaseFrom.mockImplementation((t: string) =>
      t === table ? builder : mockMakeQueryBuilder(),
    );
  }
}

/**
 * 给 createTask 构造一个"pre-check 通过 → tasks.insert 成功"的 happy-path 链路。
 *
 * 第 1-3 次 from() 调用 = getMyFamily 内部(family_members / families / family_members);
 * 第 4 次 from() = createTask 的 tasks.insert。
 */
function setupHappyPath(insertedRow: Record<string, unknown>): {
  insertPayloadSpy: jest.Mock;
} {
  const insertPayloadSpy = jest.fn();

  const builderPreCheckMember = mockMakeQueryBuilder();
  builderPreCheckMember.maybeSingle.mockResolvedValue({
    data: { family_id: FAMILY_ID, user_id: CREATOR_ID, joined_at: '2026-09-01T00:00:00Z' },
    error: null,
  });

  const builderPreCheckFamily = mockMakeQueryBuilder();
  builderPreCheckFamily.single.mockResolvedValue({
    data: { id: FAMILY_ID, created_by: CREATOR_ID, created_at: '2026-09-01T00:00:00Z' },
    error: null,
  });

  const builderPreCheckMembers = mockMakeQueryBuilder();
  builderPreCheckMembers.then.mockImplementation(
    (onFulfilled: (v: { data: unknown; error: unknown }) => void) => {
      onFulfilled({
        data: [{ family_id: FAMILY_ID, user_id: CREATOR_ID, joined_at: '2026-09-01T00:00:00Z' }],
        error: null,
      });
      return Promise.resolve();
    },
  );

  const builderInsert = mockMakeQueryBuilder();
  builderInsert.insert.mockImplementation((p: Record<string, unknown>) => {
    insertPayloadSpy(p);
    return builderInsert;
  });
  builderInsert.single.mockResolvedValue({ data: insertedRow, error: null });

  const queue = [
    builderPreCheckMember,
    builderPreCheckFamily,
    builderPreCheckMembers,
    builderInsert,
  ];
  let i = 0;
  mockSupabaseFrom.mockImplementation(() => {
    const b = queue[i] ?? mockMakeQueryBuilder();
    i += 1;
    return b;
  });

  return { insertPayloadSpy };
}

// ---- beforeEach -------------------------------------------------------

beforeEach(() => {
  _resetForTests();
  jest.clearAllMocks();
  // 默认 from() 返回空 builder
  mockSupabaseFrom.mockImplementation(() => mockMakeQueryBuilder());
  // 默认 auth user = creator
  setMockAuthUser(CREATOR_ID);
});

// =====================================================================
// createTask — happy path
// =====================================================================

const sampleRow = {
  id: 'task-uuid-eeee-eeee-eeee-eeeeeeeeeeee',
  template_id: null,
  family_id: FAMILY_ID,
  title: '喂奶粉',
  description: null,
  task_date: '2026-09-22',
  task_time: '20:00',
  assignee_id: SPOUSE_ID,
  co_executor_ids: [],
  is_shared_view: false,
  created_by: CREATOR_ID,
  completed_at: null,
  completed_by: null,
  is_makeup: false,
  cancelled: false,
  created_at: '2026-09-22T10:00:00Z',
  updated_at: '2026-09-22T10:00:00Z',
};

describe('TaskService.createTask — happy path', () => {
  it('returns created{task} with full row echoed from server', async () => {
    setupHappyPath(sampleRow);

    const result = await createTask({
      title: '喂奶粉',
      taskDate: '2026-09-22',
      taskTime: '20:00',
      assigneeId: SPOUSE_ID,
    });

    expect(result.status).toBe('created');
    if (result.status === 'created') {
      expect(result.task.id).toBe('task-uuid-eeee-eeee-eeee-eeeeeeeeeeee');
      expect(result.task.title).toBe('喂奶粉');
      expect(result.task.task_date).toBe('2026-09-22');
      expect(result.task.task_time).toBe('20:00');
      expect(result.task.assignee_id).toBe(SPOUSE_ID);
      expect(result.task.family_id).toBe(FAMILY_ID);
      expect(result.task.created_by).toBe(CREATOR_ID);
      expect(result.task.template_id).toBeNull();
      expect(result.task.co_executor_ids).toEqual([]);
      expect(result.task.is_makeup).toBe(false);
      expect(result.task.cancelled).toBe(false);
    }
  });

  it('inserts payload with all required fields (family_id, title, task_date, task_time, assignee_id, created_by, template_id, co_executor_ids, is_shared_view, description)', async () => {
    const { insertPayloadSpy } = setupHappyPath(sampleRow);

    await createTask({
      title: '倒垃圾',
      taskDate: '2026-09-22',
      taskTime: null,
      assigneeId: CREATOR_ID,
    });

    expect(insertPayloadSpy).toHaveBeenCalledTimes(1);
    const payload = insertPayloadSpy.mock.calls[0][0];
    expect(payload.family_id).toBe(FAMILY_ID);
    expect(payload.title).toBe('倒垃圾');
    expect(payload.task_date).toBe('2026-09-22');
    expect(payload.task_time).toBeNull();
    expect(payload.assignee_id).toBe(CREATOR_ID);
    expect(payload.created_by).toBe(CREATOR_ID);
    expect(payload.template_id).toBeNull();
    expect(payload.co_executor_ids).toEqual([]);
    expect(payload.is_shared_view).toBe(false);
    expect(payload.description).toBeNull();
  });

  it('template_id is null in INSERT payload (ADR-003: one-off task)', async () => {
    const { insertPayloadSpy } = setupHappyPath(sampleRow);

    await createTask({ title: 't', taskDate: '2026-09-22', assigneeId: CREATOR_ID });

    expect(insertPayloadSpy.mock.calls[0][0].template_id).toBeNull();
  });

  it('co_executor_ids is [] in INSERT payload (本期固定,US-009 后续)', async () => {
    const { insertPayloadSpy } = setupHappyPath(sampleRow);

    await createTask({ title: 't', taskDate: '2026-09-22', assigneeId: CREATOR_ID });

    expect(insertPayloadSpy.mock.calls[0][0].co_executor_ids).toEqual([]);
  });

  it('description defaults to null when omitted', async () => {
    const { insertPayloadSpy } = setupHappyPath(sampleRow);

    // description 字段完全不传
    await createTask({ title: 't', taskDate: '2026-09-22', assigneeId: CREATOR_ID });

    expect(insertPayloadSpy.mock.calls[0][0].description).toBeNull();
  });

  it('description is forwarded when provided', async () => {
    const { insertPayloadSpy } = setupHappyPath(sampleRow);

    await createTask({
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
      description: '7 勺奶粉,150ml 温水',
    });

    expect(insertPayloadSpy.mock.calls[0][0].description).toBe('7 勺奶粉,150ml 温水');
  });

  it('isSharedView=true is forwarded when explicitly set', async () => {
    const { insertPayloadSpy } = setupHappyPath(sampleRow);

    await createTask({
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
      isSharedView: true,
    });

    expect(insertPayloadSpy.mock.calls[0][0].is_shared_view).toBe(true);
  });

  it('isSharedView defaults to false when omitted', async () => {
    const { insertPayloadSpy } = setupHappyPath(sampleRow);

    await createTask({ title: 't', taskDate: '2026-09-22', assigneeId: CREATOR_ID });

    expect(insertPayloadSpy.mock.calls[0][0].is_shared_view).toBe(false);
  });

  it('taskTime=null is forwarded as "not specified"', async () => {
    const { insertPayloadSpy } = setupHappyPath(sampleRow);

    await createTask({
      title: 't',
      taskDate: '2026-09-22',
      taskTime: null,
      assigneeId: CREATOR_ID,
    });

    expect(insertPayloadSpy.mock.calls[0][0].task_time).toBeNull();
  });

  it('taskTime="20:00" is forwarded as the literal time string', async () => {
    const { insertPayloadSpy } = setupHappyPath(sampleRow);

    await createTask({
      title: 't',
      taskDate: '2026-09-22',
      taskTime: '20:00',
      assigneeId: CREATOR_ID,
    });

    expect(insertPayloadSpy.mock.calls[0][0].task_time).toBe('20:00');
  });

  it('createTask normalizes empty taskTime="" to null (defensive guard, Major #1)', async () => {
    // 防御:即使 validateForm 漏拦(选了 am/pm),空串 "" 也不应泄漏到 Postgres TIME 列
    // (DB 会报 invalid input syntax for type time: "")
    const { insertPayloadSpy } = setupHappyPath(sampleRow);

    await createTask({
      title: 't',
      taskDate: '2026-09-22',
      taskTime: '',
      assigneeId: CREATOR_ID,
    });

    expect(insertPayloadSpy.mock.calls[0][0].task_time).toBeNull();
  });

  it('assigneeId=spouse is forwarded verbatim', async () => {
    const { insertPayloadSpy } = setupHappyPath(sampleRow);

    await createTask({ title: 't', taskDate: '2026-09-22', assigneeId: SPOUSE_ID });

    expect(insertPayloadSpy.mock.calls[0][0].assignee_id).toBe(SPOUSE_ID);
  });

  it('assigneeId=creator is forwarded verbatim', async () => {
    const { insertPayloadSpy } = setupHappyPath(sampleRow);

    await createTask({ title: 't', taskDate: '2026-09-22', assigneeId: CREATOR_ID });

    expect(insertPayloadSpy.mock.calls[0][0].assignee_id).toBe(CREATOR_ID);
  });

  it('family_id in payload equals family from getMyFamily', async () => {
    const { insertPayloadSpy } = setupHappyPath(sampleRow);

    await createTask({ title: 't', taskDate: '2026-09-22', assigneeId: CREATOR_ID });

    expect(insertPayloadSpy.mock.calls[0][0].family_id).toBe(FAMILY_ID);
  });
});

// =====================================================================
// createTask — failure paths
// =====================================================================

describe('TaskService.createTask — failure paths', () => {
  it('returns failed{reason:"no_family"} when getMyFamily returns null', async () => {
    // pre-check → family_members 查不到 row
    const builder = mockMakeQueryBuilder();
    builder.maybeSingle.mockResolvedValue({ data: null, error: null });
    setMockFromBuilder('family_members', builder);

    const result = await createTask({
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('no_family');
    }
    // 不应触发 tasks.insert
    const tasksCalls = mockSupabaseFrom.mock.calls.filter(
      (call: unknown[]) => call[0] === 'tasks',
    );
    expect(tasksCalls).toHaveLength(0);
  });

  it('returns failed{reason:"not_authenticated"} when getUser has error on second call', async () => {
    // pre-check 通过(getMyFamily 链路)
    setupHappyPath(sampleRow);

    // 第一次 getUser(getMyFamily 内部)→ 正常返回 creator;
    // 第二次 getUser(createTask 内部)→ 抛错
    // mockResolvedValueOnce 队列按 FIFO 消费。
    mockAuthGetUser.mockResolvedValueOnce({
      data: { user: { id: CREATOR_ID } },
      error: null,
    });
    mockAuthGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'session expired', name: 'AuthError' },
    });

    const result = await createTask({
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('not_authenticated');
    }
  });

  it('returns failed{reason:"not_authenticated"} when second getUser returns null user', async () => {
    setupHappyPath(sampleRow);
    mockAuthGetUser.mockResolvedValueOnce({
      data: { user: { id: CREATOR_ID } },
      error: null,
    });
    mockAuthGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    const result = await createTask({
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('not_authenticated');
    }
  });

  it('returns failed{reason: error.message} when insert returns error', async () => {
    setupHappyPath(sampleRow);
    // 覆盖最后一次 from() 的 builder 让其 single() 报错
    // setupHappyPath 已用完 4 次调用 — 我们需要重新构造链路:pre-check 通过 + tasks.insert 报错
    // 先重置 mock,再做一次 setup 但 tasks insert 抛错
    jest.clearAllMocks();
    _resetForTests();
    setMockAuthUser(CREATOR_ID);

    // pre-check 链
    const b1 = mockMakeQueryBuilder();
    b1.maybeSingle.mockResolvedValue({
      data: { family_id: FAMILY_ID, user_id: CREATOR_ID, joined_at: '2026-09-01T00:00:00Z' },
      error: null,
    });
    const b2 = mockMakeQueryBuilder();
    b2.single.mockResolvedValue({
      data: { id: FAMILY_ID, created_by: CREATOR_ID, created_at: '2026-09-01T00:00:00Z' },
      error: null,
    });
    const b3 = mockMakeQueryBuilder();
    b3.then.mockImplementation(
      (onFulfilled: (v: { data: unknown; error: unknown }) => void) => {
        onFulfilled({
          data: [{ family_id: FAMILY_ID, user_id: CREATOR_ID, joined_at: '2026-09-01T00:00:00Z' }],
          error: null,
        });
        return Promise.resolve();
      },
    );
    const bInsert = mockMakeQueryBuilder();
    bInsert.single.mockResolvedValue({
      data: null,
      error: { message: 'RLS violation: family_id not in my family', name: 'PostgrestError' },
    });

    const queue = [b1, b2, b3, bInsert];
    let i = 0;
    mockSupabaseFrom.mockImplementation(() => {
      const b = queue[i] ?? mockMakeQueryBuilder();
      i += 1;
      return b;
    });

    const result = await createTask({
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toContain('RLS violation');
    }
  });

  it('returns failed{reason:"no data"} when insert returns null data (defensive fallback)', async () => {
    setupHappyPath(sampleRow);
    // 覆盖 insert builder 让其 single() 返回 {data: null, error: null}
    jest.clearAllMocks();
    _resetForTests();
    setMockAuthUser(CREATOR_ID);

    const b1 = mockMakeQueryBuilder();
    b1.maybeSingle.mockResolvedValue({
      data: { family_id: FAMILY_ID, user_id: CREATOR_ID, joined_at: '2026-09-01T00:00:00Z' },
      error: null,
    });
    const b2 = mockMakeQueryBuilder();
    b2.single.mockResolvedValue({
      data: { id: FAMILY_ID, created_by: CREATOR_ID, created_at: '2026-09-01T00:00:00Z' },
      error: null,
    });
    const b3 = mockMakeQueryBuilder();
    b3.then.mockImplementation(
      (onFulfilled: (v: { data: unknown; error: unknown }) => void) => {
        onFulfilled({
          data: [{ family_id: FAMILY_ID, user_id: CREATOR_ID, joined_at: '2026-09-01T00:00:00Z' }],
          error: null,
        });
        return Promise.resolve();
      },
    );
    const bInsert = mockMakeQueryBuilder();
    bInsert.single.mockResolvedValue({ data: null, error: null });

    const queue = [b1, b2, b3, bInsert];
    let i = 0;
    mockSupabaseFrom.mockImplementation(() => {
      const b = queue[i] ?? mockMakeQueryBuilder();
      i += 1;
      return b;
    });

    const result = await createTask({
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toContain('no data');
    }
  });
});

// =====================================================================
// _resetForTests
// =====================================================================

describe('TaskService._resetForTests', () => {
  it('does not throw (no-op for current implementation, interface parity)', () => {
    expect(() => _resetForTests()).not.toThrow();
  });

  it('is callable multiple times in sequence', () => {
    expect(() => {
      _resetForTests();
      _resetForTests();
      _resetForTests();
    }).not.toThrow();
  });
});

// =====================================================================
// TaskService namespace sugar
// =====================================================================

describe('TaskService namespace', () => {
  it('TaskService.createTask is the same function reference as named export', () => {
    expect(TaskService.createTask).toBe(createTask);
  });

  it('TaskService.createTask works through namespace with same signature', async () => {
    setupHappyPath(sampleRow);

    const result = await TaskService.createTask({
      title: 'ns',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
    });

    expect(result.status).toBe('created');
    if (result.status === 'created') {
      // 注意:mock 返回的 row 来自 sampleRow(title='喂奶粉');
      // 真实 server 行为会 echo insert payload 字段,所以这里 task.title
      // 等于 sampleRow.title(= setup mock 的 server 回包)
      expect(result.task.title).toBe('喂奶粉');
    }
  });

  it('TaskService.updateTask is the same function reference as named export', () => {
    expect(TaskService.updateTask).toBe(updateTask);
  });
});

// =====================================================================
// updateTask — happy path — T-US003-1
// =====================================================================

/**
 * 给 updateTask 构造一条链路:
 *   1. pre-check getMyFamily(3 次 from 调用)— 默认走 setupHappyPath 的队列
 *   2. fetch existing task from tasks(单 .select().eq().single())
 *   3. UPDATE tasks from update chain — update payload spy
 *
 * 返回:
 *   - updatePayloadSpy:用于断言 PATCH 字段
 *
 * 行为参数:
 *   - existingRow:mock 出来的 existing task row(默认 = creator + non-template + non-completed)
 *   - updatedRow :mock server PATCH 后返回的 row(默认 sampleRow)
 */
function setupUpdateHappyPath(opts?: {
  existingRow?: Record<string, unknown> | null;
  updatedRow?: Record<string, unknown>;
}): { updatePayloadSpy: jest.Mock } {
  const existingRow =
    opts?.existingRow === undefined
      ? {
          created_by: CREATOR_ID,
          template_id: null,
          completed_at: null,
          cancelled: false,
        }
      : opts.existingRow;
  const updatedRow = opts?.updatedRow ?? sampleRow;

  // pre-check (3 builders,同 setupHappyPath)
  const b1 = mockMakeQueryBuilder();
  b1.maybeSingle.mockResolvedValue({
    data: { family_id: FAMILY_ID, user_id: CREATOR_ID, joined_at: '2026-09-01T00:00:00Z' },
    error: null,
  });
  const b2 = mockMakeQueryBuilder();
  b2.single.mockResolvedValue({
    data: { id: FAMILY_ID, created_by: CREATOR_ID, created_at: '2026-09-01T00:00:00Z' },
    error: null,
  });
  const b3 = mockMakeQueryBuilder();
  b3.then.mockImplementation(
    (onFulfilled: (v: { data: unknown; error: unknown }) => void) => {
      onFulfilled({
        data: [{ family_id: FAMILY_ID, user_id: CREATOR_ID, joined_at: '2026-09-01T00:00:00Z' }],
        error: null,
      });
      return Promise.resolve();
    },
  );

  // fetch existing
  const bFetch = mockMakeQueryBuilder();
  bFetch.single.mockResolvedValue({ data: existingRow, error: null });

  // update
  const updatePayloadSpy = jest.fn();
  const bUpdate = mockMakeQueryBuilder();
  bUpdate.update.mockImplementation((p: Record<string, unknown>) => {
    updatePayloadSpy(p);
    return bUpdate;
  });
  bUpdate.single.mockResolvedValue({ data: updatedRow, error: null });

  const queue = [b1, b2, b3, bFetch, bUpdate];
  let i = 0;
  mockSupabaseFrom.mockImplementation(() => {
    const b = queue[i] ?? mockMakeQueryBuilder();
    i += 1;
    return b;
  });

  return { updatePayloadSpy };
}

const TASK_ID = 'task-uuid-eeee-eeee-eeee-eeeeeeeeeeee';

describe('TaskService.updateTask — happy path', () => {
  it('returns updated{task} with full row echoed from server', async () => {
    setupUpdateHappyPath();

    const result = await updateTask(TASK_ID, {
      title: '倒垃圾(改)',
      taskDate: '2026-09-23',
      taskTime: '08:00',
      assigneeId: SPOUSE_ID,
    });

    expect(result.status).toBe('updated');
    if (result.status === 'updated') {
      expect(result.task.id).toBe(TASK_ID);
      expect(result.task.title).toBe('喂奶粉'); // mock server 返回 sampleRow.title
    }
  });

  it('PATCH payload contains all 6 editable fields (title, task_date, task_time, assignee_id, description, is_shared_view)', async () => {
    const { updatePayloadSpy } = setupUpdateHappyPath();

    await updateTask(TASK_ID, {
      title: '新标题',
      taskDate: '2026-09-23',
      taskTime: '08:00',
      assigneeId: SPOUSE_ID,
      description: '新备注',
      isSharedView: true,
    });

    expect(updatePayloadSpy).toHaveBeenCalledTimes(1);
    const payload = updatePayloadSpy.mock.calls[0][0];
    expect(payload.title).toBe('新标题');
    expect(payload.task_date).toBe('2026-09-23');
    expect(payload.task_time).toBe('08:00');
    expect(payload.assignee_id).toBe(SPOUSE_ID);
    expect(payload.description).toBe('新备注');
    expect(payload.is_shared_view).toBe(true);
  });

  it('does NOT include created_by / template_id / family_id / completed_at / cancelled (PATCH only)', async () => {
    const { updatePayloadSpy } = setupUpdateHappyPath();

    await updateTask(TASK_ID, {
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
    });

    const payload = updatePayloadSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.created_by).toBeUndefined();
    expect(payload.template_id).toBeUndefined();
    expect(payload.family_id).toBeUndefined();
    expect(payload.completed_at).toBeUndefined();
    expect(payload.cancelled).toBeUndefined();
  });

  it('does NOT call insert (uses update path)', async () => {
    setupUpdateHappyPath();

    const insertCalls: unknown[] = [];
    // 收集所有 mockMakeQueryBuilder 上的 insert 调用
    const origFrom = mockSupabaseFrom.getMockImplementation();
    mockSupabaseFrom.mockImplementation((table: string) => {
      const b = origFrom ? (origFrom as (t: string) => unknown)(table) : mockMakeQueryBuilder();
      const builder = b as ReturnType<typeof mockMakeQueryBuilder>;
      const origInsert = builder.insert.getMockImplementation();
      builder.insert.mockImplementation((p: unknown) => {
        insertCalls.push({ table, payload: p });
        if (origInsert) return origInsert(p);
        return builder;
      });
      return builder;
    });

    await updateTask(TASK_ID, {
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
    });

    // 不应有 insert('tasks', ...) 的调用
    const tasksInserts = insertCalls.filter((c) => (c as { table: string }).table === 'tasks');
    expect(tasksInserts).toHaveLength(0);
  });

  it('defensive: taskTime="" is normalized to null in update payload', async () => {
    const { updatePayloadSpy } = setupUpdateHappyPath();

    await updateTask(TASK_ID, {
      title: 't',
      taskDate: '2026-09-22',
      taskTime: '',
      assigneeId: CREATOR_ID,
    });

    expect(updatePayloadSpy.mock.calls[0][0].task_time).toBeNull();
  });

  it('description omitted → null in payload', async () => {
    const { updatePayloadSpy } = setupUpdateHappyPath();

    await updateTask(TASK_ID, {
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
    });

    expect(updatePayloadSpy.mock.calls[0][0].description).toBeNull();
  });

  it('isSharedView omitted → false in payload', async () => {
    const { updatePayloadSpy } = setupUpdateHappyPath();

    await updateTask(TASK_ID, {
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
    });

    expect(updatePayloadSpy.mock.calls[0][0].is_shared_view).toBe(false);
  });
});

// =====================================================================
// updateTask — failure paths
// =====================================================================

describe('TaskService.updateTask — failure paths', () => {
  it('returns failed{reason:"no_family"} when getMyFamily returns null', async () => {
    const builder = mockMakeQueryBuilder();
    builder.maybeSingle.mockResolvedValue({ data: null, error: null });
    setMockFromBuilder('family_members', builder);

    const result = await updateTask(TASK_ID, {
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('no_family');
    }
    // 不应 fetch / update tasks
    const tasksCalls = mockSupabaseFrom.mock.calls.filter(
      (call: unknown[]) => call[0] === 'tasks',
    );
    expect(tasksCalls).toHaveLength(0);
  });

  it('returns failed{reason:"not_authenticated"} when second getUser returns null', async () => {
    setupUpdateHappyPath();
    // getMyFamily 内部已经用掉第一次 getUser;updateTask 自己的 getUser 返回 null
    mockAuthGetUser.mockResolvedValueOnce({
      data: { user: { id: CREATOR_ID } },
      error: null,
    });
    mockAuthGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    const result = await updateTask(TASK_ID, {
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('not_authenticated');
    }
  });

  it('returns failed{reason:"not_owner"} when task.created_by !== current user', async () => {
    setupUpdateHappyPath({
      existingRow: {
        created_by: SPOUSE_ID, // different from current user (CREATOR_ID)
        template_id: null,
        completed_at: null,
        cancelled: false,
      },
    });

    const result = await updateTask(TASK_ID, {
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('not_owner');
    }
  });

  it('returns failed{reason:"template_not_supported"} when task.template_id is non-null', async () => {
    setupUpdateHappyPath({
      existingRow: {
        created_by: CREATOR_ID,
        template_id: 'template-uuid-3333-3333-3333-333333333333',
        completed_at: null,
        cancelled: false,
      },
    });

    const result = await updateTask(TASK_ID, {
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('template_not_supported');
    }
  });

  it('returns failed{reason:"task_completed"} when task.completed_at is set', async () => {
    setupUpdateHappyPath({
      existingRow: {
        created_by: CREATOR_ID,
        template_id: null,
        completed_at: '2026-09-22T10:05:00Z',
        cancelled: false,
      },
    });

    const result = await updateTask(TASK_ID, {
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('task_completed');
    }
  });

  it('returns failed{reason:"task_cancelled"} when task.cancelled is true', async () => {
    setupUpdateHappyPath({
      existingRow: {
        created_by: CREATOR_ID,
        template_id: null,
        completed_at: null,
        cancelled: true,
      },
    });

    const result = await updateTask(TASK_ID, {
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('task_cancelled');
    }
  });

  it('returns failed{reason: error.message} when fetch existing task RPC errors', async () => {
    // pre-check 通过
    const b1 = mockMakeQueryBuilder();
    b1.maybeSingle.mockResolvedValue({
      data: { family_id: FAMILY_ID, user_id: CREATOR_ID, joined_at: '2026-09-01T00:00:00Z' },
      error: null,
    });
    const b2 = mockMakeQueryBuilder();
    b2.single.mockResolvedValue({
      data: { id: FAMILY_ID, created_by: CREATOR_ID, created_at: '2026-09-01T00:00:00Z' },
      error: null,
    });
    const b3 = mockMakeQueryBuilder();
    b3.then.mockImplementation(
      (onFulfilled: (v: { data: unknown; error: unknown }) => void) => {
        onFulfilled({
          data: [{ family_id: FAMILY_ID, user_id: CREATOR_ID, joined_at: '2026-09-01T00:00:00Z' }],
          error: null,
        });
        return Promise.resolve();
      },
    );
    // fetch existing → error
    const bFetch = mockMakeQueryBuilder();
    bFetch.single.mockResolvedValue({
      data: null,
      error: { message: 'RLS violation', name: 'PostgrestError' },
    });

    const queue = [b1, b2, b3, bFetch];
    let i = 0;
    mockSupabaseFrom.mockImplementation(() => {
      const b = queue[i] ?? mockMakeQueryBuilder();
      i += 1;
      return b;
    });

    const result = await updateTask(TASK_ID, {
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toContain('RLS violation');
    }
  });

  it('returns failed{reason:"task_not_found"} when fetch existing task returns null data', async () => {
    // pre-check 通过 + fetch existing → null data, no error
    const b1 = mockMakeQueryBuilder();
    b1.maybeSingle.mockResolvedValue({
      data: { family_id: FAMILY_ID, user_id: CREATOR_ID, joined_at: '2026-09-01T00:00:00Z' },
      error: null,
    });
    const b2 = mockMakeQueryBuilder();
    b2.single.mockResolvedValue({
      data: { id: FAMILY_ID, created_by: CREATOR_ID, created_at: '2026-09-01T00:00:00Z' },
      error: null,
    });
    const b3 = mockMakeQueryBuilder();
    b3.then.mockImplementation(
      (onFulfilled: (v: { data: unknown; error: unknown }) => void) => {
        onFulfilled({
          data: [{ family_id: FAMILY_ID, user_id: CREATOR_ID, joined_at: '2026-09-01T00:00:00Z' }],
          error: null,
        });
        return Promise.resolve();
      },
    );
    const bFetch = mockMakeQueryBuilder();
    bFetch.single.mockResolvedValue({ data: null, error: null });

    const queue = [b1, b2, b3, bFetch];
    let i = 0;
    mockSupabaseFrom.mockImplementation(() => {
      const b = queue[i] ?? mockMakeQueryBuilder();
      i += 1;
      return b;
    });

    const result = await updateTask(TASK_ID, {
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('task_not_found');
    }
  });

  it('returns failed{reason: error.message} when update RPC errors', async () => {
    // pre-check + fetch existing pass;update fails
    const b1 = mockMakeQueryBuilder();
    b1.maybeSingle.mockResolvedValue({
      data: { family_id: FAMILY_ID, user_id: CREATOR_ID, joined_at: '2026-09-01T00:00:00Z' },
      error: null,
    });
    const b2 = mockMakeQueryBuilder();
    b2.single.mockResolvedValue({
      data: { id: FAMILY_ID, created_by: CREATOR_ID, created_at: '2026-09-01T00:00:00Z' },
      error: null,
    });
    const b3 = mockMakeQueryBuilder();
    b3.then.mockImplementation(
      (onFulfilled: (v: { data: unknown; error: unknown }) => void) => {
        onFulfilled({
          data: [{ family_id: FAMILY_ID, user_id: CREATOR_ID, joined_at: '2026-09-01T00:00:00Z' }],
          error: null,
        });
        return Promise.resolve();
      },
    );
    const bFetch = mockMakeQueryBuilder();
    bFetch.single.mockResolvedValue({
      data: { created_by: CREATOR_ID, template_id: null, completed_at: null, cancelled: false },
      error: null,
    });
    const bUpdate = mockMakeQueryBuilder();
    bUpdate.single.mockResolvedValue({
      data: null,
      error: { message: 'network timeout', name: 'PostgrestError' },
    });

    const queue = [b1, b2, b3, bFetch, bUpdate];
    let i = 0;
    mockSupabaseFrom.mockImplementation(() => {
      const b = queue[i] ?? mockMakeQueryBuilder();
      i += 1;
      return b;
    });

    const result = await updateTask(TASK_ID, {
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toContain('network timeout');
    }
  });

  it('returns failed{reason:"updateTask returned no data"} when update returns null data (defensive)', async () => {
    const b1 = mockMakeQueryBuilder();
    b1.maybeSingle.mockResolvedValue({
      data: { family_id: FAMILY_ID, user_id: CREATOR_ID, joined_at: '2026-09-01T00:00:00Z' },
      error: null,
    });
    const b2 = mockMakeQueryBuilder();
    b2.single.mockResolvedValue({
      data: { id: FAMILY_ID, created_by: CREATOR_ID, created_at: '2026-09-01T00:00:00Z' },
      error: null,
    });
    const b3 = mockMakeQueryBuilder();
    b3.then.mockImplementation(
      (onFulfilled: (v: { data: unknown; error: unknown }) => void) => {
        onFulfilled({
          data: [{ family_id: FAMILY_ID, user_id: CREATOR_ID, joined_at: '2026-09-01T00:00:00Z' }],
          error: null,
        });
        return Promise.resolve();
      },
    );
    const bFetch = mockMakeQueryBuilder();
    bFetch.single.mockResolvedValue({
      data: { created_by: CREATOR_ID, template_id: null, completed_at: null, cancelled: false },
      error: null,
    });
    const bUpdate = mockMakeQueryBuilder();
    bUpdate.single.mockResolvedValue({ data: null, error: null });

    const queue = [b1, b2, b3, bFetch, bUpdate];
    let i = 0;
    mockSupabaseFrom.mockImplementation(() => {
      const b = queue[i] ?? mockMakeQueryBuilder();
      i += 1;
      return b;
    });

    const result = await updateTask(TASK_ID, {
      title: 't',
      taskDate: '2026-09-22',
      assigneeId: CREATOR_ID,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toContain('no data');
    }
  });
});

// =====================================================================
// deleteTask — T-US003-2
// =====================================================================

/**
 * 给 deleteTask 构造链路:
 *   1. pre-check getMyFamily(3 次 from 调用)
 *   2. fetch existing task(单 .select().eq().maybeSingle())
 *   3. DELETE tasks(.delete().eq())
 *
 * 行为参数:
 *   - existingRow:mock 出来的 existing task row(default = creator + non-template + non-completed)
 *   - deleteError:DELETE 返回的错误(null 表示 happy path)
 */
function setupDeleteHappyPath(opts?: {
  existingRow?: Record<string, unknown> | null;
  deleteError?: { message: string; name: string } | null;
}): { deleteCallSpy: jest.Mock } {
  const existingRow =
    opts?.existingRow === undefined
      ? {
          id: TASK_ID,
          created_by: CREATOR_ID,
          template_id: null,
          cancelled: false,
          completed_at: null,
        }
      : opts.existingRow;
  const deleteError = opts?.deleteError ?? null;

  // pre-check (3 builders,同 setupHappyPath / setupUpdateHappyPath)
  const b1 = mockMakeQueryBuilder();
  b1.maybeSingle.mockResolvedValue({
    data: { family_id: FAMILY_ID, user_id: CREATOR_ID, joined_at: '2026-09-01T00:00:00Z' },
    error: null,
  });
  const b2 = mockMakeQueryBuilder();
  b2.single.mockResolvedValue({
    data: { id: FAMILY_ID, created_by: CREATOR_ID, created_at: '2026-09-01T00:00:00Z' },
    error: null,
  });
  const b3 = mockMakeQueryBuilder();
  b3.then.mockImplementation(
    (onFulfilled: (v: { data: unknown; error: unknown }) => void) => {
      onFulfilled({
        data: [{ family_id: FAMILY_ID, user_id: CREATOR_ID, joined_at: '2026-09-01T00:00:00Z' }],
        error: null,
      });
      return Promise.resolve();
    },
  );

  // fetch existing
  const bFetch = mockMakeQueryBuilder();
  bFetch.maybeSingle.mockResolvedValue({ data: existingRow, error: null });

  // delete
  const deleteCallSpy = jest.fn();
  const bDelete = mockMakeQueryBuilder();
  bDelete.delete.mockImplementation(() => {
    deleteCallSpy();
    return bDelete;
  });
  bDelete.eq.mockImplementation((col: string, val: string) => {
    deleteCallSpy(col, val);
    return bDelete;
  });
  // DELETE 链尾:thenable await 拿到 {data, error}
  bDelete.then.mockImplementation(
    (onFulfilled: (v: { data: unknown; error: unknown }) => void) => {
      onFulfilled({ data: null, error: deleteError });
      return Promise.resolve();
    },
  );

  const queue = [b1, b2, b3, bFetch, bDelete];
  let i = 0;
  mockSupabaseFrom.mockImplementation(() => {
    const b = queue[i] ?? mockMakeQueryBuilder();
    i += 1;
    return b;
  });

  return { deleteCallSpy };
}

describe('TaskService.deleteTask — happy path', () => {
  it('returns deleted{taskId} on success', async () => {
    setupDeleteHappyPath();

    const result = await deleteTask(TASK_ID);

    expect(result.status).toBe('deleted');
    if (result.status === 'deleted') {
      expect(result.taskId).toBe(TASK_ID);
    }
  });

  it('issues DELETE on tasks with eq(id, taskId) chain', async () => {
    const { deleteCallSpy } = setupDeleteHappyPath();

    await deleteTask(TASK_ID);

    // .delete() + .eq('id', TASK_ID) 都被调过
    expect(deleteCallSpy).toHaveBeenCalledWith();
    expect(deleteCallSpy).toHaveBeenCalledWith('id', TASK_ID);
  });

  it('still deletes completed tasks (no completed_at guard — 让用户能清错打卡)', async () => {
    setupDeleteHappyPath({
      existingRow: {
        id: TASK_ID,
        created_by: CREATOR_ID,
        template_id: null,
        cancelled: false,
        completed_at: '2026-09-22T10:05:00Z', // 已完成
      },
    });

    const result = await deleteTask(TASK_ID);

    expect(result.status).toBe('deleted');
  });

  it('still deletes cancelled tasks (no cancelled guard)', async () => {
    setupDeleteHappyPath({
      existingRow: {
        id: TASK_ID,
        created_by: CREATOR_ID,
        template_id: null,
        cancelled: true,
        completed_at: null,
      },
    });

    const result = await deleteTask(TASK_ID);

    expect(result.status).toBe('deleted');
  });
});

describe('TaskService.deleteTask — failure paths', () => {
  it('returns failed{reason:"no_family"} when getMyFamily returns null', async () => {
    const builder = mockMakeQueryBuilder();
    builder.maybeSingle.mockResolvedValue({ data: null, error: null });
    setMockFromBuilder('family_members', builder);

    const result = await deleteTask(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('no_family');
    }
    // 不应触发 tasks 操作
    const tasksCalls = mockSupabaseFrom.mock.calls.filter(
      (call: unknown[]) => call[0] === 'tasks',
    );
    expect(tasksCalls).toHaveLength(0);
  });

  it('returns failed{reason:"not_authenticated"} when second getUser returns null', async () => {
    setupDeleteHappyPath();
    // getMyFamily 内部已经用掉第一次 getUser;deleteTask 自己的 getUser 返回 null
    mockAuthGetUser.mockResolvedValueOnce({
      data: { user: { id: CREATOR_ID } },
      error: null,
    });
    mockAuthGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    const result = await deleteTask(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('not_authenticated');
    }
  });

  it('returns failed{reason:"task_not_found"} when fetch existing returns null data', async () => {
    setupDeleteHappyPath({ existingRow: null });

    const result = await deleteTask(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('task_not_found');
    }
  });

  it('returns failed{reason:"not_owner"} when task.created_by !== current user', async () => {
    setupDeleteHappyPath({
      existingRow: {
        id: TASK_ID,
        created_by: SPOUSE_ID, // 不是当前 user
        template_id: null,
        cancelled: false,
        completed_at: null,
      },
    });

    const result = await deleteTask(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('not_owner');
    }
  });

  it('returns failed{reason:"template_not_supported"} when task.template_id is non-null', async () => {
    setupDeleteHappyPath({
      existingRow: {
        id: TASK_ID,
        created_by: CREATOR_ID,
        template_id: 'template-uuid-3333-3333-3333-333333333333',
        cancelled: false,
        completed_at: null,
      },
    });

    const result = await deleteTask(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('template_not_supported');
    }
  });

  it('returns failed{reason:"rls_denied"} when DELETE error contains "rls"', async () => {
    setupDeleteHappyPath({
      deleteError: { message: 'new row violates row-level security policy', name: 'PostgrestError' },
    });

    const result = await deleteTask(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('rls_denied');
    }
  });

  it('returns failed{reason:"rls_denied"} when DELETE error contains "policy"', async () => {
    setupDeleteHappyPath({
      deleteError: { message: 'policy violation: tasks_delete_owner', name: 'PostgrestError' },
    });

    const result = await deleteTask(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('rls_denied');
    }
  });

  it('returns failed{reason:"unknown"} when DELETE error does not match rls/policy', async () => {
    setupDeleteHappyPath({
      deleteError: { message: 'network timeout', name: 'PostgrestError' },
    });

    const result = await deleteTask(TASK_ID);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('unknown');
    }
  });

  it('does NOT call DELETE on tasks when ownership check fails (defensive: skip the destructive op)', async () => {
    setupDeleteHappyPath({
      existingRow: {
        id: TASK_ID,
        created_by: SPOUSE_ID, // not_owner
        template_id: null,
        cancelled: false,
        completed_at: null,
      },
    });

    await deleteTask(TASK_ID);

    // ownership 校验失败 → 实现 early return,不应触发 .delete() 调用。
    // 验证:只有 4 次 from() 调用(pre-check x3 + fetch existing x1),
    // 第 5 次(DELETE 链)从未发生 — mockSupabaseFrom.mock.results 只含 4 个 builder。
    expect(mockSupabaseFrom.mock.calls.filter((c) => c[0] === 'tasks')).toHaveLength(1);
  });
});

// =====================================================================
// TaskService namespace — deleteTask 同步
// =====================================================================

describe('TaskService namespace — deleteTask', () => {
  it('TaskService.deleteTask is the same function reference as named export', () => {
    expect(TaskService.deleteTask).toBe(deleteTask);
  });

  it('TaskService.deleteTask works through namespace with same signature', async () => {
    setupDeleteHappyPath();

    const result = await TaskService.deleteTask(TASK_ID);

    expect(result.status).toBe('deleted');
    if (result.status === 'deleted') {
      expect(result.taskId).toBe(TASK_ID);
    }
  });
});