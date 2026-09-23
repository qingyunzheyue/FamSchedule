/**
 * createTaskForm 单元测试 — T-US003-2 + T-US005-1 + T-US005-2
 *
 * 本测试文件存在原因(createTaskForm.ts 主体测试在 CreateTaskScreen.test.tsx):
 *   - mapDeleteFailureReason 是 TaskService.deleteTask 失败 reason 的中文翻译
 *   - mapCheckInFailureReason 是 CheckInService.checkin 失败 reason 的中文翻译
 *     (T-US005-1 新增)
 *   - 与 EditTaskScreen.mapUpdateFailureReason 同模式
 *   - 因为是纯函数 + 不依赖 RN,单独抽出便于覆盖
 *   - **T-US005-2 新增**:mapCheckInResultToToast 把 CheckInResult 翻译成 UI toast 文案
 *     (3 status × task title 边界)
 *
 * 覆盖范围:
 *   - mapDeleteFailureReason:7 种 reason → 对应中文文案 + 默认值兜底
 *   - mapCheckInFailureReason:6 种 reason → 对应中文文案 + 默认值兜底
 *   - **T-US005-2 新增**:mapCheckInResultToToast:3 status → success / spouse_completed / error
 *
 * 设计依据:
 *   - 任务 brief §B 翻译映射表
 *   - 设计 task-detail-v1.0 §6 文案 / §10 Toast
 */

import {
  mapDeleteFailureReason,
  mapCheckInFailureReason,
  mapCheckInResultToToast,
} from '../src/lib/createTaskForm';
import type { CheckInResult } from '../src/services/CheckInService';

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