# ADR-001: Supabase 作为后端(Plan A)

- **Status**: Accepted
- **Date**: 2026-09-10
- **Deciders**: Zzshark(产品负责人)+ tech-lead
- **Supersedes**: —
- **Superseded by**: —

---

## Context

PRD v1.3 §5 把"数据存储:本地 SQLite/AsyncStorage + 云端按 family 同步"列为待技术选型确认项(开发阶段明确)。这是一个 MVP,服务一个家庭(夫妻 2 人),观察期 2-3 个月(PRD G5),无应用市场上架,仅 APK 直装(PRD C2)。PRD §1.2 强调"低成本快速验证",§7 Q10 把后端选型作为工程阶段开放问题。

**新增约束(2026-09-10 决策会议):**

- K1 — 用户在大陆,4G/5G 网络访问海外域名已实测稳定(用户实测确认)
- K2 — Supabase 免费 2 个项目额度已满;本决策通过**新注册账号再占 2 个免费位**解决(ToS 灰区,见 Consequences)
- K3 — 成本敏感,优先零成本方案
- K4 — 不愿承担运维负担(MVP 阶段)

---

## Decision

采用 **Supabase(Managed Postgres + Auth + Realtime + RLS + Edge Functions + Storage)** 作为云端后端;Expo Push 维持 PRD 既有选择作为推送通道;React Native + Expo 维持 PRD 既有选择作为客户端。

### 项目分配

| 项目 | 用途 | 状态 |
|---|---|---|
| Project 1 | 生产,跑 family DB | **活跃** |
| Project 2 | 备用(暂不使用) | **空置** |

### 客户端 ↔ 服务端依赖架构

| 流量 | 通道 | 备注 |
|---|---|---|
| 客户端 → 服务端 CRUD | Supabase REST(PostgREST) | 任务/家庭/打卡/设置 |
| 客户端 ↔ 服务端实时同步 | Supabase Realtime(WebSocket) | 配偶打卡、家庭看板、过期任务 banner |
| 客户端 → 设备推送 | Expo Push | US-007 / US-008 / US-015 等 |
| 服务端 → Expo Push 触发 | Edge Function(或 pg_cron + HTTP 调用) | 早/晚汇总、精确时间点推送 — 触发责任划分待 ADR 后续 |
| 客户端 → 文件 | Supabase Storage | 暂未使用(预留) |

### 已确定项

- 后端 = Supabase(本 ADR 锁定)
- 项目分配 = 1 生产 + 1 备用(本 ADR 锁定)
- 网络可达性 = 已确认 4G/5G 稳定(本 ADR 锁定)

### 未决项(留给后续 ADR)

- ADR-002 待写:身份与认证模型(Supabase Anon Sign-in vs 自签 JWT vs anon key + RLS)
- ADR-003 待写:本地持久化方案(SQLite / AsyncStorage / WatermelonDB)
- ADR-004 待写:本地 ↔ 云端同步方向与冲突解决(local-first vs cloud-authoritative)
- ADR-005 待写:推送调度责任划分(pg_cron / Edge Function scheduled / 客户端调度)
- ADR-006 待写:数据模型与 RLS 策略细节

---

## Consequences

### 正面

- **零成本起步**:Supabase 免费档(0.5GB Postgres + 1GB Storage + 5GB 流量 + 50K Auth MAU + Realtime + Edge Functions)对 2 人 MVP 完全够用,跑满 2-3 个月观察期无忧
- **少写后端代码**:PostgREST + RLS 替代手写 API;Edge Functions 替代 Node 服务;Auth/Storage/Realtime 开箱即用
- **实时同步**:Supabase Realtime 直接订阅 `family_id` 维度的 channel,US-009「任一完成即标完成」几乎零成本实现
- **数据隔离靠 RLS**:family 边界通过 row-level security 在 DB 层强制,应用层不需要在每个 endpoint 重复校验
- **国内 4G/5G 实测可达**:用户已确认 supabase.com 域名无 GFW 阻断
- **生产经验沉淀**:Supabase 是相对成熟的产品,后续如需升级到 Pro($25/月)路径清晰
- **数据可迁移**:标准 Postgres,未来要迁出自建或其他 BaaS,`pg_dump` 即可

### 负面 / 风险

- **海外节点延迟**:Supabase 免费档通常落在 US/SG 等海外 region,国内访问比国内服务多 100-300ms 延迟。MVP 阶段不在乎;P1 阶段如果做实时性敏感的功能需重新评估
- **额度上限**:0.5GB DB / 1GB Storage / 5GB 流量。2-3 个月观察期无忧,长期使用要监控。`auth.users` 元数据、设备 push token 都会占额度
- **匿名身份 vs Supabase Auth 的张力**:Supabase Auth 默认是注册用户体系;要做 PRD 要求的"匿名设备身份"必须走 Supabase Anon Sign-in 或自签 JWT 方案,细节待 ADR-002
- **推送调度缺位**:Supabase **没有内置 cron 调度器**;免费档的 `pg_cron` 扩展可能受限。要么用 Edge Function + 外部 cron 触发,要么客户端调度(US-007/008 的精确触发细节待 ADR-005)
- **新账号占免费位的 ToS 灰区**:Supabase 服务条款倾向"一人一号"。第二个账号短期无风险,但理论上账号被回收会波及生产数据 → **必须保证 Project 1 的定期备份(Supabase 自动备份保留 7 天,免费档)**
- **第二个项目空置**:1 个免费位暂时不用,保留是作为"主账号万一被封时的应急位";但要主动监控,避免空项目被回收(空项目闲置 90 天可能收到警告)

### 中性

- 一旦绑定 Supabase,后续切到自建或其他 BaaS 数据迁移路径清晰(标准 Postgres dump + Auth 重建)
- Supabase JS SDK 对 React Native/Expo 兼容良好(`@supabase/supabase-js` + `expo-secure-store` 存 token)

---

## Alternatives Considered

### Plan B:阿里云轻量应用服务器 + PocketBase

- **优点**:¥30-50/月,纯国内无 GFW,无冷启;PocketBase 单二进制自带 Auth + Realtime + Storage,API 自带
- **否决理由**:用户已选择 Supabase;PocketBase 生态较 Supabase 小,出问题时社区资料少;且需要维护一台服务器(系统更新/重启)

### Plan C:阿里云 RDS PostgreSQL(1 个月免费试用)+ 阿里云 FC

- **优点**:全国内,无 GFW;阿里云服务稳定
- **否决理由**:免费档仅 1 个月,接续付费且时机差(正好撞观察期);要多写一套后端 API,工作量大于 Supabase

### Plan D:自建 Node + Postgres + 阿里云 FC

- **优点**:完全可控,长期无锁定
- **否决理由**:工作量太大(手写认证/邀请码/RBAC/实时同步),偏离 PRD §1.2 强调的"低成本快速验证"

### Plan E:Neon + 阿里云 FC(原 Plan A 的成本敏感替代)

- **优点**:Neon 永久免费(0.5GB / 100CU-hr/月,无时间限制);FC 1M 调用/月免费
- **否决理由**:用户已选择 Supabase;Neon 没有 Realtime / RLS / Auth,要自己写 Realtime 通道 + 权限校验,胶水代码量上升

### Plan F:Firebase(Firestore + Auth + Cloud Messaging)

- **优点**:Google 生态,MAU 计费慷慨;Realtime 原生
- **否决理由**:**Firebase 在大陆被 GFW 阻断**,APK 装上之后连不上就废了。直接否决

---

## References

- PRD v1.3 §5(数据存储)
- PRD v1.3 §7 Q10(后端选型开放问题)
- PRD v1.3 §1.2(机会 — 低成本快速验证)
- PRD v1.3 C1-C5(约束)
- notes-prd-summary.md
- Supabase 定价页(2026-09 核实):https://supabase.com/pricing
