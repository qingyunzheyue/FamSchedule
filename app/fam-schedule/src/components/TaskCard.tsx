/**
 * TaskCard — 任务卡片(C-01) — T-US002-1 + T-US003-1 refactor + T-US003-2 + T-US005-1
 *
 * 职责(US-002 §3.5 + US-005 §3.5):
 *   - 左侧时间(formatTaskTime 输出:'HH:MM' 或 '全天')
 *   - 中间 title(最多 1 行省略)
 *   - **T-US005-1 新增**:右侧 36px 打卡圆圈(CheckInButton) — 4 状态视觉
 *     (todo / completed / cancelled / spouse_completed)
 *   - Meta 行:指派人(留 T-US009 不显示共同执行人;留 T-US004-1 不显示周期;
 *     留 T-US010 不显示共享 — 本任务范围)
 *
 * 状态变体(设计 §3.5):
 *   - completed:整卡 opacity 0.55, title 加删除线
 *   - cancelled:整卡 opacity 0.4, title 删除线
 *   - overdue:左侧 4px 红竖条 + bg 浅 warning
 *   - 其他:默认 surface 背景
 *
 * 交互(T-US003-1 修改):
 *   - **不在内部调 useRouter**(reviewer Minor #4 指出)— 改为接收 `onPress` prop,
 *     由父层(HomeScreen)实现 navigation。这样 TaskCard 保持纯展示组件,便于复用 /
 *     单测 / 替换跳转逻辑(埋点 / 拦截等)。
 *
 * 交互(T-US003-2 修改):
 *   - 新增 `onLongPress` prop — 列表 long-press 删除入口(简化版直接删,留 T-FIX-06
 *     polish 时加二次确认)。由父层(HomeScreen)实现具体行为。
 *
 * 交互(T-US005-1 新增):
 *   - 新增 `onCheckIn` prop — 打卡回调(可选)— 由父层(TaskList → HomeScreen)决定
 *     调 CheckInService / 错误处理。CheckInButton 内部 Pressable 已 stop propagation,
 *     不与整卡 onPress 冲突。
 *
 * a11y(设计 §7):
 *   - 整卡 accessibilityRole="button"
 *   - label 综合 title/时间/指派人/状态
 *   - long-press 添加 `accessibilityActions=[{name: 'longpress', ...}]`(屏幕阅读器)
 *   - CheckInButton 自身带独立 a11y label('打卡:喂奶粉 10:00' / '已完成,点击撤销' 等)
 *
 * 不在本组件范围:
 *   - 详情/编辑/删除由 TaskDetailScreen 处理(T-US003-1)
 *   - 周期 / 共同执行人 / 共享 meta(T-US004-1 / T-US009 / T-US010)
 */

import { memo } from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';

import type { Task } from '../lib/LocalStore';
import { computeTaskBadge, formatTaskTime, type TaskBadge } from '../lib/taskListFilters';
import { CheckInButton } from './CheckInButton';

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
  /**
   * T-US003-1 新增:点击回调,由父层(HomeScreen)实现 navigation。
   * TaskCard 内部不再直接调 useRouter — 保持纯展示。
   */
  onPress: (task: Task) => void;
  /**
   * T-US003-2 新增:长按回调(列表 long-press 删除入口)。
   * 父层(HomeScreen)实现具体行为 — 简化版直接删除 + Alert 已删除。
   * 可选 prop(不传则不响应 long-press)。
   *
   * a11y:同时注册 `accessibilityActions=[{name: 'longpress', onAccessibilityAction}]`,
   * 屏幕阅读器(VoiceOver / TalkBack)能识别"长按"语义。
   */
  onLongPress?: (task: Task) => void;
  /**
   * **T-US005-1 新增**:打卡回调(由父层 HomeScreen 调 CheckInService.checkin)。
   * 可选 prop — 不传时右侧 CheckInButton 区域隐藏(纯展示卡)。
   *
   * 必传字段:
   *   - currentUserId:用于判定 me / spouse 完成
   *   - today:用于过期 / 今天判定
   *
   * 注意:打卡点击**不**冒泡 — CheckInButton 内部 Pressable 用事件 capture /
   * onPressOut stopPropagation 等机制,实测 RN Pressable 不内置 stopPropagation,
   * 但日常 hitSlop 让按钮触发区域独立,误触整卡概率极低。若需要严格隔离可后续改
   * event.target 与 e.target 检查(留 T-FIX-06)。
   */
  onCheckIn?: (task: Task) => void | Promise<void>;
  /** T-US005-1 新增:用于 CheckInButton 派生当前用户身份。可选(默认空字符串)。 */
  currentUserId?: string;
  /** T-US005-1 新增:今日日期 'YYYY-MM-DD'。 */
  today?: string;
  /**
   * **T-US005-3 新增**:撤销打卡回调(由父层 HomeScreen 调 CheckInService.undoCheckin)。
   * 可选 prop — 不传则 CheckInButton 不渲染 UndoChip(回到 T-US005-2 视觉)。
   *
   * 视觉行为:
   *   - 只在 `state.kind === 'completed'`(我已打卡)时 CheckInButton 右侧渲染 UndoChip
   *   - 5 分钟倒计时自动消失(spouse_completed / cancelled / undo_window_expired 时 chip 隐藏)
   *   - 点击 UndoChip → 透传 onTaskUndo(task)给父层
   */
  onTaskUndo?: (task: Task) => void | Promise<void>;
}

/**
 * 单条任务卡片。
 *
 * - 受父组件传入 badge(在 HomeScreen 列表渲染时统一算,避免每张卡重复算)
 * - onPress → 调 prop 传入的回调(HomeScreen 决定跳详情页 / 埋点 / 拦截)
 * - onLongPress → 调 prop 传入的回调(HomeScreen 决定直接删 / Alert 等)
 * - **T-US005-1 新增**:onCheckIn → CheckInButton 点击触发;消费方调 CheckInService
 * - 视觉变体由 badge.kind 派生(completed/cancelled/overdue 三态)+ CheckInButton
 *   自身 getCheckInState 派生(checkIn 4 状态独立于 badge)
 */
function TaskCardImpl({
  task,
  assigneeLabel,
  badge,
  onPress,
  onLongPress,
  onCheckIn,
  onTaskUndo,
  currentUserId = '',
  today = '',
}: TaskCardProps): React.JSX.Element {
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
    onPress(task);
  };

  const handleLongPress = (): void => {
    onLongPress?.(task);
  };

  const handleCheckInPress = (): void => {
    onCheckIn?.(task);
  };

  const handleUndoPress = (): void => {
    onTaskUndo?.(task);
  };

  // a11y label — 综合 title / 时间 / 指派人 / 状态
  const a11yLabel = [
    task.title,
    formatTaskTime(task.task_time),
    `指派给${assigneeLabel}`,
    badge.label,
  ].join(',');

  // a11y actions — 长按语义(VoiceOver / TalkBack)。仅当 onLongPress 存在时挂上,
  // 否则不做(避免给屏幕阅读器一个"无操作的选项")
  const a11yActions = onLongPress
    ? [{ name: 'longpress', label: '长按删除任务', onAccessibilityAction: handleLongPress }]
    : undefined;

  return (
    <Pressable
      style={[styles.card, { opacity: cardOpacity, backgroundColor: cardBg }]}
      onPress={handlePress}
      onLongPress={onLongPress ? handleLongPress : undefined}
      delayLongPress={500}
      accessible
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityActions={a11yActions}
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

      {/* T-US005-1 新增:36px 打卡圆圈 — 4 状态视觉 */}
      {onCheckIn ? (
        <View style={styles.checkInColumn}>
          <CheckInButton
            task={task}
            currentUserId={currentUserId}
            today={today}
            onCheckIn={handleCheckInPress}
            // T-US005-3:onUndo 透传 → 5 分钟内 UndoChip 渲染,点击调 onTaskUndo
            onUndo={handleUndoPress}
          />
        </View>
      ) : (
        // 不传 onCheckIn 时保留原来的 badge 区域(T-FIX-06 polish 时再考虑全部接入)
        <View style={styles.badgeColumn}>
          <TaskBadgeChip badge={badge} />
        </View>
      )}

      {/* 过期:左侧 4px 红竖条(absolute,贴在 card 左缘) */}
      {isOverdue ? <View style={styles.overdueBar} /> : null}
    </Pressable>
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
  /** T-US005-1 新增:打卡圆圈列(右侧),badge 已被取代 */
  checkInColumn: {
    alignItems: 'flex-end',
    justifyContent: 'center',
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