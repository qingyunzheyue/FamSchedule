/**
 * createTaskForm — 创建任务表单的纯逻辑层 — T-US001-1
 *
 * 职责(单一职责:CreateTaskScreen 的纯函数 + 状态机,无 RN / Tamagui 依赖):
 *   1. 字段格式校验:date / time 正则 + 范围校验
 *   2. 表单整体校验:validateForm(state) → string | null(返回首个错误文案 / null)
 *   3. dateChip / timeChip 状态机 chipOptions + chipValue
 *   4. recurrence dropdown 选项 + 周期分支判定(本期 selected=非默认 → 拒绝提交)
 *   5. share scope 选项 + 翻译(本期二档;三档留 T-US009)
 *
 * 设计动机(jest 可测):
 *   - 跟 codeInput.ts (T-US012-3) / inviteCountdown.ts (T-US012-2) 同一套模式:
 *     jest-expo preset 下 Tamagui 报 ESM 错(`transformIgnorePatterns` 不含 tamagui,
 *     完整渲染需改 jest config,超出本任务 scope)。
 *   - 把纯逻辑下沉到本模块,UI 层只 render 本模块导出值 + 副作用(setState / Toast)。
 *   - 这样 jest 单测覆盖范围 = 校验 + 状态机;视觉层留给 ui-ux / 手动 / EAS 真机。
 *
 * 国际化准备:
 *   - 所有中文文案集中为 const 对象(`VALIDATION_MESSAGES` / `RECURRENCE_OPTIONS` /
 *     `SHARE_OPTIONS`),未来 i18n 抽到 react-i18next。
 *   - 当前硬编码中文与 pair-create / pair-join 文案风格一致(暖色家庭感)。
 */

import type { CreateTaskInput } from '../services/TaskService';

// =====================================================================
// 1. 常量:文案 + 选项
// =====================================================================

/** 表单校验失败文案(设计 task-create-v1.0 §6 + 任务 brief §B 错误文案)。 */
export const VALIDATION_MESSAGES = {
  titleRequired: '标题不能为空',
  dateRequired: '日期不能为空',
  dateFormat: '日期格式不对',
  timeFormat: '时间格式不对',
  recurrenceNotSupported: '周期任务即将推出,敬请期待',
  coExecutorNotSupported: '共同执行人即将推出',
} as const;

/**
 * 4 选 1 date chip 选项。'custom' 走 TextInput YYYY-MM-DD;
 * 其它 3 个由 reducer 直接产出 ISO 日期字面量。
 */
export const DATE_CHIP_OPTIONS = ['today', 'tomorrow', 'dayAfter', 'custom'] as const;
export type DateChipValue = (typeof DATE_CHIP_OPTIONS)[number];

/**
 * 4 选 1 time chip 选项。'none' = 不指定(存 null);
 * 'am' / 'pm' 简化版占位(本任务暂不展开二级 picker);'custom' 走 HH:MM 输入。
 */
export const TIME_CHIP_OPTIONS = ['none', 'am', 'pm', 'custom'] as const;
export type TimeChipValue = (typeof TIME_CHIP_OPTIONS)[number];

/** recurrence 下拉选项(4 档)— 选 daily/weekly/monthly 时本期 toast + 拒提交。 */
export const RECURRENCE_OPTIONS = ['none', 'daily', 'weekly', 'monthly'] as const;
export type RecurrenceValue = (typeof RECURRENCE_OPTIONS)[number];

/** 共享二档(本期简化)— 完整三档留 T-US009。 */
export const SHARE_OPTIONS = ['private', 'sharedView'] as const;
export type ShareValue = (typeof SHARE_OPTIONS)[number];

// =====================================================================
// 2. 正则 + 格式校验
// =====================================================================

/**
 * YYYY-MM-DD 严格匹配 + 范围合法(月份 01-12,日期基于月份校验)。
 *
 * - regex:4 位年 + `-` + 2 位月 + `-` + 2 位日
 * - 月份必须 01-12,日期必须 1-31(月份天数交由 Date 校验:02-31 等假日期会失效)
 *
 * 注意:用 `Date` 反推校验"日期是否存在"(e.g. 2026-02-30)。Date.parse 接受后
 * 会 round-trip 到原值(Date.toISOString().slice(0,10) === 原值 → 真日期)。
 */
export function isValidDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map((s) => parseInt(s, 10));
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  // 假日期 round-trip 校验:2026-02-30 → Date 会推到 3-2,toISOString 不一致
  const parsed = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === dateStr;
}

/**
 * HH:MM 严格匹配 + 范围合法(00:00-23:59)。
 *
 * - regex:2 位小时 + `:` + 2 位分钟
 * - 小时 00-23,分钟 00-59
 *
 * 注:DB TIME 类型是 `HH:MM:SS`,但 client 端用 `HH:MM` 简化(秒默认 00)。
 * Postgres 接受 `HH:MM` 自动补 `:00`(TIME coercion 行为)。
 */
export function isValidTime(timeStr: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(timeStr)) return false;
  const [h, m] = timeStr.split(':').map((s) => parseInt(s, 10));
  if (h < 0 || h > 23) return false;
  if (m < 0 || m > 59) return false;
  return true;
}

// =====================================================================
// 3. 表单 state shape + 默认值
// =====================================================================

/**
 * 表单整体 state 形状。CreateTaskScreen 用 useState 持有,
 * setter 由 UI 层从本模块暴露的 helper 调用(便于 jest 直接构造)。
 */
export interface CreateTaskFormState {
  title: string;
  /** 'YYYY-MM-DD' | '';chip=custom 时由用户在 TextInput 输入 */
  taskDate: string;
  /** 'HH:MM' | '';chip=custom 时由用户在 TextInput 输入;chip=none 时也保持 '' */
  taskTime: string;
  dateChip: DateChipValue;
  timeChip: TimeChipValue;
  /** user.id(UUID string);'' = 未选(防 undefined 简化) */
  assigneeId: string;
  /** 本期固定 false(coExecutorIds 待 US-009) */
  coExecutorSelected: boolean;
  recurrence: RecurrenceValue;
  description: string;
  share: ShareValue;
}

/**
 * 创建表单默认 state。taskDate 用"今天"(本地时区);其它字段空 / 默认值。
 *
 * 注意:CreateTaskScreen mount 时调 createInitialState(now) 拿默认值;
 * now 由 UI 注入(便于 jest 测试固定日期,避免 Date.now() 漂移)。
 */
export function createInitialState(now: Date = new Date()): CreateTaskFormState {
  const todayIso = toLocalIsoDate(now);
  return {
    title: '',
    taskDate: todayIso,
    taskTime: '',
    dateChip: 'today',
    timeChip: 'none',
    assigneeId: '', // 由 UI mount 时从 useFamilyValue().members 选 creator 填充
    coExecutorSelected: false,
    recurrence: 'none',
    description: '',
    share: 'private',
  };
}

// =====================================================================
// 4. Chip / Dropdown 派生
// =====================================================================

/**
 * 给定 today + chip 值,导出最终的 taskDate 字符串。
 *
 * - 'today' / 'tomorrow' / 'dayAfter':基于 now 偏移,产出 ISO 字符串
 * - 'custom':返回 formState.taskDate(由 TextInput 提供)
 *
 * 边界:若 formState.taskDate 为 '' 或非 YYYY-MM-DD 格式 → 返回 ''
 * (后续 validateForm 会拦截)。
 */
export function resolveTaskDate(
  formState: Pick<CreateTaskFormState, 'dateChip' | 'taskDate'>,
  now: Date = new Date(),
): string {
  switch (formState.dateChip) {
    case 'today':
      return toLocalIsoDate(now);
    case 'tomorrow':
      return toLocalIsoDate(addDays(now, 1));
    case 'dayAfter':
      return toLocalIsoDate(addDays(now, 2));
    case 'custom':
      return formState.taskDate.trim();
    default:
      return '';
  }
}

/**
 * 给定 chip 值,导出最终的 taskTime:
 *   - 'none':null(给后端写 NULL = 不指定时间)
 *   - 'am' / 'pm':占位(本期 toast + 不提交,但 UI 渲染给用户看;resolve 时返回 '')
 *   - 'custom':返回 formState.taskTime.trim()(格式校验交给 validateForm)
 */
export function resolveTaskTime(
  formState: Pick<CreateTaskFormState, 'timeChip' | 'taskTime'>,
): string | null {
  switch (formState.timeChip) {
    case 'none':
      return null;
    case 'custom':
      return formState.taskTime.trim();
    case 'am':
    case 'pm':
      // 本期未实现 am/pm 详细时间映射;UI 选中时直接走 reject,resolve 不产出有效值
      return '';
    default:
      return null;
  }
}

// =====================================================================
// 5. validateForm — 整体表单校验
// =====================================================================

/**
 * 表单整体校验。返回首个错误文案,或 null 表示通过。
 *
 * 顺序(从上到下短路):
 *   1. 标题非空
 *   2. 日期非空 + YYYY-MM-DD 格式
 *   3. 时间:若 chip=custom → HH:MM 格式
 *
 * ⚠️ 周期:不在这里拒绝 — 周期由 doSubmit 单独 toast(用户主动选了非 none)
 *    时直接不调 TaskService,而不是 validateForm false。
 *    理由:周期 chip 是合法 UI 选项,只是后端不支持;validation 应报告"必填漏填",
 *    "业务暂不支持"交给 submit 阶段。
 *
 * ⚠️ assigneeId / description / share 校验:
 *    - assigneeId 必填 — 但实际 UI 默认填 creator,不会空,这里兜底
 *    - description 无校验(可选)
 *    - share 无校验(默认 'private',无非法值)
 */
export function validateForm(form: CreateTaskFormState): string | null {
  if (form.title.trim().length === 0) {
    return VALIDATION_MESSAGES.titleRequired;
  }

  const resolvedDate = resolveTaskDate(form);
  if (resolvedDate.length === 0) {
    return VALIDATION_MESSAGES.dateRequired;
  }
  if (!isValidDate(resolvedDate)) {
    return VALIDATION_MESSAGES.dateFormat;
  }

  if (form.timeChip === 'custom') {
    const time = form.taskTime.trim();
    if (time.length > 0 && !isValidTime(time)) {
      return VALIDATION_MESSAGES.timeFormat;
    }
    // custom chip 但 time 为空 → 等同"不指定"(静默 fall back to null)
  }

  if (form.assigneeId.trim().length === 0) {
    // 兜底:UI 默认填 creator,理论上不到这
    return VALIDATION_MESSAGES.titleRequired; // 复用"必填"文案,避免再加一条
  }

  return null;
}

/**
 * 周期是否在本期被支持(只有 'none' 支持)。
 *
 * 返回 true = 允许提交,false = 应 toast 并拒绝提交。
 */
export function isRecurrenceSupported(recurrence: RecurrenceValue): boolean {
  return recurrence === 'none';
}

// =====================================================================
// 6. 转译为 CreateTaskInput
// =====================================================================

/**
 * 把表单 state + resolve 结果打包成 TaskService.createTask 期望的 input shape。
 *
 * 边界:
 *   - share === 'sharedView' → isSharedView = true;否则 false
 *   - taskTime = resolveTaskTime(可能为 null)
 *   - description = form.description.trim()(避免空白串;空白 → null)
 *
 * 可选 `now` 参数:resolveTaskDate 在 chip=today / tomorrow / dayAfter 时用 now
 * 派生实际日期。给一个 now 注入便于 jest 单测固定日期,避免 Date.now() 漂移。
 *
 * 注意:本函数**不**做提交校验 — 调用方需先 validateForm + isRecurrenceSupported
 * 通过后再 toCreateTaskInput,否则会被 service / 后端拒绝。
 */
export function toCreateTaskInput(
  form: CreateTaskFormState,
  now: Date = new Date(),
): CreateTaskInput {
  const isSharedView = form.share === 'sharedView';
  const taskTime = resolveTaskTime(form);
  const description = form.description.trim().length > 0 ? form.description.trim() : null;

  return {
    title: form.title.trim(),
    taskDate: resolveTaskDate(form, now),
    taskTime,
    assigneeId: form.assigneeId,
    description,
    isSharedView,
  };
}

// =====================================================================
// 7. 共享 Label helper(UI 渲染指派人 chips 用)
// =====================================================================

/**
 * 给定 family member row + 当前 user.id,导出"我"或"配偶"中文标签。
 *
 * 简化:第一档('我')是创建者(user.id === family.created_by),
 * 第二档('配偶')是其他 member。多人家庭的"配偶"会被简化成"家人"—
 * 这与本期 2 人家庭假设对齐(任务 brief §B 指派人 chips:我/配偶 2 chip)。
 *
 * 留 T-US009 后续扩展多人家庭场景。
 */
export function memberLabel(
  member: { user_id: string },
  currentUserId: string,
  familyCreatedBy: string,
): '我' | '配偶' {
  if (member.user_id === currentUserId) return '我';
  // 简化:家庭创建者 = 我,其他 = 配偶(2 人家庭场景)
  if (member.user_id === familyCreatedBy) return '我';
  return '配偶';
}

// =====================================================================
// 内部 helpers
// =====================================================================

/**
 * Date → 'YYYY-MM-DD' (本地时区)。
 *
 * 用本地时区而非 UTC,理由:用户在中国,日期 9 月 22 日;若用 UTC 可能在 0-8 点
 * 返回前一天(UTC 仍 9-21),与用户认知不符。task_date 是 date(无时区),
 * 业务上等价于"用户当地的日期"。
 */
export function toLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Date + n 天 → 新 Date(不修改原对象)。 */
export function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}