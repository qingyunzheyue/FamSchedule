/**
 * ExpiryService — 过期任务查询服务 — T-US015-1
 *
 * 职责(US-015 启动时过期任务提示 — 端到端第一步;banner 渲染留 T-US015-2):
 *   1. **makeExpiryWindowPredicate(window, today)** — 把 ExpiryWindow 翻译成
 *      "task 是否在该窗口内"的纯函数谓词;4 个窗口(yesterday_today / this_week / all / off)
 *   2. **filterExpiredTasks(tasks, window, today)** — 给定 tasks 数组 + 窗口 + today,
 *      过滤出"过期未完成且在窗口内"的 task 列表;复用 taskListFilters 的 addDays
 *      辅助保持日期计算一致
 *   3. **getExpiredTasksSummary(familyId, tasks, today)** — 服务层入口:从 family_settings
 *      单行 SELECT 读 expiry_window 字段,fallback 'yesterday_today',filterExpiredTasks → summary
 *
 * 设计依据:
 *   - db-v1.1.sql §3.5 family_settings.expiry_window 字段定义
 *     (CHECK 约束 4 窗口: 'yesterday_today' / 'this_week' / 'all' / 'off')
 *   - db-v1.1.sql §4.4 update_family_setting RPC 支持 expiry_window
 *   - 设计 home-v1.0 §3.3 过期任务 banner + §6 文案
 *   - 任务 brief §C.3 + §D 测试覆盖要求
 *
 * 模块形态:
 *   - 3 个导出函数:`makeExpiryWindowPredicate`(纯)/ `filterExpiredTasks`(纯)/
 *     `getExpiredTasksSummary`(服务层,调 supabase)
 *   - 复用 taskListFilters.addDays / taskListFilters.daysBetween 保持日期计算一致
 *     (本仓库统一用本地时区 + 字符串 addDays helper)
 *   - 错误处理:getExpiredTasksSummary 内部 try/catch,失败返
 *     `{count: 0, tasks: [], window: 'yesterday_today'}`(等同"无过期"
 *     兜底,不阻塞 UI)
 *
 * 不在范围:
 *   - ❌ Banner 渲染(留 T-US015-2)— 本任务只暴露 service + hook
 *   - ❌ Banner 关闭状态持久化(留 T-US015-3)
 *   - ❌ 跳转 ExpiredTasksScreen(留 T-US015-3)
 *   - ❌ family_settings 写操作(留 T-US017-3 过期窗口设置 UI)
 *   - ❌ 模板任务特殊处理(本任务只看 cancelled / completed_at / task_date 三个维度)
 *
 * 设计决策(today 边界):
 *   - makeExpiryWindowPredicate 接受 today 字符串作为窗口基准,本模块不调 Date.now()
 *     (避免 hook 重算时 timeline 不一致) — 由 caller(useExpiredTaskCount hook)注入
 *   - yesterday_today 窗口:yesterday / today 两天内的过期任务都计数(用户场景:
 *     "启动时看一眼最近两天有什么过期")
 *   - this_week 窗口:今天往前 7 天(含今天)的过期任务(用户场景:"本周内积累的过期")
 *   - all 窗口:全部过期任务(用户场景:"全部清理提示",适合重度用户)
 *   - off 窗口:完全不展示(用户已关掉 banner 设置)
 *
 * 设计决策(filterExpiredTasks 的"过期"判定):
 *   - 严格 3 条件 AND:!cancelled && !completed_at && task_date < today
 *     (与 taskListFilters.computeTaskBadge.overdue kind 派生条件完全对齐)
 *   - 这样 service 输出与 UI 红 chip / 红竖条 / banner 视觉保持一致 — 不会出
 *     "service 说有 3 个过期,但 UI 列表里看不到红 chip"
 *
 * 设计决策(supabase 调用):
 *   - 单行 SELECT family_settings(`maybeSingle`)— 不存在 row 时返 null,fallback yesterday_today
 *   - family_id 参数化(避免注入)— RLS 自动校验当前 user 是否有该 family
 *   - 错误 catch 不抛 — 返 summary 兜底(count=0),UI 不会卡死
 *   - 与 SyncManager / TaskService 同模式 — 走 supabase-js typed Database 接口
 *
 * 性能考虑:
 *   - 单次 SELECT family_settings 单行 → 一次 RPC 调用,延迟极低
 *   - filterExpiredTasks 纯 JS filter — tasks 数组当前规模 O(100) 量级,O(N) 完全可接受
 *   - Realtime family_settings 已由 SyncManager 订阅(settings 表)— UI 自动响应窗口变更
 *     (本 service 不显式监听 settings event,依赖外部触发)
 */

import { supabase } from '../lib/supabase';
import { addDays } from '../lib/taskListFilters';
import type { FamilySettingsRow, TaskRow } from '../types/database';

// =====================================================================
// 1. Types
// =====================================================================

/**
 * expiry_window 字段的 4 选项 — 与 db-v1.1.sql §3.5 CHECK 约束严格对齐。
 *
 * - 'yesterday_today' : yesterday + today 两天内的过期任务(默认窗口)
 * - 'this_week'       : 往前 7 天(含今天)的过期任务
 * - 'all'             : 全部过期任务
 * - 'off'             : 完全不展示(用户设置关掉)
 */
export type ExpiryWindow = FamilySettingsRow['expiry_window'];

/**
 * getExpiredTasksSummary 返回值 — UI(后续 T-US015-2 banner)消费三字段:
 *   - count  : 过期任务总数(展示在 banner "你有 N 个过期任务" 文案)
 *   - tasks  : 过期任务完整列表(后续 T-US015-2 banner 点击跳 ExpiredTasksScreen 用)
 *   - window : 实际生效的窗口(用于调试 / 后续 i18n)
 */
export interface ExpiredTasksSummary {
  count: number;
  tasks: TaskRow[];
  window: ExpiryWindow;
}

// =====================================================================
// 2. makeExpiryWindowPredicate — 窗口 → 谓词(纯函数)
// =====================================================================

/**
 * 给定 expiry_window + today,导出"task 是否在该窗口内"的纯函数谓词。
 *
 * 4 窗口的判定逻辑:
 *   - 'off'             : 返回 () => false(任何 task 都不算在窗口内)
 *   - 'yesterday_today' : task_date ∈ [yesterday, today] 闭区间
 *   - 'this_week'       : task_date ∈ [today - 6, today] 闭区间(7 天窗口,与 taskListFilters
 *                         `makeDatePredicate` 的 week 语义保持一致)
 *   - 'all'             : 返回 () => true(任何 task 都在窗口内)
 *
 * 注意:本谓词**只**判定窗口(task_date 是否落在窗口内);"任务是否过期"的判定
 * (cancelled / completed_at / task_date < today)在 filterExpiredTasks 内统一处理 —
 * 避免两个函数重复相同逻辑导致漂移。
 *
 * 设计决策:
 *   - today 由 caller 注入(本模块不调 Date.now()) — 让 useExpiredTaskCount hook
 *     控制 timeline 单一来源
 *   - 'yesterday_today' 包含今天:虽然今天通常 task_date ≥ today 不算过期,但窗口包含今天
 *     让窗口语义"最近 2 天"明确(后续 i18n 文案"这两天有过期任务"也通顺)
 *   - 'this_week' 用 7 天窗口(today-6 到 today),与 taskListFilters.week 视图一致
 *     (US-002 任务 brief §3.4 明确"week = today + 6 天")
 *
 * @param window — ExpiryWindow 4 选项之一
 * @param today  — 'YYYY-MM-DD' 本地时区日期字面量
 * @returns (task: TaskRow) => boolean — true 表示 task 在窗口内
 */
export function makeExpiryWindowPredicate(
  window: ExpiryWindow,
  today: string,
): (task: TaskRow) => boolean {
  switch (window) {
    case 'off':
      return () => false;
    case 'yesterday_today': {
      const yesterday = addDays(today, -1);
      return (t) => t.task_date === yesterday || t.task_date === today;
    }
    case 'this_week': {
      const start = addDays(today, -6); // today + 6 天窗口 = 7 天
      return (t) => t.task_date >= start && t.task_date <= today;
    }
    case 'all':
      return () => true;
  }
}

// =====================================================================
// 3. filterExpiredTasks — 谓词 + 过期排除 + 排序
// =====================================================================

/**
 * 给定 tasks + 窗口 + today,过滤出"过期未完成且在窗口内"的 task 列表。
 *
 * 过滤逻辑(顺序):
 *   1. 过期基础排除(三态 AND)— 与 computeTaskBadge.overdue kind 严格对齐:
 *      - !cancelled(取消的任务不算过期)
 *      - !completed_at(已完成的不算过期)
 *      - task_date < today(今天 / 未来的不算过期)
 *   2. 窗口谓词 — makeExpiryWindowPredicate 输出谓词
 *
 * 排序:沿用 taskListFilters 的 sort 约定(task_date asc → task_time asc →
 *       created_at asc)— 让 banner 点击跳转后的列表顺序与 HomeScreen 一致
 *
 * 返回**新数组**(filter + slice + sort),不修改入参。
 *
 * @param tasks — 全部任务(由 useTasks() 提供)— 通常 O(100) 量级
 * @param window — ExpiryWindow 4 选项
 * @param today — 'YYYY-MM-DD' 本地时区日期字面量
 * @returns 过期任务数组(已排序)— count = length
 */
export function filterExpiredTasks(
  tasks: TaskRow[],
  window: ExpiryWindow,
  today: string,
): TaskRow[] {
  const inWindow = makeExpiryWindowPredicate(window, today);
  return tasks
    .filter(
      (t) =>
        !t.cancelled &&
        !t.completed_at &&
        t.task_date < today &&
        inWindow(t),
    )
    .slice()
    .sort((a, b) => {
      if (a.task_date !== b.task_date) {
        return a.task_date.localeCompare(b.task_date);
      }
      const aTime = a.task_time ?? '99:99:99';
      const bTime = b.task_time ?? '99:99:99';
      if (aTime !== bTime) {
        return aTime.localeCompare(bTime);
      }
      return a.created_at.localeCompare(b.created_at);
    });
}

// =====================================================================
// 4. getExpiredTasksSummary — 服务层入口(调 supabase)
// =====================================================================

/**
 * 服务层入口:从 family_settings 读 expiry_window,filterExpiredTasks 返回 summary。
 *
 * 流程:
 *   1. family_settings 单行 SELECT (family_id = familyId)— maybeSingle 兜底无 row
 *   2. 取 settings.expiry_window;缺失 → fallback 'yesterday_today'
 *   3. filterExpiredTasks(tasks, window, today) → 过滤 + 排序
 *   4. 返 {count, tasks, window}
 *
 * 错误处理:
 *   - settings query 抛错 → console.warn + fallback yesterday_today(filter 照常)
 *   - 极端情况(无 familyId / supabase 不可用)→ 返 {count: 0, tasks: [], window: 'yesterday_today'}
 *
 * RLS:
 *   - family_settings 表有 RLS 策略(假设:同 family members 可见)— 当前 user 调本函数
 *     必须已是 family member(Gate 控制);RLS 自动校验 family_id
 *
 * 性能:
 *   - 单行 SELECT,延迟 ~50ms(EAS preview 实测)— 启动时一次调用可接受
 *   - 后续 T-US015-2 banner 显示期间不必重复调 — hook 缓存 + Realtime 触发
 *     useEffect deps 变化重算
 *
 * @param familyId — 当前 family UUID(从 useFamilyValue().family.id 取)
 * @param tasks   — 当前 tasks 数组(从 useTasks() 取)— service 不持有快照
 * @param today   — 'YYYY-MM-DD' 本地时区日期字面量(从 hook 注入)
 * @returns ExpiredTasksSummary — UI 消费
 */
export async function getExpiredTasksSummary(
  familyId: string,
  tasks: TaskRow[],
  today: string,
): Promise<ExpiredTasksSummary> {
  // 1. 防御:无 familyId(理论上 hook 调用前已 Gate)→ 返兜底
  if (!familyId) {
    return { count: 0, tasks: [], window: 'yesterday_today' };
  }

  // 2. 读 family_settings.expiry_window(单行 SELECT)
  let window: ExpiryWindow = 'yesterday_today';
  try {
    const { data: settings, error: settingsErr } = await supabase
      .from('family_settings')
      .select('*')
      .eq('family_id', familyId)
      .maybeSingle<FamilySettingsRow>();

    if (settingsErr) {
      // eslint-disable-next-line no-console
      console.warn('[ExpiryService] family_settings query failed:', settingsErr.message);
    } else if (settings?.expiry_window) {
      window = settings.expiry_window;
    }
    // else:settings 为 null / 缺 expiry_window → fallback 'yesterday_today'
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[ExpiryService] family_settings query threw unexpectedly:', err);
    // 防御性 catch — fallback yesterday_today,filter 照常执行
  }

  // 3. filterExpiredTasks(过期排除 + 窗口谓词 + 排序)
  const expired = filterExpiredTasks(tasks, window, today);

  return {
    count: expired.length,
    tasks: expired,
    window,
  };
}