# ADR-006: 推送 — 客户端本地调度(暂定,可升级到服务端)

- **Status**: Accepted(v1,可迭代)
- **Date**: 2026-09-10
- **Deciders**: Zzshark(产品负责人)+ tech-lead
- **Supersedes**: —
- **Superseded by**: —(计划 v2 / P1 阶段评估升级)
- **Review trigger**: 见下方"升级到服务端"触发条件

---

## Context

PRD §5 明确"推送通道:Expo Push",§6.1 C3 接受"免费额度内运行,超出后评估付费或自建"。但 §6.1 C5 同样承认"不保证 100% 推送到达"。PRD 涉及推送的故事有 4 个:

- **US-007** 到点精确推送 — 任务时间到点
- **US-008** 早/晚汇总 — 默认 08:00 / 20:00
- **US-015** 启动过期任务 banner — 启动时本地判断,不依赖推送
- **US-016** 后台推送优化引导 — 引导用户加白名单

PRD §7 Q13 是开放问题:"后台推送被系统杀掉时,下次启动是否需要主动拉取'应该推送但没收到'的任务"。

本 ADR 决定"谁触发推送"这个最上游的问题。三个候选已在 Q8 中对比。

---

## Decision

**v1 采用客户端本地调度**(`expo-notifications` 的 `scheduleNotificationAsync` 排 local notification),并明确记录已知缺陷与升级路径。

### 客户端实现要点

| 步骤 | 动作 |
|---|---|
| 1. 启动时获取权限 | `Notifications.requestPermissionsAsync()` 申请通知 + 闹钟权限 |
| 2. 拉取任务列表 | 从 server 拉(ADR-005 模型),含 `task_date` + `task_time` |
| 3. 排程提醒 | 对每个 `task_time` 非空且 `assignee_id = self` 且 `cancelled = false` 且 `completed_at IS NULL` 的实例:`scheduleNotificationAsync({ trigger: { date: combineDateTime(task_date, task_time) }, ... })` |
| 4. 早/晚汇总 | 每天 0 点本地调度当天 08:00 / 20:00 的汇总通知(内容动态从本地 cache 拼) |
| 5. 任务状态变化 | 完成/取消/删除时,`cancelScheduledNotificationAsync(id)`,避免无效通知 |
| 6. 跨设备同步后重排 | Realtime 通知对方改了任务时,本地重排(见下"重排策略") |

### 调度目标范围(关键!)

**只对"指派给自己"的任务排本地通知**。这样:
- A 创建任务给 B,A 的设备**不**为 B 的任务排通知(避免 A 手机响"B 该喂奶了"的反直觉体验)
- B 的设备检测到新任务(Realtime 推送或 reconnect pull),自动为该任务排通知

**未指派给己的任务不进通知队列**,但仍在 app 内可见。

### 早/晚汇总内容

- 早汇总(08:00 默认):"今日共 N 个任务,已完成 X 个:①...②..."(从本地 cache 拼)
- 晚汇总(20:00 默认):"今日还有 N 个未完成:①...②..."

时间从 US-017 设置读取(默认值硬编码在客户端,云端设置见 ADR-007 待写)。

### 通知 payload 模板

```ts
{
  title: '任务提醒',
  body: `<${task.title}>  ${formatTime(task.task_time)}`,
  data: { taskId: task.id, route: 'task-detail' },  // 点击通知跳详情
}
```

### 已知缺陷(明确记录)

| 缺陷 | 影响 | 缓解 |
|---|---|---|
| **不跨设备**:A 给 B 指派,B 必须在 B 的设备上**自己打开过 app** 才能排到 B 的通知 | B 长时间不打开 app → B 错过提醒 | (a) 接受(MVP),(b) 升级到服务端触发(见下) |
| **后台被杀丢调度**:国内 Android 厂商深度定制后台管理,expo-notifications 的本地闹钟被优化/杀掉后,到点可能不响 | "白名单引导"(US-016)就是缓解这个;但仍可能漏 | US-016 引导用户加白名单 |
| **卸载即丢**:A 卸载后,即使重装并恢复数据,已排的 local notification ID 已不存在,需 app 启动时重排 | 重装后第一次启动会重排所有未来通知,无感 | 启动时 reconcile |
| **时区切换不感知**:如果用户跨国旅行,08:00 早汇总按**设备本地时区**触发,不是家庭所在地 | 用户临时出差,早汇总可能不响 / 错响 | MVP 接受,UI 可加"按家庭时区"设置(后续) |
| **早/晚汇总内容依赖本地 cache**:如果 cache 过期或被清空,通知内容可能空 | 冷启动第一次显示"今日任务"时 cache 可能空 | 启动时主动 refetch 后再排通知 |
| **未排程已过时间的任务**:task_time 已过的不排 | 预期行为,不通知"已过期"任务 | — |

### 升级到服务端触发的路径(明确记录)

**触发条件(任一):**

1. 观察期 2-3 个月内统计:"漏响率 > 30%" 或 用户反馈"重要任务漏响 ≥ 3 次"
2. PRD 演进到支持**第三成员**或**跨家庭协作** — 本地调度无法覆盖
3. PRD P1 引入"任务评论/聊天"(M10)— 评论的实时通知需要服务端 push

**升级方案(下一版 ADR-006-v2):**

- 服务端:Supabase pg_cron / Edge Function scheduled trigger / 外部 cron 调用 Edge Function
- Edge Function:查询未来 1 小时内需要推送的任务 → 调 Expo Push API
- 客户端:继续管权限和 token 注册,但不排 local notification(全交给 Expo Push)
- 增量迁移:旧版 local notification 自然过期(2-3 个月);新装用户直接用 Expo Push

**升级成本估算:** 1-2 周(Edge Function + cron + Expo Push token 表 + RLS)

---

## Consequences

### 正面

- **零后端依赖**:不需要 cron 基础设施,Supabase 项目零额外费用
- **离线仍能响**:排好的 local notification 不依赖网络
- **实现简单**:`expo-notifications` API 直接用,30 行代码搞定
- **PRD US-015 / US-016 仍可独立运行**:启动 banner 是本地判断;白名单引导是本地检测
- **快速验证产品**:v1 跑 2-3 个月看真实数据,再决定要不要升级

### 负面 / 风险

- **不跨设备**:B 设备必须自己打开过 app 才会排通知 — 这是 v1 最大妥协
- **国内 Android 后台限制**:"不保证 100% 到达" (PRD C5) 在国产 ROM 上更明显
- **时区处理粗糙**:跨国 / 跨时区用户会困惑
- **白名单引导必要**:US-016 必须在 v1 重点实现,且引导效果直接影响产品体感
- **升级路径有迁移成本**:从 local-only 切到 Expo Push 时,需要保留对老用户的兼容(暂不升级的设备继续用 local)

### 中性

- 暂不引入 Expo Push token 注册(本地通知不需要 token);升级时再补
- 早/晚汇总内容从本地 cache 拼,如果用户改了任务但没 sync,通知会显示旧内容(可接受)

---

## Alternatives Considered

### (b) 服务端触发(Supabase cron + Edge Function → Expo Push)

- **优点**:跨设备、卸载重装不丢、白名单依赖降低
- **否决理由(暂时)**:用户决定 v1 先用 a 验证产品;省去 cron 基础设施搭建;观察期后再评估

### (c) 混合

- **优点**:本地承担"自己设备的提醒",服务端承担"早/晚汇总 + 跨设备"
- **否决理由**:2 人 app 不必;客户端代码两套调度逻辑,维护成本高

---

## Open Questions(留给 v2 / P1 阶段)

| 编号 | 问题 | 触发时机 |
|---|---|---|
| ADR-006-Q1 | 是否需要"按家庭时区"而不是按设备时区? | 跨国旅行场景出现时 |
| ADR-006-Q2 | 是否需要"漏响检测"客户端逻辑,主动提示用户"任务 X 你没收到提醒,要重排吗?" | 漏响率数据出来后 |
| ADR-006-Q3 | 早/晚汇总内容是否能用 server 端 SQL 视图算好推过来(减少客户端拼装)? | 升级到 (b) 时一并解决 |

---

## References

- PRD v1.3 §5(推送通道 = Expo Push)
- PRD v1.3 §6.1 C3(免费额度)、C5(不保证 100% 到达)
- PRD v1.3 US-007 / US-008 / US-015 / US-016 / US-017
- PRD v1.3 Q13(冷启动拉取漏推)
- ADR-001(Supabase)
- ADR-005(本地 cache + sync 模型)
- expo-notifications:https://docs.expo.dev/versions/latest/sdk/notifications/
- Expo Push:https://docs.expo.dev/push/overview/
