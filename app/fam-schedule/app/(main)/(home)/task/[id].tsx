import { SafeAreaView } from 'react-native-safe-area-context';
import { TaskDetailScreen } from '../../../../src/screens/TaskDetailScreen';

/**
 * T-US003-1 — Task detail route。
 *
 * US-002 / US-003 任务详情(查看 + 编辑入口 + 复制/删除菜单)。
 * 路由参数 id = task uuid。本文件是 thin wrapper,把 SafeArea 容器包在
 * <TaskDetailScreen /> 外。
 */
export default function TaskDetailRoute(): React.JSX.Element {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <TaskDetailScreen />
    </SafeAreaView>
  );
}