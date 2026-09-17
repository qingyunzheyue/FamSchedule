import { Redirect } from 'expo-router';

/**
 * T-SETUP-9 — Root entry redirect.
 *
 * 历史:T-SETUP-2/3/4 时这里是一个 Theme showcase 页面,用 Tamagui 1.x 的
 *   SafeAreaView / space / elevate API,留下了 14 个 TS 错误。
 *   T-SETUP-9 起,真正的根路由变成 app/(main)/(home)/index.tsx(任务列表占位),
 *   本页只做一个 Redirect,把控制权交给 app/_layout.tsx 里的 Gate。
 *
 * Gate 会根据 auth + family 状态再 Redirect 到:
 *   - /(onboarding)/pair-create  (首次登录 / 没配对家庭)
 *   - /(main)/(home)             (有 anon session + 有家庭)
 */
export default function Index(): React.JSX.Element {
  return <Redirect href="/(main)/(home)" />;
}
