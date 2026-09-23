/**
 * ConfirmDialog 单元测试 — T-US003-2
 *
 * ConfirmDialog 是 RN Alert 的薄包装。RN Alert 是原生 API,jest 没法渲染真实 Dialog;
 * 因此本测试通过 mock `react-native` 的 `Alert.alert` + 断言:
 *   1. Alert.alert 被调一次
 *   2. 参数含 title / message
 *   3. 两个 button(cancel / confirm)
 *   4. destructive=true 时 confirm button 是 'destructive' style
 *   5. onPress callback 被 onConfirm / onCancel 触发
 *
 * 同时抽出 `buildConfirmDialogButtons` 纯函数,直接断言 button shape。
 *
 * 设计依据:
 *   - 任务 brief §C:ConfirmDialog 用 RN Alert 而非 Tamagui Dialog(Tamagui ESM jest 限制)
 */

import { Alert } from 'react-native';

import {
  buildConfirmDialogButtons,
  showConfirmDialog,
  type ConfirmDialogOptions,
} from '../src/components/ConfirmDialog';

// ---- Mocks --------------------------------------------------------------

// (jest-expo setup.js 期望 Platform.select 存在)
jest.mock('react-native', () => ({
  Platform: {
    OS: 'android',
    select: (specifics: { android?: unknown; default?: unknown }) =>
      specifics.android ?? specifics.default,
  },
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  Alert: {
    alert: jest.fn(),
  },
}));

const mockedAlert = Alert.alert as unknown as jest.Mock;

beforeEach(() => {
  mockedAlert.mockClear();
  mockedAlert.mockReset();
});

// =====================================================================
// buildConfirmDialogButtons — 纯函数
// =====================================================================

describe('buildConfirmDialogButtons (pure function)', () => {
  const noop = (): void => undefined;
  const baseOpts: ConfirmDialogOptions = {
    title: '删除这个任务?',
    message: '任务将被删除',
    confirmLabel: '删除',
    cancelLabel: '取消',
    destructive: false,
    onConfirm: noop,
    onCancel: noop,
  };

  it('returns an array of exactly 2 buttons (cancel + confirm)', () => {
    const buttons = buildConfirmDialogButtons(baseOpts);
    expect(buttons).toHaveLength(2);
  });

  it('first button is the cancel button with style:"cancel"', () => {
    const buttons = buildConfirmDialogButtons(baseOpts);
    expect(buttons[0]).toMatchObject({
      text: '取消',
      style: 'cancel',
    });
    expect(typeof buttons[0].onPress).toBe('function');
  });

  it('second button is the confirm button with style:"default" when not destructive', () => {
    const buttons = buildConfirmDialogButtons({ ...baseOpts, destructive: false });
    expect(buttons[1]).toMatchObject({
      text: '删除',
      style: 'default',
    });
    expect(typeof buttons[1].onPress).toBe('function');
  });

  it('second button is the confirm button with style:"destructive" when destructive=true', () => {
    const buttons = buildConfirmDialogButtons({ ...baseOpts, destructive: true });
    expect(buttons[1]).toMatchObject({
      text: '删除',
      style: 'destructive',
    });
  });

  it('uses default labels when not provided', () => {
    const buttons = buildConfirmDialogButtons({
      title: 't',
      message: 'm',
      onConfirm: noop,
      onCancel: noop,
    });
    expect(buttons[0].text).toBe('取消');
    expect(buttons[1].text).toBe('确认');
  });
});

// =====================================================================
// showConfirmDialog — RN Alert.alert integration
// =====================================================================

describe('showConfirmDialog (RN Alert integration)', () => {
  it('calls Alert.alert once with title + message + 2 buttons', () => {
    showConfirmDialog({
      title: '删除这个任务?',
      message: '任务"喂奶粉"将被删除,无法恢复。',
      confirmLabel: '删除',
      cancelLabel: '取消',
      destructive: true,
      onConfirm: jest.fn(),
      onCancel: jest.fn(),
    });

    expect(mockedAlert).toHaveBeenCalledTimes(1);
    const callArgs = mockedAlert.mock.calls[0];
    expect(callArgs[0]).toBe('删除这个任务?');
    expect(callArgs[1]).toBe('任务"喂奶粉"将被删除,无法恢复。');
    expect(Array.isArray(callArgs[2])).toBe(true);
    expect((callArgs[2] as unknown[]).length).toBe(2);
  });

  it('invokes onConfirm when the second (confirm) button is pressed', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();

    showConfirmDialog({
      title: 't',
      message: 'm',
      onConfirm,
      onCancel,
    });

    // 取出传给 Alert.alert 的 buttons 数组,模拟 confirm 按下
    const buttons = mockedAlert.mock.calls[0][2] as Array<{
      text: string;
      style?: string;
      onPress?: () => void;
    }>;
    const confirmBtn = buttons.find((b) => b.text === '确认');
    expect(confirmBtn).toBeDefined();
    confirmBtn?.onPress?.();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('invokes onCancel when the first (cancel) button is pressed', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();

    showConfirmDialog({
      title: 't',
      message: 'm',
      onConfirm,
      onCancel,
    });

    const buttons = mockedAlert.mock.calls[0][2] as Array<{
      text: string;
      style?: string;
      onPress?: () => void;
    }>;
    const cancelBtn = buttons.find((b) => b.text === '取消');
    expect(cancelBtn).toBeDefined();
    cancelBtn?.onPress?.();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});