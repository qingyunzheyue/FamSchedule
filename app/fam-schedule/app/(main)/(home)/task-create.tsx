import { SafeAreaView } from 'react-native-safe-area-context';
import { YStack, Text } from 'tamagui';

/**
 * T-SETUP-9 — Create task placeholder.
 *
 * US-003 任务创建会填这里:标题 / 描述 / 到期时间 / 指派给配偶或我 / 提醒规则。
 */
export default function TaskCreate(): React.JSX.Element {
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
          新建任务
        </Text>
        <Text fontSize="$body" color="$textSecondary">
          任务标题、提醒时间、指派对象。
        </Text>
        <Text fontSize="$meta" color="$textTertiary">
          由 US-003 接入(标题输入 / 时间 picker / 家庭成员选择 / 提交 RPC)。
        </Text>
      </YStack>
    </SafeAreaView>
  );
}
