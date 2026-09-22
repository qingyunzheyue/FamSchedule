/**
 * FamilyService — family 业务逻辑层 — T-US012-1
 *
 * 职责(family 生命周期,纯数据层):
 *   1. createFamily()    — 调 supabase.rpc('create_family')(db-v1.1.sql §4.1,无参),
 *                          创建新 family + creator 行 + 默认 family_settings
 *   2. acceptInvite(code)— 调 supabase.rpc('accept_invite', { p_code })(db-v1.1.sql §4.3),
 *                          把当前 user 加入 family + 标记 invite_code used
 *   3. createInvite()    — 调 supabase.rpc('create_invite')(db-v1.1.sql §4.2,无参),
 *                          生成 6 位数字邀请码 + 10 分钟过期时间戳(ADR-004)
 *   4. getMyFamily()     — 查 family_members + families + 同 family 所有 members,
 *                          返回 FamilyContextValue | null
 *   5. _resetForTests()  — 清 module-level cache(给 jest 用,与 AuthService 对齐)
 *
 * 设计依据:
 *   - RLS deny-by-default(arch-v1.0 §10.4):所有 family 维度写必须走 RPC,
 *     直接 .from('families').insert() 会被 RLS 拒绝。
 *     所以 createFamily / acceptInvite / createInvite 走 RPC,读(getMyFamily)走 .from() + RLS 放行。
 *   - ADR-004(Invite codes):10 分钟过期 + atomic UPDATE,客户端只发码,过期判定服务端做
 *   - 单一职责:本模块只管 family 维度;AuthService 管 auth,SyncManager 管 Realtime + 离线队列,
 *     LocalStore 管本地缓存。三者解耦,FamilyContext(React 层)只调本模块。
 *
 * 模块形态:
 *   - 模块级函数(不是 class)— 匹配 AuthService / SyncManager / LocalStore 的风格
 *   - module-level cache:`cachedFamily` + `cachedFamilyId` 给 getMyFamily 复用,
 *     创建/加入成功后下次 getMyFamily 不用再查。测试隔离由 _resetForTests() 重置。
 *   - 错误处理:**不抛错**,返回 discriminated union,UI 决定怎么显示。
 *     理由:family 操作常被 onboarding 流程调用,启动期抛错会让 UI 卡 splash;
 *     让上层拿到结构化 status 决定是否 retry / showError 更稳。
 *
 * Result 类型(discriminated union):
 *   - createFamily:
 *       { status: 'created'; familyId; familyName }   — 成功
 *       { status: 'already_in_family'; existingFamilyId } — 调用方已有 family(pre-check 命中)
 *       { status: 'failed'; reason }                  — RPC 抛错或 DB 拒
 *   - acceptInvite:
 *       { status: 'joined'; familyId; memberId }      — 成功
 *       { status: 'invalid_code' }                    — 邀请码无效/不存在(由服务端 error 命中)
 *       { status: 'expired' }                         — 邀请码已过期
 *       { status: 'already_in_family' }               — 调用方已有 family
 *   - createInvite:
 *       { status: 'created'; code; expiresAt }        — 成功
 *       { status: 'failed'; reason }                  — RPC 抛错(常见:Caller not in family)
 *
 * ⚠️ FamilyRow 当前没有 name 列(families 表只有 id/created_by/created_at,见 database.ts §41-45),
 *    家庭名未来走 family_settings 默认行(US-012 后续任务)。所以 familyName 暂时恒为 '我的家庭',
 *    是已知的设计债,不是 bug。
 *
 * ⚠️ create_invite SQL 签名是 **无参**(`create_invite()`)— db-v1.1.sql §4.2 / database.ts §163
 *    `CreateInviteArgs = undefined`;family_id 由服务端用 `auth.uid()` 查 family_members 推导出。
 *    TTL 也是服务端硬编码 `now() + interval '10 minutes'`,客户端不能 override。
 *    任务 brief 里写的 `{p_family_id, p_ttl_minutes?}` 与 schema 不一致 — 以 db-v1.1.sql 为准。
 */

import { supabase } from '../lib/supabase';
import type { FamilyRow, FamilyMemberRow } from '../types/database';

// =====================================================================
// Types
// =====================================================================

/**
 * getMyFamily 返回的完整 family 维度信息 — 给 FamilyContext / family dashboard 用。
 *
 * `myRole` 由 `family.created_by === currentUser.id` 推导(FamilyMemberRow 没 role 列,
 * 见 database.ts §47-51;family 表有 created_by 列,database.ts §42,更准确)。
 */
export interface FamilyContextValue {
  family: FamilyRow;
  members: FamilyMemberRow[];
  myRole: 'creator' | 'member';
}

/** createFamily 的结构化返回。 */
export type CreateFamilyResult =
  | { status: 'created'; familyId: string; familyName: string }
  | { status: 'already_in_family'; existingFamilyId: string }
  | { status: 'failed'; reason: string };

/** acceptInvite 的结构化返回。 */
export type AcceptInviteResult =
  | { status: 'joined'; familyId: string; memberId: string }
  | { status: 'invalid_code' }
  | { status: 'expired' }
  | { status: 'already_in_family' };

/** createInvite 的结构化返回。 */
export type CreateInviteResult =
  | { status: 'created'; code: string; expiresAt: string }
  | { status: 'failed'; reason: string };

// =====================================================================
// Module state (singleton cache)
// =====================================================================

/**
 * 最近一次 getMyFamily() 拿到的 family 行。给 createFamily / acceptInvite 后立即复用,
 * 避免成功后还要再查一次 families 表(典型 case:RPC 成功 → fetch family → 返回 → UI 渲染)。
 */
let cachedFamily: FamilyRow | null = null;

/**
 * 最近一次 family 操作(family_members / family creation)拿到的 family_id。
 * 给 subscribeFamily / SyncManager 等后续模块快速消费用(本模块不直接 subscribe,
 * 但缓存住免得每次都查 family_members)。
 */
let cachedFamilyId: string | null = null;

// =====================================================================
// 5. createInvite (T-US012-2 新增)
// =====================================================================

/**
 * 生成一个新的 6 位数字邀请码(US-012,ADR-004)。
 *
 * SQL 签名(db-v1.1.sql §4.2):`create_invite()` **无参**。
 *   - family_id 由服务端用 `auth.uid()` 查 family_members 推导(SELECT family_id ... LIMIT 1)
 *   - expires_at 硬编码 `now() + interval '10 minutes'`,客户端不可 override
 *   - 返回单行 `{code TEXT, expires_at TIMESTAMPTZ}`
 *
 * 错误码映射(db-v1.1.sql §4.2 + 测试已知场景):
 *   - "Caller is not in any family" → failed(reason 透传,UI 显示「你还没加入家庭」)
 *   - "Not authenticated"           → failed(同上传)
 *   - "Failed to generate unique invite code after 5 attempts" → failed(理论上概率极低)
 *   - 其他 → failed(reason = error.message)
 *
 * 不抛错。
 *
 * ⚠️ 与 `acceptInvite` / `createFamily` 区别:本函数**没有 pre-check**(因为没输入参数,
 *    family_id 完全服务端推导;调用方已经在 family 里由 Gate 保证了 — 在 in_family 状态
 *    下才进 InviteScreen 路由,FamilyContext.refresh 触发后 family.status = in_family)。
 *    跳过 pre-check 让 RPC 直接做 authoritative 判断,避免双重查表。
 */
export async function createInvite(): Promise<CreateInviteResult> {
  // supabase-js typed Database 在 RPC 上有 Args narrowing quirk,
  // 按 SyncManager.ts:425 / acceptInvite 模式用 `as CallableFunction` cast 规避。
  const { data, error } = await (supabase.rpc as CallableFunction)(
    'create_invite',
  ) as {
    data: { code: string; expires_at: string } | null;
    error: { message: string } | null;
  };

  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[FamilyService] create_invite rpc error:', error.message);
    return { status: 'failed', reason: error.message };
  }

  if (!data) {
    // 兜底:SQL 总会 RETURN QUERY,data 为 null 不太可能出现 — 但保留 explicit 防御
    // eslint-disable-next-line no-console
    console.warn('[FamilyService] create_invite rpc returned no data');
    return { status: 'failed', reason: 'create_invite rpc returned no data' };
  }

  return {
    status: 'created',
    code: data.code,
    expiresAt: data.expires_at,
  };
}

// =====================================================================
// 1. createFamily
// =====================================================================

/**
 * 创建一个新 family,调用方自动成为 creator。
 *
 * 流程:
 *   1. **pre-check**:查 family_members 是否已存在 row(避免重复创建)。
 *      若有 → 返回 already_in_family(existingFamilyId),让 UI 直接跳 dashboard。
 *   2. **RPC**:调 supabase.rpc('create_family')(无参,db-v1.1.sql §4.1)。
 *      - 成功 → 返回新 family_id(uuid string)
 *      - 失败 → 返回 failed(reason = error.message)
 *   3. **post-fetch**:拿到 family_id 后查 families 行拿 created_by,顺便填 cache。
 *   4. 返回 created{familyId, familyName(恒 '我的家庭' 暂态)}。
 *
 * 不抛错:UI 拿到结构化 status 决定 retry / showError。
 * 与 AuthService.signInAnonymously 风格对齐。
 */
export async function createFamily(): Promise<CreateFamilyResult> {
  // 1. Pre-check:调用方是否已在 family?
  const existing = await getMyFamily();
  if (existing) {
    return {
      status: 'already_in_family',
      existingFamilyId: existing.family.id,
    };
  }

  // 2. 调 RPC
  const { data, error } = await supabase.rpc('create_family');
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[FamilyService] create_family rpc error:', error.message);
    return { status: 'failed', reason: error.message };
  }

  // data 是 family_id uuid string(db-v1.1.sql §4.1 Returns 声明)
  const familyId = data as unknown as string;
  cachedFamilyId = familyId;

  // 3. 拿 family 详情填 cache
  const { data: familyRow } = await supabase
    .from('families')
    .select('*')
    .eq('id', familyId)
    .single<FamilyRow>();
  if (familyRow) {
    cachedFamily = familyRow;
  }

  // 4. 返回 created。familyName 暂态:FamilyRow 没 name 列,
  // 真正名字未来走 family_settings(US-012 后续)。这里硬编码 '我的家庭' 占位。
  return {
    status: 'created',
    familyId,
    familyName: '我的家庭',
  };
}

// =====================================================================
// 2. acceptInvite
// =====================================================================

/**
 * 用邀请码加入 family。
 *
 * 流程:
 *   1. **pre-check**:若调用方已有 family → already_in_family(避免重复加入)。
 *   2. **RPC**:supabase.rpc('accept_invite', { p_code })(db-v1.1.sql §4.3)。
 *      - 成功 → 返回 family_id(uuid string)
 *      - 失败 → 根据 error.message 关键字映射 invalid_code / expired
 *   3. **post-fetch**:成功 → refresh getMyFamily 填 cache(因为现在有 family 了)。
 *   4. 返回 joined{familyId, memberId}。
 *
 * 错误码映射(基于 db-v1.1.sql §4.3 实现 + ADR-004):
 *   - "invalid" / "not found" / "no invite" → invalid_code
 *   - "expired" / "expire" → expired
 *   - 其他 → invalid_code(兜底,避免漏分类)
 *
 * 不抛错。
 */
export async function acceptInvite(code: string): Promise<AcceptInviteResult> {
  // 1. Pre-check
  const existing = await getMyFamily();
  if (existing) {
    return { status: 'already_in_family' };
  }

  // 2. 拿当前 user.id 用于下面 member_id 解析
  // acceptInvite 流程里 getMyFamily 内部也会 getUser,但 userId 是局部变量,
  // 这里再拿一次让 memberId 解析能用。
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id ?? '';

  // 3. 调 RPC(supabase-js typed Database 在 RPC 上有 Args narrowing quirk,
  //    按 SyncManager.ts:425 注释用 `as never` cast 规避)
  const { data, error } = await (supabase.rpc as CallableFunction)(
    'accept_invite',
    { p_code: code },
  ) as { data: unknown; error: { message: string } | null };

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('invalid') || msg.includes('not found') || msg.includes('no invite')) {
      // eslint-disable-next-line no-console
      console.warn('[FamilyService] accept_invite invalid:', error.message);
      return { status: 'invalid_code' };
    }
    if (msg.includes('expired') || msg.includes('expire')) {
      // eslint-disable-next-line no-console
      console.warn('[FamilyService] accept_invite expired:', error.message);
      return { status: 'expired' };
    }
    // 兜底:其他错误归到 invalid_code(避免漏分类),但保留原始 message 在 console
    // eslint-disable-next-line no-console
    console.warn('[FamilyService] accept_invite error (fallback invalid_code):', error.message);
    return { status: 'invalid_code' };
  }

  // 4. data 是 family_id uuid string(db-v1.1.sql §4.3 Returns 声明)
  const familyId = data as unknown as string;
  cachedFamilyId = familyId;

  // 4. Refresh 一次填 cache + 拿 member_id
  // 注意:不能直接取 members[0].user_id,因为 RLS 返回的 members 数组顺序不定。
  // 用当前 user.id 匹配,确保是"我自己的那条 row"。
  const refreshed = await getMyFamily();
  const memberId = refreshed?.members.find((m) => m.user_id === userId)?.user_id ?? '';

  return {
    status: 'joined',
    familyId,
    memberId,
  };
}

// =====================================================================
// 3. getMyFamily
// =====================================================================

/**
 * 查询当前 user 的 family 上下文。
 *
 * 流程:
 *   1. 拿当前 user.id(supabase.auth.getUser → RLS 兜底)
 *   2. family_members 查自己那条 row → 拿 family_id + joined_at
 *      - 没有 → 返回 null(调用方不在任何 family)
 *   3. families 拿 family 详情 → 拿 created_by(用于推 myRole)
 *   4. family_members 拿同 family 所有 members
 *   5. 推 myRole:family.created_by === user.id → 'creator',else 'member'
 *   6. 填 cache + 返回 FamilyContextValue
 *
 * RLS:family_members / families 查询都受 RLS 约束 — 当前 user 只能看到自己相关的 row。
 * 上面第二步查"自己那条 row"RLS 放行;第四步查"同 family 所有 members"是否放行
 * 由 db-v1.1.sql §2.4 的 RLS 策略决定(假设:同 family members 互相可见)。
 *
 * 不抛错:family 查询错误 → 返回 null(等同"没 family",Gate 自然走 onboarding)。
 * 这样 UI 不需要专门处理 query error,与 AuthService.restoreSession 兜底策略对齐。
 */
export async function getMyFamily(): Promise<FamilyContextValue | null> {
  // 1. 拿当前 user
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    // 没登录(理论上 Gate 不会走到这,AuthProvider 已拦住)→ 当成 no_family 处理
    return null;
  }
  const userId = userData.user.id;

  // 2. 查自己的 family_member row
  const { data: memberRow, error: memberErr } = await supabase
    .from('family_members')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle<FamilyMemberRow>();

  if (memberErr || !memberRow) {
    // 错误或没有 row → 没 family
    return null;
  }

  const familyId = memberRow.family_id;
  cachedFamilyId = familyId;

  // 3. 拿 family 详情
  const { data: familyRow, error: familyErr } = await supabase
    .from('families')
    .select('*')
    .eq('id', familyId)
    .single<FamilyRow>();

  if (familyErr || !familyRow) {
    // family_members 有但 families 找不到(数据不一致)→ 当成 no_family
    return null;
  }
  cachedFamily = familyRow;

  // 4. 拿同 family 所有 members
  const { data: membersRows } = await supabase
    .from('family_members')
    .select('*')
    .eq('family_id', familyId);
  const members = (membersRows ?? []) as FamilyMemberRow[];

  // 5. 推 myRole
  const myRole: 'creator' | 'member' =
    familyRow.created_by === userId ? 'creator' : 'member';

  return {
    family: familyRow,
    members,
    myRole,
  };
}

// =====================================================================
// 4. 测试 / 调试出口
// =====================================================================

/**
 * 仅供测试 / debug 用。生产 bundle 仍会保留,但业务侧不应调用。
 *
 * 用法:清 module-level cache(cachedFamily / cachedFamilyId)。
 * 与 AuthService._resetForTests / SyncManager._resetForTests 对齐 —
 * 让多个测试 case 互不污染。
 */
export function _resetForTests(): void {
  cachedFamily = null;
  cachedFamilyId = null;
}

// =====================================================================
// 6. FamilyService namespace(T-US012-2 新增,UI 层 sugar 入口)
// =====================================================================

/**
 * `FamilyService` namespace — 把模块级函数包装成对象,便于 UI 层(尤其 React 组件)import。
 *
 * 为什么有"命名函数 + namespace 对象"双形态:
 *   - 单元测试 / 单函数调用方走命名 export(`import { createInvite } from ...`)
 *   - React 组件 / UI 层走 namespace(`import { FamilyService } from ...`,
 *     写 `FamilyService.createInvite()` 更接近 OOP 调用风格,且未来方便整组替换 mock)
 *
 * 这是 UI 友好的 thin wrapper,**不持有任何状态**(状态仍在 module-level cache),
 * 也不参与错误处理(继承各函数的 discriminated union 返回)。
 */
export const FamilyService = {
  createFamily,
  acceptInvite,
  createInvite,
  getMyFamily,
};