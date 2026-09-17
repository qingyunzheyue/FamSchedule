import { Stack } from 'expo-router';
import { useTheme } from 'tamagui';

/**
 * T-SETUP-9 — Settings stack (设置 tab 内).
 *
 * 路由:
 *   index        → 设置主列表(4 sections)
 *   push         → 推送设置
 *   task-rules   → 任务规则(提前提醒 / 重复)
 *   whitelist    → 系统白名单引导(DND / 电池优化)
 *   about        → 关于 / 版本号 / 开源许可
 */
export default function SettingsStackLayout(): React.JSX.Element {
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
