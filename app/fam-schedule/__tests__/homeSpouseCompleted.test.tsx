/**
 * HomeScreen spouse_completed 提示路径 — T-FIX-06-B M10
 *
 * 覆盖范围(本次 polish):
 *   - 配偶先完成的 checkin 结果 → HomeScreen.handleTaskCheckIn 走 showConfirmDialog
 *     (统一二次确认入口)而非原生 Alert.alert
 *   - showConfirmDialog 被以正确 shape 调用(title / message / confirmLabel /
 *     cancelLabel / destructive / onConfirm / onCancel)
 *
 * 不渲染 HomeScreen 全树(jest-expo 限制)— 通过 verify-by-source 风格验证 M10 关键
 * 改动:
 *   - HomeScreen.tsx 包含 showConfirmDialog 调用(spouse_completed 分支)
 *   - 旧 Alert.alert 单按钮 path 已删除
 *   - 新常量 SPOUSE_COMPLETED_OK_LABEL = '知道了' / SPOUSE_COMPLETED_DISMISS_LABEL = '关闭'
 *
 * 之所以不用 mount HomeScreen + mock handleTaskCheckIn:HomeScreen 顶层需 family context
 * / sync manager / useTasks / etc 全套 provider;jest-expo + tamagui ESM 限制让
 * "只触发一个分支"代价远大于 verify-by-source 的清晰度。同模式用于 Batch A M24
 * warning token 测试。
 *
 * showConfirmDialog 的 button shape 由 ConfirmDialog.test.tsx 全覆盖(button shape +
 * Alert.alert mock 断言);HomeScreen 这层不重复断言。
 *
 * 严格 scope:
 *   - M10 测试仅覆盖 spouse_completed → showConfirmDialog 路径
 *   - 不测 failed → Alert.alert(那是 T-US005-1 旧行为,本任务不动)
 *   - 不测 checked_in(无 UI 副作用)
 */

import * as fs from 'fs';
import * as path from 'path';

// =====================================================================
// 1. M10 spouse_completed → showConfirmDialog 路径源码契约
// =====================================================================

describe('HomeScreen.handleTaskCheckIn spouse_completed (T-FIX-06-B M10)', () => {
  let source: string;

  beforeAll(() => {
    const sourcePath = path.join(__dirname, '..', 'src', 'screens', 'HomeScreen.tsx');
    source = fs.readFileSync(sourcePath, 'utf8');
  });

  it('imports showConfirmDialog (ConfirmDialog helper)', () => {
    // HomeScreen 必须 import showConfirmDialog 才能用(M10 spouse_completed 提示路径)
    expect(source).toMatch(/import\s*\{[^}]*showConfirmDialog[^}]*\}\s*from\s*['"]\.\.\/components\/ConfirmDialog['"]/);
  });

  it('uses showConfirmDialog in handleTaskCheckIn (spouse_completed branch)', () => {
    // 验证 handleTaskCheckIn 函数体内含 showConfirmDialog(spouse_completed 分支)。
    // 简单做法:handleTaskCheckIn 这个函数体的 showConfirmDialog 入参必须包含 SPOUSE_COMPLETED_OK_LABEL
    expect(source).toMatch(
      /handleTaskCheckIn[\s\S]*?showConfirmDialog\(\{[\s\S]*?SPOUSE_COMPLETED_OK_LABEL[\s\S]*?\}\)/,
    );
    expect(source).toMatch(
      /handleTaskCheckIn[\s\S]*?showConfirmDialog\(\{[\s\S]*?SPOUSE_COMPLETED_DISMISS_LABEL[\s\S]*?\}\)/,
    );
  });

  it('does NOT use the old Alert.alert single-button path for spouse_completed', () => {
    // 旧 path:`Alert.alert(msg.title, msg.body, [{ text: SPOUSE_COMPLETED_OK_LABEL, style: 'default' }])`
    // 必须在源代码中消失(M10 替换为 showConfirmDialog)
    const oldSingleButtonPattern =
      /Alert\.alert\(msg\.title,\s*msg\.body,\s*\[[\s\S]*?SPOUSE_COMPLETED_OK_LABEL[\s\S]*?\]\)/;
    expect(source).not.toMatch(oldSingleButtonPattern);
  });

  it('defines SPOUSE_COMPLETED_OK_LABEL as "知道了" (T-FIX-06-B M10 polish)', () => {
    // M10 升级:配偶提示主按钮从 '好' 改为 '知道了'(语义对齐 spouse 通知而非通用确认)
    expect(source).toContain("SPOUSE_COMPLETED_OK_LABEL = '知道了'");
    expect(source).not.toContain("SPOUSE_COMPLETED_OK_LABEL = '好';");
  });

  it('defines SPOUSE_COMPLETED_DISMISS_LABEL as "关闭" (T-FIX-06-B M10 polish)', () => {
    // M10 新增:dismiss 次按钮,统一二次确认接口对齐
    expect(source).toContain("SPOUSE_COMPLETED_DISMISS_LABEL = '关闭'");
  });

  it('showConfirmDialog spouse_completed call has confirmLabel + cancelLabel + destructive=false', () => {
    // 防御:showConfirmDialog 调用形参必须含 confirmLabel / cancelLabel / destructive 字段,
    // 防止后续重构退化为单按钮 Alert.alert
    // 简单做法:确认 showConfirmDialog 入参含这三个字段(源码级断言)
    expect(source).toMatch(
      /showConfirmDialog\(\{[\s\S]*?confirmLabel:\s*SPOUSE_COMPLETED_OK_LABEL[\s\S]*?cancelLabel:\s*SPOUSE_COMPLETED_DISMISS_LABEL[\s\S]*?destructive:\s*false[\s\S]*?\}\)/,
    );
  });
});