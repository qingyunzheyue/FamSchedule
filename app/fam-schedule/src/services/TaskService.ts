/**
 * TaskService — task 业务逻辑层 — T-US001-1 + T-US003-1
 *
 * 职责(task 维度写操作 — 一次性任务;周期留 T-US004-1):
 *   1. createTask(input) — 直插 tasks 表(对应 db-v1.1.sql §3.4),RLS 守门
 *                          (family_id IN my_family_ids(),db-v1.1.sql §5.4)
 *                          一次性任务的 template_id 强制 NULL(ADR-003 决策:
 *                          一次性任务也走 tasks 行,不创建 task_templates)
 *   2. updateTask(taskId, input) — PATCH tasks 行;**仅一次性任务**
 *                          模板任务编辑本期不支持(留 T-US004-1 完成后做
 *                          模板级联);改前校验 ownership + completed/cancelled
 *                          状态。返回 discriminated union。
 *
 * 设计依据:
 *   - ADR-003(周期任务预展开):一次性任务仍写 tasks 行,只是 template_id = NULL;
 *     不创建 task_templates 行(否则 family 会多一份"周期规则"实际只触发一次的脏数据)。
 *   - ADR-005 + db-v1.1.sql §5.4:tasks INSERT/UPDATE 走 PostgREST + RLS,无需 RPC
 *     (不同于 family_members / family_settings 那种"必须服务端推 family_id"
 *      的场景,tasks.family_id 是 client 已知值)。
 *   - 单一职责:本模块只管 task 写(create + update);列表 / 打卡 / 周期
 *     模板展开分别留给 SyncManager.pullSince、SyncManager.replayQueue、
 *     TaskTemplateService(后续任务)。
 *   - sync 路径:本期不做离线入队(走 direct INSERT/UPDATE);后续 T-FIX-04
 *     可让 createTask/updateTask 改为 SyncManager.enqueueAndApply。
 *     当前 RPC 失败直接返回 failed,UI 弹「保存失败,请重试」;离线场景
 *     表现 = 失败(已知设计债,留 ticket)。
 *
 * 模块形态(对齐 FamilyService):
 *   - 模块级函数 + namespace sugar(便于 React 组件 import)
 *   - 不抛错:返回 discriminated union,UI 决定怎么显示
 *   - _resetForTests 兜底(本任务 cache 不需要,但保留导出对齐)
 *
 * Result 类型(discriminated union):
 *   - createTask:
 *       { status: 'created'; task: TaskRow }  — 成功,返回完整新 row
 *       { status: 'failed'; reason: string }  — pre-check 失败 / RPC 报错
 *   - updateTask:
 *       { status: 'updated'; task: TaskRow }  — 成功,返回完整更新后 row
 *       { status: 'failed'; reason: UpdateTaskFailureReason }  — pre-check 失败
 *         reason ∈ 'no_family' | 'not_authenticated' | 'not_owner' |
 *                  'task_completed' | 'task_cancelled' |
 *                  'template_not_supported' | <server error message>
 *
 * ⚠️ supabase-js typing quirk:.from('tasks').insert(...) 的 SDK 类型推断在
 *    Database generic 下对 nullable + DEFAULT 字段 narrow 不到位,FamilyService.ts
 *    §207 / SyncManager.ts:444 都用 `as never` cast 规避。本模块沿用同一模式。
 */

import { supabase } from '../lib/supabase';
import { getMyFamily } from './FamilyService';
import type { TaskRow } from '../types/database';

// =====================================================================
// Types
// =====================================================================

/**
 * `createTask` 入参。
 *
 * 字段范围(本任务):
 *   - title        : 必填,UI 校验已做;Service 兜底(空串 → failed)
 *   - taskDate     : 'YYYY-MM-DD',必填(后端 DB 约束 NOT NULL)
 *   - taskTime     : 'HH:MM' | null(后端按字面存,TIME 类型)
 *   - assigneeId   : user.id(UUID string),必填
 *   - description  : string | null(可选)
 *   - isSharedView : boolean,默认 false
 *
 * 未在范围(留后续任务):
 *   - coExecutorIds : 共同执行人(US-009,留 T-US009)
 *   - recurrenceRule : 周期规则(US-004,留 T-US004-1 + TaskTemplateService)
 *   - templateId    : 当前一次性任务恒 null,周期任务由模板展开路径产生 tasks 行,
 *                    不需要 client 传 templateId(留 T-US004-1)
 */
export interface CreateTaskInput {
  title: string;
  taskDate: string;
  taskTime?: string | null;
  assigneeId: string;
  description?: string | null;
  isSharedView?: boolean;
}

/** `createTask` 的结构化返回。 */
export type CreateTaskResult =
  | { status: 'created'; task: TaskRow }
  | { status: 'failed'; reason: string };

/**
 * `updateTask` 入参。
 *
 * 与 CreateTaskInput 同 shape(本期编辑不引入新字段):
 *   - title / taskDate / taskTime / assigneeId / description / isSharedView
 *
 * 故意与 CreateTaskInput **不**共用 type(避免 service 误用):
 *   - create / update 是不同语义,后续会演化不同字段(例如 create 有 family_id,
 *     update 加 patch_path 之类),分开定义更清晰。
 */
export interface UpdateTaskInput {
  title: string;
  taskDate: string;
  taskTime?: string | null;
  assigneeId: string;
  description?: string | null;
  isSharedView?: boolean;
}

/**
 * updateTask 失败 reason 的封闭集合 — 服务端语义错误(非网络/非业务)。
 *
 * - 'no_family'                 : 当前 user 不在 family 里
 * - 'not_authenticated'         : getUser 返回 null/error
 * - 'not_owner'                 : 当前 user 不是 task.created_by(防御)
 * - 'task_completed'            : task.completed_at 已设,不允许编辑
 * - 'task_cancelled'            : task.cancelled = true,不允许编辑
 * - 'template_not_supported'    : task.template_id 非空(模板任务),本期不支持编辑
 * - 'task_not_found'            : taskId 在 tasks 表里查不到(防御性)
 * - 其它(server error message)  : supabase RPC 报错原 message
 *
 * UI 翻译(T-US003-1 任务 brief §B):
 *   - not_owner / task_completed / task_cancelled → 走"不能编辑"分支
 *   - template_not_supported                     → "模板任务暂不支持编辑,请删除并重新创建"
 *   - 其它                                       → "保存失败,请重试"
 */
export type UpdateTaskFailureReason =
  | 'no_family'
  | 'not_authenticated'
  | 'not_owner'
  | 'task_completed'
  | 'task_cancelled'
  | 'template_not_supported'
  | 'task_not_found';

/** `updateTask` 的结构化返回。 */
export type UpdateTaskResult =
  | { status: 'updated'; task: TaskRow }
  | { status: 'failed'; reason: UpdateTaskFailureReason | string };

// =====================================================================
// 1. createTask
// =====================================================================

/**
 * 创建一个新的 task 行(一次性任务,template_id = NULL)。
 *
 * 流程:
 *   1. **pre-check**:getMyFamily() 必须非 null(理论上 UI:在 family 里才到这屏)
 *      - null → failed{reason: 'no_family'} 兜底
 *   2. 拿当前 `user.id`(`supabase.auth.getUser()`)
 *      - 拿不到 → failed{reason: 'not_authenticated'} 兜底
 *   3. **INSERT tasks 表**:
 *      - family_id       = familyId(从 pre-check)
 *      - title           = input.title
 *      - task_date       = input.taskDate
 *      - task_time       = input.taskTime ?? null
 *      - assignee_id     = input.assigneeId
 *      - co_executor_ids = []  ← 本任务不支持,固定空数组(US-009 后续)
 *      - is_shared_view  = input.isSharedView ?? false
 *      - created_by      = user.id
 *      - template_id     = null(ADR-003:一次性任务)
 *      - description     = input.description ?? null
 *      - is_makeup / cancelled / completed_* : 走 DB DEFAULT(false / null)
 *   4. `.select().single<TaskRow>()` 拿回完整 row(包含 DB 生成的 id / created_at / updated_at)
 *   5. 失败 → failed{reason: error.message}(不抛错)
 *
 * 不抛错:UI 拿到结构化 status 决定 retry / showError。
 *
 * ⚠️ sync 路径:本任务不接入 SyncManager.enqueueAndApply —
 *    离线 / 重连场景下 createTask 直接走 RPC,失败抛 failed;留 T-FIX-04 / T-US002-1。
 */
export async function createTask(input: CreateTaskInput): Promise<CreateTaskResult> {
  // 1. Pre-check:必须在 family 里
  const family = await getMyFamily();
  if (!family) {
    // 理论上 UI:在 family 里才到 CreateTaskScreen;这里兜底(防深链 / 直接打开)
    // eslint-disable-next-line no-console
    console.warn('[TaskService] createTask called but user has no family');
    return { status: 'failed', reason: 'no_family' };
  }
  const familyId = family.family.id;

  // 2. 拿当前 user.id
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    // eslint-disable-next-line no-console
    console.warn('[TaskService] createTask: getUser failed:', userErr?.message);
    return { status: 'failed', reason: 'not_authenticated' };
  }
  const userId = userData.user.id;

  // 3. 构造 INSERT payload
  // SDK 在 typed Database 下 narrow 有 quirk,用 `as never` cast 规避
  // (对齐 FamilyService.createFamily §194 / SyncManager.executeOnServer §442 模式)。
  //
  // ⚠️ review Major #1 防御层:`taskTime` 不仅 null/undefined 要落 null,空串 `""`
  //    也必须落 null(空串落到 Postgres TIME 列会被 server 报
  //    `invalid input syntax for type time: ""`)。
  //    主要防御是 createTaskForm.validateForm 拦截 am/pm + 空 taskTime 走 none;
  //    这里 guard 是最后一道兜底 — 即使 UI 层有 path 让 '' 漏到这里,也不写脏数据。
  const taskTime: string | null =
    input.taskTime !== undefined && input.taskTime !== null && input.taskTime !== ''
      ? input.taskTime
      : null;
  const payload = {
    family_id: familyId,
    title: input.title,
    task_date: input.taskDate,
    task_time: taskTime,
    assignee_id: input.assigneeId,
    co_executor_ids: [] as string[],
    is_shared_view: input.isSharedView ?? false,
    created_by: userId,
    template_id: null, // ADR-003:一次性任务,template_id = NULL
    description: input.description ?? null,
    // is_makeup / cancelled / completed_at / completed_by:DB DEFAULT
  };

  // 4. INSERT + SELECT 返回完整 row
  const { data, error } = await supabase
    .from('tasks')
    .insert(payload as never)
    .select()
    .single<TaskRow>();

  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[TaskService] createTask insert error:', error.message);
    return { status: 'failed', reason: error.message };
  }

  if (!data) {
    // 兜底:SDK 理论上 single() 总会返回 data 或 error;保留 explicit 防御
    // eslint-disable-next-line no-console
    console.warn('[TaskService] createTask returned no data');
    return { status: 'failed', reason: 'createTask returned no data' };
  }

  return { status: 'created', task: data };
}

// =====================================================================
// 2. updateTask — T-US003-1
// =====================================================================

/**
 * 更新一个 task 行。
 *
 * **仅一次性任务**(template_id IS NULL)支持;模板任务编辑本期不实现(留
 * T-US004-1 完成后),直接返回 `failed{reason: 'template_not_supported'}`。
 *
 * 流程:
 *   1. **pre-check**:getMyFamily() 必须非 null
 *      - null → failed{reason: 'no_family'}
 *   2. 拿当前 user.id
 *      - 失败 → failed{reason: 'not_authenticated'}
 *   3. **校验任务存在 + 状态**(pre-update check):
 *      `SELECT created_by, template_id, completed_at, cancelled FROM tasks WHERE id = ?`
 *      - 查不到 → failed{reason: 'task_not_found'}
 *      - created_by !== user.id → failed{reason: 'not_owner'}
 *      - template_id 非 null → failed{reason: 'template_not_supported'}
 *      - completed_at 非 null → failed{reason: 'task_completed'}
 *      - cancelled === true   → failed{reason: 'task_cancelled'}
 *   4. **PATCH** tasks 表:
 *      `UPDATE {title, task_date, task_time, assignee_id, description, is_shared_view} WHERE id = ?`
 *      - `.select().single<TaskRow>()` 拿回完整 row
 *      - 失败 → failed{reason: error.message}
 *   5. 成功 → `{status: 'updated', task}`
 *
 * 不抛错:UI 拿到结构化 status 决定 retry / showError。
 *
 * ⚠️ sync 路径:本任务不接入 SyncManager.enqueueAndApply — 离线场景下
 *    updateTask 直接走 RPC,失败抛 failed;留 T-FIX-04 / T-US007。
 *
 * ⚠️ NotificationScheduler.reschedule / 周期级联更新:本任务不接入。
 *    - reschedule 留 T-US007
 *    - 模板级联留 T-US004-1
 */
export async function updateTask(
  taskId: string,
  input: UpdateTaskInput,
): Promise<UpdateTaskResult> {
  // 1. Pre-check:必须在 family 里
  const family = await getMyFamily();
  if (!family) {
    // eslint-disable-next-line no-console
    console.warn('[TaskService] updateTask called but user has no family');
    return { status: 'failed', reason: 'no_family' };
  }

  // 2. 拿当前 user.id
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    // eslint-disable-next-line no-console
    console.warn('[TaskService] updateTask: getUser failed:', userErr?.message);
    return { status: 'failed', reason: 'not_authenticated' };
  }
  const userId = userData.user.id;

  // 3. 校验任务存在 + ownership + 状态
  const { data: existing, error: fetchErr } = await supabase
    .from('tasks')
    .select('created_by, template_id, completed_at, cancelled')
    .eq('id', taskId)
    .single<Pick<TaskRow, 'created_by' | 'template_id' | 'completed_at' | 'cancelled'>>();

  if (fetchErr) {
    // eslint-disable-next-line no-console
    console.warn('[TaskService] updateTask: fetch existing error:', fetchErr.message);
    return { status: 'failed', reason: fetchErr.message };
  }
  if (!existing) {
    return { status: 'failed', reason: 'task_not_found' };
  }
  if (existing.created_by !== userId) {
    // eslint-disable-next-line no-console
    console.warn('[TaskService] updateTask: not owner (created_by != user.id)');
    return { status: 'failed', reason: 'not_owner' };
  }
  if (existing.template_id !== null) {
    // 模板任务 → 本期不支持
    return { status: 'failed', reason: 'template_not_supported' };
  }
  if (existing.completed_at !== null) {
    return { status: 'failed', reason: 'task_completed' };
  }
  if (existing.cancelled === true) {
    return { status: 'failed', reason: 'task_cancelled' };
  }

  // 4. 防御性 normalize:taskTime 空串 → null(同 createTask Major #1)
  const taskTime: string | null =
    input.taskTime !== undefined && input.taskTime !== null && input.taskTime !== ''
      ? input.taskTime
      : null;
  const payload = {
    title: input.title,
    task_date: input.taskDate,
    task_time: taskTime,
    assignee_id: input.assigneeId,
    description: input.description ?? null,
    is_shared_view: input.isSharedView ?? false,
  };

  const { data, error } = await supabase
    .from('tasks')
    .update(payload as never)
    .eq('id', taskId)
    .select()
    .single<TaskRow>();

  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[TaskService] updateTask update error:', error.message);
    return { status: 'failed', reason: error.message };
  }
  if (!data) {
    // 兜底:SDK 理论上 single() 总会返回 data 或 error
    // eslint-disable-next-line no-console
    console.warn('[TaskService] updateTask returned no data');
    return { status: 'failed', reason: 'updateTask returned no data' };
  }

  return { status: 'updated', task: data };
}

// =====================================================================
// 3. 测试 / 调试出口
// =====================================================================

/**
 * 仅供测试 / debug 用。生产 bundle 仍会保留,但业务侧不应调用。
 *
 * 当前 TaskService 没有 module-level 状态(每次 RPC 都 single shot),
 * 此函数仅为对齐 FamilyService / SyncManager / AuthService 接口一致性
 * 而保留 — 后续若加 cache 或 dedup,直接在此实现重置。
 */
export function _resetForTests(): void {
  // no-op: TaskService 暂无 module-level state
}

// =====================================================================
// 4. TaskService namespace(UI 层 sugar 入口)
// =====================================================================

/**
 * `TaskService` namespace — 把模块级函数包装成对象,便于 UI 层 import。
 *
 * 与 FamilyService 同模式:UI 走 `TaskService.createTask()` 调用,
 * 测试 / 单函数调用方走命名 export(`import { createTask } from ...`)。
 */
export const TaskService = {
  createTask,
  updateTask,
};