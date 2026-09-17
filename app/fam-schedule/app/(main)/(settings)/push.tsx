import { SafeAreaView } from 'react-native-safe-area-context';
import { YStack, Text } from 'tamagui';

/**
 * T-SETUP-9 — Push settings placeholder (US-014 / US-008 接入).
 *
 * 计划项:
 *   - 通知渠道(任务提醒 / 家庭邀请 / 系统)
 *   - 静默时段(默认 22:00–07:00)
 *   - 提醒方式(声音 / 振动 / 仅状态栏)
 */
export default function PushSettings(): React.JSX.Element {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <YStack flex={1} padding="$lg" gap="$md" backgroundColor="$background">
        <Text fontSize="$title" fontFamily="$heading" fontWeight="semibold" color="$textPrimary">
          推送设置
        </Text>
        <Text fontSize="$body" color="$textSecondary">
          通知渠道、静默时段、提醒方式。
        </Text>
        <Text fontSize="$meta" color="$textTertiary">
          由 US-008 / US-014 接入(notifee channel + AsyncStorage 偏好)。
        </Text>
      </YStack>
    </SafeAreaView>
  );
}
