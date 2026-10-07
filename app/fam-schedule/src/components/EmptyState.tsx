/**
 * EmptyState — 通用空状态展示组件 — T-US015-4
 *
 * 职责(US-015 故事 4 — EmptyState polish):
 *   - presentational 纯展示组件,无业务逻辑
 *   - 视觉:大号 icon + title + subtitle 三段式(可选 icon)
 *   - 用于 ExpiredTasksScreen 等场景的"语境化"空状态文案
 *
 * 设计依据:
 *   - 设计 home-v1.0 §3.5 / task-detail-v1.0 §10
 *   - 与 TaskList 内部 EmptyState(子组件,view-specific 文案)区分:
 *     - TaskList.EmptyState:view-specific("今天没有任务" / "本周还没有任务" / ...)
 *       且带"创建任务"按钮 — 仅 home 主列表场景
 *     - 本 EmptyState:无 view 概念,接受 props 文案 + 无按钮 — 用于过期 / 历史 /
 *       搜索结果等语境化场景
 *
 * Props 契约:
 *   - icon?:可选 ReactNode — 大号 icon(48x48),如 <CheckCircle />
 *   - title:必填 string — 主标题(18px,加粗)
 *   - subtitle?:可选 string — 副标题(14px,弱化)
 *   - testID?:可选 string — E2E / 截图回归
 *
 * 不在范围:
 *   - ❌ 插画(背景图)— brief 强调纯文字 + icon
 *   - ❌ 操作按钮(创建 / 重试)— 让父层按需渲染(本组件是纯展示)
 *   - ❌ i18n(留后续 polish)— 当前硬编码中文文案
 */

import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

// =====================================================================
// Constants — 颜色 + 尺寸(对齐 home-v1.0 §3.5)
// =====================================================================

const COLOR_TEXT_PRIMARY = '#3A2E20';
const COLOR_TEXT_SECONDARY = '#7A6B57';
const COLOR_BG = '#F4ECDC';

const ICON_SIZE = 48;

// =====================================================================
// Props
// =====================================================================

export interface EmptyStateProps {
  /**
   * 大号 icon — 48x48,置中渲染在 title 上方。
   * 不传时不渲染 icon 区域,直接显示 title/subtitle。
   */
  icon?: ReactNode;
  /** 主标题 — 必填,18px 加粗 */
  title: string;
  /** 副标题 — 可选,14px 弱化 */
  subtitle?: string;
  /** E2E / 截图回归 testID */
  testID?: string;
}

// =====================================================================
// Component
// =====================================================================

/**
 * 通用空状态展示组件 — 大号 icon + title + subtitle 三段式。
 *
 * a11y:
 *   - container role="text" 让屏幕阅读器整体朗读
 *   - title role="header" 让屏幕阅读器视为小节标题
 *
 * 用法:
 *   <EmptyState
 *     icon={<CheckCircle size={48} color="$success" weight="duotone" />}
 *     title="暂无过期任务"
 *     subtitle="保持节奏,真棒"
 *     testID="expired-tasks-empty"
 *   />
 */
export function EmptyState({
  icon,
  title,
  subtitle,
  testID,
}: EmptyStateProps): React.JSX.Element {
  return (
    <View
      style={styles.container}
      accessibilityRole="text"
      testID={testID ?? 'empty-state'}
    >
      {icon ? <View style={styles.iconRow}>{icon}</View> : null}
      <Text
        style={styles.title}
        accessibilityRole="header"
        accessibilityLabel={title}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text style={styles.subtitle} accessibilityLabel={subtitle}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

// =====================================================================
// Styles
// =====================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 24,
    backgroundColor: COLOR_BG,
  },
  iconRow: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: COLOR_TEXT_PRIMARY,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: COLOR_TEXT_SECONDARY,
    textAlign: 'center',
  },
});
