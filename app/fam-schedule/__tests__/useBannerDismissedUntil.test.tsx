/**
 * useBannerDismissedUntil 单元测试 — T-US015-4
 *
 * 覆盖范围(brief §D):
 *   1. mount → getBannerDismissedUntil 调用 1 次 → setState
 *   2. dismiss() → setBannerDismissedUntil(now + DISMISS_THRESHOLD_MS)
 *   3. reset() → setBannerDismissedUntil(null)
 *   4. 24h 后 → 返回 dismissed=false(用 fake timer 推时间)
 *   5. AsyncStorage mock 不会 throw(getJSON 内部 try/catch 兜底)
 *   6. loadingDismiss 状态:mount 时 true → IO 完成 false
 *
 * 测试策略(对齐 useExpiredTaskCount.test.tsx hook harness 模式):
 *   - jest-expo + React 19 + jest mock + react-test-renderer
 *   - HookHarness 把 hook 返回写到 probeRef,组件本身 render `<div />`
 *   - mock LocalStore(getBannerDismissedUntil / setBannerDismissedUntil)直接断言调用
 *   - jest.useFakeTimers() 让 Date.now() 可控,验证 24h 边界
 *
 * 严格 scope:
 *   - 不测 AsyncStorage 真盘(用 mock)— jest.setup.js 已 mock async-storage 包
 *   - 不测 useBannerDismissedUntil 跟 HomeScreen 集成(留 HomeScreen.test.tsx verify-by-source)
 *   - 不测 phosphor / theme
 */

import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  useBannerDismissedUntil,
  DISMISS_THRESHOLD_MS,
  type UseBannerDismissedUntilState,
} from '../src/hooks/useBannerDismissedUntil';

// ---- Mocks (mock LocalStore 模块,避免触发 AsyncStorage 真盘 + supabase 链) ----

jest.mock('../src/lib/LocalStore', () => {
  const actual = jest.requireActual('../src/lib/LocalStore');
  return {
    ...actual,
    getBannerDismissedUntil: jest.fn(),
    setBannerDismissedUntil: jest.fn(),
  };
});

import {
  getBannerDismissedUntil,
  setBannerDismissedUntil,
} from '../src/lib/LocalStore';

const mockGet = getBannerDismissedUntil as jest.MockedFunction<
  typeof getBannerDismissedUntil
>;
const mockSet = setBannerDismissedUntil as jest.MockedFunction<
  typeof setBannerDismissedUntil
>;

// ---- Hook harness -----------------------------------------------------

interface HookProbe {
  current: UseBannerDismissedUntilState | null;
}

function HookHarness({
  probeRef,
}: {
  probeRef: React.MutableRefObject<HookProbe>;
}): React.ReactElement {
  const state = useBannerDismissedUntil();
  probeRef.current = { current: state };
  return React.createElement('div');
}

beforeEach(() => {
  jest.clearAllMocks();
  // 默认 mock:never dismissed
  mockGet.mockResolvedValue(null);
  mockSet.mockResolvedValue(undefined);
});

// =====================================================================
// 1. mount → 单次 IO + loadingDismiss 状态切换
// =====================================================================

describe('useBannerDismissedUntil — mount IO contract', () => {
  it('calls getBannerDismissedUntil once on mount and sets state', async () => {
    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    await act(async () => {
      TestRenderer.create(React.createElement(HookHarness, { probeRef }));
      await Promise.resolve();
    });

    expect(mockGet).toHaveBeenCalledTimes(1);
    const state = probeRef.current!.current!;
    expect(state.dismissed).toBe(false); // null = 未 dismissed
    expect(state.loadingDismiss).toBe(false); // IO 完成
  });

  it('starts with loadingDismiss=true before first IO resolves', async () => {
    // 用可控 promise 让 IO 不立即 resolve
    let resolveFn: (v: number | null) => void = () => undefined;
    mockGet.mockImplementation(
      () =>
        new Promise<number | null>((resolve) => {
          resolveFn = resolve;
        }),
    );

    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(HookHarness, { probeRef }));
    });

    // IO 未完成
    expect(probeRef.current!.current!.loadingDismiss).toBe(true);

    // 释放 IO
    await act(async () => {
      resolveFn(null);
      await Promise.resolve();
    });

    expect(probeRef.current!.current!.loadingDismiss).toBe(false);
    renderer!.unmount();
  });

  it('uses fake timers — 24h after mount, dismissed_until still active', async () => {
    jest.useFakeTimers();
    const now = 1_700_000_000_000;
    jest.setSystemTime(now);
    // IO 已 resolved:返回 now + 1h(未过 24h)
    mockGet.mockResolvedValue(now + 60 * 60 * 1000);

    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    await act(async () => {
      TestRenderer.create(React.createElement(HookHarness, { probeRef }));
      // jest.useFakeTimers 后 Promise.resolve 也得推进 fake timer
      await Promise.resolve();
    });

    expect(probeRef.current!.current!.dismissed).toBe(true);

    jest.useRealTimers();
  });

  it('dismissed = false when dismissed_until is in the past', async () => {
    jest.useFakeTimers();
    const now = 1_700_000_000_000;
    jest.setSystemTime(now);
    mockGet.mockResolvedValue(now - 1000); // 1s 前 = 已过期

    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    await act(async () => {
      TestRenderer.create(React.createElement(HookHarness, { probeRef }));
      await Promise.resolve();
    });

    expect(probeRef.current!.current!.dismissed).toBe(false);

    jest.useRealTimers();
  });
});

// =====================================================================
// 2. dismiss() / reset() — 写盘 + state 更新
// =====================================================================

describe('useBannerDismissedUntil — dismiss() / reset() actions', () => {
  it('dismiss() writes now + DISMISS_THRESHOLD_MS to AsyncStorage + state', async () => {
    jest.useFakeTimers();
    const now = 1_700_000_000_000;
    jest.setSystemTime(now);

    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    await act(async () => {
      TestRenderer.create(React.createElement(HookHarness, { probeRef }));
      await Promise.resolve();
    });

    expect(probeRef.current!.current!.dismissed).toBe(false);

    // 调 dismiss
    await act(async () => {
      await probeRef.current!.current!.dismiss();
    });

    // state 立即更新
    expect(probeRef.current!.current!.dismissed).toBe(true);
    // mockSet 收到 now + DISMISS_THRESHOLD_MS
    expect(mockSet).toHaveBeenCalledWith(now + DISMISS_THRESHOLD_MS);

    jest.useRealTimers();
  });

  it('reset() writes null to AsyncStorage + state', async () => {
    jest.useFakeTimers();
    const now = 1_700_000_000_000;
    jest.setSystemTime(now);

    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    await act(async () => {
      TestRenderer.create(React.createElement(HookHarness, { probeRef }));
      await Promise.resolve();
    });

    // 先 dismiss
    await act(async () => {
      await probeRef.current!.current!.dismiss();
    });
    expect(probeRef.current!.current!.dismissed).toBe(true);

    // 再 reset
    await act(async () => {
      await probeRef.current!.current!.reset();
    });
    expect(probeRef.current!.current!.dismissed).toBe(false);
    expect(mockSet).toHaveBeenLastCalledWith(null);

    jest.useRealTimers();
  });

  it('dismiss() does not throw even if setBannerDismissedUntil rejects', async () => {
    mockSet.mockRejectedValueOnce(new Error('disk full'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    await act(async () => {
      TestRenderer.create(React.createElement(HookHarness, { probeRef }));
      await Promise.resolve();
    });

    // 不应抛错 — 写盘失败仅 console.warn
    await expect(probeRef.current!.current!.dismiss()).resolves.toBeUndefined();
    // 写盘失败仍尝试一次(setState 在 await 之前已调度)
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(expect.any(Number));
    // warn 已被调
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// =====================================================================
// 3. 24h 边界 — fake timer 推时间验证自动过期
// =====================================================================

describe('useBannerDismissedUntil — 24h auto-reset boundary', () => {
  it('after DISMISS_THRESHOLD_MS elapsed, dismissed flips back to false', async () => {
    jest.useFakeTimers();
    const now = 1_700_000_000_000;
    jest.setSystemTime(now);
    mockGet.mockResolvedValue(null);

    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(HookHarness, { probeRef }));
      await Promise.resolve();
    });

    // dismiss → 24h 后过期
    await act(async () => {
      await probeRef.current!.current!.dismiss();
    });
    expect(probeRef.current!.current!.dismissed).toBe(true);

    // 推 25h
    jest.setSystemTime(now + DISMISS_THRESHOLD_MS + 60 * 60 * 1000);

    // 派生值 dismissed 立即重算(每次 render 都 Date.now()),触发 re-render
    await act(async () => {
      renderer!.update(React.createElement(HookHarness, { probeRef }));
    });

    expect(probeRef.current!.current!.dismissed).toBe(false);
    renderer!.unmount();
    jest.useRealTimers();
  });
});

// =====================================================================
// 4. AsyncStorage mock 异常兜底 — getJSON 失败不应阻塞 UI
// =====================================================================

describe('useBannerDismissedUntil — AsyncStorage failure defense', () => {
  it('getBannerDismissedUntil rejection → dismissed=false + loadingDismiss=false', async () => {
    mockGet.mockRejectedValueOnce(new Error('AsyncStorage broken'));

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    await act(async () => {
      TestRenderer.create(React.createElement(HookHarness, { probeRef }));
      await Promise.resolve();
    });

    const state = probeRef.current!.current!;
    expect(state.dismissed).toBe(false); // 兜底:未 dismissed
    expect(state.loadingDismiss).toBe(false); // IO 兜底完成
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// =====================================================================
// 5. Public API 契约 — 暴露的 symbol + DISMISS_THRESHOLD_MS
// =====================================================================

describe('useBannerDismissedUntil — public API', () => {
  it('exports DISMISS_THRESHOLD_MS = 24h (86400000ms)', () => {
    expect(DISMISS_THRESHOLD_MS).toBe(24 * 60 * 60 * 1000);
    expect(DISMISS_THRESHOLD_MS).toBe(86_400_000);
  });

  it('returns UseBannerDismissedUntilState with all 4 fields', async () => {
    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    await act(async () => {
      TestRenderer.create(React.createElement(HookHarness, { probeRef }));
      await Promise.resolve();
    });

    const state = probeRef.current!.current!;
    expect(typeof state.dismissed).toBe('boolean');
    expect(typeof state.loadingDismiss).toBe('boolean');
    expect(typeof state.dismiss).toBe('function');
    expect(typeof state.reset).toBe('function');
  });
});
