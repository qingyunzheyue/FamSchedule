/**
 * InviteScreen — T-US012-2
 *
 * 职责(US-012 创建者展示邀请码 + 10 分钟倒计时):
 *   1. 初始:显示"生成邀请码"按钮
 *   2. 点击 → 调 FamilyService.createInvite()(走 create_invite RPC,db-v1.1.sql §4.2)
 *   3. 拿到 {code, expiresAt} → 展示 6 位数字 + 大字号 + mm:ss 倒计时
 *   4. 倒计时每秒 tick;到 0 时显示"已过期"+ "重新生成"按钮(自动 clear 当前 code)
 *   5. "重新生成"按钮可重复点击,触发新一轮 RPC
 *   6. 邀请码以 48px 大字号展示,下方文字提示"把码告诉配偶"(code 留在屏幕上,
 *      创建者口头/微信/短信告知配偶,配偶在'加入家庭'页手动输入;本期**不接**剪贴板)
 *
 * 来源契约:
 *   - PRD US-012:创建者生成 6 位邀请码,配偶输入即可加入;10 分钟后过期
 *   - 设计 pair-create-v1.0.md §3 + §5(default / countdown-low / expired / copy-success / regenerate-error)
 *   - ADR-004:服务端硬编码 10 分钟 TTL,客户端不能 override
 *   - dd-002:赤陶 #DC5A24 + 亚麻 #F4ECDC,温暖家庭感
 *
 * 设计要点:
 *   - **state machine**:3 个显式状态 — idle(无码) / active(有码 + 倒计时) / expired(过期)
 *     全部用 useState 派生,无 useReducer — 状态机简单,reducer 反而 over-engineer
 *   - **timer 抽离**:`useInviteCountdown` hook 单测可注入时间,jest fake timers 可控
 *     UI 层只渲染 hook 输出的剩余 ms / expired 标志
 *   - **expiry 自动 clear**:剩余 ms=0 → 等 1s(让用户看到 "00:00")→ 清 code + expiresAt
 *     1s 缓冲避免"码刚生成即过期"闪烁,跟 pair-create-v1.0 §5 expired 状态视觉一致
 *   - **不依赖 familyId prop**:SQL 无参,由 auth.uid() 推导 family。FamilyContext 的 in_family
 *     Gate 已经保证调用方在 family 里,无需客户端再传 familyId(避免泄漏内部 id)
 *   - **不接 FamilyContext.refresh**:生成邀请码不改变 family members / created_by,
 *     FamilyContext 状态不变,无需 refresh
 *   - **不接 Realtime**:配偶加入由 family dashboard 的 useSyncManager(familyId) 订阅
 *     family_members INSERT 处理,InviteScreen 只管"展示当前码"
 *
 * 严格 scope:
 *   - 不在这里接 Clipboard API(expo-clipboard)— 上一版有 TODO + 假"已复制"反馈,
 *     review 后移除整段复制按钮(copied state / handleCopy / Button 节点),避免
 *     setTimeout 在 unmount 后泄漏 + 避免交付欺骗性 UI。详见 v1.0+us012-2-rev1。
 *   - 不在这里做配偶加入的 Realtime 监听(留给 family dashboard 重构)
 *   - 不在这里做"返回 pair-home"导航(路由由 expo-router stack 决定)
 */

import { useCallback, useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text, YStack } from 'tamagui';

import { FamilyService } from '../services/FamilyService';
import { useInviteCountdown } from '../lib/inviteCountdown';

// (formatCountdown + useInviteCountdown 移到 src/lib/inviteCountdown.ts,
//  便于 jest 单测 — 见该文件顶部 JSDoc)

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InviteScreen(): React.JSX.Element {
  // 当前邀请码 + 过期时间(unix ms,本地时区无关)
  const [code, setCode] = useState<string | null>(null);
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);

  // 倒计时 hook
  const countdown = useInviteCountdown(expiresAtMs);

  // UI 状态
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Auto-clear:过期 1s 后清掉 code,进入 idle 让用户点"重新生成"
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!countdown.expired || !code) return;
    // 给 1s 让用户看到 "00:00",而不是瞬间消失
    const t = setTimeout(() => {
      setCode(null);
      setExpiresAtMs(null);
    }, 1000);
    return () => clearTimeout(t);
  }, [countdown.expired, code]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const handleGenerate = useCallback(async (): Promise<void> => {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const result = await FamilyService.createInvite();
      if (result.status === 'created') {
        const expiresMs = new Date(result.expiresAt).getTime();
        // 防御:服务端若返回 expiresAt 已是过去时间,直接标 expired 让 UI 走"已过期"
        if (Number.isFinite(expiresMs)) {
          setCode(result.code);
          setExpiresAtMs(expiresMs);
        } else {
          setError(`生成失败:服务端返回的过期时间无效(${result.expiresAt})`);
        }
      } else {
        setError(`生成失败:${result.reason}`);
      }
    } catch (err) {
      // 防御性:FamilyService.createInvite 设计上不抛,但万一 throw,这里兜底
      // eslint-disable-next-line no-console
      console.error('[InviteScreen] unexpected throw:', err);
      setError('生成失败:未知错误');
    } finally {
      setLoading(false);
    }
  }, [loading]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // 状态机 3 态:
  //   - idle    : 没码(初始 或 过期清除后)— show "生成邀请码"
  //   - active  : 有码 + 未过期 — show 6 位码 + mm:ss + 口述分享提示
  //   - expired : 有码 + 已过期 — show "已过期" + 重新生成按钮
  // "重新生成" 按钮在 active / expired 都可见(用户主动放弃当前码的逃生口)
  //
  // 复制按钮在 v1.0+us012-2-rev1 已删除:详见顶部 JSDoc + review 记录。

  const showGenerateButton = !code && !loading;
  const showRegenerateButton = (code !== null || countdown.expired) && !loading;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F4ECDC' }}>
      <YStack
        flex={1}
        padding="$xl"
        gap="$lg"
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
            让配偶加入你的家庭
          </Text>
          <Text
            fontSize="$body"
            color="$textSecondary"
            textAlign="center"
            paddingHorizontal="$md"
          >
            生成一个 6 位邀请码,有效期 10 分钟
          </Text>
        </YStack>

        {/* 码展示区(active 状态) */}
        {code && !countdown.expired ? (
          <YStack gap="$md" alignItems="center" marginTop="$lg">
            <Text
              fontSize={48}
              fontFamily="$heading"
              fontWeight="semibold"
              color="$primary"
              letterSpacing={6}
              // a11y:把每位数字用空格分开,让 screen reader 朗读时有停顿
              accessibilityLabel={`邀请码 ${code.split('').join(' ')}`}
              accessibilityRole="text"
            >
              {code}
            </Text>
            <Text
              fontSize="$title"
              color="$textSecondary"
              fontFamily="$body"
              // a11y:倒计时用 polite live region,每分钟更新被读屏(不每秒,免噪音)
              accessibilityLiveRegion="polite"
              accessibilityLabel={`邀请码将在 ${countdown.text} 后过期`}
            >
              {countdown.text}
            </Text>
            {/* 口述分享提示:不接 Clipboard,留屏幕让用户自己念/截图/短信告知配偶
                (设计 pair-create-v1.0 §3 active-state "把码告诉配偶" 指引文案) */}
            <Text
              fontSize="$body"
              color="$textSecondary"
              textAlign="center"
              paddingHorizontal="$md"
              marginTop="$sm"
              accessibilityRole="text"
            >
              把这 6 位码告诉配偶,对方在「加入家庭」输入即可
            </Text>
          </YStack>
        ) : null}

        {/* expired 状态 */}
        {countdown.expired && code ? (
          <YStack gap="$sm" alignItems="center" marginTop="$lg">
            <Text
              fontSize="$heading"
              fontFamily="$heading"
              color="$error"
              accessibilityRole="alert"
            >
              已过期
            </Text>
            <Text fontSize="$body" color="$textSecondary" textAlign="center">
              重新生成一个新的邀请码
            </Text>
          </YStack>
        ) : null}

        {/* 主操作按钮 — idle / loading 状态 */}
        {showGenerateButton ? (
          <Button
            theme="active"
            onPress={() => void handleGenerate()}
            disabled={loading}
          >
            <Text>生成邀请码</Text>
          </Button>
        ) : null}

        {loading ? (
          <Text fontSize="$meta" color="$textSecondary">
            生成中…
          </Text>
        ) : null}

        {/* 重新生成按钮 — active / expired 状态 */}
        {showRegenerateButton ? (
          <Button
            variant="outlined"
            onPress={() => void handleGenerate()}
            disabled={loading}
          >
            <Text>重新生成</Text>
          </Button>
        ) : null}

        {/* 错误提示 */}
        {error ? (
          <Text
            fontSize="$meta"
            color="$error"
            textAlign="center"
            paddingHorizontal="$md"
            marginTop="$sm"
            accessibilityRole="alert"
          >
            {error}
          </Text>
        ) : null}
      </YStack>
    </SafeAreaView>
  );
}