import { Stack } from 'expo-router';
import { JoinFamilyScreen } from '../../src/screens/JoinFamilyScreen';

/**
 * T-US012-3 — Pair-join (US-012 onboarding, step 2 of 2).
 *
 * 路由 thin wrapper — 全部业务逻辑在 `src/screens/JoinFamilyScreen.tsx`。
 * 之前 T-US012-1 重构引入的 inline 单 Input + acceptInvite 已废弃,
 * 改用 JoinFamilyScreen 的 6 格自动跳转 + 提交流程。
 *
 * 路由原因:
 *   - 此文件是 expo-router 的 route component,必须有 default export。
 *   - Stack.Screen 设置 navigation header(返回 + 标题),
 *     让 JoinFamilyScreen 可以是 stateless 的"纯渲染 + 副作用"
 *     组件,便于未来做 unit test 或在别的入口复用。
 *   - JoinFamilyScreen 自己负责 router.replace('/(main)/(home)')
 *     在加入成功时跳转;这里不用再写导航。
 *
 * 历史(详见 task-breakdown v1.0+us012-1):
 *   - T-SETUP-9:原始占位 pair-join.tsx(无业务逻辑)
 *   - T-US012-1:加 FamilyService.acceptInvite + 错误分类 + refresh + navigate
 *   - T-US012-3:替换为本 thin wrapper,业务下沉到 JoinFamilyScreen
 */
export default function PairJoin(): React.JSX.Element {
  return (
    <>
      <Stack.Screen options={{ title: '加入家庭', headerBackTitle: '返回' }} />
      <JoinFamilyScreen />
    </>
  );
}