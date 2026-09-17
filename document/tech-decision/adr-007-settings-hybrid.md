# ADR-007: 设置存储 — 家庭共享 + 设备本地 混合

- **Status**: Accepted
- **Date**: 2026-09-10
- **Deciders**: Zzshark(产品负责人)+ tech-lead
- **Supersedes**: —
- **Superseded by**: —

---

## Context

PRD US-017 集中设置 4 类:
1. 推送时间(早/晚汇总、时段范围)
2. 过期提示窗口(US-015)
3. 补卡截止时间(US-006)
4. 白名单/自启动重检测(US-016)

前 3 类本质是**家庭规则**(A 改了 B 跟着变才符合家庭协作直觉);第 4 类本质是**设备能力**(每台 Android 的 ROM 白名单独立)。两类语义不同,存储不能强求一致。

---

## Decision

**混合模式:**
- 家庭共享设置 → 新表 `family_settings`(1 行/family,PK = `family_id`)
- 设备本地设置 → `auth.users.raw_user_meta_data` JSON(每个 anon user 自己的 metadata)

### `family_settings` 表

```sql
CREATE TABLE family_settings (
  family_id              UUID PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,

  -- 推送时间(US-008)
  morning_digest_time    TIME NOT NULL DEFAULT '08:00:00',
  evening_digest_time    TIME NOT NULL DEFAULT '20:00:00',
  -- 时段范围(防止 23:59 极端值)
  digest_time_min        TIME NOT NULL DEFAULT '06:00:00',
  digest_time_max        TIME NOT NULL DEFAULT '22:00:00',

  -- 过期提示窗口(US-015)
  -- PRD 枚举:今+昨(默认)/ 本周(周一~今)/ 全部 / 关闭
  expiry_window          TEXT NOT NULL DEFAULT 'yesterday_today'
                            CHECK (expiry_window IN ('yesterday_today','this_week','all','off')),

  -- 补卡截止(US-006)
  -- PRD 枚举:当天 23:59(默认)/ 次日中午 12:00 / 关闭补卡
  late_checkin_cutoff    TEXT NOT NULL DEFAULT 'same_day_2359'
                            CHECK (late_checkin_cutoff IN ('same_day_2359','next_day_1200','off')),

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_family_settings_updated_at
  BEFORE UPDATE ON family_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**初始化:** 家庭创建时(US-012 的 create_family RPC 内)自动 INSERT 一行默认值的 `family_settings`,客户端不需要单独"首次打开设置页初始化"。

**时段范围校验:** RPC `update_family_setting(p_key text, p_value any)` 在 Edge Function(或 SQL function)里检查 `digest_time_min ≤ p_value ≤ digest_time_max`,避免设置到 23:59 这种极端值(PRD 验收要求)。

### `auth.users.raw_user_meta_data` 设备本地

```jsonc
{
  "whitelist_check": {
    "last_checked_at": "2026-09-10T08:00:00Z",   // 上次检测时间(US-016)
    "is_whitelisted":  false,                      // 当前白名单状态
    "vendor":          "xiaomi",                   // 用于切换引导卡片内容
    "prompt_count":    2                           // 启动温和提示计数(每天最多 1 次)
  },
  "device_meta": {
    "app_version":     "1.0.0",                    // 客户端自填,用于"关于"页显示
    "device_model":    "Mi 12",                    // 用于反馈 + 兼容性排查
    "os_version":      "Android 13"
  }
}
```

**为什么不放单独的 `device_settings` 表:** 字段少、查询场景简单(只查"我自己")、且与 `auth.uid()` 强绑定;`raw_user_meta_data` 是 RLS 隐式私有的(只有 auth.uid() 本人能读),无需额外 RLS 设计。客户端用 `supabase.auth.updateUser({ data: {...} })` 即可写入。

### RLS

| 表 / 资源 | 策略 |
|---|---|
| `family_settings` SELECT | `family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())` |
| `family_settings` INSERT | 仅 RPC `create_family()`(SECURITY DEFINER) |
| `family_settings` UPDATE | 家庭成员均可;通过 `update_family_setting()` RPC 加时段范围校验 |
| `family_settings` DELETE | 仅 RPC(实际不删,改默认值即可) |
| `auth.users.raw_user_meta_data` | 隐式私有,仅自己读写(Supabase Auth 默认) |

### Realtime 同步

家庭任一成员改设置后,另一台设备的 Realtime channel 立即收到:

```ts
supabase
  .channel(`family:${familyId}`)
  .on('postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'family_settings',
      filter: `family_id=eq.${familyId}` },
    (payload) => {
      // 客户端:更新本地 cache,触发 UI 重新计算(如早汇总时间)
      applyFamilySettings(payload.new);
    })
  .subscribe();
```

— 配偶 A 改了早汇总 08:00 → 07:30,配偶 B 设备几秒内自动同步并重排本地通知(ADR-006 范围内的"重排"动作)。

### 客户端读取路径

1. App 启动:`supabase.from('family_settings').select('*').eq('family_id', familyId).single()` 拉到本地 cache
2. 同时拉 `auth.getUser()` 拿 `raw_user_meta_data`
3. US-017 设置页直接渲染本地 cache(已是最新);改设置走 RPC 写回,Realtime 广播

### 设置项 → 用户故事映射

| 设置项 | PRD 故事 | ADR-006 push 影响 |
|---|---|---|
| `morning_digest_time` | US-008 早汇总 | 客户端按此值重排本地通知 |
| `evening_digest_time` | US-008 晚汇总 | 同上 |
| `expiry_window` | US-015 启动 banner | 启动时读 cache 计算过期任务列表 |
| `late_checkin_cutoff` | US-006 补卡 | 补卡 SQL `WHERE` 子句按此值过滤 |
| `whitelist_check.*` | US-016 后台优化引导 | 客户端读 metadata 决定是否弹引导 |
| `device_meta.*` | US-017 关于 | 仅展示 |

---

## Consequences

### 正面

- **语义最正确**:家庭规则与设备能力不混在一起,各归各位
- **A/B 一致**:家庭共享设置两边立刻一致(Realtime 几秒级)
- **白名单/重检测天然私有**:每台设备独立状态,不会"互相干扰"
- **零本地存储**:不需要为设置额外维护本地 SQLite,AsyncStorage cache 即可
- **不增加主要架构复杂度**:只多 1 张表 + 1 个 RPC + 1 处 Realtime 监听

### 负面 / 风险

- **首版实施成本稍高**:需要 1 个 RPC(写校验)+ 1 个 Realtime 订阅
- **时段范围限制只对家庭共享项生效**:白名单重检测不走同一套校验
- **`raw_user_meta_data` 写入频率**:`updateUser` 调用比更新表行慢,如果未来要做"高频更新"(如实时白名单心跳),应迁出到独立表 — MVP 不触发
- **如果未来要做"按设备差异化家庭设置"**(如 A 用小屏显示紧凑模式,B 用大屏显示宽松模式),本模型需要重构

### 中性

- `raw_user_meta_data` 是 Supabase Auth 的"用户元数据"概念,放在这里语义上比单独建表更顺
- 家庭共享设置只有 1 行/family,无并发写冲突担忧(家庭成员改设置,后者覆盖,符合 LWW 规则,ADR-005)

---

## Alternatives Considered

### (a) 全部云端共享

- **否决理由**:白名单/重检测本质是设备态,放云端会出现"两台设备互相覆盖对方白名单状态"的悖论

### (b) 全部本地(AsyncStorage)

- **否决理由**:早/晚汇总时间 A 改了 B 不知道,违反家庭协作直觉;且补卡截止规则的"两台设备不一致"会导致补卡行为奇怪

### (d) 放客户端 SQLite,不分共享/本地

- **否决理由**:MVP 不上本地 SQLite(ADR-005 决定);设置数据小且几乎只读,放云端更省事

---

## References

- PRD v1.3 US-006(补卡截止)
- PRD v1.3 US-008(早/晚汇总时间)
- PRD v1.3 US-015(过期提示窗口)
- PRD v1.3 US-016(白名单/自启动)
- PRD v1.3 US-017(集中设置)
- ADR-001(Supabase)
- ADR-002(Anon Sign-in,`auth.users.raw_user_meta_data` 已隐式支持)
- ADR-005(Realtime 订阅 + reconnect reconcile 模式)
- ADR-006(本地通知按 settings 排程)
- Supabase Auth user metadata:https://supabase.com/docs/guides/auth/managing-user-data
