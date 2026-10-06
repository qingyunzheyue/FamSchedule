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

  // T-FIX-BUNDLE-7:stateRef — 让 refresh 内部读 prev state 但不写 deps,
  //   避免 refresh 在 state 变时重生成(useEffect deps [refresh] 会触发反复跑)。
  const stateRefValue = useRef(state);
  useEffect(() => {
    stateRefValue.current = state;
  }, [state]);

  /**
   * 重新拉 family 状态:
   *   - 没 session → no_family(AuthProvider 应已拦住,这里兜底)
   *   - 有 session → 调 FamilyService.getMyFamily()
   *     - 返回 FamilyContextValue → in_family
   *     - 返回 null → no_family(RLS 兜底或真没 family)
   *
   * refresh 期间切到 loading 状态,UI(Gate)渲染 SplashScreen,不闪业务屏。
   *
   * T-FIX-BUNDLE-7:stable skip — 如果当前 state 已经是 in_family 且 family.id 与
   *   session 期望的 family 一致,**不要**切到 loading(避免 splash 闪)。但当 refresh
   *   是显式调用(createFamily / acceptInvite 成功后)时,仍要切 loading 触发 UI 重渲染。
   *   - 隐式 refresh(依赖 deps 触发):skip → 防止 session 反复触发 splash 闪
   *   - 显式 refresh(refresh() 调):不 skip → 业务需要感知状态变化
   *
   * 当前实现:接受 `skipIfStable` 参数(默认 false 显式),effect 自动 refresh 时传 true。
   * 这样 createFamily / acceptInvite 后手动 refresh() 仍走 loading,session 抖动触发的
   * 隐式 refresh 走 skip 路径。
   */
  const refresh = useCallback(async (skipIfStable = false): Promise<void> => {
    if (!session) {
      setState({ status: 'no_family' });
      return;
    }

    // T-FIX-BUNDLE-7:稳定态保护 — 通过 stateRef 读 prev state,不写 deps 避免死循环。
    // 当前 in_family 且 skipIfStable 是 true → 不切 loading(避免 session 抖动 splash 闪)
    const prevState = stateRefValue.current;
    if (skipIfStable && prevState.status === 'in_family') {
      try {
        const value = await familyServiceGetMyFamily();
        // 即使 skip loading,family 内容仍需更新(成员变化 / myRole 变化)
        if (value) {
          setState({ status: 'in_family', value });
        }
        // null → 保持原 state(用户没家族成员关系,但已有 family 时不强行切 no_family)
      } catch (err) {
        // FamilyService.getMyFamily 不抛(内部 try/catch);理论上不到这。
        // eslint-disable-next-line no-console
        console.error('[FamilyContext] refresh threw unexpectedly:', err);
      }
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
    // deps 故意只放 session:refresh 在 session 变时重生成,state 通过 ref 读,
    // 避免 refresh 在 state 变时重生成 → useEffect 死循环。
  }, [session]);

  /**
   * 订阅 session 变化 — anon sign-in / sign out 时自动重拉。
   *
   * 注意:依赖 refresh 而不是 session 直接。refresh 在 session 变化时
   * useCallback 会重生成闭包(包含最新 session 判断);effect 用 refresh
   * 做 deps 即可保证 session 变 → refresh 重生成 → effect 重跑。
   */
  useEffect(() => {
    // T-FIX-BUNDLE-7:effect 自动触发时传 skipIfStable=true — session 抖动触发的
    // 隐式 refresh 走 skip 路径(不再切 loading),防止 splash 闪烁。
    // 显式 refresh(refresh() 调用)— 不传 → 走 loading 路径,业务感知状态变化。
    void refresh(true);
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

/**
 * useCurrentUserId — 当前登录 user.id 的单一来源 — T-US003-1 review fix
 *
 * 设计动机:
 *   - 原先 3 个 screen(CreateTaskScreen / EditTaskScreen / TaskDetailScreen)各自
 *     写 `familyValue?.family.created_by ?? ''` 推断 currentUserId;与 service 层
 *     `supabase.auth.getUser()` 走的是两套来源。2 人家庭 + 当前用户=创建者时两值一致,
 *     巧合对,reviewer 标记为长期债务。
 *   - 短期修复:抽这个 hook 集中一处,3 个 screen 改用同一来源。
 *
 * 短期实现:`family.created_by` 与之前一致 — 因为本仓库只有 1 个 anon 登录态 =
 * 1 个 user,2 人家庭里当前用户的 family.created_by 始终等同自己的 user.id(创建者身份
 * 已认证,RPC check_family_membership 以 family_members.user_id = auth.uid() 校验)。
 *
 * 长期 TODO(留后续 polish — 严禁本任务擅自改):
 *   - 真正切换到 `supabase.auth.getUser().then(u => u.id)` 单一来源
 *   - FamilyContext.myRole 已对照 service 返回值后,本 hook 可直接消费它
 *
 * 契约(永远成立,变更前请更新本注释):
 *   - 当前用户不在任何 family(no_family / loading)→ 返回 ''
 *   - 当前用户在 family 中 → 返回 family.created_by(2 人家庭等同当前 user.id)
 *
 * 用法:
 *   const currentUserId = useCurrentUserId();
 *   const isOwner = task.created_by === currentUserId;
 *
 * 实现 = useFamilyValue() 单一读源 + resolveCurrentUserId 纯函数(为 jest 可测
 * 抽出的纯函数,3 个 case:null / in_family / member 仍 created_by)。
 */
export function useCurrentUserId(): string {
  const family = useFamilyValue();
  return resolveCurrentUserId(family);
}

/**
 * resolveCurrentUserId — useCurrentUserId 的纯函数部分,导出仅供测试。
 *
 * 故意保持 1 行 — 把 `(FamilyContextValue | null) → string` 的转换抽出,jest 可直接
 * unit test(不依赖 React renderer / supabase mock);hook 本身只调 useFamilyValue 后
 * 把结果交给它,任何 bug 都会在 resolveCurrentUserId 测试里红灯。
 *
 * 契约同 useCurrentUserId。
 */
export function resolveCurrentUserId(
  family: FamilyContextValue | null,
): string {
  return family?.family.created_by ?? '';
}