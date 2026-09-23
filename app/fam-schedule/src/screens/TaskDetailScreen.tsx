/**
 * TaskDetailScreen — 任务详情页 — T-US003-1 + T-US003-1 review fix + T-US003-2 + T-US005-1 + T-US005-2 + T-US005-4
 *
 * 职责(US-002 故事 2/3 — 端到端查看单个任务 + US-005 故事 2/4 — 配偶先完成):
 *   1. 从 URL `?id=<taskId>` 读 taskId
 *   2. 从 useTasks() 找该 task(找不到 → "任务不存在" + 自动 back)
 *   3. 渲染 task-detail-v1.0.md §3.1 布局的**简化版**:
 *      - Header:← 返回 + 标题"任务详情" + 右上角 ⋮ 菜单
 *      - TaskHero:title + 时间行 + **T-US005-1 新增** 主按钮区(CheckInButton 替换 placeholder)
 *      - 备注(如有)
 *      - 指派人
 *      - **省略**:共同执行人 / 共享设置 / 周期(留 T-US009 / T-US010 / T-US004-1)
 *      - 打卡历史(占位 — 留 T-US005-4)
 *   4. ⋮ 菜单(任务 brief §A / §C.2 + T-US003-2):
 *      - 所有人可见:`复制为新任务` → Alert "即将推出"(留后续)
 *      - 创建者可见:`编辑` → router.push('/(main)/(home)/task-edit?id=...')
 *      - **创建者可见:`删除` → ConfirmDialog → TaskService.deleteTask**(T-US003-2)
 *   5. **T-US005-1 新增**:CheckInButton 集成 → handleCheckIn → CheckInService.checkin →
 *      失败 Alert(翻译 mapCheckInFailureReason)/ 成功 noop(乐观 UI 自然切换)
 *   6. **T-US005-2 新增**:handleCheckIn 3 status 分支 —
 *      - checked_in(我先完成):no toast(乐观 UI 自动切到 completed 态)
 *      - spouse_completed(配偶先完成):Alert "配偶已先一步完成",body "由配偶于 HH:MM 完成"
 *      - failed:Alert "打卡失败" + 翻译 reason
 *
 * 设计依据:
 *   - 任务 detail-v1.0.md §3.1 / §3.4 / §6 文案 / §7 a11y
 *   - 任务 brief §C.2 + T-US003-2 brief §C + T-US005-1 brief §C.4 + T-US005-2 brief
 *   - 设计 task-detail-v1.0 §10:配偶先完成用 Toast(本任务用 Alert 跨平台一致,留 polish)
 *
 * 简化决策(明确记录 — dev self-acknowledge scope):
 *   - ❌ 不做撤销 button(留 T-US005-3)— CheckInButton 在 completed 态下点击 noop
 *   - ❌ 不做过期 banner(留 T-US014)
 *   - ✅ T-US003-2:删除走 RN Alert 二次确认(短期)→ 后续 polish 换 Tamagui Dialog
 *   - ❌ 模板任务删除(留 T-US004-1)— Alert "模板任务暂不支持删除"
 *   - ✅ ⋮ 菜单的"编辑"跳页 + "复制为新任务" 占位 Alert
 *   - ✅ **T-US005-1**:CheckInButton 替换原 CHECKIN_PLACEHOLDER / COMPLETED_PLACEHOLDER
 *   - ✅ **T-US005-2**:handleCheckIn 3 status 文案分支(spouse_completed / failed 弹 Alert,
 *                    checked_in noop);用 Alert.alert 而非 iOS Toast(跨平台一致,留 T-FIX-06 polish)
 *   - ✅ **T-US005-4**:mount useSyncManager — 详情页用户停留时间长(看完整信息 / 编辑),
 *                    配偶在另一台 device 打卡 / 编辑 / 删除同一 task 时,本屏需 Realtime 推送
 *                    更新(否则要 back → re-enter 才看到最新态)。useSyncManager 内置
 *                    AppState 切换处理(后台 → unsubscribe / 前台 → resubscribe)。
 *
 * T-US003-1 review fix:
 *   - Major #3-5:`isOwner` 计算的 currentUserId 来源从 `useFamilyValue()?.family.created_by`
 *     切换到 `useCurrentUserId()`(与其他 2 个 screen 同一来源,集中一处)
 *
 * T-US005-1 行为:
 *   - **CheckInButton 渲染在主按钮区**(testID="checkin-area")
 *     - 4 状态视觉由 CheckInButton 自身派生(getCheckInState)
 *     - cancelled → Alert "任务已取消"(CheckInButton 内部)
 *     - 点击 todo → handleCheckIn → CheckInService.checkin → 失败 Alert / 成功 noop
 *   - **handleCheckIn**:统一调 CheckInService;失败弹 Alert(翻译文案);成功不显式提示
 *     (乐观 UI 通过 Realtime 自然切换 — SyncManager 已订阅 tasks 表)
 *
 * T-US005-2 行为:
 *   - **CheckInService.checkin** 新增 'spouse_completed' 状态(RPC 0 行 → refetch 判定)
 *   - **handleCheckIn 3 status 分支**:
 *     - checked_in → noop
 *     - spouse_completed → Alert "配偶已先一步完成" / "「<title>」由配偶于 HH:MM 完成"
 *     - failed → Alert "打卡失败" + mapCheckInFailureReason
 *   - ADR-005 contract 守住:CheckInService 不直接 supabase.rpc(走 SyncManager + SELECT refetch)
 *
 * a11y(任务 detail-v1.0 §7):
 *   - 任务标题 `accessibilityRole="header"`
 *   - 各分组 `accessibilityRole="summary"`
 *   - ⋮ 按钮 `accessibilityRole="button"` label "更多操作"
 *   - CheckInButton 自带独立 a11y label(转给 task-detail §7)
 *
 * 测试策略:
 *   - **不**渲染组件本身(jest-expo + Tamagui 限制)
 *   - 视觉层由 ui-ux / 手动 / EAS 真机验证
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text, XStack, YStack } from 'tamagui';
import {
  Clock,
  DotsThreeVertical,
  Note,
  User as UserIcon,
} from 'phosphor-react-native';

import { useCurrentUserId, useFamilyValue } from '../contexts/FamilyContext';
import { useTasks } from '../hooks/useTasks';
import { useSyncManager } from '../lib/SyncManager';
import { formatTaskTime, computeTaskBadge } from '../lib/taskListFilters';
import {
  mapDeleteFailureReason,
  mapCheckInFailureReason,
  mapCheckInResultToToast,
  mapUndoCheckInFailureReason,
} from '../lib/createTaskForm';
import { TaskService } from '../services/TaskService';
import { CheckInService } from '../services/CheckInService';
import { showConfirmDialog } from '../components/ConfirmDialog';
import { CheckInButton } from '../components/CheckInButton';
import type { Task } from '../lib/LocalStore';

// =====================================================================
// Constants — UI 文案
// =====================================================================

const HEADER_TITLE = '任务详情';
const MORE_MENU_LABEL = '更多操作';

const MENU_COPY_AS_NEW = '复制为新任务';
const MENU_EDIT = '编辑';
const MENU_DELETE = '删除';

const COPY_AS_NEW_PLACEHOLDER = '复制为新任务即将推出';

/** T-US003-2 删除文案 — 对齐 task-detail-v1.0.md §6 */
const DELETE_DIALOG_TITLE = '删除这个任务?';
const DELETE_DIALOG_MESSAGE_PREFIX = '任务"';
const DELETE_DIALOG_MESSAGE_SUFFIX = '"将被删除,无法恢复。';
const DELETE_DIALOG_CONFIRM_LABEL = '删除';
const DELETE_DIALOG_CANCEL_LABEL = '取消';
const DELETE_DELETED_TITLE = '已删除';
const DELETE_DELETED_OK_LABEL = '好';
const DELETE_FAILED_TITLE = '删除失败';
const TEMPLATE_DELETE_BLOCKED_TITLE = '模板任务暂不支持删除';
const TEMPLATE_DELETE_BLOCKED_MESSAGE = '请先在家庭 Tab 解除模板关联';

const SECTION_DESCRIPTION_LABEL = '备注';
const SECTION_ASSIGNEE_LABEL = '指派人';
const SECTION_HISTORY_LABEL = '打卡历史';
const HISTORY_PLACEHOLDER = '打卡历史等 T-US005-4 接入';

/** T-US005-1:打卡失败 Alert 标题 */
const CHECKIN_FAILED_TITLE = '打卡失败';
/** T-US005-2:配偶先完成 Alert / 失败 Alert 按钮 label */
const CHECKIN_OK_LABEL = '好';

/** T-US005-3:撤销失败 Alert 标题 */
const UNDO_FAILED_TITLE = '撤销失败';

const TASK_NOT_FOUND_TITLE = '任务不存在';
const TASK_NOT_FOUND_MESSAGE = '这条任务可能已被删除,正在返回';

// =====================================================================
// 颜色常量(与 TaskCard / TaskFormBody 对齐)
// =====================================================================

const COLOR_PRIMARY = '#DC5A24';
const COLOR_BORDER = '#E8DFD0';
const COLOR_CHIP_BG = '#FFF9F0';
const COLOR_SURFACE = '#FFFFFF';
const COLOR_BG = '#F4ECDC';
const COLOR_TEXT_PRIMARY = '#3A2E20';
const COLOR_TEXT_SECONDARY = '#7A6B57';
const COLOR_WARNING = '#C95444';

// =====================================================================
// Component
// =====================================================================

/**
 * TaskDetailScreen —— 单个任务的详情视图。
 */
export function TaskDetailScreen(): React.JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const taskId = typeof params.id === 'string' ? params.id : '';
  const familyValue = useFamilyValue();
  const currentUserId = useCurrentUserId();
  const tasks = useTasks();

  // T-US005-4:挂 SyncManager —— 配偶在另一台 device 改 / 删 / 打卡本 task 时,
  // Realtime 推送 → LocalStore 更新 → useTasks() 重渲染 → 本屏视觉立即刷新
  // (无需 back → re-enter)。AppState 后台/前台切换由 hook 内部处理。
  useSyncManager(familyValue?.family.id ?? null);

  const task = useMemo(
    () => tasks.find((t) => t.id === taskId),
    [tasks, taskId],
  );

  // -------------------------------------------------------------------------
  // 找不到 → Alert + back
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
  // 派生数据
  // -------------------------------------------------------------------------

  const today = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }, []);

  const badge = useMemo(
    () => (task ? computeTaskBadge(task, today) : null),
    [task, today],
  );

  const isOwner = !!task && task.created_by === currentUserId;
  // isCompleted / isCancelled 派生移至 TaskHero 子组件(任务 brief §C.4)+
  // CheckInButton 自身 getCheckInState 派生独立的 4 状态视觉

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleBack = useCallback((): void => {
    router.back();
  }, [router]);

  const handleEdit = useCallback((): void => {
    if (!task) return;
    router.push({
      pathname: '/(main)/(home)/task-edit',
      params: { id: task.id },
    });
  }, [task, router]);

  const handleCopyAsNew = useCallback((): void => {
    Alert.alert('即将推出', COPY_AS_NEW_PLACEHOLDER);
  }, []);

  /**
   * 打卡回调(T-US005-1 + T-US005-2)— 详情页 CheckInButton 点击触发。
   *
   * 行为:
   *   - 调 CheckInService.checkin(taskId, false)— 走 SyncManager.enqueueAndApply
   *     乐观更新 + 入队 + 在线即触发 RPC(ADR-005 contract)
   *   - CheckInService.checkin 在 T-US005-2 后返回 3 种 status:
   *     a) 'checked_in'        — 我先完成(成功)— UI 乐观切到 completed 态,no toast
   *     b) 'spouse_completed'  — 配偶先 done(0 行 RPC)— Alert "配偶已先一步完成"
   *     c) 'failed'            — pre-check 失败 — Alert "打卡失败" + 翻译 reason
   *   - 文案翻译走 mapCheckInResultToToast(result, taskArg.title)
   *
   * 留后续:
   *   - 5 分钟内撤销入口(T-US005-3)— 本任务 completed 态点击 noop
   *   - iOS Toast polish(T-FIX-06)— 当前 Alert.alert 跨平台一致(无 2 秒自动消失)
   */
  const handleCheckIn = useCallback(
    async (taskArg: Task): Promise<void> => {
      const result = await CheckInService.checkin(taskArg.id, false);
      // checked_in:乐观 UI 自然切换到 completed 视觉态,不弹 toast(简洁)
      if (result.status === 'spouse_completed') {
        const msg = mapCheckInResultToToast(result, taskArg.title);
        Alert.alert(msg.title, msg.body, [{ text: CHECKIN_OK_LABEL, style: 'default' }]);
      } else if (result.status === 'failed') {
        Alert.alert(
          CHECKIN_FAILED_TITLE,
          mapCheckInFailureReason(result.reason),
          [{ text: CHECKIN_OK_LABEL, style: 'default' }],
        );
      }
      // 成功 noop:Realtime 自动合并 + UI 通过 getCheckInState 自然切换
    },
    [],
  );

  /**
   * 撤销打卡回调(T-US005-3)— 详情页 UndoChip 点击触发(5 分钟内可见)。
   *
   * 行为:
   *   - 调 CheckInService.undoCheckin(taskId)— 走 SyncManager.enqueueAndApply
   *     乐观更新(LocalStore 立即清 completed_at / completed_by)+ 入队 +
   *     在线即触发 RPC(ADR-005 contract 守住)
   *   - 失败 → Alert "撤销失败" + mapUndoCheckInFailureReason 翻译(8 reasons)
   *   - 成功 → noop:UI 自然切回 todo 视觉 + Realtime 推送完成后 refresh
   *
   * 简化决策(任务 brief §C 明确不在范围):
   *   - ❌ 撤销二次确认 Dialog(任务 brief 简化)
   *   - ❌ iOS Toast(realtime 后 UI 自然感知)— 当前 noop
   */
  const handleTaskUndo = useCallback(
    async (taskArg: Task): Promise<void> => {
      const result = await CheckInService.undoCheckin(taskArg.id);
      if (result.status === 'failed') {
        Alert.alert(
          UNDO_FAILED_TITLE,
          mapUndoCheckInFailureReason(result.reason),
          [{ text: CHECKIN_OK_LABEL, style: 'default' }],
        );
      }
      // undone → 不弹 toast:UI 自然切回 todo 视觉
    },
    [],
  );

  /**
   * 删除当前 task(T-US003-2):
   *   - 模板任务 → Alert "模板任务暂不支持删除"(占位)
   *   - 一次性任务 → ConfirmDialog 二次确认 → TaskService.deleteTask
   *     - 成功 → Alert "已删除" + router.back()
   *     - 失败 → Alert "删除失败" + mapDeleteFailureReason 翻译
   */
  const handleDelete = useCallback((): void => {
    if (!task) return;

    // 模板任务分支:不调 deleteTask(避免走 template_not_supported 失败路径),
    // 直接提示用户(整系列级联留 T-US004-1)
    if (task.template_id !== null) {
      Alert.alert(TEMPLATE_DELETE_BLOCKED_TITLE, TEMPLATE_DELETE_BLOCKED_MESSAGE);
      return;
    }

    // 一次性任务:RN Alert 二次确认
    showConfirmDialog({
      title: DELETE_DIALOG_TITLE,
      message: `${DELETE_DIALOG_MESSAGE_PREFIX}${task.title}${DELETE_DIALOG_MESSAGE_SUFFIX}`,
      confirmLabel: DELETE_DIALOG_CONFIRM_LABEL,
      cancelLabel: DELETE_DIALOG_CANCEL_LABEL,
      destructive: true,
      onCancel: () => {
        // 用户按"取消" — 静默关闭,无额外反馈
      },
      onConfirm: async () => {
        const result = await TaskService.deleteTask(task.id);
        if (result.status === 'deleted') {
          Alert.alert(DELETE_DELETED_TITLE, undefined, [
            { text: DELETE_DELETED_OK_LABEL, onPress: () => router.back() },
          ]);
        } else {
          Alert.alert(DELETE_FAILED_TITLE, mapDeleteFailureReason(result.reason));
        }
      },
    });
  }, [task, router]);

  // -------------------------------------------------------------------------
  // Render:loading
  // -------------------------------------------------------------------------

  if (!familyValue || (taskId && !task)) {
    return (
      <SafeAreaView style={styles.container}>
        <YStack flex={1} alignItems="center" justifyContent="center">
          <ActivityIndicator size="large" color={COLOR_PRIMARY} />
        </YStack>
      </SafeAreaView>
    );
  }

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
        </YStack>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const assigneeLabel = getAssigneeLabel(task, familyValue);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
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
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel="返回"
            testID="header-back"
          >
            ← 返回
          </Text>
          <Text
            fontSize="$title"
            fontFamily="$heading"
            fontWeight="semibold"
            color={COLOR_TEXT_PRIMARY}
          >
            {HEADER_TITLE}
          </Text>
          <MoreMenu
            isOwner={isOwner}
            onEdit={handleEdit}
            onCopyAsNew={handleCopyAsNew}
            onDelete={handleDelete}
          />
        </XStack>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          {/* TaskHero */}
          <TaskHero task={task} badgeLabel={badge?.label ?? ''} />

          {/* 备注(如有) */}
          {task.description ? (
            <InfoSection
              icon={<Note size={20} color={COLOR_TEXT_SECONDARY} weight="regular" />}
              label={SECTION_DESCRIPTION_LABEL}
              value={task.description}
              testID="section-description"
            />
          ) : null}

          {/* 指派人 */}
          <InfoSection
            icon={<UserIcon size={20} color={COLOR_TEXT_SECONDARY} weight="regular" />}
            label={SECTION_ASSIGNEE_LABEL}
            value={assigneeLabel}
            testID="section-assignee"
          />

          {/* 打卡历史(留 T-US005 — 占位) */}
          <InfoSection
            icon={<Clock size={20} color={COLOR_TEXT_SECONDARY} weight="regular" />}
            label={SECTION_HISTORY_LABEL}
            value={HISTORY_PLACEHOLDER}
            muted
            testID="section-history"
          />

          {/* 主操作区(T-US005-1:CheckInButton 替换原 placeholder)— 4 状态视觉由 CheckInButton 派生 */}
          <YStack
            marginTop="$lg"
            padding="$md"
            borderRadius={12}
            borderColor={COLOR_BORDER}
            borderWidth={1}
            backgroundColor={COLOR_SURFACE}
            accessibilityRole="summary"
            testID="checkin-area"
          >
            <XStack alignItems="center" justifyContent="center">
              <CheckInButton
                task={task}
                currentUserId={currentUserId}
                today={today}
                onCheckIn={handleCheckIn}
                // T-US005-3:撤销入口
                onUndo={handleTaskUndo}
              />
            </XStack>
          </YStack>
        </ScrollView>
      </YStack>
    </SafeAreaView>
  );
}

// =====================================================================
// Sub-components
// =====================================================================

interface TaskHeroProps {
  task: Task;
  badgeLabel: string;
}

/**
 * 标题 + 时间 + 状态 badge — task-detail §3.1 顶部 card。
 */
function TaskHero({ task, badgeLabel }: TaskHeroProps): React.JSX.Element {
  const timeLabel = formatTaskTime(task.task_time);
  const isCancelled = task.cancelled;
  const isCompleted = task.completed_at != null;

  return (
    <YStack
      padding="$md"
      borderRadius={14}
      borderColor={COLOR_BORDER}
      borderWidth={1}
      backgroundColor={COLOR_SURFACE}
      opacity={isCancelled ? 0.4 : isCompleted ? 0.55 : 1}
      accessibilityRole="summary"
      testID="task-hero"
    >
      <Text
        fontSize={22}
        fontFamily="$heading"
        fontWeight="semibold"
        color={COLOR_TEXT_PRIMARY}
        textDecorationLine={isCompleted || isCancelled ? 'line-through' : 'none'}
        accessibilityRole="header"
        testID="task-hero-title"
      >
        {task.title}
      </Text>
      <XStack gap="$sm" alignItems="center" marginTop="$xs">
        <Text fontSize={15} color={COLOR_TEXT_SECONDARY}>
          {timeLabel}
        </Text>
        {badgeLabel ? (
          <View
            style={[
              styles.badgeChip,
              { backgroundColor: COLOR_CHIP_BG, borderColor: COLOR_BORDER },
            ]}
          >
            <Text style={{ fontSize: 12, color: COLOR_TEXT_SECONDARY }}>
              {badgeLabel}
            </Text>
          </View>
        ) : null}
      </XStack>
    </YStack>
  );
}

interface InfoSectionProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  /** value 是占位文字 / 非重点内容时,降低对比度 */
  muted?: boolean;
  testID?: string;
}

/**
 * 通用分组:icon + label + value。
 *
 * 任务 brief §C.2:指派人 / 备注 / 打卡历史 都用同一 layout(label 上,value 下)。
 */
function InfoSection({
  icon,
  label,
  value,
  muted,
  testID,
}: InfoSectionProps): React.JSX.Element {
  return (
    <YStack
      marginTop="$md"
      paddingTop="$md"
      borderTopWidth={1}
      borderTopColor={COLOR_BORDER}
      accessibilityRole="summary"
      testID={testID}
    >
      <XStack gap="$xs" alignItems="center" marginBottom="$xs">
        {icon}
        <Text
          fontSize={13}
          color={COLOR_TEXT_SECONDARY}
          fontFamily="$heading"
        >
          {label}
        </Text>
      </XStack>
      <Text
        fontSize={15}
        color={muted ? COLOR_TEXT_SECONDARY : COLOR_TEXT_PRIMARY}
      >
        {value}
      </Text>
    </YStack>
  );
}

interface MoreMenuProps {
  isOwner: boolean;
  onEdit: () => void;
  onCopyAsNew: () => void;
  onDelete: () => void;
}

/**
 * 右上角 ⋮ 菜单 — 简化实现:Pressable + 三行 inline(本期不接 Tamagui Popover,
 * 因为任务 brief §C.2 明确说"⋮ menu 设计 §3.4 + §6",但更细的 dropdown 留后续 polish)。
 *
 * 行为:
 *   - 第一次按 → 显示 menu(inline,绝对定位)
 *   - 第二次按 → 收起
 *   - 按菜单项 → 调 callback + 收起
 *   - 按 menu 外面 → 收起
 */
function MoreMenu({
  isOwner,
  onEdit,
  onCopyAsNew,
  onDelete,
}: MoreMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  return (
    <View>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={MORE_MENU_LABEL}
        testID="more-menu-button"
        style={styles.menuTrigger}
      >
        <DotsThreeVertical size={24} color={COLOR_TEXT_PRIMARY} weight="bold" />
      </Pressable>

      {open ? (
        <>
          {/* dismiss layer — 全屏透明 Pressable,捕获外部点击 */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="关闭菜单"
            testID="more-menu-dismiss"
          />
          <YStack
            position="absolute"
            top={36}
            right={0}
            backgroundColor={COLOR_SURFACE}
            borderRadius={10}
            borderColor={COLOR_BORDER}
            borderWidth={1}
            padding="$xs"
            gap="$xs"
            shadowColor="#000"
            shadowOffset={{ width: 0, height: 2 }}
            shadowOpacity={0.1}
            shadowRadius={4}
            elevation={4}
            zIndex={10}
            testID="more-menu-popover"
          >
            <MenuItem
              label={MENU_COPY_AS_NEW}
              onPress={() => {
                close();
                onCopyAsNew();
              }}
              testID="menu-copy"
            />
            {isOwner ? (
              <MenuItem
                label={MENU_EDIT}
                onPress={() => {
                  close();
                  onEdit();
                }}
                testID="menu-edit"
              />
            ) : null}
            {isOwner ? (
              <MenuItem
                label={MENU_DELETE}
                onPress={() => {
                  close();
                  onDelete();
                }}
                destructive
                testID="menu-delete"
              />
            ) : null}
          </YStack>
        </>
      ) : null}
    </View>
  );
}

interface MenuItemProps {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  testID?: string;
}

function MenuItem({ label, onPress, destructive, testID }: MenuItemProps): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [
        styles.menuItem,
        pressed ? styles.menuItemPressed : null,
      ]}
    >
      <Text
        fontSize="$body"
        color={destructive ? COLOR_WARNING : COLOR_TEXT_PRIMARY}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// =====================================================================
// Helpers
// =====================================================================

/**
 * 把 task.assignee_id 翻译成 "我" / "配偶"(沿用 HomeScreen 的简化规则)。
 *
 * 为什么不复用 createTaskForm.memberLabel — 这里拿不到 user_id(只有 family members
 * 的 user_id);且 createTaskForm.memberLabel 用 member.user_id + 当前 user +
 * familyCreatedBy 三参比较,这里逻辑相同 — 但放到本文件避免再 cross-import。
 */
function getAssigneeLabel(
  task: Task,
  familyValue: NonNullable<ReturnType<typeof useFamilyValue>>,
): string {
  const createdBy = familyValue.family.created_by;
  if (task.assignee_id === createdBy) return '我';
  return '配偶';
}

// =====================================================================
// Styles
// =====================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLOR_BG,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 48,
  },
  badgeChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  menuTrigger: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  menuItem: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    minWidth: 140,
  },
  menuItemPressed: {
    backgroundColor: COLOR_CHIP_BG,
  },
});