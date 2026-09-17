import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { YStack, XStack, Text, Input, Button } from 'tamagui';
import { useState } from 'react';

import { useAuth } from '../../src/contexts/AuthContext';
import { supabase } from '../../src/lib/supabase';

/**
 * T-SETUP-9 — Pair-join (US-012 onboarding, step 2 of 2).
 *
 * 用户输入 6 位邀请码,调 accept_invite RPC:
 *   - db-v1.1.sql §4.3:accept_invite(p_code TEXT) — 参数名是 p_code
 *   - 当前 user 已被写进对应 family 的 family_members 行
 *   - 返回新 family_id,Gate 检测到后 redirect
 *
 * 占位 — 真正的 input 校验、loading 状态、错误 toast 留给 US-012 详细实现。
 */
export default function PairJoin(): React.JSX.Element {
  const router = useRouter();
  const { session } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  if (!session) {
    return <Redirect href="/" />;
  }

  async function handleAccept(): Promise<void> {
    if (busy) return;
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length === 0) return;
    setBusy(true);
    try {
      // 强 cast CallableFunction 绕过 supabase-js typed Database 的
      // Args narrowing quirk(见 src/lib/SyncManager.ts:425 注释)。
      // 实际请求 payload { p_code: trimmed } 与 db RPC 签名一致。
      const { error } = await (supabase.rpc as CallableFunction)(
        'accept_invite',
        { p_code: trimmed },
      ) as { error: { message: string } | null };
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[pair-join] accept_invite rpc error:', error);
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
        <Text fontSize="$title" fontFamily="$heading" color="$textPrimary">
          输入邀请码
        </Text>
        <Text
          fontSize="$body"
          color="$textSecondary"
          textAlign="center"
          paddingHorizontal="$md"
        >
          配偶在「家庭 → 邀请配偶」页生成的 6 位邀请码。
        </Text>

        <XStack
          width="100%"
          maxWidth={320}
          gap="$sm"
          alignItems="center"
          justifyContent="center"
          marginTop="$md"
        >
          <Input
            flex={1}
            size="$buttonMd"
            placeholder="例如: A1B2C3"
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            textAlign="center"
            fontFamily="$body"
            fontWeight="semibold"
            letterSpacing={4}
          />
        </XStack>

        <YStack gap="$md" width="100%" maxWidth={320} marginTop="$lg">
          <Button
            theme="active"
            disabled={busy || code.trim().length === 0}
            onPress={() => void handleAccept()}
          >
            {busy ? '加入中…' : '加入家庭'}
          </Button>
          <Button
            variant="outlined"
            disabled={busy}
            onPress={() => router.back()}
          >
            返回
          </Button>
        </YStack>
      </YStack>
    </SafeAreaView>
  );
}
