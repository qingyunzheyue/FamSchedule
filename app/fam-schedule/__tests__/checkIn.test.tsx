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
import { getCheckInState, canCheckIn } from '../src/lib/checkIn';

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
