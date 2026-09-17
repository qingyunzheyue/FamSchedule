/**
 * AuthContext — T-SETUP-4
 *
 * 职责:
 *   1. 启动时从 SecureStore 恢复 session(supabase-js SDK 自动做,我们只需监听)
 *   2. 无 session 时自动 signInAnonymously(ADR-002:首次启动 = 新 anon user)
 *   3. 监听 onAuthStateChange(token refresh / signOut / 重新登录)
 *   4. session 失效(token refresh 失败)时 SDK 会触发 SIGNED_OUT 事件,
 *      我们捕获后自动重新 signInAnonymously,让用户体验为"无感重连"
 *      注意:anon sign-in 拿新 user.id = 新设备身份,等于"卸载重装"语义;
 *      这是 MVP 设计选择(PRD A6 接受),家庭数据会跟着旧 user.id 走,需重新配对。
 *
 * 暴露 API:
 *   - user           : User | null       — 当前 anon user
 *   - session        : Session | null    — 完整 session(access + refresh token)
 *   - isLoading      : boolean           — true 时 UI 应显示 splash,不渲染业务屏
 *   - signInAnonymously(): Promise<void> — 手动触发(目前未在 UI 暴露,但保留逃生口)
 *   - signOut()      : Promise<void>     — 清 SecureStore + SDK session
 *
 * 注意:
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

import { supabase } from '../lib/supabase';

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

  useEffect(() => {
    let mounted = true;

    /**
     * 启动序列:
     *   1. 尝试 getSession() — SDK 从 SecureStore 读 localStorage,若有则恢复
     *   2. 若没 session,signInAnonymously() — 拿新 anon user.id,SDK 写回 SecureStore
     *   3. 订阅 onAuthStateChange — 后续 token refresh / signOut 由它广播
     *
     * 关键:无论分支,最后都要 setIsLoading(false),否则 UI 永远停在 splash。
     */
    const initialize = async (): Promise<void> => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!mounted) return;

        if (error) {
          // eslint-disable-next-line no-console
          console.error('[AuthContext] getSession error:', error);
        }

        if (data.session?.user) {
          setSession(data.session);
          setUser(data.session.user);
          return;
        }

        // 无 session → 首次启动,Anon Sign-in
        const { data: signInData, error: signInError } =
          await supabase.auth.signInAnonymously();
        if (!mounted) return;

        if (signInError) {
          // eslint-disable-next-line no-console
          console.error('[AuthContext] signInAnonymously error:', signInError);
          return;
        }

        setSession(signInData.session);
        setUser(signInData.user);
      } catch (err) {
        // 网络断开 / SecureStore 损坏 → 不阻塞 UI,isLoading=false 让用户看到 error UI
        // eslint-disable-next-line no-console
        console.error('[AuthContext] init threw:', err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    void initialize();

    /**
     * 监听 auth 状态变化:
     *   - TOKEN_REFRESHED   → session 更新,user 不变
     *   - SIGNED_IN         → 新 session(可能是自动 signInAnonymously 完成)
     *   - SIGNED_OUT        → 清掉 user/session(此时 isLoading 由 initialize 收尾)
     *   - USER_UPDATED      → metadata 变化(MVP 不暴露 UI)
     *
     * session 失效场景:SIGNED_OUT + 没有 user → 客户端自动重连 anon。
     * 这里不直接在 listener 里调 signInAnonymously,避免和 initialize 双重调用,
     * 而是用一个 effect 监听 user 变 null 且不是初次加载时重连。
     */
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      setUser(newSession?.user ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  /**
   * 自动重连 anon:当 user 由有变无(SIGNED_OUT 且非初次),重发 signInAnonymously。
   * 用 useEffect 而非在 onAuthStateChange 内直接调,避免闭包陷阱。
   *
   * 例外:若用户主动调 signOut(),不应该自动重连(那样就登不出了)。
   * 通过 `intentionalSignOutRef` 标记"我刚主动登的",effect 看到标志就跳过本次重连。
   */
  const intentionalSignOutRef = useRef(false);

  useEffect(() => {
    if (isLoading) return; // 初次加载中
    if (user) return; // 有 user 不动
    if (intentionalSignOutRef.current) {
      intentionalSignOutRef.current = false;
      return;
    }

    // session 失效 → 自动重连
    void (async () => {
      try {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) {
          // eslint-disable-next-line no-console
          console.error('[AuthContext] auto re-signInAnonymously failed:', error);
          return;
        }
        if (data.session) {
          setSession(data.session);
          setUser(data.user);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[AuthContext] auto re-signInAnonymously threw:', err);
      }
    })();
  }, [user, isLoading]);

  /**
   * 手动 signInAnonymously:当前未在 UI 暴露,作为逃生口保留。
   * 例:debug 菜单 / dev panel / 故障恢复按钮。
   */
  const signInAnonymously = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[AuthContext] manual signInAnonymously error:', error);
        return;
      }
      setSession(data.session);
      setUser(data.user);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * 主动登出:清 SecureStore + SDK session。
   * 标记 intentionalSignOut 阻止自动重连 effect 再触发。
   */
  const signOut = useCallback(async (): Promise<void> => {
    intentionalSignOutRef.current = true;
    setIsLoading(true);
    try {
      await supabase.auth.signOut();
      setSession(null);
      setUser(null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[AuthContext] signOut error:', err);
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