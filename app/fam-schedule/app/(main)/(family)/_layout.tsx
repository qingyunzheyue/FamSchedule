import { Stack } from 'expo-router';
import { useTheme } from 'tamagui';

/**
 * T-SETUP-9 — Family stack (家庭 tab 内).
 *
 * 路由:
 *   index            → 家庭 dashboard
 *   invite-display   → 展示邀请码 / 二维码
 *   invite-input     → 输入邀请码加入(US-012 备用入口)
 */
export default function FamilyStackLayout(): React.JSX.Element {
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
