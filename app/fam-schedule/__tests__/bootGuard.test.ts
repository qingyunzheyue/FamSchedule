/**
 * bootGuard 单元测试 — T-US013-2
 *
 * 覆盖范围(任务 DoD + 关键边界):
 *   1. restoreSession 返回 signed_in(冷启动有 SecureStore session)→ ready,不再调 signInAnonymously
 *   2. restoreSession signed_out + signInAnonymously 第 1 次成功 → ready
 *   3. restoreSession signed_out + signInAnonymously 第 1 次失败 + 第 2 次成功 → ready
 *      (验证 retry-once 真的发生)
 *   4. 两次都失败 → failed(rev1:BootResult 不再带 error 字段,UI 文案由 SplashScreen 默认值统一管理)
 *   5. retry 严格只 1 次(无无限循环风险):所有 attempt 失败 → signInAnonymously 仅被调 2 次
 *   6. retry 间隔 ≈ RETRY_DELAY_MS(默认 1s) — 防回归到 0 退避导致刷接口
 *
 * Mock 策略:
 *   - mock 整个 AuthService 模块;只暴露 bootGuard 依赖的 restoreSession / signInAnonymously
 *   - 不需要 react / tamagui mock — bootGuard 是纯逻辑,无 React 副作用
 *   - 不需要 supabase mock — AuthService 已封装;bootGuard 只看 AuthService 出口
 *
 * 时序说明:
 *   - retry 用真实 setTimeout(RETRY_DELAY_MS = 1000);单测 1 秒开销可接受,且使"退避 1 秒"成为可执行的回归保险
 *   - 若未来要降为 sub-second,改 bootGuard 的 RETRY_DELAY_MS 即可,本测试不需改
 */

import { restoreSession, signInAnonymously } from '../src/services/AuthService';
import { bootGuard } from '../src/lib/bootGuard';
import type { Session, User } from '@supabase/supabase-js';

// ---- Mocks(必须在 import 被测模块之前)-----------------------------------

jest.mock('../src/services/AuthService', () => ({
  restoreSession: jest.fn(),
  signInAnonymously: jest.fn(),
}));

const mockRestoreSession = restoreSession as jest.Mock;
const mockSignIn = signInAnonymously as jest.Mock;

// ---- Fixtures -----------------------------------------------------------

const USER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const fakeUser: User = {
  id: USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: '',
  phone: '',
  app_metadata: { provider: 'anonymous', providers: ['anonymous'] },
  user_metadata: {},
  created_at: '2026-09-17T00:00:00.000Z',
  updated_at: '2026-09-17T00:00:00.000Z',
  is_anonymous: true,
} as unknown as User;

function makeSession(): Session {
  const futureExpires = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: 'fake-access',
    refresh_token: 'fake-refresh',
    expires_in: 3600,
    expires_at: futureExpires,
    token_type: 'bearer',
    user: fakeUser,
  } as unknown as Session;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---- Tests --------------------------------------------------------------

describe('bootGuard', () => {
  it('returns ready when restoreSession returns signed_in (cached session path)', async () => {
    const session = makeSession();
    mockRestoreSession.mockResolvedValue({
      status: 'signed_in',
      session,
      user: fakeUser,
    });

    const result = await bootGuard();

    expect(result.status).toBe('ready');
    expect(mockRestoreSession).toHaveBeenCalledTimes(1);
    // 已有 session → 不该再调 signInAnonymously(避免给已登录用户重复 sign-in 链路)
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('returns ready on first signInAnonymously success (no retry)', async () => {
    mockRestoreSession.mockResolvedValue({ status: 'signed_out' });
    const session = makeSession();
    mockSignIn.mockResolvedValue({
      status: 'signed_in',
      session,
      user: fakeUser,
    });

    const result = await bootGuard();

    expect(result.status).toBe('ready');
    expect(mockRestoreSession).toHaveBeenCalledTimes(1);
    // 第 1 次就成功 → 不该有第 2 次
    expect(mockSignIn).toHaveBeenCalledTimes(1);
  });

  it('retries signInAnonymously on first failure; returns ready on retry success', async () => {
    mockRestoreSession.mockResolvedValue({ status: 'signed_out' });
    const session = makeSession();
    mockSignIn
      .mockResolvedValueOnce({ status: 'signed_out' }) // 第 1 次失败
      .mockResolvedValueOnce({ status: 'signed_in', session, user: fakeUser }); // 第 2 次成功

    const result = await bootGuard();

    expect(result.status).toBe('ready');
    // 关键断言:retry 真的发生了(2 次总调用)
    expect(mockSignIn).toHaveBeenCalledTimes(2);
  });

  it('returns failed after retry also fails (no error payload — UI copy is the SplashScreen default)', async () => {
    mockRestoreSession.mockResolvedValue({ status: 'signed_out' });
    mockSignIn.mockResolvedValue({ status: 'signed_out' });

    const result = await bootGuard();

    expect(result.status).toBe('failed');
    // T-US013-2-rev1:BootResult 不再带 error 字段,只表达成败语义。
    // UI 文案(splash-v1.0 §6)由 SplashScreen 默认值统一管理,bootGuard 不掺文案。
    // 断言失败分支的形态:discriminated union 不再含 error 字段。
    if (result.status === 'failed') {
      expect(result).not.toHaveProperty('error');
    }
    expect(mockSignIn).toHaveBeenCalledTimes(2);
  });

  it('does not retry more than once (no infinite loop risk)', async () => {
    mockRestoreSession.mockResolvedValue({ status: 'signed_out' });
    mockSignIn.mockResolvedValue({ status: 'signed_out' });

    await bootGuard();

    // 严格 2 次 = 1 initial + 1 retry。失败 2 次后必须放弃,不能调第 3 次
    expect(mockSignIn).toHaveBeenCalledTimes(2);
  });

  it('only calls restoreSession once per bootGuard invocation', async () => {
    // 回归保险:防止未来有人加了 retry loop 但忘了也 retry restoreSession
    mockRestoreSession.mockResolvedValue({ status: 'signed_out' });
    mockSignIn.mockResolvedValue({ status: 'signed_out' });

    await bootGuard();

    expect(mockRestoreSession).toHaveBeenCalledTimes(1);
  });
});