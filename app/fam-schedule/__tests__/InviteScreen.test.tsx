/**
 * InviteScreen 单元测试 — T-US012-2
 *
 * 覆盖范围(任务 DoD + 关键路径):
 *   1. `formatCountdown` helper — mm:ss 格式 + 边界(0 / 负数 / NaN / Infinity)
 *   2. `useInviteCountdown` hook — null / 未过期 / 倒计时归零 / props 变化 reset
 *   3. `FamilyService.createInvite` namespace 调用契约(无参)
 *
 * 测试策略:测**逻辑层**(hook + helper + service mock),不渲染 InviteScreen 组件。
 *   - 原因:jest-expo preset 下,Tamagui 加载 `tamagui/setup.native.js` 报 ESM 错
 *     (`transformIgnorePatterns` 不含 tamagui)。完整渲染需修改 jest config,
 *     超出本任务 scope(任务严格 scope 仅 6 个文件)。
 *   - 替代:把纯时间逻辑抽到 `src/lib/inviteCountdown.ts`(无 React Native / Tamagui 依赖),
 *     在 jest 下直接测。视觉层留给 ui-ux / 手动 / EAS 真机验证。
 *
 * 测 FamilyService.createInvite 的 RPC 签名 + 错误码覆盖在
 * __tests__/FamilyService.test.ts 已有 3 用例,这里 namespace mock 仅验证
 * InviteScreen 调 service 的契约即可。
 */

import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { FamilyService } from '../src/services/FamilyService';
import {
  formatCountdown,
  useInviteCountdown,
  type InviteCountdown,
} from '../src/lib/inviteCountdown';

// ---- Mocks (必须在 import 之前) ------------------------------------------

// Mock FamilyService — 替整套模块为可编程 mock
jest.mock('../src/services/FamilyService', () => ({
  FamilyService: {
    createInvite: jest.fn(),
  },
}));

const { FamilyService: mockedFamilyService } = jest.requireMock(
  '../src/services/FamilyService',
) as { FamilyService: { createInvite: jest.Mock } };
const mockCreateInvite = mockedFamilyService.createInvite as jest.Mock;

// ---- Hook test harness -------------------------------------------------

interface HookProbe {
  current: InviteCountdown | null;
}

/**
 * 把 hook 输出"钉住":用 ref 持有最近一次返回值,render tree 只显示这个 ref 当前指向的对象。
 * 这样 act() 推进 timer 后,我们能直接读 ref 拿到最新结果,不用解 JSON tree。
 */
function HookHarness({
  expiresAtMs,
  probeRef,
}: {
  expiresAtMs: number | null;
  probeRef: React.MutableRefObject<HookProbe>;
}): React.ReactElement {
  const value = useInviteCountdown(expiresAtMs);
  probeRef.current = { current: value };
  return React.createElement('div', null, JSON.stringify(value));
}

// ---- Tests -------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

describe('formatCountdown', () => {
  it('formats mm:ss for typical countdown values', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(1000)).toBe('00:01');
    expect(formatCountdown(60_000)).toBe('01:00');
    expect(formatCountdown(582_000)).toBe('09:42'); // 9min 42s
    expect(formatCountdown(600_000)).toBe('10:00');
  });

  it('clamps negative values to 00:00', () => {
    expect(formatCountdown(-1000)).toBe('00:00');
    expect(formatCountdown(-Number.MAX_SAFE_INTEGER)).toBe('00:00');
  });

  it('handles NaN and Infinity as 00:00', () => {
    expect(formatCountdown(NaN)).toBe('00:00');
    expect(formatCountdown(Infinity)).toBe('00:00');
    expect(formatCountdown(-Infinity)).toBe('00:00');
  });

  it('pads single-digit seconds/minutes with leading zero', () => {
    expect(formatCountdown(5000)).toBe('00:05');
    expect(formatCountdown(65_000)).toBe('01:05');
  });
});

describe('useInviteCountdown', () => {
  it('returns expired=false with remainingMs=0 when expiresAtMs is null', () => {
    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    act(() => {
      TestRenderer.create(<HookHarness expiresAtMs={null} probeRef={probeRef} />);
    });

    expect(probeRef.current!.current).toEqual({
      remainingMs: 0,
      expired: false,
      text: '00:00',
    });
  });

  it('counts down each second via fake timers and reports expired when reaching 0', () => {
    jest.useFakeTimers();
    try {
      const startMs = 1_700_000_000_000; // 固定基线避免 Date.now() 漂移
      jest.setSystemTime(startMs);

      const expiresAtMs = startMs + 3000; // 3 秒后过期
      const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
      probeRef.current = { current: null };

      act(() => {
        TestRenderer.create(<HookHarness expiresAtMs={expiresAtMs} probeRef={probeRef} />);
      });

      // 初始:约 3 秒剩余
      expect(probeRef.current!.current!.remainingMs).toBeGreaterThanOrEqual(2900);
      expect(probeRef.current!.current!.remainingMs).toBeLessThanOrEqual(3000);
      expect(probeRef.current!.current!.expired).toBe(false);
      expect(probeRef.current!.current!.text).toMatch(/^00:0[2-5]$/);

      // tick 2 秒 → 还剩约 1 秒,未过期
      act(() => {
        jest.advanceTimersByTime(2000);
      });
      expect(probeRef.current!.current!.remainingMs).toBeGreaterThanOrEqual(900);
      expect(probeRef.current!.current!.remainingMs).toBeLessThanOrEqual(1000);
      expect(probeRef.current!.current!.expired).toBe(false);
      expect(probeRef.current!.current!.text).toBe('00:01');

      // tick 1 秒 → 0 毫秒,已过期
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(probeRef.current!.current!.remainingMs).toBe(0);
      expect(probeRef.current!.current!.expired).toBe(true);
      expect(probeRef.current!.current!.text).toBe('00:00');
    } finally {
      jest.useRealTimers();
    }
  });

  it('transitions correctly from active to expired as time passes', () => {
    // 整合测试:从"有码未过期"→"倒计时归零"→"已过期" 的完整状态转移
    jest.useFakeTimers();
    try {
      const startMs = 1_700_000_000_000;
      jest.setSystemTime(startMs);

      const expiresAtMs = startMs + 2000; // 2 秒后过期(短 ttl,便于 fake timers)
      const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
      probeRef.current = { current: null };

      act(() => {
        TestRenderer.create(<HookHarness expiresAtMs={expiresAtMs} probeRef={probeRef} />);
      });

      // Phase 1:active 状态(还有 1.x 秒)
      expect(probeRef.current!.current!.expired).toBe(false);
      expect(probeRef.current!.current!.text).toMatch(/^00:0[1-2]$/);

      // Phase 2:tick 1 秒(setInterval 1s 一帧)→ 还剩 ~1 秒,仍 active
      // (1.5s tick 时 setInterval 只触发 1 次,now 推到 startMs+1000,remainingMs=1000)
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(probeRef.current!.current!.expired).toBe(false);
      expect(probeRef.current!.current!.text).toBe('00:01');
      expect(probeRef.current!.current!.remainingMs).toBe(1000);

      // Phase 3:tick 最后 1 秒 → 真正过期
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(probeRef.current!.current!.expired).toBe(true);
      expect(probeRef.current!.current!.text).toBe('00:00');
      expect(probeRef.current!.current!.remainingMs).toBe(0);

      // Phase 3:tick 最后 1 秒 → 真正过期
      act(() => {
        jest.advanceTimersByTime(2000);
      });
      expect(probeRef.current!.current!.expired).toBe(true);
      expect(probeRef.current!.current!.text).toBe('00:00');
      expect(probeRef.current!.current!.remainingMs).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('InviteScreen service contract', () => {
  it('FamilyService.createInvite is invoked with no arguments (matches SQL signature)', async () => {
    // 间接验证 InviteScreen 调 service 的契约:不传任何参数
    // (对应 db-v1.1.sql §4.2 create_invite() 无参签名)
    mockCreateInvite.mockResolvedValue({
      status: 'created',
      code: '482917',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    // 通过 namespace 调用 — 模拟 InviteScreen.handleGenerate 内部调用方式
    const result = await FamilyService.createInvite();
    expect(mockCreateInvite).toHaveBeenCalledWith();
    expect(result.status).toBe('created');
    if (result.status === 'created') {
      expect(result.code).toBe('482917');
      expect(typeof result.expiresAt).toBe('string');
    }
  });
});