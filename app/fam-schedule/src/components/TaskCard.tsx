/**
 * TaskCard — 任务卡片(C-01) — T-US002-1
 *
 * 职责(US-002 §3.5):
 *   - 左侧时间(formatTaskTime 输出:'HH:MM' 或 '全天')
 *   - 中间 title(最多 1 行省略)
 *   - 右侧 TaskBadge chip(根据 computeTaskBadge.kind 上色)
 *   - Meta 行:指派人(留 T-US009 不显示共同执行人;留 T-US004-1 不显示周期;
 *     留 T-US010 不显示共享 — 本任务范围)
 *
 * 状态变体(设计 §3.5):
 *   - completed:整卡 opacity 0.55, title 加删除线
 *   - cancelled:整卡 opacity 0.4, title 删除线
 *   - overdue:左侧 4px 红竖条 + bg 浅 warning
 *   - 其他:默认 surface 背景
 *
 * 交互:
 *   - 整卡可点击 → 路由 task/[id](T-US003 详情未做,路由 wrapper 已有占位)
 *
 * a11y(设计 §7):
 *   - 整卡 accessibilityRole="button"
 *   - label 综合 title/时间/指派人/状态
 *
 * 不在本组件范围:
 *   - 打卡按钮(C-02)— 留 T-US005
 *   - 详情/编辑/删除(T-US003)
 *   - 周期 / 共同执行人 / 共享 meta(T-US004-1 / T-US009 / T-US010)
 */

import { memo } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { useRouter } from 'expo-router';

import type { Task } from '../lib/LocalStore';
import { computeTaskBadge, formatTaskTime, type TaskBadge } from '../lib/taskListFilters';

// =====================================================================
// Constants — 与 CreateTaskScreen 颜色系统对齐
// =====================================================================

const COLOR_PRIMARY = '#DC5A24'; // 赤陶
const COLOR_SURFACE = '#FFFFFF'; // 卡片背景(亮 surface)
const COLOR_BG = '#F4ECDC'; // 亚麻容器背景(与 CreateTaskScreen container 一致)
const COLOR_BORDER = '#E8DFD0'; // 亚麻描边
const COLOR_TEXT_PRIMARY = '#3A2E20';
const COLOR_TEXT_SECONDARY = '#7A6B57';
const COLOR_WARNING = '#C95444';
const COLOR_WARNING_BG = '#FBEAE6';
const COLOR_SUCCESS = '#5C9D7E';
const COLOR_BADGE_BG_NEUTRAL = '#FFF9F0';

// =====================================================================
// Sub-components — TaskBadgeChip
// =====================================================================

interface TaskBadgeChipProps {
  badge: TaskBadge;
}

/**
 * Badge chip —— 根据 kind 上色。
 *
 * - completed / cancelled:中性灰(状态已完成,无需警示色)
 * - overdue:红(警示)
 * - today:赤陶(强调今天)
 * - tomorrow:亚麻描边(温和提示)
 * - weekday / date:亚麻描边(普通日期)
 */
function TaskBadgeChip({ badge }: TaskBadgeChipProps): React.JSX.Element {
  const { bg, fg, border } = (() => {
    switch (badge.kind) {
      case 'overdue':
        return { bg: '#FBEAE6', fg: COLOR_WARNING, border: COLOR_WARNING };
      case 'today':
        return { bg: COLOR_PRIMARY, fg: '#FFFFFF', border: COLOR_PRIMARY };
      case 'completed':
        return { bg: COLOR_BADGE_BG_NEUTRAL, fg: COLOR_SUCCESS, border: COLOR_BORDER };
      case 'cancelled':
        return { bg: COLOR_BADGE_BG_NEUTRAL, fg: COLOR_TEXT_SECONDARY, border: COLOR_BORDER };
      case 'tomorrow':
      case 'weekday':
      case 'date':
        return { bg: COLOR_BADGE_BG_NEUTRAL, fg: COLOR_TEXT_SECONDARY, border: COLOR_BORDER };
    }
  })();

  return (
    <View
      style={[styles.badgeChip, { backgroundColor: bg, borderColor: border }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Text style={[styles.badgeLabel, { color: fg }]} numberOfLines={1}>
        {badge.label}
      </Text>
    </View>
  );
}

// =====================================================================
// Component
// =====================================================================

export interface TaskCardProps {
  task: Task;
  assigneeLabel: '我' | '配偶';
  badge: TaskBadge;
}

/**
 * 单条任务卡片。
 *
 * - 受父组件传入 badge(在 HomeScreen 列表渲染时统一算,避免每张卡重复算)
 * - onPress → router.push(`/(main)/(home)/task/${task.id}`)(T-US003 详情页占位)
 * - 视觉变体由 badge.kind 派生(completed/cancelled/overdue 三态)
 */
function TaskCardImpl({ task, assigneeLabel, badge }: TaskCardProps): React.JSX.Element {
  const router = useRouter();

  // 视觉变体派生
  const isCompleted = badge.kind === 'completed';
  const isCancelled = badge.kind === 'cancelled';
  const isOverdue = badge.kind === 'overdue';

  // 整卡 opacity
  let cardOpacity = 1;
  if (isCompleted) cardOpacity = 0.55;
  else if (isCancelled) cardOpacity = 0.4;

  // 整卡背景:overdue 用 warning 浅底,其他 surface 白
  const cardBg = isOverdue ? COLOR_WARNING_BG : COLOR_SURFACE;

  const handlePress = (): void => {
    // T-US002-1 范围:跳详情页路由(wrapper 占位显示 task id,无副作用)
    // T-US003 详情页接入后再加业务逻辑
    router.push({
      pathname: '/(main)/(home)/task/[id]',
      params: { id: task.id },
    });
  };

  // a11y label — 综合 title / 时间 / 指派人 / 状态
  const a11yLabel = [
    task.title,
    formatTaskTime(task.task_time),
    `指派给${assigneeLabel}`,
    badge.label,
  ].join(',');

  return (
    <View
      style={[styles.card, { opacity: cardOpacity, backgroundColor: cardBg }]}
      onTouchEnd={handlePress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      testID={`task-card-${task.id}`}
    >
      {/* 左侧时间 */}
      <View style={styles.timeColumn}>
        <Text style={styles.timeText} numberOfLines={1}>
          {formatTaskTime(task.task_time)}
        </Text>
      </View>

      {/* 中间 title + meta 行 */}
      <View style={styles.middleColumn}>
        <Text
          style={[
            styles.title,
            isCompleted || isCancelled ? styles.titleStrikethrough : null,
          ]}
          numberOfLines={1}
        >
          {task.title}
        </Text>
        <Text style={styles.metaText} numberOfLines={1}>
          {`指派给 ${assigneeLabel}`}
        </Text>
      </View>

      {/* 右侧 badge */}
      <View style={styles.badgeColumn}>
        <TaskBadgeChip badge={badge} />
      </View>

      {/* 过期:左侧 4px 红竖条(absolute,贴在 card 左缘) */}
      {isOverdue ? <View style={styles.overdueBar} /> : null}
    </View>
  );
}

/**
 * memo 包一层:同 task + 同 badge 引用不变时不重渲染。
 * 但 React.memo 默认浅比较 props —— badge 是 plain object,filterTasks
 * 输出新数组时 React 默认会让所有 card 重渲。这里靠 React 的 batch + 浅比较,
 * 大列表下若性能问题再加 custom comparator(后续 T-US002-2)。
 */
export const TaskCard = memo(TaskCardImpl);

// =====================================================================
// Styles
// =====================================================================

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
    // 软阴影(elevation 1)
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    // 卡片在 bg = #F4ECDC 容器里,留 marginHorizontal 让左右有边距
    marginHorizontal: 16,
    position: 'relative',
    overflow: 'hidden',
  },
  timeColumn: {
    width: 60,
    alignItems: 'flex-start',
  },
  timeText: {
    fontSize: 15,
    fontWeight: '500',
    color: COLOR_TEXT_PRIMARY,
  },
  middleColumn: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '500',
    color: COLOR_TEXT_PRIMARY,
  },
  titleStrikethrough: {
    textDecorationLine: 'line-through',
  },
  metaText: {
    fontSize: 13,
    color: COLOR_TEXT_SECONDARY,
    marginTop: 4,
  },
  badgeColumn: {
    alignItems: 'flex-end',
  },
  badgeChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  overdueBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: COLOR_WARNING,
  },
});

// 重新导出容器背景色,供 HomeScreen 配套使用
export const TASK_CARD_BG = COLOR_BG;
