# ADR-002: Supabase Anon Sign-in 作为身份认证

- **Status**: Accepted
- **Date**: 2026-09-10
- **Deciders**: Zzshark(产品负责人)+ tech-lead
- **Supersedes**: —
- **Superseded by**: —

---

## Context

PRD US-013 要求"首次启动自动生成一个 UUID 存于本地,设备 ID 对用户不可见,仅作为'我是谁'的内部凭证"。PRD A6 接受"卸载重装视为新身份(MVP 不做身份恢复)"。这意味着:

- **不要**手机号 / 邮箱 / 微信 / 密码任何注册
- 身份凭证完全在客户端产生
- 服务端需要能识别"同一台设备的多次请求" + "卸载后是新人"

Supabase Auth(ADR-001 选定的平台)默认是注册用户体系,但提供 **Anonymous Sign-in** 能力 — 客户端调 `supabase.auth.signInAnonymously()` 即可获得一个 Supabase 签发的 JWT,服务端 `auth.users` 表新增一行无 email/password 的用户。这正好对应 PRD 的"无真实账号"需求。

---

## Decision

采用 **Supabase Anon Sign-in** 作为身份认证模型。

### 客户端流程

| 步骤 | 动作 | 持久化 |
|---|---|---|
| 1. 首次启动 | 调 `supabase.auth.signInAnonymously()` | 返回的 JWT + refresh_token 存到 `expo-secure-store` |
| 2. 后续启动 | 从 SecureStore 读 session,SDK 自动 restore | SecureStore |
| 3. 调用任何 API | 客户端 SDK 自动带 `Authorization: Bearer <jwt>` | — |
| 4. 卸载 | SecureStore 数据随 app 一起清 | — |
| 5. 卸载后重装 | 调 signInAnonymously 拿新 `auth.users.id`(=新"设备 ID") | SecureStore |

### 设备 ID 身份

**关键简化:`auth.users.id`(Supabase 生成的 UUID)就是 PRD 要求的"设备 ID"。** 客户端不再单独生成 UUID。理由:

- PRD US-013 说"自动生成 UUID 存于本地" — 实施细节,Supabase 帮我们做了
- PRD A6 要求"卸载 = 新身份" — Supabase SecureStore 随 app 卸载,新 signInAnonymously 拿新 UUID,天然实现
- 减少客户端/服务端状态不一致风险(避免"客户端 UUID 1,服务端 UUID 2"的脏数据)

### Token 存储约束

- **必须用 `expo-secure-store`**(Android Keystore 硬件级加密)
- **禁止用 `AsyncStorage`**(明文,可被同设备其他 app 读取,违反 PRD "隐私友好")
- Token 失效处理:SDK 自动 refresh;若 refresh 失败,清 SecureStore + 重新 signInAnonymously + 提示用户"身份已重置,需重新配对家庭"

### RLS 写法标准

所有表的 RLS policy 默认基于 `auth.uid()`:

```sql
-- 标准模板
CREATE POLICY "<policy_name>" ON <table>
  FOR <SELECT|INSERT|UPDATE|DELETE>
  USING (
    auth.uid() IS NOT NULL
    AND <table>.family_id IN (
      SELECT family_id FROM family_members
      WHERE user_id = auth.uid()
    )
  );
```

### "2 人上限" 强制

`family_members` 表加 trigger:

```sql
CREATE OR REPLACE FUNCTION enforce_family_member_cap()
RETURNS TRIGGER AS $$
DECLARE
  current_count INT;
BEGIN
  SELECT COUNT(*) INTO current_count
  FROM family_members
  WHERE family_id = NEW.family_id;
  IF current_count >= 2 THEN
    RAISE EXCEPTION 'Family % already has 2 members (PRD C1)', NEW.family_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_family_member_cap
  BEFORE INSERT ON family_members
  FOR EACH ROW EXECUTE FUNCTION enforce_family_member_cap();
```

---

## Consequences

### 正面

- **SDK 现成**:`@supabase/supabase-js` 自带 `signInAnonymously()`,5 行代码接入
- **RLS 写法最干净**:`auth.uid()` 是 Supabase 标准 claim,policy 可读性高
- **MAU 计费无忧**:Supabase 免费档 50K MAU,夫妻 2 人永远跑不到 1%
- **卸载 = 新身份 自动实现**:SecureStore 随 app 数据清,新 signInAnonymously 拿新 UUID,完全符合 PRD A6
- **JWT 自动管理**:Supabase SDK 处理 access token + refresh,客户端不用自己写
- **离线可用性**:Supabase SDK 支持用本地 JWT 做有限操作(读 RLS-protected rows);MVP 接受"离线无法新增打卡"限制(打卡需要服务端写)
- **PRD 兼容**:Supabase UUID 对用户不可见,作为内部凭证,匹配 PRD US-013

### 负面 / 风险

- **Anon user 元数据有限**:`auth.users.raw_user_meta_data` 字段可存自定义键值(显示名、头像 URL 等),但不如注册用户体系灵活。未来要做"账号迁移/合并",anon 路径比较曲折
- **Token 撤销不可控**:Anon user 没有"主动登出清数据"概念,只能等 token 过期(默认 1 小时)+ refresh;若需要紧急撤销,只能服务端强制失效(Supabase 提供 admin API)
- **依赖 Supabase 服务可用性**:如果 Supabase 宕机,signInAnonymously 失败,用户无法创建新身份;存量用户靠 SecureStore 里的 JWT 还能撑到 token 过期(1 小时)
- **Supabase UUID 暴露面**:理论上 Supabase 服务端能看到所有 anon UUID;若 Supabase 被攻破,UUID 泄露。这是平台固有风险,不在我们控制范围,但 MVP 阶段可接受
- **`raw_user_meta_data` 写权限**:客户端可直接 update 自家 user 的 metadata;如果未来要存敏感数据,需要额外 RLS 约束

### 中性

- Anon Sign-in 是 Supabase 一等公民,功能完整性等同注册用户路径
- 未来如要"升级到注册用户"(假设要做跨家庭分享),有官方 migration 路径:`update auth.users set email = ..., encrypted_password = ...`
- 客户端只需要 `@supabase/supabase-js` + `expo-secure-store` 两个依赖,生态干净

---

## Alternatives Considered

### (b) 自签 JWT via Edge Function

- **机制**:客户端用本地 UUID + invite_code 调 Edge Function,Edge Function 用 `service_role` 签自定义 JWT
- **优点**:完全可控,无 MAU 计费,UUID 完全客户端产生
- **否决理由**:用户已选 (a);JWT 撤销/refresh 逻辑要自己写,容易出错;Edge Function 冷启 200-500ms,影响首次请求延迟;且 Supabase MAU 50K 免费档对 2 人 app 远用不完,计费不是真问题

### (c) 只用 anon key + RLS 强 device_id 字段匹配

- **机制**:客户端永远带 anon public key;每次请求通过 `SET LOCAL app.device_id = $1` 传值
- **优点**:最简单,无 JWT 管理
- **否决理由**:弱安全 — anon public key 设计上就是"任何客户端都能拿",把 device_id 安全性完全压到 RLS policy;一旦 RLS 写错,整个 family 数据裸奔。不推荐生产

### (d) 用手机号 + 验证码(传统注册)

- **机制**:短信验证码 + Supabase phone auth
- **优点**:身份可恢复,有实名基础
- **否决理由**:违反 PRD US-013 "不要求任何个人信息(手机/邮箱/微信/密码)";且增加摩擦(每台新设备都要验证)

---

## References

- PRD v1.3 US-013(匿名设备身份初始化)
- PRD v1.3 §6.2 A6(卸载重装视为新身份)
- PRD v1.3 C1(MVP 严格 2 人)
- ADR-001(Supabase 后端)
- Supabase 文档(Anonymous Sign-in):https://supabase.com/docs/guides/auth/auth-anonymous
- Expo SecureStore:https://docs.expo.dev/versions/latest/sdk/securestore/
