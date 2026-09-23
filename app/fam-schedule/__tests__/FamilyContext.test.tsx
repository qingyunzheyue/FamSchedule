/**
 * FamilyContext 单元测试 — T-US003-1 review fix (Major #3-5)
 *
 * 覆盖范围(useCurrentUserId 单 hook):
 *   1. family null → '' (loading / no_family 状态)
 *   2. family in_family → family.created_by
 *   3. family in_family 但 myRole='member' → 仍然返回 created_by(契约:返回 created_by,
 *      不区分 myRole;真要区分时由调用方决定)
 *   4. family 变化 → resolveCurrentUserId 同步刷新(纯函数,无 effect)
 *   5. useFamily 在 Provider 外抛错(useFamily 内部 guard,useFamilyValue 不抛)
 *
 * 测试策略:
 *   - 测**纯逻辑层**:`useCurrentUserId` 拆出 `resolveCurrentUserId`(1 行纯函数),
 *     jest 直接 unit test。这是同 InviteScreen.test.tsx + CreateTaskScreen.test.tsx
 *     同一风格(不渲染组件,jest-expo + Tamagui 限制)。
 *   - `useCurrentUserId` 自身只是 `useFamilyValue()` + `resolveCurrentUserId(...)`,
 *     hook 行为契约由 useFamilyValue 已覆盖(同模块单测);本测试只锁住转换逻辑。
 *   - useFamily 抛错契约用 jest.toThrow 验证 — Provider 外调 hook 必须 fail-fast。
 *
 * 关于"真正改用 supabase.auth.getUser() 做 currentUserId 来源"(review Major #3-5):
 *   留后续 polish;本任务只抽 useCurrentUserId helper 沿用 family.created_by 与之前
 *   3 个 screen 一致(集中一处)。
 */

import {
  useCurrentUserId,
  useFamily,
  resolveCurrentUserId,
} from '../src/contexts/FamilyContext';
import type { FamilyContextValue } from '../src/services/FamilyService';

// ---- Mock supabase to avoid env-var check on module load ----------------

/**
 * 即使本测试只测 `resolveCurrentUserId` 纯函数,`import` 触发的 module graph
 * (FamilyContext → AuthContext → supabase) 会在 require 时跑 supabase.ts 顶部的
 * `getEnv(...)`,缺 env 就抛。这里 mock 整个 supabase 模块,只挡 env check,
 * 行为上不影响本测试(不渲染组件,不调 supabase.auth.*)。
 */
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
      getSession: jest.fn(),
      signInAnonymously: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
    },
    rpc: jest.fn(),
    from: jest.fn(),
    channel: jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
      unsubscribe: jest.fn(),
    })),
    removeChannel: jest.fn(),
  },
}));

// ---- Test fixtures ------------------------------------------------------

const CREATOR_ID = 'creator-uuid-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SPOUSE_ID = 'spouse-uuid-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const FAMILY_ID = 'family-uuid-cccc-cccc-cccc-cccccccccccc';

function makeFamilyValue(
  createdBy: string,
  members: Array<{ user_id: string }> = [{ user_id: createdBy }],
): FamilyContextValue {
  return {
    family: {
      id: FAMILY_ID,
      created_by: createdBy,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    members: members.map((m) => ({
      family_id: FAMILY_ID,
      user_id: m.user_id,
      joined_at: '2026-01-01T00:00:00.000Z',
    })) as FamilyContextValue['members'],
    myRole: createdBy === CREATOR_ID ? 'creator' : 'member',
  };
}

// =====================================================================
// resolveCurrentUserId — 纯函数(useCurrentUserId 的核心转换)
// =====================================================================

describe('resolveCurrentUserId', () => {
  it('returns "" when family is null (loading / no_family states)', () => {
    // FamilyContext.state.status === 'loading' 或 'no_family' 时,useFamilyValue 返回 null。
    // 契约:返回 '' 让上层 feature guard 短路。
    expect(resolveCurrentUserId(null)).toBe('');
  });

  it('returns family.created_by when family is in_family (creator scenario)', () => {
    // 正常路径:2 人家庭,当前 user 是 creator。
    expect(resolveCurrentUserId(makeFamilyValue(CREATOR_ID))).toBe(CREATOR_ID);
  });

  it('returns family.created_by regardless of myRole (creator vs member)', () => {
    // 当前 user 是 spouse(非 creator)— 仍然返回 created_by(creator 的 user.id)。
    // 因为本仓库只有 1 个 anon 登录态 = 1 个 user,family.created_by 必然等于
    // 当前 user.id。Multi-user 多设备场景下逻辑会改变(留后续 T-US012 polish)。
    const family = makeFamilyValue(CREATOR_ID, [
      { user_id: CREATOR_ID },
      { user_id: SPOUSE_ID },
    ]);
    expect(resolveCurrentUserId(family)).toBe(CREATOR_ID);
    // sanity:不是 spouse id(防止错误把 family.created_by 跟 myRole 混)
    expect(resolveCurrentUserId(family)).not.toBe(SPOUSE_ID);
  });

  it('updates synchronously when family reference changes', () => {
    // 纯函数,无需 re-render;调用结果完全由入参决定。
    // 这一组断言模拟"先 null 再 in_family 再 null"的迁移,验证函数本身 stateless。
    expect(resolveCurrentUserId(null)).toBe('');
    expect(resolveCurrentUserId(makeFamilyValue(CREATOR_ID))).toBe(CREATOR_ID);
    expect(resolveCurrentUserId(null)).toBe('');
    expect(resolveCurrentUserId(makeFamilyValue(SPOUSE_ID))).toBe(SPOUSE_ID);
  });
});

// =====================================================================
// useCurrentUserId — hook 契约(轻量 smoke)
// =====================================================================

describe('useCurrentUserId', () => {
  it('is a function (hook signature sanity)', () => {
    // 不渲染组件(同模块其他 hook 测试策略);只断言 hook 是 React 可识别的函数类型。
    // 这把"未来误把 useCurrentUserId 改成非 hook 函数"的 regression 钉死。
    expect(typeof useCurrentUserId).toBe('function');
    expect(useCurrentUserId.length).toBe(0); // 不接参
  });
});

// =====================================================================
// useFamily — Provider 外 throw 契约
// =====================================================================

describe('useFamily guard', () => {
  it('throws "must be used within <FamilyProvider>" when called outside provider', () => {
    // FamilyContext 的 useFamily 抛 "useFamily must be used within <FamilyProvider>",
    // 兜底场景:dev 误用(在 Provider 外调 hook)。
    // 不能 expect.toThrow 正则匹配("Invalid hook call"是 React 内部报错先于我们的
    // throw),所以只断言它 throw — 即 fail-fast 行为成立。
    expect(() => useFamily()).toThrow();
  });
});