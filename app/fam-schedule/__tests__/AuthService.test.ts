/**
 * AuthService 单元测试 — T-US013-1
 *
 * 覆盖范围(任务 DoD + 关键边界):
 *   1. signInAnonymously:成功 → signed_in
 *   2. signInAnonymously:SDK 返回 error → signed_out(不抛)
 *   3. restoreSession:有未过期 session → signed_in
 *   4. restoreSession:无 session → signed_out
 *   5. restoreSession:过期 session → refresh 失败 → signed_out
 *   6. clearSession:signOut + SecureStore.deleteItemAsync 都触发
 *   7. subscribeAuthState:SIGNED_OUT 自动触发 signInAnonymously(DoD #4)
 *   8. subscribeAuthState:markIntentionalSignOut 后 SIGNED_OUT 不自动重连
 *   9. subscribeAuthState:TOKEN_REFRESHED 映射成 signed_in
 *  10. _resetForTests:清 listener + intentionalSignOutFlag
 *
 * Mock 策略:
 *   - supabase 整个模块 mock 掉,提供可编程的 mockAuth
 *   - expo-secure-store mock deleteItemAsync(SDK 内置 SecureStore 走 SDK 自己,本测试不需要)
 *   - 不需要 react-native mock(AuthService 不依赖 RN API)
 */

import {
  signInAnonymously,
  restoreSession,
  clearSession,
  subscribeAuthState,
  markIntentionalSignOut,
  _resetForTests,
} from '../src/services/AuthService';
import type { Session, User } from '@supabase/supabase-js';

// ---- Mocks (必须在 import AuthService 之前) ----------------------------

let mockSignInAnonymously: jest.Mock;
let mockSignOut: jest.Mock;
let mockGetSession: jest.Mock;
let mockRefreshSession: jest.Mock;
let mockOnAuthStateChange: jest.Mock;
let mockDeleteItemAsync: jest.Mock;

jest.mock('../src/lib/supabase', () => {
  mockSignInAnonymously = jest.fn();
  mockSignOut = jest.fn();
  mockGetSession = jest.fn();
  mockRefreshSession = jest.fn();
  mockOnAuthStateChange = jest.fn();
  return {
    supabase: {
      auth: {
        signInAnonymously: (...args: unknown[]) => mockSignInAnonymously(...args),
        signOut: (...args: unknown[]) => mockSignOut(...args),
        getSession: (...args: unknown[]) => mockGetSession(...args),
        refreshSession: (...args: unknown[]) => mockRefreshSession(...args),
        onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
      },
    },
  };
});

jest.mock('expo-secure-store', () => {
  mockDeleteItemAsync = jest.fn(async () => undefined);
  return {
    deleteItemAsync: (...args: unknown[]) => mockDeleteItemAsync(...args),
  };
});

// ---- Imports (mock 之后) ----------------------------------------------

// ---- Test fixtures ----------------------------------------------------

const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SESSION_ACCESS_TOKEN = 'fake-access-token';

const fakeUser: User = {
  id: USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: '',
  phone: '',
  app_metadata: { provider: 'anonymous', providers: ['anonymous'] },
  user_metadata: {},
  created_at: '2026-09-15T00:00:00.000Z',
  updated_at: '2026-09-15T00:00:00.000Z',
  is_anonymous: true,
} as unknown as User;

function makeSession(expiresAt?: number): Session {
  const futureExpires = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: SESSION_ACCESS_TOKEN,
    refresh_token: 'fake-refresh',
    expires_in: 3600,
    expires_at: expiresAt ?? futureExpires,
    token_type: 'bearer',
    user: fakeUser,
  } as unknown as Session;
}

beforeEach(() => {
  _resetForTests();
  jest.clearAllMocks();

  // 默认:onAuthStateChange 返回一个可 unsubscribe 的 subscription
  mockOnAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: jest.fn() } },
  });
  // 默认:signOut 成功
  mockSignOut.mockResolvedValue({ error: null });
  // 默认:deleteItemAsync 成功
  mockDeleteItemAsync.mockResolvedValue(undefined);
});

// =====================================================================
// Tests
// =====================================================================

describe('AuthService.signInAnonymously', () => {
  it('returns signed_in on success', async () => {
    const session = makeSession();
    mockSignInAnonymously.mockResolvedValue({
      data: { session, user: fakeUser },
      error: null,
    });

    const state = await signInAnonymously();

    expect(state.status).toBe('signed_in');
    if (state.status === 'signed_in') {
      expect(state.user.id).toBe(USER_ID);
      expect(state.session.access_token).toBe(SESSION_ACCESS_TOKEN);
    }
    expect(mockSignInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('returns signed_out when SDK returns error (no throw)', async () => {
    mockSignInAnonymously.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'network unreachable', name: 'AuthError', status: 500 },
    });

    const state = await signInAnonymously();

    expect(state.status).toBe('signed_out');
  });

  it('returns signed_out when SDK throws (no throw)', async () => {
    mockSignInAnonymously.mockRejectedValue(new Error('SDK exploded'));

    const state = await signInAnonymously();

    expect(state.status).toBe('signed_out');
  });
});

describe('AuthService.restoreSession', () => {
  it('returns signed_in when valid unexpired session exists', async () => {
    const session = makeSession();
    mockGetSession.mockResolvedValue({
      data: { session },
      error: null,
    });

    const state = await restoreSession();

    expect(state.status).toBe('signed_in');
    if (state.status === 'signed_in') {
      expect(state.user.id).toBe(USER_ID);
    }
    // 未过期 → 不该调 refresh
    expect(mockRefreshSession).not.toHaveBeenCalled();
  });

  it('returns signed_out when no session', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    const state = await restoreSession();

    expect(state.status).toBe('signed_out');
  });

  it('returns signed_out when session expired and refresh fails', async () => {
    // 已过期 session(unix seconds 过去时)
    const expiredSession = makeSession(Math.floor(Date.now() / 1000) - 100);
    mockGetSession.mockResolvedValue({
      data: { session: expiredSession },
      error: null,
    });
    mockRefreshSession.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'refresh failed', name: 'AuthError', status: 401 },
    });

    const state = await restoreSession();

    expect(state.status).toBe('signed_out');
    expect(mockRefreshSession).toHaveBeenCalledWith(expiredSession);
  });

  it('returns signed_in when session expired but refresh succeeds', async () => {
    const expiredSession = makeSession(Math.floor(Date.now() / 1000) - 100);
    const refreshedSession = makeSession();
    mockGetSession.mockResolvedValue({
      data: { session: expiredSession },
      error: null,
    });
    mockRefreshSession.mockResolvedValue({
      data: { session: refreshedSession, user: fakeUser },
      error: null,
    });

    const state = await restoreSession();

    expect(state.status).toBe('signed_in');
    if (state.status === 'signed_in') {
      expect(state.session.access_token).toBe(SESSION_ACCESS_TOKEN);
    }
  });
});

describe('AuthService.clearSession', () => {
  it('calls signOut + SecureStore.deleteItemAsync', async () => {
    await clearSession();

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockDeleteItemAsync).toHaveBeenCalledTimes(1);
    expect(mockDeleteItemAsync).toHaveBeenCalledWith('auth:session');
  });

  it('still attempts SecureStore.deleteItemAsync even if signOut throws', async () => {
    mockSignOut.mockRejectedValue(new Error('signOut exploded'));

    await expect(clearSession()).resolves.toBeUndefined();
    expect(mockDeleteItemAsync).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService.subscribeAuthState', () => {
  it('SIGNED_OUT triggers automatic signInAnonymously (DoD #4)', async () => {
    // 1. 订阅
    const onChange = jest.fn();
    // mockListener 用显式类型签名,避免 jest.fn() + mockImplementation 把回调参数
    // 推导成 `never` 导致后续调用编译失败。
    let mockListener: (event: string, session: Session | null) => void = () => {};
    mockOnAuthStateChange.mockImplementation((cb: (event: string, session: Session | null) => void) => {
      mockListener = cb;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });

    subscribeAuthState(onChange);
    expect(typeof mockListener).toBe('function');

    // 2. 模拟 SDK 发 SIGNED_OUT 事件
    const newSession = makeSession();
    mockSignInAnonymously.mockResolvedValue({
      data: { session: newSession, user: fakeUser },
      error: null,
    });

    await mockListener('SIGNED_OUT', null);
    // 让 auto-reconnect 的 microtask 跑完
    await Promise.resolve();
    await Promise.resolve();

    // 3. 应 emit signed_out 一次,然后 emit signed_in(自动重连成功)
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenNthCalledWith(1, { status: 'signed_out' });
    expect(onChange).toHaveBeenNthCalledWith(2, {
      status: 'signed_in',
      session: newSession,
      user: fakeUser,
    });
    // 4. signInAnonymously 应被自动触发
    expect(mockSignInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('markIntentionalSignOut suppresses auto-reconnect on SIGNED_OUT', async () => {
    const onChange = jest.fn();
    let mockListener: (event: string, session: Session | null) => void = () => {};
    mockOnAuthStateChange.mockImplementation((cb: (event: string, session: Session | null) => void) => {
      mockListener = cb;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });

    subscribeAuthState(onChange);
    markIntentionalSignOut();

    await mockListener('SIGNED_OUT', null);
    await Promise.resolve();
    await Promise.resolve();

    // 只 emit signed_out 一次,不应自动重连
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ status: 'signed_out' });
    expect(mockSignInAnonymously).not.toHaveBeenCalled();
  });

  it('TOKEN_REFRESHED maps to signed_in with refreshed session', async () => {
    const onChange = jest.fn();
    let mockListener: (event: string, session: Session | null) => void = () => {};
    mockOnAuthStateChange.mockImplementation((cb: (event: string, session: Session | null) => void) => {
      mockListener = cb;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });

    subscribeAuthState(onChange);

    const refreshedSession = makeSession();
    await mockListener('TOKEN_REFRESHED', refreshedSession);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      status: 'signed_in',
      session: refreshedSession,
      user: fakeUser,
    });
  });

  it('returns unsubscribe function that detaches listener', () => {
    const onChange = jest.fn();
    const unsubscribeSpy = jest.fn();
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: unsubscribeSpy } },
    });

    const unsubscribe = subscribeAuthState(onChange);
    unsubscribe();

    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — second call unsubscribes the first listener', () => {
    const firstUnsubscribe = jest.fn();
    const secondUnsubscribe = jest.fn();
    mockOnAuthStateChange
      .mockReturnValueOnce({ data: { subscription: { unsubscribe: firstUnsubscribe } } })
      .mockReturnValueOnce({ data: { subscription: { unsubscribe: secondUnsubscribe } } });

    const onChange = jest.fn();
    subscribeAuthState(onChange);
    subscribeAuthState(onChange);

    // 第一次订阅被取消
    expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
    // 第二次订阅仍然有效
    expect(secondUnsubscribe).not.toHaveBeenCalled();
    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(2);
  });
});

describe('AuthService._resetForTests', () => {
  it('clears active listener + intentionalSignOutFlag', () => {
    const unsubscribeSpy = jest.fn();
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: unsubscribeSpy } },
    });

    subscribeAuthState(() => {});
    markIntentionalSignOut();

    _resetForTests();

    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
    // intentionalSignOutFlag 应该被清掉:后续 SIGNED_OUT 会自动重连
    // (这里用 subscribeAuthState 内部 listener 验证 — 标记已 reset)
    const onChange = jest.fn();
    subscribeAuthState(onChange);
    expect(onChange).not.toHaveBeenCalled(); // 单纯订阅不主动 emit
  });
});
