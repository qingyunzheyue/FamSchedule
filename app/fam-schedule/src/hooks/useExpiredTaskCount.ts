/**
 * useExpiredTaskCount — 订阅过期任务数的 React hook — T-US015-1
 *
 * 职责(US-015 启动过期任务提示 — 端到端第二步;banner 渲染留 T-US015-2):
 *   1. 订阅 useTasks() — SyncManager 推送时(tasks INSERT/UPDATE/DELETE)自动重算
 *   2. 订阅 useFamilyValue() — family 上下文变化时(loading → in_family)
 *      自动触发 summary 拉取
 *   3. 调 ExpiryService.getExpiredTasksSummary — 读 family_settings.expiry_window +
 *      filterExpiredTasks
 *   4. 返回 {count, loading} — UI 消费(banner 显示文案用)
 *
 * 设计依据:
 *   - 设计 home-v1.0 §3.3 banner + §6 文案
 *   - 任务 brief §C.3 — hook 暴露 count + loading;banner 渲染留 T-US015-2
 *   - taskListFilters.useTasks hook 同模式(useSyncExternalStore + 单次会+订阅)
 *   - SyncManager 已订阅 family_settings 表(Realtime)— settings UPDATE 推送
 *     会自然更新 SyncManager 内部 settings cache;但本 hook 不直接消费 settings,
 *     而是通过 ExpiryService 单行 SELECT 读最新值(useEffect deps 触发重算)
 *
 * 模块形态:
 *   - 函数 hook,无 memo 包过(返回 {count, loading} 是 primitive — 不优化重渲染)
 *   - useEffect deps:[family?.family.id, tasks, today] — 任一变化触发重算
 *   - useState 内部存 count + loading;effect 启动时 setLoading(true),完成后
 *     setCount + setLoading(false);cleanup 设 cancelled flag 防 race condition
 *
 * 简化决策(明确记录):
 *   - ❌ Banner 渲染(留 T-US015-2)— 本任务只暴露 count + loading
 *   - ❌ Banner 关闭状态(留 T-US015-3)— 本任务不暴露 dismiss 入口
 *   - ❌ useState memo 包过 — primitive 值 + caller 通常 useMemo 缓存消费
 *
 * 性能:
 *   - useEffect 触发时(任务变化 / family 变化 / today 变化)异步调 service
 *   - service 单次 SELECT family_settings 单行(~50ms)— 启动时一次可接受
 *   - 后续任务 INSERT/UPDATE/DELETE 通过 useTasks 监听自动触发重算
 *   - 极端高频(用户在另一个 tab 频繁改任务)— effect 串行 await,旧的 promise
 *     cancelled flag 丢弃结果;不会出现"过时数据覆盖新数据"的 race
 *
 * 不在范围:
 *   - ❌ family_settings UPDATE Realtime 显式监听(SyncManager 已订阅 settings,
 *     但本 hook 走 service 单行 SELECT,不等 settings event;用户改设置后,下次
 *     tasks 变化或 family 变化时重算即生效)
 *   - ❌ Banner 渲染 / 点击跳过期列表(留 T-US015-2 / T-US015-3)
 *   - ❌ Banner 关闭状态持久化(留 T-US015-3)
 */

import { useEffect, useState } from 'react';

import { useTasks } from './useTasks';
import { useFamilyValue } from '../contexts/FamilyContext';
import { getExpiredTasksSummary } from '../services/ExpiryService';
import type { Task } from '../lib/LocalStore';

// =====================================================================
// Public API
// =====================================================================

export interface ExpiredTaskCountState {
  /** 过期任务总数(0 = 无过期任务,banner 不显示由 T-US015-2 决定) */
  count: number;
  /** 当前是否正在拉取 summary — UI 可选显示 Skeleton / spinner */
  loading: boolean;
}

/**
 * 订阅过期任务数 — 响应 Realtime tasks 推送 + family 上下文变化。
 *
 * useEffect deps 拆解:
 *   - `family?.family.id`:family 变化 / loading → in_family 时触发
 *     (不显式切 deps[family],因为 family 对象引用每次 render 都变 — 用 family?.family.id
 *     字符串稳定性更高)
 *   - `tasks`:tasks 数组引用变化(Realtime 推送 / pullSince 兜底)→ 触发重算
 *   - `today`:跨日时(用户停留页面跨 0:00)— 触发重算(today 字符串变化)
 *     注意:today 由 caller 注入(避免 hook 内部 Date.now() 漂移)
 *
 * @param today — 'YYYY-MM-DD' 本地时区日期字面量(由 HomeScreen 等 caller 注入,
 *               与 filterTasks / computeTaskBadge 同一 today 来源)
 * @returns {count, loading} — UI 消费
 */
export function useExpiredTaskCount(today: string): ExpiredTaskCountState {
  const tasks = useTasks();
  const family = useFamilyValue();
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 防御:无 family(loading / no_family)— 返 0 + loading=false,不做 supabase 调用
    if (!family) {
      setCount(0);
      setLoading(false);
      return;
    }

    // 进入正常路径:setLoading(true) 触发 UI 可选渲染 spinner;
    // cancelled flag 防 race condition(useEffect cleanup 时设 true,旧 promise 结果丢弃)
    let cancelled = false;
    setLoading(true);

    void getExpiredTasksSummary(family.family.id, tasks, today)
      .then((summary) => {
        if (cancelled) return;
        setCount(summary.count);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        // 防御:ExpiryService 内部已 try/catch,理论上不到这 — 保留兜底避免 UI 卡死
        // eslint-disable-next-line no-console
        console.warn('[useExpiredTaskCount] getExpiredTasksSummary threw:', err);
        setCount(0);
        setLoading(false);
      });

    // cleanup:cancelled flag 阻止旧 promise 覆盖新 state
    return () => {
      cancelled = true;
    };
    // deps 拆解说明:
    //   - family?.family.id:family 上下文变化(loading → in_family / 切换 family)
    //   - tasks:Realtime 推送 / pullSince → useTasks 触发新引用
    //   - today:跨日 / caller 重算时变化
    // 故意忽略 family 对象引用(每次 render 引用都变),用 .family.id 字符串稳定
  }, [family?.family.id, tasks, today]);

  return { count, loading };
}

// Re-export 让 UI 消费 service 类型(避免 import service 直接耦合)
export type { Task };