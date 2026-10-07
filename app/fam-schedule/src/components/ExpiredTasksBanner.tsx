/**
 * ExpiredTasksBanner — Home tab 启动期过期任务 banner — T-US015-2 + T-US015-4
 *
 * 职责(US-015 故事 2/3 — 启动时过期任务 banner + 故事 4 — 关闭按钮):
 *   1. 渲染顶部 banner — 仅当 count > 0 且 loading=false 时显示
 *   2. 视觉:warning 浅底 #FBEAE6 + warning 文字 #C95444 + 1px 描边 #F0C9BD +
 *      12px 圆角(与 OverdueBanner.tsx 一致的 design token)
 *   3. 三栏布局:左 ⚠ icon + 中文案"你有 N 个任务过期未完成"(阿拉伯数字)+
 *      右"查看 →"链接
 *   4. 整条可点击 — onPress 回调(本任务父层 noop,留 T-US015-3 跳转
 *      ExpiredTasksScreen)
 *   5. **T-US015-4 新增**:右侧关闭按钮 × — onDismiss 回调,持久化逻辑由
 *      父层 useBannerDismissedUntil hook 处理;不传 onDismiss 时不渲染关闭按钮
 *      (banner 复用场景,如 ExpiredTasksScreen 内嵌时关闭按钮隐藏)
 *   6. a11y:`accessibilityRole="button"` + label 综合文案 + "点击查看"
 *
 * 设计依据:
 *   - 设计 home-v1.0.md §3.3 过期 banner 视觉 + §6 文案
 *   - 设计 §1.1 warning 色 token — 与 TaskCard.tsx / OverdueBanner.tsx 对齐
 *   - 任务 brief §C.3 + §D 测试覆盖
 *   - T-US015-4 brief §A.3:关闭按钮独立 Pressable,不触发 onPress(两个区域分开)
 *
 * 边界决策(dev self-acknowledge scope):
 *   - ❌ 跳转 ExpiredTasksScreen(留 T-US015-3)— 当前 onPress 父层 noop
 *   - ❌ Banner 关闭状态持久化(留 T-US015-4 hook)— banner 是纯展示,父层
 *     注入 dismiss 回调
 *   - ❌ 国际化(留 react-i18next)— 当前硬编码中文文案,formatExpiredBannerText
 *     导出便于未来 i18n 替换
 *   - ❌ 接 Service / 接 useExpiredTaskCount hook(留 caller)— banner 是纯展示,
 *     数据由父层(HomeScreen)从 useExpiredTaskCount 注入(count + loading)
 *   - ❌ 区分 iOS / Android 原生动画(独立 banner)— 用 RN Pressable 跨平台一致
 *
 * Props 契约:
 *   - count:必填 number — 过期任务总数;0 = 不渲染
 *   - onPress:可选 () => void — 整条 Pressable 点击回调(本任务父层 noop)
 *   - loading:可选 boolean — true = 不渲染(避免 banner 闪 + 数据不准)
 *   - onDismiss:可选 () => void — T-US015-4:右侧 × 按钮回调;不传 = 不渲染按钮
 *
 * 不在范围:
 *   - ❌ service / hook 集成
 *   - ❌ 跳转
 *   - ❌ 关闭持久化(留父层 hook)
 *   - ❌ i18n
 *   - ❌ 模板任务特殊处理
 */

import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CaretRight, Warning, X } from 'phosphor-react-native';
import { useTheme } from 'tamagui';

// =====================================================================
// 1. 常量(颜色 — 与 OverdueBanner.tsx / TaskCard.tsx / design §1.1 对齐)
// =====================================================================
//
// T-FIX-06-A M24:warning 系列色改用 Tamagui theme token(`$warning` / `$warningBg` /
// `$warningBorder`),不再用本地 hex 常量。useTheme() 必须在组件内调用,
// 组件内 inline style 引用 token 值,跨 light/dark 自动适配。

/** "查看 →" 链接文案(独立常量便于 i18n) */
const VIEW_LINK_LABEL = '查看 →';
/** T-US015-4:关闭按钮 a11y label(独立常量便于 i18n + 测试断言) */
const DISMISS_BUTTON_LABEL = '关闭过期 banner';
/** T-US015-4:关闭按钮 testID(便于 E2E / 截图回归) */
const DISMISS_BUTTON_TESTID = 'expired-tasks-banner-dismiss';

// =====================================================================
// 2. Props
// =====================================================================

export interface ExpiredTasksBannerProps {
  /**
   * 过期任务总数(由父层从 useExpiredTaskCount 注入)— count:0 时组件不渲染
   * (N=0 完全消失不留占位)。
   */
  count: number;
  /**
   * 整条 Pressable onPress 回调 — 父层(HomeScreen)决定实际行为。
   * 本任务父层 noop(留 T-US015-3 跳 ExpiredTasksScreen)。
   * 可选:不传时组件仍可渲染,只是整条不响应点击。
   */
  onPress?: () => void;
  /**
   * 当前是否正在拉取 summary — true 时组件不渲染(避免 banner 闪一下 +
   * 数据不准)。由 useExpiredTaskCount.loading 注入;不传 = 默认渲染(假设
   * data ready)。
   */
  loading?: boolean;
  /**
   * T-US015-4 新增:关闭按钮回调 — 父层(HomeScreen)useBannerDismissedUntil
   * 注入,写 AsyncStorage + 更新 state;不传时关闭按钮不渲染(banner 复用
   * 场景如过期列表内嵌允许不显示关闭按钮)。
   */
  onDismiss?: () => void;
}

// =====================================================================
// 3. 纯函数 — formatExpiredBannerText(导出便于测试 + 未来 i18n)
// =====================================================================

/**
 * 把 count 翻译成 banner 文案。
 *
 * 设计决策:
 *   - N=0 → 返回空串(配合组件 count=0 return null,不渲染空文案)
 *   - N≥1 → 用阿拉伯数字(DoD 明确)— 不用汉字数字
 *   - 文案模板严格对应 home-v1.0.md §3.3:
 *     "你有 N 个任务过期未完成"
 *
 * 边界行为:
 *   - 负数 → 返空串(N<0 是 undefined 行为 — 这里兜底返空,不让组件抛错)
 *
 * @param count — 过期任务总数(由父层注入)
 * @returns banner 文案(空串表示不渲染)
 */
export function formatExpiredBannerText(count: number): string {
  if (!Number.isFinite(count) || count <= 0) {
    return '';
  }
  return `你有 ${count} 个任务过期未完成`;
}

// =====================================================================
// 4. Component
// =====================================================================

/**
 * Home tab 顶部过期 banner — 仅当 count > 0 且 loading=false 时显示。
 *
 * - 视觉:warning 浅底 / 圆角 12px / 三栏(icon + 文案 + 查看链接)
 * - 整条 Pressable 可点击 → onPress 回调
 * - a11y:`accessibilityRole="button"`(屏幕阅读器朗读为"按钮")+
 *   label 综合文案 + "点击查看"动作提示
 * - testID:`expired-tasks-banner` — 便于后续 E2E / 截图回归
 *
 * ⚠️ 故意不接 Service / hook:本组件保持纯展示,数据由父层 HomeScreen
 *    (从 useExpiredTaskCount 解构注入)— 与 OverdueBanner / TaskCard /
 *    CheckInButton / UndoChip 的策略一致。
 */
function ExpiredTasksBannerImpl({
  count,
  onPress,
  loading,
  onDismiss,
}: ExpiredTasksBannerProps): React.JSX.Element | null {
  // T-FIX-06-A M24:warning 系列色从 theme token 拿,跨 light/dark 自动适配
  const theme = useTheme();
  const warningFg = (theme.warning?.val ?? '#C95444') as string;
  const warningBg = (theme.warningBg?.val ?? '#FBEAE6') as string;
  const warningBorder = (theme.warningBorder?.val ?? '#F0C9BD') as string;

  // ---------------------------------------------------------------------
  // 可见性 gate(DoD:N=0 完全消失 / loading 期间不渲染)
  // ---------------------------------------------------------------------

  if (loading) return null;
  if (count <= 0) return null;

  // ---------------------------------------------------------------------
  // 文案(format 派生 — 纯函数 + 导出)
  // ---------------------------------------------------------------------

  const text = formatExpiredBannerText(count);

  // ---------------------------------------------------------------------
  // a11y label(综合文案 + 点击查看动作)
  // ---------------------------------------------------------------------

  const a11yLabel = `${text},点击查看`;

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        { backgroundColor: warningBg, borderColor: warningBorder },
        pressed ? styles.pressed : null,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      testID="expired-tasks-banner"
    >
      {/* 左:⚠ icon */}
      <View style={styles.iconColumn}>
        <Warning size={20} color={warningFg} weight="fill" />
      </View>

      {/* 中:文案 */}
      <View style={styles.messageColumn}>
        <Text style={[styles.messageText, { color: warningFg }]} numberOfLines={1}>
          {text}
        </Text>
      </View>

      {/* 右:查看链接 */}
      <View style={styles.linkColumn}>
        <Text style={[styles.linkText, { color: warningFg }]} numberOfLines={1}>
          {VIEW_LINK_LABEL}
        </Text>
        <CaretRight size={14} color={warningFg} weight="bold" />
      </View>

      {/* T-US015-4:右侧关闭按钮 × — 仅当 onDismiss 注入时渲染
          - 独立 Pressable:点击 × 不应触发整条 onPress(让父层关闭 banner 而不是跳转过期列表)
          - hitSlop={12}(每边 12dp,总命中区 48x48,等价 iOS HIG 44pt minimum tap area)
          - testID 暴露给 E2E 截图回归
      */}
      {onDismiss ? (
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={DISMISS_BUTTON_LABEL}
          testID={DISMISS_BUTTON_TESTID}
          hitSlop={12}
          style={({ pressed }) => [
            styles.dismissButton,
            pressed ? styles.dismissPressed : null,
          ]}
        >
          <X size={18} color={warningFg} weight="bold" />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/**
 * memo 包过:同 count / onPress / loading 引用稳定时不重渲染。
 * 父层 HomeScreen 通常把 onPress 用 useCallback 包裹 + loading 是 primitive —
 * 引用稳定,banner 在 task list re-render 时不连带重渲。
 */
export const ExpiredTasksBanner = memo(ExpiredTasksBannerImpl);

// =====================================================================
// 5. Styles
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
    // 让 banner 与 SegmentedTab 之间留视觉呼吸 — marginTop 由 caller 决定
    // (Header 简化版用 XStack paddingVertical $sm,banner 自然承接)
  },
  pressed: {
    opacity: 0.7,
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
    // color 由组件 inline 提供(theme.warning token)— T-FIX-06-A M24
    fontSize: 14,
    fontWeight: '600',
  },
  linkColumn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  linkText: {
    // color 由组件 inline 提供(theme.warning token)— T-FIX-06-A M24
    fontSize: 13,
    fontWeight: '600',
  },
  // T-US015-4:关闭按钮(×)独立点击区 — 24x24 视觉但 hitSlop 12 让命中区 ≈ 36dp,
  // 与 banner 整条 Pressable 分开(点击 × 不会冒泡触发 onPress)
  dismissButton: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    borderRadius: 12,
  },
  dismissPressed: {
    opacity: 0.5,
  },
});