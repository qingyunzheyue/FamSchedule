import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { YStack, Text, Button } from 'tamagui';
import { useState } from 'react';

import { useAuth } from '../../src/contexts/AuthContext';
import { supabase } from '../../src/lib/supabase';

/**
 * T-SETUP-9 — Pair-create (US-012 onboarding, step 1 of 2).
 *
 * 首次登录 / 没家庭 → 用户选"创建家庭"或"输入邀请码"。
 * - 创建:db-v1.1.sql §4.1 的 create_family() RPC 不接受参数,内部创建
 *         families / family_members / family_settings 三张表的默认行。
 *         families 表本身无 name 列(只有 id / created_by / created_at),
 *         家庭名走 family_settings 默认行(US-012 改)。
 * - 加入:跳到 pair-join。
 *
 * 创建成功后主动 router.replace('/(main)/(home)') —
 * Gate 的 pathname 监听器会在路由变化时重新查 family_members,放行。
 */
export default function PairCreate(): React.JSX.Element {
  const router = useRouter();
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);

  // 没 session → 直接踢回根路由(Gate 会再处理一次)
  if (!session) {
    return <Redirect href="/" />;
  }

  async function handleCreate(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      // `as never`:见 src/lib/SyncManager.ts:425 — supabase-js rpc() typed Database
      // 在 object literal narrowing 上有 quirk,空对象 {} 也匹配不上 `undefined` 默认。
      // 实际请求 payload 正确(RPC 无参),服务器能解析。
      const { error } = await (supabase.rpc as CallableFunction)('create_family', {}) as {
        error: { message: string } | null;
      };
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[pair-create] create_family rpc error:', error);
        return;
      }
      // 成功 — 主动跳到 home,Gate 的 pathname 监听器会重查 family
      router.replace('/(main)/(home)');
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
