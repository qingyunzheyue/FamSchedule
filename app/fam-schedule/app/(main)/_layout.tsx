import { Tabs } from 'expo-router';
import { ListChecks, House, GearSix } from 'phosphor-react-native';
import { useTheme } from 'tamagui';

/**
 * T-SETUP-9 — Main bottom tabs.
 *
 * 3 tabs:
 *   - 任务  (ListChecks)    → /(home)/*
 *   - 家庭  (House)         → /(family)/*
 *   - 设置  (GearSix)       → /(settings)/*
 *
 * 激活色用赤陶 #DC5A24(DD-002),未激活走 textTertiary。TabBar 背景 surface,
 * 字体用 body 族 + meta 大小,符合 design-v1.0 §1.3。
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
          tabBarIcon: ({ color, size }) => (
            // color from tabBarIcon is RN ColorValue (含 OpaqueColorValue),
            // 而 Phosphor 期望 string|undefined — 运行时实际只是 hex / token,
            // 故 cast string 即可
            <ListChecks color={color as string} size={size} weight="regular" />
          ),
        }}
      />
      <Tabs.Screen
        name="(family)"
        options={{
          title: '家庭',
          tabBarIcon: ({ color, size }) => (
            <House color={color as string} size={size} weight="regular" />
          ),
        }}
      />
      <Tabs.Screen
        name="(settings)"
        options={{
          title: '设置',
          tabBarIcon: ({ color, size }) => (
            <GearSix color={color as string} size={size} weight="regular" />
          ),
        }}
      />
    </Tabs>
  );
}
