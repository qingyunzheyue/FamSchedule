/**
 * checkIn — 打卡状态派生纯函数 — T-US005-1
 *
 * 职责(单一职责:从 task 派生 CheckInButton 的视觉 / 交互状态):
 *   1. getCheckInState(task, currentUserId, today) — discriminated union
 *      - 'todo'           : 待打卡(可点击触发打卡)
 *      - 'completed'      : 我已完成(显示完成时间,本任务暂不做 undo 留 T-US005-3)
 *      - 'cancelled'      : 任务已取消(dim + Alert "任务已取消")
 *      - 'spouse_completed': 配偶已完成(显示配偶已完成态,本任务不做 undo 也不弹 toast,
 *                          配偶先完成后的 toast 留 T-US005-2)
 *   2. canCheckIn(state) — 是否可以点击触发打卡(todo 唯一可以)
 *
 * 设计依据:
 *   - 任务 detail-v1.0.md §3.5 + home-v1.0.md §3.5:36px 圆圈 + 4 状态视觉
 *   - 任务 brief §B-3 派生纯函数,与 Service 层 / UI 层解耦,便于 jest 单测覆盖
 *   - 故意**不**与 React 或 supabase 耦合 — 纯函数,可被任何 UI 层(列表卡 / 详情页)
 *     复用;若以后补卡页面(US-006)接入,只需新增派生分支,不需重写组件
 *
 * 状态优先级(自上而下短路):
 *   1. cancelled = true                  → { kind: 'cancelled', label: '已取消' }
 *   2. completed_at 非 null:
 *      2a. completed_by === currentUserId → { kind: 'completed', label: '✓ 已完成 HH:MM' }
 *      2b. else                            → { kind: 'spouse_completed', label: '✓ 配偶已完成' }
 *   3. else:
 *      3a. task_date < today                → { kind: 'todo', label: '补打卡' }
 *      3b. else                             → { kind: 'todo', label: '✓ 打卡' }
 *
 * 关于"补打卡"label 的简化决策(任务 brief §C 明确不修):
 *   - 任务 brief 明确不修 §US-006 补卡入口,本任务只把"过期可点击"标记出来
 *   - 用户点击过期任务的打卡 → CheckInService 走 isMakeup=false(本期固定);
 *     "补卡"语义留 T-US006-1 单独做(p_is_makeup=true + family_settings 截止校验)
 *   - 本任务的 label 只是视觉提示("补打卡"文案),不切换 RPC 行为
 *
 * 关于 cancelled 状态点击交互:
 *   - cancelled 任务点击 CheckInButton → Alert "任务已取消"(UI 层处理)
 *   - 业务上 cancelled 任务不该出现在"今天 / 本周"视图(taskListFilters 过滤掉),
 *     但 extinct cases(刚取消时数据未刷)+ UI 防御仍然保留 cancelled 态分支
 */

import type { Task } from './LocalStore';

// =====================================================================
// 1. Types
// =====================================================================

/**
 * CheckInButton 的可视状态 + 交互语义。
 *
 * - label 仅用于 accessibilityLabel 截取的"态描述部分";
 *   UI 渲染时 todo/cancelled 用 icon 区分,completed/spouse_completed 在 icon 旁
 *   渲染简化 label(设计 home-v1.0 §3.5 / task-detail-v1.0 §3.1 视觉样板)。
 */
export type CheckInButtonState =
  | { kind: 'todo'; label: string }
  | { kind: 'completed'; label: string }
  | { kind: 'cancelled'; label: string }
  | { kind: 'spouse_completed'; label: string };

// =====================================================================
// 2. getCheckInState(task, currentUserId, today) — 主派生函数
// =====================================================================

/**
 * 从 task + 当前用户 + 今天日期 → 派生 CheckInButton 状态。
 *
 * 边界:
 *   - task.completed_at 是 ISO string,Slice(11, 16) 拿 'HH:MM' 段(✅ 截取示范:'2026-09-23T10:05:00Z'.slice(11, 16) = '10:05')
 *   - 比较 task_date 字符串与 today 是 lexicographic(YYYY-MM-DD ISO 字符串可直接 < 比较)
 *   - currentUserId 是 user.id(UUID);空字符串 / null 时,任何 completed_by 都不等同,落到 spouse_completed 兜底
 *     (防御:这种情况下 UI 会显示"配偶已完成",用户态自然接受;UI 不会真正调用 service)
 *   - task_date === today → '✓ 打卡'(不补打卡)
 *   - task_date > today(未来任务)→ '✓ 打卡'(继续点;service 仍允许)
 *     但通常 taskListFilters 已经按 view=today/week/all 过滤;future task 在 today 视图罕见
 *
 * 注意:不依赖 Date 对象 — 纯字符串 / 比较,跨时区不漂(与 createTaskForm 风格一致)。
 */
export function getCheckInState(
  task: Task,
  currentUserId: string,
  today: string,
): CheckInButtonState {
  // 1. 已取消:dim 灰,不可点击
  if (task.cancelled === true) {
    return { kind: 'cancelled', label: '已取消' };
  }

  // 2. 已完成:分"我完成" vs "配偶完成"
  if (task.completed_at !== null && task.completed_at !== undefined) {
    const isMine = task.completed_by === currentUserId && currentUserId !== '';
    if (isMine) {
      // ISO timestamptz:slice(11, 16) → 'HH:MM'
      const time = task.completed_at.slice(11, 16);
      return { kind: 'completed', label: `✓ 已完成 ${time}` };
    }
    return { kind: 'spouse_completed', label: '✓ 配偶已完成' };
  }

  // 3. 待打卡:根据日期区分"补打卡" vs "✓ 打卡"
  if (task.task_date < today) {
    return { kind: 'todo', label: '补打卡' };
  }
  return { kind: 'todo', label: '✓ 打卡' };
}

// =====================================================================
// 3. canCheckIn(state) — 是否可以点击触发打卡
// =====================================================================

/**
 * 给定 CheckInButton 状态,是否可以点击触发 CheckInService.checkin 调用。
 *
 * 规则:
 *   - 'todo'          : ✅ 可以(主要入口)
 *   - 'completed'     : ❌ 不可以(undo 入口独立 CheckInButton 内的 UndoChip 组件;
 *                         见 T-US005-3)
 *   - 'cancelled'     : ❌ 不可以(Alert "任务已取消")
 *   - 'spouse_completed': ❌ 不可以(Alert "配偶已完成,无法撤销")
 *
 * 注意:T-US005-3 把撤销打卡入口单独抽到 `UndoChip`(只挂在 'completed' 视觉态右侧),
 * CheckInButton 的 onPress 主圆圈保持只调 onCheckIn(todo) / Alert / noop(completed)。
 */
export function canCheckIn(state: CheckInButtonState): boolean {
  return state.kind === 'todo';
}

// =====================================================================
// 4. T-US005-3: 撤销倒计时派生 — getUndoCountdown(completedAt, now)
// =====================================================================

/**
 * 撤销打卡的可撤销窗口长度(从 completed_at 起算)— T-US005-3 硬编码 5 分钟。
 *
 * 设计依据:
 *   - 任务 detail-v1.0.md §3.3 "5 分钟内可撤销":设计明确 5 分钟
 *   - ADR-005 / db-v1.1.sql §4.6:`undo_checkin` RPC 是 SECURITY DEFINER
 *     没有强制 5 分钟窗口(client 端 pre-check + 后端 atomic SQL);
 *     客户端发送前 pre-check failed 即可(若已超过 5 分钟不调 RPC)。
 *   - 未来可配:family_settings.undo_window_ms(留后续任务;本任务硬编码对齐
 *     设计 §3.3 视觉)
 */
export const UNDO_WINDOW_MS = 5 * 60 * 1000;

/**
 * UndoChip 渲染所需的派生信息。纯派生(无副作用)— 注入 `now` 便于 jest 测试固定时间。
 *
 * - `canUndo`     : 是否显示撤销入口(仅完成 5 分钟内)
 * - `remainingMs` : 剩余毫秒数(0 表示已过期)
 * - `label`       : 撤销 button label(`↶ 撤销打卡 (4:32)` mm:ss 倒计时)
 * - `a11yLabel`   : a11y 完整 label(`撤销打卡,剩余 4 分 32 秒`)
 */
export interface UndoCountdownState {
  canUndo: boolean;
  remainingMs: number;
  label: string;
  a11yLabel: string;
}

/**
 * 给定 task.completed_at + 当前时间,导出 5 分钟撤销倒计时状态。
 *
 * 边界:
 *   - `completedAt` 为 null/undefined/非法 ISO 字符串 → canUndo=false,
 *     remainingMs=0,label='',a11yLabel='撤销窗口已过期'(防御)
 *   - `now` 必须为 epoch ms(便于 jest fake timer)
 *   - elapsed < 0(未来时间)→ 视为刚完成(remainingMs = UNDO_WINDOW_MS),
 *     防御 Realtime 时序漂移(用户看到完成时,server 推送的 completed_at
 *     可能本地时钟对不上,但期望撤销可用)
 *   - 倒计时显示用 mm:ss 格式(minute / second 均 padStart 2)— 5:00 → "5:00",
 *     0:00 → "0:00"
 *   - a11y label 用中文"剩余 X 分 Y 秒"(不复用 mm:ss)— 屏幕阅读器朗读更自然
 *
 * @param completedAt — `task.completed_at` ISO 字符串
 * @param now         — 当前 epoch ms(Date.now() 或 jest fake timer)
 */
export function getUndoCountdown(
  completedAt: string | null | undefined,
  now: number,
): UndoCountdownState {
  // 防御:null / undefined / 空串 / 非法 ISO
  if (!completedAt) {
    return {
      canUndo: false,
      remainingMs: 0,
      label: '',
      a11yLabel: '撤销窗口已过期',
    };
  }

  const completedMs = new Date(completedAt).getTime();
  if (!Number.isFinite(completedMs)) {
    return {
      canUndo: false,
      remainingMs: 0,
      label: '',
      a11yLabel: '撤销窗口已过期',
    };
  }

  const elapsed = now - completedMs;
  // 防御 elapsed < 0(未来时间 / 时钟漂移)— 视为刚完成,满 5 分钟可用
  const remainingMs = Math.max(0, UNDO_WINDOW_MS - (elapsed > 0 ? elapsed : 0));
  const canUndo = remainingMs > 0;

  if (!canUndo) {
    return {
      canUndo: false,
      remainingMs: 0,
      label: '',
      a11yLabel: '撤销窗口已过期',
    };
  }

  const totalSec = Math.floor(remainingMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const mmSs = `${m}:${s.toString().padStart(2, '0')}`;

  return {
    canUndo: true,
    remainingMs,
    label: `↶ 撤销打卡 (${mmSs})`,
    a11yLabel: `撤销打卡,剩余 ${m} 分 ${s} 秒`,
  };
}
