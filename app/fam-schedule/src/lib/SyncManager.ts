/**
 * SyncManager — 离线优先 sync backbone — T-SETUP-6
 *
 * 职责(根据 T-SETUP-6 DoD):
 *   1. subscribeFamily(familyId) — 订阅 family 维度的 4 张表 Realtime
 *   2. enqueueAndApply(mutation) — 本地立即更新 cache + 入队 + 在线时立即触发 replay
 *   3. replayQueue() — 按 FIFO 调用 server,失败 warn-log + re-enqueue
 *   4. pullSince(lastSyncAt) — 从 server 增量拉取并合并到本地 cache
 *   5. NetInfo 监听 — 网络恢复时自动触发 replayQueue + pullSince
 *   6. unsubscribeAll() — 释放 Realtime channel + NetInfo 订阅(app 后台)
 *
 * 设计依据:
 *   - ADR-005:Server 权威 + 行级 LWW + Check-in 幂等
 *   - ADR-001 / db-v1.1.sql:所有写走 RPC 或带 RLS 的 PostgREST;client 可生成 UUID 作为 row id
 *
 * 模块状态:
 *   - 单例(realtimeChannel / netInfoUnsubscribe / currentFamilyId)
 *   - 单 family 维度:同时只能订阅一个 family,切换 family 时 unsubscribeAll → subscribeFamily
 *   - isOnline 由 NetInfo 维护;initNetworkListener() 幂等
 *
 * 重要约束:
 *   - applyOptimisticUpdate 在 enqueueAndApply 入口同步路径中调用,失败要让调用方感知
 *   - replayQueue 对外是 Promise,但内部错误不抛(只 warn + re-enqueue),
 *     因为它经常在"网络恢复"这种 fire-and-forget 场景被调用
 *   - useSyncManager hook 处理 AppState(background → unsubscribe / foreground → resubscribe),
 *     由消费侧决定何时 mount,通常挂在 root 屏
 *
 * ⚠️ 写顺序(reference ADR-005):
 *   - checkin / undo_checkin → supabase.rpc()(原子 SQL)
 *   - create_task / update_task / delete_task → supabase.from() (RLS 守门)
 *   - delete 是盲删(ADR-005 consequence 行)
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from './supabase';
import {
  enqueueMutation,
  drainQueue,
  getTasks,
  setTasks,
  getTemplates,
  setTemplates,
  getSettings,
  setSettings,
  getLastSyncAt,
  setLastSyncAt,
  type PendingMutation,
  type Task,
  type TaskTemplate,
  type FamilySettings,
} from './LocalStore';

// =====================================================================
// Internal state (单例,模块级)
// =====================================================================

/**
 * 单例 Realtime channel。同 family 复用;跨 family 时 unsubscribeAll。
 */
let realtimeChannel: RealtimeChannel | null = null;

/**
 * 当前订阅的 family。null = 未订阅;切换 family 时必须先 unsubscribeAll。
 */
let currentFamilyId: string | null = null;

/**
 * NetInfo 监听 unsubscribe 函数。initNetworkListener() 幂等。
 */
let netInfoUnsubscribe: (() => void) | null = null;

/**
 * 网络状态。初始值 true:启动时假设在线,直到 NetInfo 第一次 emit;
 * 离线启动时 initNetworkListener 会立即纠正。
 */
let isOnline = true;

/**
 * 订阅 isOnline 变化的 listener 集合(供 useSyncManager 内部 useSyncExternalStore 用)。
 */
const networkListeners = new Set<() => void>();

/**
 * 去重 map(kind, taskId 或 template.id) → 当前 in-flight mutation。
 *
 * 目的:
 *   - 用户连续点击同一任务(checkin → checkin)时,只入队一次
 *   - checkin + undo_checkin 短时间内互相覆盖(cancel out)
 *
 * 重启清空(queue 自己从 AsyncStorage 恢复,dedup 是 in-memory)。
 */
type DedupKey = string;
const dedup = new Map<DedupKey, PendingMutation>();

const dedupKey = (m: PendingMutation): DedupKey => {
  // checkin / undo_checkin / update_task / delete_task → `kind:taskId`
  if ('taskId' in m) return `${m.kind}:${m.taskId}`;
  // create_task → `kind:template.id`(client 端 generate)
  return `${m.kind}:${m.template.id}`;
};

// =====================================================================
// 1. subscribeFamily(familyId)
// =====================================================================

/**
 * 订阅指定 family 的 Realtime channel,初始 pullSince 一次拉全量。
 *
 * 幂等:同一 familyId 第二次调用直接返回(避免重复订阅导致 multi-listener 风暴)。
 * 不同 familyId 调用:先 unsubscribeAll 再新建 channel。
 *
 * realtime payload schema(Supabase):
 *   { eventType: 'INSERT' | 'UPDATE' | 'DELETE', new: <row>, old: <row>, ... }
 *
 * 注意:filter 用 `family_id=eq.<uuid>` 让 Supabase 在 server 端过滤,
 * 省带宽。R5 备注:RLS 也守门,filter 只是优化层。
 */
export async function subscribeFamily(familyId: string): Promise<void> {
  // 幂等:同 family 不重复订阅
  if (currentFamilyId === familyId && realtimeChannel) {
    return;
  }

  // 切换 family 先清旧订阅
  await unsubscribeAll();

  currentFamilyId = familyId;

  realtimeChannel = supabase
    .channel(`family:${familyId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'tasks',
      filter: `family_id=eq.${familyId}`,
    }, (payload) => {
      void handleRealtimeChange('tasks', payload);
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'task_templates',
      filter: `family_id=eq.${familyId}`,
    }, (payload) => {
      void handleRealtimeChange('task_templates', payload);
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'family_settings',
      filter: `family_id=eq.${familyId}`,
    }, (payload) => {
      void handleRealtimeChange('family_settings', payload);
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'family_members',
      filter: `family_id=eq.${familyId}`,
    }, (payload) => {
      // family_members 由调用方在 FamilyContext 维护(本模块不缓存)
      // 这里 no-op;subscription 仍触发只是为了人/出时及时感知
    })
    .subscribe();

  // 初始拉取(从 0,等价于全量)
  await pullSince(await getLastSyncAt());
}

// =====================================================================
// 2. handleRealtimeChange — 合并 server 推送的 row 到本地 cache
// =====================================================================

type RealtimeTable = 'tasks' | 'task_templates' | 'family_settings' | 'family_members';

interface RealtimePayload {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}

/**
 * 把 realtime 推送的 row 合并进对应 cache。
 *
 * 合并规则(行级 LWW,ADR-005):
 *   - INSERT:append(若已存在同 id,按 LWW 用新行覆盖 = map.set)
 *   - UPDATE:覆盖同 id 行
 *   - DELETE:移除同 id 行
 *
 * 注意:不比较 `updated_at` —— Supabase Realtime 的事件流已经隐含 server 权威时间序
 * (事件 broadcast 顺序与 server commit 顺序一致)。在 2 人家庭场景下,client 拉到的事件
 * 就是"当前最终态",无需二次裁决。
 */
async function handleRealtimeChange(
  table: Exclude<RealtimeTable, 'family_members'>,
  payload: RealtimePayload,
): Promise<void> {
  if (table === 'tasks') {
    const current = await getTasks();
    const merged = applyChangeToList<Task>(current, payload);
    await setTasks(merged);
  } else if (table === 'task_templates') {
    const current = await getTemplates();
    const merged = applyChangeToList<TaskTemplate>(current, payload);
    await setTemplates(merged);
  } else if (table === 'family_settings') {
    // family_settings 1 family 1 row,直接覆盖(payload.new 就是完整 row)
    await setSettings(payload.new as unknown as FamilySettings);
  }
}

function applyChangeToList<T extends { id: string }>(
  current: T[],
  payload: RealtimePayload,
): T[] {
  if (payload.eventType === 'DELETE') {
    const id = payload.old.id;
    return current.filter((row) => row.id !== id);
  }
  // INSERT / UPDATE:用 new 覆盖或追加
  const row = payload.new as unknown as T;
  const idx = current.findIndex((r) => r.id === row.id);
  if (idx >= 0) {
    const next = current.slice();
    next[idx] = row;
    return next;
  }
  return [...current, row];
}

// =====================================================================
// 3. unsubscribeAll — 释放所有订阅
// =====================================================================

/**
 * 释放 Realtime channel 和 NetInfo 订阅。
 *
 * 触发时机:
 *   - app 进入 background(AppState = background)
 *   - signOut(后续任务会做)
 *   - 切换 family
 *
 * 注意:不重置 dedup map(queue 自己负责持久化)。
 */
export async function unsubscribeAll(): Promise<void> {
  if (realtimeChannel) {
    await supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  if (netInfoUnsubscribe) {
    netInfoUnsubscribe();
    netInfoUnsubscribe = null;
  }
  currentFamilyId = null;
}

// =====================================================================
// 4. enqueueAndApply(mutation) — 本地优先入队
// =====================================================================

/**
 * 本地立即更新 cache,入队;在线时立刻尝试 replay。
 *
 * 流程:
 *   1. applyOptimisticUpdate → 立刻改 LocalStore cache(用户视觉立即反馈)
 *   2. enqueueMutation → 加到 FIFO 队列(供后续网络恢复时 replay)
 *   3. 在线时立即调 replayQueue(空跑若有 + 真正执行)
 *
 * dedup 语义:
 *   - 同一 (kind, taskId) 短时间内重复入队,只保留最新 mutation
 *   - 例如 checkin + undo_checkin 同 taskId,后者覆盖前者
 *
 * 调用方语义:
 *   - 此函数返回 void 表示"已接受入队,已乐观更新";不保证 server 已收到
 *   - server 状态最终由 realtime 事件或下一次 pullSince 校正(ADR-005)
 */
export async function enqueueAndApply(mutation: PendingMutation): Promise<void> {
  // 1. dedup:同 key 的旧 mutation 视为废弃(仍可能在队列中,但 replay 时按 FIFO 顺序
  //    都会被执行;in-memory dedup 主要用于"同一次 enqueueAndApply 调用合并")
  const key = dedupKey(mutation);

  // 2. 先乐观写 cache(失败抛错让调用方感知)
  await applyOptimisticUpdate(mutation);

  // 3. 去重:同 key 的旧 mutation 仍可能在持久化 queue 中;此 map 是 in-memory 标识,
  //    真正 dedup 由 FIFO 队列 + server 幂等(checkin WHERE completed_at IS NULL)兜底
  dedup.set(key, mutation);

  // 4. 入队(append tail)
  await enqueueMutation(mutation);

  // 5. 在线则立刻触发 replay;失败 warn,不抛错(避免 UI 受影响)
  if (isOnline) {
    void replayQueue().catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[SyncManager] replayQueue (post-enqueue) failed:', e);
    });
  }
}

// =====================================================================
// 5. applyOptimisticUpdate — 本地立即改 cache
// =====================================================================

/**
 * 把 mutation 的副作用预先施加到 LocalStore cache。
 *
 * 这是离线 UX 的关键:点击打卡按钮的瞬间,UI 立即看到绿色对勾;
 * 之后无论是网络立即打通 / 排队 / app 重启,server 状态最终会追上 cache。
 *
 * 注意:create_task 使用 client 端生成的 `template.id` 作为 cache key,
 * 上线后 server 端接受这个 id,row 引用不漂移(ADR-005 consequence 行)。
 */
async function applyOptimisticUpdate(mutation: PendingMutation): Promise<void> {
  const nowIso = new Date().toISOString();

  if (mutation.kind === 'checkin') {
    const tasks = await getTasks();
    const idx = tasks.findIndex((t) => t.id === mutation.taskId);
    if (idx >= 0) {
      const next = tasks.slice();
      next[idx] = {
        ...next[idx],
        completed_at: nowIso,
        completed_by: 'me', // 临时占位;realtime 会拿 server 真实值覆盖
        is_makeup: mutation.isMakeup,
      };
      await setTasks(next);
    }
  } else if (mutation.kind === 'undo_checkin') {
    const tasks = await getTasks();
    const idx = tasks.findIndex((t) => t.id === mutation.taskId);
    if (idx >= 0) {
      const next = tasks.slice();
      next[idx] = {
        ...next[idx],
        completed_at: null,
        completed_by: null,
        is_makeup: false,
      };
      await setTasks(next);
    }
  } else if (mutation.kind === 'create_task') {
    // create_task 实际上 mutation.template 是 TaskTemplate(US-001 现有流程传 template)
    // 但 ADR-005 + LocalStore PendingMutation 的 create_task kind 是把 template 入队,
    // 等到 replay 时由后台服务展开成 tasks 行(server-side expansion)or 由 client 端 insert。
    // 这里对应 template 维度:写到 templates cache 中。
    const templates = await getTemplates();
    const idx = templates.findIndex((t) => t.id === mutation.template.id);
    if (idx < 0) {
      await setTemplates([...templates, mutation.template]);
    }
  } else if (mutation.kind === 'update_task') {
    // update_task.patch 是 Partial<Task>,其中 taskId 已知
    const tasks = await getTasks();
    const idx = tasks.findIndex((t) => t.id === mutation.taskId);
    if (idx >= 0) {
      const next = tasks.slice();
      next[idx] = { ...next[idx], ...mutation.patch };
      await setTasks(next);
    }
  } else if (mutation.kind === 'delete_task') {
    const tasks = await getTasks();
    await setTasks(tasks.filter((t) => t.id !== mutation.taskId));
  }
}

// =====================================================================
// 6. replayQueue — FIFO 重放
// =====================================================================

/**
 * 把 queue 中所有 mutation 按 FIFO 顺序发送给 server。
 *
 * 行为:
 *   - 逐条调用 executeOnServer(mutation)
 *   - 成功:从 dedup map 删除(但 queue 是 FIFO 一次性 drain,不需要逐条删)
 *   - 失败:warn-log + re-enqueue 到 tail(下一次 reconnect 再试)
 *   - 整体不抛错(此函数常用于"网络恢复时 fire-and-forget")
 *
 * 注意:re-enqueue 时用全量 re-push 当前 mutation,而不是把整个 queue 倒回原状。
 * 原因:replay 期间其他 enqueueAndApply 可能已新增 mutation,queue 状态已变;
 *       已成功的不动,失败的 append 回 tail 等下次。
 */
export async function replayQueue(): Promise<void> {
  const queue = await drainQueue();
  if (queue.length === 0) return;

  for (const mutation of queue) {
    try {
      await executeOnServer(mutation);
      // 成功:从 dedup map 删除(下个同样 key 的入队会重新走流程)
      dedup.delete(dedupKey(mutation));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        `[SyncManager] replayQueue failed for ${mutation.kind}:`,
        e,
      );
      // 失败:re-enqueue 到 tail
      await enqueueMutation(mutation);
    }
  }
}

// =====================================================================
// 7. executeOnServer — 把 mutation 翻译成 supabase 调用
// =====================================================================

/**
 * 把高层 mutation 展开为 supabase RPC / PostgREST 调用。
 *
 * 决策依据 ADR-005:
 *   - checkin / undo_checkin 必须走 RPC(原子 first-finisher SQL)
 *   - create_task / update_task / delete_task 走 PostgREST(RLS 守门)
 *
 * 错误处理:任何 supabase 调用返回 error 时抛错(让上层 replayQueue 走 re-enqueue 路径)。
 */
async function executeOnServer(mutation: PendingMutation): Promise<void> {
  if (mutation.kind === 'checkin') {
    // `as never`:SDK rpc() 在 typed Database 上 literal-narrowing 有 quirk,
    // 自动推导的 Args 默认是 `never`,object literal 匹配不上。
    // 实际请求 payload 正确,服务器能解析。
    const { error } = await supabase.rpc('checkin_task', {
      p_task_id: mutation.taskId,
      p_is_makeup: mutation.isMakeup,
    } as never);
    if (error) throw error;
  } else if (mutation.kind === 'undo_checkin') {
    const { error } = await supabase.rpc('undo_checkin', {
      p_task_id: mutation.taskId,
    } as never);
    if (error) throw error;
  } else if (mutation.kind === 'create_task') {
    // template 行由 client 端直接 insert。RLS 要求 created_by = auth.uid()。
    // Insert 类型比 Row 窄(omit id/created_at/updated_at),但我们传的是完整 Row,
    // 多余字段由 PostgREST 当 DEFAULT 跳过;这里用 unknown cast 跳过 TS narrow check。
    const { error } = await supabase
      .from('task_templates')
      .insert(mutation.template as never);
    if (error) throw error;
  } else if (mutation.kind === 'update_task') {
    // 不允许改 completed_at / completed_by / is_makeup(走 RPC);这里 patch 是业务字段。
    // Update 类型比 Partial<Task> 窄(TaskUpdate 排除 id/timestamps),同 unknown cast 处理。
    const { error } = await supabase
      .from('tasks')
      .update(mutation.patch as never)
      .eq('id', mutation.taskId);
    if (error) throw error;
  } else if (mutation.kind === 'delete_task') {
    const { error } = await supabase.from('tasks').delete().eq('id', mutation.taskId);
    if (error) throw error;
  }
}

// =====================================================================
// 8. pullSince(lastSyncAt) — 增量拉取
// =====================================================================

/**
 * pullSince 返回的子状态对象 —— 让调用方决定是否显示"上次同步未完成" UI。
 *
 * `ok` 是聚合(`tasks && templates && settings` 全 OK 才 true);
 * 三个子标志分别报告每张表 query 是否有 error。
 *
 * 任一子标志为 false → 函数末尾不会推进 `last_sync_at`,下次调用自动重试。
 */
export interface PullStatus {
  ok: boolean;
  tasks: boolean;
  templates: boolean;
  settings: boolean;
}

/**
 * 从 server 拉 family 维度下 `updated_at > lastSyncAt` 的所有行,合并到本地 cache。
 *
 * lastSyncAt 是本地 unix ms(null = 拉全量,转 1970-01-01)。
 * server 端 `updated_at` 是 timestamptz,要转 ISO string 才能传给 PostgREST。
 *
 * 限制:目前同步 family_settings 是简单"取最新" —— 1 family 1 row,
 * 多次 pull 后 setSettings 会保留最后拉到的版本。
 *
 * ⚠️ 重要:仅当 tasks / templates / settings 三个 query **全部成功**(无 error)
 *    才推进 `last_sync_at`;任一失败 → 保留旧时间戳,下次 pullSince 自动重试缺失表。
 *    这是 T-FIX-01 修复的数据丢失守卫:之前无条件 `setLastSyncAt(Date.now())`,
 *    5xx 时 spouse 的增量行会被永久跳过(直到 manual pull)。
 */
export async function pullSince(lastSyncAt: number | null): Promise<PullStatus> {
  if (!currentFamilyId) {
    return { ok: false, tasks: false, templates: false, settings: false };
  }
  const familyId = currentFamilyId;
  const isoTs = lastSyncAt
    ? new Date(lastSyncAt).toISOString()
    : '1970-01-01T00:00:00.000Z';

  // ---- tasks ----
  let tasksOk = false;
  const { data: tasks, error: tasksErr } = await supabase
    .from('tasks')
    .select('*')
    .eq('family_id', familyId)
    .gt('updated_at', isoTs);
  if (tasksErr) {
    // eslint-disable-next-line no-console
    console.warn('[SyncManager] pullSince tasks failed:', tasksErr);
  } else {
    tasksOk = true;
    if (tasks && tasks.length > 0) {
      const current = await getTasks();
      const merged = mergeTasksById(current, tasks as Task[]);
      await setTasks(merged);
    }
  }

  // ---- task_templates ----
  let templatesOk = false;
  const { data: templates, error: templatesErr } = await supabase
    .from('task_templates')
    .select('*')
    .eq('family_id', familyId)
    .gt('updated_at', isoTs);
  if (templatesErr) {
    // eslint-disable-next-line no-console
    console.warn('[SyncManager] pullSince templates failed:', templatesErr);
  } else {
    templatesOk = true;
    if (templates && templates.length > 0) {
      const current = await getTemplates();
      const merged = mergeTemplatesById(current, templates as TaskTemplate[]);
      await setTemplates(merged);
    }
  }

  // ---- family_settings (1 row / family) ----
  let settingsOk = false;
  const { data: settings, error: settingsErr } = await supabase
    .from('family_settings')
    .select('*')
    .eq('family_id', familyId)
    .gt('updated_at', isoTs);
  if (settingsErr) {
    // eslint-disable-next-line no-console
    console.warn('[SyncManager] pullSince settings failed:', settingsErr);
  } else {
    settingsOk = true;
    if (settings && settings.length > 0) {
      // 多行时取第一个(理论 1 family 1 row;保险取首个)
      await setSettings(settings[0] as FamilySettings);
    }
  }

  // ---- 拉到任一表失败 → 不推进时间戳,下轮重试(T-FIX-01 数据丢失守卫) ----
  const ok = tasksOk && templatesOk && settingsOk;
  if (ok) {
    await setLastSyncAt(Date.now());
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      `[SyncManager] pullSince partial failure — last_sync_at NOT advanced. ` +
      `tasks=${tasksOk} templates=${templatesOk} settings=${settingsOk}`,
    );
  }

  return { ok, tasks: tasksOk, templates: templatesOk, settings: settingsOk };
}

function mergeTasksById(current: Task[], incoming: Task[]): Task[] {
  const map = new Map<string, Task>();
  for (const t of current) map.set(t.id, t);
  for (const t of incoming) map.set(t.id, t); // 新数据覆盖旧数据(同 id)
  return Array.from(map.values());
}

function mergeTemplatesById(current: TaskTemplate[], incoming: TaskTemplate[]): TaskTemplate[] {
  const map = new Map<string, TaskTemplate>();
  for (const t of current) map.set(t.id, t);
  for (const t of incoming) map.set(t.id, t);
  return Array.from(map.values());
}

// =====================================================================
// 9. initNetworkListener — NetInfo 钩子
// =====================================================================

/**
 * 初始化 NetInfo 监听(幂等)。
 *
 * 监听事件:
 *   - offline → online(edge):触发 replayQueue + pullSince
 *   - 任意变化:通知所有 networkListeners 让 React hook 重渲染
 *
 * 注意:重复调用不会重复订阅(unSubscribe ref 防重入)。
 */
export function initNetworkListener(): void {
  if (netInfoUnsubscribe) return;

  // NetInfo.addEventListener 在 RN/jest 默认返回 RNFSubscribe 类型,
  // 我们只调 .remove() / 直接当 () => void 用;这里直接 cast 成 () => void
  netInfoUnsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    const wasOnline = isOnline;
    isOnline = !!state.isConnected && state.isInternetReachable !== false;

    // 离线 → 在线:触发 sync 闭环
    if (!wasOnline && isOnline && currentFamilyId) {
      void onReconnect();
    }

    // 通知所有订阅者(让 useSyncManager 重渲染 isOnline)
    networkListeners.forEach((fn) => fn());
  }) as unknown as () => void;
}

/**
 * 离线 → 在线 时的同步闭环:
 *   1. 先 drain queue(把用户离线时攒的写全发出去)
 *   2. 再 pullSince(拿到 server 在我们离线期间被配偶改的内容)
 *
 * 顺序很重要:先 replay 再 pull —— 否则我们的本地修改可能被 server 拉到的"旧"
 * 状态覆盖(realtime 也会发,但顺序不可控)。
 */
async function onReconnect(): Promise<void> {
  try {
    await replayQueue();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[SyncManager] onReconnect.replayQueue failed:', e);
  }
  try {
    await pullSince(await getLastSyncAt());
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[SyncManager] onReconnect.pullSince failed:', e);
  }
}

// =====================================================================
// 10. useSyncManager(familyId) — React hook 包装
// =====================================================================

export interface SyncManagerState {
  isOnline: boolean;
}

/**
 * 业务侧在 root 屏调的 hook。
 *
 * 行为:
 *   - familyId 变化 → 重订阅
 *   - AppState background → unsubscribe;active → resubscribe
 *   - 网络变化 → 通过 isOnline 反映
 *
 * 卸载时 → unsubscribeAll + AppState 清理。
 *
 * 使用 useSyncExternalStore 订阅 isOnline(让 NetInfo 变更立即触发组件重渲染)。
 */
export function useSyncManager(familyId: string | null): SyncManagerState {
  // 满足 React rules-of-hooks:hooks 无条件调用,effect 内做条件分支
  useSyncExternalStore(
    (onChange) => {
      networkListeners.add(onChange);
      return () => {
        networkListeners.delete(onChange);
      };
    },
    () => isOnline,
    () => true, // SSR fallback
  );

  const lastFamilyRef = useRef<string | null>(null);

  useEffect(() => {
    initNetworkListener();

    if (familyId) {
      lastFamilyRef.current = familyId;
      void subscribeFamily(familyId).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[SyncManager] subscribeFamily failed:', e);
      });
    }

    // AppState:background → 释放;active → 重新订阅(若之前有 familyId)
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        void unsubscribeAll();
      } else if (next === 'active' && lastFamilyRef.current) {
        void subscribeFamily(lastFamilyRef.current).catch((e) => {
          // eslint-disable-next-line no-console
          console.warn('[SyncManager] AppState resubscribe failed:', e);
        });
      }
    });

    return () => {
      subscription.remove();
      void unsubscribeAll();
    };
  }, [familyId]);

  return { isOnline };
}

// =====================================================================
// 11. 测试 / 调试出口
// =====================================================================

/**
 * 仅供测试 / debug 用。生产 bundle 仍会保留,但业务侧不应调用。
 *
 * 用法:重置模块级单例状态(订阅 / 当前 family / dedup / 监听器),
 * 让多个测试 case 互不污染。
 */
export async function _resetForTests(): Promise<void> {
  await unsubscribeAll();
  dedup.clear();
  networkListeners.clear();
  isOnline = true;
}
