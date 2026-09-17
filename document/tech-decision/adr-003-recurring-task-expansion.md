# ADR-003: 周期任务预展开(每实例一行)

- **Status**: Accepted
- **Date**: 2026-09-10
- **Deciders**: Zzshark(产品负责人)+ tech-lead
- **Supersedes**: —
- **Superseded by**: —

---

## Context

PRD US-004 要求"周期设置后自动展开为对应实例",但未规定展开的实现方式。US-005(打卡)、US-006(补卡)、US-014(过期标记)、US-015(过期 banner)都依赖"今天有哪些任务"的查询;查询路径的复杂度直接决定这些故事的代码量。

**规模估算(2 人家庭,PRD G5 假设):**

- 每周 5+ 任务 → 平均 7 个/天/家(混合一次性 + 周期)
- 1 年 ≈ 2,555 行,单行 ~200 字节 ≈ 500KB
- 5 年 ≈ 12,775 行 ≈ 2.5MB
- Supabase 免费档 0.5GB 数据库,5 年占 0.5%

存储不是瓶颈,选最简方案。

**决策依据:**

- 选 (a) 一次展开,理由:查询路径最简单,客户端不需要 expand 函数,RLS 写法天然干净
- 选 60 天窗口,理由:覆盖大部分"我提前看下周/下月计划"的真实场景,且不会让单任务初次创建时塞过多行
- 客户端启动续期(而非 Edge Function cron),理由:MVP 不维护调度作业,客户端启动事件是天然续期触发点

---

## Decision

采用 **预展开** 模式:**创建时立即展开未来 60 天实例,客户端启动时检查并补足到 60 天**。

### 数据模型

**`task_templates` 表 — 存规则(只有"创建了周期任务"才有 row)**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `family_id` | UUID FK→families | RLS 维度 |
| `title` | text | 任务标题(模板) |
| `description` | text nullable | 备注 |
| `recurrence_rule` | jsonb | `{"freq":"daily"}` / `{"freq":"weekly","byday":["MO","WE","FR"]}` / `{"freq":"monthly","bymonthday":15}` |
| `start_date` | date | 周期起始日 |
| `end_date` | date nullable | 周期截止日,NULL = 长期有效 |
| `task_time` | time nullable | 提醒时刻(可选,NULL = 仅日期无时间) |
| `assignee_id` | UUID FK→auth.users | 主要执行人 |
| `co_executor_ids` | UUID[] | 共同执行人(US-009) |
| `is_shared_view` | boolean | 是否共享查看(US-010) |
| `active` | boolean | FALSE = 系列已停用(软删除) |
| `created_by` | UUID FK→auth.users | 创建者 |
| `created_at`, `updated_at` | timestamptz | |

**`tasks` 表 — 存具体实例(一次性任务也有 row,只是 template_id = NULL)**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `template_id` | UUID FK→task_templates nullable | NULL = 一次性任务 |
| `family_id` | UUID FK→families | **反范式:从 template 拷过来,RLS 用** |
| `title` | text | 模板 title 的快照(避免 join) |
| `description` | text nullable | 快照 |
| `task_date` | date | 本实例的发生日期 |
| `task_time` | time nullable | 快照 |
| `assignee_id` | UUID | 快照 |
| `co_executor_ids` | UUID[] | 快照 |
| `is_shared_view` | boolean | 快照 |
| `created_by` | UUID | 快照(创建者) |
| `completed_at` | timestamptz nullable | **核心**:NULL = 未完成;US-005 打卡时 SET |
| `completed_by` | UUID nullable | 谁实际打的卡(US-009 共同执行人任一完成) |
| `is_makeup` | boolean | US-006 补卡标记 |
| `cancelled` | boolean | 单实例删除标记(不真删,保历史) |
| `created_at`, `updated_at` | timestamptz | |

**关键设计:实例字段是模板字段的"快照"**,避免每次查询都要 JOIN `task_templates`。代价:模板编辑时需要主动级联更新实例(见下)。

### 展开与续期策略

| 触发点 | 动作 |
|---|---|
| 创建周期任务 | 立即展开 `start_date` 到 `min(start_date + 60d, end_date or +∞)` 的所有实例 |
| App 启动(客户端) | 查 `task_templates WHERE active = TRUE AND family_id IN (...)`;对每个 template,若 `MAX(tasks.task_date) < today + 30d`,补足到 `today + 60d` |
| 编辑周期任务(US-003) | 1) 更新 template;2) 级联 UPDATE 所有 `tasks WHERE template_id = X AND task_date >= today AND completed_at IS NULL`(只改未完成的,避免覆盖打卡时间) |
| 编辑单个实例(US-003) | UPDATE 该 row;template 不动;其他实例不动 |
| 删除整个周期(US-003) | `template.active = FALSE`;DELETE `tasks WHERE template_id = X AND task_date >= today AND completed_at IS NULL`(已完成实例保留历史) |
| 删除单个实例(US-003) | `tasks.cancelled = TRUE`(不真删,US-003 验收要求"周期任务可单独删除某一实例而不影响后续",且保留历史) |

### 续期幂等性

客户端续期逻辑必须幂等:

```ts
// 伪代码(客户端启动时)
for (const tpl of activeTemplates) {
  const lastDate = max(tasks.task_date WHERE template_id = tpl.id)
  if (lastDate < today + 30天) {
    const newInstances = expand(tpl, lastDate + 1, today + 60天)
    await supabase.from('tasks').insert(newInstances)  // 重复插入会被 unique constraint 挡住
  }
}
```

**DB 层加 unique constraint 防止重复展开:**

```sql
ALTER TABLE tasks ADD CONSTRAINT uq_template_date
  UNIQUE (template_id, task_date);
-- (template_id IS NULL 的多次 NULL 不冲突)
```

### 模板级联更新策略

US-003 要求"周期任务可单独编辑某一实例而不影响后续",这意味着:
- **默认语义是"编辑影响所有未来未完成实例"** — 用户在编辑页改"每日吃药"任务的标题,合理预期是所有未来实例的标题都变
- **特例:已完成实例不能改** — `completed_at IS NOT NULL` 的实例字段冻结,保留历史真实性
- **特例:用户想只改一个实例** — 单独进入实例详情编辑,改 `tasks` 单行,不影响 template(也意味着该实例跟后续实例的字段可能不一致,这是有意的,符合 PRD)

---

## Consequences

### 正面

- **查询路径最简单**:"今天的任务" = `SELECT * FROM tasks WHERE family_id = $1 AND task_date = today`,无 JOIN、无 expand
- **RLS 干净**:每行 `family_id` 直接可见,policy 不需要查 `task_templates` 来确认 family
- **续期不依赖 cron**:客户端启动事件是天然触发点,MVP 不需要维护 Edge Function 定时任务
- **历史可追溯**:`completed_at`、`completed_by`、`is_makeup`、`cancelled` 都在 row 上,补卡/撤销/删除都有痕迹
- **行数可控**:单家庭 5 年才 ~2.5MB,免费档无忧
- **expand 逻辑简单**:可以纯函数式实现,在客户端(创建时)+ 续期时复用

### 负面 / 风险

- **续期不实时**:用户在离线下打开 app,不会触发续期(虽然续期函数本身不需要网络,只是检查本地缓存);但下次联网时立即补齐
- **续期函数必须幂等**:DB unique constraint 兜底,但客户端逻辑出错可能导致重复展开失败 — 需要写好错误处理
- **模板编辑的级联更新有"漏改"风险**:如果只更新 template 不级联更新实例,会出现"模板说新标题,实例显示老标题"的不一致 — 必须每次模板 UPDATE 都配套做级联 UPDATE
- **"快照" 模型下,删除模板字段后实例残留**:如果未来模板加新字段,需要做"反快照"逻辑(从实例推回 template)用于某些场景,目前未规划
- **超长周期任务初次创建开销大**:如"每年 12 月 25 日"的年任务,60 天窗口只覆盖本年内 1 次,跨年时需要续期逻辑感知

### 中性

- 数据模型相对"宽"(每行字段多),但 200 字节/行 仍属轻量
- 用 jsonb 存 `recurrence_rule` 而不是 RRULE 标准字符串,牺牲一定互操作性换取灵活度;P1 阶段如要兼容其他日历系统可重构成 RRULE
- 续期"30 天阈值"是经验值,可后续根据使用数据调整

---

## Alternatives Considered

### (b) 模板 + 懒生成

- **机制**:`task_templates` 存规则,query 时按需 expand;check-in 触发该实例行创建
- **优点**:模板字段改了自动影响全部未来;无需续期
- **否决理由**:查询路径复杂,需要写 SQL expand 函数;冷查询延迟;RLS 写起来麻烦(要决定 expand 出来的虚拟 row 算谁 family 的);失去"行即状态"的简洁性

### (c) 模板 + 调度预生成

- **机制**:模板存规则,Edge Function 定时(每天 0 点)把未来 30 天实例展开
- **优点**:跟 (a) 类似但靠调度保证完整性
- **否决理由**:需要维护 Edge Function cron job;调度挂了当天实例就不存在;MVP 阶段过度工程;客户端启动时续期已经足够

---

## References

- PRD v1.3 US-003(编辑/删除)
- PRD v1.3 US-004(设置周期任务)
- PRD v1.3 US-005(一键打卡)
- PRD v1.3 US-006(漏打卡补救)
- PRD v1.3 US-009(共同执行人)
- PRD v1.3 US-010(共享仅查看)
- PRD v1.3 G5(MVP 成功标准 — 规模假设)
- ADR-001(Supabase 后端)
- ADR-002(Anon Sign-in + `auth.uid()` RLS)
