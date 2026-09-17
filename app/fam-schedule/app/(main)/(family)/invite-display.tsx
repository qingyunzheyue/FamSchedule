import { SafeAreaView } from 'react-native-safe-area-context';
import { YStack, Text } from 'tamagui';

/**
 * T-SETUP-9 — Invite display placeholder.
 *
 * US-012 接入:
 *   - 6 位邀请码 + 二维码
 *   - "复制邀请码"按钮(系统剪贴板)
 *   - 邀请码 24h 过期倒计时
 */
export default function InviteDisplay(): React.JSX.Element {
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
          邀请配偶
        </Text>
        <Text fontSize="$body" color="$textSecondary">
          把 6 位邀请码或二维码发给配偶,他在 onboarding 步骤输入即可加入。
        </Text>
        <Text fontSize="$meta" color="$textTertiary">
          由 US-012 接入(生成 invite / 二维码 / 倒计时)。
        </Text>
      </YStack>
    </SafeAreaView>
  );
}
