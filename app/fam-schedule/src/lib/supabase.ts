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
 *   - supabase.rpc('name')    — RPC 调用
 *   - supabase.channel()      — realtime 订阅(后续 SyncManager 用)
 *
 * 类型推导:createClient<Database> 后,所有 from('xxx').select() 自动推导 Row 类型。
 */