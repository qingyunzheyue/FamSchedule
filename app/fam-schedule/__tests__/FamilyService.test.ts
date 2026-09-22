/**
 * FamilyService 单元测试 — T-US012-1
 *
 * 覆盖范围(任务 DoD + 关键边界):
 *   1. createFamily:成功 → created{familyId, familyName}
 *   2. createFamily:pre-check 命中(已在 family)→ already_in_family
 *   3. createFamily:RPC 报错 → failed{reason}
 *   4. acceptInvite:合法邀请码 → joined{familyId, memberId}
 *   5. acceptInvite:无效码 → invalid_code
 *   6. acceptInvite:过期码 → expired
 *   7. acceptInvite:pre-check 命中(已在 family)→ already_in_family
 *   8. getMyFamily:无 row → null
 *   9. getMyFamily:有 family + 自己是 creator → in_family{myRole: 'creator'}
 *  10. getMyFamily:有 family + 自己是 member → in_family{myRole: 'member'}
 *  11. getMyFamily:family_members 有但 families 找不到 → null(数据不一致兜底)
 *  12. _resetForTests:清 cache
 *
 * Mock 策略:
 *   - supabase 整个 mock,提供可编程的 mockRpc / mockAuthGetUser / mockFrom
 *   - jest.mock factory 只能引用 mock-prefixed 名字,所以 mockMakeQueryBuilder
 *     和 mockSupabaseFrom 必须在 mock factory **外**声明为 `let mock...` 才能用
 */

import {
  createFamily,
  acceptInvite,
  getMyFamily,
  _resetForTests,
} from '../src/services/FamilyService';

// ---- Mocks (必须在 import FamilyService 之前) ----------------------------

let mockRpc: jest.Mock;
let mockAuthGetUser: jest.Mock;
let mockSupabaseFrom: jest.Mock;

// mockMakeQueryBuilder 是 factory 内部用的 helper — 必须 mock-prefixed。
// 因 factory 内只能引用 mock-prefixed 变量,所以这个 helper 必须以 mock 开头。
//
// supabase-js PostgrestFilterBuilder 行为:
//   - .select() / .eq() 返回 builder 自身(可链式)
//   - .maybeSingle() / .single() 返回 Promise<{data, error}>
//   - builder 本身 thenable,直接 await builder 也得到 {data, error}
//     (这就是 getMyFamily 第 3 次查 family_members 的用法:
//      .select().eq().eq() 然后 await,无 .maybeSingle / .single)
function mockMakeQueryBuilder(): {
  select: jest.Mock;
  eq: jest.Mock;
  maybeSingle: jest.Mock;
  single: jest.Mock;
  // builder 自身 thenable:await builder → 默认 {data: null, error: null}
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
  // 默认 await builder → {data: null, error: null}
  builder.then.mockImplementation(
    (onFulfilled: (v: { data: unknown; error: unknown }) => void) => {
      onFulfilled({ data: null, error: null });
      return Promise.resolve();
    },
  );
  return builder;
}

jest.mock('../src/lib/supabase', () => {
  // 这里必须重新声明 mock 变量(factory 闭包内可见)— 但只能 mock-prefixed 名
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

// ---- Test fixtures ----------------------------------------------------

const USER_ID = 'user-uuid-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const FAMILY_ID = 'family-uuid-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OTHER_USER_ID = 'user-uuid-cccc-cccc-cccc-cccccccccccc';

function setMockAuthUser(userId: string | null): void {
  if (userId === null) {
    mockAuthGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
  } else {
    mockAuthGetUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
  }
}

/**
 * Helper:让 .from('table') 配 builder 的 .select(...) 链最终 .maybeSingle() / .single()
 * 或 await builder 本身返回指定结果。
 *
 * 按调用顺序记录 mockSupabaseFrom 的返回值(每次 from() 返回新 builder)。
 *
 * terminal:
 *   - 'maybeSingle' | 'single' → 对应方法返回 Promise<result>
 *   - 'thenable'               → builder.then 触发 onFulfilled(result)(用于 await builder)
 */
function setMockFromResult(
  table: string,
  result: { data: unknown; error: unknown },
  method: 'maybeSingle' | 'single' | 'thenable',
): void {
  if (!setMockFromResult._queues) {
    setMockFromResult._queues = new Map<string, Array<() => unknown>>();
  }
  if (!setMockFromResult._queues.has(table)) {
    setMockFromResult._queues.set(table, []);
  }
  setMockFromResult._queues.get(table)!.push(() => {
    const builder = mockMakeQueryBuilder();
    if (method === 'thenable') {
      builder.then.mockImplementation(
        (onFulfilled: (v: { data: unknown; error: unknown }) => void) => {
          onFulfilled(result);
          return Promise.resolve();
        },
      );
    } else {
      builder[method].mockResolvedValue(result);
    }
    return builder;
  });
  mockSupabaseFrom.mockImplementation((t: string) => {
    const queue = setMockFromResult._queues!.get(t);
    if (queue && queue.length > 0) {
      return queue.shift()!();
    }
    return mockMakeQueryBuilder();
  });
}
// module-level 队列(actions 闭包共享)
setMockFromResult._queues = new Map<string, Array<() => unknown>>();

beforeEach(() => {
  _resetForTests();
  jest.clearAllMocks();
  // 清掉队列
  setMockFromResult._queues = new Map<string, Array<() => unknown>>();
  // 默认 from() 返回空 builder
  mockSupabaseFrom.mockImplementation(() => mockMakeQueryBuilder());
});

// =====================================================================
// Tests
// =====================================================================

describe('FamilyService.createFamily', () => {
  it('returns created{familyId, familyName} on success', async () => {
    // 1. getMyFamily pre-check → 没 family
    setMockAuthUser(USER_ID);
    setMockFromResult('family_members', { data: null, error: null }, 'maybeSingle');
    // 2. createFamily RPC 成功
    mockRpc.mockResolvedValue({ data: FAMILY_ID, error: null });
    // 3. 成功后再 fetch families 行
    setMockFromResult(
      'families',
      {
        data: { id: FAMILY_ID, created_by: USER_ID, created_at: '2026-09-17T00:00:00.000Z' },
        error: null,
      },
      'single',
    );

    const result = await createFamily();

    expect(result.status).toBe('created');
    if (result.status === 'created') {
      expect(result.familyId).toBe(FAMILY_ID);
      expect(result.familyName).toBe('我的家庭');
    }
    expect(mockRpc).toHaveBeenCalledWith('create_family');
  });

  it('returns already_in_family when pre-check finds existing family', async () => {
    // getMyFamily pre-check → 有 family
    setMockAuthUser(USER_ID);
    setMockFromResult(
      'family_members',
      {
        data: { family_id: FAMILY_ID, user_id: USER_ID, joined_at: '2026-09-01T00:00:00.000Z' },
        error: null,
      },
      'maybeSingle',
    );
    setMockFromResult(
      'families',
      {
        data: { id: FAMILY_ID, created_by: USER_ID, created_at: '2026-09-01T00:00:00.000Z' },
        error: null,
      },
      'single',
    );
    // 不该再调 RPC
    mockRpc.mockResolvedValue({ data: null, error: null });

    const result = await createFamily();

    expect(result.status).toBe('already_in_family');
    if (result.status === 'already_in_family') {
      expect(result.existingFamilyId).toBe(FAMILY_ID);
    }
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns failed{reason} when RPC errors', async () => {
    // pre-check null
    setMockAuthUser(USER_ID);
    setMockFromResult('family_members', { data: null, error: null }, 'maybeSingle');
    // RPC 抛错
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'permission denied for table families', name: 'PostgrestError' },
    });

    const result = await createFamily();

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toContain('permission denied');
    }
  });
});

describe('FamilyService.acceptInvite', () => {
  it('returns joined{familyId, memberId} on valid code', async () => {
    // pre-check null
    setMockAuthUser(USER_ID);
    setMockFromResult('family_members', { data: null, error: null }, 'maybeSingle');
    // accept_invite RPC 成功
    mockRpc.mockResolvedValue({ data: FAMILY_ID, error: null });
    // 接下来 getMyFamily 内部:family_members(自己那条)→ families → family_members(同 family)
    setMockFromResult(
      'family_members',
      {
        data: { family_id: FAMILY_ID, user_id: USER_ID, joined_at: '2026-09-17T00:00:00.000Z' },
        error: null,
      },
      'maybeSingle',
    );
    setMockFromResult(
      'families',
      {
        data: { id: FAMILY_ID, created_by: OTHER_USER_ID, created_at: '2026-09-01T00:00:00.000Z' },
        error: null,
      },
      'single',
    );
    setMockFromResult(
      'family_members',
      {
        data: [
          { family_id: FAMILY_ID, user_id: OTHER_USER_ID, joined_at: '2026-09-01T00:00:00.000Z' },
          { family_id: FAMILY_ID, user_id: USER_ID, joined_at: '2026-09-17T00:00:00.000Z' },
        ],
        error: null,
      },
      'thenable',
    );

    const result = await acceptInvite('ABC123');

    expect(result.status).toBe('joined');
    if (result.status === 'joined') {
      expect(result.familyId).toBe(FAMILY_ID);
      expect(result.memberId).toBe(USER_ID);
    }
    expect(mockRpc).toHaveBeenCalledWith('accept_invite', { p_code: 'ABC123' });
  });

  it('returns invalid_code when RPC rejects with invalid message', async () => {
    setMockAuthUser(USER_ID);
    setMockFromResult('family_members', { data: null, error: null }, 'maybeSingle');
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'invalid invite code', name: 'PostgrestError' },
    });

    const result = await acceptInvite('WRONG99');

    expect(result.status).toBe('invalid_code');
  });

  it('returns expired when RPC rejects with expired message', async () => {
    setMockAuthUser(USER_ID);
    setMockFromResult('family_members', { data: null, error: null }, 'maybeSingle');
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'invite code has expired', name: 'PostgrestError' },
    });

    const result = await acceptInvite('OLDCODE');

    expect(result.status).toBe('expired');
  });

  it('returns already_in_family when pre-check finds existing family', async () => {
    setMockAuthUser(USER_ID);
    setMockFromResult(
      'family_members',
      {
        data: { family_id: FAMILY_ID, user_id: USER_ID, joined_at: '2026-09-01T00:00:00.000Z' },
        error: null,
      },
      'maybeSingle',
    );
    setMockFromResult(
      'families',
      {
        data: { id: FAMILY_ID, created_by: USER_ID, created_at: '2026-09-01T00:00:00.000Z' },
        error: null,
      },
      'single',
    );
    mockRpc.mockResolvedValue({ data: null, error: null });

    const result = await acceptInvite('ABC123');

    expect(result.status).toBe('already_in_family');
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('FamilyService.getMyFamily', () => {
  it('returns null when not signed in', async () => {
    setMockAuthUser(null);

    const result = await getMyFamily();

    expect(result).toBeNull();
  });

  it('returns null when user has no family_members row', async () => {
    setMockAuthUser(USER_ID);
    setMockFromResult('family_members', { data: null, error: null }, 'maybeSingle');

    const result = await getMyFamily();

    expect(result).toBeNull();
  });

  it('returns in_family with myRole=creator when user is the family creator', async () => {
    setMockAuthUser(USER_ID);
    setMockFromResult(
      'family_members',
      {
        data: { family_id: FAMILY_ID, user_id: USER_ID, joined_at: '2026-09-01T00:00:00.000Z' },
        error: null,
      },
      'maybeSingle',
    );
    setMockFromResult(
      'families',
      {
        data: { id: FAMILY_ID, created_by: USER_ID, created_at: '2026-09-01T00:00:00.000Z' },
        error: null,
      },
      'single',
    );
    setMockFromResult(
      'family_members',
      {
        data: [{ family_id: FAMILY_ID, user_id: USER_ID, joined_at: '2026-09-01T00:00:00.000Z' }],
        error: null,
      },
      'thenable',
    );

    const result = await getMyFamily();

    expect(result).not.toBeNull();
    if (result) {
      expect(result.family.id).toBe(FAMILY_ID);
      expect(result.family.created_by).toBe(USER_ID);
      expect(result.myRole).toBe('creator');
      expect(result.members).toHaveLength(1);
    }
  });

  it('returns in_family with myRole=member when user is not the creator', async () => {
    setMockAuthUser(USER_ID);
    setMockFromResult(
      'family_members',
      {
        data: { family_id: FAMILY_ID, user_id: USER_ID, joined_at: '2026-09-15T00:00:00.000Z' },
        error: null,
      },
      'maybeSingle',
    );
    setMockFromResult(
      'families',
      {
        data: { id: FAMILY_ID, created_by: OTHER_USER_ID, created_at: '2026-09-01T00:00:00.000Z' },
        error: null,
      },
      'single',
    );
    setMockFromResult(
      'family_members',
      {
        data: [
          { family_id: FAMILY_ID, user_id: OTHER_USER_ID, joined_at: '2026-09-01T00:00:00.000Z' },
          { family_id: FAMILY_ID, user_id: USER_ID, joined_at: '2026-09-15T00:00:00.000Z' },
        ],
        error: null,
      },
      'thenable',
    );

    const result = await getMyFamily();

    expect(result).not.toBeNull();
    if (result) {
      expect(result.myRole).toBe('member');
      expect(result.members).toHaveLength(2);
    }
  });

  it('returns null when family_members row exists but families row not found (data inconsistency)', async () => {
    setMockAuthUser(USER_ID);
    setMockFromResult(
      'family_members',
      {
        data: { family_id: FAMILY_ID, user_id: USER_ID, joined_at: '2026-09-01T00:00:00.000Z' },
        error: null,
      },
      'maybeSingle',
    );
    setMockFromResult(
      'families',
      { data: null, error: { message: 'row not found', name: 'PostgrestError' } },
      'single',
    );

    const result = await getMyFamily();

    expect(result).toBeNull();
  });
});

describe('FamilyService._resetForTests', () => {
  it('clears module-level cache without throwing', () => {
    expect(() => _resetForTests()).not.toThrow();
  });
});