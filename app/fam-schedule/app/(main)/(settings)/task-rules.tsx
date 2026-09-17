import { SafeAreaView } from 'react-native-safe-area-context';
import { YStack, Text } from 'tamagui';

/**
 * T-SETUP-9 — Task rules placeholder (US-004 接入).
 *
 * 计划项:
 *   - 默认提前提醒时间(如 10 分钟)
 *   - 任务完成是否自动归档
 *   - 重复任务(每日 / 每周 / 自定义)
 */
export default function TaskRules(): React.JSX.Element {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <YStack flex={1} padding="$lg" gap="$md" backgroundColor="$background">
        <Text fontSize="$title" fontFamily="$heading" fontWeight="semibold" color="$textPrimary">
          任务规则
        </Text>
        <Text fontSize="$body" color="$textSecondary">
          默认提前提醒时间、自动归档、重复规则。
        </Text>
        <Text fontSize="$meta" color="$textTertiary">
          由 US-004 接入(家庭级 default_rules 写入 family_settings 表)。
        </Text>
      </YStack>
    </SafeAreaView>
  );
}
