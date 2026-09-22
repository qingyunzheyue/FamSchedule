import { SafeAreaView } from 'react-native-safe-area-context';
import { CreateTaskScreen } from '../../../src/screens/CreateTaskScreen';

/**
 * T-US001-1 — 创建任务路由。
 *
 * thin wrapper:expo-router stack 决定路由;此文件只负责把 SafeArea 容器包
 * 在 <CreateTaskScreen /> 外,让屏幕不必关心 inset(top 由 stack header
 * 处理,bottom 由 SafeAreaView edges=['bottom'] 兜底)。
 *
 * 设计:
 *   - 业务逻辑全在 src/screens/CreateTaskScreen.tsx(纯逻辑抽到 lib/createTaskForm.ts)
 *   - 本 wrapper 不做 useEffect / 副作用,纯渲染,便于 jest 单测不经过 router 触发
 */
export default function TaskCreateRoute(): React.JSX.Element {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <CreateTaskScreen />
    </SafeAreaView>
  );
}