/**
 * useTasks — 订阅 SyncManager.tasks 快照的 React hook — T-US002-1
 *
 * 职责(US-002 闭环第一步 — 把 LocalStore 镜像推到 UI):
 *   - 订阅 SyncManager.tasksSnapshot(SyncManager 在 setTasks / pullSince /
 *     handleRealtimeChange / applyOptimisticUpdate 时通过 setTasksAndNotify 写入)
 *   - 把外部 store 接入 React 渲染:用 useSyncExternalStore 避免 tearing
 *
 * 设计依据:
 *   - React 18+ useSyncExternalStore:concurrent rendering 下保证外部 store
 *     读取与渲染一致(SSR 安全 + tearing 防御)
 *   - SyncManager 已暴露 `getTasksSnapshot`(同步读)和 `subscribeTasks`(订阅)
 *     —— useSyncExternalStore 直接对接,无需额外的 adapter 层
 *
 * 行为契约:
 *   - mount → 同步取一次 snapshot
 *   - subscribeTasks 触发 → React 重渲染(再读一次 snapshot)
 *   - 首次 mount 时若 SyncManager 还未 pullSince 完,返回 []
 *     UI 层配合 isLoading state(pullSince 进行中)决定显示 Skeleton / 空状态
 *
 * 不在本 hook 范围:
 *   - 视图筛选(today/week/all):留给 HomeScreen 内的 useMemo + lib/taskListFilters
 *   - pullSince 触发:UI 直接 import SyncManager.pullSince() + getLastSyncAt()
 *   - 任务写(checkin / create):由 SyncManager.enqueueAndApply + useTasks 自然刷新
 *
 * 测试策略:
 *   - 单元测试集中在 __tests__/useTasks.test.tsx:覆盖 listener 机制 + unsubscribe
 *   - 本 hook 本身很短(useSyncExternalStore 三参数),不需要单测分支
 */

import { useSyncExternalStore } from 'react';

import { getTasksSnapshot, subscribeTasks } from '../lib/SyncManager';
import type { Task } from '../lib/LocalStore';

/**
 * 返回当前 SyncManager 维护的 tasks 快照数组。
 *
 * 注意:
 *   - 返回值是**只读视图** —— 不要直接 mutate(否则绕过 SyncManager 的 LWW 合并)。
 *     如需写,走 SyncManager.enqueueAndApply。
 *   - 数组每次 SyncManager setTasksAndNotify 后**引用会变**(新数组),
 *     useSyncExternalStore 看到引用变化触发 re-render。
 *
 * @example
 * ```tsx
 * function HomeScreen() {
 *   const tasks = useTasks();
 *   const filtered = useMemo(() => filterTasks(tasks, 'today', today), [tasks]);
 *   return <TaskList tasks={filtered} ... />;
 * }
 * ```
 */
export function useTasks(): Task[] {
  return useSyncExternalStore(
    subscribeTasks,
    getTasksSnapshot,
    // SSR fallback —— 服务端没有 SyncManager 状态,返回空数组
    (): Task[] => [],
  );
}
