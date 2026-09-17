import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { YStack, XStack, Text, Button } from 'tamagui';
import { UserPlus, House } from 'phosphor-react-native';

import { useAuth } from '../../../src/contexts/AuthContext';

/**
 * T-SETUP-9 — Family dashboard placeholder.
 *
 * US-011 / US-012 接入:
 *   - 家庭成员列表(我 + 配偶)
 *   - 邀请配偶按钮(去 invite-display)
 *   - 家庭统计(本周已完成任务数等)
 */
export default function FamilyHome(): React.JSX.Element {
  const { user } = useAuth();

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <YStack
        flex={1}
        padding="$lg"
        gap="$lg"
        backgroundColor="$background"
      >
        <XStack gap="$sm" alignItems="center">
          <House size={28} color="#DC5A24" weight="duotone" />
          <Text
            fontSize="$title"
            fontFamily="$heading"
            fontWeight="semibold"
            color="$textPrimary"
          >
            我的家庭
          </Text>
        </XStack>

        {/* 家庭成员占位 */}
        <YStack
          gap="$md"
          padding="$lg"
          borderRadius="$lg"
          backgroundColor="$surface"
          borderColor="$border"
          borderWidth={1}
        >
          <Text
            fontSize="$heading"
            fontFamily="$heading"
            fontWeight="semibold"
            color="$textPrimary"
          >
            家庭成员
          </Text>

          <MemberRow name="我" identity="A" />
          <MemberRow name="配偶" identity="B" pending />
        </YStack>

        {/* 邀请配偶入口 */}
        <Link href="/(main)/(family)/invite-display" asChild>
          <Button
            theme="active"
            icon={<UserPlus size={20} color="#FFFFFF" weight="bold" />}
          >
            邀请配偶加入
          </Button>
        </Link>

        <Text fontSize="$meta" color="$textTertiary" textAlign="center">
          当前用户: {user ? user.id.slice(0, 8) : '(signed out)'}…
        </Text>
      </YStack>
    </SafeAreaView>
  );
}

interface MemberRowProps {
  name: string;
  identity: 'A' | 'B';
  pending?: boolean;
}

function MemberRow({ name, identity, pending }: MemberRowProps): React.JSX.Element {
  const isA = identity === 'A';
  const tagBg = isA ? '$identityABg' : '$identityBBg';
  const tagColor = isA ? '$identityA' : '$identityB';

  return (
    <XStack
      gap="$md"
      alignItems="center"
      justifyContent="space-between"
      paddingVertical="$sm"
    >
      <XStack gap="$sm" alignItems="center">
        <YStack
          width={40}
          height={40}
          borderRadius="$full"
          backgroundColor={tagBg}
          alignItems="center"
          justifyContent="center"
        >
          <Text fontSize="$heading" color={tagColor} fontWeight="semibold">
            {name.slice(0, 1)}
          </Text>
        </YStack>
        <Text fontSize="$heading" color="$textPrimary" fontWeight="medium">
          {name}
        </Text>
      </XStack>
      <YStack gap="$xs" alignItems="flex-end">
        <Text
          fontSize="$micro"
          color={tagColor}
          backgroundColor={tagBg}
          paddingHorizontal="$sm"
          paddingVertical="$xs"
          borderRadius="$md"
          fontWeight="semibold"
        >
          Identity {identity}
        </Text>
        {pending ? (
          <Text fontSize="$micro" color="$textTertiary">
            待加入
          </Text>
        ) : null}
      </YStack>
    </XStack>
  );
}
