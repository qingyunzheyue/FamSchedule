/**
 * CreateTaskScreen — 创建任务表单 — T-US001-1 + T-US003-1 refactor + T-US003-1 review fix
 *
 * 职责(US-001 端到端 — 从 home 第一次能创建一个任务):
 *   1. 渲染表单:复用 TaskFormBody
 *   2. 状态机:input → submitting → submitted
 *      - input     : 默认;必填校验失败 → 字段红色描边 + 红字
 *      - submitting: 保存按钮变 "..." + 全部 input disabled
 *      - submitted : 隐藏表单,显示 "已保存 ✨" 1s,自动 router.back()
 *   3. 提交:TaskFormBody 触发 onSubmit → 本屏负责调 TaskService.createTask
 *   4. 失败:TaskFormBody 内 Alert「保存失败」+ 恢复 input 状态(用户可重试)
 *
 * 设计依据:
 *   - PRD US-001:creator 第一次能进 home tab 实际创建一个任务
 *   - 设计 task-create-v1.0.md:字段 + 状态 + 错误文案 + 占位任务标题示例
 *   - ADR-003:一次性任务写 tasks 行,template_id = NULL(由 TaskService 兜底)
 *   - T-US003-1:CreateTaskScreen + EditTaskScreen 共享 TaskFormBody 90% 表单
 *
 * 简化决策(明确记录):
 *   - **DatePicker**:无 `@react-native-community/datetimepicker`,4 chip +
 *     custom 展开 TextInput 输入 `YYYY-MM-DD`(内置格式校验)— 由 TaskFormBody 提供
 *   - **TimePicker**:同上,4 chip + custom 展开 TextInput `HH:MM`
 *   - **共同执行人**:占位按钮 + Alert "即将推出"— 由 TaskFormBody 提供
 *   - **周期**:4 选项 chip,selected=daily/weekly/monthly 时 Alert toast
 *     + 拒绝提交 — 由 TaskFormBody 提供
 *   - **共享**:二档(私有 / 共享给配偶查看)— 由 TaskFormBody 提供
 *
 * 同步路径(本任务范围):
 *   - createTask 直插 tasks 表;失败显示「保存失败」+ 恢复 input
 *   - **不**接 SyncManager.enqueueAndApply(离线场景下 RPC 失败 → 显式错误)
 *
 * a11y(设计 §7):
 *   - Header:返回 + 标题(无保存按钮占位 — T-US003-1 review fix Blocker #1:
 *     之前 header 有空白 placeholder Text,既不可见也不能 tap,实际保存按钮
 *     在 TaskFormBody 内;header 右侧改为空 View 保留布局对齐)
 *   - 必填项 / DateChip / TimeChip / 指派人 chips / 保存按钮 disabled — 全部由
 *     TaskFormBody 处理
 *
 * T-US003-1 review fix:
 *   - Blocker #1:删除 header save placeholder(实际不可用),TaskFormBody 末尾的
 *     <Button onPress={handleSave}> 是唯一触发保存的入口
 *   - Major #2:删除 mode="create" prop(TUSKFormBody 已不再接受)
 *   - Major #3-5:currentUserId 来源从 `useFamilyValue()?.family.created_by ?? ''`
 *     切换到 `useCurrentUserId()`,与其他 2 个 screen 同一来源(集中一处)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Text, XStack, YStack } from 'tamagui';
import { CheckCircle } from 'phosphor-react-native';

import { TaskService } from '../services/TaskService';
import { useCurrentUserId, useFamilyValue } from '../contexts/FamilyContext';
import {
  createInitialState,
  toCreateTaskInput,
  type CreateTaskFormState,
} from '../lib/createTaskForm';
import {
  TaskFormBody,
  type TaskFormSubmitResult,
} from '../components/TaskFormBody';

// =====================================================================
// Constants — UI 文案(集中常量,便于国际化)
// =====================================================================

const HEADER_CANCEL = '取消';
const HEADER_TITLE = '新建任务';
const SUBMIT_LABEL = '保存';
const SUBMITTED_TEXT = '已保存 ✨';

// =====================================================================
// 颜色常量(与 TaskFormBody 对齐)
// =====================================================================

const COLOR_TEXT_PRIMARY = '#3A2E20';
const COLOR_TEXT_SECONDARY = '#7A6B57';
const COLOR_SUCCESS = '#5C9D7E';
const COLOR_BG = '#F4ECDC';

// =====================================================================
// Component
// =====================================================================

/**
 * 组件契约:
 *   - mount 时:从 useFamilyValue() 拿 family + members,把 assigneeId 默认填
 *     creator(我自己)
 *   - 状态机 3 phase:input / submitting / submitted
 *   - submitted 后 setTimeout(1000ms) → router.back()
 *   - 同步:TaskFormBody 触发 onSubmit → 本屏负责调 TaskService.createTask
 */
export function CreateTaskScreen(): React.JSX.Element {
  const router = useRouter();
  const currentUserId = useCurrentUserId();
  const familyValue = useFamilyValue();

  const initialState = useMemo<CreateTaskFormState>(() => {
    const init = createInitialState(new Date());
    // 默认指派给自己(currentUserId === family.created_by);
    // 兜底:极端 case(理论不该发生)— 当前 user 不在 members 列表里,fallback 到第 1 个
    if (familyValue) {
      const me = familyValue.members.find(
        (m) => m.user_id === currentUserId,
      );
      if (me) {
        init.assigneeId = me.user_id;
      } else if (familyValue.members.length > 0) {
        init.assigneeId = familyValue.members[0].user_id;
      }
    }
    return init;
  }, [familyValue, currentUserId]);

  const [phase, setPhase] = useState<'input' | 'submitting' | 'submitted'>(
    'input',
  );

  // -------------------------------------------------------------------------
  // Submit handler(交给 TaskFormBody 调用)
  // -------------------------------------------------------------------------

  const handleSubmit = useCallback(
    async (
      form: CreateTaskFormState,
      _currentUserId: string,
    ): Promise<TaskFormSubmitResult> => {
      setPhase('submitting');
      try {
        const input = toCreateTaskInput(form);
        const result = await TaskService.createTask(input);
        if (result.status === 'created') {
          setPhase('submitted');
          return { ok: true };
        }
        // failed
        if (result.reason === 'no_family') {
          setPhase('input');
          return { ok: false, reason: '你还没加入家庭' };
        }
        if (result.reason === 'not_authenticated') {
          setPhase('input');
          return { ok: false, reason: '请重新登录后再试' };
        }
        setPhase('input');
        return { ok: false, reason: '请重试' };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[CreateTaskScreen] createTask threw:', err);
        setPhase('input');
        return { ok: false, reason: '请重试' };
      }
    },
    [],
  );

  const handleCancel = useCallback((): void => {
    router.back();
  }, [router]);

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
  // Render:input / submitting(共用 TaskFormBody)
  // -------------------------------------------------------------------------

  return (
    <SafeAreaView style={styles.container}>
      <YStack flex={1}>
        {/* Header — 左/中/右(右为占位 View 保留布局对齐 — T-US003-1 review fix Blocker #1
            删除之前 header 的「空白 Text placeholder」,既不可见也不能 tap,误导用户。
            实际保存按钮在 TaskFormBody 末尾,sticky bottom。) */}
        <XStack
          alignItems="center"
          justifyContent="space-between"
          paddingHorizontal="$md"
          paddingVertical="$sm"
        >
          <Text
            fontSize="$body"
            color={COLOR_TEXT_PRIMARY}
            onPress={handleCancel}
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
          <View style={styles.headerRightSpacer} testID="header-right-spacer" />
        </XStack>

        <TaskFormBody
          initialState={initialState}
          onSubmit={handleSubmit}
          currentUserId={currentUserId}
          onCancel={handleCancel}
          submitLabel={SUBMIT_LABEL}
        />
      </YStack>
    </SafeAreaView>
  );
}

// =====================================================================
// Styles
// =====================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLOR_BG,
  },
  /**
   * header 右侧占位 — 保留布局对齐(取消 / 标题 / 右侧空位),header 不放保存按钮,
   * 保存按钮在 TaskFormBody 末尾 sticky bottom。T-US003-1 review fix Blocker #1。
   */
  headerRightSpacer: {
    minWidth: 32,
  },
});