/**
 * EditTaskScreen — 编辑任务 — T-US003-1 + T-US003-1 review fix + T-US005-4
 *
 * 职责(US-003 编辑 — 一次性格式的任务编辑):
 *   1. 从 URL `?id=<taskId>` 读 taskId
 *   2. 从 useTasks() 找该 task(找不到 → "任务不存在" + 自动 back)
 *   3. 模板任务(template_id 非 null)→ 显示"模板任务暂不支持编辑"占位 + 阻止编辑
 *   4. 一次性任务 → 用 TaskFormBody 预填 + 提交走 TaskService.updateTask
 *   5. 成功 → router.back();失败 → Alert(已本地化 reason)
 *
 * 设计依据:
 *   - task-breakdown-v1.0.md §6.3 US-003:T-US003-1 DoD"复用 CreateTaskScreen 的表单,预填当前值"
 *   - 设计 task-detail-v1.0.md §3.4:从 ⋮ → 编辑跳 task-edit
 *   - 设计 task-create-v1.0.md §3.2:编辑模式 Header 改为"取消  编辑任务  保存"
 *   - 本任务简化:模板任务编辑留 T-US004-1 完成后;当前直接显示"暂不支持编辑"占位
 *
 * 简化决策:
 *   - **不在 mount 时校验状态**(completed / cancelled)— TaskService.updateTask 已做
 *     server-side 校验(防 race condition);UI 显示 + 用户可能从 Realtime 收到变更
 *   - **不做 sticky header**(跟着 ScrollView 滚动)— 后续 polish
 *   - **成功不显示"已保存 ✨"**(CreateTaskScreen 那样)— 直接 back,体验更紧凑
 *
 * T-US003-1 review fix:
 *   - Blocker #1:删除 header 右侧"透明 placeholder"(既不可见也不能 tap),实际保存按钮
 *     在 TaskFormBody 末尾 sticky bottom(template-not-supported 分支也同步清掉)
 *   - Major #2:删除 mode="edit" prop(TaskFormBody 已不再接受)
 *   - Major #3-5:currentUserId 来源从 `useFamilyValue()?.family.created_by ?? ''`
 *     切换到 `useCurrentUserId()`,与其他 2 个 screen 同一来源(集中一处)
 *
 * T-US005-4:
 *   - mount useSyncManager —— 配偶在另一台 device 删除同一 task(T-US003-2 已支持),
 *     Realtime DELETE 事件 → LocalStore 移除 task → EditTaskScreen "任务不存在" 自动
 *     back(已有 useEffect 处理)
 *   - 配偶修改 task 字段 → Realtime UPDATE → useTasks() 重渲染 → 提交时拿到 server
 *     最新值,避免本地 cache 旧值与 server 冲突
 *
 * a11y:
 *   - Header:取消 + 标题(header 不放保存按钮 — 走 TaskFormBody 内置按钮)
 *   - 表单字段 + 保存按钮:复用 TaskFormBody 已有的 a11y
 */

import { useCallback, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text, XStack, YStack } from 'tamagui';
import { WarningCircle } from 'phosphor-react-native';

import { TaskService } from '../services/TaskService';
import {
  useCurrentUserId,
  useFamilyValue,
} from '../contexts/FamilyContext';
import { useTasks } from '../hooks/useTasks';
import { useSyncManager } from '../lib/SyncManager';
import {
  fromTask,
  toUpdateTaskInput,
  type CreateTaskFormState,
} from '../lib/createTaskForm';
import {
  TaskFormBody,
  type TaskFormSubmitResult,
} from '../components/TaskFormBody';

// =====================================================================
// Constants — UI 文案
// =====================================================================

const HEADER_CANCEL = '取消';
const HEADER_TITLE = '编辑任务';
const SUBMIT_LABEL = '保存';

const TASK_NOT_FOUND_TITLE = '任务不存在';
const TASK_NOT_FOUND_MESSAGE = '这条任务可能已被删除,正在返回';
const TEMPLATE_NOT_SUPPORTED_TITLE = '模板任务暂不支持编辑';
const TEMPLATE_NOT_SUPPORTED_MESSAGE =
  '请删除并重新创建(周期模板编辑功能开发中)';

// =====================================================================
// 颜色常量(与 TaskFormBody 对齐)
// =====================================================================

const COLOR_PRIMARY = '#DC5A24';
const COLOR_TEXT_PRIMARY = '#3A2E20';
const COLOR_TEXT_SECONDARY = '#7A6B57';
const COLOR_BG = '#F4ECDC';

// =====================================================================
// Component
// =====================================================================

/**
 * 组件契约:
 *   - mount 时:从 URL 读 id → useTasks() 找 task → 检查 template_id
 *   - 找不到 → Alert("任务不存在") + 1s 后 router.back()
 *   - 模板任务 → 显示 placeholder + 阻止提交
 *   - 一次性任务 → TaskFormBody 预填 + 提交走 updateTask
 */
export function EditTaskScreen(): React.JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const taskId = typeof params.id === 'string' ? params.id : '';
  const familyValue = useFamilyValue();
  const currentUserId = useCurrentUserId();
  const tasks = useTasks();

  // T-US005-4:挂 SyncManager —— 配偶在另一台 device 改 / 删本 task 时,Realtime 推送
  // → LocalStore 更新 → useTasks() 重渲染。配偶删除时,本屏 useEffect 探测到
  // task 消失 → Alert "任务不存在" + 自动 back(避免提交时 server 404)。
  useSyncManager(familyValue?.family.id ?? null);

  const task = useMemo(
    () => tasks.find((t) => t.id === taskId),
    [tasks, taskId],
  );

  // -------------------------------------------------------------------------
  // 找不到 task → Alert + 自动 back
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!taskId) {
      Alert.alert(TASK_NOT_FOUND_TITLE, '链接无效,正在返回', [
        { text: '确定', onPress: () => router.back() },
      ]);
      return;
    }
    if (!task) {
      Alert.alert(TASK_NOT_FOUND_TITLE, TASK_NOT_FOUND_MESSAGE, [
        { text: '确定', onPress: () => router.back() },
      ]);
      return;
    }
  }, [taskId, task, router]);

  // -------------------------------------------------------------------------
  // Submit handler
  // -------------------------------------------------------------------------

  const today = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }, []);

  const initialState = useMemo<CreateTaskFormState | null>(() => {
    if (!task || !familyValue) return null;
    return fromTask(task, familyValue.members, currentUserId, today);
  }, [task, familyValue, currentUserId, today]);

  const handleCancel = useCallback((): void => {
    router.back();
  }, [router]);

  const handleSubmit = useCallback(
    async (
      form: CreateTaskFormState,
      _uid: string,
    ): Promise<TaskFormSubmitResult> => {
      if (!task) {
        return { ok: false, reason: '任务不存在' };
      }
      try {
        const input = toUpdateTaskInput(form, currentUserId);
        const result = await TaskService.updateTask(task.id, input);
        if (result.status === 'updated') {
          // 成功 — 直接 back;不显示"已保存"页(简化)
          router.back();
          return { ok: true };
        }
        // 失败 reason → UI 翻译(任务 brief §B)
        return { ok: false, reason: mapUpdateFailureReason(result.reason) };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[EditTaskScreen] updateTask threw:', err);
        return { ok: false, reason: '保存失败,请重试' };
      }
    },
    [task, currentUserId, router],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // 1. Family / tasks 还在 loading
  if (!familyValue || (taskId && !task)) {
    return (
      <SafeAreaView style={styles.container}>
        <YStack flex={1} alignItems="center" justifyContent="center">
          <ActivityIndicator size="large" color={COLOR_PRIMARY} />
        </YStack>
      </SafeAreaView>
    );
  }

  // 2. Task 确实不存在 → 显示 placeholder + 已被 useEffect Alert 处理
  if (!task) {
    return (
      <SafeAreaView style={styles.container}>
        <YStack
          flex={1}
          alignItems="center"
          justifyContent="center"
          padding="$xl"
        >
          <Text fontSize="$title" color={COLOR_TEXT_PRIMARY}>
            任务不存在
          </Text>
          <Text fontSize="$body" color={COLOR_TEXT_SECONDARY} marginTop="$sm">
            正在返回...
          </Text>
        </YStack>
      </SafeAreaView>
    );
  }

  // 3. 模板任务 → 不支持编辑 placeholder
  if (task.template_id !== null) {
    return (
      <SafeAreaView style={styles.container}>
        <YStack flex={1}>
          {/* Header — 左/中(右上保留空位) */}
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

          <YStack
            flex={1}
            alignItems="center"
            justifyContent="center"
            padding="$xl"
            gap="$md"
          >
            <WarningCircle size={64} color={COLOR_PRIMARY} weight="duotone" />
            <Text
              fontSize="$title"
              fontFamily="$heading"
              color={COLOR_TEXT_PRIMARY}
              accessibilityRole="header"
            >
              {TEMPLATE_NOT_SUPPORTED_TITLE}
            </Text>
            <Text fontSize="$body" color={COLOR_TEXT_SECONDARY}>
              {TEMPLATE_NOT_SUPPORTED_MESSAGE}
            </Text>
          </YStack>
        </YStack>
      </SafeAreaView>
    );
  }

  // 4. 一次性任务 → TaskFormBody
  if (!initialState) {
    return (
      <SafeAreaView style={styles.container}>
        <YStack flex={1} alignItems="center" justifyContent="center">
          <ActivityIndicator size="large" color={COLOR_PRIMARY} />
        </YStack>
      </SafeAreaView>
    );
  }

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
// Helpers
// =====================================================================

/**
 * 把 TaskService.updateTask 的失败 reason 翻译成 UI 文案(任务 brief §B)。
 */
function mapUpdateFailureReason(reason: string): string {
  switch (reason) {
    case 'no_family':
      return '你还没加入家庭';
    case 'not_authenticated':
      return '请重新登录后再试';
    case 'not_owner':
      return '你不是创建者,无法编辑';
    case 'task_completed':
      return '任务已完成,无法编辑';
    case 'task_cancelled':
      return '任务已取消,无法编辑';
    case 'template_not_supported':
      return TEMPLATE_NOT_SUPPORTED_MESSAGE;
    case 'task_not_found':
      return '任务不存在';
    default:
      return '保存失败,请重试';
  }
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