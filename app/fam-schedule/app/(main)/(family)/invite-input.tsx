import { SafeAreaView } from 'react-native-safe-area-context';
import { YStack, Text } from 'tamagui';

/**
 * T-SETUP-9 — Invite input placeholder (US-012 备用入口).
 *
 * 与 (onboarding)/pair-join 重复,但放在家庭 tab 内,
 * 让已经配对后想换家庭的用户(理论上 PRD 不支持)能手动加入另一个家庭。
 * 实际 MVP 不开放,占位先留。
 */
export default function InviteInput(): React.JSX.Element {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <YStack
        flex={1}
        padding="$lg"
        gap="$md"
        backgroundColor="$background"
      >
        <Text
          fontSize="$title"
          fontFamily="$heading"
          fontWeight="semibold"
          color="$textPrimary"
        >
          输入邀请码
        </Text>
        <Text fontSize="$body" color="$textSecondary">
          MVP 暂不开放转家庭,占位页面。
        </Text>
      </YStack>
    </SafeAreaView>
  );
}
