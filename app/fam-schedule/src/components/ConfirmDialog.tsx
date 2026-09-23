/**
 * ConfirmDialog — 二次确认 Dialog — T-US003-2
 *
 * 职责:提供一个统一的二次确认 Dialog API,本任务删除流程先消费,后续 T-US015
 * (过期 banner 关闭确认) / T-US003-2 删除整系列等也会复用。
 *
 * 设计决策(任务 brief §C):
 *   - **用 RN Alert 而非 Tamagui Dialog** — Tamagui Dialog 在 jest 加载有 ESM 已知问题
 *     (jest-expo preset 的 transformIgnorePatterns 不含 tamagui,完整渲染需改 jest config,
 *     超出本任务 scope)。本任务用 RN 内置 Alert.alert 包装,自带 VoiceOver/TalkBack 支持,
 *     后续要 polish UI 时再换 Tamagui / react-native-reanimated modal。
 *   - **a11y**:Alert 是系统原生,自带 VoiceOver/TalkBack;不需额外配置。
 *
 * 流程(本任务首次消费 — 任务删除):
 *   1. TaskDetailScreen.handleDelete → showConfirmDialog({title, message, destructive: true, ...})
 *   2. 用户按"删除"(destructive)→ onConfirm → TaskService.deleteTask → Alert "已删除"
 *   3. 用户按"取消"→ onCancel → 关闭 Dialog
 *
 * 测试策略(任务 brief §E):
 *   - 抽出 `buildConfirmDialogButtons` 纯函数 + `showConfirmDialog` 调用方
 *   - 纯函数直接断言 button shape;showConfirmDialog mock `Alert.alert` 断言调用参数
 *   - 不渲染组件本身(jest-expo + Tamagui 限制)
 */

import { Alert } from 'react-native';

// =====================================================================
// Types
// =====================================================================

/**
 * ConfirmDialog 调用参数。
 *
 * - title       : Dialog 标题(必填)
 * - message     : Dialog 描述(必填)
 * - confirmLabel: 主按钮文字(默认 "确认")
 * - cancelLabel : 次按钮文字(默认 "取消")
 * - destructive : 主按钮是否红色 destructive style(默认 false)
 * - onConfirm   : 用户按主按钮时触发
 * - onCancel    : 用户按次按钮或 Dialog 外 dismiss 时触发
 */
export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 单个 button 的形状(对齐 RN Alert Button 形状)。
 *
 * - text   : 按钮文字
 * - style  : 'cancel' | 'destructive' | 'default'
 * - onPress: 用户按下时调
 */
export interface ConfirmDialogButton {
  text: string;
  style: 'cancel' | 'destructive' | 'default';
  onPress: () => void;
}

// =====================================================================
// 1. 纯函数 buildConfirmDialogButtons — 便于单测覆盖 button shape
// =====================================================================

/**
 * 把 ConfirmDialogOptions 转换成 [cancelButton, confirmButton] 数组。
 *
 * RN Alert 的 buttons 数组顺序 = 用户视觉顺序(iOS 高亮在末尾,Android 显示在
 * 右侧);[cancel, confirm] 顺序确保主操作在最后(destructive / 醒目)。
 *
 * 抽出本函数便于 jest 直接断言 button shape,不依赖 Alert.alert mock。
 */
export function buildConfirmDialogButtons(opts: ConfirmDialogOptions): ConfirmDialogButton[] {
  const cancelLabel = opts.cancelLabel ?? '取消';
  const confirmLabel = opts.confirmLabel ?? '确认';
  const destructive = opts.destructive ?? false;

  return [
    {
      text: cancelLabel,
      style: 'cancel',
      onPress: opts.onCancel,
    },
    {
      text: confirmLabel,
      style: destructive ? 'destructive' : 'default',
      onPress: opts.onConfirm,
    },
  ];
}

// =====================================================================
// 2. showConfirmDialog — 调用方入口
// =====================================================================

/**
 * 显示 RN Alert 二次确认 Dialog。
 *
 * 等价于直接调 `Alert.alert(title, message, buttons)`,但封装 button 构造
 * 逻辑(buildConfirmDialogButtons)+ 提供一致的 API 形状。
 *
 * 使用模式:
 * ```ts
 * showConfirmDialog({
 *   title: '删除这个任务?',
 *   message: `任务"${task.title}"将被删除,无法恢复。`,
 *   confirmLabel: '删除',
 *   destructive: true,
 *   onConfirm: () => doDelete(),
 *   onCancel: () => {},
 * });
 * ```
 *
 * a11y:RN Alert.alert 由系统渲染,自带 VoiceOver / TalkBack — 不需额外配置。
 */
export function showConfirmDialog(opts: ConfirmDialogOptions): void {
  const buttons = buildConfirmDialogButtons(opts);
  Alert.alert(opts.title, opts.message, buttons);
}