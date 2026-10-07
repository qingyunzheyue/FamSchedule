/**
 * HomeScreen 单元测试 — T-FIX-06-A M08/M09
 *
 * 覆盖范围(brief §M08+M09):
 *   1. `canLongPressDeleteTask` 纯函数 — 列表 long-press 删除的 pre-check 决策
 *      - 'template'    : 模板任务(template_id !== null)— 留给详情页级联操作
 *      - 'spouse_done' : 已完成但完成人不是当前用户(配偶先完成)— 防误删破坏
 *                         first-finisher 契约(ADR-005)
 *      - 'ok'          : 可继续走 showConfirmDialog 二次确认
 *
 * 测试策略(与项目其他 component test 同模式 — PhosphorTabIcon / TaskCard / OverdueBanner):
 *   - jest-expo + React 19 + jsxImportSource: tamagui → react-test-renderer 易脆
 *   - 不渲染 HomeScreen 全树(复杂 + 大量 hook 依赖),只测纯函数 + props 形态
 *   - 集成 / 视觉 / 跳转 由 ui-ux / 手动 / EAS 真机验证
 *
 * 严格 scope:
 *   - 只测 canLongPressDeleteTask 一个导出函数(HomeScreen 本身的渲染 / hook 集成
 *     留给后续 Story test / E2E)
 *   - 不测 Alert.alert 副作用(showConfirmDialog 内部已包 Alert)— ConfirmDialog 自家测试
 *     覆盖 button shape,HomeScreen 这层不重复
 *   - 该函数抽到 src/lib/longPressDeletePolicy.ts(独立模块)— HomeScreen re-use,
 *     便于 jest 直接 import 此模块不触发 HomeScreen 的副作用 import 链
 *     (expo-router / tamagui / phosphor / context 等)
 */

import * as fs from 'fs';
import * as path from 'path';

import type { Task } from '../src/lib/LocalStore';
import {
  canLongPressDeleteTask,
  type LongPressDeleteDecision,
} from '../src/lib/longPressDeletePolicy';

// =====================================================================
// Test fixtures
// =====================================================================

const CREATOR_ID = 'creator-uuid-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SPOUSE_ID = 'spouse-uuid-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TASK_ID = 'task-uuid-eeee-eeee-eeee-eeeeeeeeeeee';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    template_id: null,
    family_id: 'family-uuid',
    title: '倒垃圾',
    description: null,
    task_date: '2026-09-22',
    task_time: '20:00',
    assignee_id: CREATOR_ID,
    co_executor_ids: [],
    is_shared_view: false,
    created_by: CREATOR_ID,
    completed_at: null,
    completed_by: null,
    is_makeup: false,
    cancelled: false,
    created_at: '2026-09-22T10:00:00Z',
    updated_at: '2026-09-22T10:00:00Z',
    ...overrides,
  };
}

// =====================================================================
// 1. canLongPressDeleteTask — T-FIX-06-A M08/M09 决策函数
// =====================================================================

describe('HomeScreen.canLongPressDeleteTask (T-FIX-06-A M08/M09 pre-check)', () => {
  it('returns "ok" for an uncompleted one-off task by the creator', () => {
    // 普通一次性任务(未完成,本人)— 应进入二次确认分支
    const task = makeTask();
    const decision: LongPressDeleteDecision = canLongPressDeleteTask(task, CREATOR_ID);
    expect(decision).toBe('ok');
  });

  it('returns "ok" for a task I completed myself (allow undo via delete)', () => {
    // 我自己先完成的任务 — 允许删除(等同于撤销打卡 + 清掉 row,流程合理)
    const task = makeTask({
      completed_at: '2026-09-22T20:05:00Z',
      completed_by: CREATOR_ID,
    });
    const decision = canLongPressDeleteTask(task, CREATOR_ID);
    expect(decision).toBe('ok');
  });

  it('returns "template" for a template-backed task (M08 pre-check branch 1)', () => {
    // 模板任务 → 留给详情页级联删除,列表不允许
    const task = makeTask({ template_id: 'tmpl-uuid-cccc-cccc-cccc-cccccccccccc' });
    const decision = canLongPressDeleteTask(task, CREATOR_ID);
    expect(decision).toBe('template');
  });

  it('returns "spouse_done" when the task is completed by another user (M09 pre-check branch 2)', () => {
    // 配偶先完成的任务 — 我不能删(防破坏 first-finisher 契约)
    const task = makeTask({
      completed_at: '2026-09-22T20:03:00Z',
      completed_by: SPOUSE_ID,
    });
    const decision = canLongPressDeleteTask(task, CREATOR_ID);
    expect(decision).toBe('spouse_done');
  });

  it('returns "spouse_done" when currentUserId is empty string (defensive — not logged in)', () => {
    // 防御:currentUserId 是空串(理论上 HomeScreen 不会 mount,但纯函数兜底)
    const task = makeTask({
      completed_at: '2026-09-22T20:03:00Z',
      completed_by: SPOUSE_ID,
    });
    const decision = canLongPressDeleteTask(task, '');
    // SPOUSE_ID !== '' → spouse_done(已 completed 且完成人不是 "" 视为 spouse_done)
    expect(decision).toBe('spouse_done');
  });

  it('returns "ok" when completed_by is null even if currentUserId is empty', () => {
    // 防御:未完成任务(uncompleted)+ 空 currentUserId → 不应误判为 spouse_done
    const task = makeTask(); // completed_by: null
    const decision = canLongPressDeleteTask(task, '');
    expect(decision).toBe('ok');
  });

  it('template check has priority over spouse_done check (defensive order)', () => {
    // 既是模板任务又被配偶完成 → template(优先),因为列表层一律不允许模板
    const task = makeTask({
      template_id: 'tmpl-uuid',
      completed_at: '2026-09-22T20:03:00Z',
      completed_by: SPOUSE_ID,
    });
    const decision = canLongPressDeleteTask(task, CREATOR_ID);
    expect(decision).toBe('template');
  });

  it('3-way exhaustive: ok / template / spouse_done 都被覆盖', () => {
    // 类型守卫:验证 3 种 decision 都被实际触达(避免后续重构漏分支)
    const decisions = new Set<LongPressDeleteDecision>();
    decisions.add(canLongPressDeleteTask(makeTask(), CREATOR_ID));
    decisions.add(canLongPressDeleteTask(makeTask({ template_id: 't' }), CREATOR_ID));
    decisions.add(
      canLongPressDeleteTask(
        makeTask({ completed_at: 'x', completed_by: SPOUSE_ID }),
        CREATOR_ID,
      ),
    );
    expect(decisions.size).toBe(3);
    expect(decisions.has('ok')).toBe(true);
    expect(decisions.has('template')).toBe(true);
    expect(decisions.has('spouse_done')).toBe(true);
  });
});

// =====================================================================
// 2. T-US015-4: useBannerDismissedUntil hook 集成 + 条件渲染 gate
// =====================================================================

describe('HomeScreen — T-US015-4 banner dismissed_until integration (verify-by-source)', () => {
  let source: string;

  beforeAll(() => {
    const homePath = path.join(
      __dirname,
      '..',
      'src',
      'screens',
      'HomeScreen.tsx',
    );
    source = fs.readFileSync(homePath, 'utf8');
  });

  it('imports useBannerDismissedUntil hook from canonical path', () => {
    expect(source).toMatch(
      /import\s*\{[^}]*useBannerDismissedUntil[^}]*\}\s*from\s*['"]\.\.\/hooks\/useBannerDismissedUntil['"]/,
    );
  });

  it('destructures {dismissed, dismiss} from useBannerDismissedUntil', () => {
    // hook 返回 {dismissed, loadingDismiss, dismiss, reset};HomeScreen 至少用
    // dismissed + dismiss(reset 留后续 Realtime count 变化主动重置用)
    expect(source).toMatch(/useBannerDismissedUntil\s*\(\s*\)/);
    expect(source).toMatch(/\{\s*dismissed:[^,]+,\s*dismiss:[^}]+\s*\}/);
  });

  it('bannerVisible 三态 gate:count > 0 AND !expiredLoading AND !dismissed', () => {
    // bannerVisible 表达式包含三个条件
    expect(source).toMatch(
      /bannerVisible[\s\S]{0,200}expiredCount\s*>\s*0[\s\S]{0,100}![\s\S]*?expiredLoading[\s\S]{0,100}![\s\S]*?dismissed/,
    );
  });

  it('passes onDismiss callback to ExpiredTasksBanner', () => {
    // 关闭按钮回调 = useBannerDismissedUntil.dismiss 透传给 banner
    expect(source).toMatch(/onDismiss\s*=\s*\{[^}]*handleBannerDismiss[^}]*\}/);
  });

  it('conditionally renders ExpiredTasksBanner (bannerVisible gate)', () => {
    // 不再无条件 <ExpiredTasksBanner /> — 必须用 {bannerVisible ? <.../> : null}
    expect(source).toMatch(/bannerVisible\s*\?\s*\(/);
    expect(source).toMatch(/<ExpiredTasksBanner[\s\S]*?\/>/);
  });
});
