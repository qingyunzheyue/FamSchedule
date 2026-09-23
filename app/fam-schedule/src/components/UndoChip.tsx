/**
 * UndoChip — 撤销打卡 chip 组件 — T-US005-3
 *
 * 职责(US-005 故事 3/4 + 任务 brief §A-7):
 *   - 只在 task 已 completed + 5 分钟内渲染,显示倒计时(如 `↶ 撤销打卡 (4:32)`)
 *   - 5 分钟过期 → 返回 null(不渲染)— checkIn.ts.getUndoCountdown 派生
 *   - 点击 → 调 onUndo(task) 触发 HomeScreen / TaskDetailScreen 的 handleTaskUndo
 *   - **本组件不调 service** — 纯展示 + 倒计时自维护,服务层决策在消费方
 *
 * 时间同步问题(任务 brief §C 明确方案 A):
 *   - 撤销 button 需要实时倒计时,React 不主动 re-render
 *   - **方案 A(已选)**:UndoChip 内部 useState(now) + useEffect setInterval(1000)
 *     每秒 setState 触发 re-render
 *   - 优点:局部自维护,1 秒精度足够,卸载时清理 interval
 *   - 副作用:撤销组件 unmount 时 React 自动 clear(见 useEffect cleanup)
 *
 * 设计依据:
 *   - 设计 task-detail-v1.0.md §3.3 "撤销 button + 5 分钟倒计时"
 *   - 设计 §6 微文案:`↶ 撤销打卡 (HH:MM)`
 *   - 设计 §7 a11y:button role + 中文 a11yLabel(`撤销打卡,剩余 X 分 Y 秒`)
 *
 * a11y(任务 design §7):
 *   - `accessibilityRole="button"`
 *   - `accessibilityLabel={a11yLabel}`(来自 checkIn.ts.getUndoCountdown)
 *   - `accessibilityState={{ busy: busy }}`(可选 — 让屏幕阅读器感知点击后的 pending)
 *   - testID:`undo-chip-${task.id}`
 *
 * 简化决策(任务 brief §C 明确不在范围):
 *   - ❌ 二次确认 Dialog(任务 brief 本任务简化)— 点击直接撤销
 *   - ❌ iOS Toast polish(realtime 后 UI 自然切回 todo)
 *
 * 反 a11y / 反依赖:
 *   - 不依赖 CheckInService(保持组件纯展示)— 消费方调 service
 *   - 不读 LocalStore / supabase / SyncManager
 *   - 不依赖 FamilyContext
 *   - 唯一外部依赖:checkIn.ts.getUndoCountdown(纯函数,本仓库其他位置亦使用)
 */

import { memo, useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowUUpLeft } from 'phosphor-react-native';

import { getUndoCountdown } from '../lib/checkIn';
import type { Task } from '../lib/LocalStore';

// =====================================================================
// 1. Constants(颜色 / 尺寸 — 对齐设计 task-detail-v1.0 §3.3)
// =====================================================================

/** 撤销 chip 背景色 — 设计 §3.3 "赤陶底" + 白字 */
const COLOR_BG = '#DC5A24';
const COLOR_FG = '#FFFFFF';
/** 圆角全 pill — 与 TaskCard 的 chip 风格统一 */
const CHIP_PADDING_H = 10;
const CHIP_PADDING_V = 6;
/** hitSlop 加大(用户手势区)— 设计 §7 a11y 友好 */
const HIT_SLOP = 8;

// =====================================================================
// 2. Props
// =====================================================================

export interface UndoChipProps {
  /** 当前 task(必需 — 用作派生输入 + 点击回调参数) */
  task: Task;
  /** 点击回调(消费方 HomeScreen / TaskDetailScreen 决定调 CheckInService.undoCheckin)。 */
  onUndo: (task: Task) => void | Promise<void>;
  /**
   * 可选:`busy` 状态(消费方在 undoCheckin 调用进行中传入 true)— 用于禁用
   * 撤销 button,避免快速双击触发多次 RPC。
   *
   * 默认 false(forward-friendly)— 不传等价不限制双击。任务 brief §C 简化版不一定
   * 需要 busy,但留给消费方决定是否启用。
   */
  busy?: boolean;
}

// =====================================================================
// 3. Component
// =====================================================================

/**
 * 撤销打卡 chip — 5 分钟倒计时实时刷新 + 点击触发 onUndo。
 *
 * 渲染逻辑:
 *   1. `now = useState(Date.now())` — 内部时间戳
 *   2. `useEffect setInterval(() => setNow(Date.now()), 1000)`:每秒刷新
 *      - cleanup 在 unmount 时自动 clearInterval
 *   3. `state = getUndoCountdown(task.completed_at, now)` 派生
 *   4. `state.canUndo === false` → 返回 null(不渲染)— chip 消失
 *   5. `state.canUndo === true` → 渲染 chip:`↶ 撤销打卡 (MM:SS)`(赤陶底白字)
 *   6. 点击 → `void onUndo(task)`(fire-and-forget)+ busy 时 noop(给消费方决定)
 *
 * Memo:memo 包过,同 task 引用稳定时跳过重渲染(消费方通常 useCallback handleTaskUndo)。
 */
function UndoChipImpl({ task, onUndo, busy = false }: UndoChipProps): React.JSX.Element | null {
  // 内部时间戳 — 每秒刷新触发 re-render → getUndoCountdown 重新派生 → 倒计时实时
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const intervalId = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(intervalId);
    };
  }, []);

  // 派生 state
  const state = getUndoCountdown(task.completed_at, now);

  // canUndo === false → 5 分钟过期,不渲染
  if (!state.canUndo) {
    return null;
  }

  // -------------------- Handler --------------------

  const handlePress = useCallback((): void => {
    if (busy) return;
    // fire-and-forget — 消费方若要 await / catch 错误,在 onUndo 内自己处理
    void onUndo(task);
  }, [busy, onUndo, task]);

  // -------------------- Render --------------------

  return (
    <Pressable
      onPress={handlePress}
      disabled={busy}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={state.a11yLabel}
      accessibilityState={{ busy, disabled: busy }}
      testID={`undo-chip-${task.id}`}
      style={({ pressed }) => [styles.chip, pressed && !busy ? styles.pressed : null]}
    >
      <View style={styles.row}>
        <ArrowUUpLeft size={14} color={COLOR_FG} weight="bold" />
        <Text style={styles.label} numberOfLines={1}>
          {state.label}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * memo 包过:同 task + 同 onUndo 引用稳定时不重渲染。
 * task 引用更新会触发更新(派生新 completed_at / label)— 这是预期行为。
 */
export const UndoChip = memo(UndoChipImpl);

// =====================================================================
// 4. Styles
// =====================================================================

const styles = StyleSheet.create({
  chip: {
    backgroundColor: COLOR_BG,
    paddingHorizontal: CHIP_PADDING_H,
    paddingVertical: CHIP_PADDING_V,
    borderRadius: 999,
    alignSelf: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  label: {
    color: COLOR_FG,
    fontSize: 12,
    fontWeight: '600',
  },
});
