/**
 * CheckInButton — 一键打卡按钮 — T-US005-1
 *
 * 职责(US-005 核心组件 — 设计 home-v1.0 §3.5 + task-detail-v1.0 §3.1):
 *   - 36px 圆角全打卡圆圈(右侧 in TaskCard;中央大 in TaskDetailScreen)
 *   - 4 状态视觉:
 *     - 'todo'           : 空心 Circle + 内圈小赤陶点(待打卡)
 *     - 'completed'      : 实心 CheckCircle(fill) + '✓ 已完成 HH:MM'(我已完成)
 *     - 'spouse_completed': 同 completed 但 label '✓ 配偶已完成'(配偶已先完成,本任务不做 undo)
 *     - 'cancelled'      : 灰色 Prohibit(dim) + '已取消'
 *   - 派生从 getCheckInState 纯函数(不依赖内联判定)— 组件本身纯展示
 *   - 点击回调透给 onCheckIn prop(由消费方 HomeScreen / TaskDetailScreen 决定调 Service)
 *
 * 设计依据:
 *   - home-v1.0 §3.5:打卡圆圈 36px,圆角 full,fill 状态 success 色 `#5C9D7E`
 *   - task-detail-v1.0 §3.1:详情页有大号打卡区,简化版也用同款圆圈
 *   - 状态判定完全委派给 src/lib/checkIn.getCheckInState(本组件无业务逻辑)— 单测 + 复用 friendly
 *
 * a11y(任务 design §7):
 *   - 整个圆圈 `accessibilityRole="button"`
 *   - label 综合 title + 状态 + 时间:
 *     - todo: "打卡:喂奶粉 10:00" / "补打卡:喂奶粉 10:00"(过期)
 *     - completed: "已完成 10:05,点击撤销(T-US005-3 后接入)"
 *     - spouse_completed: "配偶已完成,无法撤销"
 *     - cancelled: "任务已取消"
 *   - testID 暴露:`checkin-button-${task.id}`(便于 E2E / 截图测试定位)
 *
 * 交互策略(任务 brief §C 简化):
 *   - canCheckIn(state) 决定 onCheckIn 是否触发:
 *     - true (todo) → onCheckIn(task) 触发,消费方走 CheckInService
 *     - false (其他) → 不调 onCheckIn;改弹 Alert:
 *       - cancelled → '任务已取消'
 *       - completed / spouse_completed → UI 已显示完成态;点击 noop(撤销入口留 T-US005-3)
 *     - Alert 文案对照设计 home-v1.0 §6:打卡失败场景统一引导;本组件只展示
 *       cancelled 这一个静态兜底原因(RN Alert.alert 在组件内部)
 *
 * 不在范围(任务 brief §C 明确"不在范围"列表):
 *   - 撤销打卡入口(T-US005-3)
 *   - 配偶已先完成的 toast(T-US005-2;本任务 spouse_completed 态会显示但不弹 toast)
 *   - 补卡区分(isMakeup=true)— getCheckInState 派生同一 todo 态
 *   - 详细完成时间 tooltip(本任务 placeholder:'HH:MM' 内联字符串)
 *   - NotificationScheduler 联动(留 T-US007)
 */

import { memo, useCallback } from 'react';
import { StyleSheet, View, Text, Pressable, Alert } from 'react-native';
import {
  CheckCircle,
  CircleIcon,
  Prohibit,
} from 'phosphor-react-native';

import { canCheckIn, getCheckInState } from '../lib/checkIn';
import { UndoChip } from './UndoChip';
import type { Task } from '../lib/LocalStore';

// =====================================================================
// 1. Constants(颜色 / 尺寸 与 TaskCard 对齐)
// =====================================================================

/** 36px 圆圈 — 设计 home-v1.0 §3.5 "右侧打卡圆圈 36px,圆角 full" */
export const CHECK_IN_BUTTON_SIZE = 36;

/** fill 态 success 色 — 对齐 TaskCard 完成态 + badge 配色 */
const COLOR_SUCCESS = '#5C9D7E';
/** cancelled 灰色 dim — 设计 home-v1.0 §6 "中性灰" */
const COLOR_MUTED = '#9C8E7B';
/** todo 空心内圈点赤陶色 */
const COLOR_ACCENT = '#DC5A24';
/** 文本主色 */
const COLOR_TEXT_PRIMARY = '#3A2E20';

// =====================================================================
// 2. Alert 文案(集中常量,便于 i18n)
// =====================================================================

const ALERT_CANCELLED_TITLE = '任务已取消';
const ALERT_CANCELLED_MESSAGE = '此任务已取消,无法打卡。';
const ALERT_OK_LABEL = '好';

// =====================================================================
// 3. Props
// =====================================================================

export interface CheckInButtonProps {
  /** 当前 task(必需 — 用作派生输入) */
  task: Task;
  /** 当前登录 user.id(用于 'me' 判定)— 留空字符串 → spouse_completed fallback */
  currentUserId: string;
  /** 今天日期 'YYYY-MM-DD' — 用于过期 / 今天判定 */
  today: string;
  /**
   * 点击回调:消费方(HomeScreen / TaskDetailScreen)拿到 task 后调 CheckInService.checkin。
   *
   * ⚠️ 组件**不**自己调 service — 让消费方决定错误处理(Alert / toast / 路由等)。
   * 这样组件保持纯展示,便于复用 / 单测。
   *
   * 返回 Promise<void>:允许消费方 await(本组件不 await,fire-and-forget)
   * — 但消费方常需要 await 才能 catch Service 错误。
   */
  onCheckIn: (task: Task) => void | Promise<void>;
  /**
   * **T-US005-3 新增**:撤销打卡回调(消费方 HomeScreen / TaskDetailScreen 拿到 task 后调
   * CheckInService.undoCheckin)。**可选** — 不传则右侧不显示 UndoChip(完全回到 T-US005-2
   * 视觉)。
   *
   * - 何时调:用户点击 UndoChip(5 分钟倒计时内)— UndoChip 自行判 canUndo(canUndo=false
   *   即 5 分钟过期 → 不显示 chip → 不存在点击入口)
   * - 与 onCheckIn 走同一 service 模式(组件保持纯展示)— 消费方 await + catch 错误
   *
   * 设计动机:
   *   - 可选 prop 让 CheckInButton 在不传 onUndo 时**视觉与 T-US005-2 完全一致**,
   *     保持低耦合,避免不需要撤销的场景(留 T-US005-4 历史视角时可能单独撤销)
   *   - 5 分钟过期 → UndoChip 自动消失,无需组件再判断
   *   - Reorder:UnodChip 与 Pressable 在视觉上并列(右侧)— CheckInButton 控件外层仍
   *     是一个 Pressable(打卡主圆圈),UndoChip 是嵌套的独立 Pressable,各自响应
   *     自己的 onPress
   */
  onUndo?: (task: Task) => void | Promise<void>;
}

// =====================================================================
// 4. Component
// =====================================================================

/**
 * 一键打卡按钮 —— 4 状态 36px 圆圈。
 *
 * 渲染逻辑:
 *   1. state = getCheckInState(task, currentUserId, today)
 *   2. 根据 state.kind 选视觉:
 *      - 'todo'           : 空心 Circle + 内圈小赤陶点 + (可选)小 label "补打卡"
 *      - 'completed'      : 实心 CheckCircle + label '✓ 已完成 HH:MM'
 *      - 'spouse_completed': 实心 CheckCircle + label '✓ 配偶已完成'
 *      - 'cancelled'      : 灰色 Prohibit + label '已取消'
 *   3. 点击:
 *      - canCheckIn(state) ? → onCheckIn(task)(fire-and-forget)
 *      - else if state.kind === 'cancelled' → Alert.alert(已取消)
 *      - else(completed / spouse_completed)→ noop(撤销入口留 T-US005-3)
 *
 * Memo:memo 包过,props 引用稳定时跳过重渲染。
 */
function CheckInButtonImpl({
  task,
  currentUserId,
  today,
  onCheckIn,
  onUndo,
}: CheckInButtonProps): React.JSX.Element {
  // 派生 state
  const state = getCheckInState(task, currentUserId, today);
  const clickable = canCheckIn(state);

  // -------------------- Handlers --------------------

  const handlePress = useCallback((): void => {
    if (clickable) {
      // fire-and-forget — 消费方若要 await / catch 错误,在 onCheckIn 内自己处理
      void onCheckIn(task);
      return;
    }

    // 非 clickable:根据 kind 决定反馈
    switch (state.kind) {
      case 'cancelled':
        Alert.alert(ALERT_CANCELLED_TITLE, ALERT_CANCELLED_MESSAGE, [
          { text: ALERT_OK_LABEL, style: 'default' },
        ]);
        return;
      case 'completed':
      case 'spouse_completed':
        // 撤销打卡入口留 T-US005-3;配偶先完成 toast 留 T-US005-2
        // 此处 noop — UI 已显示完成态,点击不报错
        return;
      default:
        // exhaustive:never('todo' 已被 clickable 处理)
        return;
    }
  }, [clickable, onCheckIn, task, state.kind]);

  // -------------------- a11y label --------------------

  const a11yLabel = buildAccessibilityLabel(task, state);

  // -------------------- Render --------------------

  const iconSize = CHECK_IN_BUTTON_SIZE;

  let button: React.JSX.Element;
  if (state.kind === 'cancelled') {
    button = (
      <View
        style={[styles.circleBase, styles.circleCancelled]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        <Prohibit size={iconSize} color={COLOR_MUTED} weight="regular" />
      </View>
    );
  } else if (state.kind === 'completed' || state.kind === 'spouse_completed') {
    // T-US005-3 升级:在 completed 视觉态右侧渲染 UndoChip(只在我打卡的 completed 态;
    // spouse_completed 不渲染 chip — 配偶完成的不能撤销,见 CheckInService.undoCheckin
    // not_owner 校验)
    const showUndo = state.kind === 'completed' && onUndo;
    const undoElement = showUndo ? (
      <UndoChip task={task} onUndo={onUndo} />
    ) : null;

    button = (
      <View style={styles.completedWrap}>
        <View
          style={[styles.circleBase, styles.circleCompleted]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <CheckCircle size={iconSize} color={COLOR_SUCCESS} weight="fill" />
        </View>
        <Text
          style={[
            styles.completedLabel,
            state.kind === 'spouse_completed' ? styles.labelMuted : null,
          ]}
          numberOfLines={1}
        >
          {state.label}
        </Text>
        {undoElement ? (
          // UndoChip 独立可访问(checkIn 已自带 a11y label)— 不包裹屏读
          <View style={styles.undoSlot}>{undoElement}</View>
        ) : null}
      </View>
    );
  } else {
    // 'todo'
    button = (
      <View style={styles.todoWrap}>
        <View
          style={[styles.circleBase, styles.circleTodo]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <CircleIcon size={iconSize} color={COLOR_SUCCESS} weight="regular" />
          {/* 内圈小赤陶点 — 设计 §3.5 '内圈小赤陶点' */}
          <View style={styles.todoInnerDot} />
        </View>
        {state.label === '补打卡' ? (
          <Text style={styles.labelBelow} numberOfLines={1}>
            {state.label}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={false /* 即使 cancelled / completed 也响应(给 Alert 或 noop) */}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={{
        disabled: !clickable,
        selected: state.kind === 'completed',
      }}
      testID={`checkin-button-${task.id}`}
      style={({ pressed }) => [
        styles.pressable,
        pressed && clickable ? styles.pressed : null,
      ]}
    >
      {button}
    </Pressable>
  );
}

/**
 * memo 包过:同 task + same props 引用稳定时不重渲染。
 * CheckInButton 视觉派生 + 回调稳定时(HomeScreen / TaskDetailScreen 都是 useCallback),
 * 列表 100+ 行不会让 CheckInButton 抖动。
 */
export const CheckInButton = memo(CheckInButtonImpl);

// =====================================================================
// 5. a11y helper
// =====================================================================

/**
 * 构造 Pressable 的 accessibilityLabel — 综合 title / 时间 / 状态语义。
 *
 * 设计 home-v1.0 §7:"打卡:喂奶粉,10:00";已完成 '已完成 HH:MM'。
 * 当前实现(T-US005-3 升级):
 *   - todo:           "打卡:<title> <HH:MM>" / "补打卡:<title> <HH:MM>"
 *   - completed:      "已完成 <HH:MM>" (撤销入口独立由 UndoChip 处理,自带 a11y label)
 *   - spouse_completed: "配偶已完成,无法撤销"
 *   - cancelled:      "任务已取消"
 *
 * 注意:撤销 button 自身有独立 a11y(UndoChip 渲染)— 不与本 Pressable 的 a11y 重复。
 * 所以 completed 态下主 Pressable 的 a11y label 不再"点击撤销"提示 — UndoChip 替代。
 *
 * ⚠️ 抽到本组件内的纯函数以便任务 brief §D 单测覆盖 a11y 字符串契约。
 */
function buildAccessibilityLabel(
  task: Task,
  state: ReturnType<typeof getCheckInState>,
): string {
  const title = task.title;
  const time = task.task_time ?? '全天';
  switch (state.kind) {
    case 'todo':
      return state.label === '补打卡'
        ? `补打卡:${title} ${time}`
        : `打卡:${title} ${time}`;
    case 'completed':
      // state.label = '✓ 已完成 HH:MM'(checkIn.ts 派生)
      // T-US005-3 后:撤销入口独立由 UndoChip 处理,主 Pressable 的 a11y 只描述状态
      return state.label.replace('✓ ', '');
    case 'spouse_completed':
      return '配偶已完成,无法撤销';
    case 'cancelled':
      return '任务已取消';
    default:
      return '打卡';
  }
}

// =====================================================================
// 6. Styles
// =====================================================================

const styles = StyleSheet.create({
  pressable: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  // 共享圆圈 box(无 border / fill — 由 icon 包外部)
  circleBase: {
    width: CHECK_IN_BUTTON_SIZE,
    height: CHECK_IN_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: CHECK_IN_BUTTON_SIZE / 2,
    position: 'relative',
    overflow: 'hidden',
  },
  // 'todo' — 浅 success 底,空心圈 + 内赤陶点
  circleTodo: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: COLOR_SUCCESS,
  },
  todoInnerDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLOR_ACCENT,
    top: 5,
    left: 5,
  },
  // 'completed' / 'spouse_completed' — 浅 success 底,fill 态
  circleCompleted: {
    backgroundColor: '#EAF3EC', // success 浅 8% 透明度感(用浅色背景)
  },
  // 'cancelled' — 浅灰底,dim icon
  circleCancelled: {
    backgroundColor: '#F2EBDF', // 亚麻容器背景浅色
  },
  // 'todo' 容器:圆圈 + (条件)"补打卡"label
  todoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 'completed' 容器:圆圈 + label 在右侧 + (T-US005-3 撤销 chip 在 label 右侧)
  completedWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  completedLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLOR_SUCCESS,
  },
  /** T-US005-3:撤销 chip 容器(在 completed label 右侧,gap=6) */
  undoSlot: {
    marginLeft: 2,
  },
  labelMuted: {
    color: COLOR_MUTED,
  },
  labelBelow: {
    fontSize: 11,
    color: COLOR_TEXT_PRIMARY,
    marginTop: 2,
    fontWeight: '500',
  },
});
