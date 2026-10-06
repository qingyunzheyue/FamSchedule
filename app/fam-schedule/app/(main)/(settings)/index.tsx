import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { YStack, XStack, Text, Separator, useTheme } from 'tamagui';
import { CaretRight } from 'phosphor-react-native';

/**
 * T-SETUP-9 — Settings list (US-014 占位骨架).
 *
 * 4 sections:
 *   1. 推送       → push.tsx
 *   2. 任务规则   → task-rules.tsx
 *   3. 白名单     → whitelist.tsx
 *   4. 关于       → about.tsx
 *
 * 列表项遵循 design-v1.0 §2.4:surface 背景 + 行间 separator + caret 暗示可点。
 */
export default function SettingsHome(): React.JSX.Element {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <YStack flex={1} padding="$lg" gap="$lg" backgroundColor="$background">
        <SettingsSection
          items={[
            { href: '/(main)/(settings)/push', label: '推送设置', caption: '通知渠道、静默时段' },
            { href: '/(main)/(settings)/task-rules', label: '任务规则', caption: '提前提醒、重复规则' },
          ]}
        />

        <SettingsSection
          items={[
            { href: '/(main)/(settings)/whitelist', label: '系统白名单', caption: '勿扰、电池优化自启动' },
          ]}
        />

        <SettingsSection
          items={[
            { href: '/(main)/(settings)/about', label: '关于 FamSchedule', caption: '版本号、开源许可' },
          ]}
        />
      </YStack>
    </SafeAreaView>
  );
}

interface SettingsItem {
  href: string;
  label: string;
  caption: string;
}

function SettingsSection({ items }: { items: SettingsItem[] }): React.JSX.Element {
  // T-FIX-06-B M03:CaretRight 是 phosphor 组件,color prop 接受 hex string(不像 Tamagui 组件
  // 可直接传 `$textTertiary` token)。这里走 Batch A M24 模式:useTheme() 拿当前主题下的
  // $textTertiary.val → 喂给 phosphor color,跨 light/dark 自动适配。
  const theme = useTheme();
  const textTertiary = (theme.textTertiary?.val ?? '#A89B86') as string;

  return (
    <YStack
      gap="$xs"
      padding="$md"
      borderRadius="$lg"
      backgroundColor="$surface"
      borderColor="$border"
      borderWidth={1}
    >
      {items.map((it, idx) => (
        <YStack key={it.href}>
          <Link href={it.href} asChild>
            <XStack
              gap="$md"
              alignItems="center"
              justifyContent="space-between"
              paddingVertical="$md"
              paddingHorizontal="$sm"
              pressStyle={{ opacity: 0.6 }}
            >
              <YStack gap="$xs" flex={1}>
                <Text fontSize="$heading" color="$textPrimary" fontWeight="medium">
                  {it.label}
                </Text>
                <Text fontSize="$meta" color="$textSecondary">
                  {it.caption}
                </Text>
              </YStack>
              <CaretRight size={18} color={textTertiary} weight="regular" />
            </XStack>
          </Link>
          {idx < items.length - 1 ? <Separator borderColor="$border" /> : null}
        </YStack>
      ))}
    </YStack>
  );
}
