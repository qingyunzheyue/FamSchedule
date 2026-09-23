/**
 * FamSchedule — Tamagui 主题配置
 *
 * 来源契约:
 * - design-v1.0.md §1.1(色板 / 字号 / 圆角 / 阴影)
 * - DD-002(色板方向 ④ b:赤陶 #DC5A24 + 亚麻 #F4ECDC + 灰蓝 #5B7A8C)
 * - DD-003(Noto Sans CJK SC 3 字重 + 温暖家庭版字号阶梯)
 * - DD-007(暗色模式,跟随系统 + 应用内手动开关)
 *
 * Tamagui 概念:
 * - tokens: 全局设计原语(色 / 间距 / 圆角 / 字号)。所有 theme / 组件都从这里取值
 * - themes: 不同模式(light / dark)下 tokens 的具体色值覆盖
 * - fonts: 字体族 + 字号 + 行高 + 字重
 *
 * 使用方式:
 *   import { TamaguiProvider, View, Text, Button } from 'tamagui';
 *   import config from './src/theme/tamagui.config';
 *   <TamaguiProvider config={config} defaultTheme="light">
 *     <App />
 *   </TamaguiProvider>
 *
 * --- T-SETUP-9 偏差记录(原 T-SETUP-3 留下的 carry-over 错误,本任务修了)---
 * 原代码用 `createTheme()` 函数 + `@tamagui/config` 的 `defaultConfig` spread,
 * 这两个 API 在 Tamagui 2.x 已移除(2.x 的 themes 是纯对象字面量)。
 * runtime 上 createTheme 是 undefined,会直接抛 `undefined is not a function`,
 * App 启动即崩,所以必须修。
 *
 * Tamagui 2.x 正确做法:用 `getDefaultTamaguiConfig('native')` 拿 base config
 * (animations + shorthands + media + tokens + themes),再 spread + 覆盖 themes。
 * 移除 defaultConfig spread 会导致 Stack/Text 等组件丢失 children 类型推断
 * (TS 报 `'children' is incompatible with type 'undefined'`)。
 */
import { createTamagui, createTokens, createFont } from 'tamagui';
import { getDefaultTamaguiConfig } from '@tamagui/config-default';

// ============================================================================
// 字体 — 思源黑体 / Noto Sans CJK SC,3 字重
// ============================================================================

const notoFont = createFont({
  family: 'NotoSansSC', // expo-font 注册时使用的 family 名称
  size: {
    // 温暖家庭版(DD-003)
    micro: 11,
    meta: 13,
    body: 15,
    heading: 17,
    title: 22,
    display: 36,
  },
  lineHeight: {
    micro: 16,
    meta: 20,
    body: 24,
    heading: 26,
    title: 32,
    display: 44,
  },
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
  },
  // 映射 expo-font useFonts() 加载的 ttf 名称 → Tamagui 内部字重键
  // expo-font 加载时给 useFonts 传 { NotoSansSC_Regular: require('...') },
  // 则 face 引用 'NotoSansSC_Regular' 这个 familyName。
  face: {
    400: { normal: 'NotoSansSC_Regular' },
    500: { normal: 'NotoSansSC_Medium' },
    600: { normal: 'NotoSansSC_Semibold' },
  },
});

// ============================================================================
// 颜色 token(design-v1.0 §1.1 完整锁定)
// ============================================================================

const colorTokens = createTokens({
  color: {
    // ---- 品牌 / 操作 ----
    primary: '#DC5A24', // 赤陶,DD-002
    primaryHover: '#C04E1E',
    primaryPressed: '#A8431A',
    onPrimary: '#FFFFFF', // primary 之上的文字/icon

    // ---- 中性背景 / 表面 ----
    background: '#F4ECDC', // 亚麻,全局背景
    surface: '#FFF9F0', // 卡片 / Sheet / Dialog
    surfaceVariant: '#F0E5D0', // 次级容器
    border: '#E8DFD0',
    borderStrong: '#D0C5B0',

    // ---- 文字 ----
    textPrimary: '#3A2E20',
    textSecondary: '#7A6E5D',
    textTertiary: '#A89B86',
    textInverse: '#FFFFFF',

    // ---- Identity(我 / 配偶)----
    identityA: '#DC5A24', // 我(同 primary)
    identityABg: '#FBE8DD',
    identityB: '#5B7A8C', // 配偶,灰蓝
    identityBBg: '#E1E8ED',

    // ---- 语义色 ----
    success: '#5C9D7E',
    successBg: '#E8F0EA',
    successText: '#2E5945',
    warning: '#E0A341',
    warningBg: '#FBF1DC',
    warningText: '#7A5615',
    error: '#C95444',
    errorBg: '#FBEAE7',
    errorText: '#7A2E25',
    info: '#5B7A8C',
    infoBg: '#E7EDF1',
    infoText: '#2E3F4A',
  },
});

// ============================================================================
// 间距 / 圆角 / 尺寸 token
// ============================================================================

const tokens = createTokens({
  ...colorTokens,
  space: {
    // 0 也支持,但 Tamagui 要求 number 索引
    0: 0,
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    '3xl': 32,
    '4xl': 48,
    // Tamagui 2.x 要求: true = 默认 space,unspecific $true 引用 fallback
    // T-FIX-BUNDLE-2:对齐 md=12
    true: 12,
  },
  radius: {
    0: 0,
    sm: 8,
    md: 12,
    lg: 14,
    xl: 16,
    xxl: 20,
    full: 9999,
  },
  size: {
    0: 0,
    iconXs: 12,
    iconSm: 16,
    iconMd: 20,
    iconLg: 24,
    iconXl: 32,
    buttonSm: 36,
    buttonMd: 44,
    buttonLg: 52,
    // Tamagui 2.x 要求: true = 默认 size,unspecific $true 引用 fallback
    // T-FIX-BUNDLE-2:对齐 buttonMd=44(button 高度常用默认)
    true: 44,
  },
  zIndex: {
    0: 0,
    modal: 1000,
    toast: 2000,
    splash: 9999,
  },
});

// ============================================================================
// Light theme — Tamagui 2.x 直接传对象字面量(原 createTheme() 函数已移除)
// 值与 colorTokens 默认值相同,显式声明便于 review。
// ============================================================================

const lightTheme = {
  background: '#F4ECDC',
  surface: '#FFF9F0',
  surfaceVariant: '#F0E5D0',
  border: '#E8DFD0',
  borderStrong: '#D0C5B0',
  textPrimary: '#3A2E20',
  textSecondary: '#7A6E5D',
  textTertiary: '#A89B86',
  primary: '#DC5A24',
  primaryHover: '#C04E1E',
  primaryPressed: '#A8431A',
  onPrimary: '#FFFFFF',
  identityA: '#DC5A24',
  identityB: '#5B7A8C',
  identityABg: '#FBE8DD',
  identityBBg: '#E1E8ED',
  success: '#5C9D7E',
  successBg: '#E8F0EA',
  successText: '#2E5945',
  warning: '#E0A341',
  warningBg: '#FBF1DC',
  warningText: '#7A5615',
  error: '#C95444',
  errorBg: '#FBEAE7',
  errorText: '#7A2E25',
  info: '#5B7A8C',
  infoBg: '#E7EDF1',
  infoText: '#2E3F4A',
};

// ============================================================================
// Dark theme — DD-007,深棕黑底不刺眼,语义色保持不变
// ============================================================================

const darkTheme = {
  background: '#1A1814', // 深棕黑(非纯黑,保持暖度)
  surface: '#25221D',
  surfaceVariant: '#2F2A23',
  border: '#3A332B',
  borderStrong: '#4A4338',
  textPrimary: '#F4ECDC', // 反色:亚麻色
  textSecondary: '#A89B86',
  textTertiary: '#6E6452',
  primary: '#E26B3A', // 略提亮,保对比
  primaryHover: '#F07B47',
  primaryPressed: '#D85D2D',
  onPrimary: '#FFFFFF',
  identityA: '#E26B3A',
  identityB: '#7B9AB0',
  identityABg: '#3A2218',
  identityBBg: '#1F2A33',
  // 语义色保持不变(信任色跨主题)
  success: '#5C9D7E',
  successBg: '#1F2A24',
  successText: '#A0C5B0',
  warning: '#E0A341',
  warningBg: '#2F2517',
  warningText: '#D9B97A',
  error: '#C95444',
  errorBg: '#2F1A18',
  errorText: '#E0A39A',
  info: '#7B9AB0',
  infoBg: '#1F2A33',
  infoText: '#A0B8C5',
};

// ============================================================================
// 组合 createTamagui — 用 @tamagui/config-default 拿 base config
// (animations + shorthands + media + tokens),然后覆盖 themes 为我们的色板。
// ============================================================================

const baseConfig = getDefaultTamaguiConfig('native');

export const config = createTamagui({
  ...baseConfig,
  fonts: {
    ...baseConfig.fonts,
    body: notoFont,
    heading: notoFont,
  },
  tokens,
  // 覆盖默认 themes:用我们设计的 primary / surface / textPrimary / identityA / identityB
  themes: {
    ...baseConfig.themes,
    light: lightTheme,
    dark: darkTheme,
  },
  settings: {
    ...baseConfig.settings,
    // 允许同组件在不同主题下使用不同色值
    onlyShorthandStyleProps: false,
  },
});

// 让 TypeScript 推断主题类型到 useTheme() hook
export type AppConfig = typeof config;

declare module 'tamagui' {
  interface TamaguiCustomConfig extends AppConfig {}
}

export default config;
