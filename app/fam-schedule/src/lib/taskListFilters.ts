/**
 * taskListFilters — 任务列表的纯逻辑层 — T-US002-1
 *
 * 职责(US-002 端到端 — 从原始 tasks 数组到 UI 渲染数据):
 *   1. makeDatePredicate(view, today) — 把 3 种 view 模式(today/week/all)
 *      翻译成单个 task 的日期谓词(纯函数,可单独测试)
 *   2. filterTasks(tasks, view, today) — 谓词 + 排序(asc by task_date → task_time → created_at)
 *   3. computeTaskBadge(task, today) — 计算每张卡的状态 badge
 *      (discriminated union,UI 按 kind 上色)
 *   4. formatTaskTime(taskTime) — 'HH:MM:SS' → 'HH:MM';null → '全天'
 *
 * 设计依据:
 *   - home-v1.0.md §3.4-3.5 / §6 文案 + 状态
 *   - 任务 brief:badge 用 discriminated union 给 UI 分发颜色,UI 层不
 *     在 TaskCard 里做日期运算 —— 全部下沉到这里便于单测。
 *
 * 模块形态:
 *   - 纯函数 + type re-export,无副作用,无 module-level state
 *   - date 输入约定为 'YYYY-MM-DD'(task.task_date 的格式);
 *     内部 `addDays` / `daysBetween` 用本地时区,避免 UTC 偏移造成跨日错位。
 *
 * 简化决策(明确记录):
 *   - **week = today + 6 天**(7 天窗口,含 today),不是"自然周(周一到周日)"
 *     —— 家庭场景下"本周"语义 = 未来 7 天更自然(用户说"本周要交保险单"
 *     通常不是"必须本周一交",而是"这周内某天交")。后续 T-US002-2 可重审。
 *   - **date badge**:任务日期 > today + 6 天(超出 week)显示 M/D,例如 `9/22`;
 *     短格式 + 美式,跟"周X"对齐中文场景不优雅但 brief 明确要求。
 *
 * 不在范围(留后续任务):
 *   - ❌ 周期任务展开(T-US004-1)
 *   - ❌ 时段问候(Header 留 T-US002-2)
 *   - ❌ 过期 banner(T-US014 / T-US015)
 *   - ❌ Assignee chip 多选 / 共同执行人(T-US009)
 */

import type { TaskRow } from '../types/database';

/**
 * 任务行类型 re-export —— 本模块对外暴露的 Task 别名(与 SyncManager / LocalStore
 * 一致),UI 层 import 时统一用 `Task`。
 */
export type Task = TaskRow;

// =====================================================================
// Types
// =====================================================================

/** 视图模式:3 选项,URL ?view= 参数映射。 */
export type ViewMode = 'today' | 'week' | 'all';

/** Task badge 的 discriminated union —— UI 按 `kind` 分发颜色 / 样式。 */
export type TaskBadge =
  | { kind: 'completed'; label: string }
  | { kind: 'cancelled'; label: string }
  | { kind: 'overdue'; label: string }
  | { kind: 'today'; label: string }
  | { kind: 'tomorrow'; label: string }
  | { kind: 'weekday'; label: string }
  | { kind: 'date'; label: string };

// =====================================================================
// 1. Date helpers — 用本地时区,避免 UTC 偏移
// =====================================================================

/**
 * 把 'YYYY-MM-DD' + n 天 → 'YYYY-MM-DD'(本地时区计算)。
 *
 * 实现:`new Date(yyyyMmDd)` 在 ISO 日期串上**默认按 UTC 解析** —— 这会让
 * 北京时区用户跨日时少/多一天。解决方案:手动 split + 用 new Date(year, month-1, day)
 * 在本地时区构造。
 */
export function addDays(yyyyMmDd: string, n: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map((s) => Number.parseInt(s, 10));
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  // 拼回 YYYY-MM-DD(本地时区)
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 两个 'YYYY-MM-DD' 之间的天数差(b - a,正数 = b 晚于 a,负数 = b 早于 a)。
 * 用本地时区 + Date 对象 epoch 差。
 */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map((s) => Number.parseInt(s, 10));
  const [by, bm, bd] = b.split('-').map((s) => Number.parseInt(s, 10));
  // 用本地 midnight 比较,避免时分秒混入
  const aDt = new Date(ay, am - 1, ad).getTime();
  const bDt = new Date(by, bm - 1, bd).getTime();
  // round((b - a) / 一日毫秒) — 减 0.5 防御夏令时跳变
  return Math.round((bDt - aDt) / 86_400_000);
}

// =====================================================================
// 2. makeDatePredicate — view → 谓词
// =====================================================================

/**
 * 把 view 模式 + 当前日期转成 date range 谓词。
 *
 * - today:仅 task.task_date === today
 * - week:task.task_date 在 [today, today+6] 闭区间(7 天窗口)
 * - all:接受全部
 *
 * 返回的谓词是纯函数,可单独传给 Array.prototype.filter。
 */
export function makeDatePredicate(
  view: ViewMode,
  today: string,
): (task: Task) => boolean {
  switch (view) {
    case 'today':
      return (t) => t.task_date === today;
    case 'week': {
      const startStr = today;
      const endStr = addDays(today, 6);
      return (t) => t.task_date >= startStr && t.task_date <= endStr;
    }
    case 'all':
      return () => true;
  }
}

// =====================================================================
// 3. filterTasks — 谓词 + 排序
// =====================================================================

/**
 * 按 view 筛选 + 排序(task_date asc, task_time asc, created_at asc)。
 *
 * 排序约定:
 *   1. task_date 早的在前(string compare 即可,YYYY-MM-DD 字典序 = 时间序)
 *   2. 同日期:task_time 早的在前;null task_time 视为'99:99:99'排最后
 *   3. 同日期 + 同时间:created_at 早的在前
 *
 * 返回**新数组**(slice 后再 sort),不修改入参。
 */
export function filterTasks(tasks: Task[], view: ViewMode, today: string): Task[] {
  const predicate = makeDatePredicate(view, today);
  return tasks
    .filter(predicate)
    .slice()
    .sort((a, b) => {
      if (a.task_date !== b.task_date) {
        return a.task_date.localeCompare(b.task_date);
      }
      const aTime = a.task_time ?? '99:99:99';
      const bTime = b.task_time ?? '99:99:99';
      if (aTime !== bTime) {
        return aTime.localeCompare(bTime);
      }
      return a.created_at.localeCompare(b.created_at);
    });
}

// =====================================================================
// 4. computeTaskBadge — 状态 badge
// =====================================================================

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const;

/**
 * 计算 task 状态 badge。优先级(高 → 低):
 *   1. cancelled:已取消(整卡 opacity 0.4,删除线)
 *   2. completed_at 非空:已完成
 *   3. task_date < today:已过期(左侧红竖条 + warning bg)
 *   4. task_date === today:今天
 *   5. task_date === tomorrow:明天
 *   6. 距离 today < 7 天(含今天+6):周X
 *   7. 距离 today >= 7 天:M/D 短格式
 *
 * 设计决策:
 *   - completed / cancelled 是"完成态"label;overdue / today / tomorrow /
 *     weekday / date 是"日期态"label。两者互斥,优先级如上。
 *   - "已完成"label 格式 `✓ 已完成` —— brief §3.5 写"✓ 已完成 10:05",
 *     但 task.completed_at 是 ISO timestamp(带时区),UI 层要显示完整时间需
 *     二次格式化;本期保持简单 label `✓ 已完成`(留 T-US002-2 / T-US005
 *     checkin flow 时接入完成时间格式化)。
 *   - cancelled 优先于 completed:业务上 cancelled 永远比 completed 更需要警示。
 *   - overdue 优先于 today/tomorrow/weekday/date:业务上过期是最重要的状态。
 */
export function computeTaskBadge(task: Task, today: string): TaskBadge {
  if (task.cancelled) {
    return { kind: 'cancelled', label: '已取消' };
  }
  if (task.completed_at) {
    return { kind: 'completed', label: '✓ 已完成' };
  }
  if (task.task_date < today) {
    return { kind: 'overdue', label: '⚠ 已过期' };
  }

  const tomorrow = addDays(today, 1);
  if (task.task_date === today) {
    return { kind: 'today', label: '今天' };
  }
  if (task.task_date === tomorrow) {
    return { kind: 'tomorrow', label: '明天' };
  }

  // 距离 today 的天数 → 决定显示 weekday 还是 M/D
  const daysDiff = daysBetween(today, task.task_date);
  if (daysDiff >= 0 && daysDiff < 7) {
    // 0 = today(已处理),1 = tomorrow(已处理),2-6 = "周X"
    const d = new Date(task.task_date);
    const wd = d.getDay(); // 0 = Sunday
    return { kind: 'weekday', label: `周${WEEKDAY_LABELS[wd]}` };
  }
  // > 7 天:显示 M/D(本地时区取月/日)
  const d = new Date(task.task_date);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return { kind: 'date', label: `${m}/${day}` };
}

// =====================================================================
// 5. formatTaskTime — 'HH:MM:SS' | null → 'HH:MM' | '全天'
// =====================================================================

/**
 * 把 task.task_time 格式化为 UI 显示。
 *   - null / 空串 → '全天'
 *   - 'HH:MM:SS' → 'HH:MM'(前 5 字符)
 *   - 'HH:MM'(已是短格式)→ 原样返回
 *
 * 不做严格校验:输入若不是合法时间格式,直接返回原字符串前 5 字符。
 * (server 端 db-v1.1.sql §3.4 限定 TIME 类型,理论上不会传乱七八糟的串)
 */
export function formatTaskTime(taskTime: string | null): string {
  if (!taskTime) return '全天';
  return taskTime.slice(0, 5);
}
