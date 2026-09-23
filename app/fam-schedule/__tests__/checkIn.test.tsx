/**
 * checkIn 单元测试 — T-US005-1
 *
 * 覆盖范围(任务 brief §D + GetCheckInState DoD):
 *   getCheckInState — 4 状态 × 多种边界:
 *     1. cancelled = true                    → 'cancelled'
 *     2. completed_at + completed_by = me    → 'completed' with HH:MM
 *     3. completed_at + completed_by != me   → 'spouse_completed'
 *     4. task_date < today                   → 'todo' with '补打卡' label
 *     5. task_date === today                 → 'todo' with '✓ 打卡'
 *     6. task_date > today                   → 'todo' with '✓ 打卡'
 *     7. completed_at edge: cancelled overrides (即使 cancelled=true + 已完成也按 cancelled)
 *     8. completed_by edge: completed_at present but completed_by = null (孤儿完成)
 *
 *   canCheckIn — 4 状态:
 *     9.  'todo'           → true
 *     10. 'completed'      → false
 *     11. 'cancelled'      → false
 *     12. 'spouse_completed' → false
 *
 * 测试策略:
 *   - 与 createTaskForm.test.tsx / PhosphorTabIcon.test.tsx 同套模式:
 *     纯函数 + 不依赖 RN / supabase / SyncManager
 *   - 测试稳定 ≤ 100ms,全部同步 / 同步字符串操作
 */

import type { Task } from '../src/lib/LocalStore';
import {
  getCheckInState,
  canCheckIn,
  getUndoCountdown,
  UNDO_WINDOW_MS,
} from '../src/lib/checkIn';

// =====================================================================
// Test fixtures
// =====================================================================

const ME_ID = 'me-uuid-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SPOUSE_ID = 'spouse-uuid-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TODAY = '2026-09-23';

/** 默认 task:今天 10:00,未完成,未取消,指派给 me。 */
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-uuid-eeee-eeee-eeee-eeeeeeeeeeee',
    template_id: null,
    family_id: 'family-uuid',
    title: '喂奶粉',
    description: null,
    task_date: TODAY,
    task_time: '10:00',
    assignee_id: ME_ID,
    co_executor_ids: [],
    is_shared_view: false,
    created_by: ME_ID,
    completed_at: null,
    completed_by: null,
    is_makeup: false,
    cancelled: false,
    created_at: '2026-09-23T08:00:00Z',
    updated_at: '2026-09-23T08:00:00Z',
    ...overrides,
  };
}

// =====================================================================
// getCheckInState — cancelled 分支
// =====================================================================

describe('getCheckInState — cancelled branch', () => {
  it('returns cancelled when task.cancelled = true (no completion data needed)', () => {
    const state = getCheckInState(makeTask({ cancelled: true }), ME_ID, TODAY);
    expect(state).toEqual({ kind: 'cancelled', label: '已取消' });
  });

  it('cancelled overrides completion (defensive — even if completed_at is set, cancelled wins)', () => {
    // 边缘:任务被取消但同时显示已 completed(数据漂移 / racy 时序)— cancelled 优先
    const state = getCheckInState(
      makeTask({
        cancelled: true,
        completed_at: '2026-09-23T10:00:00Z',
        completed_by: ME_ID,
      }),
      ME_ID,
      TODAY,
    );
    expect(state.kind).toBe('cancelled');
  });
});

// =====================================================================
// getCheckInState — completed 分支(我完成)
// =====================================================================

describe('getCheckInState — completed branch (me checked in)', () => {
  it('returns completed with HH:MM label when completed_by === currentUserId', () => {
    const state = getCheckInState(
      makeTask({
        completed_at: '2026-09-23T10:05:00Z',
        completed_by: ME_ID,
      }),
      ME_ID,
      TODAY,
    );
    expect(state).toEqual({ kind: 'completed', label: '✓ 已完成 10:05' });
  });

  it('completed HH:MM works regardless of task_date (past / today / future)', () => {
    // 边缘:过去的 task 即使标 completed,label 仍走 completed
    const state = getCheckInState(
      makeTask({
        task_date: '2026-09-20',
        completed_at: '2026-09-20T20:30:00Z',
        completed_by: ME_ID,
      }),
      ME_ID,
      TODAY,
    );
    expect(state.kind).toBe('completed');
    expect(state.label).toBe('✓ 已完成 20:30');
  });
});

// =====================================================================
// getCheckInState — spouse_completed 分支
// =====================================================================

describe('getCheckInState — spouse_completed branch', () => {
  it('returns spouse_completed when completed_by !== currentUserId', () => {
    const state = getCheckInState(
      makeTask({
        completed_at: '2026-09-23T10:05:00Z',
        completed_by: SPOUSE_ID,
      }),
      ME_ID,
      TODAY,
    );
    expect(state).toEqual({ kind: 'spouse_completed', label: '✓ 配偶已完成' });
  });

  it('treats empty currentUserId as "not me" (spouse_completed fallback, defensive)', () => {
    // 防御:currentUserId 是空串(没登录 / no family)— 任何 completed_by 都不等同
    const state = getCheckInState(
      makeTask({
        completed_at: '2026-09-23T10:05:00Z',
        completed_by: SPOUSE_ID,
      }),
      '',
      TODAY,
    );
    expect(state.kind).toBe('spouse_completed');
  });

  it('defensive: completed_at present but completed_by = null (orphan completion) → spouse_completed', () => {
    // DB schema 允许 completed_at 非 null + completed_by null 的瞬间(理论上不应该,
    // 但 ad-hoc 写入 / 测试 fixture / 孤儿数据都可能);UI 应显示配偶已完成而非崩
    const state = getCheckInState(
      makeTask({
        completed_at: '2026-09-23T10:05:00Z',
        completed_by: null,
      }),
      ME_ID,
      TODAY,
    );
    expect(state.kind).toBe('spouse_completed');
  });
});

// =====================================================================
// getCheckInState — todo 分支(过去 / 今天 / 未来)
// =====================================================================

describe('getCheckInState — todo branch (past / today / future)', () => {
  it('returns todo with "补打卡" label when task_date < today', () => {
    const state = getCheckInState(
      makeTask({ task_date: '2026-09-22' }),
      ME_ID,
      TODAY,
    );
    expect(state).toEqual({ kind: 'todo', label: '补打卡' });
  });

  it('returns todo with "✓ 打卡" label when task_date === today', () => {
    const state = getCheckInState(makeTask({ task_date: TODAY }), ME_ID, TODAY);
    expect(state).toEqual({ kind: 'todo', label: '✓ 打卡' });
  });

  it('returns todo with "✓ 打卡" label when task_date > today (future)', () => {
    const state = getCheckInState(
      makeTask({ task_date: '2026-09-25' }),
      ME_ID,
      TODAY,
    );
    expect(state).toEqual({ kind: 'todo', label: '✓ 打卡' });
  });

  it('returns todo with "✓ 打卡" when assignee is not me (we still own our tasks on home list)', () => {
    // 列表会展示所有任务(无论 assignee),包括别人的;我们仍可点击为自己的任务打卡
    // (本期简化 — co_executor / 指派关系由后续 T-US009 处理)
    const state = getCheckInState(
      makeTask({ assignee_id: SPOUSE_ID }),
      ME_ID,
      TODAY,
    );
    expect(state).toEqual({ kind: 'todo', label: '✓ 打卡' });
  });
});

// =====================================================================
// canCheckIn — 4 kind
// =====================================================================

describe('canCheckIn — all 4 states', () => {
  it('returns true for todo', () => {
    expect(canCheckIn({ kind: 'todo', label: '✓ 打卡' })).toBe(true);
  });

  it('returns true for todo with "补打卡" label (same kind)', () => {
    expect(canCheckIn({ kind: 'todo', label: '补打卡' })).toBe(true);
  });

  it('returns false for completed (own check-in — undo leaves for T-US005-3)', () => {
    expect(canCheckIn({ kind: 'completed', label: '✓ 已完成 10:05' })).toBe(false);
  });

  it('returns false for cancelled (UI will show alert)', () => {
    expect(canCheckIn({ kind: 'cancelled', label: '已取消' })).toBe(false);
  });

  it('returns false for spouse_completed (UI will show alert, undo Toast leaves for T-US005-2)', () => {
    expect(canCheckIn({ kind: 'spouse_completed', label: '✓ 配偶已完成' })).toBe(false);
  });
});

// =====================================================================
// 综合 — 派生函数纯性 + 不依赖外部副作用
// =====================================================================

describe('getCheckInState — purity / sanity', () => {
  it('does not mutate the task object (pure read)', () => {
    const task = makeTask();
    const snapshot = JSON.stringify(task);
    getCheckInState(task, ME_ID, TODAY);
    expect(JSON.stringify(task)).toBe(snapshot);
  });

  it('idempotent — repeated calls give equal results (no internal cache / counter)', () => {
    const task = makeTask();
    const a = getCheckInState(task, ME_ID, TODAY);
    const b = getCheckInState(task, ME_ID, TODAY);
    expect(a).toEqual(b);
  });
});

// =====================================================================
// T-US005-3: getUndoCountdown — 撤销倒计时派生(8 cases)
// =====================================================================
//
// 覆盖范围(任务 brief §D + 设计 task-detail-v1.0 §3.3 / §6):
//   - 边界:elapsed = 0 / 1min / 4:59 / 5:00 / 5:01
//   - 防御:null completedAt / undefined / invalid ISO
//   - 时钟漂移:elapsed < 0(未来 time)— 防御,视为刚完成
//   - mm:ss 格式:`5:00 / 4:32 / 0:00`
//   - a11y label 中文格式
//   - UNDO_WINDOW_MS = 5 * 60 * 1000

describe('getUndoCountdown — T-US005-3', () => {
  it('exports UNDO_WINDOW_MS = 5 minutes (300_000 ms)', () => {
    expect(UNDO_WINDOW_MS).toBe(5 * 60 * 1000);
  });

  it('at elapsed=0 (just completed): canUndo=true, label "↶ 撤销打卡 (5:00)"', () => {
    const completedAt = '2026-09-23T10:35:00Z';
    const now = new Date(completedAt).getTime();
    const state = getUndoCountdown(completedAt, now);
    expect(state.canUndo).toBe(true);
    expect(state.remainingMs).toBe(UNDO_WINDOW_MS);
    expect(state.label).toBe('↶ 撤销打卡 (5:00)');
    expect(state.a11yLabel).toBe('撤销打卡,剩余 5 分 0 秒');
  });

  it('at elapsed=1min: label "↶ 撤销打卡 (4:00)"', () => {
    const completedAt = '2026-09-23T10:35:00Z';
    const completedMs = new Date(completedAt).getTime();
    const now = completedMs + 60 * 1000;
    const state = getUndoCountdown(completedAt, now);
    expect(state.canUndo).toBe(true);
    expect(state.remainingMs).toBe(4 * 60 * 1000);
    expect(state.label).toBe('↶ 撤销打卡 (4:00)');
    expect(state.a11yLabel).toBe('撤销打卡,剩余 4 分 0 秒');
  });

  it('at elapsed=4min 28s: label "↶ 撤销打卡 (0:32)" (mm:ss padding)', () => {
    const completedAt = '2026-09-23T10:35:00Z';
    const completedMs = new Date(completedAt).getTime();
    const now = completedMs + (4 * 60 + 28) * 1000;
    const state = getUndoCountdown(completedAt, now);
    expect(state.canUndo).toBe(true);
    expect(state.remainingMs).toBe(32 * 1000);
    expect(state.label).toBe('↶ 撤销打卡 (0:32)');
    expect(state.a11yLabel).toBe('撤销打卡,剩余 0 分 32 秒');
  });

  it('at elapsed=4min 59s (last second): canUndo=true, remainingMs=1000', () => {
    const completedAt = '2026-09-23T10:35:00Z';
    const completedMs = new Date(completedAt).getTime();
    const now = completedMs + (4 * 60 + 59) * 1000;
    const state = getUndoCountdown(completedAt, now);
    expect(state.canUndo).toBe(true);
    expect(state.remainingMs).toBe(1000);
    expect(state.label).toBe('↶ 撤销打卡 (0:01)');
  });

  it('at elapsed=5min exactly: canUndo=false (boundary expiring)', () => {
    const completedAt = '2026-09-23T10:35:00Z';
    const completedMs = new Date(completedAt).getTime();
    const now = completedMs + 5 * 60 * 1000;
    const state = getUndoCountdown(completedAt, now);
    expect(state.canUndo).toBe(false);
    expect(state.remainingMs).toBe(0);
    expect(state.label).toBe('');
    expect(state.a11yLabel).toBe('撤销窗口已过期');
  });

  it('at elapsed=5min 1s (already expired): canUndo=false', () => {
    const completedAt = '2026-09-23T10:35:00Z';
    const completedMs = new Date(completedAt).getTime();
    const now = completedMs + (5 * 60 + 1) * 1000;
    const state = getUndoCountdown(completedAt, now);
    expect(state.canUndo).toBe(false);
    expect(state.remainingMs).toBe(0);
    expect(state.a11yLabel).toBe('撤销窗口已过期');
  });

  it('returns canUndo=false defensively when completedAt is null', () => {
    const state = getUndoCountdown(null, Date.now());
    expect(state.canUndo).toBe(false);
    expect(state.remainingMs).toBe(0);
    expect(state.label).toBe('');
    expect(state.a11yLabel).toBe('撤销窗口已过期');
  });

  it('returns canUndo=false defensively when completedAt is undefined', () => {
    const state = getUndoCountdown(undefined, Date.now());
    expect(state.canUndo).toBe(false);
    expect(state.a11yLabel).toBe('撤销窗口已过期');
  });

  it('returns canUndo=false when completedAt is invalid ISO string', () => {
    const state = getUndoCountdown('not-an-iso', Date.now());
    expect(state.canUndo).toBe(false);
    expect(state.a11yLabel).toBe('撤销窗口已过期');
  });

  it('defends against clock skew (elapsed < 0, future completedAt): treats as just completed', () => {
    // 防御:Realtime 推送或本地时钟漂移 — completedAt 比 now 还"未来"
    // 期望:视为刚完成,满 5 分钟可撤销(canUndo=true)
    const completedAt = '2026-09-23T10:35:00Z';
    const completedMs = new Date(completedAt).getTime();
    const now = completedMs - 2000; // 2 秒"未来"
    const state = getUndoCountdown(completedAt, now);
    expect(state.canUndo).toBe(true);
    expect(state.remainingMs).toBe(UNDO_WINDOW_MS);
    expect(state.label).toBe('↶ 撤销打卡 (5:00)');
  });

  it('mm:ss format pads seconds to 2 digits ("0:05", "0:32", not "0:5")', () => {
    const completedAt = '2026-09-23T10:35:00Z';
    const completedMs = new Date(completedAt).getTime();
    const now = completedMs + (4 * 60 + 55) * 1000;
    const state = getUndoCountdown(completedAt, now);
    expect(state.label).toBe('↶ 撤销打卡 (0:05)');
  });

  it('a11y label uses "X 分 Y 秒" Chinese format (not mm:ss)', () => {
    // 设置 now = completedMs + 28 sec elapsed → remaining = 4:32 → a11y "4 分 32 秒"
    const completedAt = '2026-09-23T10:35:00Z';
    const completedMs = new Date(completedAt).getTime();
    const now = completedMs + 28 * 1000;
    const state = getUndoCountdown(completedAt, now);
    expect(state.a11yLabel).toBe('撤销打卡,剩余 4 分 32 秒');
    expect(state.a11yLabel).not.toMatch(/\d+:\d+/); // 不应包含 mm:ss
  });
});
