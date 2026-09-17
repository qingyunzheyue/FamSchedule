import { SafeAreaView } from 'react-native-safe-area-context';
import { YStack, Text, Button } from 'tamagui';

/**
 * T-SETUP-9 — Whitelist guide placeholder (US-013 接入).
 *
 * 引导用户:
 *   - Android 关闭电池优化(后台推送关键)
 *   - 自启动 / 关联启动开启(华为 / 小米 / OPPO)
 *   - 勿扰模式例外(任务提醒不被 mute)
 *
 * 每家厂商路径不同,这里给图文步骤 + 一键跳转系统设置 Intent。
 */
export default function WhitelistGuide(): React.JSX.Element {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <YStack flex={1} padding="$lg" gap="$md" backgroundColor="$background">
        <Text fontSize="$title" fontFamily="$heading" fontWeight="semibold" color="$textPrimary">
          系统白名单引导
        </Text>
        <Text fontSize="$body" color="$textSecondary">
          任务提醒需要后台运行,以下设置能确保通知准时到达。
        </Text>

        <YStack
          gap="$sm"
          padding="$lg"
          borderRadius="$lg"
          backgroundColor="$surface"
          borderColor="$border"
          borderWidth={1}
        >
          <ChecklistItem text="关闭电池优化(FamSchedule)" />
          <ChecklistItem text="允许自启动(后台保活)" />
          <ChecklistItem text="锁定最近任务(防止被系统清理)" />
          <ChecklistItem text="勿扰模式下允许任务提醒" />
        </YStack>

        <Button theme="active" disabled>
          打开系统设置(由 US-013 接入 Intent)
        </Button>

        <Text fontSize="$meta" color="$textTertiary">
          厂商路径不同(华为 / 小米 / OPPO / vivo / 三星),由 US-013 检测机型分支。
        </Text>
      </YStack>
    </SafeAreaView>
  );
}

function ChecklistItem({ text }: { text: string }): React.JSX.Element {
  return (
    <Text fontSize="$body" color="$textPrimary" fontWeight="medium">
      • {text}
    </Text>
  );
}
