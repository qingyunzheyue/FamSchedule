/**
 * JoinFamilyScreen 单元测试 — T-US012-3
 *
 * 覆盖范围(任务 DoD + 关键路径):
 *   1. submitJoinCode state machine:joined → refresh + subscribe 流程
 *   2. submitJoinCode:invalid_code → 显示错误 + 清空 + 重试可用
 *   3. submitJoinCode:expired → 显示"已过期"文案
 *   4. submitJoinCode:already_in_family → 同样走 refresh(用户意图已达成)
 *
 * 策略:跟 InviteScreen.test.tsx 一样,只测**纯逻辑层**(submitJoinCode),
 * 不渲染 JoinFamilyScreen 组件本身。
 *   - 原因:jest-expo preset 下,Tamagui 加载 `tamagui/setup.native.js` 报 ESM 错。
 *     完整渲染需改 jest config(单独 hygiene 任务)。
 *   - 替代:JoinFamilyScreen 的提交流程已抽到 src/lib/codeInput.ts 的
 *     submitJoinCode(纯 async 函数,familyService 参数化)。
 *     这里测该函数的契约 + 业务文案。
 *
 * 注:FamilyService.acceptInvite 的 RPC 错误码映射已有
 * __tests__/FamilyService.test.ts 覆盖(4 用例),这里只测 JoinFamilyScreen
 * 怎么**用** FamilyService 的结果(discriminated union → UI 文案)。
 */

import {
  submitJoinCode,
  formatJoinError,
  JOIN_ERROR_MESSAGES,
} from '../src/lib/codeInput';
import type { AcceptInviteResult } from '../src/services/FamilyService';

// =====================================================================
// Mocks
// =====================================================================

function makeMockFamilyService(
  result: AcceptInviteResult,
): { acceptInvite: jest.Mock<Promise<AcceptInviteResult>, [string]> } {
  return { acceptInvite: jest.fn().mockResolvedValue(result) };
}

// =====================================================================
// Tests
// =====================================================================

describe('JoinFamilyScreen.submitJoinCode contract', () => {
  it('joined result → phase joined with familyId for SyncManager.subscribeFamily', async () => {
    const svc = makeMockFamilyService({
      status: 'joined',
      familyId: 'fam-uuid-1234',
      memberId: 'user-uuid-abcd',
    });

    const result = await submitJoinCode('123456', svc);

    // DoD #3:成功 → 返回 family_id 给 SyncManager.subscribeFamily 用
    expect(result.phase).toBe('joined');
    expect(result.familyId).toBe('fam-uuid-1234');
    expect(result.errorMessage).toBeNull();
    expect(svc.acceptInvite).toHaveBeenCalledWith('123456');
  });

  it('invalid_code → phase input + 中文错误文案(DoD #4)', async () => {
    const svc = makeMockFamilyService({ status: 'invalid_code' });

    const result = await submitJoinCode('WRONG99', svc);

    expect(result.phase).toBe('input');
    expect(result.errorMessage).toBe('邀请码无效,请检查后重试');
    expect(result.familyId).toBeNull();
    // 兜底文案等于 JOIN_ERROR_MESSAGES 里的同一份,避免 i18n 时漏改
    expect(result.errorMessage).toBe(JOIN_ERROR_MESSAGES.invalid_code);
  });

  it('expired → phase input + 「让配偶重新生成」文案(DoD #4)', async () => {
    const svc = makeMockFamilyService({ status: 'expired' });

    const result = await submitJoinCode('OLDCODE', svc);

    expect(result.phase).toBe('input');
    expect(result.errorMessage).toBe('邀请码已过期,请让配偶重新生成');
    expect(result.familyId).toBeNull();
  });

  it('already_in_family → phase already_in_family,无错误(走 refresh 兜底)', async () => {
    // DoD #4:already_in_family 是"已经在 family 里"的边界态 —
    // 用户意图(加入某个家庭)其实已达成,不应展示错误,应走 refresh + navigate
    const svc = makeMockFamilyService({ status: 'already_in_family' });

    const result = await submitJoinCode('SOMECODE', svc);

    expect(result.phase).toBe('already_in_family');
    expect(result.errorMessage).toBeNull();
    expect(result.familyId).toBeNull();
  });
});

describe('JoinFamilyScreen — 错误文案完整性(DoD #4 三类全覆盖)', () => {
  it('formatJoinError covers all 3 known error statuses (invalid_code / expired / already_in_family)', () => {
    // 防御:任何 status 走 formatJoinError 都能拿到非空中文文案
    const knownStatuses = ['invalid_code', 'expired', 'already_in_family'];
    for (const status of knownStatuses) {
      const msg = formatJoinError(status);
      expect(msg).toBeTruthy();
      // 文案是中文(任一中文字符作为 anchor,避免依赖某个具体字)
      expect(msg).toMatch(/[\u4e00-\u9fa5]/);
      expect(msg.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('formatJoinError on unknown status returns fallback, not empty', () => {
    // 兜底必须存在,避免空字符串导致 UI 闪一帧空白
    const msg = formatJoinError('totally_unknown');
    expect(msg).toBeTruthy();
    expect(msg.length).toBeGreaterThan(0);
  });
});

describe('JoinFamilyScreen.submitJoinCode error resilience', () => {
  it('acceptInvite throwing propagates to caller (UI catches separately)', async () => {
    // 验证契约:submitJoinCode 不 swallow 异常,让 JoinFamilyScreen.try/catch 兜底
    const svc = {
      acceptInvite: jest.fn().mockRejectedValue(new Error('network timeout')),
    };

    await expect(submitJoinCode('123456', svc)).rejects.toThrow('network timeout');
  });
});