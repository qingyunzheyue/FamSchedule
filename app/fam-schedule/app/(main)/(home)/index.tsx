import { SafeAreaView } from 'react-native-safe-area-context';
import { HomeScreen } from '../../../src/screens/HomeScreen';

/**
 * T-US002-1 — Tasks list home route.
 *
 * Thin wrapper:expo-router stack 决定路由;此文件只负责把 SafeArea 容器
 * 包在 <HomeScreen /> 外,让屏幕不必关心 inset(top 由 stack header
 * 处理,bottom 由 SafeAreaView edges=['bottom'] 兜底)。
 *
 * 业务逻辑全在 src/screens/HomeScreen.tsx —— 本 wrapper 不做 useEffect /
 * 副作用,纯渲染,便于 jest 单测不经过 router 触发。
 */
export default function TasksHome(): React.JSX.Element {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <HomeScreen />
    </SafeAreaView>
  );
}
