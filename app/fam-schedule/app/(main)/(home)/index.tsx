import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { YStack, XStack, Text, Button } from 'tamagui';
import { Plus, ListChecks } from 'phosphor-react-native';

/**
 * T-SETUP-9 — Tasks list placeholder (US-001 即将填).
 *
 * 占位:用真实家庭场景喂奶粉 / 续交保险单 / 倒垃圾,而非 Lorem ipsum。
 * US-001 实现后会替换为 FlatList + TaskCard 组件。
 */
export default function TasksHome(): React.JSX.Element {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <YStack
        flex={1}
        padding="$lg"
        gap="$lg"
        backgroundColor="$background"
      >
        <XStack gap="$sm" alignItems="center">
          <ListChecks size={28} color="#DC5A24" weight="duotone" />
          <Text
            fontSize="$title"
            fontFamily="$heading"
            fontWeight="semibold"
            color="$textPrimary"
          >
            任务列表
          </Text>
        </XStack>

        <Text fontSize="$body" color="$textSecondary">
          这里是家里的所有任务,按到期时间排序。
        </Text>

        {/* 占位卡片:T-SETUP-9 完成路由骨架即可,具体任务数据由 US-001 接入 */}
        <YStack
          gap="$md"
          padding="$lg"
          borderRadius="$lg"
          backgroundColor="$surface"
          borderColor="$border"
          borderWidth={1}
        >
          <PlaceholderTask
            title="晚上 8 点 · 喂奶粉"
            who="配偶"
            badge="今天"
          />
          <PlaceholderTask
            title="本周五 · 续交保险单"
            who="我"
            badge="本周"
          />
          <PlaceholderTask
            title="明早 · 倒垃圾"
            who="轮值"
            badge="明天"
          />
        </YStack>

        <YStack marginTop="auto" alignItems="center">
          <Link href="/(main)/(home)/task-create" asChild>
            <Button theme="active" icon={<Plus size={20} color="#FFFFFF" weight="bold" />}>
              新建任务
            </Button>
          </Link>
        </YStack>
      </YStack>
    </SafeAreaView>
  );
}

interface PlaceholderTaskProps {
  title: string;
  who: string;
  badge: string;
}

function PlaceholderTask({ title, who, badge }: PlaceholderTaskProps): React.JSX.Element {
  return (
    <XStack
      gap="$md"
      alignItems="center"
      justifyContent="space-between"
      paddingVertical="$sm"
    >
      <YStack gap="$xs" flex={1}>
        <Text fontSize="$heading" color="$textPrimary" fontWeight="medium">
          {title}
        </Text>
        <Text fontSize="$meta" color="$textSecondary">
          {who}
        </Text>
      </YStack>
      <Text
        fontSize="$micro"
        color="$primary"
        backgroundColor="$identityABg"
        paddingHorizontal="$sm"
        paddingVertical="$xs"
        borderRadius="$md"
        fontWeight="semibold"
      >
        {badge}
      </Text>
    </XStack>
  );
}
