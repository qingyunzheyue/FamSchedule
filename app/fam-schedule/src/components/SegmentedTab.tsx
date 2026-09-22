/**
 * SegmentedTab — 3 选项视图切换器 — T-US002-1
 *
 * 职责(US-002 §3.4 segmented tab):
 *   - 渲染 `今天` / `本周` / `全部` 3 个 tab
 *   - 选中态:赤陶色文字 (#DC5A24) + 底部 2px 横线
 *   - 未选中:暗色文本 (#3A2E20)
 *   - 高度 ~48px,字号 15px Medium
 *
 * 设计依据:
 *   - home-v1.0.md §3.4 + §7 a11y(每个 tab role="tab" + selected state)
 *   - 不依赖 Tamagui Tabs 组件(避免 ESM 加载问题 / T-FIX-06)—— 用
 *     View + onTouchEnd + 样式自己拼
 *
 * 状态机:
 *   - 受控(value + onChange)—— 父组件(HomeScreen)把当前 view 存到 URL
 *     query(`?view=today|week|all`),URL 是 source of truth。
 *
 * a11y(设计 §7):
 *   - container accessibilityRole="tablist"
 *   - 每个 tab accessibilityRole="tab" + accessibilityState={{selected: bool}}
 *
 * 不在本组件范围:
 *   - URL 同步(由 HomeScreen setParams)
 *   - 视图筛选(由 taskListFilters.filterTasks)
 */

import { StyleSheet, View, Text } from 'react-native';

import type { ViewMode } from '../lib/taskListFilters';

// =====================================================================
// Constants
// =====================================================================

// 与 CreateTaskScreen 的赤陶色保持一致(同 design-v1.0 §1.3 主题)
const COLOR_PRIMARY = '#DC5A24';
const COLOR_TEXT_PRIMARY = '#3A2E20';
const COLOR_TEXT_SECONDARY = '#7A6B57';
const COLOR_BORDER = '#E8DFD0';

const OPTIONS: ReadonlyArray<{ value: ViewMode; label: string }> = [
  { value: 'today', label: '今天' },
  { value: 'week', label: '本周' },
  { value: 'all', label: '全部' },
];

// =====================================================================
// Component
// =====================================================================

export interface SegmentedTabProps {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
}

/**
 * 3 选项 tab — 今天 / 本周 / 全部。
 *
 * 实现要点:
 *   - 用 RN StyleSheet(同 CreateTaskScreen.ChipButton 模式),不依赖 Tamagui
 *   - 整行高 48px,每个 tab flex=1 均分
 *   - 选中态:底部 2px 赤陶横线(用 borderBottomWidth + borderBottomColor)+ 文字色赤陶
 *   - 未选中:文字暗色,无横线
 */
export function SegmentedTab({ value, onChange }: SegmentedTabProps): React.JSX.Element {
  return (
    <View
      style={styles.container}
      accessibilityRole="tablist"
      accessibilityLabel="视图切换"
    >
      {OPTIONS.map((opt) => {
        const isSelected = value === opt.value;
        return (
          <View
            key={opt.value}
            style={[
              styles.tab,
              isSelected ? styles.tabSelected : styles.tabDefault,
            ]}
            onTouchEnd={() => {
              if (!isSelected) onChange(opt.value);
            }}
            accessible
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`${opt.label}视图${isSelected ? ',已选中' : ''}`}
            testID={`segment-${opt.value}`}
          >
            <Text
              style={[
                styles.tabLabel,
                isSelected ? styles.tabLabelSelected : styles.tabLabelDefault,
              ]}
            >
              {opt.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// =====================================================================
// Styles
// =====================================================================

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    height: 48,
    backgroundColor: 'transparent',
    borderBottomColor: COLOR_BORDER,
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  tabDefault: {
    borderBottomWidth: 0,
  },
  tabSelected: {
    borderBottomWidth: 2,
    borderBottomColor: COLOR_PRIMARY,
  },
  tabLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  tabLabelDefault: {
    color: COLOR_TEXT_SECONDARY,
    fontWeight: '500',
  },
  tabLabelSelected: {
    color: COLOR_PRIMARY,
    fontWeight: '600',
  },
});
