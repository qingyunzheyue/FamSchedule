/**
 * codeInput — 6 位数字验证码输入工具 — T-US012-3
 *
 * 职责(单一职责:6 格验证码输入的纯逻辑 + React hook):
 *   1. 纯函数:
 *      - createEmptyDigits()  : 6 位空数组
 *      - sanitizeDigit()      : 数字清洗(去非数字 + 取最后一位,覆盖 auto-suggest / IME)
 *      - isCodeComplete()     : 6 位全填判定
 *      - computeKeyDown()     : Backspace / Arrow 键 → 焦点导航 + 清除指令
 *      - digitsFromPaste()    : 粘贴串 → 数字数组(去非数字 + 截断 6 位)
 *      - applyDigit() / applyClearCurrent() / applyClearPrev() : 不可变 state 更新
 *      - formatJoinError()    : acceptInvite 错误码 → 中文文案
 *      - submitJoinCode()     : 提交邀请码 → 返回状态机结果(便于 jest 单测,绕开 Tamagui ESM)
 *   2. useCodeInput() hook  : digits + handlers + refs(isComplete 自动派生)
 *   3. JOIN_ERROR_MESSAGES  : 三类错误文案常量
 *
 * 设计依据(与 InviteScreen 同模式的"纯逻辑下沉"策略):
 *   - jest-expo preset 下 Tamagui 加载 `tamagui/setup.native.js` 报 ESM 错
 *     (`transformIgnorePatterns` 不含 tamagui)。完整渲染需改 jest config,
 *     超出本任务 scope。
 *   - 把纯逻辑抽到本模块(无 RN / Tamagui 依赖),jest 直接测;
 *     UI 层(JoinFamilyScreen)只渲染 hook 输出 + 副作用(focus / navigate / subscribe)。
 *
 * 副作用边界(关键 — 让 hook 可测):
 *   - useCodeInput 不直接调 focus() / setTimeout — 把"要 focus 谁"作为
 *     computeKeyDown() 的返回指令,让 UI 层根据指令调 refs.current[i].focus()。
 *   - 这样 jest 单测可以测纯函数 + 钩子 state,不需要 mock react-native 的
 *     TextInput focus 行为。
 *
 * 国际化准备:
 *   - JOIN_ERROR_MESSAGES 是 const 对象,未来 i18n 时抽到 react-i18next。
 *     当前硬编码中文与本仓库 Pair-join / Invite 文案风格一致。
 */
import { useCallback, useRef, useState } from 'react';

// =====================================================================
// Constants
// =====================================================================

/** 邀请码固定 6 位(ADR-004 + db-v1.1.sql §4.2 create_invite)。 */
export const CODE_LENGTH = 6;

/**
 * acceptInvite 三类失败文案。FamilyService.acceptInvite 返回的
 * discriminated union 是 `{status: 'joined' | 'invalid_code' | 'expired' | 'already_in_family'}`,
 * 这里只覆盖非 joined 的三态。
 *
 * 文案口径:
 *   - invalid_code  :「邀请码无效,请检查后重试」— 默认容错(可能是 typo / 拼错)
 *   - expired       :「邀请码已过期,请让配偶重新生成」— 给出下一步动作
 *   - already_in_family:「你已经在某个家庭里了」— 兜底(Gate 一般已拦截)
 *
 * 与原 T-US012-1 pair-join.tsx 文案保持一致(避免 i18n 时分散维护)。
 */
export const JOIN_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  invalid_code: '邀请码无效,请检查后重试',
  expired: '邀请码已过期,请让配偶重新生成',
  already_in_family: '你已经在某个家庭里了',
};

// =====================================================================
// Pure helpers
// =====================================================================

/**
 * 6 位空数组。`fill('')` 是字符串,React Native TextInput value 期望 string。
 */
export function createEmptyDigits(): string[] {
  return Array(CODE_LENGTH).fill('');
}

/**
 * 清洗单个数字输入:
 *   - 去非数字(`/\D/g`)
 *   - 取最后一位(覆盖 auto-suggest / IME / 同时输入多位的边界)
 *
 * 例子:
 *   sanitizeDigit('5')    → '5'
 *   sanitizeDigit('a5b')  → '5'
 *   sanitizeDigit('123')  → '3'   ← 只取最后一位
 *   sanitizeDigit('')     → ''
 *   sanitizeDigit('abc')  → ''
 */
export function sanitizeDigit(input: string): string {
  return input.replace(/\D/g, '').slice(-1);
}

/**
 * 判定 6 位码是否填全。每个位置必须有恰好 1 个数字字符。
 *
 * 注意:不检查字符是否真的有效(那是 FamilyService.acceptInvite RPC 的工作)。
 * 这里只判断 UI 是否可以发起提交。
 */
export function isCodeComplete(digits: string[]): boolean {
  return (
    digits.length === CODE_LENGTH &&
    digits.every((d) => typeof d === 'string' && d.length === 1)
  );
}

/**
 * 键事件处理结果 — 让 UI 层根据结果做副作用(setDigit / refs.focus()),
 * 而 hook 本身保持纯逻辑、可测试。
 */
export interface KeyDownResult {
  /** 当前格(index)有值时,清除它。 */
  clearedCurrent: boolean;
  /** 当前格(index)为空时,清除前一格(index - 1)。 */
  clearedPrev: boolean;
  /** 焦点跳到 index + 1(仅在 clearedCurrent 或 ArrowRight 时)。 */
  focusNext: boolean;
  /** 焦点跳到 index - 1(clearedPrev 或 ArrowLeft)。 */
  focusPrev: boolean;
}

/**
 * 计算键事件的处理指令(纯函数 — 无副作用)。
 *
 * 行为矩阵(对齐 pair-join-v1.0 §3 + 国内 OTP 输入器通行做法):
 *   - Backspace 当前格有值       → clearedCurrent, 不动焦点
 *   - Backspace 当前格空 + index > 0 → clearedPrev + focusPrev
 *   - Backspace 在 index 0 且空 → noop
 *   - ArrowLeft  index > 0       → focusPrev
 *   - ArrowRight index < 5       → focusNext
 *   - 其它                      → noop
 *
 * 移动端 keyboard 不发 Arrow 事件,只发 Backspace;桌面 / web 兼容全部键。
 */
export function computeKeyDown(
  index: number,
  key: string,
  currentDigits: string[],
): KeyDownResult {
  const noop: KeyDownResult = {
    clearedCurrent: false,
    clearedPrev: false,
    focusNext: false,
    focusPrev: false,
  };

  if (key === 'Backspace') {
    if (currentDigits[index]) {
      return { ...noop, clearedCurrent: true };
    }
    if (index > 0) {
      return { ...noop, clearedPrev: true, focusPrev: true };
    }
    return noop;
  }

  if (key === 'ArrowLeft' && index > 0) {
    return { ...noop, focusPrev: true };
  }

  if (key === 'ArrowRight' && index < CODE_LENGTH - 1) {
    return { ...noop, focusNext: true };
  }

  return noop;
}

/**
 * 把粘贴串切成最多 6 位数字数组(剩余空字符串占位)。
 * 不保留原数组位置 — 粘贴总是从第 0 位开始覆盖。
 */
export function digitsFromPaste(pasted: string): string[] {
  const sanitized = pasted.replace(/\D/g, '');
  const next = createEmptyDigits();
  for (let i = 0; i < CODE_LENGTH && i < sanitized.length; i++) {
    next[i] = sanitized[i];
  }
  return next;
}

/**
 * 不可变更新:把 index 位设为 sanitized value。
 * 越界 index 时不变(防御性,UI 层不该触发)。
 */
export function applyDigit(digits: string[], index: number, value: string): string[] {
  if (index < 0 || index >= CODE_LENGTH) return digits;
  const next = [...digits];
  next[index] = sanitizeDigit(value);
  return next;
}

/**
 * 把整组 digits 重置为新值(用于粘贴 / 全清场景)。
 * 不足 6 位补空,超过 6 位截断,非数字清洗。
 */
export function applyAllDigits(digits: string[], newDigits: string[]): string[] {
  const next = createEmptyDigits();
  for (let i = 0; i < CODE_LENGTH && i < newDigits.length; i++) {
    const sanitized = sanitizeDigit(newDigits[i]);
    if (sanitized) next[i] = sanitized;
  }
  return next;
}

/** 错误码 → 中文文案。未识别 status → 兜底"加入失败,请重试"。 */
export function formatJoinError(status: string): string {
  return JOIN_ERROR_MESSAGES[status] ?? '加入失败,请重试';
}

// =====================================================================
// Submit state machine (T-US012-3)
// =====================================================================

import type { AcceptInviteResult } from '../services/FamilyService';

/**
 * 提交结果 phase 枚举(语义化状态机):
 *   - input             : 用户在输入(初始 / 失败回到此)
 *   - submitting        : RPC 调用中(UI disable 输入)
 *   - joined            : 成功 — 调用方应 navigate 到主页 + subscribe realtime
 *   - already_in_family : 已经在某 family(pre-check 命中)— 同上 navigate
 *
 * submitJoinCode 不会返回 'submitting'(那是 UI 层中间态),但 JoinFamilyScreen
 * 用同一枚举管理本地 state,统一状态机语义。
 */
export type SubmitJoinPhase =
  | 'input'
  | 'submitting'
  | 'joined'
  | 'already_in_family';

export interface SubmitJoinResult {
  phase: SubmitJoinPhase;
  errorMessage: string | null;
  /** joined 时 = FamilyService 返回的 familyId。其它 phase 为 null。 */
  familyId: string | null;
}

/**
 * 提交邀请码(纯 async 函数,便于 jest 单测 — 绕开 Tamagui ESM 加载问题)。
 *
 * 设计动机:
 *   - JoinFamilyScreen 的提交逻辑是"业务流":调 RPC → 翻译结果 → 分类状态。
 *     把它从组件里抽出来,便于 (a) 单元测试;(b) 后续被别的入口复用
 *     (例如开发期调试 / E2E 测试桩)。
 *   - familyService 参数化,让 jest 注入 mock;不 import 实际 FamilyService
 *     也避免单测耦合到 supabase client。
 *
 * 错误码 → phase 映射:
 *   - joined            → joined{familyId}
 *   - already_in_family → already_in_family(不带 familyId — 调用方走 refresh)
 *   - invalid_code / expired → input{errorMessage: formatJoinError(...)}
 *
 * 抛错:
 *   - familyService.acceptInvite 抛错时(理论上不抛 — FamilyService 设计契约),
 *     本函数 **不** 兜底;让 UI 层捕获,避免 swallow 异常。
 *     UI 层的 try/catch 会显示"未知错误"兜底文案。
 */
export async function submitJoinCode(
  code: string,
  familyService: { acceptInvite: (code: string) => Promise<AcceptInviteResult> },
): Promise<SubmitJoinResult> {
  const result = await familyService.acceptInvite(code);

  if (result.status === 'joined') {
    return { phase: 'joined', errorMessage: null, familyId: result.familyId };
  }
  if (result.status === 'already_in_family') {
    return { phase: 'already_in_family', errorMessage: null, familyId: null };
  }
  return {
    phase: 'input',
    errorMessage: formatJoinError(result.status),
    familyId: null,
  };
}

// =====================================================================
// React hook
// =====================================================================

export interface UseCodeInputApi {
  /** 当前 6 位数字数组(每元素是 '' 或 '0'-'9')。 */
  digits: string[];
  /** 设置某位(自动 sanitize,只接受数字末位)。 */
  setDigit: (index: number, value: string) => void;
  /** 整组重设(粘贴 / 全清场景),不足补空,超出截断,非数字清洗。 */
  setAllDigits: (digits: string[]) => void;
  /** 处理粘贴 — 用 digitsFromPaste 替换整组。 */
  handlePaste: (pasted: string) => void;
  /** 清空到 6 个空位。 */
  clear: () => void;
  /** refs 数组,UI 层把 RN TextInput 的 ref 塞进对应 index。 */
  refs: React.MutableRefObject<(unknown | null)[]>;
  /** 6 位全填 → true。UI 层用此触发 auto-submit。 */
  isComplete: boolean;
}

/**
 * useCodeInput — 6 位验证码输入 hook。
 *
 * 不持有副作用:UI 层根据 computeKeyDown 返回的指令做 refs.current.focus()
 * 调用,hook 本身只更新 state。
 *
 * 这与 InviteScreen 的 useInviteCountdown 拆 timer / formatCountdown 的策略一致 —
 * 纯逻辑层 + 副作用层分离,让单测无需渲染组件。
 */
export function useCodeInput(): UseCodeInputApi {
  const [digits, setDigits] = useState<string[]>(createEmptyDigits());
  const refs = useRef<(unknown | null)[]>([]);

  const setDigit = useCallback((index: number, value: string) => {
    setDigits((prev) => applyDigit(prev, index, value));
  }, []);

  const setAllDigits = useCallback((newDigits: string[]) => {
    setDigits((prev) => applyAllDigits(prev, newDigits));
  }, []);

  const handlePaste = useCallback((pasted: string) => {
    setDigits(digitsFromPaste(pasted));
  }, []);

  const clear = useCallback(() => {
    setDigits(createEmptyDigits());
  }, []);

  return {
    digits,
    setDigit,
    setAllDigits,
    handlePaste,
    clear,
    refs,
    isComplete: isCodeComplete(digits),
  };
}