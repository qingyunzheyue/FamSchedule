/**
 * CreateTaskScreen — 创建任务表单 — T-US001-1
 *
 * 职责(US-001 端到端 — 从 home 第一次能创建一个任务):
 *   1. 渲染表单:标题 / 日期 / 时间 / 指派人 / 共同执行人(占位) / 周期(占位+拒绝提交)
 *      / 备注 / 共享(简化二档)
 *   2. 状态机:input → submitting → submitted
 *      - input     : 默认;必填校验失败 → 字段红色描边 + 红字
 *      - submitting: 保存按钮变 "..." + 全部 input disabled
 *      - submitted : 隐藏表单,显示 "已保存 ✨" 1s,自动 router.back()
 *   3. 提交:无周期 → 构造 CreateTaskInput 调 TaskService.createTask;
 *      有周期 → Alert.alert toast「周期任务即将推出」+ 不提交。
 *   4. 失败:显示「保存失败,请重试」+ 恢复 input 状态(用户可重试)。
 *
 * 设计依据:
 *   - PRD US-001:creator 第一次能进 home tab 实际创建一个任务
 *   - 设计 task-create-v1.0.md:字段 + 状态 + 错误文案 + 占位任务标题示例
 *   - ADR-003:一次性任务写 tasks 行,template_id = NULL(由 TaskService 兜底)
 *   - 严格 scope(任务 brief):不做 DatePicker / TimePicker native module,用纯 JS
 *     chip + TextInput 简化版;周期 / 共同执行人 / 三档共享留后续任务
 *
 * 简化决策(明确记录):
 *   - **DatePicker**:无 `@react-native-community/datetimepicker`,4 chip +
 *     custom 展开 TextInput 输入 `YYYY-MM-DD`(内置格式校验)
 *   - **TimePicker**:同上,4 chip + custom 展开 TextInput `HH:MM`
 *   - **共同执行人**:占位按钮 + Alert "即将推出"(**不**做 picker,留 T-US009)
 *   - **周期**:4 选项 dropdown,selected=daily/weekly/monthly 时 Alert toast
 *     + 拒绝提交 + 保存按钮 label 加 " (周期即将推出)" 提示,state 保留
 *   - **共享**:二档(私有 / 共享给配偶查看);三档「共享给配偶执行」→ T-US009
 *
 * 同步路径(本任务范围):
 *   - createTask 直插 tasks 表;失败显示「保存失败」+ 恢复 input
 *   - **不**接 SyncManager.enqueueAndApply(离线场景下 RPC 失败 → 显式错误,留
 *     T-FIX-04 / T-US002-1)。新 row 通过 Realtime channel(SubscribeFamily 已订阅
 *     tasks 表)自动推送,home tab 列表拉取由 SyncManager.pullSince 完成(留 T-US002-1)。
 *
 * a11y(设计 §7):
 *   - 必填项 accessibilityHint="必填"
 *   - DateChip / TimeChip accessibilityRole="button",label 含当前值
 *   - 指派人 chips accessibilityRole="radio",当前 selected=true
 *   - 保存按钮 disabled 时 accessibilityState={{disabled: true}}
 *
 * 测试策略:
 *   - 本任务**不**做组件渲染测试(jest-expo preset Tamagui ESM 限制,T-FIX-06 解决)
 *   - 纯逻辑(校验 / chip 派生 / 转译)已抽到 src/lib/createTaskForm.ts,
 *     由 __tests__/CreateTaskScreen.test.tsx 覆盖
 *   - 视觉层由 ui-ux / 手动 / EAS 真机验证
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button, Text, XStack, YStack } from 'tamagui';
import { CheckCircle, WarningCircle } from 'phosphor-react-native';

import { TaskService } from '../services/TaskService';
import { useFamilyValue } from '../contexts/FamilyContext';
import {
  createInitialState,
  isRecurrenceSupported,
  memberLabel,
  toCreateTaskInput,
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
// Constants — UI 文案(集中常量,便于国际化时抽取)
// =====================================================================

const HEADER_CANCEL = '取消';
const HEADER_TITLE = '新建任务';
const HEADER_SAVE = '保存';
const HEADER_SAVING = '保存中…';
const HEADER_SAVE_BLOCKED = '请先填写必填项';

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
const SUBMITTED_TEXT = '已保存 ✨';

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
const COLOR_TEXT_PRIMARY = '#3A2E20';
const COLOR_TEXT_SECONDARY = '#7A6B57';
const COLOR_ERROR = '#C95444';
const COLOR_SUCCESS = '#5C9D7E';

// =====================================================================
// Component
// =====================================================================

/**
 * 组件契约:
 *   - mount 时:从 useFamilyValue() 拿 family + members,把 assigneeId 默认填
 *     creator(我自己)
 *   - 状态机 3 phase:input / submitting / submitted
 *   - submitted 后 setTimeout(1000ms) → router.back()
 *   - 周期非 none 时:Alert toast + 不调 service + 保存按钮 disabled
 *   - 校验失败:不调 service + 显示对应红字
 *   - service 失败:Alert toast「保存失败」+ 恢复 input phase
 */
export function CreateTaskScreen(): React.JSX.Element {
  const router = useRouter();
  const familyValue = useFamilyValue();

  const initialState = useMemo(() => {
    const init = createInitialState(new Date());
    // 默认指派给自己(creator = family.created_by);
    // 如果 family.created_by 没拿到,fallback 到第一个 member
    if (familyValue) {
      const me = familyValue.members.find(
        (m) => m.user_id === familyValue.family.created_by,
      );
      if (me) {
        init.assigneeId = me.user_id;
      } else if (familyValue.members.length > 0) {
        init.assigneeId = familyValue.members[0].user_id;
      }
    }
    return init;
  }, [familyValue]);

  const [form, setForm] = useState<CreateTaskFormState>(initialState);
  const [phase, setPhase] = useState<'input' | 'submitting' | 'submitted'>('input');
  const [validationError, setValidationError] = useState<string | null>(null);

  // 当 initialState 异步解析后(useFamilyValue 还在 loading 时 form 已经 mount),
  // 同步一次 assigneeId
  useEffect(() => {
    if (!form.assigneeId && familyValue && familyValue.members.length > 0) {
      const me =
        familyValue.members.find(
          (m) => m.user_id === familyValue.family.created_by,
        ) ?? familyValue.members[0];
      setForm((f) => ({ ...f, assigneeId: me.user_id }));
    }
  }, [familyValue, form.assigneeId]);

  // -------------------------------------------------------------------------
  // Auto-navigate on success
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (phase !== 'submitted') return;
    const t = setTimeout(() => {
      router.back();
    }, 1000);
    return () => clearTimeout(t);
  }, [phase, router]);

  // -------------------------------------------------------------------------
  // Submit handler
  // -------------------------------------------------------------------------

  const handleSave = useCallback(async (): Promise<void> => {
    if (phase !== 'input') return;

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

    // 3. 调 service
    setPhase('submitting');
    let result;
    try {
      const input = toCreateTaskInput(form);
      result = await TaskService.createTask(input);
    } catch (err) {
      // 防御性:TaskService.createTask 设计上不抛,但万一 throw
      // eslint-disable-next-line no-console
      console.error('[CreateTaskScreen] createTask threw:', err);
      Alert.alert('保存失败', '请重试');
      setPhase('input');
      return;
    }

    if (result.status === 'created') {
      setPhase('submitted');
      return;
    }

    // failed → 区分 no_family / not_authenticated / server error
    if (result.reason === 'no_family') {
      Alert.alert('保存失败', '你还没加入家庭');
    } else if (result.reason === 'not_authenticated') {
      Alert.alert('保存失败', '请重新登录后再试');
    } else {
      Alert.alert('保存失败', '请重试');
    }
    setPhase('input');
  }, [form, phase]);

  // -------------------------------------------------------------------------
  // Render:submitted — 成功提示 1s + 自动返回
  // -------------------------------------------------------------------------

  if (phase === 'submitted') {
    return (
      <SafeAreaView style={styles.container}>
        <YStack
          flex={1}
          alignItems="center"
          justifyContent="center"
          gap="$lg"
          padding="$xl"
        >
          <CheckCircle size={80} color={COLOR_SUCCESS} weight="fill" />
          <Text
            fontSize="$title"
            fontFamily="$heading"
            color={COLOR_TEXT_PRIMARY}
            accessibilityRole="text"
          >
            {SUBMITTED_TEXT}
          </Text>
          <Text fontSize="$body" color={COLOR_TEXT_SECONDARY}>
            正在返回任务列表...
          </Text>
        </YStack>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Render:input / submitting
  // -------------------------------------------------------------------------

  const isSubmitting = phase === 'submitting';
  const isFormValid = validateForm(form) === null;
  const isRecurrenceBlocked = !isRecurrenceSupported(form.recurrence);
  const saveDisabled = isSubmitting || !isFormValid || isRecurrenceBlocked;

  const saveLabel = isSubmitting
    ? HEADER_SAVING
    : saveDisabled
    ? `${HEADER_SAVE_BLOCKED}${isRecurrenceBlocked ? ` (${RECURRENCE_BLOCKED_HINT})` : ''}`
    : HEADER_SAVE;

  const dateChipValueLabel =
    DATE_CHIP_LABELS[form.dateChip] +
    (form.dateChip === 'custom' && form.taskDate ? ` · ${form.taskDate}` : '');
  const timeChipValueLabel =
    TIME_CHIP_LABELS[form.timeChip] +
    (form.timeChip === 'custom' && form.taskTime ? ` · ${form.taskTime}` : '');

  return (
    <SafeAreaView style={styles.container}>
      <YStack flex={1}>
        {/* Header */}
        <XStack
          alignItems="center"
          justifyContent="space-between"
          paddingHorizontal="$md"
          paddingVertical="$sm"
        >
          <Text
            fontSize="$body"
            color={COLOR_TEXT_PRIMARY}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={HEADER_CANCEL}
            testID="header-cancel"
          >
            {HEADER_CANCEL}
          </Text>
          <Text
            fontSize="$title"
            fontFamily="$heading"
            fontWeight="semibold"
            color={COLOR_TEXT_PRIMARY}
          >
            {HEADER_TITLE}
          </Text>
          <Text
            fontSize="$body"
            color={saveDisabled ? COLOR_TEXT_SECONDARY : COLOR_PRIMARY}
            fontWeight="semibold"
            onPress={saveDisabled ? undefined : () => void handleSave()}
            accessibilityRole="button"
            accessibilityLabel={saveLabel}
            accessibilityState={{ disabled: saveDisabled }}
            testID="header-save"
          >
            {isSubmitting ? HEADER_SAVING : HEADER_SAVE}
          </Text>
        </XStack>

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
              editable={!isSubmitting}
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
              disabled={isSubmitting}
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
                editable={!isSubmitting}
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
              disabled={isSubmitting}
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
                editable={!isSubmitting}
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
              {familyValue && familyValue.members.length > 0
                ? familyValue.members.map((member) => {
                    const isMe = member.user_id === familyValue.family.created_by;
                    const label = isMe ? '我' : memberLabel(
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
                        disabled={isSubmitting}
                        onPress={() =>
                          setForm((f) => ({ ...f, assigneeId: member.user_id }))
                        }
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`指派人:${label}${selected ? ',已选中' : ''}`}
                        testID={`assignee-${member.user_id}`}
                      />
                    );
                  })
                : (
                  <Text fontSize="$body" color={COLOR_TEXT_SECONDARY}>
                    {ASSIGNEE_EMPTY}
                  </Text>
                )}
            </XStack>
          </FormField>

          {/* 共同执行人 — 占位(留 T-US009) */}
          <FormField label={FIELD_CO_EXECUTOR_LABEL}>
            <Button
              variant="outlined"
              disabled={isSubmitting}
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
                    disabled={isSubmitting}
                    onPress={() =>
                      setForm((f) => ({ ...f, recurrence: v }))
                    }
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
              onChangeText={(text) =>
                setForm((f) => ({ ...f, description: text }))
              }
              placeholder={FIELD_DESCRIPTION_PLACEHOLDER}
              editable={!isSubmitting}
              multiline
              numberOfLines={3}
              style={[
                styles.textInput,
                styles.textInputMulti,
              ]}
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
                    disabled={isSubmitting}
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
      </YStack>
    </SafeAreaView>
  );
}

// =====================================================================
// Sub-components
// =====================================================================

interface FormFieldProps {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}

/**
 * 简单的 label + 子内容包装器。
 *   - label 必填
 *   - required 时追加 ` *`(视觉) + 在 TextInput 上设 accessibilityHint="必填"
 */
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

/**
 * Chip-style 按钮(单选 / 多选 / 触发器都用同一组件)。
 * 选中态:背景 = COLOR_PRIMARY + 文字白色;未选:浅亚麻背景 + 1px 描边。
 */
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

/**
 * DateChip / TimeChip 的横向 chip 行(单选)。
 * `selected` 是字符串字面量值,内部用 === 比对。
 *
 * 泛型 `<T extends string>`:确保 value / selected / onSelect 三处类型一致,
 * 调用方传 DateChipValue / TimeChipValue 时 onSelect 拿到的 v 也是对应字面量。
 */
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
  container: {
    flex: 1,
    backgroundColor: '#F4ECDC', // 亚麻背景,与 home tab 一致
  },
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