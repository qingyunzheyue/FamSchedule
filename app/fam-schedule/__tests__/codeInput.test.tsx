/**
 * codeInput 单元测试 — T-US012-3
 *
 * 覆盖范围(纯逻辑层 + hook,绕开 Tamagui ESM):
 *   1. createEmptyDigits   : 6 个空字符串
 *   2. sanitizeDigit       : 单数字 / 去非数字 / 取最后一位 / 空输入
 *   3. isCodeComplete      : 空 / 部分 / 全填 3 种
 *   4. computeKeyDown      : Backspace(3 种)/ ArrowLeft / ArrowRight / noop
 *   5. digitsFromPaste     : 全 6 位 / 截断 / 部分填充 / 去非数字
 *   6. applyDigit / applyAllDigits : 不可变更新 + sanitize
 *   7. formatJoinError     : 3 已知 status + 未知兜底
 *   8. useCodeInput hook   : 初始 / setDigit / setAllDigits / handlePaste / clear
 *
 * 策略:跟 InviteScreen.test.tsx 一样,只测纯逻辑 + hook harness,
 * 不渲染组件(jest-expo preset 下 Tamagui ESM 加载失败,
 * 改 jest config 是单独 hygiene 任务,见 task-breakdown §3.5)。
 */

import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  CODE_LENGTH,
  createEmptyDigits,
  sanitizeDigit,
  isCodeComplete,
  computeKeyDown,
  digitsFromPaste,
  applyDigit,
  applyAllDigits,
  formatJoinError,
  JOIN_ERROR_MESSAGES,
  useCodeInput,
  submitJoinCode,
  type UseCodeInputApi,
} from '../src/lib/codeInput';
import type { AcceptInviteResult } from '../src/services/FamilyService';

// =====================================================================
// Pure helpers
// =====================================================================

describe('CODE_LENGTH', () => {
  it('is 6 (matches ADR-004 / db-v1.1.sql §4.2 create_invite)', () => {
    expect(CODE_LENGTH).toBe(6);
  });
});

describe('createEmptyDigits', () => {
  it('returns 6 empty strings', () => {
    expect(createEmptyDigits()).toEqual(['', '', '', '', '', '']);
    expect(createEmptyDigits()).toHaveLength(6);
  });

  it('returns a new array each call (no shared reference)', () => {
    const a = createEmptyDigits();
    const b = createEmptyDigits();
    expect(a).not.toBe(b);
  });
});

describe('sanitizeDigit', () => {
  it('keeps single digit', () => {
    expect(sanitizeDigit('5')).toBe('5');
    expect(sanitizeDigit('0')).toBe('0');
    expect(sanitizeDigit('9')).toBe('9');
  });

  it('strips non-digit chars (alpha / space / punctuation)', () => {
    expect(sanitizeDigit('a5b')).toBe('5');
    expect(sanitizeDigit(' 7 ')).toBe('7');
    expect(sanitizeDigit('1.2')).toBe('2');
    expect(sanitizeDigit('一5二')).toBe('5');
  });

  it('takes the last digit (covers auto-suggest / IME)', () => {
    expect(sanitizeDigit('123')).toBe('3');
    expect(sanitizeDigit('987654')).toBe('4');
  });

  it('returns empty string for non-digit-only input', () => {
    expect(sanitizeDigit('')).toBe('');
    expect(sanitizeDigit('abc')).toBe('');
    expect(sanitizeDigit('!@#')).toBe('');
  });
});

describe('isCodeComplete', () => {
  it('false for empty digits', () => {
    expect(isCodeComplete(createEmptyDigits())).toBe(false);
  });

  it('false for partial 5/6', () => {
    expect(isCodeComplete(['1', '2', '3', '4', '5', ''])).toBe(false);
    expect(isCodeComplete(['', '1', '2', '3', '4', '5'])).toBe(false);
  });

  it('false when any cell has multi-char value (defensive)', () => {
    expect(isCodeComplete(['1', '23', '3', '4', '5', '6'])).toBe(false);
  });

  it('true when all 6 cells filled with single digits', () => {
    expect(isCodeComplete(['1', '2', '3', '4', '5', '6'])).toBe(true);
    expect(isCodeComplete(['0', '0', '0', '0', '0', '0'])).toBe(true);
    expect(isCodeComplete(['9', '8', '7', '6', '5', '4'])).toBe(true);
  });
});

describe('computeKeyDown', () => {
  const empty = createEmptyDigits();
  const partial = ['1', '2', '', '', '', ''];
  const full = ['1', '2', '3', '4', '5', '6'];

  it('Backspace on filled cell clears current, no focus change', () => {
    const r = computeKeyDown(0, 'Backspace', partial);
    expect(r).toEqual({
      clearedCurrent: true,
      clearedPrev: false,
      focusNext: false,
      focusPrev: false,
    });
  });

  it('Backspace on empty cell with prev filled clears prev + focuses prev', () => {
    const r = computeKeyDown(2, 'Backspace', partial);
    expect(r.clearedCurrent).toBe(false);
    expect(r.clearedPrev).toBe(true);
    expect(r.focusPrev).toBe(true);
  });

  it('Backspace on first empty cell does nothing (no prev to clear)', () => {
    const r = computeKeyDown(0, 'Backspace', empty);
    expect(r.clearedCurrent).toBe(false);
    expect(r.clearedPrev).toBe(false);
    expect(r.focusPrev).toBe(false);
    expect(r.focusNext).toBe(false);
  });

  it('ArrowLeft on middle cell focuses prev', () => {
    const r = computeKeyDown(3, 'ArrowLeft', full);
    expect(r.focusPrev).toBe(true);
    expect(r.clearedCurrent).toBe(false);
    expect(r.clearedPrev).toBe(false);
  });

  it('ArrowLeft on cell 0 is noop (no prev)', () => {
    const r = computeKeyDown(0, 'ArrowLeft', full);
    expect(r.focusPrev).toBe(false);
  });

  it('ArrowRight on cell 4 focuses next', () => {
    const r = computeKeyDown(4, 'ArrowRight', full);
    expect(r.focusNext).toBe(true);
  });

  it('ArrowRight on last cell is noop (no next)', () => {
    const r = computeKeyDown(5, 'ArrowRight', full);
    expect(r.focusNext).toBe(false);
  });

  it('unrecognized key returns noop', () => {
    expect(computeKeyDown(2, 'Enter', full)).toEqual({
      clearedCurrent: false,
      clearedPrev: false,
      focusNext: false,
      focusPrev: false,
    });
    expect(computeKeyDown(2, ' ', full)).toEqual({
      clearedCurrent: false,
      clearedPrev: false,
      focusNext: false,
      focusPrev: false,
    });
  });
});

describe('digitsFromPaste', () => {
  it('fills all 6 from a 6-digit paste', () => {
    expect(digitsFromPaste('123456')).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('truncates beyond 6 digits', () => {
    expect(digitsFromPaste('12345678')).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(digitsFromPaste('9999999999')).toEqual(['9', '9', '9', '9', '9', '9']);
  });

  it('pads partial paste with empty strings', () => {
    expect(digitsFromPaste('123')).toEqual(['1', '2', '3', '', '', '']);
    expect(digitsFromPaste('1')).toEqual(['1', '', '', '', '', '']);
  });

  it('strips non-digit chars from paste', () => {
    expect(digitsFromPaste('1a2b3c')).toEqual(['1', '2', '3', '', '', '']);
    expect(digitsFromPaste('ABC 12 34')).toEqual(['1', '2', '3', '4', '', '']);
  });

  it('returns all empty for empty / non-digit paste', () => {
    expect(digitsFromPaste('')).toEqual(['', '', '', '', '', '']);
    expect(digitsFromPaste('abc')).toEqual(['', '', '', '', '', '']);
  });
});

describe('applyDigit', () => {
  it('sanitizes value and updates immutably', () => {
    const before = createEmptyDigits();
    const after = applyDigit(before, 0, 'a5b');
    expect(after).toEqual(['5', '', '', '', '', '']);
    expect(before).toEqual(['', '', '', '', '', '']); // immutability
  });

  it('out-of-range index is a noop (defensive)', () => {
    const before = createEmptyDigits();
    expect(applyDigit(before, -1, '1')).toBe(before);
    expect(applyDigit(before, 6, '1')).toBe(before);
    expect(applyDigit(before, 100, '1')).toBe(before);
  });
});

describe('applyAllDigits', () => {
  it('replaces all digits, sanitizes each, pads with empty', () => {
    const before = ['1', '2', '3', '4', '5', '6'];
    const after = applyAllDigits(before, ['9', 'a8', '7']);
    expect(after).toEqual(['9', '8', '7', '', '', '']);
  });

  it('truncates beyond 6', () => {
    const after = applyAllDigits(createEmptyDigits(), [
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
    ]);
    expect(after).toEqual(['1', '2', '3', '4', '5', '6']);
  });
});

describe('JOIN_ERROR_MESSAGES + formatJoinError', () => {
  it('exposes 3 known Chinese messages', () => {
    expect(JOIN_ERROR_MESSAGES.invalid_code).toBe('邀请码无效,请检查后重试');
    expect(JOIN_ERROR_MESSAGES.expired).toBe('邀请码已过期,请让配偶重新生成');
    expect(JOIN_ERROR_MESSAGES.already_in_family).toBe('你已经在某个家庭里了');
  });

  it('formatJoinError returns mapped message for known status', () => {
    expect(formatJoinError('invalid_code')).toBe('邀请码无效,请检查后重试');
    expect(formatJoinError('expired')).toBe('邀请码已过期,请让配偶重新生成');
    expect(formatJoinError('already_in_family')).toBe('你已经在某个家庭里了');
  });

  it('formatJoinError returns fallback for unknown status', () => {
    expect(formatJoinError('some_unknown_status')).toBe('加入失败,请重试');
    expect(formatJoinError('')).toBe('加入失败,请重试');
  });
});

// =====================================================================
// submitJoinCode (T-US012-3 — state machine for screen tests)
// =====================================================================

describe('submitJoinCode', () => {
  function mockFamilyService(
    result: AcceptInviteResult,
  ): { acceptInvite: jest.Mock<Promise<AcceptInviteResult>, [string]> } {
    return { acceptInvite: jest.fn().mockResolvedValue(result) };
  }

  it('joined result → phase joined with familyId, no errorMessage', async () => {
    const svc = mockFamilyService({
      status: 'joined',
      familyId: 'fam-123',
      memberId: 'user-1',
    });

    const result = await submitJoinCode('123456', svc);

    expect(result).toEqual({
      phase: 'joined',
      errorMessage: null,
      familyId: 'fam-123',
    });
    expect(svc.acceptInvite).toHaveBeenCalledWith('123456');
  });

  it('already_in_family result → phase already_in_family (no errorMessage)', async () => {
    const svc = mockFamilyService({ status: 'already_in_family' });

    const result = await submitJoinCode('123456', svc);

    expect(result).toEqual({
      phase: 'already_in_family',
      errorMessage: null,
      familyId: null,
    });
  });

  it('invalid_code result → phase input + Chinese errorMessage', async () => {
    const svc = mockFamilyService({ status: 'invalid_code' });

    const result = await submitJoinCode('WRONG99', svc);

    expect(result.phase).toBe('input');
    expect(result.errorMessage).toBe('邀请码无效,请检查后重试');
    expect(result.familyId).toBeNull();
  });

  it('expired result → phase input + "expired" Chinese errorMessage', async () => {
    const svc = mockFamilyService({ status: 'expired' });

    const result = await submitJoinCode('OLDCODE', svc);

    expect(result.phase).toBe('input');
    expect(result.errorMessage).toBe('邀请码已过期,请让配偶重新生成');
    expect(result.familyId).toBeNull();
  });

  it('propagates thrown errors (design: FamilyService does not throw, but if it does, let UI catch)', async () => {
    const svc = {
      acceptInvite: jest.fn().mockRejectedValue(new Error('network down')),
    };

    await expect(submitJoinCode('123456', svc)).rejects.toThrow('network down');
  });
});

// =====================================================================
// useCodeInput hook (harness pattern like InviteScreen.test.tsx)
// =====================================================================

interface HookProbe {
  current: UseCodeInputApi | null;
}

function HookHarness({
  probeRef,
}: {
  probeRef: React.MutableRefObject<HookProbe>;
}): React.ReactElement {
  const api = useCodeInput();
  probeRef.current = { current: api };
  return React.createElement('div', null, JSON.stringify(api.digits));
}

beforeEach(() => {
  // no setup — each hook test gets a fresh component tree
});

describe('useCodeInput hook', () => {
  it('starts with 6 empty digits and isComplete=false', () => {
    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    act(() => {
      TestRenderer.create(<HookHarness probeRef={probeRef} />);
    });

    const api = probeRef.current!.current!;
    expect(api.digits).toEqual(['', '', '', '', '', '']);
    expect(api.isComplete).toBe(false);
    expect(api.refs.current).toHaveLength(0); // no input refs attached
  });

  it('setDigit updates digits immutably and isComplete stays false', () => {
    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    act(() => {
      TestRenderer.create(<HookHarness probeRef={probeRef} />);
    });

    act(() => {
      probeRef.current!.current!.setDigit(0, '5');
    });
    expect(probeRef.current!.current!.digits).toEqual([
      '5',
      '',
      '',
      '',
      '',
      '',
    ]);
    expect(probeRef.current!.current!.isComplete).toBe(false);
  });

  it('setDigit sanitizes non-digit input', () => {
    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    act(() => {
      TestRenderer.create(<HookHarness probeRef={probeRef} />);
    });

    act(() => {
      probeRef.current!.current!.setDigit(1, 'a9b');
    });
    expect(probeRef.current!.current!.digits[1]).toBe('9');
  });

  it('isComplete flips true when all 6 filled', () => {
    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    act(() => {
      TestRenderer.create(<HookHarness probeRef={probeRef} />);
    });

    act(() => {
      const api = probeRef.current!.current!;
      api.setDigit(0, '1');
      api.setDigit(1, '2');
      api.setDigit(2, '3');
      api.setDigit(3, '4');
      api.setDigit(4, '5');
      api.setDigit(5, '6');
    });

    expect(probeRef.current!.current!.digits).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
    expect(probeRef.current!.current!.isComplete).toBe(true);
  });

  it('handlePaste replaces all digits with sanitized paste content', () => {
    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    act(() => {
      TestRenderer.create(<HookHarness probeRef={probeRef} />);
    });

    act(() => {
      probeRef.current!.current!.handlePaste('482917');
    });
    expect(probeRef.current!.current!.digits).toEqual([
      '4',
      '8',
      '2',
      '9',
      '1',
      '7',
    ]);
    expect(probeRef.current!.current!.isComplete).toBe(true);

    // Paste with non-digit chars strips them
    act(() => {
      probeRef.current!.current!.handlePaste('1a2b3c');
    });
    expect(probeRef.current!.current!.digits).toEqual([
      '1',
      '2',
      '3',
      '',
      '',
      '',
    ]);
  });

  it('clear resets digits to 6 empty and isComplete to false', () => {
    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    act(() => {
      TestRenderer.create(<HookHarness probeRef={probeRef} />);
    });

    act(() => {
      const api = probeRef.current!.current!;
      api.handlePaste('123456');
    });
    expect(probeRef.current!.current!.isComplete).toBe(true);

    act(() => {
      probeRef.current!.current!.clear();
    });
    expect(probeRef.current!.current!.digits).toEqual(['', '', '', '', '', '']);
    expect(probeRef.current!.current!.isComplete).toBe(false);
  });

  it('setAllDigits replaces digits and sanitizes each', () => {
    const probeRef = React.createRef<HookProbe>() as React.MutableRefObject<HookProbe>;
    probeRef.current = { current: null };

    act(() => {
      TestRenderer.create(<HookHarness probeRef={probeRef} />);
    });

    act(() => {
      probeRef.current!.current!.setAllDigits(['9', 'a8', '7']);
    });
    expect(probeRef.current!.current!.digits).toEqual([
      '9',
      '8',
      '7',
      '',
      '',
      '',
    ]);
  });
});