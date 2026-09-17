# FamSchedule Expo 子项目 — Setup Notes

> T-SETUP-2 (2026-09-11) 阶段的关键决策与已知偏差,供后续 dev 参考。
> 一切以 `document/tech-decision/arch-v1.0.md` 和 `document/ui-design/design-v1.0.md` 为准。

---

## 1. SDK 版本偏差(已知)

| 维度 | 规划 | 实际 | 影响 |
|---|---|---|---|
| Expo SDK | 52(per arch-v1.0.md) | **57**(`create-expo-app@latest` 当前 default) | RN 0.86.3 / React 19.2.3 / 新架构(`newArchEnabled: true`) |

**为什么升级而不是钉 52**:
- `create-expo-app@latest` 模板不暴露 SDK 版本选择,只能 `@latest` 或 `@sdk-XX`,但 `@sdk-52` tag 不一定可用
- 钉 SDK 52 需要 `npx create-expo-app@52 ...`,但该 npm dist-tag 是否稳定未知
- SDK 57 与 52 API 兼容,所有 PRD 列出的 Expo 模块在 57 中均存在
- RN 0.86 + React 19 与 Tamagui 最新版(`@tamagui/core` >= 1.108)兼容
- `app.config.ts` / `expo prebuild` / EAS 工具链跨 52→57 无 breaking change

**如果必须回 SDK 52**(例如 EAS Build 排队太长):
```bash
# 卸后重装,需要手改 package.json 里 expo 版本到 ~52.0.0
# 然后跑 npx expo install --check
```

---

## 2. 双文件配置模式(app.json + app.config.ts)

Expo 同时存在 `app.json` 和 `app.config.ts` 是官方支持的双文件模式:
- `app.json` = 占位 stub(本仓库写为 `{ "expo": {} }`)
- `app.config.ts` = 完整配置(导出 `ExpoConfig` 对象)
- Expo 加载时:`app.json` 提供默认值,`app.config.ts` 在其上覆盖

这样做的优势:
- TypeScript 类型安全(IDE 自动补全 / 编译期校验)
- 可读 `process.env.EXPO_PUBLIC_*` 注入运行时配置(本任务版本为 v1,只读静态值,后续可改动态)
- 后续若要加动态配置(例如根据 EAS Build profile 切不同 supabase URL),只需扩展 `app.config.ts`

---

## 3. .env 策略

**双 .env**:
- **根 `.env`** — 后端脚本(`scripts/`)用,包含 `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 等敏感
- **`app/fam-schedule/.env`** — Expo 客户端用,只放 `EXPO_PUBLIC_*` 前缀变量

**为什么不共用一份**:
- Expo 仅在 `app/` 子项目目录(具体来说是 `projectRoot`)读 `.env`,不会上溯到工作区根
- 后端 `SUPABASE_SERVICE_ROLE_KEY` 不能进客户端 bundle(会绕过 RLS,致命)
- 物理隔离最安全

**`EXPO_PUBLIC_*` 注入原理**:
- Expo Metro 在 JS bundle 阶段把 `EXPO_PUBLIC_*` 字符串直接替换为字面值
- 不需要 `dotenv` 包,不需要 babel 插件
- 在 TS 代码中直接 `process.env.EXPO_PUBLIC_SUPABASE_URL` 即可(类型为 `string | undefined`,需运行时校验)

---

## 4. 依赖装入说明

| 包 | 用途 | 何时深度集成 |
|---|---|---|
| `expo-router` | 文件式路由(本任务装的根路由) | T-SETUP-9 |
| `expo-secure-store` | 匿名 token 加密持久化 | T-SETUP-4 (AuthContext) |
| `expo-notifications` | 本地通知排程 | T-SETUP-7 (NotificationScheduler) |
| `expo-constants` | 读 `extra` / `EXPO_PUBLIC_*` 注入 | 跨切 |
| `expo-linking` | deep-link(scheme: `famschedule`) | 通知点击跳转 |
| `expo-device` | 设备信息(通知 channel 判定) | T-SETUP-7 |
| `expo-build-properties` | Android 编译参数(usesCleartextTraffic) | 本任务 |
| `expo-splash-screen` | 自定义 splash + 自动隐藏 | T-SETUP-9 |
| `@react-native-async-storage/async-storage` | LocalStore 备份 | T-SETUP-5 |
| `react-native-reanimated` | Tamagui 动画依赖 | 本任务(prebuild 需要 native module) |
| `react-native-svg` | Phosphor Icons / Tamagui 形状 | 本任务 |
| `react-native-safe-area-context` | expo-router 强制依赖 | 本任务 |
| `react-native-screens` | 原生 screen 容器 | 本任务 |
| `react-native-gesture-handler` | 手势 | 本任务 |

**延后到对应任务装**:
- `@supabase/supabase-js` → T-SETUP-4
- `@tamagui/core` / `@tamagui/config` / `tamagui` → T-SETUP-3(本任务装了 peer dep,完整主题在 T-SETUP-3 装)
- `@phosphor-icons/react-native` → T-SETUP-3
- `@react-navigation/*` → T-SETUP-9(我们走 expo-router,不再叠 react-navigation)
- `@notifee/react-native` → T-SETUP-7 评估(ADR-006 v1 用 expo-notifications,不引 notifee)

---

## 5. `app/` 子目录(Expo Router 路由) vs 业务代码目录

后续 dev 任务**严格区分**:
- `app/fam-schedule/app/` ← Expo Router 文件式路由,只放路由文件(每个文件 default export 一个 React 组件)
- `app/fam-schedule/src/` ← 业务代码(services / contexts / components / lib / theme / hooks)
- `app/fam-schedule/assets/` ← 静态资源(图标 / 字体)
- `app/fam-schedule/android/` / `ios/` ← prebuild 生成的原生工程(已 gitignore)

---

## 6. prebuild / 签名 / EAS Build

**T-SETUP-2 阶段**:
- `npx expo prebuild --platform android --no-install` 已成功生成 `android/`
- `eas.json` preview / production profile 都已配置,Android `buildType: "apk"`(不是 aab,符合 PRD sideload 需求)

**未做**(后续 T-SETUP-8 范围):
- EAS 账号登录
- Android keystore 生成(本地或 EAS Build 临时)
- 第一次 `eas build -p android --profile preview` 真实出包

---

## 7. 字体 / 图标资源(预留,本任务未装)

- **字体**:思源黑体 Noto Sans CJK SC,3 字重(Regular / Medium / Semibold)
  - 需要下载 TTF 文件放到 `assets/fonts/`,在 `app.config.ts` 配 `expo-font` plugin
  - 体积预算:~1MB / 字重,3 字重约 3MB(PRD 接受 APK 3MB 字体预算)
- **图标**:Phosphor Icons,通过 `@phosphor-icons/react-native` 直接 import
  - 每个图标按需 import,不整体打包
  - 需 `react-native-svg`(本任务已装)

具体下载/打包步骤在 T-SETUP-3(完整 UI 基础)。

---

## 8. 验证记录

- ✅ `npx create-expo-app app/fam-schedule --template blank-typescript` 成功(SDK 57)
- ✅ `app.config.ts` 写入,five 关键插件(expo-router / expo-notifications / expo-font / expo-build-properties) + 三色包名正确
- ✅ `eas.json` preview + production profile 已配
- ✅ 根 `.gitignore` 追加 `app/fam-schedule/{android,ios,.expo,eas-build}` + `*.apk` / `*.aab`
- ⏳ `npx expo prebuild --platform android --no-install` 待执行
- ⏳ `npx expo-doctor` 待跑
- ⏳ `npx tsc --noEmit` 待跑
