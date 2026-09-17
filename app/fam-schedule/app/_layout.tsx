import { useFonts } from 'expo-font';
import { SplashScreen, Stack, Redirect, useRouter, usePathname } from 'expo-router';
import { useEffect, useState, useCallback } from 'react';
import { ActivityIndicator } from 'react-native';
import { TamaguiProvider, Theme, YStack } from 'tamagui';

import config from '../src/theme/tamagui.config';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import {
  init as initNotificationScheduler,
  requestNotificationPermission,
} from '../src/lib/NotificationScheduler';
import { supabase } from '../src/lib/supabase';

// 思源黑体 / Noto Sans CJK SC — 3 字重,bundle 进 APK(~31MB,后续可子集化优化体积)
import NotoSansSCRegular from '../assets/fonts/NotoSansSC-Regular.ttf';
import NotoSansSCMedium from '../assets/fonts/NotoSansSC-Medium.ttf';
import NotoSansSCSemibold from '../assets/fonts/NotoSansSC-Semibold.ttf';

// Android 8+ 上 system font fallback 链(design-v1.0 §1.2)
// useFonts 加载失败时 Tamagui 仍能渲染,只是字重 fallback
SplashScreen.preventAutoHideAsync();

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
      SplashScreen.hideAsync();
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
        {/* T-SETUP-4:AuthProvider 包在 Stack 外、Theme 内。
            - 启动时 signInAnonymously / 恢复 session 由内部 effect 处理
            - isLoading 时渲染 splash 视图(纯 ActivityIndicator,无业务 UI),
              避免闪一下未登录态的 stack */}
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </Theme>
    </TamaguiProvider>
  );
}

/**
 * Gate — 在 AuthProvider 之下读 auth + family 状态,决定渲染 splash 还是真路由。
 * 必须独立组件:useAuth 必须在 AuthProvider 子树里才能调。
 *
 * T-SETUP-9:除了 auth,还查 family_members 表判断用户是否已配对:
 *   - session 不存在 → 让 AuthProvider 的自动重连 effect 处理,这里只渲染 splash
 *   - session 有,但没 family_id → 跳 /(onboarding)/pair-create
 *   - session 有 + family_id 有 → 跳 /(main)/(home)
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
 */
function Gate() {
  const router = useRouter();
  const pathname = usePathname();
  const { isLoading, session } = useAuth();
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [familyLoading, setFamilyLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  // 用一个递增的 key 触发手动刷新 — pair-create / pair-join
  // 在 RPC 成功后 router.replace 会带动 pathname 变化,也会触发此 effect。
  const [refreshTick, setRefreshTick] = useState(0);
  const bumpRefresh = useCallback(() => setRefreshTick((n) => n + 1), []);

  // T-FIX-03 (1/2):eager init — 装 handler / 配 channel / 注册 listener / cold-start
  // **不弹权限框**。失败仅 warn,不阻塞渲染(无权限仍可继续进入 app,只是不响通知)。
  useEffect(() => {
    initNotificationScheduler().catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[Gate] NotificationScheduler init failed:', e);
    });
  }, []);

  // 检测当前 user 是否在某个家庭里
  useEffect(() => {
    if (!session) {
      setFamilyId(null);
      setFamilyLoading(false);
      return;
    }

    let mounted = true;
    setFamilyLoading(true);

    (async () => {
      try {
        // 显式 Row 泛型 — 避免 supabase-js 类型推导在 .maybeSingle() 上失败
        const { data, error } = await supabase
          .from('family_members')
          .select('family_id')
          .eq('user_id', session.user.id)
          .maybeSingle<{ family_id: string }>();

        if (!mounted) return;

        if (error) {
          // eslint-disable-next-line no-console
          console.error('[Gate] family_members query error:', error);
          setBootError(error.message);
          setFamilyId(null);
        } else {
          setFamilyId(data?.family_id ?? null);
          setBootError(null);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[Gate] family_members query threw:', err);
        if (mounted) {
          setBootError(err instanceof Error ? err.message : String(err));
          setFamilyId(null);
        }
      } finally {
        if (mounted) setFamilyLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [session, pathname, refreshTick]);

  // T-FIX-03 (2/2):gated permission request — 仅在用户已登录且加入/创建家庭后弹框。
  // 双重保险:`session` 防 anon sign-in 抢跑,`familyId` 防 onboarding 阶段抢跑。
  // 典型 UX 序列:用户在 pair-create 提交 RPC → router.replace → familyId
  // effect 重查 → familyId 落定 → 本 effect 触发 → 弹原生权限框(用户此时
  // 看到任务首页 push 完成,理解通知的用途)。
  useEffect(() => {
    if (!session || !familyId) return;
    requestNotificationPermission().catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[Gate] NotificationScheduler requestNotificationPermission failed:', e);
    });
  }, [session, familyId]);

  // 引导完成(创建或加入家庭)后,familyId 变化 → 主动 push 到 home
  // Expo Router 用 router.replace 而非 Redirect 组件,以保证
  // onboarding stack 被弹出(用户不会 back 回 pair-create)。
  useEffect(() => {
    if (isLoading || familyLoading) return;
    if (!session) return; // 等自动 anon sign-in
    if (!familyId) return; // 还在 onboarding

    // 有家庭了 → 跳到任务 tab 首页
    router.replace('/(main)/(home)');
  }, [isLoading, familyLoading, session, familyId, router]);

  // 任一加载未完成:显示 splash
  if (isLoading || familyLoading) {
    return (
      <YStack flex={1} alignItems="center" justifyContent="center" backgroundColor="$background">
        <ActivityIndicator size="large" color="#DC5A24" />
      </YStack>
    );
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
  if (!familyId) {
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
