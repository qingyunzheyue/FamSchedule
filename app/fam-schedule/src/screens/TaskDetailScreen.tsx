/**
 * TaskDetailScreen — 任务详情页 — T-US003-1
 *
 * 职责(US-002 故事 2/3 — 端到端查看单个任务):
 *   1. 从 URL `?id=<taskId>` 读 taskId
 *   2. 从 useTasks() 找该 task(找不到 → "任务不存在" + 自动 back)
 *   3. 渲染 task-detail-v1.0.md §3.1 布局的**简化版**:
 *      - Header:← 返回 + 标题"任务详情" + 右上角 ⋮ 菜单
 *      - TaskHero:title + 时间行 + 主按钮区(占位 — 留 T-US005)
 *      - 备注(如有)
 *      - 指派人
 *      - **省略**:共同执行人 / 共享设置 / 周期(留 T-US009 / T-US010 / T-US004-1)
 *      - 打卡历史(占位 — 留 T-US005)
 *   4. ⋮ 菜单(任务 brief §A / §C.2):
 *      - 所有人可见:`复制为新任务` → Alert "即将推出"(留后续)
 *      - 创建者可见:`编辑` → router.push('/(main)/(home)/task-edit?id=...')
 *      - 创建者可见:`删除` → Alert "删除功能等 T-US003-2"(占位)
 *
 * 设计依据:
 *   - 任务 detail-v1.0.md §3.1 / §3.4 / §6 文案 / §7 a11y
 *   - 任务 brief §C.2:简化版 — 留 T-US005 / T-US003-2 / T-US009 / T-US010 / T-US014
 *
 * 简化决策(明确记录 — dev self-acknowledge scope):
 *   - ❌ 不做打卡 button(留 T-US005)— 显示静态 placeholder "✓ 打卡(暂未启用)"
 *   - ❌ 不做撤销 button(留 T-US005)
 *   - ❌ 不做过期 banner(留 T-US014)
 *   - ❌ 不做确认 Dialog(留 T-US003-2)
 *   - ✅ ⋮ 菜单的"编辑"跳页 + "复制为新任务" / "删除"占位 Alert
 *
 * a11y(任务 detail-v1.0 §7):
 *   - 任务标题 `accessibilityRole="header"`
 *   - 各分组 `accessibilityRole="summary"`
 *   - ⋮ 按钮 `accessibilityRole="button"` label "更多操作"
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
  CheckCircle,
  Clock,
  DotsThreeVertical,
  Note,
  User as UserIcon,
} from 'phosphor-react-native';

import { useFamilyValue } from '../contexts/FamilyContext';
import { useTasks } from '../hooks/useTasks';
import { formatTaskTime, computeTaskBadge } from '../lib/taskListFilters';
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
const DELETE_PLACEHOLDER = '删除功能等 T-US003-2 接入';

const SECTION_DESCRIPTION_LABEL = '备注';
const SECTION_ASSIGNEE_LABEL = '指派人';
const SECTION_HISTORY_LABEL = '打卡历史';
const HISTORY_PLACEHOLDER = '打卡历史等 T-US005 接入';

const CHECKIN_PLACEHOLDER = '✓ 打卡(暂未启用)';
const COMPLETED_PLACEHOLDER = '✓ 已完成';

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
const COLOR_SUCCESS = '#5C9D7E';

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
  const tasks = useTasks();

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

  const isOwner = !!task && !!familyValue && task.created_by === familyValue.family.created_by;
  const isCompleted = task?.completed_at != null;
  const isCancelled = task?.cancelled === true;

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

  const handleDelete = useCallback((): void => {
    Alert.alert('即将推出', DELETE_PLACEHOLDER);
  }, []);

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

          {/* 主操作区(留 T-US005 — 占位) */}
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
            {isCancelled ? (
              <Text
                fontSize="$body"
                color={COLOR_TEXT_SECONDARY}
                textAlign="center"
              >
                已取消
              </Text>
            ) : isCompleted ? (
              <XStack alignItems="center" justifyContent="center" gap="$sm">
                <CheckCircle size={20} color={COLOR_SUCCESS} weight="fill" />
                <Text fontSize="$body" color={COLOR_SUCCESS} fontWeight="semibold">
                  {COMPLETED_PLACEHOLDER}
                </Text>
              </XStack>
            ) : (
              <Text
                fontSize="$body"
                color={COLOR_WARNING}
                textAlign="center"
              >
                {CHECKIN_PLACEHOLDER}
              </Text>
            )}
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