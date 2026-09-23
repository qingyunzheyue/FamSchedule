/**
 * TaskList — 任务列表容器 — T-US002-1 + T-US003-1 + T-US003-2
 *
 * 职责(US-002 §3.1 + §3.6):
 *   - FlatList 渲染 TaskCard 列表
 *   - 列表为空时显示 EmptyState(view-specific 文案 + 主按钮"创建任务")
 *   - 支持下拉刷新(refreshing + onRefresh)
 *
 * 设计依据:
 *   - home-v1.0.md §3.5 / §3.6 / §7
 *   - 任务 brief:本任务**不**做 SkeletonCard(显示空状态 + 简单 spinner),
 *     **不**做 OfflineBanner
 *
 * 数据流:
 *   - `tasks` 已由父(HomeScreen)用 filterTasks 筛选 + 排序
 *   - `assigneeLabels` 是 user.id → '我' / '配偶' 映射,父组件从 useFamilyValue() 派生
 *   - 每行 task.id → 查 assigneeLabels,拿到 label
 *   - 每行 computeTaskBadge(task, today)在父组件批量算 + 通过 prop 传入(本组件无 today 概念)
 *   - T-US003-1:onTaskPress 真正传给 TaskCard(之前是 dead prop)— TaskCard 不再内部
 *     useRouter,改为纯展示 + 触发回调;HomeScreen 实现具体 navigation
 *   - T-US003-2:onTaskLongPress 透传给 TaskCard(可选 prop)— HomeScreen 实现具体删除行为
 *
 * 简化决策:
 *   - EmptyState 不做插画(☕)— brief 明确说"EmptyState: 文字 + 创建按钮(无插画)"
 *   - ListEmptyComponent + ListFooterComponent 都用同一个空态(footer 留扩展空间)
 */

import { useMemo } from 'react';
import { FlatList, StyleSheet, View, Text, RefreshControl } from 'react-native';
import { Button } from 'tamagui';
import { Plus } from 'phosphor-react-native';

import type { Task } from '../lib/LocalStore';
import { TaskCard } from './TaskCard';
import { computeTaskBadge, type ViewMode } from '../lib/taskListFilters';

// =====================================================================
// Constants
// =====================================================================

const COLOR_PRIMARY = '#DC5A24';
const COLOR_TEXT_PRIMARY = '#3A2E20';
const COLOR_TEXT_SECONDARY = '#7A6B57';
const COLOR_SURFACE = '#FFFFFF';
const COLOR_BG = '#F4ECDC';

const EMPTY_COPY: Readonly<Record<ViewMode, { title: string; sub: string }>> = {
  today: { title: '今天没有任务', sub: '享受一下空闲 ☀️' },
  week: { title: '本周还没有任务', sub: '这周可以轻松一点' },
  all: { title: '还没有任何任务', sub: '创建第一个吧' },
};

// =====================================================================
// Sub-component — EmptyState
// =====================================================================

interface EmptyStateProps {
  view: ViewMode;
  onCreatePress: () => void;
}

function EmptyState({ view, onCreatePress }: EmptyStateProps): React.JSX.Element {
  const copy = EMPTY_COPY[view];
  return (
    <View
      style={styles.emptyContainer}
      accessibilityRole="text"
      testID="task-list-empty"
    >
      <Text style={styles.emptyTitle}>{copy.title}</Text>
      <Text style={styles.emptySub}>{copy.sub}</Text>
      <Button
        theme="active"
        size="$md"
        marginTop="$lg"
        icon={<Plus size={20} color="#FFFFFF" weight="bold" />}
        onPress={onCreatePress}
        accessibilityLabel="创建任务"
        testID="empty-create-button"
      >
        创建任务
      </Button>
    </View>
  );
}

// =====================================================================
// Component
// =====================================================================

export interface TaskListProps {
  tasks: Task[];
  assigneeLabels: Record<string, '我' | '配偶'>;
  today: string;
  view: ViewMode;
  refreshing: boolean;
  onRefresh: () => void;
  onTaskPress: (task: Task) => void;
  /**
   * T-US003-2 新增:长按回调(列表 long-press 删除入口)。
   * 父层(HomeScreen)实现具体行为 — 简化版直接删除 + Alert 已删除。
   * 可选 prop(不传则 TaskCard 不响应 long-press)。
   */
  onTaskLongPress?: (task: Task) => void;
  /**
   * **T-US005-1 新增**:打卡回调(传给 TaskCard.CheckInButton)— 由消费方
   * (HomeScreen)调 CheckInService.checkin。响应后 UI 通过 Realtime 自然刷新。
   * 可选 prop(不传则 TaskCard 不渲染 CheckInButton,fallback 到旧 badge 列)。
   */
  onTaskCheckIn?: (task: Task) => void | Promise<void>;
  /** T-US005-1 新增:用于判定 CheckInButton 状态 — 由 HomeScreen 注入。 */
  currentUserId?: string;
  onCreatePress: () => void;
}

/**
 * 任务列表容器 —— FlatList + EmptyState + 下拉刷新。
 *
 * - 卡片间距:TaskCard 内部已有 marginBottom:12,这里不再加 gap
 * - paddingBottom:100 —— 给底部 TabBar(主 tab 高约 49-83px)+ FAB 留空间
 * - 下拉刷新 RefreshControl.tintColor = 赤陶(设计 §3.7)
 *
 * T-US003-1:onTaskPress 真正传给 TaskCard(之前是 dead prop)— TaskCard 不再内部
 * useRouter,改为纯展示 + 触发回调。HomeScreen 在 handleTaskPress 里实现跳详情。
 *
 * T-US003-2:onTaskLongPress 透传给 TaskCard(可选 prop)— HomeScreen 实现具体删除行为。
 *
 * T-US005-1:onTaskCheckIn 透传给 TaskCard → CheckInButton;currentUserId 透传供
 * CheckInButton 派生 me / spouse 身份。
 */
export function TaskList({
  tasks,
  assigneeLabels,
  today,
  view,
  refreshing,
  onRefresh,
  onTaskPress,
  onTaskLongPress,
  onTaskCheckIn,
  currentUserId = '',
  onCreatePress,
}: TaskListProps): React.JSX.Element {
  // 每行 badge 预计算,避免 render 期间重复调用
  const rows = useMemo(
    () =>
      tasks.map((t) => ({
        task: t,
        assigneeLabel: assigneeLabels[t.assignee_id] ?? '配偶',
        badge: computeTaskBadge(t, today),
      })),
    [tasks, assigneeLabels, today],
  );

  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.task.id}
      contentContainerStyle={styles.listContent}
      renderItem={({ item }) => (
        <TaskCard
          task={item.task}
          assigneeLabel={item.assigneeLabel}
          badge={item.badge}
          onPress={onTaskPress}
          onLongPress={onTaskLongPress}
          onCheckIn={onTaskCheckIn}
          currentUserId={currentUserId}
          today={today}
        />
      )}
      ListEmptyComponent={
        <EmptyState view={view} onCreatePress={onCreatePress} />
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={COLOR_PRIMARY}
          colors={[COLOR_PRIMARY]}
          progressBackgroundColor={COLOR_SURFACE}
        />
      }
      // 性能参数:2 人家庭典型任务量 < 100,简单配置即可
      initialNumToRender={10}
      windowSize={10}
      removeClippedSubviews
    />
  );
}

// =====================================================================
// Styles
// =====================================================================

const styles = StyleSheet.create({
  listContent: {
    paddingTop: 12,
    paddingBottom: 100, // 给底部 TabBar + FAB 留空间
    flexGrow: 1, // 让空状态能 flex:1 撑开居中
    backgroundColor: COLOR_BG,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLOR_TEXT_PRIMARY,
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 14,
    color: COLOR_TEXT_SECONDARY,
  },
});
