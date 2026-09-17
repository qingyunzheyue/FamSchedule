/**
 * Jest setup — T-SETUP-5
 *
 * jest-expo preset 自动 mock 大部分 RN 模块,但 @react-native-async-storage
 * 需要显式 mock 成 jest-friendly 版本。
 *
 * 官方 mock 包路径:
 *   @react-native-async-storage/async-storage/jest/async-storage-mock
 *
 * 提供一个 in-memory Map 实现:
 *   - getItem / setItem / removeItem / clear / multiGet / multiSet / ...
 *   - 在 beforeEach 里 AsyncStorage.clear() 即可清空 mock state
 *
 * 参考:https://react-native-async-storage.github.io/async-storage/docs/advanced/jest
 */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);