/**
 * LocalStore 单元测试 — T-SETUP-5
 *
 * 覆盖范围(任务 DoD 强制要求):
 *   1. enqueue 后 drain 能按 FIFO 返回
 *   2. drain 后 queue 清空(再 drain 返回空数组)
 *   3. getQueueLength 反映当前队列大小
 *
 * 测试栈:
 *   - jest-expo preset(自动 mock @react-native-async-storage/async-storage 的 native module)
 *   - ts-jest 直接处理 .ts
 *
 * ⚠️ jest-expo 在 SDK 57 上对 AsyncStorage 的 mock 用的是 jest mock module,
 *    所以 beforeEach 显式 AsyncStorage.clear() 把 mock state 也清掉。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  enqueueMutation,
  drainQueue,
  clearQueue,
  getQueueLength,
  _clearAllForTests,
} from '../src/lib/LocalStore';

beforeEach(async () => {
  // jest-expo preset 给 AsyncStorage 装的是 jest.fn() backed Map-like mock,
  // clear() 会清掉所有 key。
  await AsyncStorage.clear();
});

describe('LocalStore mutation queue', () => {
  it('returns empty array on first drain (cold queue)', async () => {
    const result = await drainQueue();
    expect(result).toEqual([]);
  });

  it('preserves FIFO order across enqueue → drain', async () => {
    await enqueueMutation({
      kind: 'checkin',
      taskId: 't1',
      isMakeup: false,
      queuedAt: 1000,
    });
    await enqueueMutation({
      kind: 'undo_checkin',
      taskId: 't2',
      queuedAt: 2000,
    });
    await enqueueMutation({
      kind: 'delete_task',
      taskId: 't3',
      queuedAt: 3000,
    });

    const result = await drainQueue();

    // 顺序:最先 enqueue 的最先 drain 出来
    expect(result.map((m) => m.kind)).toEqual([
      'checkin',
      'undo_checkin',
      'delete_task',
    ]);
    expect(result.map((m) => m.queuedAt)).toEqual([1000, 2000, 3000]);
  });

  it('clears queue after drain (second drain returns empty)', async () => {
    await enqueueMutation({
      kind: 'checkin',
      taskId: 't1',
      isMakeup: false,
      queuedAt: 1,
    });

    const first = await drainQueue();
    expect(first).toHaveLength(1);

    const second = await drainQueue();
    expect(second).toEqual([]);
    expect(await getQueueLength()).toBe(0);
  });

  it('clearQueue empties the queue without returning items', async () => {
    await enqueueMutation({
      kind: 'checkin',
      taskId: 't1',
      isMakeup: false,
      queuedAt: 1,
    });
    expect(await getQueueLength()).toBe(1);

    await clearQueue();

    expect(await getQueueLength()).toBe(0);
    // clearQueue 不返回值;再 drain 应该是空数组而不是残余
    expect(await drainQueue()).toEqual([]);
  });

  it('getQueueLength reflects current count after enqueue/drain/clear', async () => {
    // 初始:0
    expect(await getQueueLength()).toBe(0);

    // enqueue 一次 → 1
    await enqueueMutation({
      kind: 'checkin',
      taskId: 't1',
      isMakeup: false,
      queuedAt: 1,
    });
    expect(await getQueueLength()).toBe(1);

    // 再 enqueue → 2
    await enqueueMutation({
      kind: 'checkin',
      taskId: 't2',
      isMakeup: false,
      queuedAt: 2,
    });
    expect(await getQueueLength()).toBe(2);

    // drain 后归零
    await drainQueue();
    expect(await getQueueLength()).toBe(0);
  });
});

/**
 * 辅助 sanity check:确认 _clearAllForTests 不抛(供后续 dev smoke 用)。
 * 这里只验证它存在且能调用,不强制要求 cache 也清掉 — 因为业务侧只依赖
 * queue 相关方法。
 */
describe('LocalStore debug helpers', () => {
  it('_clearAllForTests does not throw', async () => {
    await enqueueMutation({
      kind: 'checkin',
      taskId: 't1',
      isMakeup: false,
      queuedAt: 1,
    });
    await expect(_clearAllForTests()).resolves.toBeUndefined();
    expect(await getQueueLength()).toBe(0);
  });
});