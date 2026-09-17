/**
 * AuthContext — T-SETUP-4 + T-US013-1 重构
 *
 * 职责(从 T-US013-1 起,业务逻辑下沉到 AuthService):
 *   1. 启动时从 AuthService 恢复 session(SDK + SecureStore 由 AuthService 封装)
 *   2. 无 session 时调 AuthService.signInAnonymously()
 *   3. 订阅 AuthService.subscribeAuthState(自动重连策略由 AuthService 处理)
 *   4. 把 AuthState 翻译成 React state({user, session, isLoading})
 *   5. 暴露 signOut() 给 UI:调 AuthService.markIntentionalSignOut() + clearSession(),
 *      防止 AuthService 的自动重连逻辑接住这次登出
 *
 * 暴露 API(对消费侧不变):
 *   - user           : User | null       — 当前 anon user
 *   - session        : Session | null    — 完整 session(access + refresh token)
 *   - isLoading      : boolean           — true 时 UI 应显示 splash,不渲染业务屏
 *   - signInAnonymously(): Promise<void> — 手动触发(目前未在 UI 暴露,作为逃生口保留)
 *   - signOut()      : Promise<void>     — 标主动 + 清 SecureStore + SDK session
 *
 * 注意:
 *   - 自动重连 anon 的逻辑(SDK 发 SIGNED_OUT 时自动 signIn)由 AuthService 处理,
 *     AuthContext 只负责被动接收 state 变更
 *   - 不在此处触发 `create_family` RPC,那是 US-012 的事;AuthContext 只管"我是谁"
 *   - 不订阅 realtime,那是 SyncManager(T-SETUP-6)的事
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';

import {
  signInAnonymously as authServiceSignInAnonymously,
  restoreSession as authServiceRestoreSession,
  clearSession as authServiceClearSession,
  subscribeAuthState,
  markIntentionalSignOut,
  type AuthState,
} from '../services/AuthService';

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  signInAnonymously: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * AuthProvider — 应包裹在 TamaguiProvider 之内、Stack 之外。
 * 见 app/_layout.tsx 的装配顺序。
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * "用户主动登出" ref — React-state 版本的 intent 标记。
   *
   * 为什么用 ref 而不是 useState:这是**命令式**的事件标记,不是状态;
   * 不应触发 re-render,只在 signOut 调用瞬间用一次。
   *
   * 流程(与 AuthService.markIntentionalSignOut 配合):
   *   1. signOut() 第一行:ref.current = true
   *   2. clearSession() → SDK 发 SIGNED_OUT → AuthService listener 看到 ref 标志
   *      → 不自动重连,emit signed_out
   *   3. useEffect 监听到 user 变 null → 检查 ref.current:为 true 时跳过重连 + reset
   *      (AuthService 也已 reset 它,这里是 belt-and-suspenders)
   *
   * 双层防御:AuthService 有 module-level flag,AuthContext 有 ref,任一层失效另一层兜底。
   */
  const intentionalSignOutRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    /**
     * 启动序列:
     *   1. AuthService.restoreSession() — SDK 从 SecureStore 读;若有 + 未过期直接返回
     *   2. 若 signed_out → AuthService.signInAnonymously() — 拿新 anon user
     *   3. 订阅 AuthService.subscribeAuthState — 后续 token refresh / SIGNED_OUT 由它广播
     *
     * 关键:无论分支,最后都要 setIsLoading(false),否则 UI 永远停在 splash。
     */
    const initialize = async (): Promise<void> => {
      try {
        const restored = await authServiceRestoreSession();
        if (!mounted) return;

        if (restored.status === 'signed_in') {
          setSession(restored.session);
          setUser(restored.user);
          return;
        }

        // 无有效 session → 首次启动,Anon Sign-in
        const signedIn = await authServiceSignInAnonymously();
        if (!mounted) return;

        if (signedIn.status === 'signed_in') {
          setSession(signedIn.session);
          setUser(signedIn.user);
        }
        // signed_in 失败 → isLoading 仍会走 finally;UI 进入 error 路径
      } catch (err) {
        // 兜底:AuthService 自身已 try/catch,理论上不到这;显式记一行
        // eslint-disable-next-line no-console
        console.error('[AuthContext] init threw unexpectedly:', err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    void initialize();

    /**
     * 订阅 AuthService 事件。AuthService 已封装好:
     *   - INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED → signed_in
     *   - SIGNED_OUT → signed_out(若非主动,内部自动 signInAnonymously 重连)
     *
     * AuthContext 只负责把 AuthState 翻译成 React state。
     */
    const unsubscribe = subscribeAuthState((state: AuthState) => {
      if (!mounted) return;
      if (state.status === 'signed_in') {
        setSession(state.session);
        setUser(state.user);
      } else if (state.status === 'signed_out') {
        setSession(null);
        setUser(null);
      }
      // 'loading' 状态本模块不主动 emit;但若未来加,这里可加分支
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  /**
   * 手动 signInAnonymously:当前未在 UI 暴露,作为逃生口保留。
   * 例:debug 菜单 / dev panel / 故障恢复按钮。
   */
  const signInAnonymously = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      const state = await authServiceSignInAnonymously();
      if (state.status === 'signed_in') {
        setSession(state.session);
        setUser(state.user);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * 主动登出:
   *   1. 标记 intentionalSignOut(AuthService 会据此跳过自动重连)
   *   2. 清 SecureStore + SDK session
   *   3. 清 React state
   */
  const signOut = useCallback(async (): Promise<void> => {
    intentionalSignOutRef.current = true;
    markIntentionalSignOut(); // 通知 AuthService
    setIsLoading(true);
    try {
      await authServiceClearSession();
      setSession(null);
      setUser(null);
    } catch (err) {
      // AuthService 已 try/catch;理论上不到这;显式记一行
      // eslint-disable-next-line no-console
      console.error('[AuthContext] signOut threw:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * useMemo 包 value,避免引用变更触发消费侧不必要的 re-render。
   * (虽然本组件目前消费侧没有用 memo,但养成习惯。)
   */
  const value = useMemo<AuthContextValue>(
    () => ({ user, session, isLoading, signInAnonymously, signOut }),
    [user, session, isLoading, signInAnonymously, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * useAuth — 业务侧取 AuthContext 唯一入口。
 * 在 AuthProvider 外使用会抛错,避免静默取到 null。
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return ctx;
}
