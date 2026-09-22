/**
 * JoinFamilyScreen — 配偶输入邀请码加入家庭 — T-US012-3
 *
 * 职责(US-012 step 2 of 2 onboarding):
 *   1. 渲染 6 位数字输入格(自动跳到下一位 + 粘贴支持 + 退格跳回)
 *   2. 6 位全填 → 自动调 FamilyService.acceptInvite(code)
 *   3. 成功 → refresh FamilyContext + SyncManager.subscribeFamily + 显示"已加入"1.5s
 *      → router.replace('/(main)/(home)') 让 Gate 把用户带到主 Tab
 *   4. 失败 → 显示对应错误文案(invalid_code / expired / already_in_family)
 *      → 清空输入 + 焦点回到第 0 位
 *   5. 已 in_family → already_in_family 也走 refresh + navigate(用户意图已达成)
 *
 * 设计要点:
 *   - **state machine**:3 个 phase — input / submitting / submitted
 *     - input     : 用户在输入(初始 / 失败回到此)
 *     - submitting: RPC 调用中
 *     - submitted : 成功展示 "已加入" 1.5s,然后 router.replace
 *     进入 submitted 后不响应任何输入(用户视角"操作完成,准备跳转")
 *   - **6 格输入用 RN TextInput**:细粒度 ref 控制 + maxLength=1 +
 *     keyboardType="number-pad" + selectTextOnFocus 让重填流畅。
 *     Tamagui Input 是 TextInput 的封装,但本场景 6 个独立 cell
 *     直接用 RN 原生最干净(无 wrapper 额外依赖)。
 *   - **auto-jump**:每位 onChangeText 后 setTimeout focus 下一位;
 *     setTimeout(0) 让 setState 先 commit(RN 渲染不卡)。
 *   - **paste 处理**:onChangeText 接 text 长度 > 1 判定为粘贴,
 *     按位分发到 6 格(去非数字)+ 焦点跳到末尾。
 *   - **失败清空**:clear() 让 digits 重置为空数组,setTimeout focus 回第 0 位。
 *   - **subscribe realtime**:成功时调 SyncManager.subscribeFamily(familyId);
 *     即使后续 home 屏挂 useSyncManager 会重订阅,本调用是
 *     "DoD #5 加入后自动 subscribe" 的契约保证。
 *
 * 严格 scope:
 *   - 不在这里做剪贴板自动填充(配偶把码告诉用户,用户手动输入);
 *     上一版 pair-join.tsx 的剪贴板尝试在 v1.0+us012-2-rev1 删掉,
 *     本任务延续同一 UX 原则。
 *   - 不在这里改 FamilyContext(SubscribeFamily 是 fire-and-forget
 *     副作用;FamilyContext 自身的 refresh 由 useFamily().refresh() 触发)。
 *   - 不在这里订阅 NetInfo / AppState(那是 SyncManager.useSyncManager 的职责)。
 *
 * a11y:
 *   - 6 格 input 每格 ariaLabel「邀请码第 N 位」+ keyboardType number-pad
 *   - 错误提示:accessibilityRole="alert"(读屏立即播报)
 *   - 成功画面:accessibilityRole="text" 包含"已加入家庭"
 *
 * 参考:
 *   - 屏幕规格 document/ui-design/screens/pair-join-v1.0.md
 *   - PRD US-012:配偶输入 6 位邀请码加入
 *   - ADR-004:10 分钟过期 + atomic UPDATE
 *   - db-v1.1.sql §4.3 accept_invite(p_code)
 */

import { useCallback, useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { YStack, XStack, Text, Button } from 'tamagui';
import { CheckCircle, Warning } from 'phosphor-react-native';
import { TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { FamilyService } from '../services/FamilyService';
import { subscribeFamily } from '../lib/SyncManager';
import {
  useCodeInput,
  computeKeyDown,
  CODE_LENGTH,
  submitJoinCode,
  type SubmitJoinPhase,
} from '../lib/codeInput';
import { useFamily } from '../contexts/FamilyContext';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * JoinFamilyScreen — 配偶输入 6 位邀请码加入家庭。
 *
 * 渲染模式(单一组件):
 *   - input 模式:6 格输入 + 错误提示 + 「改去创建家庭」按钮
 *   - submitting 模式:6 格输入 disabled + 「正在验证...」提示
 *   - submitted 模式:绿色 ✓ + 「已加入家庭!」+ 自动跳转到主页
 *
 * 路由角色:`app/(onboarding)/pair-join.tsx` 是 thin wrapper,只渲染本组件。
 */
export function JoinFamilyScreen(): React.JSX.Element {
  const router = useRouter();
  const { refresh } = useFamily();
  const { digits, setDigit, setAllDigits, handlePaste, clear, refs, isComplete } =
    useCodeInput();

  // UI 本地状态机(input / submitting / submitted)
  const [phase, setPhase] = useState<SubmitJoinPhase>('input');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // -------------------------------------------------------------------
  // Auto-submit:6 位全填 → 自动调 accept_invite
  // -------------------------------------------------------------------

  useEffect(() => {
    if (!isComplete || phase !== 'input') return;
    void doSubmit();
    // doSubmit 是 useCallback 闭包,deps 由它内部持有;
    // 这里只依赖 isComplete 触发(auto-submit 是事件不是依赖链)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComplete]);

  // -------------------------------------------------------------------
  // Submit handler — 调 submitJoinCode(便于单测) + 副作用
  // -------------------------------------------------------------------

  const doSubmit = useCallback(async (): Promise<void> => {
    if (phase !== 'input') return;
    const code = digits.join('');
    if (code.length !== CODE_LENGTH) return;

    setPhase('submitting');
    setErrorMessage(null);

    let result;
    try {
      result = await submitJoinCode(code, FamilyService);
    } catch (err) {
      // submitJoinCode 不抛,但万一 future 改动改了契约,这里兜底
      // eslint-disable-next-line no-console
      console.error('[JoinFamilyScreen] submitJoinCode threw:', err);
      setPhase('input');
      setErrorMessage('加入失败:未知错误');
      clear();
      focusCell(0);
      return;
    }

    if (result.phase === 'joined' || result.phase === 'already_in_family') {
      setPhase('joined');
      // 触发 FamilyContext 重拉 → Gate 检测到 in_family → push 到 home
      // refresh() 失败不阻塞跳转(假设:用户已 join,family 状态会通过
      // 下次 Gate 渲染或 Realtime 自动校正)
      try {
        await refresh();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[JoinFamilyScreen] refresh failed:', e);
      }

      // DoD #5:加入后自动 subscribe family Realtime channel
      if (result.familyId) {
        void subscribeFamily(result.familyId).catch((e) => {
          // eslint-disable-next-line no-console
          console.warn('[JoinFamilyScreen] subscribeFamily failed:', e);
        });
      }

      // 短暂展示"已加入"提示,然后跳转
      setTimeout(() => {
        router.replace('/(main)/(home)');
      }, 1500);
      return;
    }

    // result.phase === 'input' = 失败
    setPhase('input');
    setErrorMessage(result.errorMessage);
    clear();
    focusCell(0);
  }, [phase, digits, refresh, router, clear]);

  // -------------------------------------------------------------------
  // Focus helper
  // -------------------------------------------------------------------

  const focusCell = useCallback((index: number) => {
    setTimeout(() => {
      const ref = refs.current[index] as { focus?: () => void } | null;
      ref?.focus?.();
    }, 0);
  }, [refs]);

  // -------------------------------------------------------------------
  // Input handlers
  // -------------------------------------------------------------------

  const onChangeText = useCallback(
    (i: number, text: string) => {
      if (text.length > 1) {
        // 粘贴:auto-suggest / 长输入 → 分发到格子
        const next = [...digits];
        let cursor = i;
        for (const ch of text) {
          if (cursor >= CODE_LENGTH) break;
          if (/\d/.test(ch)) {
            next[cursor] = ch;
            cursor++;
          }
        }
        setAllDigits(next);
        focusCell(Math.min(cursor, CODE_LENGTH - 1));
        return;
      }
      // 单字符输入(sanitize 后可能是 '')
      setDigit(i, text);
      if (text && i < CODE_LENGTH - 1) {
        focusCell(i + 1);
      }
    },
    [digits, setDigit, setAllDigits, focusCell],
  );

  const onKeyPress = useCallback(
    (i: number, key: string) => {
      const result = computeKeyDown(i, key, digits);
      if (result.clearedCurrent) setDigit(i, '');
      if (result.clearedPrev) setDigit(i - 1, '');
      if (result.focusNext) focusCell(i + 1);
      if (result.focusPrev) focusCell(i - 1);
    },
    [digits, setDigit, focusCell],
  );

  const onPaste = useCallback(
    (text: string) => {
      handlePaste(text);
      // 粘贴后焦点跳到第一个空格(或最后一格)
      const next = handlePasteResult(text);
      const lastFilled = next.findIndex((d) => d === '');
      focusCell(lastFilled === -1 ? CODE_LENGTH - 1 : lastFilled);
    },
    [handlePaste, focusCell],
  );

  // -------------------------------------------------------------------
  // Render:submitted — 成功提示 + 自动跳转
  // -------------------------------------------------------------------

  if (phase === 'joined') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#F4ECDC' }}>
        <YStack
          flex={1}
          alignItems="center"
          justifyContent="center"
          gap="$lg"
          padding="$xl"
        >
          <CheckCircle size={80} color="#5C9D7E" weight="fill" />
          <Text
            fontSize="$title"
            fontFamily="$heading"
            color="$textPrimary"
            accessibilityRole="text"
          >
            已加入家庭!
          </Text>
          <Text fontSize="$body" color="$textSecondary" textAlign="center">
            正在跳转到家庭主页...
          </Text>
        </YStack>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------
  // Render:input / submitting — 6 格输入 + 错误 + 「改去创建家庭」
  // -------------------------------------------------------------------

  const isSubmitting = phase === 'submitting';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F4ECDC' }}>
      <YStack
        flex={1}
        padding="$xl"
        gap="$md"
        alignItems="center"
        justifyContent="center"
      >
        {/* 标题区 */}
        <YStack gap="$sm" alignItems="center">
          <Text
            fontSize="$title"
            fontFamily="$heading"
            fontWeight="semibold"
            color="$textPrimary"
            textAlign="center"
          >
            输入邀请码
          </Text>
          <Text
            fontSize="$body"
            color="$textSecondary"
            textAlign="center"
            paddingHorizontal="$md"
          >
            让配偶把 6 位邀请码告诉你{'\n'}输完后自动加入
          </Text>
        </YStack>

        {/* 6 格输入 */}
        <XStack gap="$sm" marginTop="$lg" alignItems="center">
          {digits.map((digit, i) => (
            <View
              key={i}
              style={{
                width: 44,
                height: 56,
                borderWidth: 2,
                borderColor: digit ? '#DC5A24' : '#E8DFD0',
                borderRadius: 12,
                backgroundColor: '#FFF9F0',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <TextInput
                ref={(el) => {
                  refs.current[i] = el;
                }}
                value={digit}
                onChangeText={(text) => onChangeText(i, text)}
                onKeyPress={(e) => onKeyPress(i, e.nativeEvent.key)}
                keyboardType="number-pad"
                maxLength={1}
                selectTextOnFocus
                editable={!isSubmitting}
                accessibilityLabel={`邀请码第 ${i + 1} 位`}
                // 暴露给 JoinFamilyScreen 测试的 testID(T-US012-3 review 用)
                testID={`codeInput-${i}`}
                style={{
                  width: '100%',
                  height: '100%',
                  fontSize: 24,
                  fontWeight: '600',
                  textAlign: 'center',
                  color: '#3A2E20',
                  padding: 0,
                  // RN Android 默认有内边距,这里归零让 TextInput 跟
                  // View 的边框对齐;vertical center by line-height
                  lineHeight: 32,
                }}
              />
            </View>
          ))}
        </XStack>

        {/* 提交中提示 */}
        {isSubmitting ? (
          <Text
            fontSize="$body"
            color="$textSecondary"
            marginTop="$md"
            accessibilityRole="text"
          >
            正在验证邀请码...
          </Text>
        ) : null}

        {/* 错误提示 */}
        {errorMessage ? (
          <XStack
            gap="$xs"
            alignItems="center"
            marginTop="$md"
            accessibilityRole="alert"
          >
            <Warning size={20} color="#C95444" weight="fill" />
            <Text fontSize="$body" color="$error" textAlign="center">
              {errorMessage}
            </Text>
          </XStack>
        ) : null}

        {/* 备用入口:改去创建家庭 */}
        <Button
          variant="outlined"
          disabled={isSubmitting}
          onPress={() => router.replace('/(onboarding)/pair-create')}
          marginTop="$lg"
        >
          <Text>改去创建家庭</Text>
        </Button>
      </YStack>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/**
 * 计算 handlePaste 后的结果数组(不直接复用 handlePaste 以免双调用 setDigits)。
 * 单独算一遍 next 用于决定焦点跳到哪个 cell。
 */
function handlePasteResult(pasted: string): string[] {
  const sanitized = pasted.replace(/\D/g, '');
  const next = Array(CODE_LENGTH).fill('');
  for (let i = 0; i < CODE_LENGTH && i < sanitized.length; i++) {
    next[i] = sanitized[i];
  }
  return next;
}