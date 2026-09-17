import { Stack } from 'expo-router';
import { useTheme } from 'tamagui';

/**
 * T-SETUP-9 — Tasks stack (任务 tab 内).
 *
 * 路由:
 *   index           → 任务列表
 *   task/[id]       → 任务详情
 *   task-create     → 创建任务
 *
 * headerShown 打开,自定义 header(DD-004),后续 US-001 / US-002 接入。
 */
export default function HomeStackLayout(): React.JSX.Element {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: theme.background.val },
        headerStyle: { backgroundColor: theme.background.val },
        headerTintColor: theme.textPrimary.val,
        headerTitleStyle: {
          fontFamily: 'NotoSansSC_Semibold',
          fontSize: 17,
        },
        headerShadowVisible: false,
      }}
    />
  );
}
