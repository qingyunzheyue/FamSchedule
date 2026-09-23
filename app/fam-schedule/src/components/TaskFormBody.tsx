/**
 * TaskFormBody — Create + Edit 共用的表单 body — T-US003-1
 *
 * 职责:
 *   - 抽离 CreateTaskScreen 的表单 fields + 校验红字 + 保存按钮 + submitting 状态
 *   - 提交逻辑(rotation vs create)由调用方负责,本组件只暴露 onSubmit callback
 *
 * 设计动机:
 *   - US-003 任务 brief §C.1 明确要求 EditTaskScreen 复用 CreateTaskScreen 的 90%
 *     表单 UI。把表单 fields / 校验红字 / ChipGroup / TextInput 抽成共享组件,
 *     CreateTaskScreen 和 EditTaskScreen 只在外面包一层(initialState + onSubmit
 *     注入,Header 文案 / Cancel 行为不同所以 Header 不抽)。
 *   - 这样 jest 单测可以共享同一份 visual regression(未来 T-FIX-06 hygiene),
 *     改一处两边生效。
 *
 * 简化决策:
 *   - 不抽 Header(每个 screen 自己渲)— Header 文案 / Cancel 行为不同
 *     (create → back,edit → back)
 *   - 不抽 SubmittedScreen 成功页(同 Header)— 不同文案
 *   - 把 FormField / ChipButton / ChipGroup 子组件留在本文件,因为没有复用需求
 *   - **不**保留 `mode` prop(T-US003-1 review fix):create / edit 两路行为无差异,
 *     父组件 onSubmit 已经分别调 createTask / updateTask;mode 只是日志里一个标签
 *
 * a11y:
 *   - 必填项 accessibilityHint="必填"
 *   - DateChip / TimeChip accessibilityRole="button"
 *   - 指派人 chips accessibilityRole="radio"
 *   - 保存按钮(T-US003-1 review fix 新增)disabled 时 accessibilityState={{disabled: true}}
 *     + accessibilityLabel = submitDisabledHint || submitLabel
 *
 * 测试策略:
 *   - 同 CreateTaskScreen.test.tsx — **不**渲染组件本身(jest-expo + Tamagui 限制)
 *   - 视觉层由 ui-ux / 手动 / EAS 真机验证
 *   - 行为契约(默认值)由 onSubmit 集成测试覆盖(EditTaskScreen /
 *     CreateTaskScreen 自己测)
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Button, Text, XStack, YStack } from 'tamagui';
import { WarningCircle } from 'phosphor-react-native';

import { useFamilyValue } from '../contexts/FamilyContext';
import {
  createInitialState,
  isRecurrenceSupported,
  memberLabel,
  toCreateTaskInput,
  toUpdateTaskInput,
  validateForm,
  VALIDATION_MESSAGES,
  DATE_CHIP_OPTIONS,
  RECURRENCE_OPTIONS,
  SHARE_OPTIONS,
  TIME_CHIP_OPTIONS,
  type CreateTaskFormState,
  type DateChipValue,
  type RecurrenceValue,
  type ShareValue,
  type TimeChipValue,
} from '../lib/createTaskForm';

// =====================================================================
// Public types
// =====================================================================

/**
 * `onSubmit` 返回的 discriminated union — UI 层负责错误翻译 + Alert。
 *
 * - {ok: true}                            成功 — 调用方负责后续 navigation
 * - {ok: false, reason?: string}          失败 — reason 已本地化,直接 Alert
 */
export type TaskFormSubmitResult =
  | { ok: true }
  | { ok: false; reason?: string };

export interface TaskFormBodyProps {
  /** 父组件构造的初始 state(必填 — 调用方负责 fromTask / createInitialState)。 */
  initialState: CreateTaskFormState;
  /** 父组件负责调 service(createTask / updateTask)并返回结构化结果。 */
  onSubmit: (
    form: CreateTaskFormState,
    currentUserId: string,
  ) => Promise<TaskFormSubmitResult>;
  /** 父组件拿到的 currentUserId(用于 toCreateTaskInput / toUpdateTaskInput)。 */
  currentUserId: string;
  /** 用户按 Cancel / 物理返回 — 父组件决定路由动作(默认 router.back)。 */
  onCancel: () => void;
  /** 保存按钮 label(创建:保存 / 编辑:保存 / 模板任务:暂不支持编辑)。 */
  submitLabel: string;
  /** 保存按钮 disabled 时显示的提示(例如"请先填写必填项")。 */
  submitDisabledHint?: string;
  /** 测试用 — 把所有 form 设为 disabled,如 submitting / template-locked。 */
  forceDisabled?: boolean;
}

// =====================================================================
// Constants — UI 文案(集中常量,便于国际化)
// =====================================================================

const FIELD_TITLE_LABEL = '任务标题';
const FIELD_DATE_LABEL = '日期';
const FIELD_TIME_LABEL = '时间';
const FIELD_ASSIGNEE_LABEL = '指派人';
const FIELD_CO_EXECUTOR_LABEL = '共同执行人';
const FIELD_RECURRENCE_LABEL = '周期';
const FIELD_DESCRIPTION_LABEL = '备注';
const FIELD_SHARE_LABEL = '共享';

const FIELD_TITLE_PLACEHOLDER = '喂奶粉 / 倒垃圾 / 续交保险单';
const FIELD_DESCRIPTION_PLACEHOLDER = '给任务加点提醒...';
const ASSIGNEE_EMPTY = '未选择';

const DATE_CHIP_LABELS: Readonly<Record<DateChipValue, string>> = {
  today: '今天',
  tomorrow: '明天',
  dayAfter: '后天',
  custom: '自定义',
};
const TIME_CHIP_LABELS: Readonly<Record<TimeChipValue, string>> = {
  none: '不指定',
  am: '上午',
  pm: '晚上',
  custom: '自定义',
};
const RECURRENCE_LABELS: Readonly<Record<RecurrenceValue, string>> = {
  none: '不重复',
  daily: '每日',
  weekly: '每周',
  monthly: '每月',
};
const SHARE_LABELS: Readonly<Record<ShareValue, string>> = {
  private: '私有(仅我可见)',
  sharedView: '共享给配偶查看',
};

/** recurrence 当前周期非 none 时,保存按钮额外提示。 */
const RECURRENCE_BLOCKED_HINT = '周期即将推出';

// =====================================================================
// 颜色常量(设计赤陶 + 亚麻,与 home tab / pair-create 对齐)
// =====================================================================

const COLOR_PRIMARY = '#DC5A24'; // 赤陶:选中 / 主按钮
const COLOR_BORDER = '#E8DFD0'; // 亚麻:默认描边
const COLOR_CHIP_BG = '#FFF9F0'; // 浅亚麻:chip 默认背景
const COLOR_BG_FOOTER = '#F4ECDC'; // sticky bottom 背景(与 screen bg 一致)
const COLOR_TEXT_PRIMARY = '#3A2E20';
const COLOR_TEXT_SECONDARY = '#7A6B57';
const COLOR_ERROR = '#C95444';

// =====================================================================
// Component
// =====================================================================

/**
 * TaskFormBody — 共享 form body。
 *
 * 行为:
 *   - mount 时用 `initialState` 初始化(父组件负责注入默认值 / 预填)
 *   - submit 时调 onSubmit(form, currentUserId) → 拿结构化结果 → 成功:留给父
 *     组件做 navigation;失败:Alert + 恢复 input phase
 *   - 周期非 none → toast + 拒绝提交 + 保存按钮 disabled
 *   - 校验失败 → 字段红字 + 拒绝提交
 *   - forceDisabled 时整个 form disabled(用于模板任务"暂不支持编辑")
 *   - **保存按钮**(T-US003-1 review fix Blocker #1):放在 ScrollView 之外,form 末尾下方,
 *     sticky bottom 视觉;disabled 时显示 submitDisabledHint 提示,a11y 完整
 */
export function TaskFormBody({
  initialState,
  onSubmit,
  currentUserId,
  onCancel: _onCancel,
  submitLabel,
  submitDisabledHint,
  forceDisabled = false,
}: TaskFormBodyProps): React.JSX.Element {
  const [form, setForm] = useState<CreateTaskFormState>(initialState);
  const [phase, setPhase] = useState<'input' | 'submitting'>('input');
  const [validationError, setValidationError] = useState<string | null>(null);

  // 若父组件 initialState 异步变化(例如 EditTaskScreen 等 fetch 完成),同步一次
  // 这是 CreateTaskScreen 原有的 useEffect 防御;T-US003-1 保留同款行为。
  // 注:本任务简化 — EditTaskScreen 在 fetch 完前不渲染 form,这里 default 不触发。
  useEffect(() => {
    setForm(initialState);
  }, [initialState]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (phase !== 'input' || forceDisabled) return;

    // 1. 周期 unsupported → toast + 拒绝提交
    if (!isRecurrenceSupported(form.recurrence)) {
      Alert.alert('周期任务即将推出', '周期任务正在准备中,本次不提交');
      return;
    }

    // 2. validateForm → 失败时显示字段红字 + 不提交
    const vErr = validateForm(form);
    if (vErr) {
      setValidationError(vErr);
      return;
    }
    setValidationError(null);

    // 3. 调 onSubmit(由父组件负责 createTask / updateTask)
    setPhase('submitting');
    let result: TaskFormSubmitResult;
    try {
      result = await onSubmit(form, currentUserId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[TaskFormBody] onSubmit threw:', err);
      Alert.alert('保存失败', '请重试');
      setPhase('input');
      return;
    }

    if (result.ok) {
      // 成功 — 留父组件处理 navigation(EditTaskScreen back / CreateTaskScreen submitted phase)
      return;
    }

    // failed → reason 已本地化,直接显示
    Alert.alert('保存失败', result.reason ?? '请重试');
    setPhase('input');
  }, [form, phase, forceDisabled, onSubmit, currentUserId]);

  const isSubmitting = phase === 'submitting';
  const isFormValid = validateForm(form) === null;
  const isRecurrenceBlocked = !isRecurrenceSupported(form.recurrence);
  const saveDisabled =
    isSubmitting || !isFormValid || isRecurrenceBlocked || forceDisabled;

  const saveLabel = isSubmitting
    ? '保存中…'
    : saveDisabled
    ? `${submitDisabledHint ?? '请先填写必填项'}${
        isRecurrenceBlocked ? ` (${RECURRENCE_BLOCKED_HINT})` : ''
      }`
    : submitLabel;

  const dateChipValueLabel =
    DATE_CHIP_LABELS[form.dateChip] +
    (form.dateChip === 'custom' && form.taskDate ? ` · ${form.taskDate}` : '');
  const timeChipValueLabel =
    TIME_CHIP_LABELS[form.timeChip] +
    (form.timeChip === 'custom' && form.taskTime ? ` · ${form.taskTime}` : '');

  return (
    <YStack flex={1}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* 任务标题(必填) */}
        <FormField label={FIELD_TITLE_LABEL} required>
          <TextInput
            value={form.title}
            onChangeText={(text) => {
              setForm((f) => ({ ...f, title: text }));
              if (validationError) setValidationError(null);
            }}
            placeholder={FIELD_TITLE_PLACEHOLDER}
            editable={!isSubmitting && !forceDisabled}
            style={[
              styles.textInput,
              validationError === VALIDATION_MESSAGES.titleRequired
                ? styles.textInputError
                : null,
            ]}
            accessibilityLabel={FIELD_TITLE_LABEL}
            accessibilityHint="必填"
            testID="input-title"
          />
        </FormField>

        {/* 日期(必填)— chip + 自定义 TextInput */}
        <FormField label={FIELD_DATE_LABEL} required>
          <ChipGroup<DateChipValue>
            values={DATE_CHIP_OPTIONS.map((v) => ({
              value: v,
              label: DATE_CHIP_LABELS[v],
            }))}
            selected={form.dateChip}
            onSelect={(v) => setForm((f) => ({ ...f, dateChip: v }))}
            disabled={isSubmitting || forceDisabled}
            accessibilityLabel={`${FIELD_DATE_LABEL}:${dateChipValueLabel},点击切换`}
          />
          {form.dateChip === 'custom' ? (
            <TextInput
              value={form.taskDate}
              onChangeText={(text) => {
                setForm((f) => ({ ...f, taskDate: text }));
                if (validationError) setValidationError(null);
              }}
              placeholder="YYYY-MM-DD"
              editable={!isSubmitting && !forceDisabled}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              style={[
                styles.textInput,
                styles.textInputSpaced,
                validationError === VALIDATION_MESSAGES.dateFormat ||
                validationError === VALIDATION_MESSAGES.dateRequired
                  ? styles.textInputError
                  : null,
              ]}
              accessibilityLabel={`${FIELD_DATE_LABEL}:自定义输入`}
              accessibilityHint="必填"
              testID="input-date"
            />
          ) : null}
        </FormField>

        {/* 时间(可选)— chip + 自定义 TextInput */}
        <FormField label={FIELD_TIME_LABEL}>
          <ChipGroup<TimeChipValue>
            values={TIME_CHIP_OPTIONS.map((v) => ({
              value: v,
              label: TIME_CHIP_LABELS[v],
            }))}
            selected={form.timeChip}
            onSelect={(v) => setForm((f) => ({ ...f, timeChip: v }))}
            disabled={isSubmitting || forceDisabled}
            accessibilityLabel={`${FIELD_TIME_LABEL}:${timeChipValueLabel},点击切换`}
          />
          {form.timeChip === 'custom' ? (
            <TextInput
              value={form.taskTime}
              onChangeText={(text) => {
                setForm((f) => ({ ...f, taskTime: text }));
                if (validationError) setValidationError(null);
              }}
              placeholder="HH:MM"
              editable={!isSubmitting && !forceDisabled}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              style={[
                styles.textInput,
                styles.textInputSpaced,
                validationError === VALIDATION_MESSAGES.timeFormat
                  ? styles.textInputError
                  : null,
              ]}
              accessibilityLabel={`${FIELD_TIME_LABEL}:自定义输入`}
              testID="input-time"
            />
          ) : null}
        </FormField>

        {/* 指派人(必填)— chip 单选 */}
        <FormField label={FIELD_ASSIGNEE_LABEL} required>
          <XStack gap="$sm" flexWrap="wrap">
            <AssigneeChips
              form={form}
              setForm={setForm}
              disabled={isSubmitting || forceDisabled}
            />
          </XStack>
        </FormField>

        {/* 共同执行人 — 占位(留 T-US009) */}
        <FormField label={FIELD_CO_EXECUTOR_LABEL}>
          <Button
            variant="outlined"
            disabled={isSubmitting || forceDisabled}
            onPress={() =>
              Alert.alert(
                '即将推出',
                '共同执行人功能正在准备中,敬请期待',
              )
            }
            testID="co-executor-placeholder"
          >
            <Text>+ 添加共同执行人</Text>
          </Button>
        </FormField>

        {/* 周期 — 4 档 dropdown(本期非 none 拒绝提交) */}
        <FormField label={FIELD_RECURRENCE_LABEL}>
          <XStack gap="$sm" flexWrap="wrap">
            {RECURRENCE_OPTIONS.map((v) => {
              const selected = form.recurrence === v;
              return (
                <ChipButton
                  key={v}
                  label={RECURRENCE_LABELS[v]}
                  selected={selected}
                  disabled={isSubmitting || forceDisabled}
                  onPress={() => setForm((f) => ({ ...f, recurrence: v }))}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${FIELD_RECURRENCE_LABEL}:${RECURRENCE_LABELS[v]}${selected ? ',已选中' : ''}`}
                  testID={`recurrence-${v}`}
                />
              );
            })}
          </XStack>
          {isRecurrenceBlocked ? (
            <Text
              fontSize="$meta"
              color={COLOR_ERROR}
              marginTop="$xs"
              accessibilityRole="text"
              testID="recurrence-blocked-hint"
            >
              {RECURRENCE_BLOCKED_HINT}
            </Text>
          ) : null}
        </FormField>

        {/* 备注(可选)— 多行输入 */}
        <FormField label={FIELD_DESCRIPTION_LABEL}>
          <TextInput
            value={form.description}
            onChangeText={(text) => setForm((f) => ({ ...f, description: text }))}
            placeholder={FIELD_DESCRIPTION_PLACEHOLDER}
            editable={!isSubmitting && !forceDisabled}
            multiline
            numberOfLines={3}
            style={[styles.textInput, styles.textInputMulti]}
            accessibilityLabel={FIELD_DESCRIPTION_LABEL}
            testID="input-description"
          />
        </FormField>

        {/* 共享 — 二档 chip 单选 */}
        <FormField label={FIELD_SHARE_LABEL}>
          <XStack gap="$sm" flexWrap="wrap">
            {SHARE_OPTIONS.map((v) => {
              const selected = form.share === v;
              return (
                <ChipButton
                  key={v}
                  label={SHARE_LABELS[v]}
                  selected={selected}
                  disabled={isSubmitting || forceDisabled}
                  onPress={() => setForm((f) => ({ ...f, share: v }))}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${FIELD_SHARE_LABEL}:${SHARE_LABELS[v]}${selected ? ',已选中' : ''}`}
                  testID={`share-${v}`}
                />
              );
            })}
          </XStack>
        </FormField>

        {/* 校验错误提示 */}
        {validationError ? (
          <XStack
            gap="$xs"
            alignItems="center"
            marginTop="$md"
            accessibilityRole="alert"
            testID="validation-error"
          >
            <WarningCircle size={20} color={COLOR_ERROR} weight="fill" />
            <Text fontSize="$body" color={COLOR_ERROR}>
              {validationError}
            </Text>
          </XStack>
        ) : null}
      </ScrollView>

      {/* 保存按钮(T-US003-1 review fix Blocker #1) — sticky bottom
          之前整个 feature 没有触发 save 的 onPress,header 的"保存"是空白 Text placeholder,
          用户填完表单无任何方式提交。本组件内的 <Button onPress={handleSave}> 是单一权威入口。
          a11y:accessibilityRole="button" + accessibilityState.disabled + accessibilityLabel 跟
          saveLabel 同步;busy 用 isSubmitting 表达,不引 a11y 未知 prop。 */}
      <XStack
        paddingHorizontal="$md"
        paddingTop="$sm"
        paddingBottom="$md"
        backgroundColor={COLOR_BG_FOOTER}
        borderTopWidth={1}
        borderTopColor={COLOR_BORDER}
      >
        <Button
          theme="active"
          flex={1}
          size="$md"
          borderRadius={12}
          fontWeight="semibold"
          onPress={handleSave}
          disabled={saveDisabled}
          accessibilityRole="button"
          accessibilityLabel={submitDisabledHint ?? saveLabel}
          accessibilityState={{ disabled: saveDisabled }}
          testID="save-button"
        >
          {saveLabel}
        </Button>
      </XStack>
    </YStack>
  );
}

// =====================================================================
// Sub-components — 指派人 chip
// =====================================================================

interface AssigneeChipsProps {
  form: CreateTaskFormState;
  setForm: React.Dispatch<React.SetStateAction<CreateTaskFormState>>;
  disabled: boolean;
}

/**
 * 指派人 chip 子组件 — 内部调 useFamilyValue() 拿 members。
 *
 * 注意:本组件**直接**用 useFamilyValue()(screen 层的 hook)— 因为这是
 * 共享 form body 必须的依赖(EditTaskScreen / CreateTaskScreen 都跑在
 * FamilyProvider 内)。
 */
function AssigneeChips({
  form,
  setForm,
  disabled,
}: AssigneeChipsProps): React.JSX.Element {
  const familyValue = useFamilyValue();

  if (!familyValue || familyValue.members.length === 0) {
    return (
      <Text fontSize="$body" color={COLOR_TEXT_SECONDARY}>
        {ASSIGNEE_EMPTY}
      </Text>
    );
  }

  return (
    <>
      {familyValue.members.map((member) => {
        const isMe = member.user_id === familyValue.family.created_by;
        const label = isMe
          ? '我'
          : memberLabel(
              member,
              familyValue.family.created_by,
              familyValue.family.created_by,
            );
        const selected = form.assigneeId === member.user_id;
        return (
          <ChipButton
            key={member.user_id}
            label={label}
            selected={selected}
            disabled={disabled}
            onPress={() => setForm((f) => ({ ...f, assigneeId: member.user_id }))}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`指派人:${label}${selected ? ',已选中' : ''}`}
            testID={`assignee-${member.user_id}`}
          />
        );
      })}
    </>
  );
}

// =====================================================================
// Sub-components — FormField / ChipButton / ChipGroup
// =====================================================================

interface FormFieldProps {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}

function FormField({ label, required, children }: FormFieldProps): React.JSX.Element {
  return (
    <YStack gap="$xs" marginBottom="$md">
      <Text fontSize="$body" color={COLOR_TEXT_PRIMARY} fontWeight="medium">
        {label}
        {required ? (
          <Text fontSize="$body" color={COLOR_PRIMARY}>
            {' *'}
          </Text>
        ) : null}
      </Text>
      {children}
    </YStack>
  );
}

interface ChipButtonProps {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  accessibilityRole: 'button' | 'radio' | 'checkbox';
  accessibilityState?: { selected?: boolean; disabled?: boolean };
  accessibilityLabel: string;
  testID?: string;
}

function ChipButton({
  label,
  selected,
  disabled,
  onPress,
  accessibilityRole,
  accessibilityState,
  accessibilityLabel,
  testID,
}: ChipButtonProps): React.JSX.Element {
  return (
    <View
      style={[
        styles.chip,
        selected ? styles.chipSelected : styles.chipDefault,
        disabled ? styles.chipDisabled : null,
      ]}
      onTouchEnd={disabled ? undefined : onPress}
      accessible
      accessibilityRole={accessibilityRole}
      accessibilityState={{ ...accessibilityState, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <Text
        fontSize="$body"
        color={selected ? '#FFFFFF' : COLOR_TEXT_PRIMARY}
        fontWeight={selected ? 'semibold' : 'normal'}
      >
        {label}
      </Text>
    </View>
  );
}

interface ChipGroupProps<T extends string> {
  values: Array<{ value: T; label: string }>;
  selected: T;
  onSelect: (v: T) => void;
  disabled?: boolean;
  accessibilityLabel: string;
}

function ChipGroup<T extends string>({
  values,
  selected,
  onSelect,
  disabled,
  accessibilityLabel,
}: ChipGroupProps<T>): React.JSX.Element {
  return (
    <XStack gap="$sm" flexWrap="wrap">
      {values.map(({ value, label }) => {
        const isSelected = selected === value;
        return (
          <ChipButton
            key={value}
            label={label}
            selected={isSelected}
            disabled={disabled}
            onPress={() => onSelect(value)}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ selected: isSelected }}
            testID={`chip-${value}`}
          />
        );
      })}
    </XStack>
  );
}

// =====================================================================
// Styles
// =====================================================================

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 48,
  },
  textInput: {
    backgroundColor: COLOR_CHIP_BG,
    borderColor: COLOR_BORDER,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: COLOR_TEXT_PRIMARY,
  },
  textInputMulti: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  textInputSpaced: {
    marginTop: 8,
  },
  textInputError: {
    borderColor: COLOR_ERROR,
    borderWidth: 2,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 4,
    marginBottom: 4,
  },
  chipDefault: {
    backgroundColor: COLOR_CHIP_BG,
    borderColor: COLOR_BORDER,
  },
  chipSelected: {
    backgroundColor: COLOR_PRIMARY,
    borderColor: COLOR_PRIMARY,
  },
  chipDisabled: {
    opacity: 0.5,
  },
});

// 暴露一些常量给消费侧(EditTaskScreen 需要 submitDisabledHint 计算)
export const TASK_FORM_BODY_LABELS = {
  submit: '保存',
  submitting: '保存中…',
  disabledHint: '请先填写必填项',
} as const;

// 把 form → input 翻译函数从 createTaskForm 重新导出,screen 层不需要直接
// 知道 toCreateTaskInput vs toUpdateTaskInput 的差异
export { toCreateTaskInput, toUpdateTaskInput };

// 重新导出 initial state factory(避免 screen 层重复 import)
export { createInitialState };