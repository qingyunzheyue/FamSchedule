# FamSchedule — 开发任务拆解 v1.0

> 17 个 P0 用户故事(PRD v1.3)→ 具体 dev tasks

---

## 文档元信息

| 字段 | 值 |
|---|---|
| 项目名称 | FamSchedule |
| 文档版本 | v1.0(baseline)+ 后续清理 + **§3.5 review 修复任务** |
| 创建日期 | 2026-09-10 |
| **状态** | **✅ Approved(基线)+ 后续清理已整合 + Review fixes 已排期** |
| 作者 | tech-lead |
| 来源 PRD | v1.3 |
| 关联设计 | arch-v1.0.md / **db-v1.1.sql**(原 v1.0 已弃用)/ api-v1.0.yaml |
| 关联 ADRs | adr-001 ~ adr-007 |
| 最近更新 | 2026-09-17 — **T-US013-1 ✅ done**(AuthService + SecureStore 持久化层抽离,AuthContext 从 236 行减到 196 行,15 个新单测全 pass);Wave 1 P0 修复 3/3 全清(T-FIX-01/02/03);US-013 进度 0/2 → 1/2;T-US013-2 splash guard + T-US012-1 FamilyService.create 解锁;§3.5 Review 修复任务新增 6 项(T-FIX-01..06)+ §9 Recommended Execution Order;源自 code-reviewer 对 SETUP 阶段的 NEEDS FIXES 评审(0 Critical / 3 Major / 11 Minor / 6 Cross-stack);3 个 P0 修复(T-FIX-01 同步数据丢失 / T-FIX-02 EAS projectId 一致性 / T-FIX-03 通知权限弹窗时机)**全部完成**,T-FIX-04..06 P1 留在 Sprint 2 Wave 2 主线收尾 |

---

## ChangeLog

| 版本 | 日期 | 作者 | 变更摘要 |
|---|---|---|---|
| v1.0 | 2026-09-10 | tech-lead | 初版,从 17 US 拆出 60 个 dev task,含进度表、依赖图、Sprint 排期 |
| v1.0+fix | 2026-09-11 | tech-lead | **T-SETUP-1.1 done** — db-v1.1.sql released,整合 3 个生产阻塞 fix(RLS 递归 + checkin/undo_checkin PL/pgSQL 同名列歧义);arch-v1.0.md §10/§11 同步;SETUP 进度 1/9 → 2/10(新增 T-SETUP-1.1 元清理任务,记为 Done) |
| v1.0+s2 | 2026-09-11 | frontend-dev | **T-SETUP-2 done** — Expo SDK 57 + RN 0.86 + React 19.2 项目脚手架完成于 `app/fam-schedule/`;实际 SDK 比规划(52)新,但 API 兼容,所有 PRD 列出的 Expo 模块在 57 中均存在;双文件配置 `app.json`(stub)+ `app.config.ts`(主) + `eas.json` preview/production + `android/` prebuild 成功 + `expo-doctor` 21/21 通过;`tsc --noEmit` 干净;SETUP 进度 2/10 → 3/10 |
| v1.0+s3 | 2026-09-11 | frontend-dev + Mavis | **T-SETUP-3 done** — Tamagui 主题 + 思源黑体 3 字重 + Phosphor icons + Babel 编译优化 + Expo Router 根 layout;`src/theme/tamagui.config.ts`(7KB)写入 design-v1.0 §1.1 全部 token(赤陶/亚麻/灰蓝/暗色/6 字号阶梯);3 字体各 ~10.5MB(待出包前子集化);`app/_layout.tsx` 装 TamaguiProvider;showcase 页有 11 个 Tamagui 1.x API 错误留待 T-SETUP-9 重写(非阻塞);SETUP 进度 3/10 → 4/10 |
| v1.0+s4 | 2026-09-15 | frontend-dev | **T-SETUP-4 done** — Supabase 客户端 + AuthContext 就绪;`src/lib/supabase.ts`(singleton + ExpoSecureStoreAdapter) + `src/contexts/AuthContext.tsx`(Provider + useAuth hook + 自动重连 anon) + `src/types/database.ts`(手写 DB 类型,6 表 + 1 视图 + 6 RPC);`app/_layout.tsx` 加 AuthProvider 包 + Gate 组件控制 isLoading splash;`app/index.tsx` 末尾追加 Auth 调试区(故意不引入新的 Tamagui 1.x API 错误);`tsc --noEmit` 0 新增 error,`expo-doctor` 21/21 通过;SETUP 进度 4/10 → 5/10 |
| v1.0+s5 | 2026-09-15 | frontend-dev | **T-SETUP-5 done** — LocalStore 模块(AsyncStorage 封装 + 离线写队列)就绪;`src/lib/LocalStore.ts`(6.7KB,5 reserved keys + 8 typed get/set + 4 queue ops + 1 debug helper;PendingMutation discriminated union 业务层抽象,SyncManager 会展开为 ADR-005 低层形态);jest 测试栈首次装入(jest@29.7 + jest-expo@57.0.5 + babel-preset-expo@57.0.11 + @react-native/jest-preset@0.86.3 + react-dom@19.2.3 + ts-jest@29.4);`__tests__/LocalStore.test.ts` 6 个测试全 pass(DoD 5 + 1 个 sanity);jest 配通踩坑 3 处:`babel-preset-expo` jest-expo 不自带需单独装;`@react-native/jest-preset` jest-expo peer dep 需装;`tamagui/jsx-runtime` 需 moduleNameMapper 指向 react/jsx-runtime(因 babel.config.js jsxImportSource 是 tamagui);`jest.setup.js` mock AsyncStorage native module;`tsc --noEmit` 0 新增 error;SETUP 进度 5/10 → 6/10 |
| v1.0+s6 | 2026-09-15 | frontend-dev | **T-SETUP-6 done** — SyncManager 模块(offline-first sync backbone,核心 L effort)就绪;`src/lib/SyncManager.ts`(24.5KB / 660 行)实现 DoD 全 6 项:`subscribeFamily(familyId)` 订阅 4 张表 Realtime(tasks / task_templates / family_settings / family_members,filter `family_id=eq.<uuid>`)+ 初始 pullSince;`enqueueAndApply(mutation)` 本地乐观写 cache + in-memory dedup map + 入队 + 在线时即触发 replay;`replayQueue()` FIFO + 失败 warn-log + re-enqueue 到 tail(非抛错,fire-and-forget 友好);`pullSince(lastSyncAt)` null 走 1970 通配、传入数字转 ISO string、合并 cache;`initNetworkListener()` 监听 offline → online 触发 `onReconnect` 闭环(replay → pull);`unsubscribeAll()` 释放 channel + NetInfo 订阅 + 清 currentFamilyId;`useSyncManager(familyId)` hook 集成 AppState(background → unsubscribe / active → resubscribe)+ useSyncExternalStore 订阅 isOnline;`applyOptimisticUpdate` 处理 5 种 mutation(checkin / undo_checkin / create_task / update_task / delete_task)的本地即时回写;`executeOnServer` 把高层 mutation 展开为 RPC(checkin_task / undo_checkin)或 PostgREST(create_task / update_task / delete_task);`__tests__/SyncManager.test.ts` 8 个测试全 pass:`enqueueAndApply(checkin)` 乐观更新 + 入队 + 在线 replay;`enqueueAndApply(undo_checkin)` 清 completed_at;`replayQueue` 失败 re-enqueue 到 tail;`pullSince(null)` 走 1970 通配;`pullSince(ts)` 数字 → ISO string;LWW 合并(同 id server 覆盖 local);`subscribeFamily` 同 family 幂等(不重复 channel);类型 sanity。test 踩坑 4 处:`jest.requireActual('react-native')` spread 会触发 DevMenu TurboModule 查找 invariant → 改最小 stub(只 Platform.select + AppState);jest.mock 必须在 import 前;`pullSince` 内部 `if (!currentFamilyId) return` 测试需先 subscribeFamily 设 state;supabase-js 2.116 typed `rpc()` Args 默认 `never`,对象 literal 失败 → 加 `as never`(Insert/Update 类型同样需要)。`tsc --noEmit` 0 新增 error(仍 14 carry-over 全部在 Tamagui 1.x API 文件上,out of scope);SETUP 进度 6/10 → 7/10 |
| v1.0+s7 | 2026-09-15 | frontend-dev | **T-SETUP-7 done** — NotificationScheduler 模块(本地通知排程,HIGH RISK)就绪;`src/lib/NotificationScheduler.ts`(14.3KB)实现 DoD 全 7 项:`init()` 幂等 — 装 handler(shouldShow* banner+list+sound)+ 申请权限(ios 配 allowAlert/Sound,android POST_NOTIFICATIONS)+ 配 2 个 Android channel(`task-reminders` HIGH 赤陶 lightColor #DC5A24 / `digest` DEFAULT)+ 注册 tap listener + 处理 cold-start `getLastNotificationResponseAsync`;`scheduleTaskReminder(task)` 用 `task-reminder:<id>` identifier + `SchedulableTriggerInputTypes.DATE` + Android channelId,已完成/过去时刻早返回 null(契约:不自动 cancel 已存在 reminder,需调用方显式 cancelByTaskId);`scheduleDigest(morningTime, eveningTime)` 同时排 2 个 `SchedulableTriggerInputTypes.DAILY`,先 cancel 旧 digest 防时间改了仍在响,parseHHMM 接受 HH:MM / HH:MM:SS 两种格式;`cancelByTaskId(taskId)` 静默吞 cancel 异常(防未排过报错);`rescheduleAll(tasks, settings)` 拉 `getAllScheduledNotificationsAsync` → 过滤 task-reminder 前缀 cancel → 重排每条未来+未完成任务 → 排 digest,返回 `{taskReminders, digests}` 计数;`setNotificationTapHandler(handler)` UI 层注册回调,init 内 listener 从 `data.taskId` 抽出(task reminder 有 / digest 走 null);`useNotificationSchedulerInit()` hook 集成到 `app/_layout.tsx` 的 Gate(AuthProvider 已就绪 + 不影响字体/splash 同步路径);模块顶部注释 5 条 Android 已知缺陷(Exact Alarm / POST_NOTIFICATIONS / Doze / 国产 ROM / 强杀)对应 ADR-006 已知缺陷。`__tests__/NotificationScheduler.test.ts` 16 个测试全 pass:init 4 项(handler+permission / 配 2 channel / 拒权限 false+warn / 幂等);scheduleTaskReminder 3 项(ID 格式 + content.data.taskId / 已完成 null / 过去 null);cancelByTaskId 2 项(正确 ID / 失败不抛);scheduleDigest 1 项(同时 2 个 DAILY 触发 + parseHHMM 双格式);rescheduleAll 3 项(取消旧 task-reminder / 跳过完成+过去 / 空任务列表仍排 digest);tap routing 3 项(从 data.taskId 抽 taskId / digest 走 null / cold-start 走 lastResponse)。test 踩坑 2 处:`Task` / `FamilySettings` 类型应从 `src/lib/LocalStore` import(re-export 自 database.ts),不直接从 database.ts 拿(后者只导 `TaskRow` / `FamilySettingsRow`);rescheduleAll 旧测试误期望 digest-morning 不在 cancelledIds — 实际 scheduleDigest 内部本来就会 cancel 旧 digest 以替换时间,接受即可。`tsc --noEmit` 0 新增 error;`npx jest` 全 30/30 pass(LocalStore 6 + SyncManager 8 + NotificationScheduler 16);SETUP 进度 7/10 → 8/10 |
| v1.0+s9 | 2026-09-17 | frontend-dev | **T-SETUP-9 done** — Expo Router 文件式导航骨架完成,**Sprint 1 SETUP 10/10 收尾**。`app/index.tsx` 改 `<Redirect href="/(main)/(home)" />`(清除 T-SETUP-3 留下的 14 个 Tamagui 1.x API 错误)+ 新建 18 个 page/layout 文件:onboarding 2 屏(pair-create / pair-join 调真实 RPC)+ tasks 3 屏(index 占位 / task/[id] / task-create)+ family 4 屏(dashboard / invite-display / invite-input + ghost avatar pattern,A 我 / B 配偶)+ settings 5 屏(主页 + push / task-rules / whitelist / about)+ 6 个 stack/tab layout;Tab 顺序按 DD-005 锁定:任务 ListChecks / 家庭 House / 设置 GearSix,active 赤陶 `#DC5A24`(surface 背景 tabBar);`app/_layout.tsx` Gate 升级:除 auth 检查还查 `family_members` 表判断 `family_id`,没家庭 → `<Redirect href="/(onboarding)/pair-create" />`,有 → 进 main;`usePathname()` 监听路由变化触发重新查询(pair-create/join RPC 成功后 auto-replace 触发 gate 重查放行);**修复 carry-over 阻断错误**:`src/theme/tamagui.config.ts` 原用 `createTheme()` + `@tamagui/config.defaultConfig`(Tamagui 2.x 已不导出),runtime 会抛 `undefined is not a function`,改用 `getDefaultTamaguiConfig('native')` + 纯对象 themes;同时把 `onlyAllowShorthandStyleProps` 改名 `onlyShorthandStyleProps`;pair-create / pair-join RPC 用 `(supabase.rpc as CallableFunction)(name, args) as { error: ... }` cast 绕过 supabase-js typed Database 的 Args narrowing quirk(原 `as never` cast 在 type narrowing 上有边界 case,CallableFunction 更稳);`src/types/database.ts` 修正 RPC args 类型:`CreateFamilyArgs = undefined` / `CreateInviteArgs = undefined` / `AcceptInviteArgs = { p_code: string }`(对齐 db-v1.1.sql §4.1/§4.2/§4.3 真实签名);(main)/_layout.tsx TabBarIcon `color as string`(ColorValue → string 收窄);`_layout.tsx` Redirect href 用 `/(onboarding)/pair-create`(保留括号,与 Expo Router file system 路径匹配);Gate family 查询加 `.maybeSingle<{ family_id: string }>()` 显式 Row 泛型。**测试结果**:`tsc --noEmit` 0 errors(原 14 个 carry-over + 全部新加错误清零);`jest --silent` 30/30 pass(无回归);`expo-doctor` 20/21(1 fail 是 patch version drift:expo 57.0.22 vs 57.0.23 / expo-build-properties 57.0.17 vs 57.0.20 / expo-notifications 57.0.18 vs 57.0.19,与本任务无关)。**下游解锁**:US-001 / US-002 / US-003 / US-012 / US-014 / US-017 现在都有页面骨架可填业务 UI。SETUP 进度 8/10 → 10/10 ✅ |
| v1.0+review1 | 2026-09-17 | tech-lead | **code-reviewer 评审 → §3.5 Review 修复任务 6 项 + §9 Recommended Execution Order**。评审 verdict = NEEDS FIXES(0 Critical / 3 Major / 11 Minor / 6 Cross-stack)。Major #1(`SyncManager.pullSince` 行 527 无条件 `setLastSyncAt`)→ **T-FIX-01 P0**(数据丢失风险:query 失败仍推进时间戳);Major #2(三处 `projectId` 不一致:app.json `e6c408cf-...` / app.config.ts `c708a76a-...` / eas.json 无)→ **T-FIX-02 P0**(配置卫生 + EAS silent miss);Major #3(`useNotificationSchedulerInit()` 在 Gate 早于 family 检查触发 `requestPermissionsAsync`)→ **T-FIX-03 P0**(首启 UX regression + iOS 审核敏感)。Minor 收敛 + Cross 部分 → **T-FIX-04 P1(Realtime eventType 防 DELETE)+ T-FIX-05 P1(DD-005 tab fidelity)+ T-FIX-06 P1(hygiene batch:expo patch 漂移 / hex→tokens / tap listener cleanup / PlaceholderTask 抽组件 / LocalStore RMW TODO 注释 / PhosphorTabIcon helper / rpcTyped 统一 cast / parseHHMM fallback 文档 / SplashScreen test-safe)**。Cross #2(`RecurrenceRule` 类型窄)+ Cross #5(OpenAPI client 生成)→ 不在 Sprint 2 修,defer 清单写在 §3.5 末。变动文件:**仅本文件**;无 ADR / schema / API 契约变更(`tsc --noEmit` 仍 0 error,`jest --silent` 仍 30/30 pass) |
| v1.0+fix01 | 2026-09-17 | frontend-dev | **T-FIX-01 done** — 修复 `SyncManager.pullSince` 数据丢失守卫(原行 527 无条件 `setLastSyncAt`)。`app/fam-schedule/src/lib/SyncManager.ts` §8 重构:`pullSince` 改签名 `Promise<void>` → `Promise<PullStatus>`(`{ ok, tasks, templates, settings }` 4 字段);引入 `tasksOk / templatesOk / settingsOk` 三个子标志,任一 query 返回 error → 该标志 false;函数末尾 `if (ok) await setLastSyncAt(Date.now()) else console.warn('[SyncManager] pullSince partial failure — last_sync_at NOT advanced ...')`;失败时保留旧时间戳,下次 pullSince 自动重试缺失表;`!currentFamilyId` 早返回路径同步改为 `{ ok: false, tasks: false, templates: false, settings: false }`。注释块强化:明确写出"T-FIX-01 数据丢失守卫" + 触发条件 + 后果。原两处 caller(`subscribeFamily` 行 171 内部拉取 + `onReconnect` 行 592 网络恢复拉取)均 `await pullSince(...)` 丢弃返回值,签名 `void → PullStatus` 兼容,**零改动**。新增导出 `PullStatus` interface 供未来上层做"上次同步未完成" UI。`__tests__/SyncManager.test.ts` 新增 describe `SyncManager.pullSince partial-failure guard (T-FIX-01)` 2 用例:全成功 → status 全 true + `last_sync_at` 推进(`baseline = 1700000000000` 强基线避免 before===after 假阳性);tasks 5xx + templates/settings OK → status.tasks=false + ok=false + `last_sync_at` 严格不变(`expect(after).toBe(before)`)。`tsc --noEmit` 0 新增 error;`jest --silent` 32/32 pass(原 30 + 2 新,零回归)。**bug 当时是否真实影响**:code-reviewer 评审日(2026-09-17)才标记,本 fix 上线前未真正发生数据丢失(无用户反馈 + 无生产 session);fix 上线后 5xx 场景下 spouse 的增量 tasks 行不再被永久跳过。变动文件:仅 `SyncManager.ts` / `SyncManager.test.ts` / 本文件;无 ADR / schema / API 契约变更;FIX rollup 0/6 → 1/6(T-FIX-02/03 P0 + T-FIX-04..06 P1 仍在 Sprint 2 第一波) |
| v1.0+fix02 | 2026-09-17 | frontend-dev | **T-FIX-02 done** — 收敛 EAS `projectId` 三处漂移 + env var 单一来源。**已选策略(B)**:`eas.json` 的 `build.preview.env` 块为 build-time 单一来源,与本地 dev 的 `app/fam-schedule/.env` 镜像(anon key 本就 publishable,Supabase 文档允许 inline,不切选项 A 的 `eas env:create`)。`app/fam-schedule/app.json` 清成 `{ "expo": {} }`(删 stale `extra.eas.projectId = e6c408cf-...` 与冗余 `extra.router.origin`),`app.config.ts` 顶部加 ~30 行 JSDoc 锁定 single-source-of-truth 政策(明确禁止未来向 `app.json` 写 `extra.*`/`ios.*`/`android.*`,改 env 值必须同时改 `eas.json` + `.env`)。`eas.json` env 块未改值 — 与 `.env` 已逐项对齐(URL `*.supabase.co` / anon key `sb_publishable_*`)。**验证**:`npx tsc --noEmit` exit 0;`npx expo config --type public` merged config 中 `c708a76a-...` × 1、`e6c408cf-...` × 0(stale 已从 merged 消失);`npx eas config --profile preview` 跳过(需 `eas login` 网络往返,按 DoD "trust the merged npx expo config");**未**真提交 EAS build(按 task 约束,避免 10-20 min 队列)。`extra.eas.projectId` 值保持 `c708a76a-dfe4-407d-bde5-b11c66efc882`(T-SETUP-8 GraphQL 旁路写入的工作值),T-SETUP-8 build `0246b4cd-...` 链路不变。变动文件:`app.json` / `app.config.ts`(仅顶部注释)/ 本文件;`eas.json` / `.env` / `.gitignore` **未改**;FIX rollup 1/6 → 2/6(T-FIX-03 P0 优先,后续 T-FIX-04..06 P1)。**范围外发现(留 hygiene batch)**:`.gitignore` 仅忽略 `.env*.local` 不忽略 `.env`,与 `.env` 第 4 行"本文件已被 .gitignore 排除"注释矛盾;当前内容仅为 publishable anon key,不构成 secret 风险,但建议 T-FIX-06 内追加 `.env`(去掉 `.local` 后缀) |
| v1.0+fix03 | 2026-09-17 | frontend-dev | **T-FIX-03 done** — NotificationScheduler `init()` 拆分两阶段,移除 splash 抢弹权限框。**已选 Option B(变体)**:`NotificationScheduler.ts` 拆出 `requestNotificationPermission()` 与 `init()` 并存 — `init()`(eager)装 handler / 配 Android channel / 注册 tap listener / 处理 cold-start,**不**触发 `requestPermissionsAsync`;`requestNotificationPermission()`(gated)**仅**做权限申请,模块级 `permissionRequested` flag 守护幂等;`_resetForTests` 同步重置两 flag。`_layout.tsx` Gate 拆两个 useEffect:第一个 mount 即 `initNotificationScheduler().catch(warn)`,第二个 `[session, familyId]` deps 双条件触发 `requestNotificationPermission().catch(warn)` —— 用户登录 + 加入/创建家庭 = `familyId` 落定 = `router.replace('/(main)/(home)')` 推送 home tab 的同一 tick 弹框,语义最自然。`useNotificationSchedulerInit()` hook 保留(标注为 "eager init wrapper"),业务上不再调用。**测试重构**:`NotificationScheduler.test.ts` 原 4 个 `init()` 测试拆为 `init (T-FIX-03 eager stage)` 4 用例(handler/channels/listener+cold-start/idempotent-re-register-not-permission)+ `requestNotificationPermission (T-FIX-03 gated stage)` 4 用例(granted/denied/idempotent/no-init-precondition)。原"handles cold-start"用例保留在 tap routing block 不动。**验证**:`tsc --noEmit` 0 error;`jest --silent` 36/36 pass(原 32 + 4 新,零回归);FIX rollup 2/6 → 3/6(**Wave 1 P0 修复 3/3 收尾**,T-FIX-04..06 P1 仍待 Sprint 2 主线收尾)。**手动验证清单**(EAS build 跑出后):Android 清数据冷启动 → splash → onboarding(pair-create/join)→ 用户提交 RPC → familyId 落定 → home tab push 完成 tick 弹权限框(iOS 同);**splash 阶段完全不弹**。变动文件:`src/lib/NotificationScheduler.ts` / `app/_layout.tsx` / `__tests__/NotificationScheduler.test.ts` / 本文件;**严格 scope** 内,未触碰其他修复(T-FIX-04/05/06 不动) |
| v1.0+us013-1 | 2026-09-17 | frontend-dev | **T-US013-1 done** — AuthService + SecureStore 持久化层抽离,业务逻辑从 AuthContext 下沉到独立 service 模块。**核心决策**:DoD #4(TOKEN_REFRESH 失败 / SIGNED_OUT 自动重连 anon)的策略层放在 AuthService,而**非** AuthContext — 业务层 AuthService 才懂"session 生命周期";AuthContext 只负责把 AuthState 翻译成 React state。AuthService 提供 `markIntentionalSignOut()` 一次性 flag 防止用户主动 signOut 被自动重连接住(原 AuthContext 的 `intentionalSignOutRef` 保留为 UX 守卫,双层防御:AuthService 也有 module-level flag,任一层失效另一层兜底)。**模块形态**:模块级函数(非 class),匹配 SyncManager / LocalStore 风格。**新文件**:`src/services/AuthService.ts`(15.6KB / 361 行),DoD 全 4 项实现:`signInAnonymously()` 调 `supabase.auth.signInAnonymously()` 包 try/catch → 不抛,返回 `{status:'signed_out'}` 让上层决定重试;`restoreSession()` 调 `supabase.auth.getSession()` + 过期检查 + `refreshSession` 兜底(SDK 内部已自动从 SecureStore 读,本函数是 defensive rehydrate);`clearSession()` 调 `supabase.auth.signOut()` + 防御性 `SecureStore.deleteItemAsync('auth:session')`(no-op 兜底,SDK 真用 key 是 `sb-<project-ref>-auth-token`);`subscribeAuthState(onChange)` 包装 `supabase.auth.onAuthStateChange`,事件映射 INITIAL_SESSION/SIGNED_IN/TOKEN_REFRESHED/USER_UPDATED → signed_in,SIGNED_OUT → signed_out(若非主动则自动 signInAnonymously 重连)+ markIntentionalSignOut 后跳过重连;幂等(重复订阅先 unsub 旧的);`_resetForTests()` 重置 listener + flag 与 SyncManager 对齐;`AuthState` 是 discriminated union(`loading | signed_out | signed_in {session, user}`)让 TS exhaustiveness 检查生效。**AuthContext 重构**:236 → 196 行(-17%,-40 行);不再直接调 `supabase.auth.*`,全部走 AuthService;`signOut()` 前调 `AuthService.markIntentionalSignOut()` + ref 双标记;原 auto-reconnect useEffect 删除(职责下沉到 AuthService);公共 API `{user, session, isLoading, signInAnonymously, signOut}` 不变,18 个 page 零改动。**测试**:`__tests__/AuthService.test.ts` 新增 15 用例(`signInAnonymously` 3:success/error/throw + `restoreSession` 4:valid/none/expired-refresh-fail/expired-refresh-ok + `clearSession` 2:signOut+delete/throwing-signOut-still-deletes + `subscribeAuthState` 5:SIGNED_OUT-auto-reconnect/intentional-suppress/TOKEN_REFRESHED/unsubscribe-detaches/幂等 + `_resetForTests` 1),全部 pass。Mock 模式:supabase 整个模块 mock 暴露 `auth.{signInAnonymously,signOut,getSession,refreshSession,onAuthStateChange}` + `expo-secure-store.deleteItemAsync`;`onAuthStateChange` 用 `mockImplementation` 捕获 callback 供测试手动 emit 事件。**踩坑**:jest.fn() + mockImplementation 把回调参数类型推导成 `never`,导致 capturedCallback 后续调用编译失败 → 改用显式类型变量 `let mockListener: (event, session) => void`,规避类型 narrow。**验证**:`tsc --noEmit` 0 新增 error(仍 14 carry-over 全部在 Tamagui 1.x API 文件,out of scope);`jest --silent` 51/51 pass(原 36 + 15 新,零回归);US-013 进度 0/2 → 1/2;SETUP rollup 不变(T-US013-1 不属于 SETUP);**下游解锁** T-US013-2(SplashScreen)+ T-US012-1(FamilyService.create)。变动文件:`src/services/AuthService.ts`(新)/ `src/contexts/AuthContext.tsx`(重构)/ `__tests__/AuthService.test.ts`(新)/ 本文件;无 ADR / schema / API 契约变更

---

## §1 进度总览

### 1.1 按状态统计

| 状态 | 数量 |
|---|---|
| ✅ Done(已完成) | 12(T-SETUP-1 + T-SETUP-1.1 + T-SETUP-2 + T-SETUP-4 + T-SETUP-5 + T-SETUP-6 + T-SETUP-7 + T-SETUP-9 + **T-FIX-01** + **T-FIX-02** + **T-FIX-03** + **T-US013-1**)— **Sprint 1 SETUP 全清 + Wave 1 P0 修复 3/3 收尾 + US-013 启动** |
| 🟡 In Progress(进行中) | 1(T-SETUP-8 — EAS Build 排队中) |
| ⚪ Not Started(未开始) | 54(51 US/QA/Deploy + **3 T-FIX Review 修复**:T-FIX-04..06 P1)|
| 🔴 Blocked(阻塞中) | 0 |
| **合计** | **67** |

### 1.2 按故事 Rollup

| 故事 | 任务总数 | 已完成 | 状态 |
|---|---|---|---|
| SETUP(项目骨架) | 10 | 9/10(T-SETUP-9 ✅ — Sprint 1 SETUP 收尾;仅 T-SETUP-8 🟡 build ID `0246b4cd...` 在 cloud 队列等下完)| 🟡 |
| **FIX(Review 修复)** | **6** | **3/6(T-FIX-01/02/03 ✅ + T-FIX-04..06 P1)** | **🟡 — Sprint 2 第一波必清(3 P0 全收尾)** |
| US-013 匿名设备身份 | 2 | 1/2(**T-US013-1 ✅** AuthService + SecureStore 持久化层;仅 T-US013-2 splash guard 待做) | 🟡 |
| US-012 创建/加入家庭 | 3 | 0/3 | ⚪ |
| US-001 创建任务 | 2 | 0/2 | ⚪ |
| US-002 查看任务列表 | 3 | 0/3 | ⚪ |
| US-003 编辑/删除任务 | 2 | 0/2 | ⚪ |
| US-004 设置周期任务 | 2 | 0/2 | ⚪ |
| US-005 一键打卡 | 4 | 0/4 | ⚪ |
| US-006 漏打卡补救 | 2 | 0/2 | ⚪ |
| US-014 过期任务标记 | 2 | 0/2 | ⚪ |
| US-015 启动过期任务 banner | 3 | 0/3 | ⚪ |
| US-007 到点精确推送 | 3 | 0/3 | ⚪ |
| US-008 早/晚汇总 | 3 | 0/3 | ⚪ |
| US-009 添加共同执行人 | 2 | 0/2 | ⚪ |
| US-010 共享任务仅查看 | 2 | 0/2 | ⚪ |
| US-011 家庭公开看板 | 2 | 0/2 | ⚪ |
| US-016 后台推送优化引导 | 4 | 0/4 | ⚪ |
| US-017 集中设置页面 | 6 | 0/6 | ⚪ |
| QA(测试) | 2 | 0/2 | ⚪ |
| 部署 | 2 | 0/2 | ⚪ |

### 1.3 按 Assignee 统计

| Assignee | 任务数 |
|---|---|
| `frontend-dev` | 52 |
| `backend-dev` | 4(主要是 Supabase 部署 + RPC 验证) |
| `tech-lead` | 1(T-SETUP-1.1 元清理,把 3 个 fix 合并进 db-v1.1) |
| `qa` | 4 |

> 主体是 FE 工作 — 后端 schema (`db-v1.1.sql`) 和 API 契约 (`api-v1.0.yaml`) 已由 tech-lead 在本设计阶段完成,dev 阶段 BE 工作主要是部署到 Supabase + 单元验证。T-SETUP-1.1 是部署后由 backend-dev 触发、tech-lead 完成的元清理任务。

---

## §2 Sprint 排期计划

按 PRD §8 交接清单 #5 的建议:**第一个 Sprint 先打通"US-013 匿名身份 + US-012 家庭配对"端到端最小链路**。

| Sprint | 周次 | 范围 | 关键里程碑 |
|---|---|---|---|
| **S1** | W1 | SETUP(1-9) + US-013 + US-012 | **端到端最小链路**:两台设备能配对成同一家庭 |
| **S2** | W2 | US-001 + US-002 + US-003 + US-004 | 任务 CRUD + 周期 + 续期 |
| **S3** | W3 | US-005 + US-006 + US-007 + US-008 | 打卡 + 推送 + 早/晚汇总 |
| **S4** | W4 | US-009 + US-010 + US-011 + US-014 + US-015 | 共享 + 过期 |
| **S5** | W5 | US-016 + US-017 + QA + 部署 | 白名单引导 + 设置页 + APK 出包 |

> 5 周是乐观估计;若 BE 部署 / EAS Build 出问题可顺延 1 周。

### 关键依赖路径

```
T-SETUP-1 (Supabase 部署 db)
   ↓
T-SETUP-4 (Supabase client + AuthContext)
   ↓
T-US013-1 (signInAnonymously + SecureStore)
   ↓
T-US012-1 (createFamily + UI)
   ├→ T-US012-2 (createInvite + UI)
   └→ T-US012-3 (acceptInvite + UI)
   ↓
T-US001-1 (TaskService + 创建任务 UI)
   ↓
T-US002-1 (任务列表)  T-US004-1 (周期 + 续期)
   ↓
T-US005-1 (打卡 button + RPC)
   ↓
T-US007-1 (本地通知排程)
```

---

## §3 跨切任务(项目骨架 + 基础设施)

> 这些任务不属于任何单一 US,但被所有故事依赖。先做。

### T-SETUP-1: Supabase Project 1 部署 db-v1.0.sql
- **Type**: BE
- **Module**: Supabase 控制台 SQL Editor / Supabase CLI
- **Depends on**: —
- **Effort**: S
- **Risk**: Med(若 RLS 写错,family 数据可能串)
- **Priority**: P0
- **Assignee**: backend-dev
- **Status**: ✅ Done(2026-09-11)
- **Definition of Done**:
  - 全部 6 表 + 6 RPC + 9 索引 + 1 视图 + RLS 在 Supabase Project 1 中执行成功
  - `select * from public.families` 在 anon role 下能正常查(因为 RLS 全部 deny default → 0 行)
  - `select * from public.tasks` 在 authenticated role + auth.uid() 注入后能正常查
  - 4 张表已加入 `supabase_realtime` publication
- **完成方式**:
  - 路径:Supabase CLI 登录(link 成功 + `db execute --file` 直连 fallback)
  - 实际:用 `node-postgres` 直连 Supabase Postgres(port 5432,`pg@8.13.1` 装在 `scripts/node_modules/`,gitignored)运行 migration + verify,因为 CLI 报 access token 403(supabase 端 scope 不足)
  - 静态 10/10 + 动态 9/9 共 19/19 验证通过
- **⚠️ 重大偏离(生产阻塞 bug 修复,已完成整合到 db-v1.1.sql — 见 T-SETUP-1.1)**:
  1. **`supabase/migrations/20250911010000_fix_rls_recursion.sql`** — db-v1.0.sql 所有 RLS policy 内嵌 `SELECT FROM public.family_members` 子查询,触发 family_members 自身 RLS 无限递归(已用 `infinite recursion detected in policy` 验证)。修复:新增 `public.my_family_ids()` SECURITY DEFINER 函数,13 个 RLS policy 改用此函数。
  2. **`supabase/migrations/20250911020000_fix_checkin_id_ambiguity.sql`** — `checkin_task` 函数体内 `WHERE id = p_task_id` / `SET completed_at = ...` 与 RETURNS TABLE 同名,在 PL/pgSQL 解析时报歧义,函数能 CREATE 但首次 CALL 必崩。修复:`UPDATE public.tasks AS t` 表别名,所有 tasks 列加 `t.` 前缀。
  3. **`supabase/migrations/20250911030000_fix_undo_checkin_id_ambiguity.sql`** — 同上,`undo_checkin` 有同样 bug,verify 没主动调所以未暴露,主动修。
  - **共 3 个 fix migration + 1 个 init migration 已部署到 Supabase Project 1**。init migration 与 db-v1.0.sql 字节级一致(SHA256 `BD0020C8AE10AFDB3EEFF3F4274BCFFB376893BF3D4CE0E55684071738AF5378`)。
  - ✅ **已完成整合** → 见 **T-SETUP-1.1**:db-v1.1.sql 发布,3 个 fix inline 整合;arch-v1.0.md §10 RLS 编写规则 + §11 后续修复同步;fix migration 文件保留为部署历史。
- **实测数据库对象**:
  - 6 业务表:families / family_members / task_templates / tasks / invite_codes / family_settings
  - 10 函数(DoD 写 6):create_family / create_invite / accept_invite / update_family_setting / checkin_task / undo_checkin / + is_makeup_allowed (helper) / + enforce_family_member_cap (trigger fn) / + set_updated_at (trigger fn) / + my_family_ids (RLS fix)
  - 11 索引(DoD 写 9):10 普通 idx_ + 1 unique uq_tasks_template_date
  - 13 RLS policy(families 1 + family_members 1 + task_templates 4 + tasks 4 + invite_codes 2 + family_settings 1)
  - 1 视图:family_shared_tasks
  - 4 张表已加入 supabase_realtime publication
- **交付文件**:
  - `supabase/migrations/20250911000000_init.sql`(init,21.7KB,与 db-v1.0.sql 一致)
  - `supabase/migrations/20250911010000_fix_rls_recursion.sql`
  - `supabase/migrations/20250911020000_fix_checkin_id_ambiguity.sql`
  - `supabase/migrations/20250911030000_fix_undo_checkin_id_ambiguity.sql`
  - `supabase/verify.sql`(静态 10 check)
  - `supabase/verify_rls_and_rpc.sql`(动态 RLS+RPC 测试模板,因 pg client 限制改用 cjs 脚本)
  - `scripts/migrate-and-verify.cjs`(直连部署+验证一体化,可重放)
  - `scripts/verify-rls-rpc.cjs`(动态 RLS+RPC 测试,可重放)
  - `scripts/diagnose-grants.cjs` / `diagnose-checkin.cjs`(诊断工具)
  - `scripts/apply-fix.cjs`(跑单个 fix migration 的小工具)
  - `scripts/{deploy,push}.ps1`(CLI 路径脚本,实际未走通,留作 fallback 模板)
  - `.env` / `.env.example` / `.gitignore`
  - `scripts/node_modules/pg/`(gitignored,pg@8.13.1 直连驱动)

### T-SETUP-1.1: 合并 3 个 fix migration 进 db-v1.1.sql
- **Type**: BE(meta-cleanup)
- **Story**: SETUP
- **Module**: `document/tech-decision/db-v1.1.sql` + `arch-v1.0.md` §10/§11
- **Depends on**: T-SETUP-1(触发:发现 3 个生产阻塞 bug)
- **Effort**: S
- **Risk**: Med(若 SQL 改错,下一次 fresh deploy 会再次失败)
- **Priority**: P0
- **Assignee**: tech-lead
- **Status**: ✅ Done(2026-09-11)
- **Definition of Done**:
  - `db-v1.1.sql` 创建,inline 整合 3 个 fix(非尾部追加)
  - `public.my_family_ids()` SECURITY DEFINER 函数定义在 §2 工具函数区
  - 13 个 RLS policy 全部改用 `family_id IN (SELECT public.my_family_ids())`
  - `checkin_task` / `undo_checkin` 用 `UPDATE public.tasks AS t` + `t.` 前缀消除 PL/pgSQL 歧义
  - CREATE TRIGGER 用 `DO $$ ... pg_trigger 检查 ... $$` 包裹以保证 idempotent
  - 头注释版本 v1.0→v1.1,日期更新,ChangeLog 三行
  - 结构平衡(括号、$$ markers、CREATE POLICY 数 13、UPDATE public.tasks AS t 数 2)通过校验
  - `arch-v1.0.md` 新增 §10 RLS 编写规则 + §11 后续修复
- **完成方式**:
  - 阅读 v1.0 + 3 个 fix migration,识别需要改的块(头注释、§2 工具函数、§4.5/4.6 函数体、§5 全部 RLS policy、§3/§6 trigger 幂等性)
  - 写完整 v1.1.sql,~25KB(比 v1.0 多 ~3KB,主要是新函数 + 规则注释)
  - 通过 node 静态校验:13 RLS policy、13 处 `my_family_ids()` 调用、2 处 `UPDATE ... AS t`、括号与 `$$` 平衡 ✓
  - 本地未跑 live verify(无可用 psql,生产 Supabase 已带 3 个 fix migration 不应 drop 重新 deploy);如需严格验证可手跑 `node scripts/migrate-and-verify.cjs` 替换 init.sql 为 v1.1.sql 后 drop+recreate,但风险大
- **已知限制**:
  - 未做 fresh-deploy live test(生产 DB 不可 drop)
  - 静态结构校验仅覆盖 DDL 结构,未覆盖 RPC 行为(后续 T-QA-2 E2E 用例应实际调 checkin_task / undo_checkin)
- **关联文档**:
  - `db-v1.1.sql`(新 source-of-truth)
  - `arch-v1.0.md` §10 / §11(规则 + 修复记录)
  - 3 个 fix migration 文件保留在 `supabase/migrations/`,不删除(部署历史)

### T-SETUP-2: Expo SDK 52 项目初始化
- **Type**: FE
- **Module**: `app/fam-schedule/package.json` / `app/fam-schedule/app.json` / `app/fam-schedule/app.config.ts` / `app/fam-schedule/eas.json` / `app/fam-schedule/app/index.tsx` / 根 `.gitignore`
- **Depends on**: —
- **Effort**: S
- **Risk**: Low
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ✅ Done(2026-09-11)
- **Definition of Done**:
  - `npx create-expo-app fam-schedule --template blank-typescript`
  - SDK 安装成功(实际装到 **SDK 57**,模板 `@latest` 当前 default,理由见完成方式)
  - `app.json` 包含 android.packageName = `com.famschedule.app` ✅(通过 `app.config.ts` 配,`app.json` 留 stub)
  - `app.json` 包含 version = `1.0.0` ✅
  - `app.json` 包含 expo-notifications plugin 配置 ✅
  - `eas.json` 创建,包含 preview profile ✅(同时含 production profile)
- **完成方式**:
  - 路径:`C:/Users/admin/Documents/minimax_projects/FamSchedule/app/fam-schedule/`(DoD 指定子目录)
  - 模板:`blank-typescript`(SDK 57 / RN 0.86.3 / React 19.2.3 / TypeScript 6.0.3)
  - 双文件配置:`app.json` 写最小桩 `{ "expo": {} }`,`app.config.ts` 主导(用 `ConfigContext.config` spread 合并,既满足 Expo "使用 app.json values" 检查又保留 TS 类型安全)
  - `.env` 策略:后端用根 `.env`,Expo 客户端用 `app/fam-schedule/.env`(Expo 只在 projectRoot 读 env,不上溯);`EXPO_PUBLIC_*` 在 Metro 阶段被 inline 到 `process.env`
  - 依赖装入:`npx expo install` + `--legacy-peer-deps`(SDK 57 模板 React 19.2.3 与 react-dom 19.3.0 peer 冲突,需 legacy 绕过)
  - 装的包:expo-router / expo-secure-store / expo-notifications / expo-constants / expo-linking / expo-device / expo-build-properties / expo-splash-screen / @react-native-async-storage/async-storage / react-native-safe-area-context / react-native-reanimated / react-native-svg / react-native-screens / react-native-gesture-handler / @react-native-community/netinfo / @supabase/supabase-js@2.116 / @tamagui/{core,config,static}@2.7.7 / tamagui@2.7.7 / phosphor-react-native@3.0.6 / react-native-worklets(reanimated peer)
  - smoke test:写 `app/index.tsx` Expo Router 根路由 + `package.json` main 改 `expo-router/entry`,验证 `npx tsc --noEmit` 干净 + `npx expo-doctor` 21/21 通过
  - prebuild:`npx expo prebuild --platform android --no-install` 成功,`android/` 目录生成,`applicationId` = `com.famschedule.app`,`AndroidManifest.xml` 含 POST_NOTIFICATIONS / SCHEDULE_EXACT_ALARM / USE_EXACT_ALARM / RECEIVE_BOOT_COMPLETED
  - 决策记录:`app/fam-schedule/SETUP-NOTES.md`(8 节,涵盖 SDK 偏差原因、双文件模式、.env 策略、依赖装入说明、prebuild 状态)
- **⚠️ 偏差(已文档化)**:
  1. **SDK 版本** — 实际装到 SDK 57,不是规划中的 SDK 52。理由:`create-expo-app@latest` 当前 default 是 57,所有 PRD 列出的 Expo 模块在 57 中存在且 API 兼容 52,无需主动降版本。回退路径在 SETUP-NOTES §1。
  2. **Phosphor 包名** — design-v1.0.md 写 `@phosphor-icons/react-native`,npm 上实际只有 `phosphor-react-native`(3.0.6,作者 duongdev)。功能一致(1512 icons, 6 weights),用正确包名。
  3. **Tamagui 主题 + 字体 + 路由导航具体配置** — 留给 T-SETUP-3 装;本任务只装包 + 验证 prebuild 跑通。
- **后续任务前置条件**:
  - T-SETUP-3 接着装 @tamagui/theme / babel plugin / 思源黑体 ttf / Phosphor icons theme
  - T-SETUP-4 接着建 `src/lib/supabase.ts` + `src/contexts/AuthContext.tsx`
  - T-SETUP-9 接着把 `app/index.tsx` 换成 Tab 导航骨架

### T-SETUP-3: 安装核心依赖
- **Type**: FE
- **Module**: `package.json`
- **Depends on**: T-SETUP-2
- **Effort**: S
- **Risk**: Low
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ✅ Done(2026-09-11,frontend-dev + Mavis 协作)
- **Definition of Done**:
  - `@supabase/supabase-js` 安装 ✅
  - `expo-secure-store` 安装 ✅
  - `expo-notifications` 安装 ✅
  - `@react-native-async-storage/async-storage` 安装 ✅
  - `@react-navigation/native` + `@react-navigation/native-stack` + `@react-navigation/bottom-tabs` 安装 ✅
  - `expo-status-bar` 安装 ✅
  - 依赖锁文件 commit ✅
  - Tamagui 主题 + token + light/dark theme 写好(`src/theme/tamagui.config.ts` 7KB)✅
  - Babel 编译优化配置(`@tamagui/babel-plugin` + worklets)✅
  - 思源黑体 3 字重下载并配置(`assets/fonts/NotoSansSC-{Regular,Medium,Semibold}.ttf`,各 ~10.5MB)✅
  - Phosphor icons theme 集成(`phosphor-react-native@3.0.6`)✅
  - Expo Router 根 layout + TamaguiProvider(`app/_layout.tsx` 2.2KB)✅
  - 字体 .ttf 模块声明(`global.d.ts`)✅
- **已知遗留(非阻塞,后续重写)**:
  - `app/index.tsx` showcase 页有 11 个 TS 错误(Tamagui 2.x API:`space`→`gap`、`SafeAreaView` 改从 `react-native-safe-area-context` 导入、`elevate` 移除)。这是 Tamagui 1.x 风格代码,Tamagui 2.7 不支持。showcase 仅作 smoke test,会在 T-SETUP-9 实际 Tab 导航时用 2.x 正确 API 重写
  - 字体单字重 ~10.5MB(完整字符集),无 subset 化。APK 体积影响 ~30MB。可考虑 T-SETUP-8 出包前用 `subset-font` 或 `fonttools` 做中文字符子集化
- **关键文件**:
  - `app/fam-schedule/src/theme/tamagui.config.ts` — 主设计系统 token(色 / 间距 / 圆角 / 字号 / 暗色)
  - `app/fam-schedule/babel.config.js` — Tamagui babel plugin + worklets
  - `app/fam-schedule/app/_layout.tsx` — Expo Router 根 layout(TamaguiProvider + 字体加载)
  - `app/fam-schedule/app.config.ts` — expo-font plugin 预打包字体
  - `app/fam-schedule/global.d.ts` — 含 .ttf 模块声明

### T-SETUP-4: Supabase 客户端 + AuthContext
- **Type**: FE
- **Module**: `src/lib/supabase.ts` / `src/contexts/AuthContext.tsx`
- **Depends on**: T-SETUP-1, T-SETUP-3
- **Effort**: M
- **Risk**: Med(token 持久化错误会让所有后续调用失败)
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ✅ Done(2026-09-15)
- **Definition of Done**:
  - `supabase.ts` 创建单例 client,使用 `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` 环境变量
  - `AuthContext` 暴露 `{ user, session, isLoading, signInAnonymously, signOut }`
  - 启动时自动从 SecureStore 恢复 session
  - session 失效(token refresh 失败)时自动重新 signInAnonymously
- **实际产出**(2026-09-15):
  - `src/types/database.ts`(8KB)— 手写 DB schema 类型(6 表 + 1 视图 + 6 RPC + Insert/Update 派生类型 + `RecurrenceRule` discriminated union)
  - `src/lib/supabase.ts`(3.9KB)— singleton `createClient<Database>` + `ExpoSecureStoreAdapter` 把 `getItem/setItem/removeItem` 桥到 `expo-secure-store` 的 async API + env 早失败断言
  - `src/contexts/AuthContext.tsx`(8KB)— `AuthProvider` + `useAuth` hook;2 个 effect 协同(初始化 + 自动重连);`useRef` 标记"用户主动 signOut"防止自动重连 effect 抢登
  - `app/_layout.tsx` — 包 `<AuthProvider>` + 抽出 `Gate` 组件,`isLoading=true` 时渲染 splash (ActivityIndicator + `$background`),`false` 时渲染 `<Stack />`
  - `app/index.tsx` — 末尾追加 Auth 调试区,显 user.id / session.expires_at + Sign out / 手动 signInAnonymously 按钮(故意不用 `space`/`XStack` 以避免新增 Tamagui 1.x API 错误)
  - `tsc --noEmit`:0 新增 error(原 14 个 carry-over 不变:11 个 `app/index.tsx` + 1 个 `app/_layout.tsx`(tamagui config 类型 carry)+ 2 个 `src/theme/tamagui.config.ts`)
  - `expo-doctor`:21/21 通过
- **关键决策**:
  1. **手写 `Database` 类型而非 `supabase gen types typescript` CLI** — 理由:`db-v1.1.sql` 是单一权威源,SHA256 已校验;CLI 需要 login + link + docker,自动化流程里多一层凭证管理。手写与 SQL 1:1 对齐,任何 schema 漂移只可能从 SQL 文件产生
  2. **`detectSessionInUrl: false` + `flowType: 'implicit'`** — RN 环境无关 URL hash,PKCE flow 需要浏览器回调,均关闭
  3. **手动 signOut 不触发自动重连** — 用 `intentionalSignOutRef` 标记本次登出是用户意图,自动重连 effect 看到标记就跳过。否则用户根本登不出去(永远被自动重连救活)
  4. **`<Gate>` 独立组件** — `useAuth` 必须在 `AuthProvider` 子树里调,所以渲染分支拆出独立组件;否则要么 hook rule 报错,要么 splash 节点不能响应 isLoading 变化
  5. **Auth debug 区不用 `space` / `XStack`** — 避免给 `app/index.tsx` 已知的 11 个 Tamagui 1.x API 错误再添乱;改用 `marginTop` + `<View>` 包按钮

### T-SETUP-5: LocalStore 模块(AsyncStorage 封装)
- **Type**: FE
- **Module**: `src/lib/LocalStore.ts`
- **Depends on**: T-SETUP-3
- **Effort**: M
- **Risk**: Low
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ✅ Done(2026-09-15)
- **Definition of Done**:
  - 封装 `cache:tasks` / `cache:templates` / `cache:settings` / `queue:pending_mutations` / `meta:last_sync_at` 等 key ✅
  - 提供 typed get/set 方法(`getTasks(): Promise<Task[]>` 等 8 个) ✅
  - 提供 enqueueMutation(mutation) / drainQueue() / clearQueue() / getQueueLength() 方法 ✅
  - 单元测试覆盖:enqueue 后 drain 能按 FIFO 返回;drain 后 queue 清空;clearQueue 清空不返回;getQueueLength 反映计数 ✅
- **实际产出**:
  - `src/lib/LocalStore.ts`(6.7KB,5 reserved keys + 8 typed get/set + 4 queue ops + 1 debug helper)
  - `__tests__/LocalStore.test.ts`(3.8KB,6 个测试 — DoD 要求 5 个 + 1 个 `_clearAllForTests` sanity check)
  - jest 测试栈首次配通(jest@29.7 + jest-expo@57.0.5 + babel-preset-expo@57.0.11 + @react-native/jest-preset@0.86.3 + react-dom@19.2.3 + ts-jest@29.4)
  - `jest.setup.js`(AsyncStorage native module mock)
  - `package.json` 加 jest config 块 + `test` / `test:watch` 脚本
  - `tsconfig.json` 加 `"types": ["jest", "node"]`(让测试文件用 jest globals)
- **踩坑记录**:
  1. `jest-expo@57` 不自带 `babel-preset-expo` — 需单独装
  2. `@react-native/jest-preset` 是 `jest-expo` 的 peer dep — React Native 0.86 把 jest preset 拆出
  3. `babel.config.js` 用 `jsxImportSource: 'tamagui'`,RN runtime 调 `require('tamagui/jsx-runtime')` — 需 jest `moduleNameMapper` 指向 `react/jsx-runtime`
  4. AsyncStorage native module 在 jest 环境为 null — 需 `jest.mock` 走官方 `async-storage-mock`
- **业务设计决策**:
  - `getLastSyncAt(): Promise<number | null>` 用 unix ms(任务 DoD 明确);ADR-005 §pullSince 写 ISO string 是 SyncManager 端适配,存储层用 number 方便 `gt('updated_at', lastSyncAtMs)`
  - `PendingMutation` 用 discriminated union 业务层抽象(checkin / undo_checkin / create_task / update_task / delete_task);SyncManager(T-SETUP-6)会展开为 ADR-005 低层 `{ id, ts, table, op, rowId, payload? }` 形态再调 supabase
  - queue 去重靠 `(kind, taskId)` 二元组在 SyncManager 端做;LocalStore 只负责 FIFO 序
  - `enqueueMutation` 与 `drainQueue` 都是 read-modify-write,非 atomic;MVP 阶段调用方同线程(UI 主线程/SyncManager)无并发,后续真并发需加 mutex
- **测试结果**:`npx jest __tests__/LocalStore.test.ts` → 6 passed / 0 failed / 0 skipped / 4.5s
- **类型检查**:`npx tsc --noEmit` → 14 errors(全部 carry-over:11 index.tsx + 1 _layout.tsx + 2 tamagui.config.ts),**0 新增**
- **未做**(后续 T-SETUP-9 重写 index.tsx 时连带清理):carry-over 14 个 Tamagui 1.x API 错误
- **下游依赖解锁**:T-SETUP-6(SyncManager)现在可开工,会消费 `enqueueMutation` / `drainQueue` 接口

### T-SETUP-6: SyncManager 模块
- **Type**: FE
- **Module**: `src/lib/SyncManager.ts`
- **Depends on**: T-SETUP-4, T-SETUP-5
- **Effort**: L
- **Risk**: Med(订阅泄漏 / 队列不幂等会引发数据异常)
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ✅ Done(2026-09-15)
- **Definition of Done**:
  - `subscribeFamily(familyId)` 订阅 4 张表的 Realtime channel
  - `enqueueAndApply(mutation)` 本地立即更新 cache,入队,等网络恢复 replay
  - `replayQueue()` 按 FIFO 调用 supabase,失败记 warn
  - `pullSince(lastSyncAt)` 从 server 拉增量
  - 监听 `NetInfo` 网络恢复事件,自动 replayQueue + pullSince
  - 提供 `unsubscribeAll()` 用于 app 进入后台时释放
- **测试结果**:`npx jest __tests__/SyncManager.test.ts` → 8 passed / 0 failed / 0 skipped / 3.4s(全部 6 项 DoD 对应用例 + 幂等 + 类型 sanity)
- **类型检查**:`npx tsc --noEmit` → 0 新增 error(仍 14 carry-over 在 Tamagui 1.x API 文件上,out of scope)
- **下游解锁**:T-SETUP-7(NotificationScheduler)可开工,可消费 `_resetForTests` 做测试隔离;真正的 UI 集成留待 T-SETUP-9(Navigation)装 useSyncManager 到 root 屏
- **故意不做**(后续 T-SETUP-9 / T-US012 整合):`app/_layout.tsx` 不挂 `useSyncManager`(`family_id` 在 AuthContext 之外需要从 `family_members` 表查,属于 US-012 范畴;避免提前触发 Tamagui 1.x API 错误)

### T-SETUP-7: NotificationScheduler 模块
- **Type**: FE
- **Module**: `src/lib/NotificationScheduler.ts`
- **Depends on**: T-SETUP-3
- **Effort**: M
- **Risk**: High(本地通知不响是国内 Android 重灾区)
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ✅ Done(2026-09-15)
- **Definition of Done**:
  - `init()` 调 `Notifications.requestPermissionsAsync()` + `setNotificationHandler` ✅
  - `scheduleTaskReminder(task)` 排程 task_time 时刻的 local notification ✅
  - `scheduleDigest(morningTime, eveningTime)` 排程每天 08:00 / 20:00 通知 ✅
  - `cancelByTaskId(taskId)` 取消某任务所有通知 ✅
  - `rescheduleAll(tasks, settings)` 重排全部 ✅
  - 通知点击回调,解析 data.taskId,跳到任务详情 ✅
  - 集成 `@notifee/react-native` 或 `expo-notifications`(优先 expo-notifications,统一栈)✅(仅用 expo-notifications;未引入 @notifee)
- **完成方式**:
  - 路径:`app/fam-schedule/src/lib/NotificationScheduler.ts`(14.3KB / ~330 行)+ `app/fam-schedule/__tests__/NotificationScheduler.test.ts`(14.6KB / 16 个测试)+ `app/fam-schedule/app/_layout.tsx` Gate 内加 `useNotificationSchedulerInit()`
  - **ID 编码**:`task-reminder:<task_uuid>` 前缀,让 `cancelByTaskId` / `rescheduleAll` 容易过滤;digest 用固定 ID(`digest-morning` / `digest-evening`)
  - **Android channel**:`task-reminders` (HIGH,赤陶 lightColor #DC5A24)+ `digest` (DEFAULT),与 design-v1.0 DD-002 色板对齐
  - **Tap 回调**:`setNotificationTapHandler(handler)` UI 层注册,init 内 listener 从 `data.taskId` 抽出(task reminder 有 / digest 走 null)+ cold-start 走 `getLastNotificationResponseAsync` 兜底
  - **Hook wiring**:`useNotificationSchedulerInit()` 加在 `Gate`(AuthProvider 已就绪 + 不影响字体/splash 同步路径),失败仅 warn 不阻塞
  - **契约文档**:已完成的任务不会自动 cancel 已存在 reminder(scheduleNotificationAsync 同 ID 替换语义在早返回时不会触发),需调用方(checkin 流程)显式 `cancelByTaskId(taskId)`
- **HIGH RISK 注释**(已写入模块顶部):
  1. Android 12+ Exact Alarm 权限(`SCHEDULE_EXACT_ALARM` 已在 manifest)— 用户需手动在系统设置开启,拒绝时 OS 静默变 inexact
  2. Android 13+ POST_NOTIFICATIONS — `init()` 调 `requestPermissionsAsync` 申请
  3. Doze / Battery Optimization — 已排程通知可能延迟 15+ 分钟
  4. 国产 ROM(Xiaomi/Huawei/Oppo/Vivo/OnePlus)后台管控 — US-016 白名单引导缓解
  5. 用户"强制停止"清空 AlarmManager — 依赖 `rescheduleAll()` 每次冷启动重排兜底
- **测试结果**:`npx jest __tests__/NotificationScheduler.test.ts` → 16 passed / 0 failed / 0 skipped / 2.4s(覆盖 DoD 7 项 + 边界 9 项);`npx jest` 全套 30 passed(LocalStore 6 + SyncManager 8 + NotificationScheduler 16)
- **类型检查**:`npx tsc --noEmit` → 0 新增 error(仍 14 carry-over 在 Tamagui 1.x API 文件上,out of scope)
- **故意不做**(后续 US-007/US-008 接入):
  - 不主动调 `rescheduleAll()`(依赖 US-002 任务列表加载时由 SyncManager 调用方触发,避免循环依赖)
  - 不实现"提前 X 分钟提醒"等扩展 reminder(当前每任务最多 1 条 reminder,`cancelByTaskId` 名字预埋扩展空间)
  - UI 层点击跳转(`router.push('/task-detail')`)留待 T-US002-2 / T-US003-1 实现,本模块只负责把 `taskId` 传给已注册的 handler

### T-SETUP-8: EAS Build 配置
- **Type**: FE
- **Module**: `eas.json`
- **Depends on**: T-SETUP-2
- **Effort**: S
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: 🟡 In Progress (build 已在 cloud 队列,Build ID `0246b4cd-ab67-4957-a7e0-2ab969ddab25`,等用户下载)
- **Definition of Done**:
  - preview profile 配置:Android APK(非 AAB),`distribution: "internal"`,`simulator: false` ✅(注:`simulator` 是 iOS-only 字段,删除;Android 用 `buildType: "apk"` 区分真机/模拟器)
  - production profile 占位 ✅(resourceClass=large,distribute=internal)
  - 提交一次 `eas build -p android --profile preview` 成功,产出 APK 下载链接 🟡(build ID `0246b4cd-ab67-4957-a7e0-2ab969ddab25` 已在 cloud 队列,EAS 后台排队;用户须自查 https://expo.dev/accounts/zzzshark/projects/fam-schedule/builds 看结果)
- **关键产出**:
  - `eas.json`:preview(production)双 profile,both `buildType=apk`;preview 加 `env` 块嵌 `EXPO_PUBLIC_*` 让 EAS cloud build 能拿到
  - `app.config.ts` 加 `extra.eas.projectId = 'c708a76a-dfe4-407d-bde5-b11c66efc882'`,绕开 `eas init` 在双文件模式下的崩溃 bug(已知 issue #3018)
  - 路径选择:Cloud(Local 不可行,机器无 java/Android SDK)
- **踩坑**:
  - `eas init` CLI 在双文件(app.json stub + app.config.ts)配置下崩溃 → 走 GraphQL 查 project ID 绕过
  - `simulator` 字段是 iOS-only,Android 报"unknown field" → 删
  - 跟 T-SETUP-1 类似的 token 担忧:Expo 账号已确认登录(`zzzshark`,Owner),build 队列已收,目前 OK

### T-SETUP-9: App 导航骨架
- **Type**: FE
- **Module**: `src/navigation/RootNavigator.tsx`(实际:Expo Router 文件式路由)
- **Depends on**: T-SETUP-4
- **Effort**: M
- **Risk**: Low
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ✅ Done(2026-09-17,frontend-dev)— **Sprint 1 SETUP 完成(10/10)**
- **Definition of Done**:
  - Tab 导航:首页(任务列表) / 家庭 / 设置 ✅
  - Stack 导航:任务详情 / 创建任务 / 邀请码展示 / 输入邀请码 / 设置详情 ✅
  - auth guard:未登录时显示 splash,登录后切到主 Tab ✅
  - 未配对家庭时,显示"创建或加入家庭"占位页 ✅
- **实际产出(2026-09-17)**:
  - `app/index.tsx` — 改成 `<Redirect href="/(main)/(home)" />`,彻底清除 T-SETUP-3 留下的 14 个 Tamagui 1.x API 错误(原 Theme showcase 页)
  - `app/(main)/_layout.tsx` — Tabs(任务 ListChecks / 家庭 House / 设置 GearSix),赤陶 `#DC5A24` active + `surface` 背景 tabBar
  - `app/(main)/(home)/_layout.tsx` + `index.tsx` + `task/[id].tsx` + `task-create.tsx` — Stack 子树,3 屏任务流;index 用真实家庭场景(喂奶粉 / 续交保险单 / 倒垃圾)占位
  - `app/(main)/(family)/_layout.tsx` + `index.tsx` + `invite-display.tsx` + `invite-input.tsx` — Stack 子树,家庭 dashboard + 邀请配偶入口(ghost avatar pattern,A 我 / B 配偶)
  - `app/(main)/(settings)/_layout.tsx` + `index.tsx` + `push.tsx` + `task-rules.tsx` + `whitelist.tsx` + `about.tsx` — Stack 子树,4 分区设置(推送 / 任务规则 / 白名单 / 关于);about 读 `Constants.expoConfig?.version` 显示版本
  - `app/(onboarding)/_layout.tsx` + `pair-create.tsx` + `pair-join.tsx` — Stack,US-012 onboarding 骨架;pair-create 调 `create_family` RPC + 自动 `router.replace('/(main)/(home)')`,pair-join 调 `accept_invite` + 同样 auto-replace
  - `app/_layout.tsx` Gate 升级:除 auth 检查,还查 `family_members` 表判断 `family_id` 是否有;没家庭 → `<Redirect href="/(onboarding)/pair-create" />`,有 → 渲染主 Stack;`usePathname()` 监听路由变化触发重新查询(创建家庭后自动放行)
  - `src/theme/tamagui.config.ts` — **修复 carry-over TS 错误**(deviation 记录于下面):把 `createTheme()` / `defaultConfig` 替换为 `getDefaultTamaguiConfig('native')` + 纯对象字面量 themes(Tamagui 2.x 标准写法);同时把 `onlyAllowShorthandStyleProps` 改为 `onlyShorthandStyleProps`(2.x 重命名)
- **偏差(deviation)记录**:
  1. **修复 `tamagui.config.ts` carry-over 错误** — 原代码用 `createTheme()`(在 Tamagui 2.x 已不导出)+ `defaultConfig`(在 `@tamagui/config` 2.x 已不导出)。这不仅是 TS 错误,**runtime 上 `createTheme` 是 undefined,App 启动会直接抛**(`undefined is not a function`),**因此必须修**。改用 `getDefaultTamaguiConfig('native')` 拿 base config(animations / shorthands / media / tokens)+ 覆盖 themes 为我们的色板。
  2. **`pair-create.tsx` 的 RPC 参数 `{ p_name }` 改为 `{}`** — `db-v1.1.sql` §4.1 的 `create_family()` 不接受任何参数(families 表无 name 列)。`as never` cast 绕过 supabase-js rpc() typed Database 的 literal-narrowing quirk(同 `src/lib/SyncManager.ts:425` 已用的 pattern)。
  3. **`pair-join.tsx` 的 RPC 参数 `{ p_invite_code }` 改为 `{ p_code }`** — `db-v1.1.sql` §4.3 命名是 `p_code`,不是 `p_invite_code`。
  4. **`(main)/_layout.tsx` TabBarIcon 的 `color={color}` 加 `as string` cast** — `tabBarIcon` 回调的 `color` 类型是 `ColorValue`(含 `OpaqueColorValue`),Phosphor 期望 `string | undefined`,需要 cast 绕过(运行时实际只是 hex / token)。
  5. **`_layout.tsx` Gate `<Redirect>` href 用 `/(onboarding)/pair-create`** — 最初 parent 用了 `/onboarding/pair-create`(没括号),Expo Router 4.x 的 `(group)` 在 navigation href 里**保留括号**,这是与文件路径匹配的写法。
- **决策**:
  1. **Expo Router 文件式路由**而不是单独 `src/navigation/RootNavigator.tsx` + react-navigation — Expo Router 是 Expo SDK 一等公民,与 `expo-router` + `expo-linking` + `expo-constants` 协同更紧密,且 v4 的 typed routes 带来编译期路径校验。架构文档写的是 "src/navigation/RootNavigator.tsx",实际实现选择 Expo Router(在 arch-v1.0 §9 已声明可行);后续 dev task 引用 `app/<route>` 时直接写文件路径
  2. **Stack + Tabs 双层嵌套** — `(main)/_layout.tsx` 是 Tabs(底部 3 tab),`(home)/(family)/(settings)/_layout.tsx` 各自是 Stack(每个 tab 内可 push 详情);`app/_layout.tsx` 是 Stack(整个 App 的根,装 Gate + 路由守卫)
  3. **family guard 用 `usePathname()` 监听触发重查** — 避免引入额外的 global state / event bus;pair-create/join 主动 `router.replace('/(main)/(home)')` 触发的 pathname 变化,Gate 的 effect 重新跑 family check 放行
- **测试结果**:
  - `npx tsc --noEmit`:0 errors(原 5 个 carry-over:11 个 `app/index.tsx` 1.x API 错误 + 1 个 `_layout.tsx` config 类型 + 2 个 `tamagui.config.ts` createTheme/defaultConfig + 2 个 RPC args,**全部清除**)
  - `npx jest --silent`:30 passed / 0 failed / 0 skipped(无回归)
  - `npx expo-doctor`:20/21 passed(1 fail 是 patch version drift:expo 57.0.22 vs expected 57.0.23 / expo-build-properties 57.0.17 vs 57.0.20 / expo-notifications 57.0.18 vs 57.0.19,与本任务无关)
- **关键产出文件清单**:
  - 路由:`app/index.tsx`(重写) + `app/_layout.tsx`(Gate 升级) + `app/(main)/_layout.tsx` + 6 个 stack layout + 11 个页面文件
  - 主题:`src/theme/tamagui.config.ts`(carry-over 错误清零)
- **下游解锁**:T-US001(任务列表)+ T-US002(任务详情)+ T-US003(创建/编辑任务)+ T-US012(创建/加入家庭,已有骨架可填)+ T-US014(过期 banner)+ T-US017(集中设置)现在都可以开始填业务 UI

---

## §3.5 Review 修复任务(T-FIX-XX)

> 来源:`code-reviewer` 对 SETUP 阶段(T-SETUP-2..9)的审查报告(verdict = NEEDS FIXES),2026-09-17。
> 评估基线:3 Major + 11 Minor + 6 Cross-stack → 落地为 6 个修复任务。
> 每项均已在 §1 §1.1 + §1.2 进度表中计入(在评审 patch 中增量)。
> **优先级 / 排期详见 §9 Recommended Execution Order (post-review)**。

### T-FIX-01: SyncManager.pullSince 部分失败仍推进 last_sync_at
- **Type**: FE(data correctness)
- **Story**: ADR-005 同步层守卫
- **Module**: `app/fam-schedule/src/lib/SyncManager.ts` §8 pullSince(行 475-528)
- **Depends on**: T-SETUP-6
- **Effort**: S
- **Risk**: Med(若不修,网络/服务端短暂 5xx 时 spouse 的 tasks 增量行将被永久跳过,直到 manual pull)
- **Priority**: 🔴 **P0**(Sprint 2 第一日必修)
- **Assignee**: `frontend-dev`
- **Status**: ✅ Done(2026-09-17)
- **Source issue**: Review Major #1
- **Definition of Done**:
  - `pullSince` 引入 `let failed = false`,在 `tasksErr` / `templatesErr` / `settingsErr` 任一非 null 时置 true(已有 `console.warn` 路径)
  - 函数末尾改 `if (!failed) await setLastSyncAt(Date.now());` —— 失败时保留旧 last_sync_at,下次调用自动重试缺失表
  - 单测新增 2 例:`pullSince` 模拟 tasks query reject → last_sync_at 不变;模拟全成功 → 推进。`__tests__/SyncManager.test.ts` 全 pass
  - `tsc --noEmit` 0 新增错误
  - `app/fam-schedule/src/lib/SyncManager.ts:526` 原注释保留并强化:"拉到任一表失败 → 不推进时间戳,下轮重试"

### T-FIX-02: EAS `projectId` 单一来源 + env 收敛
- **Type**: FE(config hygiene + secret-management)
- **Story**: SETUP 阶段遗留(部署可观测性)
- **Module**: `app/fam-schedule/app.json` / `app/fam-schedule/app.config.ts` / `app/fam-schedule/eas.json`
- **Depends on**: T-SETUP-2, T-SETUP-8
- **Effort**: S
- **Risk**: Med(若不修,后续 OTA / EAS Build 可能向 wrong project 推送,**不会** build fail 而是 silent miss)
- **Priority**: 🔴 **P0**
- **Assignee**: `frontend-dev`
- **Status**: ✅ Done(2026-09-17)
- **Source issue**: Review Major #2 + Cross #3 + Cross #4
- **Definition of Done**(2026-09-17 实施注记):
  - **已选策略**:**(B) `eas.json` env block 为 build-time 单一来源**。理由:anon key 是 `sb_publishable_` publishable(非 secret),Supabase 文档允许 inline 进前端 bundle;现有 `eas.json` env 值与 `app/fam-schedule/.env` 已逐项对齐,**零值修改**;未来若引入 server-side secret(例如 service_role key)再迁移到选项 (A) `eas env:create`。
  - `app.config.ts` 加顶部 JSDoc 注释块(约 30 行)锁定 single-source-of-truth 政策,禁止未来向 `app.json` 写 `extra.*`。
  - `app.json` 清成 `{ "expo": {} }`(16 字节),删掉 `extra.eas.projectId = e6c408cf-...`(stale)+ `extra.router.origin`(T-SETUP-9 已迁移到 `app.config.ts`)。
  - `eas.json` env block **未改值**;`npx expo config --type public` 确认 merged config 中 `c708a76a-...` × 1、`e6c408cf-...` × 0。
  - 单测无新增(`projectId` 不进 RN runtime);`tsc --noEmit` 0 error;**未**真提交 EAS build(按 task 约束,避免 10-20 min 队列占用)。
  - **范围外但发现的问题**(留作后续):`app/fam-schedule/.gitignore` 只忽略 `.env*.local` 不忽略 `.env`;`.env` 第 4 行注释谎称"已被排除"。当前 `.env` 内容仅为 publishable anon key,**不构成 secret 泄露风险**,但与代码注释矛盾,建议 T-FIX-06 hygiene batch 内追加一行 `.env`(去掉 `.local` 后缀) — 非 P0。
- **决策依据**:
  - `eas init` CLI 在 app.config.ts + app.json 双文件下报 #3018 known bug —— 必须手动注入 `extra.eas.projectId`,T-SETUP-8 已走通 GraphQL 旁路。**所以 source-of-truth 必须落在 app.config.ts**,否则下次 `eas init` 会再次覆盖回错误 ID

### T-FIX-03: NotificationScheduler `init()` 在 splash 阶段抢弹权限框
- **Type**: FE(UX guardrail)
- **Story**: ADR-006 推送触发模型 / DD-016
- **Module**: `app/fam-schedule/app/_layout.tsx` + `app/fam-schedule/src/lib/NotificationScheduler.ts`
- **Depends on**: T-SETUP-7, T-SETUP-9
- **Effort**: S
- **Risk**: Low-Med(iOS App Store 审核对此类时机敏感;Android 用户首启体感突兀)
- **Priority**: 🔴 **P0**(影响首启 UX,Sprint 2 第一波验收必检)
- **Assignee**: `frontend-dev`
- **Status**: ✅ Done(2026-09-17)
- **Source issue**: Review Major #3
- **Definition of Done**:
  - **修复路径(已选 Option B — 拆两阶段)**:`NotificationScheduler.ts` 拆出 `requestNotificationPermission()` 与 `init()` 并存:
    - `init()`:eager 阶段,装 handler / 配 Android channel / 注册 tap listener / 处理 cold-start。**不申请权限**。在 Gate `useEffect(() => init().catch(warn), [])` mount 即触发。
    - `requestNotificationPermission()`:gated 阶段,仅 `init()` 中 `requestPermissionsAsync` 的迁移出口,模块级 `permissionRequested` flag 守护幂等。在 Gate 第二个 `useEffect(() => { if (session && familyId) requestNotificationPermission().catch(warn) }, [session, familyId])` 双条件触发。
    - 移除旧版 `useNotificationSchedulerInit()` 在 Gate 内的无条件调用;hook 本身保留(文档化为"eager init wrapper")。
  - 模块状态:`initialized`(eager 幂等)+ `permissionRequested`(gated 幂等)两个独立 flag;`_resetForTests` 同时重置两者。
  - 旧 4 个 `init()` 测试拆为 4 + 4:`init (T-FIX-03 eager stage)` 4 用例 + `requestNotificationPermission (T-FIX-03 gated stage)` 4 用例(其中后者的 idempotent 测试**只**断 mockRequestPermissions 调用次数 = 1,不依赖 init)。
  - `tsc --noEmit` 0 新增 error;`jest --silent` 36/36 pass(原 32 + 4 新,其余原 28 个含 SyncManager / LocalStore 零回归)。
  - 手动验证场景(物理机):Android 清数据冷启动 → splash → onboarding(pair-create / pair-join)→ 用户提交 RPC → router.replace → familyId 落定 → **此刻**才弹权限框(iOS 同);与原 UX 相比,splash 阶段完全无权限弹窗。
- **决策依据**:
  - 当前 `useNotificationSchedulerInit()` 在 Gate 函数体内无条件调用(行 90),其 useEffect 内调 `init()` → `requestPermissionsAsync()`。Gate 在 `isLoading=true` 时已挂载(只是渲染 splash YStack),useEffect 在 commit 后立即跑 → 弹权限对话框早于用户看到 onboarding 的"创建/加入家庭"
  - **最干净的 fix 是 Gate 内 `&& familyId`**:既保留 hook wiring 集中,又自然与"用户进入主栈"联动
  - 但单纯加 `if (initTriggeredRef.current || !familyId) return;` 守 hook 会导致 **channel + handler + listener 也不装**,这违背"`init()` 是装系统,无副作用"的语义,且后续 `scheduleTaskReminder` / `scheduleDigest` 调用会因 listener 没注册而拿不到 tap 事件
  - 所以最终选 Option B:**两个独立函数 + 两个独立 effect**。语义清晰(eager vs gated)、测试独立(可单测 permission 路径无需依赖 init)、未来扩展容易(若要给"设置页 → 通知"加"重新申请"按钮,只需手动调 `requestNotificationPermission()`,当前是幂等的不会重弹)。

### T-FIX-04: SyncManager Realtime eventType 防御性分支 + family_settings DELETE
- **Type**: FE(data correctness)
- **Story**: ADR-005 Realtime 通道
- **Module**: `src/lib/SyncManager.ts` §2 `handleRealtimeChange`(行 198-214)+ §9 subscribeFamily `family_settings` handler(行 151-158)
- **Depends on**: T-SETUP-6
- **Effort**: S
- **Risk**: Med(low-frequency scenario,但 family_settings DELETE 是 settings 写路径的兜底 —— 写错会 silently clear 本地 settings)
- **Priority**: 🟡 **P1**
- **Assignee**: `frontend-dev`
- **Status**: ⚪ Not Started
- **Source issue**: Review Minor #5
- **Definition of Done**:
  - `handleRealtimeChange` 在 family_settings 分支加 `if (payload.eventType === 'DELETE') { await clearSettings(); return; }`,然后 INSERT/UPDATE 走 `setSettings(payload.new)`
  - `applyChangeToList` 的 DELETE 分支当前已正确(行 220-223),不需改
  - 单测新增:`handleRealtimeChange('family_settings', {eventType:'DELETE'})` → `getSettings()` 返回 null/default;`{eventType:'UPDATE', new:{...}}` → 写入
  - `tsc --noEmit` 0 新增错误
- **决策依据**:
  - `family_settings` 1 family 1 row(Row Level Security 强制 unique constraint)。当前 `payload.new` 直接 cast 给 setSettings,DELETE 事件 `payload.new = null` → `setSettings(null as FamilySettings)` → AsyncStorage 写入字符串 "null" → 下次 read 报 JSON parse error
  - 当前 MVP 没有 DELETE 路径(只走 UPSERT),所以**实测不触发**;但作为 defense-in-depth 应当补
  - 同类问题 `tasks` / `task_templates` 由 `applyChangeToList` 处理 DELETE 已 OK,**只 family_settings 这条单例路径有缺口**

### T-FIX-05: DD-005 bottom tab fidelity —— 图标权 + 修正图标 + 4px 圆点 indicator
- **Type**: FE(design fidelity)
- **Story**: SETUP-9 留尾(审 design-v1.0 §1.3 vs 实际 `(main)/_layout.tsx`)
- **Module**: `app/fam-schedule/app/(main)/_layout.tsx:43,52,61`
- **Depends on**: T-SETUP-9
- **Effort**: S
- **Risk**: Low(纯视觉,不影响业务)
- **Priority**: 🟡 **P1**(Sprint 2 第一批用户故事落地前完成,后续 UI 任务都依赖 tab 视觉)
- **Assignee**: `frontend-dev`
- **Status**: ⚪ Not Started
- **Source issue**: Review Minor #2
- **Definition of Done**:
  - 修正图标:
    - 任务:`ListChecks` ✓(原)
    - 家庭:`House` → `UsersThree`(DD-005 §1.3 spec,是"家庭成员"语义)
    - 设置:`GearSix` → `Gear`(DD-005 用 `Gear`,不是 `GearSix`)
  - active tab 时 `weight="fill"`,inactive 时 `weight="regular"`(Phosphor API 双权切换)
  - 顶部 4px 赤陶圆点 indicator:tabBar 顶部加 `height: 4` 的 `borderTopWidth: 4` + `borderTopColor: '$primary'`,只在 focused tab 对应位置显示(`tabBarBackground` + 条件渲染,或 `tabBarItemStyle.indicator` 自定义)—— 选最简方案:用 `tabBarBadge` 或 `tabBarBackground` 包一个具 named slot
  - `tsc --noEmit` 0 新增错误
- **决策依据**:
  - 当前 `(main)/_layout.tsx` 三处 `weight="regular"` 写死 —— 不论 active/inactive 同色
  - 4px dot 在 Phosphor 设计系统里对应 active state 的 visual confirmation,DD-005 §1.3 明文要求

### T-FIX-06: code-review 评审 Minor 杂项合并批
- **Type**: FE(hygiene batch)
- **Story**: SETUP-9 polish
- **Module**: 多文件
- **Depends on**: T-SETUP-9(主)
- **Effort**: S
- **Risk**: Low
- **Priority**: 🟢 **P1**(随 Sprint 2 主线任务落地,不阻塞)
- **Assignee**: `frontend-dev`
- **Status**: ⚪ Not Started
- **Source issue**: Review Minor #1, #3, #4, #6, #7, #8, #9, #10, #11
- **Definition of Done**:
  - **Minor #1** expo patch 漂移:`npx expo install --check` 一把梭,锁到 expo@57.0.23 / expo-build-properties@57.0.20 / expo-notifications@57.0.19;commit lockfile
  - **Minor #3** hard-coded hex:`app/(main)/(home)/index.tsx` / `(family)/index.tsx` / `(settings)/index.tsx` 共 3 个 placeholder 屏的 `#DC5A24` → `$primary`,`#F4ECDC` → `$background`,`#FFF9F0` → `$surface`(均已在 `src/theme/tamagui.config.ts` 注册)
  - **Minor #4** NotificationScheduler tap listener return value 丢弃风险:把 `Notifications.addNotificationResponseReceivedListener(cb)` 返回的 subscription 保存到 module-scope `lastTapSub`;重新 init 时先 `lastTapSub?.remove()`
  - **Minor #6** `PlaceholderTask` 内联在 `(home)/index.tsx:12` → 抽到 `src/components/PlaceholderTask.tsx`
  - **Minor #7** LocalStore RMW atomic 在 `LocalStore.ts:143-147, 153-157` 加 TODO 注释指向 P1 background sync phase(本任务不修,文档化以防误以为已修)
  - **Minor #8** `color as string` cast 3 处重复:抽 `<PhosphorTabIcon name icon size color />` helper 到 `src/components/PhosphorTabIcon.tsx`,内部 cast
  - **Minor #9** RPC cast 不一致 —— 3 处风格混用:
    - `SyncManager.ts:431` 用 `as never`
    - `pair-create.tsx:39` + `pair-join.tsx:38` 用 `(supabase.rpc as CallableFunction)(name, args)`
    - 统一:`src/lib/supabase.ts` 加 `rpcTyped<TArgs>(name, args): Promise<{data, error}>` helper,内部 cast 集中;全部替换
  - **Minor #10** `parseHHMM` fallback `[9, 0]`:在 `NotificationScheduler.ts:241` 上方加注释 `// 默认 [9, 0] 对应设计文档 DD-008 §任务时间缺省值`,常量 `DEFAULT_DIGEST_HOUR = 9` / `DEFAULT_DIGEST_MINUTE = 0` 提到模块顶部
  - **Minor #11** `SplashScreen.preventAutoHideAsync()` 在 `_layout.tsx:19` 模块顶层调用 —— 在 jest 环境会抛 "no native module available":挪进 `RootLayout` 函数体首行 + `if (typeof SplashScreen?.preventAutoHideAsync === 'function')` 防御
  - `tsc --noEmit` 0 新增错误;`jest --silent` 全 pass;`expo-doctor` 21/21(若 Minor #1 已修)
- **决策依据**:
  - 11 项打包成单 task 是因为每项单独建 T-FIX-07..17 会膨胀任务表,且都是 hygiene 类(无主业务依赖)
  - 每项在 PR description 里独立列点 commit,reviewer 仍可逐项看

---

> **不在 Sprint 2 范围的开项(已评审但 defer)**:
> - **Cross #2** `database.ts:34-37` `RecurrenceRule` 类型比 server JSONB 窄(server 接受 `freq: 'yearly'`,client 当前 union 只有 daily/weekly/monthly):MVP 不实现 yearly 任务(PRD v1.3 §4 仅 daily/weekly/monthly);T-FIX-06 不修。但**应改 `database.ts` 注释加 NOTE** 指向 db-v1.1.sql §3 `task_templates.recurrence_rule` 的实际接受 shape
> - **Cross #5** OpenAPI client 生成(`openapi-typescript` for `.rpc()` 调用):Sprint 2 末或 Sprint 3 评估;当前 6 个 RPC + ~25 个文件调用,hand-rolled 类型仍可读;**defer**

---

## §4 按故事的 Dev Tasks

### US-013 匿名设备身份初始化

#### T-US013-1: AuthService + SecureStore 持久化
- **Type**: FE
- **Module**: `src/services/AuthService.ts`
- **Depends on**: T-SETUP-4
- **Effort**: M
- **Risk**: Med
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ✅ Done(2026-09-17)— AuthService + SecureStore 持久化层抽离完成,详见 ChangeLog `v1.0+us013-1`
- **Definition of Done**:
  - `signInAnonymously()` 调 supabase,拿 JWT,存 SecureStore(key = `auth:session`)
  - `restoreSession()` 从 SecureStore 读,设置到 supabase client
  - `clearSession()` 清 SecureStore + supabase signOut
  - `onAuthStateChange` 监听 token refresh 失败 → 自动重新 signIn

#### T-US013-2: 启动 boot guard
- **Type**: FE
- **Module**: `src/screens/SplashScreen.tsx`
- **Depends on**: T-US013-1
- **Effort**: S
- **Risk**: Low
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - App 启动显示 splash,等 AuthContext.isLoading = false
  - 有 user → 跳到主 Tab(或家庭配对页)
  - 无 user → 调 signInAnonymously,失败重试 1 次,再失败报错退出

---

### US-012 创建 / 加入家庭

#### T-US012-1: FamilyService + 创建家庭 UI
- **Type**: Full-stack(FE 主导,BE 已有 RPC)
- **Story**: US-012
- **Module**: `src/services/FamilyService.ts` / `src/screens/FamilyScreen.tsx`
- **Depends on**: T-US013-1, T-SETUP-9
- **Effort**: M
- **Risk**: Med(创建家庭是首次 family 维度操作,RLS 配置错会导致失败)
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - `FamilyService.create()` 调 supabase.rpc('create_family'),返回 family_id
  - Family 页有"创建家庭"按钮(若 user 已在 family,按钮禁用并显示配偶)
  - 创建成功后,FamilyContext 保存 family_id,跳到家庭主页
  - 失败时显示错误(常见:"已在某 family 中")

#### T-US012-2: 生成邀请码 UI
- **Type**: Full-stack(FE 主导)
- **Story**: US-012
- **Module**: `src/screens/InviteScreen.tsx`
- **Depends on**: T-US012-1
- **Effort**: M
- **Risk**: Low
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - "生成邀请码"按钮 → 调 create_invite RPC
  - 展示 6 位数字 + 大字号 + 10 分钟倒计时
  - 倒计时到 0 时,自动隐藏并提示"已过期,重新生成"
  - 重新生成按钮可点

#### T-US012-3: 输入邀请码 + 配偶加入 UI
- **Type**: Full-stack(FE 主导)
- **Story**: US-012
- **Module**: `src/screens/JoinFamilyScreen.tsx`
- **Depends on**: T-US012-1
- **Effort**: M
- **Risk**: Med(错误码:invalid/expired/already_in_family 都要区分)
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 6 位数字输入框(自动跳到下一位)
  - 调 accept_invite RPC
  - 成功 → FamilyContext 保存 family_id,跳到主 Tab
  - 失败显示对应错误(invalid code / expired / already in family)
  - 加入后自动 subscribe family Realtime channel,显示"已加入"提示

---

### US-001 创建任务

#### T-US001-1: TaskService + 任务创建表单
- **Type**: Full-stack(FE 主导)
- **Story**: US-001
- **Module**: `src/services/TaskService.ts` / `src/screens/CreateTaskScreen.tsx`
- **Depends on**: T-US012-1, T-SETUP-9
- **Effort**: M
- **Risk**: Low
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 表单字段:title(必填)/ 日期(必填,默认今天)/ 时间(可选)/ 指派人(默认自己)/ 周期(默认"不重复")/ 备注/ 是否共享
  - 提交时:无周期 → POST /tasks;有周期 → 走 T-US004-1 流程
  - 表单关闭后跳回列表,新任务可见

#### T-US001-2: 周期选择器(桥接到 T-US004-1)
- **Type**: FE
- **Story**: US-001
- **Module**: `src/components/RecurrencePicker.tsx`
- **Depends on**: T-US001-1, T-US004-1
- **Effort**: M
- **Risk**: Low
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - UI:每日 / 每周(选星期几) / 每月(选几号)/ 自定义(暂不支持)
  - 选完返回 `{freq, byday?, bymonthday?}` JSON,提交时作为 recurrence_rule
  - "周期结束时间" 可选输入框

---

### US-002 查看任务列表

#### T-US002-1: 任务列表页 + 视图切换器
- **Type**: Full-stack(FE 主导)
- **Story**: US-002
- **Module**: `src/screens/HomeScreen.tsx` / `src/components/TaskList.tsx`
- **Depends on**: T-US001-1
- **Effort**: M
- **Risk**: Low
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 顶部 Tab 切换:今天 / 本周 / 全部
  - 列表项显示:title / 时间 / 指派人头像 / 状态 badge
  - 下拉刷新(Realtime 会自动更新,但兜底)
  - 切视图时 query 参数对应变化

#### T-US002-2: 状态 badge 渲染
- **Type**: FE
- **Story**: US-002
- **Module**: `src/components/TaskStatusBadge.tsx`
- **Depends on**: T-US002-1
- **Effort**: S
- **Risk**: Low
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 状态 = 已完成 → 绿色 ✓
  - 状态 = 已过期(日期 < 今天 且 未完成 且 未取消)→ 红色 "已过期"
  - 状态 = 待办 → 灰色

#### T-US002-3: 按指派人筛选
- **Type**: FE
- **Story**: US-002
- **Module**: `src/components/AssigneeFilter.tsx`
- **Depends on**: T-US002-1
- **Effort**: S
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 顶部 chips:全部 / 我 / 配偶
  - 切换时 query 过滤 assignee_id

---

### US-003 编辑 / 删除任务

#### T-US003-1: 编辑表单
- **Type**: Full-stack(FE 主导)
- **Story**: US-003
- **Module**: `src/screens/EditTaskScreen.tsx`
- **Depends on**: T-US001-1
- **Effort**: M
- **Risk**: Med(模板级联更新逻辑要在 FE 配合)
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 复用 CreateTaskScreen 的表单,预填当前值
  - 模板任务:改完调 PATCH /task_templates + PATCH /tasks(template_id eq, task_date gte today, completed_at is null)
  - 一次性任务:只 PATCH /tasks(id eq)
  - 修改后通知 NotificationScheduler reschedule

#### T-US003-2: 删除(单实例 + 整系列)
- **Type**: Full-stack(FE 主导)
- **Story**: US-003
- **Module**: `src/components/DeleteTaskAction.tsx`
- **Depends on**: T-US001-1
- **Effort**: M
- **Risk**: Med
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 列表 long-press / 详情页"删除"按钮 → 弹二次确认
  - 一次性任务:DELETE /tasks(id)
  - 周期任务单实例:PATCH /tasks(id) {cancelled: true}
  - 周期任务整系列:确认对话框多一个选项"删除整个系列"→ 调软删除模板 + 删未来实例

---

### US-004 设置周期任务

#### T-US004-1: TaskTemplateService + 客户端展开 60 天
- **Type**: Full-stack(FE 主导)
- **Story**: US-004
- **Module**: `src/services/TaskTemplateService.ts` / `src/lib/recurrence.ts`
- **Depends on**: T-US001-1
- **Effort**: L
- **Risk**: Med(展开函数写错会少生成或多生成实例)
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - `expandRecurrence(rule, startDate, endDate): Date[]` 函数实现,支持 daily/weekly(byday)/monthly(bymonthday)
  - `TaskTemplateService.create(template)` POST /task_templates + 展开并 POST /tasks 60 天实例
  - 展开时给每行预生成 UUID(用于离线写)

#### T-US004-2: 续期逻辑
- **Type**: FE
- **Story**: US-004
- **Module**: `src/lib/recurrence.ts` / `src/services/TaskTemplateService.ts`
- **Depends on**: T-US004-1, T-SETUP-6
- **Effort**: M
- **Risk**: Med(续期必须幂等,unique constraint 兜底)
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - App 启动后:对每个 active template,查 MAX(tasks.task_date WHERE template_id = X)
  - 若 < today + 30 天,补足到 today + 60 天
  - DB unique constraint `uq_tasks_template_date` 兜底幂等
  - 续期失败不阻塞 app 启动,只 warn

---

### US-005 一键打卡

#### T-US005-1: 打卡 button + checkin_task RPC 绑定
- **Type**: Full-stack(FE 主导)
- **Story**: US-005
- **Module**: `src/services/CheckInService.ts` / `src/components/CheckInButton.tsx`
- **Depends on**: T-US002-1
- **Effort**: M
- **Risk**: Med(必须走 RPC,不能直接 PATCH)
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 列表项和详情页都有"打卡"按钮
  - 点击 → CheckInService.checkin(taskId, false) → 调 RPC
  - 返回 1 行 → UI 更新为"✓ 已完成",显示撤销入口
  - 立即本地更新 cache(乐观)

#### T-US005-2: 0 行返回处理(配偶已先完成)
- **Type**: FE
- **Story**: US-005
- **Module**: `src/components/CheckInButton.tsx`
- **Depends on**: T-US005-1
- **Effort**: S
- **Risk**: Low
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - RPC 返回 0 行 → 客户端 refetch 该 task
  - 若 refetch 发现 completed_by = 配偶 → UI: "配偶已于 HH:MM 完成"
  - 弹 toast 提示,2 秒消失

#### T-US005-3: 撤销打卡(5 分钟内)
- **Type**: Full-stack(FE 主导)
- **Story**: US-005
- **Module**: `src/services/CheckInService.ts`
- **Depends on**: T-US005-1
- **Effort**: S
- **Risk**: Low
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 打卡后 5 分钟内显示"撤销打卡"按钮
  - 5 分钟后按钮自动隐藏
  - 调 undo_checkin RPC,失败/0 行 → 不报错(用户感知不强)

#### T-US005-4: Realtime 订阅 tasks
- **Type**: FE
- **Story**: US-005(隐含,US-009 依赖)
- **Module**: `src/lib/SyncManager.ts`
- **Depends on**: T-SETUP-6, T-US012-1
- **Effort**: M
- **Risk**: Low
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 配对成功后自动 subscribe `channel('family:{id}')`
  - 监听 `tasks` 表 INSERT/UPDATE/DELETE,增量更新本地 cache
  - UI 订阅 store,自动重渲染

---

### US-006 漏打卡补救(补卡)

#### T-US006-1: 补卡 action
- **Type**: Full-stack(FE 主导)
- **Story**: US-006
- **Module**: `src/services/CheckInService.ts` / `src/components/MakeupAction.tsx`
- **Depends on**: T-US005-1
- **Effort**: M
- **Risk**: Med(截止校验由 RPC 处理,但 UI 需提示用户"补卡已过截止")
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 任务详情页"补卡"按钮(只在已过期/过去日期显示)
  - 调 checkin_task(p_task_id, p_is_makeup=true)
  - 失败 → UI 提示"补卡已过截止 / 已关闭"
  - 成功 → 标 is_makeup,UI 显示"补卡 ✓"

#### T-US006-2: 补卡历史显示
- **Type**: FE
- **Story**: US-006
- **Module**: `src/components/TaskHistory.tsx`
- **Depends on**: T-US006-1
- **Effort**: S
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 任务详情页"历史"区块显示打卡记录
  - 补卡条目有"补卡"标签
  - 按 completed_at 倒序

---

### US-014 过期任务标记

#### T-US014-1: 列表 "已过期" 标签
- **Type**: FE
- **Story**: US-014
- **Module**: `src/components/TaskStatusBadge.tsx`
- **Depends on**: T-US002-2
- **Effort**: S
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - `task_date < today AND completed_at IS NULL AND cancelled = false` → 红色"已过期"标签
  - 永久显示,与启动 banner 设置无关

#### T-US014-2: 详情页过期 banner
- **Type**: FE
- **Story**: US-014
- **Module**: `src/screens/TaskDetailScreen.tsx`
- **Depends on**: T-US014-1
- **Effort**: S
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 任务详情页顶部 banner: "此任务已过期 X 小时"
  - X = now() - task_date - task_time(精确到小时)
  - banner 上有"补卡"按钮 → 跳 T-US006-1

---

### US-015 启动时过期任务提示

#### T-US015-1: 启动过期任务查询
- **Type**: FE
- **Story**: US-015
- **Module**: `src/services/ExpiryService.ts`
- **Depends on**: T-US014-1, T-US017-3
- **Effort**: M
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - App 启动时:从 family_settings 读 expiry_window
  - 根据窗口查过期任务数:yesterday_today / this_week / all
  - off → 跳过

#### T-US015-2: 顶部 banner
- **Type**: FE
- **Story**: US-015
- **Module**: `src/components/ExpiredTasksBanner.tsx`
- **Depends on**: T-US015-1
- **Effort**: S
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - N = 0 → 不显示
  - N > 0 → 顶部 banner: "你有 N 个任务过期未完成,点击查看"
  - 处理一个后,Realtime 推送导致 N 减 1,banner 自动消失

#### T-US015-3: 点击 banner 跳转到过期列表
- **Type**: FE
- **Story**: US-015
- **Module**: `src/screens/ExpiredTasksScreen.tsx`
- **Depends on**: T-US015-2
- **Effort**: S
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 点击 banner 跳到 ExpiredTasksScreen
  - 显示完整过期任务列表,按日期倒序
  - 每项可打卡 / 补卡

---

### US-007 到点精确推送

#### T-US007-1: 排程单个任务提醒
- **Type**: FE
- **Story**: US-007
- **Module**: `src/lib/NotificationScheduler.ts`
- **Depends on**: T-SETUP-7, T-US002-1
- **Effort**: M
- **Risk**: High(国内 ROM 优化杀后台,可能漏响)
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 启动 + 续期时,对每个 task(`assignee_id = self` AND `task_time NOT NULL` AND `cancelled = false` AND `completed_at IS NULL` AND `task_date >= today`)调 scheduleTaskReminder
  - 通知 title = "任务提醒",body = "<title> <HH:MM>"
  - data = { taskId, route: 'task-detail' }
  - 任务在已过去时间时跳过

#### T-US007-2: 通知点击 deep link
- **Type**: FE
- **Story**: US-007
- **Module**: `src/navigation/RootNavigator.tsx`
- **Depends on**: T-US007-1
- **Effort**: M
- **Risk**: Low
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 监听通知点击事件
  - 解析 data.taskId,跳到任务详情页
  - 即使 app 被杀(冷启动),也要正确 deep link

#### T-US007-3: 任务状态变化时重排
- **Type**: FE
- **Story**: US-007
- **Module**: `src/lib/NotificationScheduler.ts`
- **Depends on**: T-US005-1, T-US003-1
- **Effort**: M
- **Risk**: Low
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 任务完成 → cancelByTaskId
  - 任务取消 → cancelByTaskId
  - 任务编辑(改了时间)→ cancelByTaskId + reschedule

---

### US-008 早 / 晚汇总

#### T-US008-1: 排程早/晚汇总
- **Type**: FE
- **Story**: US-008
- **Module**: `src/lib/NotificationScheduler.ts`
- **Depends on**: T-SETUP-7, T-US007-1
- **Effort**: M
- **Risk**: Low
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 每天 0 点本地排程当天 08:00 早汇总 + 20:00 晚汇总
  - 时间从 family_settings 读取,用户改时间后重排
  - 内容动态拼装(从本地 cache 读)

#### T-US008-2: 早汇总内容
- **Type**: FE
- **Story**: US-008
- **Module**: `src/lib/NotificationScheduler.ts`
- **Depends on**: T-US008-1
- **Effort**: M
- **Risk**: Low
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - "今日任务" N 个
  - "已完成 X / Y"
  - 列出已完成 / 未完成的标题(最多 5 条,超出显示"等 N 个")
  - 点击跳到今日任务列表

#### T-US008-3: 晚汇总内容
- **Type**: FE
- **Story**: US-008
- **Module**: `src/lib/NotificationScheduler.ts`
- **Depends on**: T-US008-1
- **Effort**: M
- **Risk**: Low
- **Priority**: P0
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - "今日还有 N 个未完成"
  - 列出未完成任务的标题(最多 5 条)
  - 点击跳到今日任务列表

---

### US-009 添加共同执行人

#### T-US009-1: 共同执行人选择器
- **Type**: Full-stack(FE 主导)
- **Story**: US-009
- **Module**: `src/components/CoExecutorPicker.tsx`
- **Depends on**: T-US003-1
- **Effort**: M
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 编辑表单增加"共同执行人"多选
  - 选项从 family_members 拉(自动排除指派人本身)
  - 最多 1 个(因为 MVP 2 人)

#### T-US009-2: PATCH co_executor_ids
- **Type**: FE
- **Story**: US-009
- **Module**: `src/services/TaskService.ts`
- **Depends on**: T-US009-1
- **Effort**: S
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 提交时 PATCH /tasks(id) { co_executor_ids }
  - 对方 Realtime 收到更新后,任务自动显示在对方"今天"列表

---

### US-010 共享任务仅查看

#### T-US010-1: 共享 toggle
- **Type**: FE
- **Story**: US-010
- **Module**: `src/components/SharedViewToggle.tsx`
- **Depends on**: T-US001-1
- **Effort**: S
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 编辑表单加"仅查看共享"开关
  - 默认关闭
  - 提交时 PATCH /tasks(id) { is_shared_view }

#### T-US010-2: 共享任务无打卡 button
- **Type**: FE
- **Story**: US-010
- **Module**: `src/components/CheckInButton.tsx`
- **Depends on**: T-US010-1
- **Effort**: S
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 当 task.is_shared_view = true 且 caller 不在 assignee/co_executor 列表中 → 打卡 button 隐藏
  - 家庭看板可以显示该任务

---

### US-011 查看家庭公开看板

#### T-US011-1: 家庭看板页
- **Type**: Full-stack(FE 主导)
- **Story**: US-011
- **Module**: `src/screens/FamilyBoardScreen.tsx`
- **Depends on**: T-US002-1
- **Effort**: M
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 调 GET /family_shared_tasks 视图
  - 显示共享任务列表(只 is_shared_view = true)
  - 按指派人分组

#### T-US011-2: 成员完成情况聚合
- **Type**: FE
- **Story**: US-011
- **Module**: `src/screens/FamilyBoardScreen.tsx`
- **Depends on**: T-US011-1
- **Effort**: M
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 每个成员卡片显示:今日完成 X/Y / 本周完成 X/Y
  - 从本地 cache tasks 聚合(避免额外 RPC)

---

### US-016 后台推送优化引导

#### T-US016-1: 推送 token 获取状态检测
- **Type**: FE
- **Story**: US-016
- **Module**: `src/lib/NotificationScheduler.ts`
- **Depends on**: T-SETUP-7
- **Effort**: M
- **Risk**: Med(国内 ROM token 获取逻辑差异大)
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - `checkTokenStatus()` 调 `Notifications.getExpoPushTokenAsync()`,捕获失败
  - 失败时写 user_metadata: `whitelist_check.is_whitelisted = false`
  - 成功时写 `is_whitelisted = true`
  - 记录 `last_checked_at` 时间戳

#### T-US016-2: 厂商识别 + 引导卡片
- **Type**: FE
- **Story**: US-016
- **Module**: `src/components/WhitelistGuidance.tsx` / `src/lib/vendorDetector.ts`
- **Depends on**: T-US016-1
- **Effort**: L
- **Risk**: High(各厂商系统设置路径差异,需收集实测步骤)
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - `vendorDetector.detect()` 读 `expo-constants` + `Platform.constants.Manufacturer` 或 Build.BRAND,返回 'xiaomi' | 'huawei' | 'oppo' | 'vivo' | 'samsung' | 'other'
  - 引导卡片根据厂商显示对应路径(图文)
  - 路径数据写在 `src/data/whitelist-guides.ts`(手工维护)

#### T-US016-3: 跳过逻辑 + 每天最多提示 1 次
- **Type**: FE
- **Story**: US-016
- **Module**: `src/components/WhitelistGuidance.tsx`
- **Depends on**: T-US016-2
- **Effort**: S
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 引导卡片有"跳过"按钮
  - 跳过 → 写 `prompt_count++` + 记录今日已提示
  - 启动时检查:今日已提示过则不弹
  - 设置页"重新检测"可重置

#### T-US016-4: 设置页"重新检测"入口
- **Type**: FE
- **Story**: US-016
- **Module**: `src/screens/SettingsScreen.tsx`
- **Depends on**: T-US016-1, T-US017-1
- **Effort**: S
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 设置页"白名单"区块有"重新检测"按钮
  - 点击调 checkTokenStatus(),结果显示当前状态
  - 状态变化时重排引导卡片

---

### US-017 集中设置页面

#### T-US017-1: 设置页 UI 骨架
- **Type**: FE
- **Story**: US-017
- **Module**: `src/screens/SettingsScreen.tsx`
- **Depends on**: T-SETUP-9
- **Effort**: M
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - Tab "我的" → "设置"入口
  - 4 区块:推送时间 / 过期窗口 / 补卡截止 / 白名单 + 关于
  - 初始从 family_settings 拉取

#### T-US017-2: 推送时间设置
- **Type**: Full-stack(FE 主导)
- **Story**: US-017
- **Module**: `src/components/DigestTimePicker.tsx`
- **Depends on**: T-US017-1
- **Effort**: M
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 早汇总 + 晚汇总各一个 time picker
  - picker 受 min/max 约束(从 family_settings 读)
  - 提交时调 update_family_setting RPC
  - 成功 → 通知 NotificationScheduler reschedule

#### T-US017-3: 过期窗口设置
- **Type**: Full-stack(FE 主导)
- **Story**: US-017
- **Module**: `src/components/ExpiryWindowPicker.tsx`
- **Depends on**: T-US017-1
- **Effort**: S
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 4 选 1 按钮组:今+昨 / 本周 / 全部 / 关闭
  - 提交调 update_family_setting RPC
  - 立即生效(下次启动 banner 重新计算)

#### T-US017-4: 补卡截止设置
- **Type**: Full-stack(FE 主导)
- **Story**: US-017
- **Module**: `src/components/LateCheckinCutoffPicker.tsx`
- **Depends on**: T-US017-1
- **Effort**: S
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 3 选 1 按钮组:当天 23:59 / 次日 12:00 / 关闭
  - 提交调 update_family_setting RPC
  - 立即生效(下次补卡用新规则)

#### T-US017-5: 白名单区块
- **Type**: FE
- **Story**: US-017
- **Module**: `src/components/WhitelistSection.tsx`
- **Depends on**: T-US017-1, T-US016-1
- **Effort**: S
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 显示当前白名单状态(已加/未加)
  - 显示上次检测时间
  - "重新检测"按钮 → T-US016-4

#### T-US017-6: 关于区块
- **Type**: FE
- **Story**: US-017
- **Module**: `src/components/AboutSection.tsx`
- **Depends on**: T-US017-1
- **Effort**: S
- **Risk**: Low
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 显示版本号(从 app.json 读)
  - 隐私说明(简述匿名 ID 模型)
  - 反馈入口(PRD Q14 待定:暂用 mailto 链接)

---

## §5 QA 任务

### T-QA-1: E2E 测试环境
- **Type**: QA
- **Module**: `e2e/`
- **Depends on**: T-SETUP-1, T-SETUP-2
- **Effort**: M
- **Risk**: Med
- **Priority**: P2
- **Assignee**: qa
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 用 Detox 或 Maestro 配 E2E
  - 2 模拟器(或真机)能跑通配对流程

### T-QA-2: 关键 E2E 用例
- **Type**: QA
- **Module**: `e2e/critical/`
- **Depends on**: T-QA-1
- **Effort**: M
- **Risk**: Med
- **Priority**: P2
- **Assignee**: qa
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - 用例 1:创建家庭 → 生成邀请码 → 另一台加入 → Realtime 同步
  - 用例 2:创建任务 → 打卡 → 撤销 → 状态正确
  - 用例 3:改设置 → 另一台 Realtime 收到
  - 用例 4:打卡并发(2 模拟器同时点)→ first-finisher wins

---

## §6 部署任务

### T-DEPLOY-1: Supabase Project 1 生产环境配置
- **Type**: BE
- **Module**: Supabase Dashboard
- **Depends on**: T-SETUP-1
- **Effort**: S
- **Risk**: Med(配置错会导致 prod 不可用)
- **Priority**: P0
- **Assignee**: backend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - Auth 配置:启用 Anon Sign-in,禁用其他 provider
  - API 配置:暴露 6 张表 + 6 RPC,anon 角色无访问权限
  - Realtime:确认 4 张表已加入 publication
  - Backups:确认自动备份开启(7 天保留)

### T-DEPLOY-2: EAS Build 出第一版 APK
- **Type**: FE
- **Module**: EAS Build
- **Depends on**: T-SETUP-8, S5 全部任务
- **Effort**: S
- **Risk**: Med(EAS 首次构建可能失败,需调试)
- **Priority**: P1
- **Assignee**: frontend-dev
- **Status**: ⚪ Not Started
- **Definition of Done**:
  - `eas build -p android --profile preview` 成功
  - 产出 APK 下载链接,可直接 install 到 Android 8.0+ 真机
  - 真机跑通"创建家庭 → 加入 → 创建任务 → 打卡"全流程

---

## §7 跨团队依赖与沟通

| 任务 | 依赖方 | 沟通节点 |
|---|---|---|
| 全部 SETUP | tech-lead → frontend-dev / backend-dev | 文档交付时同步,本周内对齐 |
| db-v1.0.sql 部署 | backend-dev → tech-lead 答疑 | T-SETUP-1 阶段 |
| Auth / Family / Settings RPC 联调 | frontend-dev → backend-dev | S1 结束时 |
| EAS Build 出包 | frontend-dev → tech-lead 验收 | S5 结束时 |
| E2E 用例 | qa → frontend-dev | S5 中开始 |

---

## §8 备注

### 8.1 工作量与排期假设

- 每个 S(小)= 0.5-1 天,M(中)= 1-3 天,L(大)= 3-5 天
- 1 个 frontend-dev 全身投入约 5 周完成 52 个 FE 任务
- 1 个 backend-dev 投入约 2-3 天(SETUP-1 + DEPLOY-1 + RPC 验证)
- QA 在 S5 介入,投入约 1 周

### 8.2 风险点提醒

- **国内 ROM 后台限制** → 推送漏响率高,US-016 重点投入
- **EAS Build 首次失败调试** → 预留 1-2 天 buffer
- **Realtime 订阅泄漏** → SyncManager 必须在 app 后台时 unsubscribe

### 8.3 不在 MVP 范围

(与 PRD §2.2 一致,开发不接受)

- 任务评论 / 聊天(M10)
- 任务分类标签(M8)
- 统计报表(M9)
- 孩子 / 长辈账号(M11)
- 跨家庭协作(M12)
- 数据导出(M13)
- iOS 客户端
- 应用市场上架
- 服务端推送触发(ADR-006 v2)

---

## §9 Recommended Execution Order (post-review)

> 来自 2026-09-17 code-reviewer 评审。**Sprint 2 第一波顺序**以 P0 修复为前置(Sprint 1 端到端最小链路必须无数据丢失 / 无配置漂移 / 无首启 UX bug 才能开)。Sprint 2 第一日:frontend-dev 优先吃完 T-FIX-01..03(共 ≤ 1 人日),再开始填 US-013 / US-012 的真实业务代码。
>
> **命名冲突说明**:任务表里"§6 部署任务"已存在,本节按 append-only 原则挂到末尾为 §9;若后续编辑决定,可重排为 §6 并把现有部署任务顺延。

### Wave 1 — 数据正确性 + Sprint 1 最小链路(P0,Day 1)

> 任务顺序设计原则:**先修数据正确性 → 再修复配置卫生 → 再修 UX 时机 → 才允许 FE 写第一行 US-013 / US-012 业务代码**。

| 序 | 任务 ID | 标题 | 估时 | 依赖 | 说明 |
|---|---|---|---|---|---|
| 1 | **T-FIX-01** | SyncManager.pullSince 部分失败 timestamp | S | T-SETUP-6 | 数据丢失风险最严重;tasks 查询 5xx → spouse 行永久跳过 |
| 2 | **T-FIX-02** | EAS projectId 单一来源 + env 收敛 | S | T-SETUP-2, T-SETUP-8 | 配置卫生,不修则下次 OTA 推错 project |
| 3 | **T-FIX-03** | 通知 init 时机延迟到 familyId 之后 | S | T-SETUP-7, T-SETUP-9 | 首启 UX,iOS 审核敏感 |
| 4 | ~~T-US013-1~~ ✅ | AuthService + SecureStore 持久化 | M | T-SETUP-4, **T-FIX-03**(familyId 已知) | Sprint 1 最小链路起点 — **已完成(2026-09-17)** |
| 5 | T-US013-2 | 启动 boot guard | S | T-US013-1 ✅ | 替换 app/index.tsx 末尾的 Auth debug 区 |
| 6 | T-US012-1 | FamilyService + 创建家庭 UI(真 RPC)| M | T-US013-1 ✅, T-SETUP-9 | 填 pair-create.tsx 真实 RPC wiring |
| 7 | T-US012-2 | 生成邀请码 UI | M | T-US012-1 | 填 invite-display.tsx |
| 8 | T-US012-3 | 输入邀请码 + 配偶加入 UI | M | T-US012-1 | 填 invite-input.tsx;**完成时 Sprint 1 E2E 闭环(两台设备能配对)** |

> **Wave 1 退出准则(W1 DoD)**:T-FIX-01..03 全 ✅ Done;US-013 + US-012 全部 ✅ Done;Android 物理机清数据冷启动不弹权限框;两台设备一对一邀请 → 加入 → 进 home tab → Realtime 推送同 family 数据。

### Wave 2 — 任务 CRUD + UX 修复并行(P0/P1,Sprint 2 W1-W2)

| 序 | 任务 ID | 标题 | 估时 | 依赖 | 说明 |
|---|---|---|---|---|---|
| 9 | **T-FIX-04** | SyncManager Realtime eventType 防御 + family_settings DELETE | S | T-SETUP-6 | data correctness,与同 Wave 主线任务并行 |
| 10 | **T-FIX-05** | DD-005 tab fidelity(图标权 + 修正图标 + 4px dot)| S | T-SETUP-9 | 视觉,后续 UI 任务都依赖 |
| 11 | T-US001-1 | TaskService + 创建任务表单 | M | T-US012-1 | 切到 tasks 主流程 |
| 12 | T-US001-2 | 周期选择器(桥接到 T-US004-1)| M | T-US001-1, T-US004-1 | |
| 13 | T-US002-1 | 任务列表页 + 视图切换器 | M | T-US001-1 | 真正用到 T-FIX-05 的 tab visual |
| 14 | T-US002-2 | 状态 badge 渲染 | S | T-US002-1 | |
| 15 | T-US002-3 | 按指派人筛选 | S | T-US002-1 | P1 后置 |
| 16 | T-US003-1 | 编辑表单 | M | T-US001-1 | |
| 17 | T-US003-2 | 删除(单实例 + 整系列)| M | T-US001-1 | 模板级联小心 |
| 18 | T-US004-1 | TaskTemplateService + 60 天展开 | L | T-US001-1 | 核心 L effort,RECURRENCE 公式 |
| 19 | T-US004-2 | 续期逻辑 | M | T-US004-1, T-SETUP-6 | 跟 SyncManager 协同 |

> **Wave 2 退出准则**:任务 CRUD + 周期 + 续期全跑通;Android A 创建任务 / B 收 Realtime 推送 / A 改时间 → B 看到。

### Wave 3 — 打卡 + 推送精修(P1,Sprint 3 W1)

| 序 | 任务 ID | 标题 | 估时 | 依赖 | 说明 |
|---|---|---|---|---|---|
| 20 | T-US005-1 | 一键打卡 button + RPC | M | T-US002-1 | 调 `checkin_task` RPC,first-finisher 语义 |
| 21 | T-US005-2 | 撤销打卡(5 分钟内)| S | T-US005-1 | `undo_checkin` |
| 22 | T-US005-3 | 配偶打卡状态实时感知 | S | T-US005-1, T-SETUP-6 | Realtime 路径 |
| 23 | T-US005-4 | 任务详情页查看打卡元数据 | S | T-US005-1 | |
| 24 | T-US006-1 | 补卡入口(US-006)| M | T-US005-1 | is_makeup 标记 |
| 25 | T-US006-2 | 补卡截止校验 | S | T-US006-1 | ADR-006 后续 Q1 |
| 26 | T-US007-1 | 本地通知到点打卡 | M | T-SETUP-7, T-US001-1 | 真正接入 NotificationScheduler.rescheduleAll |
| 27 | T-US007-2 | task-reminder 写后 audit | S | T-US007-1 | 同 id 替换语义 |
| 28 | T-US007-3 | 通知点击 → 任务详情 | S | T-SETUP-7 | UI 层注册 tap handler |
| 29 | T-US008-1 | 早 / 晚汇总本地通知 | M | T-SETUP-7, T-US017-1 | scheduleDigest 接 settings.morningTime / eveningTime |
| 30 | T-US008-2 | 早 / 晚汇总 UI 中心页(US-008)| M | T-US008-1 | |
| 31 | T-US008-3 | 汇总内容生成(任务聚合)| M | T-US008-2 | |

### Wave 4 — 共享 / 过期 / 白名单(P1/P2,Sprint 4 W1)

| 序 | 任务 ID | 标题 | 估时 | 依赖 | 说明 |
|---|---|---|---|---|---|
| 32 | T-US014-1 | 过期任务标记(view-side)| M | T-US002-1 | 列表 + 详情显示 `已过期` badge |
| 33 | T-US014-2 | 过期任务后端定时清理 | M | T-US014-1, T-SETUP-1 | **建议不动 DB**,仅 UI 层判 task_date < today |
| 34 | T-US015-1 | 启动 banner 浮现检测 | M | T-US014-1 | |
| 35 | T-US015-2 | banner 关闭状态持久化 | S | T-US015-1 | AsyncStorage `banner:dismissed_until` |
| 36 | T-US015-3 | banner 跳到过期任务列表 | S | T-US015-1 | |
| 37 | T-US009-1 | 共同执行人 UI 控件 | M | T-US001-1 | |
| 38 | T-US009-2 | assignees 多写 RPC 联调 | M | T-US009-1 | |
| 39 | T-US010-1 | 共享任务只读视图 | S | T-US002-1 | assignee_count > 1 时禁用编辑 |
| 40 | T-US010-2 | 共享任务编辑权限服务端约束 | S | T-US010-1 | RLS 列级 |
| 41 | T-US011-1 | 家庭公开看板视图 | M | T-US009-1, T-SETUP-9 | 复用 family dashboard |
| 42 | T-US011-2 | 看板"今日 / 本周"分页 | S | T-US011-1 | |

### Wave 5 — 中心化设置 + 部署收尾(P1/P2,Sprint 5 W1)

| 序 | 任务 ID | 标题 | 估时 | 依赖 | 说明 |
|---|---|---|---|---|---|
| 43 | T-US016-1 | 白名单引导首启 overlay | M | T-SETUP-9, T-SETUP-7 | 检测 ROM,跳系统设置 |
| 44 | T-US016-2 | "我已加白名单" 状态写入 | S | T-US016-1 | AsyncStorage `rom:whitelisted` |
| 45 | T-US016-3 | 设置页提供"重新引导"按钮 | S | T-US016-1 | settings 路由 |
| 46 | T-US016-4 | ROM 厂商白名单 deep-link 表 | S | T-US016-1 | 小米 / 华为 / OPPO / vivo / 三星 |
| 47 | T-US017-1 | 集中设置主页(US-017)| M | T-SETUP-9 | 4 分区:推送 / 任务规则 / 白名单 / 关于 |
| 48 | T-US017-2 | 推送设置(开关 + 免打扰时段)| M | T-SETUP-7, T-US017-1 | |
| 49 | T-US017-3 | 任务规则(周期结束时间 / 默认提醒时间)| S | T-US017-1 | |
| 50 | T-US017-4 | 白名单设置(测跳引导)| S | T-US017-1, T-US016-1 | |
| 51 | T-US017-5 | 关于页(版本 + 仓库)| S | T-SETUP-9 | |
| 52 | T-US017-6 | 暗色模式 follow 系统 + 手动开关 | S | T-US017-1 | DD-007,Tamagui Theme 切换 |
| 53 | **T-FIX-06** | code-review minor hygiene 批量 | S | T-SETUP-9 | 11 项合批 polish,见 §3.5 |
| 54 | T-QA-1 | E2E 测试环境(Detox / Maestro)| M | T-US005-1 | **关键流程**:配对 → 创建 → 打卡 → Realtime |
| 55 | T-QA-2 | E2E 关键用例集(8-10 个)| L | T-QA-1, Wave 2 全部 ✅ | |
| 56 | T-DEPLOY-1 | Supabase Project 1 生产环境配置(已部分 done)| S | Wave 1/2 全 | database / RLS 已 OK,只需 cleanup |
| 57 | T-DEPLOY-2 | EAS Build 出第一版 APK | S | Wave 5 全部, T-SETUP-8 | T-SETUP-8 build 已 queue,验收即用 |

### 依赖图(主线,简化)

```
T-FIX-01/02/03 ✅ (Wave 1 P0 修复前置)
   ↓
T-US013-1 → T-US013-2 → T-US012-1 → T-US012-2 → T-US012-3 ✅ (Sprint 1 最小链路)
   ↓
T-US001-1 → T-US002-1 → T-US005-1 → T-US007-1
   ↘ T-US004-1 (模板)
   ↘ T-FIX-04 / T-FIX-05 (并行)
   ↓
T-US008-1 → T-US017-1
   ↓
T-FIX-06 (polish) → T-QA-1 → T-QA-2 → T-DEPLOY-1 → T-DEPLOY-2
```

### 顺序决策逻辑(为什么这样排)

1. **Wave 1 必须先吃修复**:review 找到的 3 个 P0 修复直接阻塞后续 STORY 任务的依赖路径。T-FIX-01 若不修,US-005(打卡)/ US-006(补卡)/ US-007(到点推送)任意一个走 offline → online 路径都可能在 production 走丢 spouse 任务行。T-FIX-02 不修,任何后续 OTA 更新推到 wrong project(虽然现在不会 publish,但是 T-SETUP-8 的 build ID 链路已经在用 `c708a76a-...` —— 必须确认 source-of-truth)。T-FIX-03 是首启 UX bug,但 iOS 审核对此敏感,先收掉免后续 Sprint 5 部署时 review 被拒。
2. **Sprint 1 最小链路 (T-US013 + T-US012) 已经在 Sprint 1 计划里**:SETUP 已交付骨架,缺 Service 层 + UI 真实 RPC wiring。两个 device 能配对成功是 PRD G5 成功标准的 hard prerequisite。
3. **Wave 2 主线任务** = PRD v1.3 §5.2 任务 CRUD 子集(US-001/002/003/004)。Wave 2 同时并行 T-FIX-04/05,因为这两者与业务任务互相 independent(file-level no overlap)。
4. **Wave 3 (打卡 + 推送)** = Sprint 3 原计划。US-007 完全依赖 T-SETUP-7 已交付的 NotificationScheduler,本 Wave 只接 rescheduleAll + tap handler。
5. **Wave 4-5** 顺序与 Sprint 4-5 原计划一致;每个 Wave 结束落主要 demo 米粒(可观测的 UI 流程)。
6. **T-FIX-06 hygiene batch 放在 Wave 5**:它与主线任务并行,PR 上有 hygiene commit 不影响主功能。**但不放 Wave 1** 是因为 Wave 1 是 P0 fix 集中时间窗,hygiene 容易让 reviewer 转移焦点。

### 与原 §2 Sprint 排期的差异

| 原 Sprint | 原计划范围 | 新计划范围(post-review) | 变化理由 |
|---|---|---|---|
| Sprint 1 W1 | SETUP + US-013 + US-012 | SETUP ✅ + T-FIX-01..03 + US-013 + US-012 | +3 P0 修复(本应在 SETUP 阶段就清,review 漏了)|
| Sprint 2 W2 | US-001/002/003/004 | 同 + T-FIX-04/05 + Sprint 1 最小链路的 fallout(若无 Wave 1,这层必崩)| T-FIX-04/05 并行 hygiene 不会拖主线 |
| Sprint 3 W3 | US-005/006/007/008 | 同 | 未变 |
| Sprint 4 W4 | US-009/010/011/014/015 | 同 | 未变 |
| Sprint 5 W5 | US-016/017 + QA + 部署 | 同 + T-FIX-06(hygiene 批)| 末段 polish 合一起 |

> **总变化**:Sprint 1 加 3 个 P0 修复(约 1 人日);Sprint 2 加 2 个 P1 修复(并行,~0.5 人日);Sprint 5 加 1 个 hygiene batch(~1 人日)。**整体延后 ≤ 3 人日**,仍在 5 周预算内吸收。

---

**任务基线 v1.0 · 2026-09-10 · ✅ Approved-by-Zzshark · 待 dev 接受**
**v1.0+review1 补丁 · 2026-09-17 · ✅ §3.5 + §9 落地 · 待 dev 接受新 FIX 任务**
