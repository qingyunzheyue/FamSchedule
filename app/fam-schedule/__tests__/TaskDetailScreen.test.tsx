/**
 * TaskDetailScreen 真补卡 RPC 路径 — T-US006
 *
 * 覆盖范围(本任务):
 *   1. handleMakeUp handler 存在(useCallback 包装)
 *   2. handler 调 CheckInService.checkin(task.id, true)(isMakeup=true)
 *   3. 3 种 status 分支反馈:
 *      - checked_in       → Alert "补卡成功"(task 已标 is_makeup 由 SyncManager 自动切 UI)
 *      - spouse_completed → Alert "配偶已先一步完成"(复用 mapCheckInResultToToast 文案)
 *      - failed           → Alert "补卡失败" + mapCheckInFailureReason(reason)
 *
 * 不渲染 TaskDetailScreen 全树(jest-expo + Tamagui ESM 限制;与 homeSpouseCompleted.test.tsx
 * 同模式)— 通过 verify-by-source 风格断言源码契约:
 *   - TaskDetailScreen.tsx 含 handleMakeUp useCallback
 *   - 函数体内调 CheckInService.checkin(task.id, true) / 调 Alert.alert 3 分支
 *   - 函数体不再 noop(`/* noop *\/` placeholder 已删除)
 *
 * 严格 scope(用户 brief 已锁定):
 *   - ❌ 不测 CheckInService.checkin 本身(已有 CheckInService.test.tsx 覆盖)
 *   - ❌ 不测 mapCheckInFailureReason / mapCheckInResultToToast(已有 createTaskForm.test.tsx)
 *   - ❌ 不渲染 TaskDetailScreen(避免 ESM 限制)
 *   - ❌ 不测 CheckInButton 集成(已 Batch B M13)
 *   - ✅ 只验 handleMakeUp 函数的"骨架契约"(exists + 调用形态 + Alert 分支)
 *
 * 设计依据:
 *   - 任务 brief §C.6 真补卡 RPC 接入 T-US006 — 失败 "补卡已过截止 / 已关闭" UI 文案
 *   - CheckInService.checkin(taskId, isMakeup) 已支持 isMakeup=true(T-US005-1 + T-FIX-06-A)
 *   - 失败 reason 文案已统一在 mapCheckInFailureReason(createTaskForm.ts:627-642)
 */

import * as fs from 'fs';
import * as path from 'path';

// =====================================================================
// 共享 source — 在 describe 之前一次性 read,后续 describe 全部复用
// =====================================================================

let source: string;

beforeAll(() => {
  const sourcePath = path.join(
    __dirname,
    '..',
    'src',
    'screens',
    'TaskDetailScreen.tsx',
  );
  source = fs.readFileSync(sourcePath, 'utf8');
});

// =====================================================================
// 1. handleMakeUp 骨架契约 — verify-by-source
// =====================================================================

describe('TaskDetailScreen.handleMakeUp (T-US006 real makeup RPC)', () => {
  // -----------------------------------------------------------------
  // handler 存在性 + 基本形态
  // -----------------------------------------------------------------

  it('defines handleMakeUp as a useCallback (not a placeholder noop)', () => {
    // 升级前 `onMakeUp={() => { /* noop */ }}` 是 JSX 内联 placeholder,
    // 升级后改成 `handleMakeUp` useCallback 抽到组件体外,便于 React.memo 子组件
    // 引用稳定 + 可被 React DevTools / 测试定位
    expect(source).toMatch(
      /handleMakeUp\s*=\s*useCallback\s*\(/,
    );
  });

  it('handleMakeUp is typed as async function returning Promise<void>', () => {
    // 必须 async — CheckInService.checkin 返回 Promise;handler 内部 await result
    // 防御:handler 不能 fire-and-forget(否则 status 分支 Alert 永远走不到)
    expect(source).toMatch(
      /handleMakeUp\s*=\s*useCallback\s*\(\s*async\s*\([^)]*\)\s*:\s*Promise<void>\s*=>/,
    );
  });

  it('handleMakeUp removes the old JSX-inline noop placeholder (/* noop */)', () => {
    // 升级前:onMakeUp={() => { /* noop */ }} 出现在 JSX 中
    // 升级后:JSX 中改为 onMakeUp={handleMakeUp},无 noop 注释
    expect(source).not.toMatch(/onMakeUp=\{[\s\S]*?\/\*\s*noop\s*\*\/[\s\S]*?\}/);
  });

  // -----------------------------------------------------------------
  // RPC 调用契约
  // -----------------------------------------------------------------

  it('handleMakeUp calls CheckInService.checkin(task.id, true) with isMakeup=true', () => {
    // RPC `checkin_task` 的补卡分支:`p_is_makeup=true`
    // CheckInService.checkin signature 已接受 (taskId, isMakeup) — T-US005-1 + T-FIX-06-A
    // handler 从 closure 拿 task(no 入参,JSX 直接 onMakeUp={handleMakeUp} 引用稳定)
    expect(source).toMatch(
      /handleMakeUp[\s\S]*?CheckInService\.checkin\s*\(\s*task\.id\s*,\s*true\s*\)/,
    );
  });

  it('does NOT call CheckInService.checkin with isMakeup=false inside handleMakeUp', () => {
    // 防御:handler 内不能用 false(否则走正常打卡路径而非补卡 RPC)
    expect(source).not.toMatch(
      /handleMakeUp[\s\S]*?CheckInService\.checkin\s*\(\s*task\.id\s*,\s*false\s*\)/,
    );
  });

  // -----------------------------------------------------------------
  // 3 status 分支 — checked_in / spouse_completed / failed
  // -----------------------------------------------------------------

  it('handleMakeUp handles checked_in status (补卡成功)', () => {
    // checked_in → Alert (标题走 MAKEUP_OK_TITLE 常量,值 = '补卡成功') + 任务 is_makeup 视觉
    // handler 函数体:result.status === 'checked_in' 分支 + Alert.alert(MAKEUP_OK_TITLE, ...)
    // 简单做法:handler 内 checked_in 分支后调 Alert.alert 且 Alert.alert 引用 MAKEUP_OK_TITLE
    expect(source).toMatch(
      /handleMakeUp[\s\S]*?result\.status\s*===\s*['"]checked_in['"][\s\S]*?Alert\.alert\([\s\S]*?MAKEUP_OK_TITLE/,
    );
    // 同时验证 MAKEUP_OK_TITLE 常量 = '补卡成功'
    expect(source).toMatch(/MAKEUP_OK_TITLE\s*=\s*['"]补卡成功['"]/);
  });

  it('handleMakeUp handles spouse_completed status (配偶已先一步完成)', () => {
    // spouse_completed → Alert 标题走 mapCheckInResultToToast 文案 = "配偶已先一步完成"
    // handler 内有 result.status === 'spouse_completed' 分支 + Alert.alert(msg.title, ...) 其中
    // msg 来自 mapCheckInResultToToast(其 title 文案由 createTaskForm.ts:705 锁定 = '配偶已先一步完成')
    expect(source).toMatch(
      /handleMakeUp[\s\S]*?result\.status\s*===\s*['"]spouse_completed['"][\s\S]*?Alert\.alert\(msg\.title/,
    );
    // 防御:复用 mapCheckInResultToToast(与 handleCheckIn 同 — 减少文案分裂)
    expect(source).toMatch(
      /handleMakeUp[\s\S]*?mapCheckInResultToToast\(/,
    );
  });

  it('handleMakeUp handles failed status with mapCheckInFailureReason translation', () => {
    // failed → Alert 标题 MAKEUP_FAILED_TITLE = '补卡失败' + mapCheckInFailureReason(reason)
    // 任务 brief §C.6:失败 → "补卡已过截止 / 已关闭" 提示(由 reason 文案自动覆盖)
    expect(source).toMatch(
      /handleMakeUp[\s\S]*?result\.status\s*===\s*['"]failed['"][\s\S]*?Alert\.alert\([\s\S]*?MAKEUP_FAILED_TITLE[\s\S]*?mapCheckInFailureReason\(/,
    );
    // 验证 MAKEUP_FAILED_TITLE 常量 = '补卡失败'
    expect(source).toMatch(/MAKEUP_FAILED_TITLE\s*=\s*['"]补卡失败['"]/);
  });

  // -----------------------------------------------------------------
  // JSX 集成
  // -----------------------------------------------------------------

  it('OverdueBanner onMakeUp prop is wired to handleMakeUp (not inline noop)', () => {
    // JSX 中:<OverdueBanner onMakeUp={handleMakeUp} />
    // 防御:不允许 JSX 内联函数(每次 render 都生成新引用,破坏 React.memo)
    expect(source).toMatch(/<OverdueBanner\s+message=\{overdueInfo\.displayText\}\s+onMakeUp=\{handleMakeUp\}\s*\/>/);
  });

  // -----------------------------------------------------------------
  // 失败 reason 文案不重复 — 复用现有 mapCheckInFailureReason
  // -----------------------------------------------------------------

  it('handleMakeUp imports mapCheckInFailureReason (already done by handleCheckIn)', () => {
    // mapCheckInFailureReason 已在文件 import(line 116)— 验证 handler 复用同一函数
    // 而非重复定义 '补卡失败,请重试' 等文案
    expect(source).toMatch(
      /import\s*\{[^}]*\bmapCheckInFailureReason\b[^}]*\}\s*from\s*['"]\.\.\/lib\/createTaskForm['"]/,
    );
  });
});

// =====================================================================
// 2. T-US006-2 增量:TaskHistory 替换 HISTORY_PLACEHOLDER + 接入契约
// =====================================================================
//
// 覆盖范围(任务 brief §D.6):
//   1. HISTORY_PLACEHOLDER 常量 / 字符串 已从源码删除
//   2. TaskHistory 组件已 import
//   3. TaskHistory 已在 JSX 中渲染,接 completed_at / completed_by / is_makeup / assigneeLabels
//   4. assigneeLabels 派生已加(useMemo + familyValue.members 遍历)
//   5. task.completed_at === null 时 TaskHistory 内部 return null(组件契约)

describe('TaskDetailScreen TaskHistory wiring (T-US006-2 verify-by-source)', () => {
  // 上面 beforeAll 已 read source,此处复用变量

  // -----------------------------------------------------------------
  // HISTORY_PLACEHOLDER 清理
  // -----------------------------------------------------------------

  it('HISTORY_PLACEHOLDER constant has been removed from the file', () => {
    // 升级前:`const HISTORY_PLACEHOLDER = '打卡历史等 T-US005-4 接入';` 占位文案
    // 升级后:删除占位常量,改由 TaskHistory 组件渲染真实打卡记录
    expect(source).not.toMatch(/HISTORY_PLACEHOLDER\s*=/);
  });

  it('the old placeholder string "打卡历史等 T-US005-4 接入" has been removed', () => {
    // 防御:即便常量名变更,占位字符串也应一并清除
    expect(source).not.toMatch(/打卡历史等 T-US005-4 接入/);
  });

  // -----------------------------------------------------------------
  // TaskHistory 导入 + 渲染
  // -----------------------------------------------------------------

  it('imports TaskHistory from ../components/TaskHistory', () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\bTaskHistory\b[^}]*\}\s*from\s*['"]\.\.\/components\/TaskHistory['"]/,
    );
  });

  it('renders <TaskHistory /> in the JSX with all 4 required props', () => {
    // 必须传 completedAt / completedBy / isMakeup / assigneeLabels 四参
    // 缺任一参都视为接入不完整
    expect(source).toMatch(
      /<TaskHistory\s+[\s\S]*?completedAt=\{task\.completed_at\}[\s\S]*?completedBy=\{task\.completed_by\}[\s\S]*?isMakeup=\{task\.is_makeup\}[\s\S]*?assigneeLabels=\{assigneeLabels\}[\s\S]*?\/>/,
    );
  });

  // -----------------------------------------------------------------
  // assigneeLabels 派生
  // -----------------------------------------------------------------

  it('derives assigneeLabels via useMemo with family members mapping', () => {
    // 复用 HomeScreen 同结构(family.created_by → '我',其他 member → '配偶')
    // 防御:不允许临时函数 / 内联对象,必须 useMemo 稳定引用
    expect(source).toMatch(
      /assigneeLabels\s*=\s*useMemo<Record<string,\s*['"]\u6211['"]\s*\|\s*['"]\u914d\u5076['"]>>\s*\(/,
    );
    expect(source).toMatch(/assigneeLabels[\s\S]*?family\.created_by\s*\?\s*['"]\u6211['"]\s*:\s*['"]\u914d\u5076['"]/);
  });

  // -----------------------------------------------------------------
  // 条件渲染契约:completed_at === null 时不渲染
  // -----------------------------------------------------------------

  it('passes task.completed_at directly (TaskHistory internally returns null when null)', () => {
    // 设计决策:TaskHistory 自包含 'return null if completedAt === null'(T-US006-2 组件边界),
    // 父层 TaskDetailScreen 不再做外层条件渲染 wrapper(对比之前 InfoSection.HISTORY_PLACEHOLDER)。
    // 防御:不允许 JSX 外层再做 `task.completed_at ? <TaskHistory /> : <InfoSection ... />`
    // 双层分支(那是历史的 v1 简化方案,不应回退)。
    expect(source).toMatch(/<TaskHistory[\s\S]*?\/>/);
    // 反向防御:JSX 里不应再有 `<TaskHistory>` 与 `null` 或其他 InfoSection 互斥
    // 简化:已通过 matched once(无 ? 在 ? 中锚定)— 这里改检查完整替换形
    expect(source).not.toMatch(/<TaskHistory[\s\S]*?<InfoSection/);
  });

  it('does NOT use the InforSection with SECTION_HISTORY_LABEL anymore (label moved into TaskHistory)', () => {
    // SECTION_HISTORY_LABEL 常量已删除(由 TaskHistory 内部硬编码 '打卡历史')
    expect(source).not.toMatch(/SECTION_HISTORY_LABEL/);
    // 历史遗留 InfoSection.HISTORY_PLACEHOLDER 也应消失
    expect(source).not.toMatch(/InfoSection[\s\S]*?HISTORY_PLACEHOLDER/);
  });

  // -----------------------------------------------------------------
  // Clock icon import 已不再使用(TuskHistory 自渲染)
  // -----------------------------------------------------------------

  it('removes the now-unused Clock phosphor import (TaskHistory owns its icon)', () => {
    // 升级前:`Clock` 在 phosphor-react-native import 里 + JSX 用作 section icon
    // 升级后:TaskHistory 自渲染 Clock icon,父层不再使用
    // 防御:不再有 `import { ..., Clock, ... } from 'phosphor-react-native'`
    // (允许 Clock 在 TaskHistory 内部 import 出现)
    // 这里仅校验 TaskDetailScreen.tsx 自身不含 Clock import
    expect(source).not.toMatch(/import\s*\{[^}]*\bClock\b[^}]*\}\s*from\s*['"]phosphor-react-native['"]/);
  });

  // -----------------------------------------------------------------
  // 文档注释升级
  // -----------------------------------------------------------------

  it('file-level doc-comment header lists T-US006-2', () => {
    // 文件头 T-US* 任务 ID 段必须包含 T-US006-2
    expect(source).toMatch(/\* TaskDetailScreen[\s\S]*?T-US006-2/);
  });

  it('简化决策段含 T-US006-2 描述', () => {
    // 简化决策(decisions)段提及 T-US006-2
    expect(source).toMatch(/T-US006-2[\s\S]*?TaskHistory/);
  });
});