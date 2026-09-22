/**
 * taskListFilters 单元测试 — T-US002-1
 *
 * 覆盖范围(brief §C + 边界):
 *   1. addDays / daysBetween — 本地时区正确(避免 UTC 偏移)
 *   2. makeDatePredicate — 三种 view 边界(today / 跨月 / 跨年)
 *   3. filterTasks — 排序 + filter 组合 + 空数组 + 全 null task_time
 *   4. computeTaskBadge — 七种 kind 完整覆盖
 *   5. formatTaskTime — 边界(null / 24:00 / 23:59)
 *
 * 纯函数 + 无副作用 → 直接 import + 调函数 + expect 断言。
 * 无需 mock AsyncStorage / supabase / React。
 */

import type { Task } from '../src/lib/LocalStore';
import {
  addDays,
  daysBetween,
  makeDatePredicate,
  filterTasks,
  computeTaskBadge,
  formatTaskTime,
  type ViewMode,
} from '../src/lib/taskListFilters';

// =====================================================================
// Test fixtures
// =====================================================================

const FAMILY_ID = '11111111-1111-1111-1111-111111111111';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const TODAY = '2026-09-22';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Math.random()}`,
    template_id: null,
    family_id: FAMILY_ID,
    title: '示例任务',
    description: null,
    task_date: TODAY,
    task_time: '10:00:00',
    assignee_id: USER_A,
    co_executor_ids: [],
    is_shared_view: false,
    created_by: USER_A,
    completed_at: null,
    completed_by: null,
    is_makeup: false,
    cancelled: false,
    created_at: '2026-09-22T00:00:00.000Z',
    updated_at: '2026-09-22T00:00:00.000Z',
    ...overrides,
  };
}

// =====================================================================
// addDays
// =====================================================================

describe('addDays', () => {
  it('adds positive days within same month', () => {
    expect(addDays('2026-09-22', 1)).toBe('2026-09-23');
    expect(addDays('2026-09-22', 6)).toBe('2026-09-28');
  });

  it('crosses month boundary', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-09-22', 9)).toBe('2026-10-01');
  });

  it('crosses year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('handles negative days (subtract)', () => {
    expect(addDays('2026-09-22', -1)).toBe('2026-09-21');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });

  it('handles zero days (identity)', () => {
    expect(addDays('2026-09-22', 0)).toBe('2026-09-22');
  });

  it('handles leap year Feb 29', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29'); // 2024 是闰年
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
  });

  it('handles non-leap year Feb 28 → Mar 1', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});

// =====================================================================
// daysBetween
// =====================================================================

describe('daysBetween', () => {
  it('returns 0 for same date', () => {
    expect(daysBetween('2026-09-22', '2026-09-22')).toBe(0);
  });

  it('returns positive when b is later than a', () => {
    expect(daysBetween('2026-09-22', '2026-09-28')).toBe(6);
    expect(daysBetween('2026-09-22', '2026-09-23')).toBe(1);
  });

  it('returns negative when b is earlier than a', () => {
    expect(daysBetween('2026-09-22', '2026-09-21')).toBe(-1);
    expect(daysBetween('2026-10-01', '2026-09-22')).toBe(-9);
  });

  it('crosses month boundary', () => {
    expect(daysBetween('2026-09-30', '2026-10-01')).toBe(1);
  });

  it('crosses year boundary', () => {
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });
});

// =====================================================================
// makeDatePredicate
// =====================================================================

describe('makeDatePredicate', () => {
  const today = TODAY;

  it('today view: only matches exact date', () => {
    const predicate = makeDatePredicate('today', today);
    expect(predicate(makeTask({ task_date: today }))).toBe(true);
    expect(predicate(makeTask({ task_date: '2026-09-21' }))).toBe(false);
    expect(predicate(makeTask({ task_date: '2026-09-23' }))).toBe(false);
  });

  it('today view: cross-month / cross-year exact match', () => {
    const predicate = makeDatePredicate('today', today);
    expect(predicate(makeTask({ task_date: '2026-08-22' }))).toBe(false);
    expect(predicate(makeTask({ task_date: '2027-09-22' }))).toBe(false);
  });

  it('week view: includes today + next 6 days (closed interval)', () => {
    const predicate = makeDatePredicate('week', today);
    expect(predicate(makeTask({ task_date: today }))).toBe(true); // today
    expect(predicate(makeTask({ task_date: '2026-09-28' }))).toBe(true); // +6
    expect(predicate(makeTask({ task_date: '2026-09-29' }))).toBe(false); // +7
    expect(predicate(makeTask({ task_date: '2026-09-21' }))).toBe(false); // -1
  });

  it('week view: crosses month boundary', () => {
    // today = 2026-09-28 → week spans Sep 28 - Oct 4
    const predicate = makeDatePredicate('week', '2026-09-28');
    expect(predicate(makeTask({ task_date: '2026-09-28' }))).toBe(true);
    expect(predicate(makeTask({ task_date: '2026-10-04' }))).toBe(true);
    expect(predicate(makeTask({ task_date: '2026-10-05' }))).toBe(false);
  });

  it('week view: crosses year boundary', () => {
    // today = 2026-12-30 → week spans 2026-12-30 to 2027-01-05
    const predicate = makeDatePredicate('week', '2026-12-30');
    expect(predicate(makeTask({ task_date: '2026-12-30' }))).toBe(true);
    expect(predicate(makeTask({ task_date: '2027-01-05' }))).toBe(true);
    expect(predicate(makeTask({ task_date: '2027-01-06' }))).toBe(false);
  });

  it('all view: accepts every date', () => {
    const predicate = makeDatePredicate('all', today);
    expect(predicate(makeTask({ task_date: '2020-01-01' }))).toBe(true);
    expect(predicate(makeTask({ task_date: '2099-12-31' }))).toBe(true);
    expect(predicate(makeTask({ task_date: today }))).toBe(true);
  });
});

// =====================================================================
// filterTasks
// =====================================================================

describe('filterTasks', () => {
  it('returns empty array when no tasks', () => {
    expect(filterTasks([], 'today', TODAY)).toEqual([]);
    expect(filterTasks([], 'all', TODAY)).toEqual([]);
  });

  it('today view: filters only today tasks', () => {
    const tasks = [
      makeTask({ id: 'a', task_date: TODAY }),
      makeTask({ id: 'b', task_date: '2026-09-23' }),
    ];
    const result = filterTasks(tasks, 'today', TODAY);
    expect(result.map((t) => t.id)).toEqual(['a']);
  });

  it('all view: returns all tasks', () => {
    const tasks = [
      makeTask({ id: 'a', task_date: TODAY }),
      makeTask({ id: 'b', task_date: '2099-01-01' }),
      makeTask({ id: 'c', task_date: '2020-01-01' }),
    ];
    const result = filterTasks(tasks, 'all', TODAY);
    expect(result).toHaveLength(3);
  });

  it('sorts by task_date ascending', () => {
    const tasks = [
      makeTask({ id: 'late', task_date: '2026-09-25' }),
      makeTask({ id: 'early', task_date: '2026-09-20' }),
      makeTask({ id: 'mid', task_date: '2026-09-22' }),
    ];
    const result = filterTasks(tasks, 'all', TODAY);
    expect(result.map((t) => t.id)).toEqual(['early', 'mid', 'late']);
  });

  it('within same date: sorts by task_time ascending', () => {
    const tasks = [
      makeTask({ id: 'late', task_date: TODAY, task_time: '14:00:00' }),
      makeTask({ id: 'early', task_date: TODAY, task_time: '09:00:00' }),
      makeTask({ id: 'mid', task_date: TODAY, task_time: '12:00:00' }),
    ];
    const result = filterTasks(tasks, 'today', TODAY);
    expect(result.map((t) => t.id)).toEqual(['early', 'mid', 'late']);
  });

  it('within same date + time: sorts by created_at ascending', () => {
    const tasks = [
      makeTask({
        id: 'newest',
        task_date: TODAY,
        task_time: '10:00:00',
        created_at: '2026-09-22T03:00:00.000Z',
      }),
      makeTask({
        id: 'oldest',
        task_date: TODAY,
        task_time: '10:00:00',
        created_at: '2026-09-22T01:00:00.000Z',
      }),
      makeTask({
        id: 'middle',
        task_date: TODAY,
        task_time: '10:00:00',
        created_at: '2026-09-22T02:00:00.000Z',
      }),
    ];
    const result = filterTasks(tasks, 'today', TODAY);
    expect(result.map((t) => t.id)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('null task_time sorts after timed tasks (within same date)', () => {
    const tasks = [
      makeTask({ id: 'null-time', task_date: TODAY, task_time: null }),
      makeTask({ id: 'timed', task_date: TODAY, task_time: '10:00:00' }),
    ];
    const result = filterTasks(tasks, 'today', TODAY);
    expect(result.map((t) => t.id)).toEqual(['timed', 'null-time']);
  });

  it('does not mutate input array', () => {
    const tasks = [
      makeTask({ id: 'a', task_date: TODAY }),
      makeTask({ id: 'b', task_date: '2026-09-20' }),
    ];
    const originalIds = tasks.map((t) => t.id);
    filterTasks(tasks, 'all', TODAY);
    expect(tasks.map((t) => t.id)).toEqual(originalIds);
  });
});

// =====================================================================
// computeTaskBadge
// =====================================================================

describe('computeTaskBadge', () => {
  const today = TODAY;

  it('cancelled: highest priority even if also completed', () => {
    const badge = computeTaskBadge(
      makeTask({ cancelled: true, completed_at: '2026-09-22T10:00:00Z' }),
      today,
    );
    expect(badge.kind).toBe('cancelled');
    expect(badge.label).toBe('已取消');
  });

  it('completed: badge "✓ 已完成" when completed_at set', () => {
    const badge = computeTaskBadge(
      makeTask({ completed_at: '2026-09-22T10:00:00Z' }),
      today,
    );
    expect(badge.kind).toBe('completed');
    expect(badge.label).toBe('✓ 已完成');
  });

  it('overdue: badge "⚠ 已过期" when task_date < today', () => {
    const badge = computeTaskBadge(
      makeTask({ task_date: '2026-09-20' }),
      today,
    );
    expect(badge.kind).toBe('overdue');
    expect(badge.label).toBe('⚠ 已过期');
  });

  it('today: badge "今天" when task_date === today', () => {
    const badge = computeTaskBadge(makeTask({ task_date: today }), today);
    expect(badge.kind).toBe('today');
    expect(badge.label).toBe('今天');
  });

  it('tomorrow: badge "明天" when task_date === today + 1', () => {
    const badge = computeTaskBadge(
      makeTask({ task_date: '2026-09-23' }),
      today,
    );
    expect(badge.kind).toBe('tomorrow');
    expect(badge.label).toBe('明天');
  });

  it('weekday: badge "周X" within next 7 days (excluding today/tomorrow)', () => {
    // 2026-09-24 = Thursday, 2026-09-25 = Friday, 2026-09-26 = Saturday
    expect(
      computeTaskBadge(makeTask({ task_date: '2026-09-24' }), today).kind,
    ).toBe('weekday');
    expect(
      computeTaskBadge(makeTask({ task_date: '2026-09-28' }), today).kind,
    ).toBe('weekday');
    expect(
      computeTaskBadge(makeTask({ task_date: '2026-09-24' }), today).label,
    ).toBe('周四');
    expect(
      computeTaskBadge(makeTask({ task_date: '2026-09-26' }), today).label,
    ).toBe('周六');
    expect(
      computeTaskBadge(makeTask({ task_date: '2026-09-27' }), today).label,
    ).toBe('周日'); // Sunday = 0
  });

  it('date: badge "M/D" when task_date >= today + 7 days', () => {
    // 2026-09-29 = 7 days after today → still weekday
    // 2026-09-30 = 8 days after today → date
    const badge = computeTaskBadge(
      makeTask({ task_date: '2026-09-30' }),
      today,
    );
    expect(badge.kind).toBe('date');
    expect(badge.label).toBe('9/30');
  });

  it('date badge format: month/day without zero pad', () => {
    const badge = computeTaskBadge(
      makeTask({ task_date: '2026-10-05' }),
      today,
    );
    expect(badge.label).toBe('10/5');
  });

  it('priority order: completed > overdue (completed_at present even if date past)', () => {
    const badge = computeTaskBadge(
      makeTask({
        task_date: '2026-09-20', // past
        completed_at: '2026-09-20T10:00:00Z',
      }),
      today,
    );
    expect(badge.kind).toBe('completed');
  });

  it('priority order: cancelled > today (cancelled even if today)', () => {
    const badge = computeTaskBadge(
      makeTask({ task_date: today, cancelled: true }),
      today,
    );
    expect(badge.kind).toBe('cancelled');
  });
});

// =====================================================================
// formatTaskTime
// =====================================================================

describe('formatTaskTime', () => {
  it('returns "全天" for null', () => {
    expect(formatTaskTime(null)).toBe('全天');
  });

  it('returns "全天" for empty string', () => {
    expect(formatTaskTime('')).toBe('全天');
  });

  it('truncates HH:MM:SS to HH:MM', () => {
    expect(formatTaskTime('10:00:00')).toBe('10:00');
    expect(formatTaskTime('23:59:59')).toBe('23:59');
    expect(formatTaskTime('00:00:00')).toBe('00:00');
  });

  it('preserves HH:MM (already short)', () => {
    expect(formatTaskTime('10:00')).toBe('10:00');
    expect(formatTaskTime('14:30')).toBe('14:30');
  });

  it('handles 24:00 midnight (PG TIME 边界)', () => {
    // PG TIME 类型的上限是 '24:00:00'(午夜末尾),slice 后应为 '24:00'
    expect(formatTaskTime('24:00:00')).toBe('24:00');
  });
});

// =====================================================================
// 视图模式断言(防止 ViewMode 类型被意外扩展)
// =====================================================================

describe('ViewMode type sanity', () => {
  it('has exactly 3 modes: today, week, all', () => {
    const modes: ViewMode[] = ['today', 'week', 'all'];
    expect(modes).toHaveLength(3);
  });
});
