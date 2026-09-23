/**
 * createTaskForm 单元测试 — T-US003-2
 *
 * 本测试文件存在原因(createTaskForm.ts 主体测试在 CreateTaskScreen.test.tsx):
 *   - mapDeleteFailureReason 是 TaskService.deleteTask 失败 reason 的中文翻译
 *   - 与 EditTaskScreen.mapUpdateFailureReason 同模式
 *   - 因为是纯函数 + 不依赖 RN,单独抽出便于覆盖
 *
 * 覆盖范围:
 *   - mapDeleteFailureReason:7 种 reason → 对应中文文案 + 默认值兜底
 *
 * 设计依据:
 *   - 任务 brief §B 翻译映射表
 */

import { mapDeleteFailureReason } from '../src/lib/createTaskForm';

describe('createTaskForm.mapDeleteFailureReason', () => {
  it('translates "not_authenticated" to "请先登录"', () => {
    expect(mapDeleteFailureReason('not_authenticated')).toBe('请先登录');
  });

  it('translates "no_family" to "你还没加入家庭"', () => {
    expect(mapDeleteFailureReason('no_family')).toBe('你还没加入家庭');
  });

  it('translates "task_not_found" to "任务不存在或已被删除"', () => {
    expect(mapDeleteFailureReason('task_not_found')).toBe('任务不存在或已被删除');
  });

  it('translates "not_owner" to "只有创建者可以删除任务"', () => {
    expect(mapDeleteFailureReason('not_owner')).toBe('只有创建者可以删除任务');
  });

  it('translates "template_not_supported" to template deactivation hint', () => {
    const message = mapDeleteFailureReason('template_not_supported');
    // 不锁具体文案(后续 polish 时可改),只确认是中文 + 含「模板」
    expect(message).toMatch(/模板/);
    expect(message.length).toBeGreaterThan(0);
  });

  it('translates "rls_denied" to "没有删除权限"', () => {
    expect(mapDeleteFailureReason('rls_denied')).toBe('没有删除权限');
  });

  it('translates "unknown" to generic retry hint "删除失败,请重试"', () => {
    expect(mapDeleteFailureReason('unknown')).toBe('删除失败,请重试');
  });

  it('all 7 reasons produce a non-empty Chinese string', () => {
    const reasons = [
      'not_authenticated',
      'no_family',
      'task_not_found',
      'not_owner',
      'template_not_supported',
      'rls_denied',
      'unknown',
    ] as const;
    for (const r of reasons) {
      const msg = mapDeleteFailureReason(r);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
      // 简单的中文特征:至少有一个中文字符(\u4e00-\u9fff)
      expect(msg).toMatch(/[\u4e00-\u9fff]/);
    }
  });
});