/**
 * inviteCountdown — T-US012-2 拆出
 *
 * 纯倒计时逻辑(无 React / Tamagui 依赖,可独立单测):
 *   1. `formatCountdown(remainingMs)` — mm:ss 格式化(纯函数)
 *   2. `useInviteCountdown(expiresAtMs)` — React hook,每秒 tick + 自动 cleanup
 *
 * 设计动机:把"时间计算"和"UI 渲染"解耦。
 *   - hook 可在 jest 下用 `useFakeTimers()` 直接测,无需起 TamaguiProvider
 *     (jest-expo preset + Tamagui 在 jest 下加载 setup.native.js 报 ESM 错,
 *     该问题在本任务 scope 外 — 见 task-breakdown handoff notes)
 *   - UI 层(src/screens/InviteScreen.tsx)只负责根据 hook 输出做视觉渲染
 *
 * 测试覆盖:
 *   - __tests__/InviteScreen.test.tsx(纯 hook + formatCountdown)
 *   - 视觉回归留给 ui-ux / 手动 / EAS build 后真机验证
 */

import { useEffect, useMemo, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------------

/**
 * 倒计时显示格式:2 位分 + 2 位秒(mm:ss),如 "09:42"。
 * 用 padStart 保证个位数也显示 2 位(用户友好,避免 "9:2" 闪跳)。
 *
 * 防御:负数 / NaN / Infinity 都规范成 "00:00"。
 */
export function formatCountdown(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs < 0) {
    return '00:00';
  }
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface InviteCountdown {
  /** 剩余毫秒数(≥ 0,已过期为 0) */
  remainingMs: number;
  /** 是否已过期(remainingMs === 0 且 expiresAtMs 非 null) */
  expired: boolean;
  /** mm:ss 格式化剩余时间 */
  text: string;
}

/**
 * 倒计时 hook:每秒 tick 一次,自动 cleanup。
 *
 * 设计:暴露 `remainingMs` / `expired` / `text` 给 UI 层渲染;
 * 不持有"过期自动清除"逻辑 — 那是 UI 状态机的职责,hook 只算时间。
 *
 * 参数:`expiresAtMs: number | null`
 *   - null → hook 不启动 tick,返回 { remainingMs: 0, expired: false }
 *   - 非 null → 启动 1s setInterval,每 tick 更新内部时间 now,re-render 触发 UI 重算
 *
 * 测试友好:
 *   - `jest.useFakeTimers()` 可控制 setInterval
 *   - props 变化时 reset now(避免显示陈旧的"剩余时间")
 *   - hook 自身只做"时间差计算",副作用清理明确
 */
export function useInviteCountdown(expiresAtMs: number | null): InviteCountdown {
  const [now, setNow] = useState<number>(() => Date.now());
  // 跟踪 props 变化:每次 expiresAtMs 变化重置 now,避免显示陈旧的"剩余时间"
  const prevExpiresAtRef = useRef<number | null>(expiresAtMs);
  useEffect(() => {
    if (prevExpiresAtRef.current !== expiresAtMs) {
      prevExpiresAtRef.current = expiresAtMs;
      setNow(Date.now());
    }
  }, [expiresAtMs]);

  // 倒计时 tick — expiresAtMs 非 null 时启动
  useEffect(() => {
    if (expiresAtMs === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAtMs]);

  return useMemo(() => {
    const remainingMs =
      expiresAtMs !== null ? Math.max(0, expiresAtMs - now) : 0;
    const expired = expiresAtMs !== null && remainingMs === 0;
    return {
      remainingMs,
      expired,
      text: formatCountdown(remainingMs),
    };
  }, [expiresAtMs, now]);
}