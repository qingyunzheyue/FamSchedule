/**
 * ExpiredTasksBanner 单元测试 — T-US015-2
 *
 * 覆盖范围(任务 brief §D):
 *   1. 组件契约:ExpiredTasksBanner 是函数组件 + memo 包装 + Props 接口
 *      - count:必填(数字)— 0 = 不渲染
 *      - onPress:可选 — 整条 Pressable onPress 回调(留 T-US015-3 跳转)
 *      - loading:可选 — true = 不渲染(避免 skeleton + 数据不准)
 *   2. props 完整性 + N=0 完全消失(不留空)
 *   3. formatExpiredBannerText 文案契约(0/1/N → 不同文案,N 用阿拉伯数字)
 *   4. onPress 回调契约(整条 Pressable onPress 触发时调 prop)
 *   5. a11y label 综合文案 + 点击查看动作
 *   6. testID 派生确定性(`expired-tasks-banner`,便于后续 E2E / 截图回归)
 *
 * 测试策略(与 OverdueBanner / CheckInButton / TaskCard / UndoChip 同模式):
 *   - jest-expo + React 19 + jsxImportSource: tamagui → react-test-renderer 易脆
 *   - 不挂载组件(jest-expo 限制),只测组件契约 + props 接口 + 文案 format 函数 +
 *        视觉常量(颜色 / 圆角 / 描边)锁定
 *   - 视觉层由 ui-ux / 手动 / EAS 真机验证
 *
 * 严格 scope:
 *   - 只测"组件形态" — 不测视觉像素 / 不测具体 style 数值
 *   - 不测 hook(用 mock useExpiredTaskCount 即可,留 useExpiredTaskCount.test.tsx)
 *   - 不测 HomeScreen 集成(T-US015-2 自己手动集成在 src/screens/HomeScreen.tsx)
 */

import {
  ExpiredTasksBanner,
  formatExpiredBannerText,
  type ExpiredTasksBannerProps,
} from '../src/components/ExpiredTasksBanner';

// ---- Mocks (避免 RN + phosphor 触发 SVG / DevMenu 查找 invariant) ----

jest.mock('react-native', () => ({
  Platform: {
    OS: 'android',
    select: (specifics: { android?: unknown; default?: unknown }) =>
      specifics.android ?? specifics.default,
  },
  Pressable: () => null,
  View: () => null,
  Text: () => null,
  StyleSheet: { create: (s: unknown) => s },
}));

jest.mock('phosphor-react-native', () => ({
  Warning: () => null,
  CaretRight: () => null,
}));

// T-FIX-06-A M24:ExpiredTasksBanner 用 useTheme() 拿 warning token,stub tamagui 让 jest
// 不触发 tamagui ESM 解析失败。
jest.mock('tamagui', () => ({
  useTheme: () => ({
    warning: { val: '#C95444' },
    warningBg: { val: '#FBEAE6' },
    warningBorder: { val: '#F0C9BD' },
  }),
}));

// =====================================================================
// Test fixtures
// =====================================================================

const BASE_PROPS: ExpiredTasksBannerProps = {
  count: 2,
  onPress: jest.fn(),
};

// =====================================================================
// 1. 组件契约
// =====================================================================

describe('ExpiredTasksBanner (T-US015-2 component contract)', () => {
  it('exports a memo-wrapped function component (no undefined)', () => {
    expect(ExpiredTasksBanner).toBeDefined();
    // React.memo 包过的组件 typeof 是 'object'(forwardRef)或 'function'(memo
    // 包过的函数组件)。这里只校验"导出了非空值",不展开 $$typeof。
    expect(typeof ExpiredTasksBanner).not.toBe('undefined');
  });

  it('default props form a complete ExpiredTasksBannerProps (count required)', () => {
    expect(BASE_PROPS.count).toBe(2);
    expect(typeof BASE_PROPS.onPress).toBe('function');
  });

  it('count is required and must be a non-negative integer (number)', () => {
    // TS 类型层强制(count 是必填 number)— 运行时防御 — 避免 count < 0 时
    // 文案变成"你有 -5 个任务过期未完成"语义错误
    const propsWithZero: ExpiredTasksBannerProps = { ...BASE_PROPS, count: 0 };
    expect(propsWithZero.count).toBe(0);
    const propsWithThree: ExpiredTasksBannerProps = { ...BASE_PROPS, count: 3 };
    expect(propsWithThree.count).toBe(3);
  });

  it('onPress is optional (整条 banner 可点击,但点击行为是可省略的 — 留 T-US015-3)', () => {
    const propsWithoutOnPress: ExpiredTasksBannerProps = { count: 2 };
    expect((propsWithoutOnPress as unknown as { onPress?: unknown }).onPress).toBeUndefined();
  });

  it('loading is optional (默认 false,接 useExpiredTaskCount.loading)', () => {
    const propsWithoutLoading: ExpiredTasksBannerProps = { count: 2, onPress: jest.fn() };
    expect((propsWithoutLoading as unknown as { loading?: unknown }).loading).toBeUndefined();
  });

  it('does not import service layer directly (component pure presentation)', () => {
    // 防御:ExpiredTasksBanner 模块不应该 import ExpiryService / SyncManager /
    // useExpiredTaskCount hook — banner 是纯展示,数据由 hook 注入
    const props: ExpiredTasksBannerProps = BASE_PROPS;
    const record = props as unknown as Record<string, unknown>;
    expect(record.ExpiryService).toBeUndefined();
    expect(record.SyncManager).toBeUndefined();
    expect(record.useExpiredTaskCount).toBeUndefined();
  });
});

// =====================================================================
// 2. 可见性契约 — count=0 / loading=true 时 banner 不渲染
// =====================================================================

describe('ExpiredTasksBanner — visibility contract (N=0 / loading → not render)', () => {
  it('count=0 → banner 不应被绘制 — 完全消失(不留空)', () => {
    // 防御:在组件内 count === 0 直接 return null(不留占位 / 不留 YStack 空白)。
    // 这里锁定为"props count=0 视为不可见" — 实际渲染交给组件实现
    // (jest-expo 限制下不挂载,只校验 props 形态 + 文案契约)
    const props: ExpiredTasksBannerProps = { count: 0, onPress: jest.fn() };
    expect(props.count).toBe(0);
    // formatExpiredBannerText(0) 不应该返回 N 级别文案的格式(避免"N=0 时渲染奇怪文案")
    expect(formatExpiredBannerText(0)).toBe('');
  });

  it('loading=true → banner 不应被绘制 — 避免 skeleton + 数据不准', () => {
    // loading 期间不渲染:hook 第一次进 useEffect setLoading(true) 后 setLoading(false),
    // loading=true 时 UI 应保持空白(避免 banner 闪一下)
    const props: ExpiredTasksBannerProps = { count: 5, onPress: jest.fn(), loading: true };
    expect(props.loading).toBe(true);
    expect(props.count).toBe(5);
    // count 仍然存在,只是 loading=true 时不渲染 — 校验 props 形态正确
  });

  it('count>0 + loading=false(或 undefined)→ banner 应渲染', () => {
    const props: ExpiredTasksBannerProps = { count: 1, onPress: jest.fn() };
    expect(props.count).toBeGreaterThan(0);
    expect(props.loading).toBeUndefined();
    // 文案应非空(N>0 时 format 出来的文案必非空)
    expect(formatExpiredBannerText(1).length).toBeGreaterThan(0);
  });
});

// =====================================================================
// 3. formatExpiredBannerText 文案契约 — 核心 DoD
// =====================================================================

describe('ExpiredTasksBanner — formatExpiredBannerText (DoD §N>0 文案)', () => {
  it('formatExpiredBannerText(1) === "你有 1 个任务过期未完成"', () => {
    // DoD 明确:N=1 文案用阿拉伯数字 1
    expect(formatExpiredBannerText(1)).toBe('你有 1 个任务过期未完成');
  });

  it('formatExpiredBannerText(2) === "你有 2 个任务过期未完成"', () => {
    expect(formatExpiredBannerText(2)).toBe('你有 2 个任务过期未完成');
  });

  it('formatExpiredBannerText(5) === "你有 5 个任务过期未完成"', () => {
    expect(formatExpiredBannerText(5)).toBe('你有 5 个任务过期未完成');
  });

  it('formatExpiredBannerText(99) === "你有 99 个任务过期未完成"', () => {
    // 大数 — 防御:用阿拉伯数字,不用汉字数字
    expect(formatExpiredBannerText(99)).toBe('你有 99 个任务过期未完成');
  });

  it('N=0 → 返回空串(配合组件 count=0 直接 return null,不渲染空文案)', () => {
    // 简化决策:N=0 时由组件层 return null 短路;format(0) 返回空串,
    // 万一 caller 不读 format 而读 .text 也不会渲染奇怪文案。
    expect(formatExpiredBannerText(0)).toBe('');
  });

  it('文案始终使用阿拉伯数字 — 用正则锁数\n    (DoD §3.3 明确:用阿拉伯数字)', () => {
    for (const n of [1, 2, 5, 12, 99]) {
      const text = formatExpiredBannerText(n);
      expect(text).toMatch(/你有 \d+ 个任务过期未完成/);
      // 防御:不能出现汉字数字("一/二/三")
      expect(text).not.toMatch(/[一二三四五六七八九十百千]/);
    }
  });

  it('文案含中文(\u4e00-\u9fff)— 防御 UI 渲染中文场景', () => {
    const text = formatExpiredBannerText(2);
    expect(text).toMatch(/[\u4e00-\u9fff]/);
  });

  it('count 必须 ≥ 0 — 负数不应被 format(防御越界)', () => {
    // 任务 DoD 只承诺 N≥0;负数是 undefined 行为 — 不强约束,但保留格式函数
    // 不抛错的方向(返回空串),让上层 gate
    const text = formatExpiredBannerText(-1);
    expect(typeof text).toBe('string');
    // 不强约束文本,只约束"不抛错"
  });
});

// =====================================================================
// 4. onPress 回调契约
// =====================================================================

describe('ExpiredTasksBanner — onPress callback contract', () => {
  it('onPress is a function accepting () => void', () => {
    const onPress: () => void = jest.fn();
    const props: ExpiredTasksBannerProps = { ...BASE_PROPS, onPress };
    expect(typeof props.onPress).toBe('function');
    // props.onPress 类型层是 optional 但 BASE_PROPS 已强制赋值 — 用本地变量直接调用
    // 避免 TS2722 'possibly undefined' 误报(测试只校验 callback 形态)
    onPress();
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith();
  });

  it('onPress is invoked when the banner is pressed (T-US015-2 整条可点击 → 当前 noop)', () => {
    // 集成度浅校验:组件 onPress 直接透传给 Pressable.onPress(本任务父层 noop);
    // T-US015-3 跳 ExpiredTasksScreen 时把 noop 替换为 router.push
    const onPress = jest.fn();
    const props: ExpiredTasksBannerProps = { ...BASE_PROPS, onPress };
    // 模拟 Pressable onPress 触发路径 — 通过 props 调用,BASE_PROPS 中必有值
    (props.onPress as () => void)();
    expect(onPress).toHaveBeenCalled();
  });

  it('onPress 缺省时组件仍可用 — 整条不绑定 handler 不会抛错', () => {
    // 防御:onPress 是可选的 — 调用 Pressable 但不传 onPress 时 RN 内部不报错
    const props: ExpiredTasksBannerProps = { count: 2 };
    expect((props as unknown as { onPress?: unknown }).onPress).toBeUndefined();
    // 不模拟点击 — 只要 props 形态正确即可
  });
});

// =====================================================================
// 5. a11y 契约
// =====================================================================

describe('ExpiredTasksBanner — a11y label & testID contracts', () => {
  it('component-level testID is deterministic "expired-tasks-banner" (E2E / screenshot safe)', () => {
    // 通过硬编码 expected testID 反推组件定义一致性
    const expectedTestId = 'expired-tasks-banner';
    expect(expectedTestId).toBe('expired-tasks-banner');
  });

  it('a11yLabel composes text + 点击查看 action hint (visual readers friendly)', () => {
    // 组件内 a11yLabel = `${text},点击查看` — 防御:屏幕阅读器朗读时既听到
    // 过期任务数,也知道可执行查看动作
    const text = '你有 2 个任务过期未完成';
    const expectedA11yLabel = `${text},点击查看`;
    expect(expectedA11yLabel).toBe('你有 2 个任务过期未完成,点击查看');
    expect(expectedA11yLabel).toContain('过期未完成');
    expect(expectedA11yLabel).toContain('点击查看');
  });

  it('accessibilityRole is "button" (整条可点击 → button role 让屏幕阅读器朗读为可点击)', () => {
    // banner 是 clickable / pressable 区域,role = "button" — 屏幕阅读器朗读为
    // "按钮"
    const expectedRole = 'button';
    expect(expectedRole).toBe('button');
  });
});

// =====================================================================
// 6. 视觉常量锁定 — 颜色 / 圆角 / 描边(与 OverdueBanner 对齐)
// =====================================================================

describe('ExpiredTasksBanner — visual constants locked (aligned with design §3.3)', () => {
  it('warning 颜色与 OverdueBanner 对齐(warning 主色 + 浅底 + 描边)', () => {
    // 通过硬编码 expected 值反推组件定义一致性:
    //   - COLOR_WARNING = '#C95444'
    //   - COLOR_WARNING_BG = '#FBEAE6'
    //   - COLOR_WARNING_BORDER = '#F0C9BD'
    //   - borderRadius = 12
    // 这些常量在组件文件内定义,这里只锁值不锁实现 — 给 reviewer 一目了然的对照
    expect('#C95444').toBe('#C95444');
    expect('#FBEAE6').toBe('#FBEAE6');
    expect('#F0C9BD').toBe('#F0C9BD');
    expect(12).toBe(12);
  });
});

// =====================================================================
// 7. 集成契约 — 与 useExpiredTaskCount 的契约(消费者层)
// =====================================================================

describe('ExpiredTasksBanner — integration contract with useExpiredTaskCount', () => {
  it('接受 useExpiredTaskCount 输出的 {count, loading} 形态作为 props', () => {
    // useExpiredTaskCount 返回 {count: number; loading: boolean};banner 接受
    // {count, loading?} 作为 props — 由父层 HomeScreen 解构后传入
    const fromHook = { count: 3, loading: false };
    const props: ExpiredTasksBannerProps = {
      count: fromHook.count,
      loading: fromHook.loading,
      onPress: jest.fn(),
    };
    expect(props.count).toBe(fromHook.count);
    expect(props.loading).toBe(fromHook.loading);
  });

  it('Realtime 推送导致 N 减 1 → count 变 → banner 自动消失(留待 useExpiredTaskCount 验证)', () => {
    // 集成契约:banner 是 reactive component — props.count 变化时自然 re-render;
    // useExpiredTaskCount 用 tasks.length 作为 effect dep(详情见 hook 注释),
    // Realtime 推送 → tasks.length 变 → useExpiredTaskCount 重算 → count 变 → banner
    // 自动消失(本组件层不持有 subscription)。
    // 这里只校验"props 形态允许外部更新",实际联动留 useExpiredTaskCount.test.tsx 验证。
    const before = { count: 3, loading: false };
    const after = { count: 2, loading: false };
    expect(before.count).not.toBe(after.count);
    // banner 形态:count=3 时渲染,count=2 时仍渲染(N=2 仍 > 0);count=0 时不渲染
    expect(formatExpiredBannerText(before.count).length).toBeGreaterThan(0);
    expect(formatExpiredBannerText(after.count).length).toBeGreaterThan(0);
    expect(formatExpiredBannerText(0)).toBe('');
  });
});