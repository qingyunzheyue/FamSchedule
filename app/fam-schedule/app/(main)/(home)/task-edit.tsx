import { SafeAreaView } from 'react-native-safe-area-context';
import { EditTaskScreen } from '../../../src/screens/EditTaskScreen';

/**
 * T-US003-1 — Edit task route。
 *
 * US-003 编辑入口(从 task-detail ⋮ → 编辑跳转)。
 * 路由参数 id = task uuid。本文件是 thin wrapper,把 SafeArea 容器包在
 * <EditTaskScreen /> 外。
 */
export default function TaskEditRoute(): React.JSX.Element {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <EditTaskScreen />
    </SafeAreaView>
  );
}