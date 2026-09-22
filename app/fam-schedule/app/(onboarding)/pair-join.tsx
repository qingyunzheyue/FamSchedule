import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { YStack, XStack, Text, Input, Button } from 'tamagui';
import { useState } from 'react';

import { useAuth } from '../../src/contexts/AuthContext';
import { useFamily } from '../../src/contexts/FamilyContext';
import { acceptInvite as familyServiceAcceptInvite } from '../../src/services/FamilyService';

/**
 * T-US012-1 — Pair-join (US-012 onboarding, step 2 of 2).
 *
 * 用户输入 6 位邀请码,调 accept_invite RPC:
 *   - db-v1.1.sql §4.3:accept_invite(p_code TEXT) — 参数名是 p_code
 *   - 当前 user 已被写进对应 family 的 family_members 行
 *   - 返回新 family_id,Gate 检测到后 redirect
 *
 * 与 T-SETUP-9 的差异(本任务重构):
 *   - 不再直接调 supabase.rpc('accept_invite'),改走 FamilyService.acceptInvite()
 *   - FamilyService 返回 discriminated union 区分 invalid_code / expired / already_in_family
 *     → 这里按类型显示对应文案,不再只是 console.error 然后默默吞
 *   - 成功后调 FamilyContext.refresh() + router.replace
 */
export default function PairJoin(): React.JSX.Element {
  const router = useRouter();
  const { session } = useAuth();
  const { refresh } = useFamily();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) {
    return <Redirect href="/" />;
  }

  async function handleAccept(): Promise<void> {
    if (busy) return;
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length === 0) return;

    setError(null);
    setBusy(true);
    try {
      const result = await familyServiceAcceptInvite(trimmed);

      if (result.status === 'joined') {
        await refresh();
        router.replace('/(main)/(home)');
        return;
      }

      if (result.status === 'already_in_family') {
        // Pre-check 命中 → 跳 home
        await refresh();
        router.replace('/(main)/(home)');
        return;
      }

      if (result.status === 'invalid_code') {
        setError('邀请码无效,请检查后重试');
        return;
      }

      if (result.status === 'expired') {
        setError('邀请码已过期,请让配偶重新生成');
        return;
      }
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