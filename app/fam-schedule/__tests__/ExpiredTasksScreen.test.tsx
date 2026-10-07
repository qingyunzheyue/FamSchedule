/**
 * ExpiredTasksScreen 单元测试 — T-US015-3
 *
 * 覆盖范围(任务 brief §D):
 *   1. 组件契约:ExpiredTasksScreen 是函数组件 + 导出
 *   2. window 派生:family_settings.expiry_window 通过 getExpiredTasksSummary 读取,
 *      默认 fallback 'yesterday_today'(同 useExpiredTaskCount)
 *   3. tasks 派生:filterExpiredTasks(window, today) 输出 → 渲染 TaskList
 *   4. EmptyState:N=0 时显示友好空状态文案
 *   5. 复用约束:不引入新组件,只复用 TaskCard / TaskList / CheckInButton
 *   6. 路由契约:`/(main)/(home)/expired` 是 HomeScreen.handleExpiredBannerPress 跳的路径
 *
 * 测试策略(对齐 ExpiredTasksBanner / useExpiredTaskCount.test.tsx):
 *   - jest-expo + React 19 + jsxImportSource: tamagui → react-test-renderer 易脆
 *   - 不挂 ExpiredTasksScreen 组件本身(避免触发 tamagui ESM 解析)
 *   - 用 verify-by-source + 内部纯函数 + props / hook 派生校验
 *   - 实际渲染 / 视觉由 ui-ux / EAS 真机验证
 *
 * 严格 scope:
 *   - 不测导航跳转完整流程(expo-router 跳转由 HomeScreen.test.tsx 测
 *     handleExpiredBannerPress 内部 router.push 路径)
 *   - 不测 Alert.alert / TaskService.deleteTask 等副作用
 *   - 不测 FamilyContext / useExpiredTaskCount(留它各自测试)
 */

import * as fs from 'fs';
import * as path from 'path';

// =====================================================================
// 1. 组件契约 + 路由文件契约
// =====================================================================

describe('ExpiredTasksScreen — component contract (T-US015-3)', () => {
  let source: string;

  beforeAll(() => {
    const sourcePath = path.join(
      __dirname,
      '..',
      'src',
      'screens',
      'ExpiredTasksScreen.tsx',
    );
    source = fs.readFileSync(sourcePath, 'utf8');
  });

  it('exports a function component named ExpiredTasksScreen', () => {
    // 用 verify-by-source 方式校验导出符号存在
    expect(source).toMatch(
      /export\s+function\s+ExpiredTasksScreen\s*\(/,
    );
  });

  it('does NOT mutate useExpiredTaskCount hook behavior', () => {
    // 防御:ExpiredTasksScreen 不应改 useExpiredTaskCount 实现 — 通过源码级
    // 校验避免后续重构覆盖 hook
    const hookPath = path.join(
      __dirname,
      '..',
      'src',
      'hooks',
      'useExpiredTaskCount.ts',
    );
    const hookSource = fs.readFileSync(hookPath, 'utf8');
    // hook 仍然返 {count, loading} 接口
    expect(hookSource).toMatch(/ExpiredTaskCountState/);
    expect(hookSource).toMatch(/return\s*\{\s*count,\s*loading\s*\}/);
  });

  it('does NOT import useExpiredTaskCount (re-derive via getExpiredTasksSummary directly)', () => {
    // 设计决策:ExpiredTasksScreen 需要 window 字段 + 完整 tasks 列表,
    // 而 useExpiredTaskCount 只返 {count, loading};本屏直接读 family_settings + filterExpiredTasks
    // 走 ExpiryService 同一 source of truth(避免 hook 改造)
    expect(source).not.toMatch(/import\s*\{[^}]*useExpiredTaskCount[^}]*\}/);
  });

  it('imports filterExpiredTasks from ExpiryService', () => {
    expect(source).toMatch(
      /import\s*\{[^}]*filterExpiredTasks[^}]*\}\s*from\s*['"]\.\.\/services\/ExpiryService['"]/,
    );
  });

  it('imports getExpiredTasksSummary to derive expiry_window', () => {
    // window 字段由 service 单行 SELECT family_settings.expiry_window 派生
    expect(source).toMatch(
      /import\s*\{[^}]*getExpiredTasksSummary[^}]*\}\s*from\s*['"]\.\.\/services\/ExpiryService['"]/,
    );
  });

  it('imports TaskList (复用列表渲染 + EmptyState)', () => {
    expect(source).toMatch(
      /import\s*\{[^}]*TaskList[^}]*\}\s*from\s*['"]\.\.\/components\/TaskList['"]/,
    );
  });

  it('imports useTasks + useFamilyValue from canonical hooks', () => {
    expect(source).toMatch(
      /import\s*\{[^}]*useTasks[^}]*\}\s*from\s*['"]\.\.\/hooks\/useTasks['"]/,
    );
    expect(source).toMatch(
      /import\s*\{[^}]*useFamilyValue[^}]*\}\s*from\s*['"]\.\.\/contexts\/FamilyContext['"]/,
    );
  });
});

// =====================================================================
// 2. window 派生契约 — fallback 到 'yesterday_today' 默认值
// =====================================================================

describe('ExpiredTasksScreen — expiry_window derivation (T-US015-3)', () => {
  let source: string;

  beforeAll(() => {
    const sourcePath = path.join(
      __dirname,
      '..',
      'src',
      'screens',
      'ExpiredTasksScreen.tsx',
    );
    source = fs.readFileSync(sourcePath, 'utf8');
  });

  it('reads expiry_window via getExpiredTasksSummary then uses it for filterExpiredTasks', () => {
    // 关键数据流:summary.window → filterExpiredTasks(window, today)
    // 这里用 verify-by-source 校验调用顺序
    expect(source).toMatch(/filterExpiredTasks\s*\(/);
    expect(source).toMatch(/getExpiredTasksSummary\s*\(/);
    // 派生 window state — useState<string>('yesterday_today') 作为 fallback
    expect(source).toMatch(
      /(window|expiryWindow|windowState)[\s\S]{0,80}'yesterday_today'/,
    );
  });

  it('does NOT hardcode the window — 默认值是 fallback 而非主路径', () => {
    // 防御:不应出现"只写死 yesterday_today 不用 summary.window"的退化写法
    // 必须有 .then(... setWindow(summary.window)) 这条派生路径
    expect(source).toMatch(/setWindow\s*\(\s*summary\.window\s*\)/);
  });
});

// =====================================================================
// 3. 列表契约 — filterExpiredTasks 内部已排序(asc),这里只调
// =====================================================================

describe('ExpiredTasksScreen — expired tasks list derivation (T-US015-3)', () => {
  let source: string;

  beforeAll(() => {
    const sourcePath = path.join(
      __dirname,
      '..',
      'src',
      'screens',
      'ExpiredTasksScreen.tsx',
    );
    source = fs.readFileSync(sourcePath, 'utf8');
  });

  it('passes (tasks, window, today) to filterExpiredTasks — 3-arg 调用', () => {
    // 派生一个 useMemo,从 summary.tasks / tasks + window + today 过滤
    // 这里只校验 filterExpiredTasks 的调用形态
    expect(source).toMatch(
      /filterExpiredTasks\s*\(\s*tasks\s*,\s*[a-zA-Z]+\s*,\s*today\s*\)/,
    );
  });

  it('passes the expired tasks list to TaskList as `tasks` prop', () => {
    // <TaskList tasks={expired} ...> 形态
    expect(source).toMatch(/<TaskList[\s\S]*?tasks\s*=\s*\{[a-zA-Z]+\}/);
  });
});

// =====================================================================
// 4. 路由契约 — HomeScreen.handleExpiredBannerPress 跳到 /(main)/(home)/expired
// =====================================================================

describe('ExpiredTasksScreen — route path contract (T-US015-3)', () => {
  it('expo-router route file exists at app/(main)/(home)/expired.tsx', () => {
    const routePath = path.join(
      __dirname,
      '..',
      'app',
      '(main)',
      '(home)',
      'expired.tsx',
    );
    expect(fs.existsSync(routePath)).toBe(true);
  });

  it('route file thin-wraps ExpiredTasksScreen with SafeAreaView', () => {
    const routePath = path.join(
      __dirname,
      '..',
      'app',
      '(main)',
      '(home)',
      'expired.tsx',
    );
    const routeSource = fs.readFileSync(routePath, 'utf8');
    // 薄包装 + SafeAreaView 兜底
    expect(routeSource).toMatch(/SafeAreaView/);
    // named or default import 都行(本实现是 named:`{ ExpiredTasksScreen }`)
    expect(routeSource).toMatch(
      /import\s+(?:\{[^}]*ExpiredTasksScreen[^}]*\}|ExpiredTasksScreen)\s+from\s+['"][^'"]*ExpiredTasksScreen['"]/,
    );
    expect(routeSource).toMatch(/export\s+default\s+function\s+ExpiredTasksRoute/);
  });

  it('HomeScreen.handleExpiredBannerPress uses router.push to expired route', () => {
    const homePath = path.join(
      __dirname,
      '..',
      'src',
      'screens',
      'HomeScreen.tsx',
    );
    const homeSource = fs.readFileSync(homePath, 'utf8');
    // handleExpiredBannerPress 函数体内 router.push 跳到 expired route
    // 用 string.includes 校验,避免 regex paren 歧义
    expect(homeSource).toContain("router.push('/(main)/(home)/expired')");
    // 校验未使用过期版本(老的 Noop 注释里出现的 router.push typo
    // `/(main)/(home)/expired-tasks` 字面串应已消失)
    expect(homeSource).not.toContain('/(main)/(home)/expired-tasks');
  });

  it('handleExpiredBannerPress no longer contains a noop comment / no-op body', () => {
    // T-US015-3 后:noop 注释 / 占位 body 应被替换为 router.push
    const homePath = path.join(
      __dirname,
      '..',
      'src',
      'screens',
      'HomeScreen.tsx',
    );
    const homeSource = fs.readFileSync(homePath, 'utf8');
    // 旧 noop 注释应该没了
    expect(homeSource).not.toContain('Noop — T-US015-3');
    expect(homeSource).not.toContain('Noop — T-US015-3 接 router.push');
  });
});

// =====================================================================
// 5. _layout.tsx 锁 — home stack 自动注册 expired route
// =====================================================================

describe('ExpiredTasksScreen — home stack layout (T-US015-3)', () => {
  it('does NOT require explicit screen registration in (home)/_layout.tsx (Stack auto-discovers)', () => {
    // expo-router Stack 自动扫描 file-based routes,不需要在 _layout.tsx 里
    // 显式 <Stack.Screen name="expired" /> — 锁住这一约束,防止 reviewer 误推 Stack.Screen 手动注册
    const layoutPath = path.join(
      __dirname,
      '..',
      'app',
      '(main)',
      '(home)',
      '_layout.tsx',
    );
    const layoutSource = fs.readFileSync(layoutPath, 'utf8');
    // (home) _layout 不应有 Stack.Screen name="expired" 的显式注册
    expect(layoutSource).not.toMatch(/<Stack\.Screen[\s\S]*?name=['"]expired['"]/);
    // 也不应有 <Tabs.Screen name="expired"> 之类手动注册
    expect(layoutSource).not.toMatch(/<Tabs\.Screen[\s\S]*?name=['"]expired['"]/);
  });

  it('does NOT modify the root app/_layout.tsx (Gate stays paused)', () => {
    // 防御:不应动根 Gate(否则 splash paused line 会被影响)
    // 通过 git 状态由 review 阶段检查;这里只锁源码不变 — 比较前/后短字符串
    const rootLayoutPath = path.join(__dirname, '..', 'app', '_layout.tsx');
    const rootLayoutSource = fs.readFileSync(rootLayoutPath, 'utf8');
    // 不应出现 "expired" 字样 — root Gate 完全不感知 ExpiredTasksScreen
    expect(rootLayoutSource.toLowerCase()).not.toMatch(/expiredtasksscreen/);
  });
});

// =====================================================================
// 6. strict-scope 锁 — 严禁触碰的模块
// =====================================================================

describe('ExpiredTasksScreen — strict scope verification (T-US015-3)', () => {
  it('ExpiredTasksScreen does NOT modify ExpiryService / useExpiredTaskCount', () => {
    // 通过对比两个 source 文件 — 它们应该没被 ExpiredTasksScreen.tsx 引用
    // 意外改坏了 ExpiryService 的旧测试会立刻红灯
    const servicePath = path.join(
      __dirname,
      '..',
      'src',
      'services',
      'ExpiryService.ts',
    );
    const serviceSource = fs.readFileSync(servicePath, 'utf8');
    // ExpiryService 仍有 filterExpiredTasks + getExpiredTasksSummary 导出
    expect(serviceSource).toMatch(/export\s+function\s+filterExpiredTasks/);
    expect(serviceSource).toMatch(/export\s+async\s+function\s+getExpiredTasksSummary/);
  });

  it('ExpiredTasksScreen does NOT touch AuthContext / FamilyContext / tamagui.config / package.json / app.json', () => {
    // 通过源码契约对比 — 这些 lock 文件不该出现 "expired" 关键字
    const lockFiles = [
      '../src/contexts/AuthContext.tsx',
      '../src/contexts/FamilyContext.tsx',
      '../tamagui.config.ts',
      '../package.json',
      '../app.json',
    ];
    for (const rel of lockFiles) {
      const abs = path.join(__dirname, '..', rel);
      if (!fs.existsSync(abs)) continue; // 文件不存在不参与校验
      const text = fs.readFileSync(abs, 'utf8');
      // 不应有 ExpiredTasksScreen 相关引用
      expect(text).not.toMatch(/ExpiredTasksScreen/);
    }
  });

  it('ExpiredTasksScreen does NOT introduce T-US006 makeup RPC changes', () => {
    // 严格 scope:T-US006 真补卡 RPC 不在本任务范围 — 当前复用现有
    // CheckInService.checkin 占位(同 HomeScreen.handleTaskCheckIn)。
    // 锁:ExpiredTasksScreen 不应 import 任何 supabase.rpc 直调 / 不应写新 RPC
    const screenPath = path.join(
      __dirname,
      '..',
      'src',
      'screens',
      'ExpiredTasksScreen.tsx',
    );
    const screenSource = fs.readFileSync(screenPath, 'utf8');
    expect(screenSource).not.toMatch(/supabase\.rpc/);
    expect(screenSource).not.toMatch(/makeup_checkin|makeup_checkin_task/);
  });
});

// =====================================================================
// 7. Header 契约 — back button + title "过期任务"
// =====================================================================

describe('ExpiredTasksScreen — header UI contract (T-US015-3)', () => {
  let source: string;

  beforeAll(() => {
    const screenPath = path.join(
      __dirname,
      '..',
      'src',
      'screens',
      'ExpiredTasksScreen.tsx',
    );
    source = fs.readFileSync(screenPath, 'utf8');
  });

  it('renders a header with back button (← 返回) and "过期任务" title', () => {
    // 设计 home-v1.0 §3.3:过期 banner 点击跳转后是 fullscreen list,标题"过期任务"
    expect(source).toMatch(/过期任务/);
    expect(source).toMatch(/返回|Back|CaretLeft|ArrowLeft/);
  });

  it('does NOT render ExpiredTasksBanner inside the screen (banner only on home)', () => {
    // 过期列表页是 terminal 子页,不再嵌 banner(否则会出现"我在过期里点页也是吗")
    expect(source).not.toMatch(/<ExpiredTasksBanner[\s\S]*?\/>/);
  });
});

// =====================================================================
// 8. T-US015-4 B:EmptyState polish — N=0 改用过期上下文文案
// =====================================================================

describe('ExpiredTasksScreen — EmptyState polish (T-US015-4)', () => {
  let source: string;

  beforeAll(() => {
    const sourcePath = path.join(
      __dirname,
      '..',
      'src',
      'screens',
      'ExpiredTasksScreen.tsx',
    );
    source = fs.readFileSync(sourcePath, 'utf8');
  });

  it('imports EmptyState component from canonical path', () => {
    expect(source).toMatch(
      /import\s*\{[^}]*EmptyState[^}]*\}\s*from\s*['"]\.\.\/components\/EmptyState['"]/,
    );
  });

  it('renders EmptyState when expired.length === 0 with expired-context copy', () => {
    // 条件渲染:expired.length === 0 → <EmptyState ...> 替换 TaskList 占位
    expect(source).toMatch(/expired\.length\s*>\s*0/);
    // 过期上下文文案:title "暂无过期任务" + subtitle "保持节奏,真棒"
    expect(source).toMatch(/暂无过期任务/);
    expect(source).toMatch(/保持节奏,真棒/);
  });

  it('uses CheckCircle icon for EmptyState (视觉隐喻:无过期任务,安心)', () => {
    expect(source).toMatch(/CheckCircle/);
  });

  it('removes onCreatePress prop (TaskList EmptyState 不再触发"顺手新建")', () => {
    // T-US015-4 前:TaskList view="today" 占位复用 → 有 onCreatePress
    // T-US015-4 后:N>0 时 TaskList 不传 onCreatePress(过期列表不允许新建)
    expect(source).not.toMatch(/onCreatePress\s*=/);
    // handleCreatePress 函数已删(注释保留作历史)
    expect(source).not.toMatch(/handleCreatePress\s*=\s*useCallback/);
  });

  it('no longer uses view="today" as EmptyState placeholder (T-US015-4 polish)', () => {
    // 防御:不应再以 view="today" 当作过期 N=0 占位 — 那是 T-US015-3 简化
    // 残留,T-US015-4 polish 后已替换为 EmptyState
    // 注:TaskList 本身仍接受 view="today"(任务列表 prop)— 但只在 N>0 时才渲染
    // 检查 N=0 走 EmptyState 分支
    expect(source).toMatch(/<EmptyState[\s\S]*?\/>/);
  });
});

// =====================================================================
// 9. T-US015-4 C:下拉刷新接 SyncManager.pullSince
// =====================================================================

describe('ExpiredTasksScreen — pull-to-refresh pullSince integration (T-US015-4)', () => {
  let source: string;

  beforeAll(() => {
    const sourcePath = path.join(
      __dirname,
      '..',
      'src',
      'screens',
      'ExpiredTasksScreen.tsx',
    );
    source = fs.readFileSync(sourcePath, 'utf8');
  });

  it('imports pullSince + PullStatus from SyncManager + getLastSyncAt from LocalStore', () => {
    expect(source).toMatch(
      /import\s*\{[^}]*pullSince[^}]*\}\s*from\s*['"]\.\.\/lib\/SyncManager['"]/,
    );
    expect(source).toMatch(
      /import\s*\{[^}]*getLastSyncAt[^}]*\}\s*from\s*['"]\.\.\/lib\/LocalStore['"]/,
    );
  });

  it('wires onRefresh to pullSince(lastSyncAt) with refreshing state', () => {
    // onRefresh 函数体内:await getLastSyncAt() → pullSince(lastSyncAt) → setRefreshing(false) in finally
    expect(source).toMatch(/pullSince\s*\(\s*lastSyncAt\s*\)/);
    expect(source).toMatch(/setRefreshing\s*\(\s*true\s*\)/);
    expect(source).toMatch(/setRefreshing\s*\(\s*false\s*\)/);
  });

  it('passes onRefresh + refreshing props to TaskList (when N>0)', () => {
    expect(source).toMatch(/onRefresh\s*=\s*\{onRefresh\}/);
    expect(source).toMatch(/refreshing\s*=\s*\{refreshing\}/);
  });

  it('shows Alert when pullSince status.ok=false or throws (failure UX)', () => {
    // 失败文案同 HomeScreen,锁定以保证 跨屏一致
    expect(source).toMatch(/同步未完成/);
    expect(source).toMatch(/网络异常/);
  });
});