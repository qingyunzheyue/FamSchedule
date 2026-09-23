/**
 * CreateTaskScreen 单元测试 — T-US001-1
 *
 * 策略:跟 JoinFamilyScreen.test.tsx (T-US012-3) 一样,只测**纯逻辑层**,
 * 不渲染 CreateTaskScreen 组件本身。
 *   - 原因:jest-expo preset 下,Tamagui 加载 `tamagui/setup.native.js` 报 ESM 错。
 *     完整渲染需改 jest config(单独 hygiene 任务)。
 *   - 替代:CreateTaskScreen 的纯逻辑已抽到 src/lib/createTaskForm.ts
 *     (validateForm / toCreateTaskInput / resolveTaskDate / resolveTaskTime /
 *      isValidDate / isValidTime / memberLabel / createInitialState)。
 *     这里测这些 helper 的契约 + 边界 + 状态机。
 *
 * 覆盖范围:
 *
 *   isValidDate:
 *     1. 合法日期格式
 *     2. 非法格式(regex 不匹配 / 月份越界 / 日期越界 / 假日期 round-trip)
 *     3. 空字符串 / 包含空格
 *
 *   isValidTime:
 *     4. 合法时间(HH:MM 00:00-23:59)
 *     5. 非法时间(小时越界 / 分钟越界 / 长度错 / 含字符)
 *
 *   createInitialState:
 *     6. 默认字段全部正确(date = today, recurrence = none, share = private, ...)
 *
 *   resolveTaskDate / resolveTaskTime:
 *     7. chip=today / tomorrow / dayAfter / custom 都映射到正确 ISO 字符串
 *     8. chip=none → taskTime = null;chip=custom → trim 用户输入;chip=am/pm → '' 占位
 *
 *   validateForm:
 *     9. happy path 全字段填写 → null(通过)
 *     10. 标题空 → '标题不能为空'
 *     11. 日期为空 → '日期不能为空'
 *     12. 日期格式错(自定义 chip + 非 YYYY-MM-DD)→ '日期格式不对'
 *     13. 日期假日期(2026-02-30)→ '日期格式不对'
 *     14. 时间空但 chip=none → 通过(null 不校验)
 *     15. 时间格式错(chip=custom + 非 HH:MM)→ '时间格式不对'
 *     16. 时间合法 → 通过
 *
 *   isRecurrenceSupported:
 *     17. only 'none' returns true;daily/weekly/monthly → false
 *
 *   toCreateTaskInput:
 *     18. happy path → shape 正确(share 翻译 / taskTime / description trim)
 *     19. description 空白 → null
 *     20. share='sharedView' → isSharedView=true;'private' → false
 *     21. chip=custom 时,taskDate 来自 form.taskDate 而非 today
 *
 *   memberLabel:
 *     22. member === currentUser → '我'
 *     23. member !== currentUser → '配偶'(2 人家庭简化)
 */

import {
  isValidDate,
  isValidTime,
  createInitialState,
  resolveTaskDate,
  resolveTaskTime,
  validateForm,
  isRecurrenceSupported,
  toCreateTaskInput,
  memberLabel,
  fromTask,
  toUpdateTaskInput,
  inferDateChip,
  inferTimeChip,
  VALIDATION_MESSAGES,
  DATE_CHIP_OPTIONS,
  TIME_CHIP_OPTIONS,
  RECURRENCE_OPTIONS,
  SHARE_OPTIONS,
  type CreateTaskFormState,
} from '../src/lib/createTaskForm';
import type { FamilyMemberRow, TaskRow } from '../src/types/database';

// =====================================================================
// Test fixtures
// =====================================================================

const CREATOR_ID = 'creator-uuid-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SPOUSE_ID = 'spouse-uuid-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/** 固定 now:2026-09-22 10:00 本地时间,所有日期相关测试都基于此 */
const FIXED_NOW = new Date(2026, 8, 22, 10, 0, 0); // 月份 0-indexed

function makeBaseForm(overrides: Partial<CreateTaskFormState> = {}): CreateTaskFormState {
  const init = createInitialState(FIXED_NOW);
  init.assigneeId = CREATOR_ID;
  return { ...init, ...overrides };
}

// =====================================================================
// isValidDate
// =====================================================================

describe('isValidDate', () => {
  it('accepts valid YYYY-MM-DD dates', () => {
    expect(isValidDate('2026-09-22')).toBe(true);
    expect(isValidDate('2026-01-01')).toBe(true);
    expect(isValidDate('2026-12-31')).toBe(true);
    expect(isValidDate('2024-02-29')).toBe(true); // 闰年
    expect(isValidDate('2026-02-28')).toBe(true);
  });

  it('rejects malformed strings', () => {
    expect(isValidDate('')).toBe(false);
    expect(isValidDate('2026-9-22')).toBe(false); // 单位月/日
    expect(isValidDate('2026/09/22')).toBe(false); // 斜杠
    expect(isValidDate('20260922')).toBe(false);
    expect(isValidDate('2026-09-22 ')).toBe(false); // 含空格
    expect(isValidDate(' 2026-09-22')).toBe(false);
    expect(isValidDate('abcd-ef-gh')).toBe(false);
  });

  it('rejects out-of-range month / day', () => {
    expect(isValidDate('2026-00-15')).toBe(false); // 月 0
    expect(isValidDate('2026-13-15')).toBe(false); // 月 13
    expect(isValidDate('2026-09-00')).toBe(false); // 日 0
    expect(isValidDate('2026-09-32')).toBe(false); // 日 32
  });

  it('rejects nonexistent calendar dates (round-trip check)', () => {
    expect(isValidDate('2026-02-30')).toBe(false); // 2 月没有 30 号
    expect(isValidDate('2026-04-31')).toBe(false); // 4 月没有 31 号
    expect(isValidDate('2025-02-29')).toBe(false); // 非闰年 2 月 29
  });
});

// =====================================================================
// isValidTime
// =====================================================================

describe('isValidTime', () => {
  it('accepts valid HH:MM (00:00-23:59)', () => {
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('09:00')).toBe(true);
    expect(isValidTime('20:30')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
  });

  it('rejects out-of-range hours / minutes', () => {
    expect(isValidTime('24:00')).toBe(false); // 小时 24
    expect(isValidTime('25:00')).toBe(false);
    expect(isValidTime('12:60')).toBe(false); // 分钟 60
    expect(isValidTime('12:99')).toBe(false);
  });

  it('rejects malformed strings', () => {
    expect(isValidTime('')).toBe(false);
    expect(isValidTime('9:00')).toBe(false); // 单位小时
    expect(isValidTime('20-30')).toBe(false);
    expect(isValidTime('2030')).toBe(false);
    expect(isValidTime('aa:bb')).toBe(false);
    expect(isValidTime(' 20:30')).toBe(false);
  });
});

// =====================================================================
// createInitialState
// =====================================================================

describe('createInitialState', () => {
  it('creates sensible defaults with given now', () => {
    const state = createInitialState(FIXED_NOW);
    expect(state.title).toBe('');
    expect(state.taskDate).toBe('2026-09-22');
    expect(state.taskTime).toBe('');
    expect(state.dateChip).toBe('today');
    expect(state.timeChip).toBe('none');
    expect(state.assigneeId).toBe(''); // 由 UI 在 mount 时填 creator
    expect(state.coExecutorSelected).toBe(false);
    expect(state.recurrence).toBe('none');
    expect(state.description).toBe('');
    expect(state.share).toBe('private');
  });

  it('taskDate uses local timezone, not UTC', () => {
    // 本地 9-22,但 UTC 可能是 9-21 或 9-22 — 不依赖 UTC
    const state = createInitialState(new Date(2026, 8, 22, 0, 30, 0)); // 本地 00:30
    expect(state.taskDate).toBe('2026-09-22');
  });
});

// =====================================================================
// resolveTaskDate / resolveTaskTime
// =====================================================================

describe('resolveTaskDate', () => {
  it('today chip returns now as YYYY-MM-DD', () => {
    expect(
      resolveTaskDate({ dateChip: 'today', taskDate: '' }, FIXED_NOW),
    ).toBe('2026-09-22');
  });

  it('tomorrow chip returns now + 1 day', () => {
    expect(
      resolveTaskDate({ dateChip: 'tomorrow', taskDate: '' }, FIXED_NOW),
    ).toBe('2026-09-23');
  });

  it('dayAfter chip returns now + 2 days', () => {
    expect(
      resolveTaskDate({ dateChip: 'dayAfter', taskDate: '' }, FIXED_NOW),
    ).toBe('2026-09-24');
  });

  it('custom chip returns trimmed form.taskDate', () => {
    expect(
      resolveTaskDate({ dateChip: 'custom', taskDate: '  2026-10-01  ' }, FIXED_NOW),
    ).toBe('2026-10-01');
  });

  it('custom chip with empty taskDate returns empty string', () => {
    expect(
      resolveTaskDate({ dateChip: 'custom', taskDate: '' }, FIXED_NOW),
    ).toBe('');
  });

  it('handles month boundary correctly', () => {
    const endOfMonth = new Date(2026, 8, 30, 10, 0, 0);
    expect(
      resolveTaskDate({ dateChip: 'tomorrow', taskDate: '' }, endOfMonth),
    ).toBe('2026-10-01');
  });
});

describe('resolveTaskTime', () => {
  it('none chip returns null (not specified)', () => {
    expect(resolveTaskTime({ timeChip: 'none', taskTime: 'whatever' })).toBeNull();
  });

  it('custom chip returns trimmed taskTime', () => {
    expect(resolveTaskTime({ timeChip: 'custom', taskTime: '  20:30  ' })).toBe('20:30');
  });

  it('custom chip with empty taskTime returns empty string', () => {
    expect(resolveTaskTime({ timeChip: 'custom', taskTime: '' })).toBe('');
  });

  it('am/pm chips return empty string (placeholder,本期不接受提交)', () => {
    expect(resolveTaskTime({ timeChip: 'am', taskTime: '' })).toBe('');
    expect(resolveTaskTime({ timeChip: 'pm', taskTime: '' })).toBe('');
  });
});

// =====================================================================
// validateForm
// =====================================================================

describe('validateForm', () => {
  it('returns null when all required fields are filled and valid', () => {
    const form = makeBaseForm({
      title: '喂奶粉',
      taskDate: '2026-09-22',
      dateChip: 'custom', // taskDate 是用户输入
      timeChip: 'custom',
      taskTime: '20:00',
    });
    expect(validateForm(form)).toBeNull();
  });

  it('returns "标题不能为空" when title is empty', () => {
    const form = makeBaseForm({ title: '' });
    expect(validateForm(form)).toBe(VALIDATION_MESSAGES.titleRequired);
  });

  it('returns "标题不能为空" when title is whitespace only', () => {
    const form = makeBaseForm({ title: '   ' });
    expect(validateForm(form)).toBe(VALIDATION_MESSAGES.titleRequired);
  });

  it('returns "日期不能为空" when date is empty (custom chip)', () => {
    const form = makeBaseForm({
      title: 't',
      dateChip: 'custom',
      taskDate: '',
    });
    expect(validateForm(form)).toBe(VALIDATION_MESSAGES.dateRequired);
  });

  it('returns "日期格式不对" when date format is wrong', () => {
    const form = makeBaseForm({
      title: 't',
      dateChip: 'custom',
      taskDate: '2026/09/22',
    });
    expect(validateForm(form)).toBe(VALIDATION_MESSAGES.dateFormat);
  });

  it('returns "日期格式不对" for nonexistent calendar date', () => {
    const form = makeBaseForm({
      title: 't',
      dateChip: 'custom',
      taskDate: '2026-02-30',
    });
    expect(validateForm(form)).toBe(VALIDATION_MESSAGES.dateFormat);
  });

  it('passes when timeChip=none (no time needed)', () => {
    const form = makeBaseForm({
      title: 't',
      timeChip: 'none',
      taskTime: '',
    });
    expect(validateForm(form)).toBeNull();
  });

  it('returns "时间格式不对" when custom time is malformed', () => {
    const form = makeBaseForm({
      title: 't',
      timeChip: 'custom',
      taskTime: '25:00',
    });
    expect(validateForm(form)).toBe(VALIDATION_MESSAGES.timeFormat);
  });

  it('passes when custom time is valid', () => {
    const form = makeBaseForm({
      title: 't',
      timeChip: 'custom',
      taskTime: '20:30',
    });
    expect(validateForm(form)).toBeNull();
  });

  it('passes when custom time is empty (silently falls back to none)', () => {
    const form = makeBaseForm({
      title: 't',
      timeChip: 'custom',
      taskTime: '',
    });
    expect(validateForm(form)).toBeNull();
  });

  it('returns "请选择指派人" when assigneeId is empty (defensive兜底)', () => {
    // UI 默认填 creator,理论上不到这;但 service 必须有非空 assigneeId
    // (review Major #1 附带修 Minor #3 文案对齐:原本误用 titleRequired)
    const form = makeBaseForm({
      title: 't',
      assigneeId: '',
    });
    expect(validateForm(form)).toBe(VALIDATION_MESSAGES.assigneeRequired);
  });

  it('rejects timeChip="am" with timeNotSupported (Major #1: 防 am/pm → 空串 → Postgres TIME 拒)', () => {
    const form = makeBaseForm({
      title: '喂奶粉',
      timeChip: 'am',
    });
    expect(validateForm(form)).toBe(VALIDATION_MESSAGES.timeNotSupported);
  });

  it('rejects timeChip="pm" with timeNotSupported (Major #1)', () => {
    const form = makeBaseForm({
      title: '喂奶粉',
      timeChip: 'pm',
    });
    expect(validateForm(form)).toBe(VALIDATION_MESSAGES.timeNotSupported);
  });

  it('passes when timeChip="none" (空串 resolve → null 路径)', () => {
    const form = makeBaseForm({
      title: '喂奶粉',
      timeChip: 'none',
      taskTime: '',
    });
    expect(validateForm(form)).toBeNull();
  });
});

// =====================================================================
// isRecurrenceSupported
// =====================================================================

describe('isRecurrenceSupported', () => {
  it('returns true only for none', () => {
    expect(isRecurrenceSupported('none')).toBe(true);
  });

  it('returns false for daily/weekly/monthly (本期未实现)', () => {
    expect(isRecurrenceSupported('daily')).toBe(false);
    expect(isRecurrenceSupported('weekly')).toBe(false);
    expect(isRecurrenceSupported('monthly')).toBe(false);
  });
});

// =====================================================================
// toCreateTaskInput
// =====================================================================

describe('toCreateTaskInput', () => {
  it('returns CreateTaskInput with shape matching service contract', () => {
    const form = makeBaseForm({
      title: '喂奶粉',
      taskDate: '2026-09-22',
      dateChip: 'custom',
      timeChip: 'custom',
      taskTime: '20:00',
      description: '7 勺奶粉,150ml 温水',
      share: 'sharedView',
    });
    const input = toCreateTaskInput(form);

    expect(input.title).toBe('喂奶粉');
    expect(input.taskDate).toBe('2026-09-22');
    expect(input.taskTime).toBe('20:00');
    expect(input.assigneeId).toBe(CREATOR_ID);
    expect(input.description).toBe('7 勺奶粉,150ml 温水');
    expect(input.isSharedView).toBe(true);
  });

  it('trims whitespace from title and description', () => {
    const form = makeBaseForm({
      title: '  喂奶粉  ',
      description: '  7 勺  ',
    });
    const input = toCreateTaskInput(form);
    expect(input.title).toBe('喂奶粉');
    expect(input.description).toBe('7 勺');
  });

  it('description becomes null when only whitespace', () => {
    const form = makeBaseForm({
      title: 't',
      description: '    ',
    });
    const input = toCreateTaskInput(form);
    expect(input.description).toBeNull();
  });

  it('description becomes null when empty', () => {
    const form = makeBaseForm({
      title: 't',
      description: '',
    });
    const input = toCreateTaskInput(form);
    expect(input.description).toBeNull();
  });

  it('share=private → isSharedView=false', () => {
    const form = makeBaseForm({ share: 'private' });
    expect(toCreateTaskInput(form).isSharedView).toBe(false);
  });

  it('share=sharedView → isSharedView=true', () => {
    const form = makeBaseForm({ share: 'sharedView' });
    expect(toCreateTaskInput(form).isSharedView).toBe(true);
  });

  it('timeChip=none → taskTime=null', () => {
    const form = makeBaseForm({ timeChip: 'none', taskTime: '' });
    expect(toCreateTaskInput(form).taskTime).toBeNull();
  });

  it('timeChip=custom → taskTime = trimmed form.taskTime', () => {
    const form = makeBaseForm({ timeChip: 'custom', taskTime: '  20:30  ' });
    expect(toCreateTaskInput(form).taskTime).toBe('20:30');
  });

  it('dateChip=today uses today as taskDate', () => {
    const form = makeBaseForm({ dateChip: 'today', taskDate: '' });
    expect(toCreateTaskInput(form, FIXED_NOW).taskDate).toBe('2026-09-22');
  });

  it('dateChip=custom uses form.taskDate as taskDate', () => {
    const form = makeBaseForm({
      dateChip: 'custom',
      taskDate: '2026-10-01',
    });
    expect(toCreateTaskInput(form, FIXED_NOW).taskDate).toBe('2026-10-01');
  });
});

// =====================================================================
// memberLabel
// =====================================================================

describe('memberLabel', () => {
  it('returns "我" when member is current user', () => {
    expect(memberLabel({ user_id: CREATOR_ID }, CREATOR_ID, CREATOR_ID)).toBe('我');
  });

  it('returns "配偶" when member is the other family member (2-person family)', () => {
    expect(memberLabel({ user_id: SPOUSE_ID }, CREATOR_ID, CREATOR_ID)).toBe('配偶');
  });
});

// =====================================================================
// Constants sanity(防漂移)
// =====================================================================

describe('option arrays', () => {
  it('DATE_CHIP_OPTIONS has 4 values including custom', () => {
    expect(DATE_CHIP_OPTIONS).toHaveLength(4);
    expect(DATE_CHIP_OPTIONS).toContain('custom');
  });

  it('TIME_CHIP_OPTIONS has 4 values including none', () => {
    expect(TIME_CHIP_OPTIONS).toHaveLength(4);
    expect(TIME_CHIP_OPTIONS).toContain('none');
  });

  it('RECURRENCE_OPTIONS has 4 values including none', () => {
    expect(RECURRENCE_OPTIONS).toHaveLength(4);
    expect(RECURRENCE_OPTIONS).toContain('none');
  });

  it('SHARE_OPTIONS has 2 values (simplified,三档留 T-US009)', () => {
    expect(SHARE_OPTIONS).toHaveLength(2);
  });

  it('VALIDATION_MESSAGES has all keys defined (no undefined values)', () => {
    expect(VALIDATION_MESSAGES.titleRequired).toBeTruthy();
    expect(VALIDATION_MESSAGES.dateRequired).toBeTruthy();
    expect(VALIDATION_MESSAGES.dateFormat).toBeTruthy();
    expect(VALIDATION_MESSAGES.timeFormat).toBeTruthy();
    expect(VALIDATION_MESSAGES.timeNotSupported).toBeTruthy(); // Major #1 新增
    expect(VALIDATION_MESSAGES.assigneeRequired).toBeTruthy(); // 附带修 Minor #3
    expect(VALIDATION_MESSAGES.recurrenceNotSupported).toBeTruthy();
    expect(VALIDATION_MESSAGES.coExecutorNotSupported).toBeTruthy();
  });
});

// =====================================================================
// T-US003-1 新增 — fromTask / toUpdateTaskInput / inferDateChip / inferTimeChip
// =====================================================================

/** 测试用 TaskRow 工厂 */
function makeTaskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'task-uuid-1111-1111-1111-111111111111',
    template_id: null,
    family_id: 'family-uuid-2222-2222-2222-222222222222',
    title: '喂奶粉',
    description: '7 勺奶粉,150ml 温水',
    task_date: '2026-09-22',
    task_time: '20:00',
    assignee_id: CREATOR_ID,
    co_executor_ids: [],
    is_shared_view: false,
    created_by: CREATOR_ID,
    completed_at: null,
    completed_by: null,
    is_makeup: false,
    cancelled: false,
    created_at: '2026-09-22T10:00:00Z',
    updated_at: '2026-09-22T10:00:00Z',
    ...overrides,
  };
}

const FAMILY_MEMBERS: FamilyMemberRow[] = [
  { family_id: 'family-uuid-2222-2222-2222-222222222222', user_id: CREATOR_ID, joined_at: '2026-09-01T00:00:00Z' },
  { family_id: 'family-uuid-2222-2222-2222-222222222222', user_id: SPOUSE_ID, joined_at: '2026-09-01T00:00:00Z' },
];

describe('inferDateChip (T-US003-1)', () => {
  it('returns "today" when taskDate === today', () => {
    expect(inferDateChip('2026-09-22', '2026-09-22')).toBe('today');
  });

  it('returns "tomorrow" when taskDate === today + 1 day', () => {
    expect(inferDateChip('2026-09-23', '2026-09-22')).toBe('tomorrow');
  });

  it('returns "dayAfter" when taskDate === today + 2 days', () => {
    expect(inferDateChip('2026-09-24', '2026-09-22')).toBe('dayAfter');
  });

  it('returns "custom" for past dates', () => {
    expect(inferDateChip('2026-09-20', '2026-09-22')).toBe('custom');
  });

  it('returns "custom" for dates > today + 2 days', () => {
    expect(inferDateChip('2026-10-01', '2026-09-22')).toBe('custom');
  });

  it('returns "custom" for null / undefined', () => {
    expect(inferDateChip(null, '2026-09-22')).toBe('custom');
    expect(inferDateChip(undefined, '2026-09-22')).toBe('custom');
  });

  it('handles month boundary correctly', () => {
    expect(inferDateChip('2026-10-01', '2026-09-30')).toBe('tomorrow');
    expect(inferDateChip('2026-10-02', '2026-09-30')).toBe('dayAfter');
  });
});

describe('inferTimeChip (T-US003-1)', () => {
  it('returns "none" for null', () => {
    expect(inferTimeChip(null)).toBe('none');
  });

  it('returns "none" for undefined', () => {
    expect(inferTimeChip(undefined)).toBe('none');
  });

  it('returns "none" for empty string', () => {
    expect(inferTimeChip('')).toBe('none');
  });

  it('returns "none" for malformed strings (defensive)', () => {
    expect(inferTimeChip('not a time')).toBe('none');
    expect(inferTimeChip('25:00')).toBe('none');
    expect(inferTimeChip('12345')).toBe('none');
  });

  it('returns "custom" for any valid HH:MM string (simplified version)', () => {
    // 简化版:任何合法时间字面量 → 'custom'(让用户看到 / 编辑原值)
    expect(inferTimeChip('09:00')).toBe('custom');
    expect(inferTimeChip('12:00')).toBe('custom');
    expect(inferTimeChip('20:30')).toBe('custom');
    expect(inferTimeChip('23:59')).toBe('custom');
  });

  it('returns "custom" for HH:MM:SS (DB sometimes returns with seconds)', () => {
    expect(inferTimeChip('20:00:00')).toBe('custom');
  });
});

describe('fromTask (T-US003-1)', () => {
  it('maps a full TaskRow to CreateTaskFormState', () => {
    const task = makeTaskRow({
      title: '倒垃圾',
      task_date: '2026-09-22',
      task_time: '20:00',
      description: '记得带钥匙',
      is_shared_view: true,
      assignee_id: SPOUSE_ID,
    });
    const state = fromTask(task, FAMILY_MEMBERS, CREATOR_ID, '2026-09-22');

    expect(state.title).toBe('倒垃圾');
    expect(state.taskDate).toBe('2026-09-22');
    expect(state.taskTime).toBe('20:00');
    expect(state.dateChip).toBe('today');
    expect(state.timeChip).toBe('custom');
    expect(state.assigneeId).toBe(SPOUSE_ID);
    expect(state.description).toBe('记得带钥匙');
    expect(state.share).toBe('sharedView');
    expect(state.recurrence).toBe('none');
    expect(state.coExecutorSelected).toBe(false);
  });

  it('null task_time → timeChip="none", taskTime=""', () => {
    const task = makeTaskRow({ task_time: null });
    const state = fromTask(task, FAMILY_MEMBERS, CREATOR_ID, '2026-09-22');
    expect(state.timeChip).toBe('none');
    expect(state.taskTime).toBe('');
  });

  it('null description → description=""', () => {
    const task = makeTaskRow({ description: null });
    const state = fromTask(task, FAMILY_MEMBERS, CREATOR_ID, '2026-09-22');
    expect(state.description).toBe('');
  });

  it('is_shared_view=true → share="sharedView"', () => {
    const task = makeTaskRow({ is_shared_view: true });
    const state = fromTask(task, FAMILY_MEMBERS, CREATOR_ID, '2026-09-22');
    expect(state.share).toBe('sharedView');
  });

  it('is_shared_view=false → share="private"', () => {
    const task = makeTaskRow({ is_shared_view: false });
    const state = fromTask(task, FAMILY_MEMBERS, CREATOR_ID, '2026-09-22');
    expect(state.share).toBe('private');
  });

  it('task_date === today + 1 day → dateChip="tomorrow"', () => {
    const task = makeTaskRow({ task_date: '2026-09-23' });
    const state = fromTask(task, FAMILY_MEMBERS, CREATOR_ID, '2026-09-22');
    expect(state.dateChip).toBe('tomorrow');
    expect(state.taskDate).toBe('2026-09-23');
  });

  it('task_date in past → dateChip="custom", taskDate preserved', () => {
    const task = makeTaskRow({ task_date: '2026-09-15' });
    const state = fromTask(task, FAMILY_MEMBERS, CREATOR_ID, '2026-09-22');
    expect(state.dateChip).toBe('custom');
    expect(state.taskDate).toBe('2026-09-15');
  });

  it('template_id !== null → recurrence="daily" (simplified: UI 看到非 none 会拦截)', () => {
    const task = makeTaskRow({ template_id: 'template-uuid-3333-3333-3333-333333333333' });
    const state = fromTask(task, FAMILY_MEMBERS, CREATOR_ID, '2026-09-22');
    expect(state.recurrence).toBe('daily');
  });

  it('template_id null → recurrence="none"', () => {
    const task = makeTaskRow({ template_id: null });
    const state = fromTask(task, FAMILY_MEMBERS, CREATOR_ID, '2026-09-22');
    expect(state.recurrence).toBe('none');
  });
});

describe('toUpdateTaskInput (T-US003-1)', () => {
  it('returns UpdateTaskInput with shape matching service contract', () => {
    const form = makeBaseForm({
      title: '喂奶粉',
      taskDate: '2026-09-22',
      dateChip: 'custom',
      timeChip: 'custom',
      taskTime: '20:00',
      description: '7 勺奶粉',
      share: 'sharedView',
    });
    const input = toUpdateTaskInput(form, CREATOR_ID, FIXED_NOW);

    expect(input.title).toBe('喂奶粉');
    expect(input.taskDate).toBe('2026-09-22');
    expect(input.taskTime).toBe('20:00');
    expect(input.assigneeId).toBe(CREATOR_ID);
    expect(input.description).toBe('7 勺奶粉');
    expect(input.isSharedView).toBe(true);
  });

  it('timeChip=none → taskTime=null (preserves "no time" intent)', () => {
    const form = makeBaseForm({ timeChip: 'none', taskTime: '' });
    const input = toUpdateTaskInput(form, CREATOR_ID, FIXED_NOW);
    expect(input.taskTime).toBeNull();
  });

  it('timeChip=custom, taskTime="20:30" → taskTime="20:30"', () => {
    const form = makeBaseForm({ timeChip: 'custom', taskTime: '20:30' });
    const input = toUpdateTaskInput(form, CREATOR_ID, FIXED_NOW);
    expect(input.taskTime).toBe('20:30');
  });

  it('dateChip=custom → taskDate comes from form.taskDate', () => {
    const form = makeBaseForm({
      dateChip: 'custom',
      taskDate: '2026-10-15',
    });
    const input = toUpdateTaskInput(form, CREATOR_ID, FIXED_NOW);
    expect(input.taskDate).toBe('2026-10-15');
  });

  it('recurrence="daily" still translates (UI 拦截;本函数不做校验)', () => {
    const form = makeBaseForm({ title: '喂奶粉', recurrence: 'daily' });
    const input = toUpdateTaskInput(form, CREATOR_ID, FIXED_NOW);
    // recurrence 不在 UpdateTaskInput 字段里(本期不支持),但函数仍应成功返回
    expect(input.title).toBe('喂奶粉');
  });

  it('description with whitespace trims and becomes null when empty', () => {
    const form = makeBaseForm({ title: 't', description: '   ' });
    const input = toUpdateTaskInput(form, CREATOR_ID, FIXED_NOW);
    expect(input.description).toBeNull();
  });

  it('share=private → isSharedView=false', () => {
    const form = makeBaseForm({ share: 'private' });
    const input = toUpdateTaskInput(form, CREATOR_ID, FIXED_NOW);
    expect(input.isSharedView).toBe(false);
  });

  it('does not include template_id / family_id / created_by (UpdateTaskInput 不需要)', () => {
    const form = makeBaseForm();
    const input = toUpdateTaskInput(form, CREATOR_ID, FIXED_NOW) as unknown as Record<string, unknown>;
    expect(input.template_id).toBeUndefined();
    expect(input.family_id).toBeUndefined();
    expect(input.created_by).toBeUndefined();
  });
});