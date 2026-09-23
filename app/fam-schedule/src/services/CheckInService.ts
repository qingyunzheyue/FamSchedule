/**
 * CheckInService — 一键打卡 service — T-US005-1
 *
 * 职责(task 维度打卡写操作 — 一次性 + 周期任务统一入口):
 *   1. checkin(taskId, isMakeup) → 调 RPC `checkin_task`(US-005 主线入口)
 *   2. 不直接调 `supabase.rpc` — 走 SyncManager.enqueueAndApply(ADR-005 契约)
 *      - 走 SyncManager 让"乐观更新 + 离线入队 + Realtime 兜底"全部由 SyncManager
 *        现有基础设施负责(Lineage: T-SETUP-6 已就绪 — applyOptimisticUpdate line 409-420
 *        + executeOnServer line 512-521)
 *      - 我们只负责 pre-check + 调度;不重新发明 SyncManager 已有的乐观 / 队列
 *
 * 设计依据:
 *   - ADR-005(Server 权威 + 行级 LWW + Check-in 幂等):first-finisher wins
 *   - db-v1.1.sql §4.5 + §4.6(US-005 详细 RPC 签名):
 *     `checkin_task(p_task_id UUID, p_is_makeup BOOLEAN DEFAULT false)`
 *     — 本任务统一传 `p_is_makeup=false`(补卡入口留 T-US006)
 *   - ADR-005 写顺序(line 28-31):
 *     `checkin / undo_checkin → supabase.rpc()(原子 SQL)`
 *     `create_task / update_task / delete_task → supabase.from() (RLS 守门)`
 *   - 离线路径:enqueueAndApply 内部把 mutation 入队 + 在线时立即 replay,
 *     离线打卡时入队后返回成功(乐观),网络恢复由 SyncManager 自动 replay。
 *
 * 模块形态(对齐 TaskService + FamilyService):
 *   - 模块级函数 + namespace sugar(便于 React 组件 import)
 *   - 不抛错:返回 discriminated union,UI 决定怎么显示
 *   - _resetForTests 兜底(本 service cache 不需要,但保留导出对齐)
 *
 * Result 类型(discriminated union):
 *   checkin:
 *     { status: 'checked_in'; taskId; completedAt; completedBy; isMakeup }  — 成功
 *     { status: 'failed'; reason: CheckInFailureReason }  — pre-check 失败 / 兜底失败
 *
 * ⚠️ 关键约束:本服务**不**直接调 supabase.rpc — 走 SyncManager.enqueueAndApply。
 *   这是 ADR-005 的契约(line 28-31):checkin / undo_checkin 走 RPC(原子 SQL)必须经
 *   SyncManager queue 走(才能离线时入队、网络恢复时 replay),不能旁路。
 *   任何"为了简单直接调 RPC"的诱惑都视为合约破坏。
 *
 * ⚠️ 不接 0 行处理 — RPC 0 行(first-finisher 已 done)由 Realtime 自然校正;
 *   本服务不主动 fetch 单 task。配偶先完成的 toast/alert 留 T-US005-2。
 */

import { supabase } from '../lib/supabase';
import { enqueueAndApply } from '../lib/SyncManager';
import { getTasks, type Task } from '../lib/LocalStore';
import { getMyFamily } from './FamilyService';
import type { TaskRow } from '../types/database';

// =====================================================================
// 1. Types
// =====================================================================

/**
 * `checkin` 失败 reason 的封闭集合 — 服务端语义错误(非网络/非业务)。
 *
 * - 'not_authenticated' : getUser 返回 null/error
 * - 'no_family'         : 当前 user 不在 family 里(防御)
 * - 'task_not_found'    : taskId 在 tasks 表里查不到(Select 行不存在)
 * - 'cancelled'         : task.cancelled = true(防御 — UI 也应不显示,但留下兜底)
 * - 'rls_denied'        : Select error 含 'rls' / 'policy' / 'row-level security'
 * - 'unknown'           : Select error(其它)/ 兜底
 *
 * UI 翻译(createTaskForm.mapCheckInFailureReason):
 *   - not_authenticated → "请先登录"
 *   - no_family         → "你还没加入家庭"
 *   - task_not_found    → "任务不存在或已被删除"
 *   - cancelled         → "任务已取消,无法打卡"
 *   - rls_denied        → "没有打卡权限"
 *   - unknown           → "打卡失败,请重试"
 *
 * ⚠️ 与 TaskService 的差异:
 *   - 打卡**不**要求 created_by === user.id(共同执行人 / 配偶互打场景,留 T-US009 后接)
 *   - 因此没有 'not_owner' 这个 reason
 *   - 也没有 'template_not_supported'(模板任务的 instance 也可打卡)
 *   - 也没有 'task_completed'(已 completed_at → 走幂等返回,不算失败)
 *
 * ⚠️ 'task_completed' 不入失败集合:
 *   - task 已 completed → 视为"再次打卡,已打到,这是 idempotent 成功"
 *   - 返回 { status: 'checked_in', ... } 给 UI(乐观 UI 不变),不报错
 *   - 真正的 first-finisher 0 行由 Realtime channel 兜底(不在本 service 处理)
 */
export type CheckInFailureReason =
  | 'not_authenticated'
  | 'no_family'
  | 'task_not_found'
  | 'cancelled'
  | 'rls_denied'
  | 'unknown';

/** `checkin` 的结构化返回。 */
export type CheckInResult =
  | {
      status: 'checked_in';
      taskId: string;
      completedAt: string;
      completedBy: string;
      isMakeup: boolean;
    }
  | { status: 'failed'; reason: CheckInFailureReason };

// =====================================================================
// 2. checkin — 一键打卡(主线入口)
// =====================================================================

/**
 * 一键打卡 — 调 `checkin_task` RPC。
 *
 * 流程:
 *   1. **pre-check**:getMyFamily() 必须非 null
 *      - null → failed{reason: 'no_family'} 兜底
 *   2. 拿当前 `user.id`(`supabase.auth.getUser()`)
 *      - 失败 → failed{reason: 'not_authenticated'} 兜底
 *   3. **预读 task 状态**:`SELECT id, cancelled, completed_at, completed_by, is_makeup
 *      FROM tasks WHERE id = ?`(同 TaskService.deleteTask 的防御式 SELECT)
 *      - error 含 'rls' / 'policy' → failed{reason: 'rls_denied'}
 *      - 其它 error → failed{reason: 'unknown'}
 *      - data = null(无错误) → failed{reason: 'task_not_found'}
 *      - data.cancelled = true → failed{reason: 'cancelled'}
 *      - data.completed_at 已设 → 幂等返回 checked_in(不调 RPC / 不入队,
 *        任务已打卡属于成功而非失败)
 *   4. **enqueueAndApply**({kind: 'checkin', taskId, isMakeup: false, queuedAt:
 *      Date.now()}):
 *      - 走 SyncManager enqueueAndApply 触发:
 *        a) applyOptimisticUpdate:LocalStore.tasks 立即标记 completed_at(用户视觉)
 *        b) enqueueMutation:写入 AsyncStorage FIFO queue(供离线时 replay)
 *        c) isOnline → 立即 replayQueue:executeOnServer → supabase.rpc('checkin_task')
 *      - 任意内部错误由 SyncManager 自身 swallow + console.warn(契约 line 23-24)
 *   5. **乐观检查**(replay 不阻塞 UI):读 LocalStore.getTasks() — task.completed_at 已被
 *      applyOptimisticUpdate 写入(同步 setTasksAndNotify 在 enqueueAndApply 入口同步路径)
 *      - 找到 completed_at → checked_in success
 *      - 找不到 → failed{reason: 'unknown'}(兜底 — 理论上几乎不发生,除非 race condition)
 *
 * ⚠️ sync 路径:复用了 SyncManager.enqueueAndApply 已实现的 offline 入队 + replay,
 *    本任务不再独立写 offline 兜底(reviewer 历史反馈点)。
 *
 * ⚠️ 0 行处理 / 配偶先完成:
 *    - 服务端 RPC 0 行(已 first-finisher complete)不会主动告知客户端
 *    - Realtime channel 已订阅 `tasks` 表(SyncManager line 222-230)→ UPDATE event 自动
 *      合并到 LocalStore→useTasks() 重新渲染→UI 显示 spouse_completed 态
 *    - 本 service 不主动 refetch 也不主动弹 toast(0 行处理留 T-US005-2)
 *
 * @param taskId    — 目标 task.id(UUID)
 * @param isMakeup  — 是否为补卡(本任务固定 false;T-US006 接入时改 signature 调 true);
 *                    默认 false 保持本期 API 最小面
 */
export async function checkin(
  taskId: string,
  isMakeup: boolean,
): Promise<CheckInResult>;
export async function checkin(taskId: string): Promise<CheckInResult>;
export async function checkin(taskId: string, isMakeup: boolean = false): Promise<CheckInResult> {
  // 1. Pre-check:必须在 family 里
  const family = await getMyFamily();
  if (!family) {
    // eslint-disable-next-line no-console
    console.warn('[CheckInService] checkin called but user has no family');
    return { status: 'failed', reason: 'no_family' };
  }

  // 2. 拿当前 user.id
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    // eslint-disable-next-line no-console
    console.warn('[CheckInService] checkin: getUser failed:', userErr?.message);
    return { status: 'failed', reason: 'not_authenticated' };
  }

  // 3. 预读 task 状态(防御 — 避免 enqueue 后才发现任务 cancelled/已 completed)
  type PreCheckRow = Pick<
    TaskRow,
    'id' | 'cancelled' | 'completed_at' | 'completed_by' | 'is_makeup'
  >;
  const { data: row, error: fetchErr } = await supabase
    .from('tasks')
    .select('id, cancelled, completed_at, completed_by, is_makeup')
    .eq('id', taskId)
    .maybeSingle<PreCheckRow>();

  if (fetchErr) {
    // eslint-disable-next-line no-console
    console.warn('[CheckInService] checkin: fetch task error:', fetchErr.message);
    if (
      fetchErr.message.includes('rls') ||
      fetchErr.message.includes('policy') ||
      fetchErr.message.includes('row-level security')
    ) {
      return { status: 'failed', reason: 'rls_denied' };
    }
    return { status: 'failed', reason: 'unknown' };
  }

  if (!row) {
    return { status: 'failed', reason: 'task_not_found' };
  }

  if (row.cancelled === true) {
    return { status: 'failed', reason: 'cancelled' };
  }

  if (row.completed_at !== null && row.completed_at !== undefined) {
    // 已完成 → 幂等成功(不调 RPC / 不入队;后续 Realtime 自动校正)
    return {
      status: 'checked_in',
      taskId: row.id,
      completedAt: row.completed_at,
      completedBy: row.completed_by ?? '',
      isMakeup: row.is_makeup,
    };
  }

  // 4. 调 SyncManager.enqueueAndApply(乐观更新 + 入队 + 在线触发 replay)
  //
  // AD-005 契约:checkin 必须走 SyncManager(不能旁路 supabase.rpc)— 否则破坏
  // 离线写队列。enqueueAndApply 内部:
  //   - applyOptimisticUpdate:LocalStore.tasks set completed_at(已完成结构同 user.id)
  //     注意:applyOptimisticUpdate 用 'me' 占位 completed_by,后续 Realtime 校正
  //   - enqueueMutation:写 AsyncStorage FIFO queue
  //   - isOnline → replayQueue → executeOnServer → supabase.rpc('checkin_task',
  //     { p_task_id: taskId, p_is_makeup: isMakeup })
  await enqueueAndApply({
    kind: 'checkin',
    taskId,
    isMakeup,
    queuedAt: Date.now(),
  });

  // 5. 乐观检查:enqueueAndApply 已同步写 cache(applyOptimisticUpdate 内 setTasksAndNotify);
  //    此时 LocalStore 中该 task 应该已 completed_at 标记。读取 cache 拿最新值。
  const cached = await getTasks();
  const updated = cached.find((t: Task) => t.id === taskId);
  if (updated && updated.completed_at !== null) {
    return {
      status: 'checked_in',
      taskId: updated.id,
      completedAt: updated.completed_at,
      // 乐观态用 'me' 占位(同 applyOptimisticUpdate 行为);realtime 校正时由
      // server 真实 user.id 覆盖(通常是 userData.user.id 但我们不直接 leak)
      completedBy: updated.completed_by ?? userData.user.id,
      isMakeup: updated.is_makeup ?? isMakeup,
    };
  }

  // 兜底:applyOptimisticUpdate 在 LocalStore 没找到 task(罕见 race / cache miss)
  // eslint-disable-next-line no-console
  console.warn('[CheckInService] checkin: task not in cache after enqueueAndApply');
  return { status: 'failed', reason: 'unknown' };
}

// =====================================================================
// 3. 测试 / 调试出口
// =====================================================================

/**
 * 仅供测试 / debug 用。生产 bundle 仍会保留,但业务侧不应调用。
 *
 * 当前 CheckInService 没有 module-level 状态(每次入队都 sync 转发到 SyncManager),
 * 此函数仅为对齐 FamilyService / SyncManager / AuthService / TaskService 接口一致性
 * 而保留 — 后续若加 cache 或 dedup,直接在此实现重置。
 */
export function _resetForTests(): void {
  // no-op: CheckInService 暂无 module-level state
}

// =====================================================================
// 4. CheckInService namespace(UI 层 sugar 入口)
// =====================================================================

/**
 * `CheckInService` namespace — 把模块级函数包装成对象,便于 UI 层 import。
 *
 * 与 TaskService 同模式:UI 走 `CheckInService.checkin(...)` 调用,
 * 测试 / 单函数调用方走命名 export(`import { checkin } from ...`)。
 */
export const CheckInService = {
  checkin,
};
