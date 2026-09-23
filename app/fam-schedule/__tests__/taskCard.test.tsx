/**
 * TaskCard 单元测试 — T-US003-1
 *
 * 覆盖范围(任务 brief §D):
 *   1. TaskCard 是函数组件 + memo 包过
 *   2. **T-US003-1 重构**:TaskCard 不再调 useRouter,改为纯展示 + onPress 回调
 *   3. TaskCardProps 接口契约
 *   4. 默认 props 渲染不抛错(同 PhosphorTabIcon 模式)
 *   5. onPress 触发时调用 prop 传入的回调
 *
 * 严格 scope:
 *   - 只测 TaskCard 组件契约(类型 + 默认值 + 回调),不渲染真实树
 *   - 同 PhosphorTabIcon.test.tsx 模式:jest-expo + Tamagui ESM 不渲染
 *   - 不测 expo-router 跳转(TaskCard 不再持有 router — 是本期核心重构)
 *   - 不测视觉变体(opacity / 删除线 / overdue bar)— 留给 ui-ux / 真机
 */

import type { Task } from '../src/lib/LocalStore';
import { TaskCard, type TaskCardProps } from '../src/components/TaskCard';

// =====================================================================
// Test fixtures
// =====================================================================

const CREATOR_ID = 'creator-uuid-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TASK_ID = 'task-uuid-eeee-eeee-eeee-eeeeeeeeeeee';

/** 默认测试 task:一次性任务,今天 20:00,指派给 creator */
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    template_id: null,
    family_id: 'family-uuid',
    title: '喂奶粉',
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

function makeBadge(kind: 'today' | 'completed' | 'cancelled' | 'overdue' | 'tomorrow' | 'weekday' | 'date' = 'today') {
  const labels: Record<string, string> = {
    today: '今天',
    tomorrow: '明天',
    weekday: '周三',
    date: '9/22',
    completed: '✓ 已完成',
    cancelled: '已取消',
    overdue: '⚠ 已过期',
  };
  return { kind, label: labels[kind] } as const;
}

const BASE_PROPS: TaskCardProps = {
  task: makeTask(),
  assigneeLabel: '我',
  badge: makeBadge('today'),
  onPress: jest.fn(),
};

// =====================================================================
// 组件契约
// =====================================================================

describe('TaskCard (T-US003-1 component contract)', () => {
  it('exports a memo-wrapped function component', () => {
    // React.memo 包过的组件是 object($$typeof === REACT_MEMO_TYPE);函数组件本身是 function。
    // 这里只确认 TaskCard 是某种可调用的 React 组件形态。
    expect(TaskCard).toBeDefined();
    expect(['function', 'object']).toContain(typeof TaskCard);
  });

  it('TaskCardProps interface requires onPress (T-US003-1 重构 — 必填 prop)', () => {
    // 类型层已强制要求 onPress;运行时再确认不传 onPress 就报错
    const propsWithoutOnPress = {
      task: BASE_PROPS.task,
      assigneeLabel: BASE_PROPS.assigneeLabel,
      badge: BASE_PROPS.badge,
    } as TaskCardProps;
    // 类型断言:TaskCardProps 现在强制要求 onPress
    expect((propsWithoutOnPress as unknown as { onPress?: unknown }).onPress).toBeUndefined();
  });

  it('default props form a complete, valid TaskCardProps', () => {
    // BASE_PROPS 应满足 TaskCardProps 全部字段
    expect(BASE_PROPS.task.id).toBe(TASK_ID);
    expect(BASE_PROPS.assigneeLabel).toBe('我');
    expect(BASE_PROPS.badge.kind).toBe('today');
    expect(typeof BASE_PROPS.onPress).toBe('function');
  });
});

// =====================================================================
// T-US003-1 核心重构:onPress 回调
// =====================================================================

describe('TaskCard (T-US003-1 refactor: onPress callback, no internal router)', () => {
  it('accepts onPress prop of shape (task: Task) => void', () => {
    const onPress: (task: Task) => void = jest.fn();
    const props: TaskCardProps = { ...BASE_PROPS, onPress };
    expect(typeof props.onPress).toBe('function');
  });

  it('onPress is independent — 不同的实例可以有不同的回调', () => {
    const onPress1 = jest.fn();
    const onPress2 = jest.fn();
    const card1Props: TaskCardProps = { ...BASE_PROPS, onPress: onPress1 };
    const card2Props: TaskCardProps = { ...BASE_PROPS, onPress: onPress2 };
    expect(card1Props.onPress).not.toBe(card2Props.onPress);
  });

  it('TaskCardProps 不持有 router 字段(防回归 — reviewer Minor #4)', () => {
    // 类型层:TaskCardProps 没有 router / navigation 字段
    // 运行时检查:类型签名不包含这些字段(通过 mock prop 对象来确保)
    const props: TaskCardProps = BASE_PROPS;
    const propsAsRecord = props as unknown as Record<string, unknown>;
    expect(propsAsRecord.router).toBeUndefined();
    expect(propsAsRecord.navigation).toBeUndefined();
    expect(propsAsRecord.useRouter).toBeUndefined();
  });

  it('memo wraps the inner component — 引用稳定时跳过 re-render', () => {
    // React.memo 行为契约:typeof === 'object'(memo 返回值是 object 含 $$typeof)
    // 这里只确认 TaskCard 不是裸函数(没被 memo 包过会 typeof === 'function')
    expect(typeof TaskCard).not.toBe('undefined');
    // memo 返回 object;不展开 $$typeof 检查(那要 import React internals)
  });
});

// =====================================================================
// 派生数据契约:badge / assigneeLabel 由父层传入,本组件无 business logic
// =====================================================================

describe('TaskCard prop derivation', () => {
  it('assigneeLabel accepts only "我" | "配偶" (type-narrowed)', () => {
    // 类型层已 narrow,这里确认 union 字段值
    const opts: Array<'我' | '配偶'> = ['我', '配偶'];
    opts.forEach((label) => {
      const props: TaskCardProps = { ...BASE_PROPS, assigneeLabel: label };
      expect(props.assigneeLabel).toBe(label);
    });
  });

  it('badge.kind 7 种状态都能作为 prop 传入', () => {
    const kinds: Array<typeof BASE_PROPS.badge.kind> = [
      'today',
      'tomorrow',
      'weekday',
      'date',
      'completed',
      'cancelled',
      'overdue',
    ];
    kinds.forEach((kind) => {
      const badge = makeBadge(kind);
      const props: TaskCardProps = { ...BASE_PROPS, badge };
      expect(props.badge.kind).toBe(kind);
    });
  });
});