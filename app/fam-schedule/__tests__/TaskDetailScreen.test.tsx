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
// 1. handleMakeUp 骨架契约 — verify-by-source
// =====================================================================

describe('TaskDetailScreen.handleMakeUp (T-US006 real makeup RPC)', () => {
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