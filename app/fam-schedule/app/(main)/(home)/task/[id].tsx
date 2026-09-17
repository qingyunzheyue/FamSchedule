import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { YStack, Text } from 'tamagui';

/**
 * T-SETUP-9 — Task detail placeholder.
 *
 * US-002 任务详情会填这里。路由参数 id = task uuid。
 * 当前只显示 id 让 Expo Router 路由打通。
 */
export default function TaskDetail(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();

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
          任务详情
        </Text>
        <Text fontSize="$body" color="$textSecondary">
          task id = {id ?? '(none)'}
        </Text>
        <Text fontSize="$meta" color="$textTertiary">
          任务详情由 US-002 接入(状态切换、删除、转交)。
        </Text>
      </YStack>
    </SafeAreaView>
  );
}
