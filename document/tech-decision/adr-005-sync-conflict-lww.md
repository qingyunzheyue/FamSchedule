# ADR-005: 同步与冲突 — Server 权威 + 行级 LWW + Check-in 幂等

- **Status**: Accepted
- **Date**: 2026-09-10
- **Deciders**: Zzshark(产品负责人)+ tech-lead
- **Supersedes**: —
- **Superseded by**: —

---

## Context

PRD §6.2 A2 假设"用户在同一 WiFi 或可联网环境下使用",但 A4-A5 又要求用户加白名单 — 意味着**离线场景会发生**。同时 PRD US-005 明确"任一完成即标完成"是 first-finisher 语义,需要冲突策略明确。

本 ADR 锁定"端到端最小链路"之后的**写入路径与冲突处理模型**,决定:
- 客户端 cache 形态
- 离线写如何暂存
- 重连时如何 reconcile
- 并发写如何仲裁(特别是 US-005 / US-009 的并发打卡场景)

---

## Decision

采用 **Server 权威 + 行级 LWW + Check-in 幂等** 模型。客户端永远从 server 拉取最终态,本地只是缓存和写队列。

### 通用规则

| 规则 | 描述 |
|---|---|
| Source of truth | **Server**。所有读路径默认从 server 拿;本地 cache 是镜像,不是主数据 |
| LWW 仲裁 | 每行带 `updated_at timestamptz`(server 端 trigger 自动维护),server 端 UPDATE 总是"后写覆盖" |
| Check-in 幂等 | US-005/US-009 的打卡走 `WHERE completed_at IS NULL` 的原子 SQL(详见下);**first-finisher wins** |
| 删除 | 盲删(blind delete)— 即使 server 端 row 已被对方更新,DELETE 仍然执行 |
| 离线写 | 客户端写先入**写队列**;reconnect 时按 FIFO replay |
| 重连 reconcile | 客户端先 PULL server 端 `updated_at > last_sync_at` 的行,再 PUSH 本地写队列 |

### DB 端 `updated_at` 维护

所有可写表(`tasks`、`task_templates`、`family_members`、`invite_codes`)的 trigger:

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 例如 tasks:
CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**关键:trigger 永远用 `now()`(server 端时间),不接收 client 传入的 `updated_at` 值**。这样 LWW 的"时间"是 server 决定的,client 没法伪造。

### Check-in 原子 SQL(US-005 / US-009)

```sql
-- 1. 尝试完成
UPDATE tasks
SET completed_at = now(),
    completed_by = auth.uid(),
    is_makeup = false
WHERE id = $task_id
  AND cancelled = false
  AND completed_at IS NULL  -- 幂等:已完成的任务不再覆盖
RETURNING id, completed_at, completed_by;
```

**`RETURNING` 行为决定 UX:**

| 场景 | RETURNING 行数 | 客户端响应 |
|---|---|---|
| 第一次打卡(未完成 → 完成) | 1 行 | UI: "✓ 已完成",可显示"撤销打卡"(US-005 5 分钟内) |
| 配偶已先完成,自己点打卡 | 0 行 | 客户端 refetch 该行,UI: "配偶已于 XX:XX 完成" |
| 任务已 cancelled | 0 行 | UI: "该实例已删除" |

**补卡(US-006)用同样的幂等模式**,但 `is_makeup = true` 标记:

```sql
UPDATE tasks
SET completed_at = now(),
    completed_by = auth.uid(),
    is_makeup = true
WHERE id = $task_id
  AND cancelled = false
  AND completed_at IS NULL
  AND <补卡截止校验,见 ADR-006 待写>
RETURNING ...;
```

**撤销打卡(US-005 "5 分钟内")** — 唯一允许的 completed_at 重置场景:

```sql
UPDATE tasks
SET completed_at = NULL,
    completed_by = NULL
WHERE id = $task_id
  AND completed_by = auth.uid()  -- 只能撤销自己的
  AND completed_at > now() - interval '5 minutes'  -- 5 分钟窗口
RETURNING ...;
```

### 离线写队列

**本地暂存:** React Native 端用 AsyncStorage 存一个 FIFO 队列(简化:JSON 数组,每项一个 mutation 对象)。**MVP 不上本地 SQLite**,因为:
- 写队列只是序列 replay,不需要查询
- 缓存的任务列表是只读,直接用 AsyncStorage 存全量 JSON 即可(2 人家庭任务数 < 100,序列化 < 50KB)
- 等 P1 真要做复杂本地查询再上 SQLite/WatermelonDB

**Mutation 对象结构:**

```ts
type PendingMutation = {
  id: string;          // client-generated UUID,用于去重
  ts: number;          // client 创建 mutation 的本地时间(仅用于 FIFO 排序,不参与 LWW)
  table: 'tasks' | 'task_templates';
  op: 'insert' | 'update' | 'delete';
  rowId: string;       // INSERT: client-generated UUID;UPDATE/DELETE: 已知 row UUID
  payload?: any;       // UPDATE/INSERT 的字段
};
```

**Replay 逻辑(reconnect 时):**

```ts
async function replayQueue() {
  const queue = await AsyncStorage.getItem('pending_mutations');
  const mutations: PendingMutation[] = JSON.parse(queue ?? '[]');

  for (const m of mutations) {
    try {
      if (m.op === 'insert') {
        await supabase.from(m.table).insert({ id: m.rowId, ...m.payload });
      } else if (m.op === 'update') {
        await supabase.from(m.table).update(m.payload).eq('id', m.rowId);
      } else if (m.op === 'delete') {
        await supabase.from(m.table).delete().eq('id', m.rowId);
      }
    } catch (err) {
      // 冲突处理:server 应用 LWW,本地的"过时"mutation 仍然走完
      // 但 UPDATE 0 行的情况记 log,UI 不报错(用户没感知)
      console.warn('replay conflict', m, err);
    }
  }

  // replay 完成后清空队列
  await AsyncStorage.removeItem('pending_mutations');
}
```

**注意:** client 生成的 UUID 在 INSERT 时作为 row id 发给 server,server 接受(`tasks.id` / `task_templates.id` 都是 UUID,Supabase 默认允许 client 指定)。这样 offline-create 的 row 上线后 ID 不变,client 缓存的引用不会失效。

### Reconnect Pull(server → client 同步)

```ts
async function pullSince(lastSyncAt: string) {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .gt('updated_at', lastSyncAt);
  const { data: templates } = await supabase
    .from('task_templates')
    .select('*')
    .gt('updated_at', lastSyncAt);

  // 写入本地 cache(覆盖式)
  await AsyncStorage.setItem('cache_tasks', JSON.stringify(tasks));
  await AsyncStorage.setItem('cache_templates', JSON.stringify(templates));
  await AsyncStorage.setItem('last_sync_at', new Date().toISOString());
}
```

**触发点:**
- App 启动 / 从后台恢复
- 网络从断开恢复(`NetInfo` 监听)
- Realtime 断线重连后

### Realtime(在线状态的实时同步)

App 在前台且网络正常时,订阅 family 维度的 Realtime channel:

```ts
supabase
  .channel(`family:${familyId}`)
  .on('postgres_changes',
    { event: '*', schema: 'public', table: 'tasks',
      filter: `family_id=eq.${familyId}` },
    (payload) => updateLocalCache(payload))
  .on('postgres_changes',
    { event: '*', schema: 'public', table: 'task_templates',
      filter: `family_id=eq.${familyId}` },
    (payload) => updateLocalCache(payload))
  .subscribe();
```

— 这是 US-009 "任一完成即标完成" 实时通知给配偶的路径。Realtime 断线时,UI 仍能从 reconnect pull 拉到最新态。

---

## Consequences

### 正面

- **Check-in 幂等一行 SQL 搞定**:US-005 / US-009 的"任一完成即标完成"天然实现,第二个人的 UPDATE 0 行返回,UX 友好
- **LWW 模型简单可推理**:行级时间戳,2 人家庭不会触发复杂冲突;用户能理解"我后改的覆盖了配偶的"
- **离线写可丢失接受**:MVP 不承诺离线写一定能 reach server;丢的写用户感知不强(打卡的视觉反馈是本地的)
- **不依赖复杂本地存储**:MVP 用 AsyncStorage + 内存队列,免去 SQLite/WatermelonDB 引入
- **Server 端 trigger 维护 `updated_at`**:client 无法伪造时间,LWW 仲裁可信
- **Realtime + reconnect pull 双保险**:在线实时,断线重连兜底,用户不会看到"过期状态"

### 负面 / 风险

- **盲 LWW 可能让用户困惑**:A 和 B 同时改标题,后写覆盖,先写的人不知道自己的改动被丢了。MVP 接受,UX 后续可加"修改冲突"提示
- **盲 delete 可能误杀**:A 删任务,B 同时改任务,B 的改动连同任务一起被删。MVP 接受,后续可改为"软删除 + 回收站"
- **离线写队列丢失风险**:app 在离线状态下被 kill(用户手动 / 系统 OOM),AsyncStorage 里的 pending_mutations 也跟着丢(MVP 接受;P1 可加 SQLite 持久化)
- **client 假时间无法使用**:不能用 client 时间做 LWW,server 时间依赖 Supabase `now()` 的准确性;Supabase 跨 region 时间一致性 OK,但理论 NTP 抖动可能让相邻毫秒写顺序颠倒
- **本地 cache 是全量 JSON**:2 人家庭任务数 < 100 时 < 50KB,无压力;但如果以后做"千任务"场景需要改分页 / 增量 cache
- **Realtime 订阅对 Expo Push 推送无替代作用**:本 ADR 只解决**数据同步**,不解决**推送触发**(推送触发见后续 ADR-006)

### 中性

- "5 分钟撤销" 窗口写在 SQL 里,改时间窗口要改 SQL(也可改为 Edge Function 包装,但 MVP 不必)
- 写队列是 FIFO,不做优先级;如果以后要"补卡优先于普通打卡"重排队,需要重写队列管理

---

## Alternatives Considered

### (b) Server 权威 + 字段级 LWW

- **机制**:每字段独立时间戳,粒度更细
- **否决理由**:代码复杂(每字段都要带 ts,UPDATE 语句繁琐),2 人家庭触发频率低,无 ROI;且 PRD 没要求

### (c) CRDT / 离线优先(Yjs / Automerge)

- **机制**:本地优先,后台 merge
- **否决理由**:2 人 app 过度工程;引入大型依赖;不符合 PRD A2 "联网使用" 假设;check-in 的 first-finisher 语义在 CRDT 下反而难表达

### (d) Operational Transform(Google Docs 模型)

- **机制**:每个操作是可变换的 op,server 应用 OT
- **否决理由**:复杂度爆炸,只对富文本协作有意义,任务打卡场景完全不需要

### (e) Pessimistic Lock(写前先锁)

- **机制**:用户进入编辑页时锁住行,其他人只读
- **否决理由**:协作体验差(配偶被锁在外面);离线时锁不可用;不适合家庭内部小并发

---

## References

- PRD v1.3 §6.2 A2(联网假设)、A4-A5(白名单)
- PRD v1.3 US-005(打卡,任一完成)
- PRD v1.3 US-006(补卡)
- PRD v1.3 US-009(共同执行人)
- PRD v1.3 Q13(冷启动拉取漏推 — 推送相关,见后续 ADR)
- ADR-001(Supabase)
- ADR-002(Anon Sign-in + RLS)
- ADR-003(`tasks` / `task_templates` 表)
- ADR-004(invite_codes + 配对流程)
- Supabase Realtime:https://supabase.com/docs/guides/realtime
