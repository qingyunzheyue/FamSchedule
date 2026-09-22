/**
 * FamilyContext — T-US012-1 重构引入
 *
 * 职责(从 T-US012-1 起,业务逻辑下沉到 FamilyService):
 *   1. 订阅 useAuth().session(session 变化时重新拉 family 上下文)
 *   2. mount 时调 FamilyService.getMyFamily() 填充初始状态
 *   3. 暴露 refresh() 给 UI:pair-create / pair-join RPC 成功后调一次,刷新缓存
 *   4. 把 FamilyState 翻译成 React state,消费侧用 useFamily() / useFamilyValue()
 *
 * 设计动机(为什么要新加 Context):
 *   - 原 Gate(app/_layout.tsx)有 inline family 查询 useEffect,直接调 supabase
 *     .from('family_members')。T-US012-1 把这条路径下沉到 FamilyService + FamilyContext。
 *   - Gate 改成消费 useFamily() — 单状态来源,不再重复维护 familyId / familyLoading。
 *   - family 维度操作(createFamily / acceptInvite)的 React-facing 副作用(刷新
 *     context)由本模块统一管理,UI 调完 Service 后只需 refresh() 一次。
 *
 * FamilyState 是 discriminated union(TS exhaustiveness 检查):
 *   - loading     : 初始 / refresh 中 — UI 等渲染,不展示业务屏
 *   - no_family   : 当前 user 不在任何 family — UI 跳 onboarding
 *   - in_family   : 有 family + members + myRole — UI 渲染业务屏
 *
 * 暴露 API:
 *   - state: FamilyState
 *   - refresh(): Promise<void>  — 手动重拉(create/accept 成功后调)
 *   - useFamilyValue(): FamilyContextValue | null  — sugar hook,
 *     等价于 state.status === 'in_family' ? state.value : null
 *
 * 装配顺序(必须严守):
 *   <AuthProvider>
 *     <FamilyProvider>  ← FamilyProvider 用 useAuth(),必须在 AuthProvider 内
 *       <Gate />
 *     </FamilyProvider>
 *   </AuthProvider>
 *   见 app/_layout.tsx
 *
 * 注意:
 *   - 自动重连 / 离线重连不归本模块管(那是 SyncManager T-SETUS6 的事,
 *     本模块只负责"当前 family 是哪个 + 我在不在")。
 *   - 不暴露 createFamily / acceptInvite 动作(action 走 service,本模块只管 state)
 *   - 与 AuthService / AuthContext 的协作:session 变化 → 自动 refresh;
 *     sign out → 自动 no_family
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

import { useAuth } from './AuthContext';
import {
  getMyFamily as familyServiceGetMyFamily,
  type FamilyContextValue,
} from '../services/FamilyService';

/**
 * FamilyContext 对外暴露的形态。
 *
 * `state` 是 discriminated union(loading / no_family / in_family);
 * `refresh` 是手动刷新钩子,createFamily / acceptInvite 成功后调。
 */
export interface FamilyContextValue_Export {
  state: FamilyState;
  refresh: () => Promise<void>;
}

export type FamilyState =
  | { status: 'loading' }
  | { status: 'no_family' }
  | { status: 'in_family'; value: FamilyContextValue };

const FamilyContext = createContext<FamilyContextValue_Export | null>(null);

interface FamilyProviderProps {
  children: ReactNode;
}

/**
 * FamilyProvider — 包裹在 AuthProvider 内、Gate 外。
 * 依赖 useAuth().session:session 变化(anon sign-in / sign out)→ 自动 refresh。
 */
export function FamilyProvider({ children }: FamilyProviderProps) {
  const { session } = useAuth();
  const [state, setState] = useState<FamilyState>({ status: 'loading' });

  /**
   * 重新拉 family 状态:
   *   - 没 session → no_family(AuthProvider 应已拦住,这里兜底)
   *   - 有 session → 调 FamilyService.getMyFamily()
   *     - 返回 FamilyContextValue → in_family
   *     - 返回 null → no_family(RLS 兜底或真没 family)
   *
   * refresh 期间切到 loading 状态,UI(Gate)渲染 SplashScreen,不闪业务屏。
   */
  const refresh = useCallback(async (): Promise<void> => {
    if (!session) {
      setState({ status: 'no_family' });
      return;
    }

    setState({ status: 'loading' });
    try {
      const value = await familyServiceGetMyFamily();
      setState(
        value
          ? { status: 'in_family', value }
          : { status: 'no_family' },
      );
    } catch (err) {
      // FamilyService.getMyFamily 不抛(内部 try/catch);理论上不到这。
      // 显式兜底:console.error + 当 no_family 处理。
      // eslint-disable-next-line no-console
      console.error('[FamilyContext] refresh threw unexpectedly:', err);
      setState({ status: 'no_family' });
    }
  }, [session]);

  /**
   * 订阅 session 变化 — anon sign-in / sign out 时自动重拉。
   *
   * 注意:依赖 refresh 而不是 session 直接。refresh 在 session 变化时
   * useCallback 会重生成闭包(包含最新 session 判断);effect 用 refresh
   * 做 deps 即可保证 session 变 → refresh 重生成 → effect 重跑。
   */
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<FamilyContextValue_Export>(
    () => ({ state, refresh }),
    [state, refresh],
  );

  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>;
}

/**
 * useFamily — 业务侧取 FamilyContext 唯一入口。
 * 在 FamilyProvider 外使用会抛错,避免静默取到 null。
 *
 * 返回 `{ state, refresh }`:
 *   - state 是 discriminated union,switch 时 TS 会强制穷举
 *   - refresh() 用于 pair-create / pair-join RPC 成功后手动重拉
 */
export function useFamily(): FamilyContextValue_Export {
  const ctx = useContext(FamilyContext);
  if (!ctx) {
    throw new Error('useFamily must be used within <FamilyProvider>');
  }
  return ctx;
}

/**
 * useFamilyValue — sugar hook,只在用户有 family 时返回 value,否则 null。
 *
 * 大多数 UI(family dashboard / member list / sync hooks)只关心"我有没有 family
 * 以及是哪个";他们不写 switch。所以抽这个 hook 简化消费侧。
 *
 * 例:
 *   const family = useFamilyValue();
 *   if (!family) return <Redirect href="/(onboarding)/pair-create" />;
 *   // 此时 family.family / family.members / family.myRole 全部非空
 */
export function useFamilyValue(): FamilyContextValue | null {
  const { state } = useFamily();
  return state.status === 'in_family' ? state.value : null;
}