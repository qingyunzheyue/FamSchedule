/**
 * OverdueBanner — 任务详情页过期 banner — T-US014-2
 *
 * 职责(任务 brief §C.2 + 设计 task-detail-v1.0 §3.2):
 *   - 详情页顶部条件渲染 — 仅当 task 处于过期未完成态时显示
 *   - 视觉:warning 浅底 #FBEAE6 + warning 文字 #C95444,圆角 12px
 *   - 三栏布局:左 ⚠ icon + 中文案("已过期 N 小时" / "刚刚过期" / "已过期 N 天")
 *           + 右"补卡"按钮(本任务 Alert placeholder,留 T-US006 真补卡 RPC)
 *   - a11y:`accessibilityRole="alert"` + label 综合 message + 补卡 action
 *
 * 设计依据:
 *   - 设计 task-detail-v1.0.md §3.2 过期 banner 视觉 + §6 文案 + §7 a11y
 *   - 设计 warning 色 token 已对齐 TaskCard.tsx(COLOR_WARNING / COLOR_WARNING_BG)
 *
 * 边界决策(dev self-acknowledge scope):
 *   - ❌ 真补卡逻辑(留 T-US006)— 当前 onMakeUp Alert "补卡功能等 T-US006 接入"
 *   - ❌ 关闭按钮(留后续 polish)— 当前 banner 永久显示直到 task 完成 / 编辑日期
 *   - ❌ 国际化(留 react-i18next)— 当前硬编码中文文案,props.message 接受外部注入
 *
 * 派生:
 *   - banner 是否显示由父层 TaskDetailScreen 决定(用 computeTaskBadge.overdue +
 *     formatOverdueHours.showBanner 派生)— 本组件只接 props.message / props.onMakeUp,
 *     不做派生(保持纯展示)
 *
 * Props 契约:
 *   - message:已本地化的文案(由 formatOverdueHours 派生)— UI 直接渲染
 *   - onMakeUp:点击"补卡"按钮回调 — 父层决定实际行为(本任务 Alert placeholder)
 *
 * 不在范围:
 *   - ❌ banner 关闭状态(留后续)
 *   - ❌ 真补卡 RPC(留 T-US006)
 *   - ❌ 国际化(留 react-i18next)
 *   - ❌ 模板任务特殊处理(本任务简化版)
 */

import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View, Alert } from 'react-native';
import { Warning } from 'phosphor-react-native';
import { useTheme } from 'tamagui';

import type { Task } from '../lib/LocalStore';

// =====================================================================
// 1. 常量(颜色 / 文案 — 与 TaskCard / TaskDetailScreen 对齐)
// =====================================================================
//
// T-FIX-06-A M24:warning 系列色改用 Tamagui theme token(`$warning` / `$warningBg` /
// `$warningBorder`),不再用本地 hex 常量。useTheme() 必须在组件内调用,这里通过
// useOverdueBannerTheme() 局部 hook + 组件内 useTheme() 拿值,跨 light/dark 自动适配。
//
// 留 COLOR_TEXT_ON_WARNING(白底文字)— 补卡按钮仍用白字,不进 theme token。
const COLOR_TEXT_ON_WARNING = '#FFFFFF';

/** "补卡"按钮文案(独立常量便于 i18n) */
const MAKEUP_BUTTON_LABEL = '补卡';

/** "补卡"功能 placeholder Alert 文本(T-US006 真补卡 RPC 接好后改) */
const MAKEUP_ALERT_TITLE = '补卡功能';
const MAKEUP_ALERT_MESSAGE = '补卡功能等 T-US006 接入';
const MAKEUP_ALERT_OK_LABEL = '好';

// =====================================================================
// 2. Props
// =====================================================================

export interface OverdueBannerProps {
  /**
   * 已本地化的过期文案(由 formatOverdueHours.displayText 派生)— UI 直接渲染。
   * 例:"刚刚过期" / "已过期 14 小时" / "已过期 3 天"。
   */
  message: string;
  /**
   * "补卡"按钮点击回调 — 父层(TaskDetailScreen)决定实际行为。
   * 当前任务 placeholder:Alert "补卡功能等 T-US006 接入"(留 T-US006 真补卡 RPC)。
   */
  onMakeUp: () => void;
}

// =====================================================================
// 3. Component
// =====================================================================

/**
 * 任务详情页过期 banner — 详情页顶部条件渲染,仅在 task overdue 时显示。
 *
 * - 视觉:warning 浅底 / 圆角 12px / 三栏(icon + 文案 + 补卡按钮)
 * - a11y:`accessibilityRole="alert"`(屏幕阅读器立即朗读)+ label 包含"补卡"动作提示
 * - testID:`overdue-banner` — 便于 E2E / 截图测试定位
 *
 * ⚠️ 故意不接 Service:本组件保持纯展示,服务调用在父层 TaskDetailScreen
 *    (与 TaskCard / CheckInButton / UndoChip 的策略一致)。
 */
function OverdueBannerImpl({
  message,
  onMakeUp,
}: OverdueBannerProps): React.JSX.Element {
  // T-FIX-06-A M24:warning 系列色从 theme token 拿,跨 light/dark 自动适配
  const theme = useTheme();
  const warningFg = (theme.warning?.val ?? '#C95444') as string;
  const warningBg = (theme.warningBg?.val ?? '#FBEAE6') as string;
  const warningBorder = (theme.warningBorder?.val ?? '#F0C9BD') as string;

  // ---------------------------------------------------------------------
  // Handler
  // ---------------------------------------------------------------------

  const handleMakeUpPress = useCallback((): void => {
    // 本任务 placeholder:弹 Alert 告知用户"补卡功能即将推出"
    // 真补卡 RPC(T-US006)接好后,父层可改 onMakeUp 走 service 而非弹 Alert
    Alert.alert(MAKEUP_ALERT_TITLE, MAKEUP_ALERT_MESSAGE, [
      { text: MAKEUP_ALERT_OK_LABEL, style: 'default' },
    ]);
    // 透传给父层 hook(给后续真补卡接入留扩展点;本任务父层 handler 通常 noop)
    onMakeUp();
  }, [onMakeUp]);

  // ---------------------------------------------------------------------
  // a11y label(综合文案 + 补卡动作)
  // ---------------------------------------------------------------------

  const a11yLabel = `${message},点击补卡`;

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: warningBg, borderColor: warningBorder },
      ]}
      accessibilityRole="alert"
      accessibilityLabel={a11yLabel}
      testID="overdue-banner"
    >
      {/* 左:⚠ icon */}
      <View style={styles.iconColumn}>
        <Warning size={20} color={warningFg} weight="fill" />
      </View>

      {/* 中:文案 */}
      <View style={styles.messageColumn}>
        <Text style={[styles.messageText, { color: warningFg }]} numberOfLines={1}>
          {message}
        </Text>
      </View>

      {/* 右:补卡按钮 */}
      <Pressable
        style={({ pressed }) => [
          styles.makeUpButton,
          { backgroundColor: warningFg },
          pressed ? styles.makeUpButtonPressed : null,
        ]}
        onPress={handleMakeUpPress}
        accessibilityRole="button"
        accessibilityLabel="补卡"
        testID="overdue-banner-makeup-button"
      >
        <Text style={styles.makeUpButtonLabel} numberOfLines={1}>
          {MAKEUP_BUTTON_LABEL}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * memo 包过:同 message / onMakeUp 引用稳定时不重渲染。
 * 父层 TaskDetailScreen 通常 useCallback + useMemo(message) → 引用稳定。
 */
export const OverdueBanner = memo(OverdueBannerImpl);

// =====================================================================
// 4. Styles
// =====================================================================

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    // backgroundColor / borderColor 由组件 inline 提供(theme.warningBg / warningBorder token)
    // — T-FIX-06-A M24
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  iconColumn: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageColumn: {
    flex: 1,
    marginHorizontal: 8,
  },
  messageText: {
    // color 由组件 inline 提供(theme.warning token)
    // — T-FIX-06-A M24
    fontSize: 14,
    fontWeight: '600',
  },
  makeUpButton: {
    // backgroundColor 由组件 inline 提供(theme.warning token)
    // — T-FIX-06-A M24
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  makeUpButtonPressed: {
    opacity: 0.7,
  },
  makeUpButtonLabel: {
    color: COLOR_TEXT_ON_WARNING,
    fontSize: 13,
    fontWeight: '600',
  },
});