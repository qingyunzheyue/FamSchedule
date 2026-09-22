import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { YStack, Text, Button } from 'tamagui';
import { useState } from 'react';

import { useAuth } from '../../src/contexts/AuthContext';
import { useFamily } from '../../src/contexts/FamilyContext';
import { createFamily as familyServiceCreateFamily } from '../../src/services/FamilyService';

/**
 * T-US012-1 — Pair-create (US-012 onboarding, step 1 of 2).
 *
 * 首次登录 / 没家庭 → 用户选"创建家庭"或"输入邀请码"。
 *
 * 与 T-SETUP-9 的差异(本任务重构):
 *   - 不再直接调 supabase.rpc('create_family'),改走 FamilyService.createFamily()
 *     (FamilyService 负责 pre-check + 错误码映射 + cache)
 *   - 成功后调 FamilyContext.refresh() 通知 Gate 重新决策路由
 *     (替代原 pathname + refreshTick 监听机制)
 *   - 错误展示分三类:
 *       already_in_family → 自动跳 home(pre-check 命中,通常是 onboarding 与刷新竞态)
 *       failed → 显示具体 reason(常见:"已在某 family 中"/ RLS 拒)
 *
 * 创建成功后主动 router.replace('/(main)/(home)') —
 * Gate 的 family.state effect 看到 in_family 后放行。
 */
export default function PairCreate(): React.JSX.Element {
  const router = useRouter();
  const { session } = useAuth();
  const { refresh } = useFamily();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 没 session → 直接踢回根路由(Gate 会再处理一次)
  if (!session) {
    return <Redirect href="/" />;
  }

  async function handleCreate(): Promise<void> {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await familyServiceCreateFamily();

      if (result.status === 'created') {
        // 通知 FamilyContext 重拉 → Gate 看到 in_family → 跳 home
        await refresh();
        router.replace('/(main)/(home)');
        return;
      }

      if (result.status === 'already_in_family') {
        // Pre-check 命中(竞态:onboarding 与 refresh 撞了)→ 也跳 home
        await refresh();
        router.replace('/(main)/(home)');
        return;
      }

      // failed:把 reason 显示出来,用户能看明白(常见:RLS 拒)
      // eslint-disable-next-line no-console
      console.error('[pair-create] createFamily failed:', result.reason);
      setError(`创建家庭失败:${result.reason}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F4ECDC' }}>
      <YStack
        flex={1}
        padding="$xl"
        gap="$md"
        alignItems="center"
        justifyContent="center"
      >
        <Text fontSize="$display" fontFamily="$heading" color="$textPrimary">
          还没有配对家庭
        </Text>
        <Text
          fontSize="$body"
          color="$textSecondary"
          textAlign="center"
          paddingHorizontal="$md"
        >
          创建一个家庭,或者让配偶输入邀请码加入。
        </Text>

        {error ? (
          <Text
            fontSize="$meta"
            color="$error"
            textAlign="center"
            paddingHorizontal="$md"
            marginTop="$sm"
          >
            {error}
          </Text>
        ) : null}

        <YStack gap="$md" width="100%" maxWidth={320} marginTop="$lg">
          <Button
            theme="active"
            disabled={busy}
            onPress={() => void handleCreate()}
          >
            {busy ? '创建中…' : '创建家庭'}
          </Button>
          <Button
            variant="outlined"
            disabled={busy}
            onPress={() => router.push('/(onboarding)/pair-join')}
          >
            输入邀请码加入
          </Button>
        </YStack>

        <Text
          fontSize="$micro"
          color="$textTertiary"
          marginTop="$xl"
          textAlign="center"
        >
          邀请码由配偶在「家庭 → 邀请配偶」页生成
        </Text>
      </YStack>
    </SafeAreaView>
  );
}