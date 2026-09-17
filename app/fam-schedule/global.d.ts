/**
 * 全局类型声明 — T-SETUP-2
 *
 * 1. process.env.EXPO_PUBLIC_*  — Metro 在 bundle 阶段把这些 inline 为字面值,
 *    但 TS 类型不知道,需手动声明。运行时应总是有值(否则 .env 缺失),所以类型
 *    标 `string` 而非 `string | undefined`;若 .env 真的缺失,空字符串更好被 early
 *    failure 发现。
 *
 * 2. expo-router 的 typed routes 实验性启用后,所有 app/ 目录下的路由文件
 *    自动注册到 `<Link href>` 类型,无需手写 Route 类型。
 */

declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_SUPABASE_URL: string;
    EXPO_PUBLIC_SUPABASE_ANON_KEY: string;
  }
}

// React Native 运行时自带 process 全局,但 @types/react-native 不一定声明。
// 这里显式声明,让 process.env.EXPO_PUBLIC_* 能在业务代码里用。
declare const process: {
  env: NodeJS.ProcessEnv;
};

// T-SETUP-3: 字体 .ttf 资源声明(import 时给 TS 一个明确的 module shape)。
// 实际值在运行时由 expo-font 加载,这里只要 TS 不报错即可。
declare module '*.ttf' {
  const font: import('expo-font').FontSource;
  export default font;
}
