import { SafeAreaView } from 'react-native-safe-area-context';
import { YStack, XStack, Text } from 'tamagui';
import Constants from 'expo-constants';

/**
 * T-SETUP-9 — About page placeholder.
 *
 * 显示:
 *   - 应用名 + 版本号(expo-constants)
 *   - 开源许可入口(MVP 后挂)
 *   - 隐私政策(挂官网)
 */
export default function About(): React.JSX.Element {
  const version = Constants.expoConfig?.version ?? '0.0.0';

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <YStack
        flex={1}
        padding="$xl"
        gap="$md"
        backgroundColor="$background"
        alignItems="center"
        justifyContent="center"
      >
        <Text
          fontSize="$display"
          fontFamily="$heading"
          fontWeight="semibold"
          color="$primary"
        >
          FamSchedule
        </Text>
        <Text fontSize="$body" color="$textSecondary" textAlign="center">
          家庭任务协作,把家务活从口头交代变成可追踪的承诺。
        </Text>

        <XStack
          gap="$sm"
          alignItems="center"
          justifyContent="center"
          paddingVertical="$md"
        >
          <Text fontSize="$meta" color="$textTertiary">
            版本
          </Text>
          <Text fontSize="$heading" color="$textPrimary" fontFamily="$body" fontWeight="semibold">
            {version}
          </Text>
        </XStack>

        <Text fontSize="$micro" color="$textTertiary" textAlign="center">
          由 React Native + Expo + Supabase + Tamagui 构建
        </Text>
      </YStack>
    </SafeAreaView>
  );
}
