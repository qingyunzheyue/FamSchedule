/**
 * ExpiryService 单元测试 — T-US015-1
 *
 * 覆盖范围(任务 brief §D + 设计 home-v1.0 §3.3):
 *   1. **makeExpiryWindowPredicate** — 4 窗口 × 边界(yesterday_today 双向
 *      边界 / this_week 7 天窗口 / all 全开 / off 全关)
 *   2. **filterExpiredTasks** — 4 窗口 + 3 排除条件(cancelled / completed_at /
 *      task_date < today)+ 排序顺序(task_date asc → task_time asc → created_at asc)
 *   3. **getExpiredTasksSummary** — family_settings 默认 yesterday_today fallback /
 *      显式 other window / family_settings 缺失(无 row → fallback)/
 *      settings query 抛错 → fallback + console.warn
 *
 * 测试策略:
 *   - makeExpiryWindowPredicate + filterExpiredTasks:纯函数,直接 unit test
 *   - getExpiredTasksSummary:mock supabase.from chain(对齐 TaskService.test.tsx
 *     模式 — 避免 module-level 副作用 / 环境变量依赖)
 *
 * 严格 scope:
 *   - 不测 UI 渲染(留 T-US015-2)
 *   - 不测 family_settings 写(留 T-US017-3)
 *   - 不测 banner 关闭状态(留 T-US015-3)
 */

import type { TaskRow, FamilySettingsRow } from '../src/types/database';
import {
  makeExpiryWindowPredicate,
  filterExpiredTasks,
  getExpiredTasksSummary,
  type ExpiryWindow,
} from '../src/services/ExpiryService';

// ---- Mock supabase to avoid env-var check on module load ----

jest.mock('../src/lib/supabase', () => {
  // mock 工厂:返回可控 chain — 测试 case 各自 setMock 设置返回值
  const mockChain = {
    from: jest.fn(),
    select: jest.fn(),
    eq: jest.fn(),
    maybeSingle: jest.fn(),
  };
  // chain 自身可链式调用 → 每一层返回 mockChain
  mockChain.from.mockReturnValue(mockChain);
  mockChain.select.mockReturnValue(mockChain);
  mockChain.eq.mockReturnValue(mockChain);
  return {
    supabase: mockChain,
    // 暴露内部 mockChain 给测试 setMock 用 — 通过 requireActual hack 太脆,
    // 直接给测试访问 mockChain 的入口
    __mockChain: mockChain,
  };
});

// ---- Helper:访问 supabase mock chain ----
const { supabase, __mockChain } = jest.requireMock('../src/lib/supabase') as {
  supabase: {
    from: jest.Mock;
    select: jest.Mock;
    eq: jest.Mock;
    maybeSingle: jest.Mock;
  };
  __mockChain: {
    from: jest.Mock;
    select: jest.Mock;
    eq: jest.Mock;
    maybeSingle: jest.Mock;
  };
};

// ---- Test fixtures ----------------------------------------------------

const TODAY = '2026-09-23';
const YESTERDAY = '2026-09-22';
const TWO_DAYS_AGO = '2026-09-21';
const THREE_DAYS_AGO = '2026-09-20';
const SIX_DAYS_AGO = '2026-09-17';
const ONE_WEEK_AGO = '2026-09-16';
const EIGHT_DAYS_AGO = '2026-09-15';
const FAMILY_ID = 'family-uuid';

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'task-uuid',
    template_id: null,
    family_id: FAMILY_ID,
    title: '喂奶粉',
    description: null,
    task_date: YESTERDAY,
    task_time: '10:00:00',
    assignee_id: 'user-uuid',
    co_executor_ids: [],
    is_shared_view: false,
    created_by: 'user-uuid',
    completed_at: null,
    completed_by: null,
    is_makeup: false,
    cancelled: false,
    created_at: '2026-09-22T00:00:00.000Z',
    updated_at: '2026-09-22T00:00:00.000Z',
    ...overrides,
  };
}

function makeSettingsRow(overrides: Partial<FamilySettingsRow> = {}): FamilySettingsRow {
  return {
    family_id: FAMILY_ID,
    morning_digest_time: '08:00:00',
    evening_digest_time: '20:00:00',
    digest_time_min: '07:00:00',
    digest_time_max: '21:00:00',
    expiry_window: 'yesterday_today',
    late_checkin_cutoff: 'same_day_2359',
    created_at: '2026-09-15T00:00:00.000Z',
    updated_at: '2026-09-15T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// =====================================================================
// 1. makeExpiryWindowPredicate — 4 窗口 × 边界
// =====================================================================

describe('ExpiryService.makeExpiryWindowPredicate', () => {
  it('window=off always returns false (no tasks in window)', () => {
    const predicate = makeExpiryWindowPredicate('off', TODAY);
    expect(predicate(makeTask({ task_date: YESTERDAY }))).toBe(false);
    expect(predicate(makeTask({ task_date: TODAY }))).toBe(false);
    expect(predicate(makeTask({ task_date: ONE_WEEK_AGO }))).toBe(false);
    expect(predicate(makeTask({ task_date: '2025-01-01' }))).toBe(false);
  });

  it('window=yesterday_today matches task_date ∈ {yesterday, today}', () => {
    const predicate = makeExpiryWindowPredicate('yesterday_today', TODAY);
    expect(predicate(makeTask({ task_date: YESTERDAY }))).toBe(true);
    expect(predicate(makeTask({ task_date: TODAY }))).toBe(true);
    expect(predicate(makeTask({ task_date: TWO_DAYS_AGO }))).toBe(false); // 超出
    expect(predicate(makeTask({ task_date: ONE_WEEK_AGO }))).toBe(false); // 超出
  });

  it('window=this_week matches task_date ∈ [today-6, today] (7-day window)', () => {
    const predicate = makeExpiryWindowPredicate('this_week', TODAY);
    expect(predicate(makeTask({ task_date: TODAY }))).toBe(true);
    expect(predicate(makeTask({ task_date: YESTERDAY }))).toBe(true); // today-1
    expect(predicate(makeTask({ task_date: THREE_DAYS_AGO }))).toBe(true); // today-3
    expect(predicate(makeTask({ task_date: ONE_WEEK_AGO }))).toBe(false); // today-7(超出,下界 today-6)
    expect(predicate(makeTask({ task_date: EIGHT_DAYS_AGO }))).toBe(false); // today-8(超出)
  });

  it('window=all always returns true (all tasks in window)', () => {
    const predicate = makeExpiryWindowPredicate('all', TODAY);
    expect(predicate(makeTask({ task_date: YESTERDAY }))).toBe(true);
    expect(predicate(makeTask({ task_date: ONE_WEEK_AGO }))).toBe(true);
    expect(predicate(makeTask({ task_date: '2025-01-01' }))).toBe(true); // 远古
    expect(predicate(makeTask({ task_date: '2099-12-31' }))).toBe(true); // 未来
  });

  it('TS exhaustiveness: all 4 ExpiryWindow values produce a predicate', () => {
    // 防御:TS switch 完整性 — 4 个 case 都返函数
    const windows: ExpiryWindow[] = ['off', 'yesterday_today', 'this_week', 'all'];
    for (const w of windows) {
      const predicate = makeExpiryWindowPredicate(w, TODAY);
      expect(typeof predicate).toBe('function');
      // 调用 predicate 至少 1 次不会抛错
      expect(() => predicate(makeTask())).not.toThrow();
    }
  });
});

// =====================================================================
// 2. filterExpiredTasks — 4 窗口 + 3 排除条件 + 排序
// =====================================================================

describe('ExpiryService.filterExpiredTasks', () => {
  // ---------------------------------------------------------------
  // 3 排除条件
  // ---------------------------------------------------------------

  it('excludes cancelled tasks (cancelled=true → not in expired list)', () => {
    const tasks = [
      makeTask({ id: 't1', cancelled: true }),
      makeTask({ id: 't2', cancelled: false }),
    ];
    const expired = filterExpiredTasks(tasks, 'all', TODAY);
    expect(expired.map((t) => t.id)).toEqual(['t2']);
  });

  it('excludes completed tasks (completed_at 非 null → not in expired list)', () => {
    const tasks = [
      makeTask({ id: 't1', completed_at: '2026-09-22T10:05:00Z' }),
      makeTask({ id: 't2', completed_at: null }),
    ];
    const expired = filterExpiredTasks(tasks, 'all', TODAY);
    expect(expired.map((t) => t.id)).toEqual(['t2']);
  });

  it('excludes tasks with task_date >= today (today/future tasks not expired)', () => {
    const tasks = [
      makeTask({ id: 'today', task_date: TODAY }),
      makeTask({ id: 'future', task_date: '2099-12-31' }),
      makeTask({ id: 'past', task_date: YESTERDAY }),
    ];
    const expired = filterExpiredTasks(tasks, 'all', TODAY);
    expect(expired.map((t) => t.id)).toEqual(['past']);
  });

  // ---------------------------------------------------------------
  // 4 窗口
  // ---------------------------------------------------------------

  it('window=off returns empty array (no expired tasks counted)', () => {
    const tasks = [
      makeTask({ id: 't1', task_date: YESTERDAY }),
      makeTask({ id: 't2', task_date: ONE_WEEK_AGO }),
    ];
    expect(filterExpiredTasks(tasks, 'off', TODAY)).toEqual([]);
  });

  it('window=yesterday_today counts only yesterday + today range tasks', () => {
    const tasks = [
      makeTask({ id: 'today-task', task_date: TODAY }),
      makeTask({ id: 'yesterday-task', task_date: YESTERDAY }),
      makeTask({ id: 'two-days-ago', task_date: TWO_DAYS_AGO }), // 超出
    ];
    const expired = filterExpiredTasks(tasks, 'yesterday_today', TODAY);
    // 期望:today-task 被 task_date ≥ today 排除(不算过期),只有 yesterday-task
    expect(expired.map((t) => t.id)).toEqual(['yesterday-task']);
  });

  it('window=this_week counts tasks in [today-6, today] range', () => {
    const tasks = [
      makeTask({ id: 'one-day', task_date: YESTERDAY }), // today-1 ✓
      makeTask({ id: 'three-days', task_date: THREE_DAYS_AGO }), // today-3 ✓
      makeTask({ id: 'six-days', task_date: SIX_DAYS_AGO }), // today-6 ✓ (下界)
      makeTask({ id: 'one-week', task_date: ONE_WEEK_AGO }), // today-7 ✗
      makeTask({ id: 'eight-days', task_date: EIGHT_DAYS_AGO }), // today-8 ✗
    ];
    const expired = filterExpiredTasks(tasks, 'this_week', TODAY);
    // asc by task_date: six-days (09-17) < three-days (09-20) < one-day (09-22)
    expect(expired.map((t) => t.id)).toEqual(['six-days', 'three-days', 'one-day']);
  });

  it('window=all counts all expired tasks (no window restriction)', () => {
    const tasks = [
      makeTask({ id: 'recent', task_date: YESTERDAY }),
      makeTask({ id: 'ancient', task_date: '2025-01-01' }), // 远古但 expired
    ];
    const expired = filterExpiredTasks(tasks, 'all', TODAY);
    expect(expired.map((t) => t.id)).toEqual(['ancient', 'recent']); // asc by date
  });

  // ---------------------------------------------------------------
  // 排序
  // ---------------------------------------------------------------

  it('sorts by task_date asc, then task_time asc, then created_at asc', () => {
    const tasks = [
      makeTask({ id: 'late-time', task_date: YESTERDAY, task_time: '20:00:00' }),
      makeTask({ id: 'early-time', task_date: YESTERDAY, task_time: '08:00:00' }),
      makeTask({ id: 'earlier-date', task_date: TWO_DAYS_AGO, task_time: '10:00:00' }),
    ];
    const expired = filterExpiredTasks(tasks, 'all', TODAY);
    expect(expired.map((t) => t.id)).toEqual(['earlier-date', 'early-time', 'late-time']);
  });

  it('treats task_time=null as 99:99:99 (sorted last within same date)', () => {
    // 同日期:有时间的在前,null 在后(与 taskListFilters.filterTasks 对齐)
    const tasks = [
      makeTask({ id: 'with-time', task_date: YESTERDAY, task_time: '10:00:00' }),
      makeTask({ id: 'no-time', task_date: YESTERDAY, task_time: null }),
    ];
    const expired = filterExpiredTasks(tasks, 'all', TODAY);
    expect(expired.map((t) => t.id)).toEqual(['with-time', 'no-time']);
  });

  it('returns new array (does not mutate input)', () => {
    const tasks = [makeTask({ id: 't1' })];
    const inputRef = tasks;
    const expired = filterExpiredTasks(tasks, 'all', TODAY);
    expect(tasks).toBe(inputRef); // 入参引用未变
    expect(expired).not.toBe(tasks); // 输出是新数组
  });
});

// =====================================================================
// 3. getExpiredTasksSummary — 服务层入口(调 supabase)
// =====================================================================

describe('ExpiryService.getExpiredTasksSummary', () => {
  it('returns {count:0, tasks:[], window} when familyId is empty (defense)', async () => {
    // 防御:无 familyId 时(理论上 hook 已 Gate)— 返兜底,避免空 family 查询
    const summary = await getExpiredTasksSummary('', [makeTask()], TODAY);
    expect(summary).toEqual({ count: 0, tasks: [], window: 'yesterday_today' });
    // 不应调 supabase
    expect(__mockChain.from).not.toHaveBeenCalled();
  });

  it('reads expiry_window from family_settings (happy path)', async () => {
    __mockChain.maybeSingle.mockResolvedValueOnce({
      data: makeSettingsRow({ expiry_window: 'this_week' }),
      error: null,
    });
    const tasks = [
      makeTask({ id: 't1', task_date: YESTERDAY }), // today-1 ✓
      makeTask({ id: 't2', task_date: SIX_DAYS_AGO }), // today-6 ✓
      makeTask({ id: 't3', task_date: ONE_WEEK_AGO }), // today-7 ✗(超出)
    ];
    const summary = await getExpiredTasksSummary(FAMILY_ID, tasks, TODAY);
    expect(summary.window).toBe('this_week');
    expect(summary.count).toBe(2); // t1 + t2
    expect(summary.tasks.map((t) => t.id)).toEqual(['t2', 't1']); // asc by date
  });

  it('falls back to yesterday_today when family_settings has no row', async () => {
    __mockChain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const tasks = [makeTask({ id: 't1', task_date: YESTERDAY })];
    const summary = await getExpiredTasksSummary(FAMILY_ID, tasks, TODAY);
    expect(summary.window).toBe('yesterday_today');
    expect(summary.count).toBe(1);
  });

  it('falls back to yesterday_today when family_settings query errors (no throw)', async () => {
    // 防御:query 失败不抛错 → console.warn + fallback
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    __mockChain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection timeout' },
    });
    const tasks = [makeTask({ id: 't1', task_date: YESTERDAY })];
    const summary = await getExpiredTasksSummary(FAMILY_ID, tasks, TODAY);
    expect(summary.window).toBe('yesterday_today');
    expect(summary.count).toBe(1); // filter 仍执行
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('falls back to yesterday_today when family_settings query throws (paranoid catch)', async () => {
    // 防御:query 抛同步异常(理论 maybeSingle 返回 Promise 不抛,但保留 catch 兜底)
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    __mockChain.maybeSingle.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const tasks = [makeTask({ id: 't1', task_date: YESTERDAY })];
    const summary = await getExpiredTasksSummary(FAMILY_ID, tasks, TODAY);
    expect(summary.window).toBe('yesterday_today');
    expect(summary.count).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns 0 count when no expired tasks match the window', async () => {
    __mockChain.maybeSingle.mockResolvedValueOnce({
      data: makeSettingsRow({ expiry_window: 'yesterday_today' }),
      error: null,
    });
    // 所有 task_date ≥ today → 全部排除
    const tasks = [
      makeTask({ id: 'today', task_date: TODAY }),
      makeTask({ id: 'future', task_date: '2099-12-31' }),
    ];
    const summary = await getExpiredTasksSummary(FAMILY_ID, tasks, TODAY);
    expect(summary.count).toBe(0);
    expect(summary.tasks).toEqual([]);
    expect(summary.window).toBe('yesterday_today');
  });

  it('integrates cancelled/completed_at exclusion with window (real-world filter)', async () => {
    __mockChain.maybeSingle.mockResolvedValueOnce({
      data: makeSettingsRow({ expiry_window: 'all' }),
      error: null,
    });
    const tasks = [
      makeTask({ id: 'valid-expired', task_date: YESTERDAY }),
      makeTask({ id: 'cancelled', task_date: YESTERDAY, cancelled: true }), // 排除
      makeTask({ id: 'completed', task_date: YESTERDAY, completed_at: '2026-09-22T10:05:00Z' }), // 排除
    ];
    const summary = await getExpiredTasksSummary(FAMILY_ID, tasks, TODAY);
    expect(summary.count).toBe(1);
    expect(summary.tasks.map((t) => t.id)).toEqual(['valid-expired']);
  });

  it('calls supabase.from("family_settings") with family_id eq filter', async () => {
    // 防御:确保 query 走正确表 + 正确 filter(避免未来重构漂移到错误表)
    __mockChain.maybeSingle.mockResolvedValueOnce({
      data: makeSettingsRow(),
      error: null,
    });
    await getExpiredTasksSummary(FAMILY_ID, [], TODAY);
    expect(__mockChain.from).toHaveBeenCalledWith('family_settings');
    expect(__mockChain.eq).toHaveBeenCalledWith('family_id', FAMILY_ID);
    expect(__mockChain.maybeSingle).toHaveBeenCalled();
  });
});