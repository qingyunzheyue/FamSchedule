/**
 * Supabase 客户端单例 — T-SETUP-4
 *
 * 决策依据 ADR-002(Anon Sign-in + SecureStore):
 *   - Storage 用 expo-secure-store(Android Keystore 硬件级加密),
 *     严禁 AsyncStorage(明文,可被同设备其他 app 读取)
 *   - autoRefreshToken: true → SDK 在 access_token 过期前自动 refresh,
 *     客户端无需感知
 *   - persistSession: true → 启动时 SDK 从 SecureStore 恢复 session,
 *     AuthContext 再包装一层 isLoading 状态
 *   - detectSessionInUrl: false → RN 没有 URL hash 概念,关闭
 *
 * 客户端不直接持有 token(都封在 SDK 里);AuthContext 只暴露 User/Session 对象。
 */

import * as SecureStore from 'expo-secure-store';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../types/database';

/**
 * expo-secure-store ↔ supabase-js storage adapter
 *
 * supabase-js v2 的 `auth.storage` 期望实现:
 *   getItem(key: string): Promise<string | null>
 *   setItem(key: string, value: string): Promise<void>
 *   removeItem(key: string): Promise<void>
 *
 * SecureStore API:
 *   getItemAsync(key): Promise<string | null>
 *   setItemAsync(key, value): Promise<void>
 *   deleteItemAsync(key): Promise<void>
 *
 * 名字差异(getItemAsync vs getItem)+ Promise wrap 是为什么要写 adapter。
 *
 * 异常:SecureStore 在 Android 上对 value 长度有限制(~2KB);JWT 远小于这个值,
 * 但若 Supabase 后续把 refresh_token + access_token 打包成大对象,可能撞限。
 * MVP 阶段先用 setItemAsync,不预判;后续若撞到,改为拆 key 存。
 */
const ExpoSecureStoreAdapter = {
  getItem: (key: string): Promise<string | null> => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string): Promise<void> =>
    SecureStore.setItemAsync(key, value),
  removeItem: (key: string): Promise<void> => SecureStore.deleteItemAsync(key),
};

/**
 * 环境变量断言(开发期早失败):
 *   Metro 在 bundle 时把 EXPO_PUBLIC_* inline 成字面量,若 .env 缺失则空字符串,
 *   createClient 用空字符串依然能 new,但首个请求会 401/URL 解析错。
 *   这里显式抛错,让 dev 启动时就崩,而不是线上发现。
 */
function getEnv(name: 'EXPO_PUBLIC_SUPABASE_URL' | 'EXPO_PUBLIC_SUPABASE_ANON_KEY'): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    // eslint-disable-next-line no-console
    console.error(
      `[supabase] Missing env ${name}. ` +
        '检查 app/fam-schedule/.env 是否存在,Metro 是否重启过。',
    );
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

/**
 * Supabase singleton — 模块加载时即创建(无 lazy init)。
 * 理由:
 *   1. AuthProvider 启动时立即调用 supabase.auth.getSession(),
 *      必须保证 client 已 ready
 *   2. SupabaseClient 内部维护 auth 订阅 / token refresh 定时器,
 *      创建多次会泄漏
 *   3. singleton 让 `from('tasks').select()` 这种调用语法直接可用,
 *      业务侧无需 import 单例管理
 */
export const supabase: SupabaseClient<Database> = createClient<Database>(
  getEnv('EXPO_PUBLIC_SUPABASE_URL'),
  getEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY'),
  {
    auth: {
      storage: ExpoSecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false, // RN 环境无关
      flowType: 'implicit', // anon sign-in 用 implicit 即可,无需 PKCE
    },
  },
);

/**
 * 业务侧可能需要的扩展点(导出但不强制使用):
 *   - supabase.auth.*         — 认证
 *   - supabase.from('tasks')  — 表查询
 *   - supabase.rpc('name')    — RPC 调用(推荐走 rpcTyped — 见下)
 *   - supabase.channel()      — realtime 订阅(后续 SyncManager 用)
 *
 * 类型推导:createClient<Database> 后,所有 from('xxx').select() 自动推导 Row 类型。
 */

// ============================================================
// rpcTyped — 类型安全的 supabase.rpc() 包装(T-FIX-06-A M06)
// ============================================================
//
// 背景:
//   supabase-js 在 typed Database(我们的 createClient<Database> 模式)上,
//   `supabase.rpc('foo', args)` 的 Args 类型推导会 narrow 成 `never`,
//   直接传 object literal 会被 TS 拒绝(`Argument of type 'X' is not assignable
//   to parameter of type 'never'`)。这是 SDK 的 literal-narrowing quirk,不是
//   真 bug — 实际运行时 payload 正确,服务器能解析。
//
// 过去的 workaround:
//   - `(supabase.rpc as CallableFunction)(name, args)` — 整个函数签名 unknown,
//     丢掉所有类型保护,等于绕开 TS
//   - `await supabase.rpc(name, args as never)` — Args 位置 cast 成 never,
//     在每个 callsite 重复一次,污染调用方代码
//
// 新做法(rpcTyped):
//   - 在 supabase.ts 内部做**一次** `as never` cast(注释清楚是 SDK quirk 兜底),
//     然后暴露两个泛型参数 `<TArgs, TResult>` 给业务侧:
//     • TArgs   : RPC 入参 object(可选,默认 undefined — 对应无参 RPC)
//     • TResult : RPC 返回值 data 类型(默认 unknown — 调用方按需 narrow)
//   - 调用方写法:`const { data, error } = await rpcTyped<MyArgs, MyResult>('foo', args)`,
//     干净、无 cast、TS 仍能 narrow `data: TResult | null`
//
// 注意:这是个 wrapper,**不是** SDK 替换 — supabase.rpc 仍是真实调用入口。
// 如果未来 supabase-js 修了 Args narrowing,把 wrapper 内 `as never` 删掉即可,
/**
 * 类型安全的 supabase.rpc() 包装 — 集中处理 SDK typed-Database 的 Args narrowing quirk。
 *
 * @param name — RPC 函数名(对应 db-v1.x.sql 中的 function name)
 * @param args — RPC 入参(可选,默认 `{}` — 对应无参 RPC 如 create_family / create_invite)
 *
 * @returns 与 SDK 一致的 `{ data, error }` 形态,data 已 narrow 到 `TResult | null`。
 *
 * @example
 * ```ts
 * const { data, error } = await rpcTyped<{ p_code: string }, { familyId: string }>(
 *   'accept_invite',
 *   { p_code: 'ABC123' },
 * );
 * if (error) { ... }
 * if (data) { /* data.familyId typed *\/ }
 * ```
 */
export async function rpcTyped<
  TArgs extends object | undefined = undefined,
  TResult = unknown,
>(
  name: string,
  args?: TArgs,
): Promise<{
  data: TResult | null;
  /**
   * 与 supabase-js 一致:`{ message: string; ... }` 形态(PostgrestError)。
   * `null` = RPC 成功(SDK 行为)。
   * 业务侧调用方可直接 `error?.message` / `error.message.toLowerCase()` 等,
   * 不需要每次都 narrow unknown(原来是 `as CallableFunction` cast 整段丢类型,
   * 现在 wrapper 显式声明 PostgrestError 形态)。
   */
  error: { message?: string } | null;
}> {
  // `as never`:supabase-js typed-Database 上的 RPC Args narrowing quirk。
  // SDK 自动推导的 Args 是 `never`,object literal 匹配不上。
  // 实际请求 payload 正确,服务器能解析 — 见上方背景注释。
  // 把 quirk 集中到这里一次性兜底,业务侧拿干净的 wrapper API。
  const result = (await (supabase.rpc as CallableFunction)(
    name,
    (args ?? {}) as never,
  )) as { data: TResult | null; error: { message?: string } | null };
  return result;
}