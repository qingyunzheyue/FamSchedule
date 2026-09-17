import type { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * FamSchedule — Expo app config
 *
 * 配置策略(T-FIX-02 锁定):
 * - `app.config.ts` 是 **唯一来源**(single source of truth),覆盖 `app.json` 与 `eas.json` 在 build 时合并的 config。
 * - `app.json` 保留为 Expo stub `{ "expo": {} }`,**不要**在这里加 `extra.*` / `ios.*` / `android.*`,
 *   否则会和本文件 spread 顺序产生漂移 → 改动被吞或误生效,排查极困难。
 * - `eas.json` 只负责 build profile + **build-time env 注入**(`EXPO_PUBLIC_*`),
 *   这些变量在 EAS Cloud Build 时 inline 进 JS bundle,与 `app/fam-schedule/.env` 的本地 dev 一致。
 *   改 env 值时:**`eas.json` 和 `.env` 两处都要改**(dev 只看 `.env`,build 只看 `eas.json`)。
 * - anon key(`sb_publishable_...`)是 publishable 而非 secret,Supabase 文档允许 inline 进前端 bundle。
 *   未来若引入真正的 server-side secret(例如 service_role key),迁移到 `eas env:create`(选项 A)。
 *
 * 字段说明:
 * - name: 应用展示名(中文友好)
 * - slug: URL-safe 项目标识(用于 expo.dev / OTA / EAS)
 * - scheme: 自定义 deep-link 协议(预留 push 通知 → 任务详情跳转)
 * - userInterfaceStyle: "automatic" = 跟随系统 + 应用内手动开关(DD-007)
 * - android.package: Android 唯一包名,对应 applicationId
 * - android.permissions: Android 12+ 通知 + 精确闹钟(本地通知排程必备)
 * - plugins: expo-router(路由)/ expo-notifications(通知)/ expo-font(自打包 Noto Sans CJK SC)
 * - experiments.typedRoutes: 路由参数类型安全
 * - extra.eas.projectId: EAS Project UUID,必须手写(`eas init` 对 app.config.ts + app.json 双文件有 #3018 bug)
 */
export default ({ config: loaded }: ConfigContext): ExpoConfig => ({
  ...loaded,
  name: 'FamSchedule',
  slug: 'fam-schedule',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'famschedule',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.famschedule.app',
  },
  android: {
    package: 'com.famschedule.app',
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: '#FFF9F0', // 暖色 surface 奶油,DD-002 色板
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    permissions: [
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.SCHEDULE_EXACT_ALARM',
      'android.permission.USE_EXACT_ALARM',
      'android.permission.RECEIVE_BOOT_COMPLETED',
    ],
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-notifications',
      {
        // 默认 channel 留给 expo-notifications 自动创建
        color: '#DC5A24', // 赤陶,DD-002
      },
    ],
    [
      'expo-font',
      {
        // 思源黑体 3 字重(DD-003)。prebuild 阶段会 copy 到 android/app/src/main/assets/fonts/
        fonts: [
          './assets/fonts/NotoSansSC-Regular.ttf',
          './assets/fonts/NotoSansSC-Medium.ttf',
          './assets/fonts/NotoSansSC-Semibold.ttf',
        ],
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          // 国内 Android 推送到点不准,启用 exact alarm 兜底
          usesCleartextTraffic: false,
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    router: {
      origin: false,
    },
    // T-SETUP-8: EAS project linkage (see eas.json / project @zzzshark/fam-schedule).
    // Cannot be auto-injected by `eas init` due to known eas-cli bug with app.config.ts (#3018).
    eas: {
      projectId: 'c708a76a-dfe4-407d-bde5-b11c66efc882',
    },
  },
});
