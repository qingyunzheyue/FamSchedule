/**
 * AuthService — auth 业务逻辑层 — T-US013-1
 *
 * 职责(auth 生命周期,纯数据层):
 *   1. signInAnonymously()    — 调 supabase.auth.signInAnonymously()
 *   2. restoreSession()       — 调 supabase.auth.getSession()(SDK 内部从 SecureStore 读)
 *   3. clearSession()         — 调 supabase.auth.signOut() + 防御性清 SecureStore key
 *   4. subscribeAuthState(cb) — 包装 supabase.auth.onAuthStateChange,
 *                                把事件映射成 AuthState 推给订阅者
 *   5. 自动重连策略           — SIGNED_OUT 触发时若非"用户主动登出",
 *                                自动调 signInAnonymously(对应 DoD #4)
 *   6. markIntentionalSignOut() — 主动登出前调用,标记本次 SIGNED_OUT 不应自动重连
 *
 * 设计依据:
 *   - ADR-002(Anon Sign-in + SecureStore):Supabase SDK 已通过 ExpoSecureStoreAdapter
 *     把 session 持久化到 SecureStore,所以本模块**不直接读写 SecureStore**;
 *     唯一的 SecureStore 直接调用是 clearSession 的"防御性 deleteItemAsync",
 *     兜底 SDK 可能漏 clear 的边界 case
 *   - 单一职责:AuthService 是 session 生命周期 + 自动重连策略的单一权威;
 *     AuthContext(本任务重构后)是 React-facing hook,把 AuthService 事件翻译成 React state。
 *     AuthContext 仍保留 `intentionalSignOutRef` 守卫调用 markIntentionalSignOut,
 *     避免 AuthContext 内部的 useEffect 与 AuthService 的 auto-reconnect 双触发
 *
 * 模块形态:
 *   - 模块级函数(不是 class)— 匹配 SyncManager / LocalStore 的风格
 *   - 单例 listener ref(subscribeAuthState 幂等):重复订阅会自动 unsubscribe 旧的
 *   - 单例 intentionalSignOutFlag(一次性的,被消费后自动 reset)
 *   - _resetForTests():与 SyncManager 对齐,给 jest 用
 *
 * AuthState 是 discriminated union:
 *   - loading      : SDK 还没准备好,UI 应渲染 splash
 *   - signed_out   : 无 session
 *   - signed_in    : 有 session + user
 *
 * ⚠️ 不在此模块处理 token 业务语义(token 是否过期由 supabase-js SDK + RLS 兜底),
 *    本模块只暴露"现在有没有 session"的简单判断 + 生命周期策略。
 */

import type { Session, User } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

import { supabase } from '../lib/supabase';

// =====================================================================
// Types
// =====================================================================

/**
 * AuthService 暴露的统一状态形态。
 *
 * 设计:discriminated union 而不是单 interface 加 nullable,这样消费侧
 * switch(state.status) 会被 TS exhaustiveness 检查,不会漏分支。
 *
 * 例:
 *   if (state.status === 'signed_in') {
 *     state.session  // Session,不是 Session | null,无需再判空
 *   }
 */
export type AuthState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'signed_in'; session: Session; user: User };

/**
 * SecureStore key — 单一权威源。
 *
 * 命名:`auth:session`。Supabase SDK 实际存 session 用的是
 * `sb-<project-ref>-auth-token`(SDK 内部命名),这里用 `auth:session` 作为本
 * 模块自定义信息的 key 命名空间(目前 MVP 还没用到,留着为未来扩展)。
 *
 * 防御性 clearSession 时调 deleteItemAsync('auth:session') 是 no-op(SDK 没
 * 用这个 key),但保留了"我们以后用这个 key 存东西时一并清"的语义一致性。
 */
const SECURE_STORE_KEY = 'auth:session';

// =====================================================================
// Module state (singleton refs)
// =====================================================================

/**
 * 当前已订阅的 unsubscribe 函数。
 *
 * subscribeAuthState 幂等:重复调用会先 unsubscribe 旧的,再订阅新的。
 * 这避免了上层(如 AuthContext 在 React StrictMode 下 double-mount 时)
 * 重复订阅导致 listener 风暴。
 *
 * ⚠️ 仅保存**最后一次**订阅的 unsubscribe;若上层需要多订阅者,
 *    改用 Set<() => void>。本 MVP 只有 AuthContext 一个订阅者,单 ref 够用。
 */
let unsubscribeAuthListener: (() => void) | null = null;

/**
 * "用户主动登出"标记 — 一次性 flag。
 *
 * 触发流程:
 *   1. 上层(AuthContext)在调用 clearSession() 前先调 markIntentionalSignOut()
 *   2. subscribeAuthState 收到 SIGNED_OUT 事件,检查 flag:
 *      - true  → reset flag + emit signed_out(不自动重连)
 *      - false → 调 signInAnonymously() 自动重连,emit 其结果
 *
 * flag 是**一次性**的:被消费后立即 reset,避免误杀后续真过期场景的自动重连。
 *
 * 这是 DoD #4 的关键:用户主动 signOut 后,SDK 会立刻 emit SIGNED_OUT,如果不做
 * 标记,AuthService 会立即自动重连 → 用户永远登不出去。
 */
let intentionalSignOutFlag = false;

// =====================================================================
// 1. signInAnonymously
// =====================================================================

/**
 * 触发 anon sign-in。SDK 会:
 *   1. 调 Supabase `signInAnonymously` endpoint
 *   2. 拿到 access + refresh token
 *   3. 通过 ExpoSecureStoreAdapter 写入 SecureStore(persistSession: true)
 *
 * 错误处理:
 *   - SDK 返回 `{ error }`  → 返回 `{ status: 'signed_out' }`,**不抛**
 *   - SDK 抛异常            → 返回 `{ status: 'signed_out' }`,**不抛**
 *   - 上层(AuthContext / subscribeAuthState 自动重连)看到 signed_out 可决定是否重试
 *
 * 不抛错的理由:本函数常被 React 启动序列 / 自动重连调用,启动期抛错会让 UI 卡
 * 在 splash;让上层拿到结构化 state 决定是否 retry / showError 更稳。
 */
export async function signInAnonymously(): Promise<AuthState> {
  try {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[AuthService] signInAnonymously error:', error.message);
      return { status: 'signed_out' };
    }
    if (!data.session || !data.user) {
      // 理论上 anon sign-in 一定会返回 session;SDK 边界 case 兜底
      // eslint-disable-next-line no-console
      console.warn('[AuthService] signInAnonymously returned no session/user');
      return { status: 'signed_out' };
    }
    return { status: 'signed_in', session: data.session, user: data.user };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[AuthService] signInAnonymously threw:', e);
    return { status: 'signed_out' };
  }
}

// =====================================================================
// 2. restoreSession
// =====================================================================

/**
 * 从 SecureStore 恢复 session(通过 supabase-js SDK + ExpoSecureStoreAdapter)。
 *
 * 流程:
 *   1. supabase.auth.getSession() — SDK 内部读 SecureStore,反序列化
 *   2. 若有 session 且未过期   → signed_in
 *   3. 若有 session 但已过期   → 尝试 refreshSession();成功 signed_in / 失败 signed_out
 *   4. 无 session             → signed_out(由上层决定是否触发 signInAnonymously)
 *
 * 注意:"restore" 在本模块其实等价于"问 SDK 现在 session 是什么" ——
 *   因为 SDK 启动时已自动从 SecureStore 加载,这里再做一次是 **defensive rehydrate**,
 *   覆盖"SDK 因为某种原因丢了 state" 的边界 case(SDK 重启 / hot reload 等)。
 *
 * 过期判定:SDK 的 session.expires_at 是 unix seconds;若 < Date.now()/1000 即过期。
 */
export async function restoreSession(): Promise<AuthState> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[AuthService] restoreSession getSession error:', error.message);
      return { status: 'signed_out' };
    }
    if (!data.session || !data.session.user) {
      return { status: 'signed_out' };
    }

    // 检查过期:expires_at 是 unix seconds
    const expiresAt = data.session.expires_at ?? 0;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (expiresAt > 0 && expiresAt < nowSeconds) {
      // 过期:尝试 refresh
      const { data: refreshData, error: refreshError } =
        await supabase.auth.refreshSession(data.session);
      if (refreshError || !refreshData.session || !refreshData.user) {
        // eslint-disable-next-line no-console
        console.warn('[AuthService] restoreSession refresh failed:', refreshError?.message);
        return { status: 'signed_out' };
      }
      return {
        status: 'signed_in',
        session: refreshData.session,
        user: refreshData.user,
      };
    }

    return {
      status: 'signed_in',
      session: data.session,
      user: data.session.user,
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[AuthService] restoreSession threw:', e);
    return { status: 'signed_out' };
  }
}

// =====================================================================
// 3. clearSession
// =====================================================================

/**
 * 主动登出。
 *
 * 流程:
 *   1. supabase.auth.signOut() — SDK 应该会清 SecureStore 内的 session
 *   2. 防御性 SecureStore.deleteItemAsync(SECURE_STORE_KEY)
 *      — 兜底 SDK 可能漏 clear 的边界 case(SDK 在某些错误路径可能不删)
 *
 * ⚠️ 调用方语义:
 *    必须在调本函数前先调 markIntentionalSignOut(),否则 SDK 发的 SIGNED_OUT
 *    事件会被 AuthService 自动重连逻辑接住,用户等于没登出去。
 *
 * 不抛错:与 signInAnonymously 一致。
 */
export async function clearSession(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[AuthService] clearSession signOut threw:', e);
    // 继续往下走 — signOut 失败也尝试防御性清
  }

  try {
    // 防御性:清掉自己 key 下的内容(若之前用过)。失败静默吞。
    await SecureStore.deleteItemAsync(SECURE_STORE_KEY);
  } catch {
    // SecureStore.deleteItemAsync 在 key 不存在时也可能抛;静默吞。
  }
}

// =====================================================================
// 4. markIntentionalSignOut
// =====================================================================

/**
 * 标记"下一次 SIGNED_OUT 是用户主动登出导致",不应自动重连。
 *
 * 调用方(AuthContext.signOut):
 *   1. markIntentionalSignOut()  // 先标记
 *   2. clearSession()            // 再登出 → SDK 发 SIGNED_OUT
 *   3. subscribeAuthState listener 看到 flag → emit signed_out + reset flag
 *      → 用户成功登出(没有自动重连)
 *
 * flag 是**一次性**,被消费后立刻 reset,避免误杀后续真过期场景的自动重连。
 */
export function markIntentionalSignOut(): void {
  intentionalSignOutFlag = true;
}

// =====================================================================
// 5. subscribeAuthState
// =====================================================================

/**
 * 包装 supabase.auth.onAuthStateChange,把 Supabase 事件映射成 AuthState,
 * 并实现"自动重连"策略(DoD #4)。
 *
 * 事件映射:
 *   - INITIAL_SESSION  → 用 SDK 当前 session 状态构造 AuthState
 *   - SIGNED_IN        → signed_in(new session)
 *   - SIGNED_OUT       → signed_out,但**若** intentionalSignOutFlag == false,
 *                         自动触发 signInAnonymously 并 emit 其结果
 *   - TOKEN_REFRESHED  → signed_in(refreshed session)
 *   - USER_UPDATED     → signed_in(updated user,session 同)
 *   - 其他(PASSWORD_RECOVERY 等)  → 不转发(本项目 MVP 用不到)
 *
 * 幂等:重复调用会先 unsubscribe 旧 listener,再订阅新的。
 *   这样 AuthContext 在 React StrictMode 下 double-mount 也安全。
 *
 * 返回:unsubscribe 函数。调用方在 unmount / 重订阅时调。
 */
export function subscribeAuthState(onChange: (state: AuthState) => void): () => void {
  // 幂等:先清旧 listener
  if (unsubscribeAuthListener) {
    unsubscribeAuthListener();
    unsubscribeAuthListener = null;
  }

  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    (event, session) => {
      void handleAuthStateEvent(event, session, onChange);
    },
  );

  unsubscribeAuthListener = () => {
    subscription.unsubscribe();
  };

  // 返回 unsubscribe 给调用方;同时清 module-level ref,避免外部多次调 unsubscribe 重复 unsubscribe
  return () => {
    if (unsubscribeAuthListener) {
      unsubscribeAuthListener();
      unsubscribeAuthListener = null;
    }
  };
}

/**
 * 处理单个 auth event。提取出来便于测试和复用。
 *
 * 关键逻辑(SIGNED_OUT 分支):
 *   - 若 intentionalSignOutFlag:reset flag + emit signed_out(不自动重连)
 *   - 否则:调 signInAnonymously 自动重连 + emit 结果
 *
 * 注意:先 emit signed_out 再 emit 新状态,这样消费侧能感知"中间断流"。
 *   若直接 emit 新 signed_in,消费侧可能漏掉"曾经登出过"的事件。
 *   但本 MVP AuthContext 用 useState 镜像 user/session,中间态无感;
 *   严格流式消费时这个顺序更稳。
 */
async function handleAuthStateEvent(
  event: string,
  session: Session | null,
  onChange: (state: AuthState) => void,
): Promise<void> {
  // INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED → 直接映射
  if (
    event === 'INITIAL_SESSION' ||
    event === 'SIGNED_IN' ||
    event === 'TOKEN_REFRESHED' ||
    event === 'USER_UPDATED'
  ) {
    if (session && session.user) {
      onChange({ status: 'signed_in', session, user: session.user });
    } else {
      // signed_in 事件但 session 为空:异常路径,降级到 signed_out
      onChange({ status: 'signed_out' });
    }
    return;
  }

  if (event === 'SIGNED_OUT') {
    if (intentionalSignOutFlag) {
      // 用户主动登出:不重连,清 flag,emit signed_out
      intentionalSignOutFlag = false;
      onChange({ status: 'signed_out' });
      return;
    }

    // 非主动登出(session 过期 / token refresh 失败 / server 端踢人)
    // → 先 emit signed_out 反映当前状态,再自动重连
    onChange({ status: 'signed_out' });

    try {
      const newState = await signInAnonymously();
      onChange(newState);
    } catch (e) {
      // signInAnonymously 自己已 try/catch + 返回 signed_out;理论上不到这。
      // eslint-disable-next-line no-console
      console.warn('[AuthService] auto re-signIn threw unexpectedly:', e);
    }
    return;
  }

  // 其他事件:不改变已知状态;返回当前 session 推得的 state
  if (session && session.user) {
    onChange({ status: 'signed_in', session, user: session.user });
  } else {
    onChange({ status: 'signed_out' });
  }
}

// =====================================================================
// 6. 测试 / 调试出口
// =====================================================================

/**
 * 仅供测试 / debug 用。生产 bundle 仍会保留,但业务侧不应调用。
 *
 * 用法:重置模块级单例状态(unsubscribeAuthListener + intentionalSignOutFlag)。
 * 与 SyncManager._resetForTests 对齐 — 让多个测试 case 互不污染。
 */
export function _resetForTests(): void {
  if (unsubscribeAuthListener) {
    unsubscribeAuthListener();
    unsubscribeAuthListener = null;
  }
  intentionalSignOutFlag = false;
}
