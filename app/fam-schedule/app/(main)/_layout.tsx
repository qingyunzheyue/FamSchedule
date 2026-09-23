import { Tabs } from 'expo-router';
import { ListChecks, UsersThree, Gear } from 'phosphor-react-native';
import { useTheme } from 'tamagui';

import { PhosphorTabIcon } from '../../src/components/PhosphorTabIcon';

/**
 * T-SETUP-9 / T-FIX-05 — Main bottom tabs.
 *
 * 3 tabs(DD-005 锁定顺序):
 *   - 任务  (ListChecks)     → /(home)/*
 *   - 家庭  (UsersThree)     → /(family)/*    [T-FIX-05:House → UsersThree]
 *   - 设置  (Gear)           → /(settings)/*  [T-FIX-05:GearSix → Gear]
 *
 * 视觉契约(DD-005 + T-FIX-05):
 *   - 激活色用赤陶 #DC5A24(DD-002),未激活走 textTertiary
 *   - TabBar 背景 surface,字体用 body 族 + meta 大小,符合 design-v1.0 §1.3
 *   - active icon weight='fill',inactive weight='regular'(Phosphor 双权切换)
 *   - active icon 下方加 4×4 赤陶圆点指示器(PhosphorTabIcon 内部)
 *   - 底部 12px 安全区(height 64+12,paddingBottom 12)
 *
 * a11y:expo-router TabBarItem 自动给每个 tab 加 `accessibilityRole="tab"` +
 * `accessibilityState={{selected: focused}}`,icon 本身无需 label(title 已被读出)。
 */
export default function MainLayout(): React.JSX.Element {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false, // 子 stack 自带 header(DD-004)
        tabBarActiveTintColor: '#DC5A24', // = primary
        tabBarInactiveTintColor: theme.textTertiary.val,
        tabBarStyle: {
          backgroundColor: theme.surface.val,
          borderTopColor: theme.border.val,
          height: 64 + 12, // 64 默认 + 12 安全区(T-FIX-05 DD-005)
          paddingBottom: 12,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontFamily: 'NotoSansSC_Regular',
          fontSize: 12,
        },
      }}
    >
      <Tabs.Screen
        name="(home)"
        options={{
          title: '任务',
          tabBarIcon: ({ color, focused, size }) => (
            // color from tabBarIcon is RN ColorValue (含 OpaqueColorValue),
            // 而 Phosphor 期望 string|undefined — 运行时实际只是 hex / token,
            // 故 cast string 即可
            <PhosphorTabIcon
              Icon={ListChecks}
              focused={focused}
              color={color as string}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="(family)"
        options={{
          title: '家庭',
          tabBarIcon: ({ color, focused, size }) => (
            <PhosphorTabIcon
              Icon={UsersThree}
              focused={focused}
              color={color as string}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="(settings)"
        options={{
          title: '设置',
          tabBarIcon: ({ color, focused, size }) => (
            <PhosphorTabIcon
              Icon={Gear}
              focused={focused}
              color={color as string}
              size={size}
            />
          ),
        }}
      />
    </Tabs>
  );
}