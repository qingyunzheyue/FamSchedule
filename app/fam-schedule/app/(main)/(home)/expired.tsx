import { SafeAreaView } from 'react-native-safe-area-context';
import { ExpiredTasksScreen } from '../../../src/screens/ExpiredTasksScreen';

/**
 * T-US015-3 — 过期任务列表路由。
 *
 * US-015 故事 3/3:点击 HomeScreen 顶部过期 banner 跳到此路由,展示完整过期任务列表。
 * 路由参数无 — 列表内容由 useTasks() + useFamilyValue() + family_settings.expiry_window 派生。
 *
 * thin wrapper:expo-router stack 决定路由;此文件只负责把 SafeArea 容器包在
 * <ExpiredTasksScreen /> 外,让屏幕不必关心 inset(top 由 stack header 处理,
 * bottom 由 SafeAreaView edges=['bottom'] 兜底)。
 *
 * 设计:
 *   - 业务逻辑全在 src/screens/ExpiredTasksScreen.tsx
 *   - 本 wrapper 不做 useEffect / 副作用,纯渲染,便于 jest 单测不经过 router 触发
 *   - home stack (app/(main)/(home)/_layout.tsx) 不需要显式注册此路由 — expo-router
 *     Stack 自动 file-based 扫描注册
 */
export default function ExpiredTasksRoute(): React.JSX.Element {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <ExpiredTasksScreen />
    </SafeAreaView>
  );
}