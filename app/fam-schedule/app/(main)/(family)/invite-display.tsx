import { Stack } from 'expo-router';

import { InviteScreen } from '../../../src/screens/InviteScreen';

/**
 * T-US012-2 — Invite display route(family tab → 邀请配偶页)。
 *
 * 来源契约:
 *   - T-SETUP-9 阶段是占位文字,US-012 接入后跳到 src/screens/InviteScreen。
 *   - SQL `create_invite()` 无参(auth.uid() 内部推导 family),无需 client 传 familyId。
 *   - Gate 已经保证 in_family 状态才能进 (main)/* 路由,这里无需额外 family check。
 *
 * Stack.Screen options:
 *   - title:栈标题(中文,与 pair-create 风格对齐)
 *   - headerBackTitle:iOS back 按钮文案(短,设计语言一致)
 *   - 主题色来自 (main)/(family)/_layout.tsx 的 screenOptions(NotoSansSC_Semibold 17)
 */
export default function InviteDisplayRoute(): React.JSX.Element {
  return (
    <>
      <Stack.Screen
        options={{
          title: '邀请配偶',
          headerBackTitle: '家庭',
        }}
      />
      <InviteScreen />
    </>
  );
}