/**
 * FamSchedule — Babel config
 *
 * 关键点:
 * 1. babel-preset-expo 的 jsxImportSource: 'tamagui' 让 <View> <Text> 等组件
 *    走 Tamagui 编译路径,享受 token 化的 CSS-in-JS 性能(编译时提取样式,0 运行时开销)
 * 2. @tamagui/babel-plugin 进一步优化:把 <View bg="$primary" /> 这类引用
 *    编译成静态 className
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
        {
          // 关键:让 <View> <Text> 等从 tamagui 解析
          jsxImportSource: 'tamagui',
        },
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
