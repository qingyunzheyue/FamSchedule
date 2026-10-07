/**
 * LocalStore — AsyncStorage 封装 — T-SETUP-5
 *
 * 职责:
 *   - 业务数据本地 cache(tasks / templates / settings)
 *   - 同步元数据(last_sync_at unix ms)
 *   - 离线写队列(FIFO PendingMutation[])
 *
 * 设计依据:
 *   - ADR-005(同步与冲突 — Server 权威 + 行级 LWW + Check-in 幂等):
 *     写队列是 JSON 数组,FIFO replay;本地 cache 是 server 镜像。
 *   - 任务 DoD(明确 5 个 reserved keys + typed get/set API + queue ops)
 *
 * 类型:
 *   - Task / TaskTemplate / FamilySettings:re-export 自 database.ts
 *     这样业务侧 import 一处,不用每次写 `Database['public']['Tables']...`
 *   - PendingMutation:业务层 discriminated union。SyncManager(T-SETUP-6)
 *     会把这个高层形态展开为 ADR-005 §"Mutation 对象结构" 描述的
 *     `{ id, ts, table, op, rowId, payload? }` 形态,再调 supabase。
 *
 * 错误处理:
 *   - getJSON 解析失败 / AsyncStorage 读取异常 → 返回 fallback(空数组 / null),
 *     让调用方不必包 try/catch(cache miss 不应是 fatal)
 *   - setJSON 写入失败 → 重新抛出,让上游(sync 等)感知并处理
 *
 * ⚠️ AsyncStorage 不能存敏感数据(token 等)— 那些走 SecureStore(ADR-002)。
 *    本模块只存业务 cache + 写队列。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Database } from '../types/database';

// ---- Typed re-exports from Database schema ----

export type Task = Database['public']['Tables']['tasks']['Row'];
export type TaskTemplate = Database['public']['Tables']['task_templates']['Row'];
export type FamilySettings = Database['public']['Tables']['family_settings']['Row'];

// ---- PendingMutation (业务层 discriminated union) ----
//
// SyncManager 会展开为 ADR-005 低层形态:
//   - checkin / undo_checkin → tasks.id 上调 RPC
//   - create_task → task_templates.insert
//   - update_task → tasks.update
//   - delete_task → tasks.delete
//
// 故意不嵌 client-generated `id` 字段:queue 去重靠 (kind, taskId) 二元组
// 在 SyncManager 端做;LocalStore 只负责 FIFO 序,不做去重。
export type PendingMutation =
  | { kind: 'checkin'; taskId: string; isMakeup: boolean; queuedAt: number }
  | { kind: 'undo_checkin'; taskId: string; queuedAt: number }
  | { kind: 'create_task'; template: TaskTemplate; queuedAt: number }
  | { kind: 'update_task'; taskId: string; patch: Partial<Task>; queuedAt: number }
  | { kind: 'delete_task'; taskId: string; queuedAt: number };

// ---- Reserved keys (单一权威源) ----
//
// 命名规范:
//   - cache:* — 镜像 server 数据的本地副本(可整体覆盖)
//   - queue:* — 客户端待执行的写队列(FIFO,append-only + drain 全清)
//   - meta:* — 同步元数据(时间戳、游标等)
//   - banner:* — 通知/banner 关闭状态持久化(unixtime ms,过了自动重置)
const KEYS = {
  tasks: 'cache:tasks',
  templates: 'cache:templates',
  settings: 'cache:settings',
  queue: 'queue:pending_mutations',
  lastSyncAt: 'meta:last_sync_at',
  bannerDismissedUntil: 'banner:dismissed_until',
} as const;

// T-US015-4:过期 banner 关闭时间戳(unixtime ms)。
// 导出为 named constant 便于 useBannerDismissedUntil hook + 测试引用同一来源。
export const BANNER_DISMISSED_UNTIL_KEY = KEYS.bannerDismissedUntil;

// ---- Generic JSON helpers ----

/**
 * 读取 + JSON.parse,带 fallback。
 * cache miss(返回 null)→ fallback;parse 错误 / 读取异常 → fallback + log。
 */
async function getJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[LocalStore] getJSON(${key}) failed:`, e);
    return fallback;
  }
}

/**
 * 序列化 + 写入。失败抛给上游(sync 失败应让 UI 感知)。
 */
async function setJSON<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[LocalStore] setJSON(${key}) failed:`, e);
    throw e;
  }
}

// ---- Cache: tasks ----

export const getTasks = (): Promise<Task[]> => getJSON<Task[]>(KEYS.tasks, []);

export const setTasks = (tasks: Task[]): Promise<void> => setJSON(KEYS.tasks, tasks);

// ---- Cache: templates ----

export const getTemplates = (): Promise<TaskTemplate[]> =>
  getJSON<TaskTemplate[]>(KEYS.templates, []);

export const setTemplates = (templates: TaskTemplate[]): Promise<void> =>
  setJSON(KEYS.templates, templates);

// ---- Cache: settings ----

export const getSettings = (): Promise<FamilySettings | null> =>
  getJSON<FamilySettings | null>(KEYS.settings, null);

export const setSettings = (settings: FamilySettings): Promise<void> =>
  setJSON(KEYS.settings, settings);

// ---- Meta: last sync timestamp ----
//
// 任务 DoD 规定用 unix ms(number)。SyncManager 写入时用 `Date.now()`。
// ADR-005 §pullSince 写的是 ISO string,那是 RPC 调用侧的传输格式;
// 本地存储用 number 方便直接做 `gt('updated_at', lastSyncAtMs)` 比较。

export const getLastSyncAt = (): Promise<number | null> =>
  getJSON<number | null>(KEYS.lastSyncAt, null);

export const setLastSyncAt = (ts: number): Promise<void> =>
  setJSON(KEYS.lastSyncAt, ts);

// ---- Banner: dismissed_until timestamp ----
//
// T-US015-4:过期 banner 关闭状态持久化。
// - 存 unix ms number(过这个时间点即视为"dismissed 已过期" → 重置)
// - null = 未 dismissed(从未关过 / 已重置)
// - hook 端读到这个 timestamp 时跟 `Date.now()` 对比;过期即视为未 dismissed
//   (无需主动写 null,只需上层比较)。setBannerDismissedUntil(null) 用于显式
//   reset(留给后续 Realtime count 变化触发自动重置时调用)
export const getBannerDismissedUntil = (): Promise<number | null> =>
  getJSON<number | null>(KEYS.bannerDismissedUntil, null);

export const setBannerDismissedUntil = (
  ts: number | null,
): Promise<void> => {
  if (ts === null) {
    return (async () => {
      try {
        await AsyncStorage.removeItem(KEYS.bannerDismissedUntil);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`[LocalStore] removeItem(${KEYS.bannerDismissedUntil}) failed:`, e);
        throw e;
      }
    })();
  }
  return setJSON(KEYS.bannerDismissedUntil, ts);
};

// ---- Mutation queue (FIFO) ----

// T-FIX-06-B M05:enqueueMutation + drainQueue 两个 read-modify-write 都不是 atomic。
// 两次 await 之间可能并发 enqueue / 跟 drainQueue 交叉,理论上会丢 mutation 或读到
// 半 drain 旧值。但 MVP 阶段所有调用方(UI 主线程 + SyncManager)都是同一线程触发,
// 且 SyncManager 没有浏览器 supabase 实时同步,实际无并发。后续 background sync
// phase 把 AsyncStorage 串行访问改为单 mutex 守护(参考 #fetch-mutex pattern:
// queue acquire / drain 在 mutex 临界区里跑),现在先注释清楚防止误以为已修。
//
// Mutation queue invariants:
//   - FIFO(append 到 tail)+ drain 全清(reconnect 后 replay)
//   - 当前实现下,enqueueMutation 串行调用安全(Single-threaded UI thread +
//     SyncManager 串行 replayQueue)
//   - drainQueue 串行调用安全(reconnect 后单一调用)
//   - 跨函数并发:enqueueMutation 在 drainQueue 中段被另一线程调 → read 旧 queue +
//     write 当前 queue;drain 拿到的 current 还在里下次 list 重写覆盖(丢 mutation)。

/**
 * Push 一个 mutation 到队列尾部。read-modify-write 不是 atomic(两次
 * await 之间可能并发 enqueue),但 MVP 阶段调用方都是同一线程(UI 主线程
 * 或 SyncManager),无并发;若后续真出现并发,改为单一 mutex 包住。
 */
export async function enqueueMutation(m: PendingMutation): Promise<void> {
  const current = await getJSON<PendingMutation[]>(KEYS.queue, []);
  current.push(m); // FIFO:append to tail
  await setJSON(KEYS.queue, current);
}

/**
 * 取走整个队列并清空。两步非 atomic — 但调用方约定在 reconnect 后
 * 串行调用,不存在并发 drain。
 */
export async function drainQueue(): Promise<PendingMutation[]> {
  const current = await getJSON<PendingMutation[]>(KEYS.queue, []);
  await AsyncStorage.removeItem(KEYS.queue);
  return current;
}

/**
 * 静默清空。用于:登出时清队列;测试。
 */
export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.queue);
}

/**
 * 当前队列长度。O(n) 序列化成本 — 2 人家庭 mutation 队列 < 10,
 * 代价可接受。
 */
export async function getQueueLength(): Promise<number> {
  const current = await getJSON<PendingMutation[]>(KEYS.queue, []);
  return current.length;
}

// ---- Debug: clear all (for testing / dev) ----
//
// ⚠️ 下划线前缀是约定:此函数不是业务 API,只供 jest 测试 / 调试菜单用。
// 生产 bundle 也会保留,Metro 不会自动 tree-shake 一个具名 export。
export async function _clearAllForTests(): Promise<void> {
  await AsyncStorage.multiRemove(Object.values(KEYS));
}

// ---- Re-exports for banner hooks ----
//
// 让 useBannerDismissedUntil hook 不用直接 import KEYS(map 对象)—
// 通过 named constant 引用单一来源,便于 grep 与重构。
export { KEYS as _KEYS };