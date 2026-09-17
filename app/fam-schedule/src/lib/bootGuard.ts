/**
 * bootGuard — T-US013-2 启动守卫
 *
 * 职责:启动期"给我一个可用 session",失败**重试 1 次**后给出明确失败信号。
 *
 * 流程(对应 PRD US-013 DoD #3 "无 user → 调 signInAnonymously,失败重试 1 次,再失败报错退出"):
 *   1. AuthService.restoreSession() — 优先用 SDK 已从 SecureStore 恢复的 session(冷启动有缓存时直接 ready)
 *   2. AuthService.signInAnonymously() — 第 1 次尝试
 *   3. 失败 → 等 1 秒 → AuthService.signInAnonymously() — 第 2 次(也是唯一一次重试)
 *   4. 仍失败 → 返回 { status: 'failed' } 让上层渲染错误 UI
 *      (bootGuard 不带 error 文案:UI 文案是 SplashScreen 的默认值,
 *      集中管理避免 i18n 时漏改 — 详见 T-US013-2 review Major #1)
 *
 * 为什么 retry 1 次(不无限重试 / 不 0 重试):
 *   - 0 重试 → 启动期网络抖动直接报错退出,首启体验差
 *   - 无限重试 → 永久卡 splash,首启变成"卡死"bug
 *   - 1 次重试 + 1s 等待 → 覆盖绝大多数瞬态故障(carrier handoff / captive portal /
 *     DNS 解析瞬时失败),又不至于让用户等太久
 *
 * 为什么调用 AuthService.signInAnonymously()(而不是 supabase.auth.* 直调):
 *   - AuthService 已封装 try/catch + signed_out 返回结构,bootGuard 只需处理重试时序
 *   - AuthService.signInAnonymously() 成功后会触发 SDK onAuthStateChange(SIGNED_IN),
 *     AuthContext 已订阅此事件 → session 落到 React state;bootGuard 不需要直接 setSession
 *
 * 副作用:本函数无 React 副作用,是纯异步工具函数;调用方负责把 BootResult 翻译成 UI 状态。
 */

import {
  restoreSession,
  signInAnonymously,
  type AuthState,
} from '../services/AuthService';

/**
 * bootGuard 结果。discriminated union 让消费侧 switch(BootResult.status) 能被 TS
 * exhaustiveness 检查,不会漏分支。
 *
 * 失败分支不带 error 文案(T-US013-2 review Major #1 收敛):
 *   - 原 `{ status: 'failed', error: new Error('无法连接到服务器...') }` 与
 *     SplashScreen 的 DEFAULT_ERROR_MESSAGE 文案重复,i18n 时必须改两处
 *   - 现在 UI 文案由 SplashScreen 单一来源管理(splash-v1.0.md §6);
 *     bootGuard 只表达"成败"语义,不掺杂 UI 文案
 */
export type BootResult =
  | { status: 'ready' }
  | { status: 'failed' };

/**
 * 两次 signInAnonymously 之间的退避时间。1s 覆盖大多数瞬态网络问题又不至于让用户久等。
 */
const RETRY_DELAY_MS = 1000;

/**
 * 启动守卫主函数。详见模块顶部 JSDoc。
 */
export async function bootGuard(): Promise<BootResult> {
  // 1. 优先用 SDK 已恢复的 session(冷启动有 SecureStore 缓存时直接 ready)
  const restored = await restoreSession();
  if (isReady(restored)) {
    return { status: 'ready' };
  }

  // 2. 第 1 次 anon sign-in
  const first = await signInAnonymously();
  if (isReady(first)) {
    return { status: 'ready' };
  }

  // 3. 退避 1 秒后重试 1 次(总共恰好 2 次 attempt)
  await delay(RETRY_DELAY_MS);
  const second = await signInAnonymously();
  if (isReady(second)) {
    return { status: 'ready' };
  }

  // 4. 两次都失败 → 上层渲染错误 UI(本 MVP "再失败报错退出" 的报错 = 阻塞错误占位 + 重试按钮,
  //    让用户决定重试或退出,而不是默默重连)。文案由 SplashScreen 默认值统一管理,
  //    bootGuard 不掺杂 UI 文案(见 type 注释 + T-US013-2 review Major #1)
  return { status: 'failed' };
}

// ---- 内部工具 -----------------------------------------------------------

function isReady(state: AuthState): boolean {
  return state.status === 'signed_in';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}