/**
 * AuthContext — T-SETUP-4 + T-US013-1 重构 + T-US013-2 启动守卫接入
 *
 * 职责(从 T-US013-1 起,业务逻辑下沉到 AuthService):
 *   1. 启动时调 bootGuard 拿 session(T-US013-2,封装 restoreSession + signInAnonymously + retry-once)
 *   2. 订阅 AuthService.subscribeAuthState(自动重连策略由 AuthService 处理)
 *   3. 把 AuthState 翻译成 React state({user, session, isLoading, bootError})
 *   4. 暴露 signOut() 给 UI:调 AuthService.markIntentionalSignOut() + clearSession(),
 *      防止 AuthService 的自动重连逻辑接住这次登出
 *   5. 暴露 retryBoot() 给 UI:用户点击错误屏的"重试"按钮时,重新跑一次 bootGuard
 *
 * 暴露 API(对消费侧不变 + T-US013-2 新增 + T-US013-2-rev1 收敛):
 *   - user           : User | null       — 当前 anon user
 *   - session        : Session | null    — 完整 session(access + refresh token)
 *   - isLoading      : boolean           — true 时 UI 应显示 splash,不渲染业务屏
 *   - bootError      : boolean           — T-US013-2 新增;bootGuard 两次都失败时 true
 *                                         (rev1:从 `Error | null` 收成 `boolean`,
 *                                          UI 文案由 SplashScreen 默认值单一来源管理)
 *   - signInAnonymously(): Promise<void> — 手动触发(目前未在 UI 暴露,作为逃生口保留)
 *   - signOut()      : Promise<void>     — 标主动 + 清 SecureStore + SDK session
 *   - retryBoot()    : Promise<void>     — T-US013-2 新增;bootGuard 失败后用户主动重试
 *
 * 注意:
 *   - 自动重连 anon 的逻辑(SDK 发 SIGNED_OUT 时自动 signIn)由 AuthService 处理,
 *     AuthContext 只负责被动接收 state 变更
 *   - 不在此处触发 `create_family` RPC,那是 US-012 的事;AuthContext 只管"我是谁"
 *   - 不订阅 realtime,那是 SyncManager(T-SETUP-6)的事
 *   - T-US013-2:session 通过 subscribeAuthState listener 写入,不在这里手动 setSession
 *     — bootGuard 调 AuthService.signInAnonymously() 会触发 SDK onAuthStateChange(SIGNED_IN),
 *     listener 已订阅,自动 setSession。restoreSession 路径同理:订阅时 SDK 会发 INITIAL_SESSION,
 *     带当前 session 一起过来。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';

import {
  signInAnonymously as authServiceSignInAnonymously,
  clearSession as authServiceClearSession,
  subscribeAuthState,
  markIntentionalSignOut,
  type AuthState,
} from '../services/AuthService';
import { bootGuard } from '../lib/bootGuard';

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  /** T-US013-2 新增;rev1 收敛为 boolean:bootGuard 两次都失败时 true。
   *  Gate 据此渲染 SplashScreen error 模式 + 重试按钮;
   *  UI 文案由 SplashScreen 默认值(splash-v1.0 §6)统一管理,AuthContext 不掺文案 */
  bootError: boolean;
  signInAnonymously: () => Promise<void>;
  signOut: () => Promise<void>;
  /** T-US013-2 新增:用户点击"重试"按钮后调,重新跑一次 bootGuard */
  retryBoot: () => Promise<void>;
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
  // T-US013-2:bootGuard 失败时 true;Gate 据此切到 SplashScreen error 模式 + 重试按钮
  // T-US013-2-rev1:从 Error | null 收敛为 boolean,文案由 SplashScreen 默认值统一管理
  const [bootError, setBootError] = useState<boolean>(false);

  /**
   * 主动登出意图标记:
   *   - AuthService 内部有 module-level `intentionalSignOutFlag`(一次性),
   *     通过 `AuthService.markIntentionalSignOut()` 标记 — 见 AuthService §5。
   *   - AuthContext 此前还并行保留了一个 `intentionalSignOutRef` 做"双层防御",
   *     但 T-US013-1 重构后 AuthService 已直接接住 SDK 的 SIGNED_OUT 事件并消费 flag,
   *     AuthContext 这层 ref 实际未被任何 effect 读取 → 2026-09-17 review 标记为死代码并删除。
   *   - 现在:signOut() 直接调 AuthService.markIntentionalSignOut() + clearSession()。
   */

  useEffect(() => {
    let mounted = true;

    /**
     * 启动序列(T-US013-2):
     *   1. bootGuard() — 封装 restoreSession + signInAnonymously + retry-once(详见 src/lib/bootGuard)
     *   2. 订阅 AuthService.subscribeAuthState — 后续 token refresh / SIGNED_OUT 由它广播
     *
     * session 怎么落到 React state:
     *   - restoreSession 路径:SDK 内部从 SecureStore 读到 session,subscribeAuthState 在下面同步订阅,
     *     SDK 订阅瞬间会 emit INITIAL_SESSION 带当前 session → listener → setSession
     *   - signInAnonymously 路径:supabase.auth.signInAnonymously() 触发 onAuthStateChange(SIGNED_IN),
     *     listener 已注册 → setSession
     *   因此本函数不需要手动 setSession;只需根据 bootGuard 结果决定 setBootError。
     *
     * 关键:无论 ready/failed,最后都要 setIsLoading(false),否则 UI 永远停在 splash。
     *   ready 路径:session 由 listener 异步写入,isLoading 先 false,Gate 短暂渲染 splash → listener 触发 → session 落定
     *   failed 路径:bootError 落定,Gate 切 error 模式
     */
    const initialize = async (): Promise<void> => {
      try {
        const result = await bootGuard();
        if (!mounted) return;

        if (result.status === 'failed') {
          setBootError(true);
        }
        // ready → session 由 subscribeAuthState listener 写入(见上方注释)
      } catch (err) {
        // 兜底:bootGuard 自身不抛(内部 try/catch),理论上不到这;显式记一行
        // eslint-disable-next-line no-console
        console.error('[AuthContext] init threw unexpectedly:', err);
        if (mounted) {
          setBootError(true);
        }
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
      // AuthState 当前不含 'loading' 分支(SDK 启动前由 isLoading=true 表达),无需 switch 第三支
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
   *   2. 清 SDK session(SDK 内部清 SecureStore)
   *   3. 清 React state
   */
  const signOut = useCallback(async (): Promise<void> => {
    markIntentionalSignOut(); // 通知 AuthService 跳过自动重连
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
   * T-US013-2:用户点击 SplashScreen 错误模式的"重试"按钮后调用。
   *
   * 与 initialize 的差异:
   *   - 显式清掉 bootError(让 UI 立刻从 error 切回 loading 模式)
   *   - 走同一份 bootGuard 逻辑(retry-once 1s 退避照常生效),
   *     所以"重试"语义对用户是"再给我一次 2 次机会" 而不是"再来 1 次"
   *
   * 状态机:
   *   error → 点击重试 → 清 bootError + isLoading=true → bootGuard →
   *     ready → setIsLoading=false(session 由 listener 写入)→ UI 进业务屏
   *     failed → setBootError → UI 仍 error,可再次点击重试
   */
  const retryBoot = useCallback(async (): Promise<void> => {
    setBootError(false);
    setIsLoading(true);
    try {
      const result = await bootGuard();
      if (result.status === 'failed') {
        setBootError(true);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[AuthContext] retryBoot threw unexpectedly:', err);
      setBootError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * useMemo 包 value,避免引用变更触发消费侧不必要的 re-render。
   * (虽然本组件目前消费侧没有用 memo,但养成习惯。)
   */
  const value = useMemo<AuthContextValue>(
    () => ({ user, session, isLoading, bootError, signInAnonymously, signOut, retryBoot }),
    [user, session, isLoading, bootError, signInAnonymously, signOut, retryBoot],
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
