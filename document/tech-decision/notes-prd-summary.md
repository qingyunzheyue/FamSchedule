# PRD v1.3 理解摘要 — 待用户确认

> 由 tech-lead 在首次对话时整理,作为后续 Socratic 设计的起点。

## 一句话定位
FamSchedule = Android 端、家庭内部(夫妻 2 人)、轻量日程 + 打卡 + 共享,React Native + Expo,APK 直装,无真实账号体系。

## 关键约束(已确定)
- 平台:Android 8.0+ only
- 技术栈:React Native + Expo SDK 52
- 推送:Expo Push
- 身份:匿名 device ID(UUID,本地存)
- 家庭:邀请码配对(6 位、10 分钟有效)
- 分发:APK 直装(无应用市场)
- MVP 范围:17 条 P0 用户故事,无 P1/P2

## 关键约束(更新 — 用户在第二轮反馈)
- **K1**:Supabase 免费 2 个项目已满,**不能再用 Supabase 解决数据层**
- **K2**:用户在大陆,4G/5G 网络环境,需考虑国内连通性
- **K3**:成本敏感,优先选"永久免费"或"接近免费"方案
- **K4**:不想承担运维负担(MVP 阶段)

## 关键不确定点(进入 Socratic 设计)
1. ~~后端选型(PRD Q10):BaaS vs 自建~~ → 范围收窄为:**Supabase 替代品** (Neon / Aliyun RDS / PocketBase / 海外其他)
2. 本地存储(SQLite vs AsyncStorage)+ 同步机制
3. 推送调度:client-side vs server-side
4. 数据模型权威源:本地 vs 云端
5. Q13:冷启动主动拉取漏推
6. Q14:反馈渠道
7. Q15:时间粒度(分钟 vs 三档)

## 已核实的免费档事实(2026-09)
- **Neon Free**:0.5GB/项目,100 CU-hr/月,**无时间限制**,5 分钟 idle 后 scale-to-zero
- **Aliyun RDS PostgreSQL**:1 个月免费试用(50GB,2核4G),之后按量付费(~¥30-100/月)
- **Aliyun Function Compute**:1M 调用/月 + 400K CU-seconds/月,新用户额外 150K CU 三个月
- **Render Postgres**:90 天后强制迁移(不符合 2-3 个月观察期 + 后续可能)
- **Firebase**:在大陆被 GFW 阻断,排除

## 待写 ADR
- ADR-001:后端架构选型 — **Supabase 已不可用,待第二轮决策**
