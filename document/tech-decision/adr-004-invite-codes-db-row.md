# ADR-004: 邀请码 — DB Row 存储 + 原子 Join

- **Status**: Accepted
- **Date**: 2026-09-10
- **Deciders**: Zzshark(产品负责人)+ tech-lead
- **Supersedes**: —
- **Superseded by**: —

---

## Context

PRD US-012 规定:
- 创建家庭:生成 6 位邀请码,10 分钟内有效
- 加入家庭:配偶在 10 分钟内输入邀请码
- 邀请码过期后可重新生成
- 同一家庭最多 2 个成员(ADR-002 trigger 强制)

PRD A6 接受"卸载 = 新身份" — 但邀请码在 DB 里的生命周期与 anon user ID 弱相关,需要明确 owner 行为。

技术约束(继承前序 ADR):
- ADR-001: Supabase 后端
- ADR-002: Anon Sign-in + `auth.uid()` RLS

---

## Decision

采用 **DB row 存储 + Postgres RPC 原子 join** 模式。客户端不直接 UPDATE/INSERT `invite_codes`,通过 `accept_invite(p_code text)` 函数完成"check + mark used + insert family_member"三步原子操作。

### Schema

```sql
CREATE TABLE invite_codes (
  code         text        PRIMARY KEY,             -- 6 位数字字符串,如 '482917'
  family_id    UUID        NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  created_by   UUID        NOT NULL REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,                          -- NULL = 未使用
  used_by      UUID        REFERENCES auth.users(id),

  CONSTRAINT chk_code_format     CHECK (code ~ '^\d{6}$'),
  CONSTRAINT chk_expires_after   CHECK (expires_at > created_at),
  CONSTRAINT chk_used_consistent CHECK (
    (used_at IS NULL  AND used_by IS NULL) OR
    (used_at IS NOT NULL AND used_by IS NOT NULL)
  )
);

CREATE INDEX idx_invite_codes_family   ON invite_codes(family_id);
CREATE INDEX idx_invite_codes_active   ON invite_codes(expires_at) WHERE used_at IS NULL;
```

### 生成流程(client → Supabase RPC)

```ts
// 1. 用户点击"创建家庭" / "重新生成邀请码"
// 2. 客户端调用 Edge Function `create_invite()`
//    或 Postgres function via supabase.rpc('create_invite')
// 3. server 端:
//    a. 检查调用者是某 family 的成员(RLS 隐式保证)
//    b. 生成 6 位随机数字: Math.floor(100000 + Math.random() * 900000).toString()
//       碰撞重试: try insert; on UNIQUE violation, retry (最多 3 次)
//    c. INSERT invite_codes row, expires_at = now() + interval '10 minutes'
//    d. 返回 { code, expires_at }
```

### 加入流程(client → Supabase RPC)

```ts
// 1. 配偶输入 6 位码
// 2. 客户端调 supabase.rpc('accept_invite', { p_code: '482917' })
// 3. server 端(单一 SQL 事务,全成功或全失败):
//    a. SELECT family_id FROM invite_codes
//       WHERE code = p_code AND expires_at > now() AND used_at IS NULL
//       FOR UPDATE;            -- 行锁,防并发
//    b. 若 0 行:RAISE EXCEPTION 'invalid_or_expired_code'
//    c. UPDATE invite_codes SET used_at = now(), used_by = auth.uid()
//       WHERE code = p_code;
//    d. INSERT INTO family_members (family_id, user_id, joined_at)
//       VALUES (v_family_id, auth.uid(), now());
//    e. (可选)DELETE invite_codes WHERE family_id = v_family_id
//       AND code != p_code AND used_at IS NULL;  -- 清掉同 family 其他未用码
//    f. RETURN v_family_id;
// 4. 客户端收到 family_id,刷新 Realtime subscription,进入家庭
```

### RLS

| 表/操作 | 策略 |
|---|---|
| `invite_codes` SELECT | `family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())` |
| `invite_codes` INSERT | 通过 RPC `create_invite()` SECURITY DEFINER,RLS 旁路;function 内部校验调用者是某 family 成员 |
| `invite_codes` UPDATE | 禁止直接 client update;只能通过 `accept_invite()` RPC(SECURITY DEFINER 旁路 RLS) |
| `invite_codes` DELETE | `family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid()) AND used_at IS NULL` — **仅未使用的码可删**(撤销) |
| `family_members` INSERT | 禁止直接 client insert;只能通过 `accept_invite()` RPC(SECURITY DEFINER 旁路 RLS) |

### 撤销(主动取消邀请)

```ts
// creator 想"换码"或"暂时不想拉人":
// 客户端调 supabase.from('invite_codes').delete().eq('code', p_code).eq('used_at', null)
// RLS 保证只能删自家 family 的未用码
```

### 清理过期 / 已用码

客户端 app 启动时执行:

```sql
DELETE FROM invite_codes
WHERE (used_at IS NOT NULL AND used_at < now() - interval '90 days')
   OR (expires_at < now() - interval '30 days');
```

— 保留 90 天的已用码(审计)+ 30 天的过期未用码(防"刚过期用户扫到"争议),之后清掉。

### 配对成功后的 Realtime 行为

- 配偶加入成功后,`accept_invite()` RPC 返回 family_id
- 客户端立即:`supabase.channel('family:' + family_id).subscribe()`
- creator 端 Realtime 收到 `family_members` 表 INSERT 事件,自动更新 UI("配偶已加入")
- 双方都开始监听 `tasks` 表的 family 维度变化

---

## Consequences

### 正面

- **原子 single-use**:`FOR UPDATE` 行锁 + 事务保证两个配偶同时输入不会双签;UPDATE 0 行 = 失败
- **可撤销**:creator 可 DELETE 未用码,用于"我手滑发错了,等下重新发"
- **可审计**:已用码保留 90 天,可追溯谁在什么时候加入了哪个 family
- **RLS 干净**:client 不需要 service_role key,所有写通过 SECURITY DEFINER 函数,权限边界清晰
- **清理轻量**:2 人家庭,90 天累积的邀请码 < 50KB,清理无压力
- **冲突场景明确**:creator 卸载(PRD A6)后,旧 anon ID 仍占 family_member 位;配偶仍可凭码加入,只是 family 已有 2 人,需先有人退出 — 但 MVP 不支持退出流程,意味着 creator 卸载等于"被锁在 family 外",需要 spouse 在 US-017 设置中提供"重置 family"功能(后续 P1)

### 负面 / 风险

- **RPC 调试稍复杂**:不像直接 REST 那样有"打开 SQL editor 看一眼" 的便利,需要从 client 跑 RPC 看返回
- **行锁影响并发**:同 code 并发 join 时,第二个会被 `FOR UPDATE` 阻塞 ~10ms 后被判定为"已用" — 符合"single-use"语义,但需要给 client 友好错误信息
- **SECURITY DEFINER 函数风险**:一旦函数有 SQL injection 漏洞,可能绕过 RLS;必须严格用 `auth.uid()` 校验调用者,且不做动态 SQL
- **creator 卸载的 UX 痛点**:creator 卸载后,family_member 仍有其旧 anon ID,新人(creator 重装后)无法用旧 ID 重新加入;需要 spouse 在设置页提供"重置 family"功能才能恢复(已在 PRD v1.3 Q11 开放问题中,本 ADR 不解决)
- **过期 row 累积**:虽然量小,但理论无限累积,清理 job 挂了就堆;客户端启动清理依赖用户活跃,僵尸用户会让数据永远留着

### 中性

- 6 位数字邀请码的"碰撞风险"在 2 人 app 上可忽略(生日悖论下需要 ~1178 个并发未用邀请才有 50% 碰撞);retry 3 次足够
- `code` 用 text 而不是 int,避免前导 0 被吃掉('012345' vs 12345)

---

## Alternatives Considered

### (b) 无状态 HMAC

- **机制**:`code = HMAC(family_secret, nonce + expires_at)`,纯签名;join 时服务端重算 HMAC 校验
- **优点**:不存 row,DB 干净
- **否决理由**:撤销难(要维护 family_secret 撤销列表);RLS 不直接适用,需要在 Edge Function 内做权限检查;审计差(不知道谁用过什么码)

### (c) Edge Function 内存缓存

- **机制**:邀请码只在 Edge Function 实例内存里,过期自动清
- **优点**:DB 零负担
- **否决理由**:Edge Function 冷启会丢邀请码;实例间不共享内存;2 人 app 没必要

### (d) Supabase Realtime Broadcast(非持久化)

- **机制**:creator 端生成码后通过 Realtime channel 广播给加入者
- **否决理由**:完全不符合 PRD "输入邀请码" 流程(US-012 明确说"配偶在家庭页面输入邀请码");且双方必须同时在线,违反 A1 假设

---

## References

- PRD v1.3 US-012(创建/加入家庭)
- PRD v1.3 §6.2 A6(卸载 = 新身份)
- PRD v1.3 C1(2 人上限)
- PRD v1.3 Q11(开放问题:重置身份并恢复原家庭)
- ADR-001(Supabase 后端)
- ADR-002(Anon Sign-in + RLS 基础)
- ADR-003(tasks 数据模型 — `family_id` 引用)
- Supabase 文档(RPC + SECURITY DEFINER):https://supabase.com/docs/guides/database/functions
