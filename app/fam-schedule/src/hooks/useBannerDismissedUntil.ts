/**
 * useBannerDismissedUntil — 订阅 banner 关闭状态 — T-US015-4
 *
 * 职责(US-015 故事 4 — banner 关闭状态持久化):
 *   1. mount 时从 AsyncStorage 读 `banner:dismissed_until`(unixtime ms)
 *   2. 与 `Date.now()` 对比:timestamp > now → dismissed=true(关闭生效中)
 *      否则 dismissed=false(过 24h 自动过期 / 从未关过 / 已 reset)
 *   3. dismiss() 写入 now + DISMISS_THRESHOLD_MS(默认 24h),立即更新 state
 *   4. reset() 清空 AsyncStorage key(留 Realtime count 减 0 时父层主动重置用)
 *
 * 设计依据:
 *   - 任务 brief §A.2 自决 24h 自动重置(给过期任务刷新窗口)
 *   - 设计 home-v1.0 §3.3 banner 视觉;关闭按钮由 ExpiredTasksBanner 父组件渲染
 *   - 同 useTasks / useExpiredTaskCount 模式:mount 时单次 IO,后续 state-only 更新
 *
 * 不存任何 supabase 引用 — 纯客户端本地偏好,刷新 app 重启也保留。
 *
 * Realtime 推送 → count 变 → 父层(HomeScreen)可调 reset() 让 banner 重新出现,
 * 但本 hook 不主动 watch count(单一职责)— 联动由 caller 决定。
 *
 * 不在范围:
 *   - ❌ 多 banner 类型(目前只服务 ExpiredTasksBanner)
 *   - ❌ 用户偏好设置 UI(留后续 polish)
 *   - ❌ 服务端同步(本地偏好,不跨设备同步 — 后续如需 push 到 user_settings 表再扩展)
 */

import { useCallback, useEffect, useState } from 'react';

import {
  getBannerDismissedUntil,
  setBannerDismissedUntil,
} from '../lib/LocalStore';

// =====================================================================
// Constants
// =====================================================================

/**
 * banner dismissed 默认持续时长 — 24h。
 *
 * 设计决策:
 *   - 24h 覆盖一个完整"过夜 + 白天"周期,用户白天提醒一次,夜里不打扰
 *   - 不需要服务端下发 — 本地策略单一来源
 *   - 后续如需可调,只需改这一处;hook 暴露 DISMISS_THRESHOLD_MS re-export 便于测试
 */
export const DISMISS_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// =====================================================================
// Public API
// =====================================================================

export interface UseBannerDismissedUntilState {
  /**
   * 当前是否处于 dismissed 状态:
   *   - true  → AsyncStorage 存了未过期的 timestamp(now < until)
   *   - false → 未关过 / 已过期 / 已 reset
   */
  dismissed: boolean;
  /**
   * 是否仍在 mount 时读 AsyncStorage — true 时 caller 应不渲染 banner(避免闪烁)
   * dismissed=false 兜底默认值
   */
  loadingDismiss: boolean;
  /**
   * 立即关闭 banner:写 AsyncStorage + 更新 local state,持续 24h
   */
  dismiss: () => Promise<void>;
  /**
   * 显式清空 dismissed_until(让 banner 重新可见)— 留给 Realtime count 减 0 后
   * 的父层主动重置
   */
  reset: () => Promise<void>;
}

// =====================================================================
// Hook
// =====================================================================

/**
 * 订阅 banner dismissed 状态 — mount 时一次 IO,后续 state-only 更新。
 *
 * @returns { dismissed, loadingDismiss, dismiss, reset } — UI 消费 + 副作用入口
 */
export function useBannerDismissedUntil(): UseBannerDismissedUntilState {
  const [dismissedUntil, setDismissedUntil] = useState<number | null>(null);
  const [loadingDismiss, setLoadingDismiss] = useState<boolean>(true);

  // mount 时单次 IO 读 dismissed_until
  useEffect(() => {
    let cancelled = false;
    void getBannerDismissedUntil()
      .then((ts) => {
        if (cancelled) return;
        setDismissedUntil(ts);
      })
      .catch((err) => {
        // getJSON 内部已 try/catch 返回 null — 兜底:异常时不阻塞 UI
        // eslint-disable-next-line no-console
        console.warn('[useBannerDismissedUntil] getBannerDismissedUntil threw:', err);
        if (cancelled) return;
        setDismissedUntil(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingDismiss(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 派生:dismissed = dismissedUntil > Date.now() → 未过期即视为 dismissed
  // 注意:Date.now() 在每次 render 都重算 — 但只用于 boolean 派生,不触发额外 effect
  const dismissed =
    dismissedUntil !== null && dismissedUntil > Date.now();

  const dismiss = useCallback(async (): Promise<void> => {
    const until = Date.now() + DISMISS_THRESHOLD_MS;
    // 先更新 state 让 UI 立即消失(不等 AsyncStorage)
    setDismissedUntil(until);
    // 写盘失败不抛错(throw 会让 UI 在再次进 banner 看见旧状态) — 仅 warn
    try {
      await setBannerDismissedUntil(until);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[useBannerDismissedUntil] setBannerDismissedUntil threw:', err);
    }
  }, []);

  const reset = useCallback(async (): Promise<void> => {
    setDismissedUntil(null);
    try {
      await setBannerDismissedUntil(null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[useBannerDismissedUntil] reset threw:', err);
    }
  }, []);

  return { dismissed, loadingDismiss, dismiss, reset };
}
