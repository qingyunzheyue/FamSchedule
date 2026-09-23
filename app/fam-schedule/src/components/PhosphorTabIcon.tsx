/**
 * PhosphorTabIcon — 底部 Tab Bar 图标包装 — T-FIX-05
 *
 * 职责(DD-005 视觉契约):
 *   - 渲染 Phosphor icon(active 用 weight="fill",inactive 用 weight="regular")
 *   - active 时在 icon 下方加 4×4 赤陶圆点指示器
 *   - 透传 expo-router tabBarIcon 的 color / size 给 icon
 *
 * 为什么单独抽组件(不是写在 (main)/_layout.tsx 里):
 *   - 3 个 tab 复用 fill/regular 切换 + 圆点逻辑,避免 3 处重复
 *   - getTabIconState 纯函数可独立单测(无需渲染)
 *   - 未来若要换底栏(tabBarBackground 自定义 / 切换 indicator 形状)只改一处
 *
 * 设计依据:
 *   - design-v1.0 §1.3 DD-005:任务/家庭/设置 等宽 3 tab + Phosphor + 4px 圆点
 *   - design-v1.0 §1.5 字重:fill (active) / regular (inactive)
 *
 * a11y(继承自 expo-router TabBarItem):
 *   - container 已自动获 `accessibilityRole="tab"` + `accessibilityState={{selected: focused}}`
 *   - icon 本身无需再加 label(expo-router 会拿 tab title 当 name)
 *
 * 不在本组件范围:
 *   - 底栏样式(在 (main)/_layout.tsx 的 screenOptions.tabBarStyle)
 *   - Tab title(label)
 */

import * as React from 'react';
import { View, StyleSheet } from 'react-native';

// =====================================================================
// Types
// =====================================================================

/**
 * Phosphor icon 组件类型 — 本地最小定义,避免依赖
 * `phosphor-react-native@3.0.6` 包内未公开导出的 IconProps 类型。
 * 形状对齐 `node_modules/phosphor-react-native/lib/typescript/lib/index.d.ts`
 * 中 IconProps 的子集,够 tab bar 使用。
 */
export type PhosphorIconWeight =
  | 'thin'
  | 'light'
  | 'regular'
  | 'bold'
  | 'fill'
  | 'duotone';

export type PhosphorIconComponent = React.ComponentType<{
  weight?: PhosphorIconWeight;
  color?: string;
  size?: number;
  testID?: string;
}>;

export interface PhosphorTabIconProps {
  /** Phosphor icon 组件类(从 `phosphor-react-native` 导入) */
  Icon: PhosphorIconComponent;
  /** 当前 tab 是否聚焦(来自 expo-router tabBarIcon 的 `focused`) */
  focused: boolean;
  /** 颜色(来自 tabBarIcon 的 `color`,已 cast string) */
  color: string;
  /** 图标尺寸,默认 24(对齐 design-v1.0 §1.5 Tab Bar 默认) */
  size?: number;
  /** 圆点指示器颜色,默认赤陶 #DC5A24(对齐 DD-002 primary token) */
  activeColor?: string;
}

// =====================================================================
// Constants
// =====================================================================

const DEFAULT_SIZE = 24;
const DEFAULT_ACTIVE_COLOR = '#DC5A24';
const DOT_SIZE = 4; // design DD-005 明文:4px 圆点
const DOT_MARGIN_TOP = 6;

// =====================================================================
// Pure helper
// =====================================================================

/**
 * 把 focused → (weight, showDot) 的映射抽出成纯函数。
 * 单测不需 React renderer,极快 + 零依赖。
 */
export function getTabIconState(focused: boolean): {
  weight: PhosphorIconWeight;
  showDot: boolean;
} {
  return {
    weight: focused ? 'fill' : 'regular',
    showDot: focused,
  };
}

// =====================================================================
// Component
// =====================================================================

export function PhosphorTabIcon({
  Icon,
  focused,
  color,
  size = DEFAULT_SIZE,
  activeColor = DEFAULT_ACTIVE_COLOR,
}: PhosphorTabIconProps): React.JSX.Element {
  const { weight, showDot } = getTabIconState(focused);

  return (
    <View style={styles.container}>
      <Icon weight={weight} color={color} size={size} />
      {showDot ? (
        <View
          testID="phosphor-tab-icon-dot"
          style={[styles.dot, { backgroundColor: activeColor }]}
        />
      ) : null}
    </View>
  );
}

// =====================================================================
// Styles
// =====================================================================

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    marginTop: DOT_MARGIN_TOP,
  },
});