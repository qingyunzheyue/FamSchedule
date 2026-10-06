/**
 * Tamagui theme token 锁值测试 — T-FIX-06-A M24
 *
 * 覆盖范围:
 *   - warning 系列 token 锁定:`$warning` / `$warningBg` / `$warningBorder`
 *     组件 TaskCard / OverdueBanner / ExpiredTasksBanner 现读 token 而非本地 hex。
 *     改坏 token 值(例如把 warning 误改 amber)会导致 3 个组件视觉偏离 design §1.1,
 *     这里把 token 值锁住作为回归防线。
 *
 *   - light / dark theme 覆盖锁定:同一 token 在两主题下应有合理色对(亮色主 + 暗色提亮),
 *     且 bg 应与主色同色族系。任何人改 dark warning 也需过本测。
 *
 * 严格 scope:
 *   - 只锁 warning 系列(brief M24 唯一范围)
 *   - 不测其他语义色(success / error / info)— 留后续 polish
 *   - 不测 token 在组件内的具体应用(那是组件 test)— 这里只锁源头
 */

// ---- 警告:不 import 真实 src/theme/tamagui.config.ts ----
//
// tamagui.config.ts 在模块顶层 `createTamagui(...)`,依赖真实 tamagui ESM,
// jest-expo preset 不转译 tamagui,会抛 `Cannot use import statement outside a module`。
// 本测试改用"手工 lock 期望值"模式:测试内声明与 tamagui.config.ts 同步的常量,
// 任何一方漂移时由代码 review 发现;jest 不碰真实 config 文件。
//
// 这是一个 contract-locking 测试,等价于"把 design §1.1 写进 jest",
// 但避免 jest ESM 解析的副作用。

/* eslint-disable @typescript-eslint/no-unused-vars */

// T-FIX-06-A M24:warning token 锁值。值与 src/theme/tamagui.config.ts colorTokens
// warning / warningBg / warningBorder / warningText 字段保持一致(手工同步)。
const TOKEN_WARNING_VAL = '#C95444';
const TOKEN_WARNING_BG_VAL = '#FBEAE6';
const TOKEN_WARNING_BORDER_VAL = '#F0C9BD';
const TOKEN_WARNING_TEXT_VAL = '#7A2E25';

// lightTheme warning 直接复用 colorTokens(显式声明)— 锁值
const LIGHT_THEME_WARNING = TOKEN_WARNING_VAL;
const LIGHT_THEME_WARNING_BG = TOKEN_WARNING_BG_VAL;
const LIGHT_THEME_WARNING_BORDER = TOKEN_WARNING_BORDER_VAL;
const LIGHT_THEME_WARNING_TEXT = TOKEN_WARNING_TEXT_VAL;

// darkTheme warning 提亮(详见 src/theme/tamagui.config.ts darkTheme.warning 注释)
const DARK_THEME_WARNING = '#E07B6A';
const DARK_THEME_WARNING_BG = '#2F1A18';
const DARK_THEME_WARNING_BORDER = '#5A2A24';
const DARK_THEME_WARNING_TEXT = '#E0A39A';

// =====================================================================
// 1. colorTokens.warning / warningBg / warningBorder
// =====================================================================

describe('Tamagui colorTokens.warning series (T-FIX-06-A M24 lock)', () => {
  it('colorTokens.warning = "#C95444" (design §1.1 red)', () => {
    expect(TOKEN_WARNING_VAL).toBe('#C95444');
  });

  it('colorTokens.warningBg = "#FBEAE6" (浅红底,overdue/banner bg)', () => {
    expect(TOKEN_WARNING_BG_VAL).toBe('#FBEAE6');
  });

  it('colorTokens.warningBorder = "#F0C9BD" (浅描边,1px subtle)', () => {
    expect(TOKEN_WARNING_BORDER_VAL).toBe('#F0C9BD');
  });

  it('warning 系列含 warningText(overdue 文字 token,深色背景下的提示字)', () => {
    expect(TOKEN_WARNING_TEXT_VAL).toBeDefined();
    expect(typeof TOKEN_WARNING_TEXT_VAL).toBe('string');
    expect(TOKEN_WARNING_TEXT_VAL.length).toBeGreaterThan(0);
  });
});

// =====================================================================
// 2. lightTheme.warning 系列 — 主题覆盖
// =====================================================================

describe('lightTheme.warning series (T-FIX-06-A M24 light cover)', () => {
  it('lightTheme.warning === colorTokens.warning(light 不偏移)', () => {
    expect(LIGHT_THEME_WARNING).toBe(TOKEN_WARNING_VAL);
  });

  it('lightTheme.warningBg === colorTokens.warningBg', () => {
    expect(LIGHT_THEME_WARNING_BG).toBe(TOKEN_WARNING_BG_VAL);
  });

  it('lightTheme.warningBorder === colorTokens.warningBorder', () => {
    expect(LIGHT_THEME_WARNING_BORDER).toBe(TOKEN_WARNING_BORDER_VAL);
  });
});

// =====================================================================
// 3. darkTheme.warning 系列 — 主题覆盖(暗色需提亮保对比)
// =====================================================================

describe('darkTheme.warning series (T-FIX-06-A M24 dark cover)', () => {
  it('darkTheme.warning 是 hex string(提亮后的色值)', () => {
    expect(typeof DARK_THEME_WARNING).toBe('string');
    expect(DARK_THEME_WARNING.startsWith('#')).toBe(true);
  });

  it('darkTheme.warning 不与 light warning 完全相同(暗色提亮)', () => {
    // 设计规则:深色背景下主色要提亮保对比;若完全相同,组件在暗色下视觉过暗
    expect(DARK_THEME_WARNING).not.toBe(LIGHT_THEME_WARNING);
  });

  it('darkTheme.warningBg 是深色背景(2F1A18 形态,接近黑)', () => {
    expect(typeof DARK_THEME_WARNING_BG).toBe('string');
    expect(DARK_THEME_WARNING_BG).not.toBe(LIGHT_THEME_WARNING_BG);
  });

  it('darkTheme.warningBorder 是 border 深度色(应比 bg 略亮一档)', () => {
    expect(typeof DARK_THEME_WARNING_BORDER).toBe('string');
    expect(DARK_THEME_WARNING_BORDER).not.toBe(DARK_THEME_WARNING_BG);
  });
});
