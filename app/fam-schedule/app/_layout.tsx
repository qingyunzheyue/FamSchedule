import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { SplashScreen as ExpoSplashScreen, Stack, Redirect, useRouter, usePathname } from 'expo-router';
import { useEffect, useState, useCallback } from 'react';
import { TamaguiProvider, Theme } from 'tamagui';

import config from '../src/theme/tamagui.config';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { FamilyProvider, useFamily } from '../src/contexts/FamilyContext';
import { SplashScreen } from '../src/screens/SplashScreen';
import {
  init as initNotificationScheduler,
  requestNotificationPermission,
} from '../src/lib/NotificationScheduler';

// 思源黑体 / Noto Sans CJK SC — 3 字重,bundle 进 APK(~31MB,后续可子集化优化体积)
import NotoSansSCRegular from '../assets/fonts/NotoSansSC-Regular.ttf';
import NotoSansSCMedium from '../assets/fonts/NotoSansSC-Medium.ttf';
import NotoSansSCSemibold from '../assets/fonts/NotoSansSC-Semibold.ttf';

// Android 8+ 上 system font fallback 链(design-v1.0 §1.2)
// useFonts 加载失败时 Tamagui 仍能渲染,只是字重 fallback
ExpoSplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // expo-font 加载自打包 TTF
  // 字体名称必须与 src/theme/tamagui.config.ts createFont.face 中一致
  const [fontsLoaded, fontError] = useFonts({
    NotoSansSC_Regular: NotoSansSCRegular,
    NotoSansSC_Medium: NotoSansSCMedium,
    NotoSansSC_Semibold: NotoSansSCSemibold,
  });

  useEffect(() => {
    if (fontError) {
      // 字体加载失败不阻塞 — 退到系统字体(PingFang SC / Noto Sans CJK)
      // 真实失败原因(文件损坏 / OOM)会在这里 console.error 出来
      // eslint-disable-next-line no-console
      console.error('[FamSchedule] Font load error:', fontError);
    }
    if (fontsLoaded || fontError) {
      ExpoSplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // 字体未就绪:显示默认 splash,避免 layout shift
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <TamaguiProvider config={config} defaultTheme="light">
      {/* 暗色模式 follow 系统 + 应用内手动开关(DD-007)。
          T-SETUP-9 接入 settings 里的手动开关;当前 defaultTheme 写死 light,
          后续可在 RootLayout 读 useColorScheme() 动态切换 defaultTheme。 */}
      <Theme name="light">
        {/* T-SETUP-4 + T-US013-2:AuthProvider 包在 Stack 外、Theme 内。
            - 启动时 AuthContext.initialize() 调 bootGuard(retry-once 启动守卫)
            - isLoading=true 时渲染 SplashScreen(loading 模式),避免闪一下未登录态的 stack
            - bootError 非空时 Gate 渲染 SplashScreen(error 模式)+ 重试按钮
              (SplashScreen 抽到 src/screens/,见 splash-v1.0.md 设计契约)

            T-US012-1:FamilyProvider 包在 AuthProvider 内、Gate 外。
            - 依赖 useAuth().session 做 useEffect deps,session 变化自动重拉 family
            - 把原本 Gate 内 inline 的 family_members 查询下沉到 FamilyService
            - Gate 现在消费 useFamily().state,而非自己持 familyId / familyLoading
        */}
        <AuthProvider>
          <FamilyProvider>
            <Gate />
          </FamilyProvider>
        </AuthProvider>
      </Theme>
    </TamaguiProvider>
  );
}

/**
 * Gate — 在 AuthProvider + FamilyProvider 下读 auth + family 状态,决定渲染 splash 还是真路由。
 * 必须独立组件:useAuth / useFamily 必须在对应 Provider 子树里才能调。
 *
 * T-SETUP-9(已重构):Gate 之前 inline 调 supabase.from('family_members') 查 family_id,
 *   T-US012-1 起改成消费 useFamily().state — 状态来源单一(FamilyContext),刷新机制下沉。
 *
 * T-FIX-03:通知调度器拆两阶段。
 *   - `init()`(eager):mount 即触发,装 handler / 配 Android channel /
 *     注册 tap listener / 处理 cold-start。**不弹权限框**,无副作用。
 *   - `requestNotificationPermission()`(gated):**仅** `session && familyId`
 *     双条件都就绪时才触发,避免 splash 阶段突兀弹权限框
 *     (首启 UX bug + iOS App Store 审核敏感)。
 *   - 旧版 `useNotificationSchedulerInit()` 在 Gate 顶层无条件调,
 *     useEffect 早于 family 查询 commit → 弹框时序错误。本修复改用
 *     显式 import + 两个 useEffect 拆开,语义更清晰。
 *
 * T-US012-1:FamilyProvider 自动追踪 session 变化拉 family,所以 Gate 不再需要
 *   [session, pathname, refreshTick] 三重 deps 的 useEffect;改用单一 useFamily()。
 *   family state 变化(onboarding 完成)→ 直接 router.replace 到 home。
 *
 * T-US013-2:启动错误优先于其他 splash 状态显示。
 *   - bootError 非空 → 直接渲染 SplashScreen error 模式 + "重试" 按钮
 *     (auth 都没过 → 谈家庭/路由都没意义,直接阻塞错误占位等用户重试)
 *   - 重试按钮调 useAuth().retryBoot() → 重新跑一次 bootGuard(同样 retry-once 1s 退避)
 *   - 之前 splash 是 inline ActivityIndicator;现抽到 src/screens/SplashScreen.tsx,
 *     配 design-v1.0 §3 布局 + splash-v1.0.md §5 error 状态
 *
 * 状态决策顺序:
 *   1. bootError → error splash
 *   2. auth.isLoading || family.status === 'loading' → loading splash
 *   3. !session → 渲染根 Stack(理论上 AuthProvider 自动重连,这只是兜底)
 *   4. family.status === 'no_family' → 跳 onboarding
 *   5. family.status === 'in_family' → 渲染主 Stack
 */
function Gate() {
  const router = useRouter();
  const pathname = usePathname();
  const { isLoading, session, bootError, retryBoot } = useAuth();
  const family = useFamily();

  // T-FIX-BUNDLE-3:Expo Go SDK 53+ 不支持 expo-notifications 的远程推送 / 本地通知 device API
  // (会直接抛 "removed from Expo Go" error,详见 Expo 公告)。在 dev build / production / standalone
  // 仍正常工作 — 只跳过 init + permission,不跳过其他业务逻辑。
  const isExpoGo = Constants.executionEnvironment === 'storeClient';

  // T-FIX-03 (1/2):eager init — 装 handler / 配 channel / 注册 listener / cold-start
  // **不弹权限框**。失败仅 warn,不阻塞渲染(无权限仍可继续进入 app,只是不响通知)。
  useEffect(() => {
    // T-FIX-BUNDLE-3:Expo Go SDK 53+ 不支持 expo-notifications
    if (isExpoGo) return;
    initNotificationScheduler().catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[Gate] NotificationScheduler init failed:', e);
    });
  }, [isExpoGo]);

  // T-FIX-03 (2/2):gated permission request — 仅在用户已登录且加入/创建家庭后弹框。
  // 双重保险:`session` 防 anon sign-in 抢跑,`family.status === 'in_family'` 防 onboarding 阶段抢跑。
  // 典型 UX 序列:用户在 pair-create 提交 RPC → FamilyContext.refresh() → family 状态切到 in_family
  // → 本 effect 触发 → 弹原生权限框(用户此时看到任务首页 push 完成,理解通知的用途)。
  const inFamilyId = family.state.status === 'in_family' ? family.state.value.family.id : null;
  useEffect(() => {
    // T-FIX-BUNDLE-3:Expo Go SDK 53+ 不支持 expo-notifications
    if (isExpoGo) return;
    if (!session || !inFamilyId) return;
    requestNotificationPermission().catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[Gate] NotificationScheduler requestNotificationPermission failed:', e);
    });
  }, [isExpoGo, session, inFamilyId]);

  // 引导完成(创建或加入家庭)后,family 状态切到 in_family → 主动 push 到 home
  // Expo Router 用 router.replace 而非 Redirect 组件,以保证
  // onboarding stack 被弹出(用户不会 back 回 pair-create)。
  //
  // 注意:依赖 pathname 避免重复 push(每次路由变化 router.replace 会再触发,但已经在 home 时
  // pathname 已经是 /(main)/(home) → 不会循环)。
  useEffect(() => {
    if (isLoading) return;
    if (!session) return; // 等自动 anon sign-in
    if (family.state.status !== 'in_family') return; // 还在 onboarding / loading

    if (pathname !== '/(main)/(home)') {
      router.replace('/(main)/(home)');
    }
  }, [isLoading, session, family.state, pathname, router]);

  // T-US013-2:启动错误优先于其他 splash 状态显示
  // (auth 都没过 → 谈家庭/路由都没意义,直接阻塞错误占位等用户重试)
  if (bootError) {
    // T-US013-2-rev1:不传 errorMessage,文案走 SplashScreen 默认值(splash-v1.0 §6);
    // 错误文案集中管理,避免 i18n 时漏改 — 详见 review Major #1
    return <SplashScreen mode="error" onRetry={retryBoot} />;
  }

  // 任一加载未完成:显示 splash(loading 模式)
  if (isLoading || family.state.status === 'loading') {
    return <SplashScreen />;
  }

  // 没 session(理论上 AuthProvider 自动重连,这里只是兜底)→ 渲染根 Stack
  // 用户会被 Expo Router 自动带到 /(main)/(home),而 /(main)/(home) 会被
  // (main)/_layout 内的 AuthContext 触发的 useEffect 重新引导
  if (!session) {
    return (
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: '#F4ECDC' },
        }}
      />
    );
  }

  // 没家庭 → 强制 onboarding
  if (family.state.status === 'no_family') {
    return <Redirect href="/(onboarding)/pair-create" />;
  }

  // 有家庭 → 渲染主 stack(Tabs 在 (main)/_layout 里)
  return (
    <Stack
      screenOptions={{
        headerShown: false, // Tab + Stack 子树自带 header
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: '#F4ECDC' },
      }}
    />
  );
}