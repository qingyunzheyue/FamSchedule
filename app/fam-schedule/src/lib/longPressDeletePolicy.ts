/**
 * 列表 long-press 删除的 pre-check 决策 — T-FIX-06-A M08/M09
 *
 * 抽成独立模块(而非嵌在 HomeScreen.tsx)的理由:
 *   - HomeScreen.tsx 顶层 import 链路过重(expo-router / tamagui / phosphor / 多个
 *     context / hook),jest-expo preset 下不 mock 整套会触发 SafeAreaProvider lookup
 *     invariant(测试加载 HomeScreen 全树会崩)。把决策函数独立出来后,jest 可直接
 *     import 此模块,不触发 HomeScreen 的副作用 import 链。
 *   - 决策逻辑独立可单测,HomeScreen 只用决策结果做 UI 分支,职责清晰。
 *   - 未来若 TaskCard 也加 onLongPress 门控(brief "可选"),可复用同一函数。
 *
 * 3 个互斥分支(顺序在 HomeScreen.handleTaskLongPress 保持一致):
 *   - 'template'    : 模板任务(template_id !== null)— 留给详情页级联操作
 *   - 'spouse_done' : 已完成但完成人不是当前用户(配偶先完成)— 防误删破坏
 *                      ADR-005 first-finisher 契约
 *   - 'ok'          : 可继续走 showConfirmDialog 二次确认(M08)
 */

import type { Task } from './LocalStore';

export type LongPressDeleteDecision = 'ok' | 'template' | 'spouse_done';

/**
 * 列表 long-press 删除前的 owner pre-check 决策。
 *
 * @param task — 当前 long-press 的任务
 * @param currentUserId — 当前登录用户 id(空字符串 = 未登录;视为 spouse_done 兜底,
 *   防止"未登录态误删配偶完成任务的 row")
 * @returns 三态 decision('ok' | 'template' | 'spouse_done')
 */
export function canLongPressDeleteTask(
  task: Task,
  currentUserId: string,
): LongPressDeleteDecision {
  if (task.template_id !== null) {
    return 'template';
  }
  if (task.completed_by !== null && task.completed_by !== currentUserId) {
    return 'spouse_done';
  }
  return 'ok';
}
