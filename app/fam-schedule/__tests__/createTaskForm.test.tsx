/**
 * createTaskForm 单元测试 — T-US003-2 + T-US005-1 + T-US005-2 + T-US005-3 + T-US014-2
 *
 * 本测试文件存在原因(createTaskForm.ts 主体测试在 CreateTaskScreen.test.tsx):
 *   - mapDeleteFailureReason 是 TaskService.deleteTask 失败 reason 的中文翻译
 *   - mapCheckInFailureReason 是 CheckInService.checkin 失败 reason 的中文翻译
 *     (T-US005-1 新增)
 *   - 与 EditTaskScreen.mapUpdateFailureReason 同模式
 *   - 因为是纯函数 + 不依赖 RN,单独抽出便于覆盖
 *   - **T-US005-2 新增**:mapCheckInResultToToast 把 CheckInResult 翻译成 UI toast 文案
 *     (3 status × task title 边界)
 *   - **T-US005-3 新增**:mapUndoCheckInFailureReason — 撤销失败 reason(8 reasons)
 *   - **T-US014-2 新增**:formatOverdueHours — 详情页过期 banner 文案派生
 *
 * 覆盖范围:
 *   - mapDeleteFailureReason:7 种 reason → 对应中文文案 + 默认值兜底
 *   - mapCheckInFailureReason:6 种 reason → 对应中文文案 + 默认值兜底
 *   - **T-US005-2**:mapCheckInResultToToast:3 status → success / spouse_completed / error
 *   - **T-US005-3**:mapUndoCheckInFailureReason:8 reasons → 对应中文文案
 *   - **T-US014-2**:formatOverdueHours:4 排除态 + 3 文案分支 + 时钟漂移防御
 *
 * 设计依据:
 *   - 任务 brief §B 翻译映射表
 *   - 设计 task-detail-v1.0 §6 文案 / §10 Toast / §3.2 OverdueBanner
 */

import {
  mapDeleteFailureReason,
  mapCheckInFailureReason,
  mapCheckInResultToToast,
  mapUndoCheckInFailureReason,
} from '../src/lib/createTaskForm';
import type { CheckInResult, UndoCheckInFailureReason } from '../src/services/CheckInService';

describe('createTaskForm.mapDeleteFailureReason', () => {
  it('translates "not_authenticated" to "请先登录"', () => {
    expect(mapDeleteFailureReason('not_authenticated')).toBe('请先登录');
  });

  it('translates "no_family" to "你还没加入家庭"', () => {
    expect(mapDeleteFailureReason('no_family')).toBe('你还没加入家庭');
  });

  it('translates "task_not_found" to "任务不存在或已被删除"', () => {
    expect(mapDeleteFailureReason('task_not_found')).toBe('任务不存在或已被删除');
  });

  it('translates "not_owner" to "只有创建者可以删除任务"', () => {
    expect(mapDeleteFailureReason('not_owner')).toBe('只有创建者可以删除任务');
  });

  it('translates "template_not_supported" to template deactivation hint', () => {
    const message = mapDeleteFailureReason('template_not_supported');
    // 不锁具体文案(后续 polish 时可改),只确认是中文 + 含「模板」
    expect(message).toMatch(/模板/);
    expect(message.length).toBeGreaterThan(0);
  });

  it('translates "rls_denied" to "没有删除权限"', () => {
    expect(mapDeleteFailureReason('rls_denied')).toBe('没有删除权限');
  });

  it('translates "unknown" to generic retry hint "删除失败,请重试"', () => {
    expect(mapDeleteFailureReason('unknown')).toBe('删除失败,请重试');
  });

  it('all 7 reasons produce a non-empty Chinese string', () => {
    const reasons = [
      'not_authenticated',
      'no_family',
      'task_not_found',
      'not_owner',
      'template_not_supported',
      'rls_denied',
      'unknown',
    ] as const;
    for (const r of reasons) {
      const msg = mapDeleteFailureReason(r);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
      // 简单的中文特征:至少有一个中文字符(\u4e00-\u9fff)
      expect(msg).toMatch(/[\u4e00-\u9fff]/);
    }
  });
});

// =====================================================================
// T-US005-1: mapCheckInFailureReason — 打卡失败 reason 翻译
// =====================================================================
//
// 覆盖范围:
//   - 6 种 reason → 对应中文文案(任务 brief §A-6 明确翻译表)
//   - 全部 reason 都 produce 非空中文(防御 / 默认值兜底)

describe('createTaskForm.mapCheckInFailureReason', () => {
  it('translates "not_authenticated" to "请先登录"', () => {
    expect(mapCheckInFailureReason('not_authenticated')).toBe('请先登录');
  });

  it('translates "no_family" to "你还没加入家庭"', () => {
    expect(mapCheckInFailureReason('no_family')).toBe('你还没加入家庭');
  });

  it('translates "task_not_found" to "任务不存在或已被删除"', () => {
    expect(mapCheckInFailureReason('task_not_found')).toBe('任务不存在或已被删除');
  });

  it('translates "cancelled" to "任务已取消,无法打卡"', () => {
    expect(mapCheckInFailureReason('cancelled')).toBe('任务已取消,无法打卡');
  });

  it('translates "rls_denied" to "没有打卡权限"', () => {
    expect(mapCheckInFailureReason('rls_denied')).toBe('没有打卡权限');
  });

  it('translates "unknown" to generic retry hint "打卡失败,请重试"', () => {
    expect(mapCheckInFailureReason('unknown')).toBe('打卡失败,请重试');
  });

  it('all 6 reasons produce a non-empty Chinese string (defense / coverage bar)', () => {
    const reasons = [
      'not_authenticated',
      'no_family',
      'task_not_found',
      'cancelled',
      'rls_denied',
      'unknown',
    ] as const;
    for (const r of reasons) {
      const msg = mapCheckInFailureReason(r);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
      // 简单的中文特征:至少有一个中文字符(\u4e00-\u9fff)
      expect(msg).toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it('"cancelled" label differs from delete-task "task_cancelled" — distinct UX hint', () => {
    // 防御:打卡的 cancelled 文案要引导用户"无法打卡";避免与 deleteTask
    // 复用一条文案(虽然两者 reason key 命名空间不冲突 — 这是 UX 守卫而非 TS 守卫)。
    expect(mapCheckInFailureReason('cancelled')).toContain('取消');
    expect(mapCheckInFailureReason('cancelled')).toContain('打卡');
  });
});

// =====================================================================
// T-US005-2: mapCheckInResultToToast — CheckInResult → UI toast 文案翻译
// =====================================================================
//
// 覆盖范围(任务 brief §B.2 + 设计 task-detail-v1.0 §6):
//   - checked_in:title="已打卡 ✨" / body="「<title>」已完成" / variant=success
//   - spouse_completed:title="配偶已先一步完成" / body="「<title>」由配偶于 HH:MM 完成"
//                     / variant=spouse_completed(从 completedAt slice(11,16) 提取 HH:MM)
//   - failed:title="打卡失败" / body=mapCheckInFailureReason(reason) / variant=error
//
// 设计依据:
//   - 集中文案便于后续 i18n(react-i18next)
//   - TS exhaustiveness:对 CheckInResult 3 status 全部 case 覆盖

describe('createTaskForm.mapCheckInResultToToast — T-US005-2', () => {
  const TASK_TITLE = '喂奶粉';

  it('translates checked_in to "已打卡 ✨" success toast (variant=success)', () => {
    const result: CheckInResult = {
      status: 'checked_in',
      taskId: 'task-uuid',
      completedAt: '2026-09-23T10:35:00Z',
      completedBy: 'me-uuid',
      isMakeup: false,
    };

    const toast = mapCheckInResultToToast(result, TASK_TITLE);

    expect(toast.variant).toBe('success');
    expect(toast.title).toBe('已打卡 ✨');
    expect(toast.body).toBe(`「${TASK_TITLE}」已完成`);
  });

  it('translates spouse_completed to "配偶已先一步完成" + HH:MM extraction from ISO', () => {
    const result: CheckInResult = {
      status: 'spouse_completed',
      taskId: 'task-uuid',
      // ISO 8601 UTC 'YYYY-MM-DDTHH:MM:SS.sssZ'
      // slice(11, 16) → 'HH:MM' (10:30 here)
      completedAt: '2026-09-23T10:30:00Z',
      completedBy: 'spouse-uuid',
    };

    const toast = mapCheckInResultToToast(result, TASK_TITLE);

    expect(toast.variant).toBe('spouse_completed');
    expect(toast.title).toBe('配偶已先一步完成');
    expect(toast.body).toBe(`「${TASK_TITLE}」由配偶于 10:30 完成`);
  });

  it('extracts HH:MM correctly for various ISO timestamps (boundary: noon, midnight, late evening)', () => {
    const testCases: Array<{ iso: string; expected: string }> = [
      { iso: '2026-09-23T00:05:00Z', expected: '00:05' }, // 凌晨
      { iso: '2026-09-23T12:00:00Z', expected: '12:00' }, // 正午
      { iso: '2026-09-23T23:59:00Z', expected: '23:59' }, // 深夜
    ];

    for (const tc of testCases) {
      const result: CheckInResult = {
        status: 'spouse_completed',
        taskId: 'task-uuid',
        completedAt: tc.iso,
        completedBy: 'spouse-uuid',
      };
      const toast = mapCheckInResultToToast(result, TASK_TITLE);
      expect(toast.body).toBe(`「${TASK_TITLE}」由配偶于 ${tc.expected} 完成`);
    }
  });

  it('translates failed to "打卡失败" + mapped failure reason (variant=error)', () => {
    const result: CheckInResult = {
      status: 'failed',
      reason: 'no_family',
    };

    const toast = mapCheckInResultToToast(result, TASK_TITLE);

    expect(toast.variant).toBe('error');
    expect(toast.title).toBe('打卡失败');
    // body 直接复用 mapCheckInFailureReason(reason) — 文案一致性
    expect(toast.body).toBe('你还没加入家庭');
    // 防御:失败 toast 不应包含 task title(失败时无业务上下文)
    expect(toast.body).not.toContain(TASK_TITLE);
  });

  it('all 3 variants produce non-empty title + body with Chinese characters', () => {
    // 防御:覆盖 3 status,确保每种都 produce 非空中文(title + body 都含中文字符)
    const results: CheckInResult[] = [
      {
        status: 'checked_in',
        taskId: 'task-uuid',
        completedAt: '2026-09-23T10:35:00Z',
        completedBy: 'me-uuid',
        isMakeup: false,
      },
      {
        status: 'spouse_completed',
        taskId: 'task-uuid',
        completedAt: '2026-09-23T10:30:00Z',
        completedBy: 'spouse-uuid',
      },
      { status: 'failed', reason: 'unknown' },
    ];

    for (const r of results) {
      const toast = mapCheckInResultToToast(r, TASK_TITLE);
      expect(typeof toast.title).toBe('string');
      expect(typeof toast.body).toBe('string');
      expect(toast.title.length).toBeGreaterThan(0);
      expect(toast.body.length).toBeGreaterThan(0);
      expect(toast.title).toMatch(/[\u4e00-\u9fff]/);
      expect(toast.body).toMatch(/[\u4e00-\u9fff]/);
      // variant 必须是合法值
      expect(['success', 'spouse_completed', 'error']).toContain(toast.variant);
    }
  });
});

// =====================================================================
// T-US005-3: mapUndoCheckInFailureReason — 撤销失败 reason 翻译(8 reasons)
// =====================================================================
//
// 文案(任务 brief §A-7 明确翻译表):
//   not_authenticated     → "请先登录"
//   no_family             → "你还没加入家庭"
//   task_not_found        → "任务不存在或已被删除"
//   not_owner             → "只有打卡人可以撤销"
//   task_not_checked_in   → "尚未打卡,无需撤销"
//   undo_window_expired   → "撤销窗口已过期,无法撤销"
//   rls_denied            → "没有撤销权限"
//   unknown               → "撤销失败,请重试"

describe('createTaskForm.mapUndoCheckInFailureReason — T-US005-3', () => {
  it('translates "not_authenticated" to "请先登录"', () => {
    expect(mapUndoCheckInFailureReason('not_authenticated')).toBe('请先登录');
  });

  it('translates "no_family" to "你还没加入家庭"', () => {
    expect(mapUndoCheckInFailureReason('no_family')).toBe('你还没加入家庭');
  });

  it('translates "task_not_found" to "任务不存在或已被删除"', () => {
    expect(mapUndoCheckInFailureReason('task_not_found')).toBe('任务不存在或已被删除');
  });

  it('translates "not_owner" to "只有打卡人可以撤销"', () => {
    expect(mapUndoCheckInFailureReason('not_owner')).toBe('只有打卡人可以撤销');
  });

  it('translates "task_not_checked_in" to "尚未打卡,无需撤销"', () => {
    expect(mapUndoCheckInFailureReason('task_not_checked_in')).toBe('尚未打卡,无需撤销');
  });

  it('translates "undo_window_expired" to "撤销窗口已过期,无法撤销"', () => {
    expect(mapUndoCheckInFailureReason('undo_window_expired')).toBe(
      '撤销窗口已过期,无法撤销',
    );
  });

  it('translates "rls_denied" to "没有撤销权限"', () => {
    expect(mapUndoCheckInFailureReason('rls_denied')).toBe('没有撤销权限');
  });

  it('translates "unknown" to "撤销失败,请重试"', () => {
    expect(mapUndoCheckInFailureReason('unknown')).toBe('撤销失败,请重试');
  });

  it('all 8 reasons produce a non-empty Chinese string (defense / coverage bar)', () => {
    const reasons: UndoCheckInFailureReason[] = [
      'not_authenticated',
      'no_family',
      'task_not_found',
      'not_owner',
      'task_not_checked_in',
      'undo_window_expired',
      'rls_denied',
      'unknown',
    ];
    for (const r of reasons) {
      const msg = mapUndoCheckInFailureReason(r);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it('"undo_window_expired" label mentions window expired (distinct UX hint)', () => {
    // UX 守卫:撤销特定的"窗口已过期"文案要明确时间维度,避免被复用为通用错误
    expect(mapUndoCheckInFailureReason('undo_window_expired')).toContain('窗口');
    expect(mapUndoCheckInFailureReason('undo_window_expired')).toContain('过期');
  });

  it('"task_not_checked_in" label distinguishes from generic "task_not_found"', () => {
    // UX 守卫:虽然都是 task 维度的失败,但撤销对未打卡任务的提示应区分
    // - task_not_found → "任务不存在或已被删除"
    // - task_not_checked_in → "尚未打卡,无需撤销"
    // 两条文案不应混淆
    expect(mapUndoCheckInFailureReason('task_not_checked_in')).not.toBe(
      mapUndoCheckInFailureReason('task_not_found'),
    );
  });
});

// =====================================================================
// T-US014-2: formatOverdueHours — 详情页过期 banner 文案派生
// =====================================================================
//
// 覆盖范围(任务 brief §C.2 + 设计 task-detail-v1.0 §3.2):
//   - 排除态:cancelled / completed / task_date ≥ today → showBanner=false
//   - 文案分支:hours<1 刚过期 / hours<24 整数小时 / hours≥24 天
//   - 边界:0 / 1 / 23 / 24 / 168 小时
//   - task_time null vs 有值差异(全天任务 fallback 23:59:59)
//
// 测试策略:
//   - now 固定 2026-09-23 12:00:00 UTC 作为基线 epoch ms(可用 .getTime() 直接算出)
//   - task_date 用 'YYYY-MM-DD' 字符串,与生产 DB DATE 列格式一致
//   - 6 用例覆盖 4 排除态 + 3 文案分支 + 1 边界组合

import { formatOverdueHours } from '../src/lib/createTaskForm';
import type { TaskRow } from '../src/types/database';

// ---- 时间基线(now = 2026-09-23 12:00:00 本地时间) ----
// 用本地时区构造器 new Date(y, m, d, h, min) 而非 Date.UTC(...),因为实现层
// `toLocalIsoDate` 是本地时区,且 `new Date(\`${task_date}T${task_time}\`)` 不带 'Z'
// 后缀按本地时区解析。测试用本地时间保持一致,避免时区漂移。
// month 是 0-indexed: 8 = 9 月
const NOW_BASE = new Date(2026, 8, 23, 12, 0, 0).getTime();
const TODAY = '2026-09-23';
const YESTERDAY = '2026-09-22';
const TWO_DAYS_AGO = '2026-09-21';
const ONE_WEEK_AGO = '2026-09-16';

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'task-uuid',
    template_id: null,
    family_id: 'family-uuid',
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

describe('createTaskForm.formatOverdueHours — T-US014-2', () => {
  // --------------------------------------------------------------
  // 排除态:不显示 banner
  // --------------------------------------------------------------

  it('returns showBanner=false when task is cancelled', () => {
    // cancelled 任务不再过期 — 用户已主动取消,banner 不应出现(避免噪声)
    const result = formatOverdueHours(makeTask({ cancelled: true }), NOW_BASE);
    expect(result).toEqual({ hours: 0, displayText: '', showBanner: false });
  });

  it('returns showBanner=false when task is completed (completed_at set)', () => {
    // 已完成的任务不算过期(无论完成时间早晚)— 用户已通过打卡闭环
    const result = formatOverdueHours(
      makeTask({ completed_at: '2026-09-22T10:05:00Z' }),
      NOW_BASE,
    );
    expect(result).toEqual({ hours: 0, displayText: '', showBanner: false });
  });

  it('returns showBanner=false when task_date equals today (boundary: same day)', () => {
    // task_date === today → 当天任务,不算过期(可能稍后过期,但今天内还没过期)
    const result = formatOverdueHours(
      makeTask({ task_date: TODAY, task_time: '23:59:00' }),
      NOW_BASE,
    );
    expect(result).toEqual({ hours: 0, displayText: '', showBanner: false });
  });

  it('returns showBanner=false when task_date is in the future', () => {
    // 未来日期不算过期(防御性)
    const result = formatOverdueHours(
      makeTask({ task_date: '2026-09-25', task_time: '10:00:00' }),
      NOW_BASE,
    );
    expect(result).toEqual({ hours: 0, displayText: '', showBanner: false });
  });

  // --------------------------------------------------------------
  // 文案分支:showBanner=true
  // --------------------------------------------------------------

  it('returns "刚刚过期" when hours < 1 (just crossed expiry)', () => {
    // task_date = yesterday, task_time = 23:59:59(过期起点 = yesterday 23:59:59 本地)
    // now = today 00:30:00 本地 → elapsed = today 00:30 - yesterday 23:59:59 ≈ 30m < 1h
    // 注意:today 的 toLocalIsoDate = '2026-09-23' > task_date = '2026-09-22' → 不走排除分支
    const justExpiredNow = new Date(2026, 8, 23, 0, 30, 0).getTime();
    const result = formatOverdueHours(
      makeTask({ task_date: YESTERDAY, task_time: '23:59:59' }),
      justExpiredNow,
    );
    expect(result.showBanner).toBe(true);
    expect(result.displayText).toBe('刚刚过期');
    expect(result.hours).toBe(0);
  });

  it('returns "已过期 N 小时" when 1 ≤ hours < 24 (integer hours)', () => {
    // task_time = 10:00 yesterday, now = 12:00 today
    // elapsed = (24-10) + 12 = 26h → 走 days 分支(not integer hours)
    // 调整为 task_time = 14:00 yesterday, now = 12:00 today
    // elapsed = (24-14) + 12 = 22h → 整数小时分支 ✓
    const result = formatOverdueHours(
      makeTask({ task_date: YESTERDAY, task_time: '14:00:00' }),
      NOW_BASE, // 2026-09-23 12:00 UTC
    );
    expect(result.showBanner).toBe(true);
    expect(result.displayText).toBe('已过期 22 小时');
    expect(result.hours).toBe(22);
  });

  it('returns "已过期 23 小时" at the 23-hour boundary (max of hour-branch)', () => {
    // task_time = 13:00 yesterday, now = 12:00 today = 23h exactly
    const result = formatOverdueHours(
      makeTask({ task_date: YESTERDAY, task_time: '13:00:00' }),
      NOW_BASE,
    );
    expect(result.showBanner).toBe(true);
    expect(result.displayText).toBe('已过期 23 小时');
    expect(result.hours).toBe(23);
  });

  it('returns "已过期 1 天" at the 24-hour boundary (min of day-branch)', () => {
    // task_time = 12:00 yesterday, now = 12:00 today = 24h exactly → 1 天
    const result = formatOverdueHours(
      makeTask({ task_date: YESTERDAY, task_time: '12:00:00' }),
      NOW_BASE,
    );
    expect(result.showBanner).toBe(true);
    expect(result.displayText).toBe('已过期 1 天');
    expect(result.hours).toBe(24);
  });

  it('returns "已过期 N 天" when hours ≥ 24 (e.g., 1 week ago = 7 days)', () => {
    // task_time = 12:00 one week ago, now = 12:00 today = 168h = 7 天
    const result = formatOverdueHours(
      makeTask({ task_date: ONE_WEEK_AGO, task_time: '12:00:00' }),
      NOW_BASE,
    );
    expect(result.showBanner).toBe(true);
    expect(result.displayText).toBe('已过期 7 天');
    expect(result.hours).toBe(168);
  });

  // --------------------------------------------------------------
  // 边界与防御
  // --------------------------------------------------------------

  it('returns "已过期 2 天" for 2-days-ago task (boundary: 48h)', () => {
    // 48h exactly = 2 days
    const result = formatOverdueHours(
      makeTask({ task_date: TWO_DAYS_AGO, task_time: '12:00:00' }),
      NOW_BASE,
    );
    expect(result.displayText).toBe('已过期 2 天');
    expect(result.hours).toBe(48);
  });

  it('uses 23:59:59 fallback for task_time=null (all-day task expiry anchor)', () => {
    // 全天任务:task_time=null → 用 23:59:59 当天作为过期起点
    // task_date=yesterday, now=12:00 today = 12h0min - 1s ≈ 12h
    // expected: 已过期 12 小时(略小于 12,因 23:59:59 比 00:00:00 晚 23h59m59s;
    //           yesterday 23:59:59 → today 12:00:00 = 12h0min1s,实际 floor = 12)
    const result = formatOverdueHours(
      makeTask({ task_date: YESTERDAY, task_time: null }),
      NOW_BASE,
    );
    expect(result.showBanner).toBe(true);
    expect(result.displayText).toBe('已过期 12 小时');
    expect(result.hours).toBe(12);
  });

  it('returns hours=0 (showBanner=false) for all-day task created today with now < 23:59:59', () => {
    // 防御:今天创建的全天任务不应立即显示过期 banner
    // task_date=today, task_time=null → 23:59:59 → now=12:00 → 负 elapsed
    // → Math.max(0, ...) → hours=0 → 但 task_date=today 走排除分支(showBanner=false)
    const result = formatOverdueHours(
      makeTask({ task_date: TODAY, task_time: null }),
      NOW_BASE,
    );
    expect(result).toEqual({ hours: 0, displayText: '', showBanner: false });
  });

  it('handles the edge case where task_date=yesterday with task_time=23:59:59 + now=today 00:30 (elapsed < 1h)', () => {
    // 边界场景:task_date=yesterday + task_time=23:59:59 → 过期起点 = yesterday 23:59:59
    // 当 now 跨过 0:00 但 < 0:59:59 → elapsed = 30m ~ 60m
    // → Math.floor(elapsed / 3_600_000) = 0 → hours < 1 → "刚刚过期"
    // 注意:Math.max(0, ...) 防御通常不会触发,因为 now=today 总是 > yesterday 23:59:59,
    // 但 Math.max 仍保留作为 paranoid defense(代码行不会因此被删除)
    const edgeNow = new Date(2026, 8, 23, 0, 30, 0).getTime();
    const result = formatOverdueHours(
      makeTask({ task_date: YESTERDAY, task_time: '23:59:59' }),
      edgeNow,
    );
    expect(result.showBanner).toBe(true);
    expect(result.hours).toBe(0);
    expect(result.displayText).toBe('刚刚过期');
  });
});