/**
 * FamSchedule — Babel config
 *
 * 关键点:
 * 1. babel-preset-expo 默认走 react/jsx-runtime(T-FIX-BUNDLE 修复:
 *    移除 jsxImportSource: 'tamagui',因 tamagui@2.7.7 不 expose ./jsx-runtime)
 * 2. @tamagui/babel-plugin 独立处理 token 化引用(<View bg="$primary" />)
 *    编译成静态 className,无需 JSX runtime 走 tamagui
 * 3. react-native-worklets/plugin(reanimated 4.x 新位置)必须最后,用于 worklet 编译
 *
 * 参考:
 * - https://tamagui.dev/docs/core/configuration
 * - https://docs.expo.dev/guides/using-nextjs/#babel-config
 * - https://docs.swmansion.com/react-native-reanimated/docs/guides/migration-from-3.x
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        'babel-preset-expo',
        // T-FIX-BUNDLE: 不传 jsxImportSource。
        // 原配置 jsxImportSource: 'tamagui' 让 babel-preset-expo 把 JSX 编译成
        //   import { jsx } from 'tamagui/jsx-runtime'
        // 但 tamagui@2.7.7 的 package.json exports 字段没有 expose ./jsx-runtime / ./jsx-dev-runtime,
        // Metro bundler 解析失败,导致 npx expo start 启动时 bundling 报
        //   Unable to resolve "tamagui/jsx-runtime"
        // 回退到 react 默认 jsx-runtime 即可让 babel-preset-expo 正常工作。
        // token 化引用(<View bg="$primary" />)由下方独立的 @tamagui/babel-plugin 处理,
        // 不依赖 JSX runtime 走 tamagui,所以本改动 0 行为回归。
        // 不要轻易恢复 jsxImportSource: 'tamagui' — 需先升 tamagui 到 expose
        // jsx-runtime 的版本,或加 metro alias。
      ],
    ],
    plugins: [
      // Tamagui 编译时优化插件
      // components: ['tamagui'] 表示 <View> 来自 'tamagui' 这个 import 来源
      [
        '@tamagui/babel-plugin',
        {
          components: ['tamagui'],
          config: './src/theme/tamagui.config.ts',
          // 关闭一些 dev-only warning,提升 dev 启动速度
          disableExtractSystemFonts: true,
        },
      ],
      // 必须最后。reanimated 4.x 已迁移到 react-native-worklets/plugin
      'react-native-worklets/plugin',
    ],
  };
};
