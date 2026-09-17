import { Stack } from 'expo-router';

/**
 * T-SETUP-9 — Onboarding stack.
 *
 * Onboarding 只走纵向 stack:pair-create → pair-join。
 * 自定义 header 由各页面自带(DD-004 风格),所以这里全局关掉 headerShown。
 */
export default function OnboardingLayout(): React.JSX.Element {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: '#F4ECDC' }, // = --color-background
      }}
    />
  );
}
