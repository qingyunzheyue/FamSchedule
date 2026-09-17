/**
 * SplashScreen — T-US013-2 启动屏组件
 *
 * 来源契约:
 *   - ui-design/screens/splash-v1.0.md §3 布局(品牌名 + 标语 + 启动 spinner)
 *   - ui-design/screens/splash-v1.0.md §5 状态(default / error / offline)
 *   - ui-design/screens/splash-v1.0.md §6 文案("家里的小日程" / "无法连接到服务器...")
 *   - ui-design/screens/splash-v1.0.md §7 可访问性(progressbar / alert)
 *
 * 本组件是纯 UI 层,不持有任何业务状态;消费侧(目前是 _layout.tsx 的 Gate)传入
 * mode 和 errorMessage/onRetry 即可。
 *
 * 设计要点:
 *   - **背景**:亚麻色 #F4ECDC(design-v1.0 §1.1) — 与全局 theme.background 对齐,营造温暖家庭感
 *   - **品牌名**:FamSchedule 22px Semibold,赤陶色 primary — 锁品牌识别
 *   - **标语**:"家里的小日程" 13px Regular secondary — 口语化、温度感(见 DD-003)
 *   - **error 状态**:⚠ + 错误文案 + 重试按钮;accessibilityRole="alert" 让 screen reader 立即播报
 *   - **loading 状态**:accessibilityRole="progressbar";文案"正在连接..."与 §6 错误文案风格一致
 *
 * 严格 scope:
 *   - 不在这里做 auth 逻辑 — 那是 bootGuard 的事
 *   - 不在这里做路由 — 那是 Gate 的事
 *   - 仅渲染,所有状态由 props 传入
 */

import { Button, Spinner, Text, YStack } from 'tamagui';
import { SafeAreaView } from 'react-native-safe-area-context';

export type SplashScreenMode = 'loading' | 'error';

export interface SplashScreenProps {
  /**
   * 渲染模式:
   *   - 'loading'(默认):品牌视觉 + spinner + "正在连接..."
   *   - 'error':错误占位 + 重试按钮(阻塞性,见 splash-v1.0 §5)
   */
  mode?: SplashScreenMode;

  /**
   * 自定义错误文案。默认走 splash-v1.0 §6 "无法连接到服务器,请检查网络后重试"。
   *
   * MVP 不用(bootGuard 不再带 error 字段 — 见 T-US013-2 review Major #1 收敛),
   * 但保留 prop 作为逃生口:
   *   - 未来 i18n 时,调用方可传入翻译文案(如 `t('errors.networkFailed')`)
   *   - 未来区分错误类型时,调用方可按错误种类传不同文案(如超时 / DNS / 服务端 5xx)
   * 不传则走下方 DEFAULT_ERROR_MESSAGE 默认值。
   */
  errorMessage?: string;

  /**
   * 重试按钮回调。error 模式下不传则不渲染按钮(等同于"只读错误占位")。
   * 通常由消费侧传 (): void => retryBoot() 之类的处理函数。
   */
  onRetry?: () => void;
}

/**
 * 默认错误文案(splash-v1.0 §6 + DD-003 口语化原则)。
 * 抽成常量便于复用与未来 i18n 替换。
 */
const DEFAULT_ERROR_MESSAGE = '无法连接到服务器\n请检查网络后重试';

/**
 * 重试按钮文案(splash-v1.0 §6)。
 */
const RETRY_BUTTON_LABEL = '重试';

export function SplashScreen({
  mode = 'loading',
  errorMessage,
  onRetry,
}: SplashScreenProps): React.ReactElement {
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: '#F4ECDC' }}
      // accessibilityRole 按 mode 切:loading 时 progressbar,error 时 alert(splash-v1.0 §7)
      accessibilityRole={mode === 'loading' ? 'progressbar' : 'alert'}
      accessibilityLabel={
        mode === 'loading'
          ? 'FamSchedule 正在启动'
          : 'FamSchedule 启动失败'
      }
    >
      <YStack
        flex={1}
        alignItems="center"
        justifyContent="center"
        gap="$xl"
        paddingHorizontal="$xl"
      >
        {/* 品牌视觉:wordmark + 标语(splash-v1.0 §3)
            用纯文字占位代替 SVG logo(🏠 + 日历格子)——
            设计稿的 logo 资产由后续 ui-ux 任务交付,本任务先保证文本层级落地。 */}
        <Text
          fontFamily="$heading"
          fontSize="$title"
          color="$primary"
          accessibilityLabel="FamSchedule logo"
        >
          FamSchedule
        </Text>
        <Text fontSize="$meta" color="$textSecondary">
          家里的小日程
        </Text>

        {mode === 'loading' && <LoadingIndicator />}
        {mode === 'error' && (
          <ErrorPanel message={errorMessage ?? DEFAULT_ERROR_MESSAGE} onRetry={onRetry} />
        )}
      </YStack>
    </SafeAreaView>
  );
}

// ---- 内部子组件 ---------------------------------------------------------

function LoadingIndicator(): React.ReactElement {
  return (
    <YStack gap="$md" alignItems="center">
      <Spinner size="large" color="$primary" />
      <Text fontSize="$meta" color="$textSecondary">
        正在连接...
      </Text>
    </YStack>
  );
}

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}): React.ReactElement {
  return (
    <YStack gap="$md" alignItems="center">
      <Text fontFamily="$heading" fontSize="$heading" color="$error">
        ⚠ 连接失败
      </Text>
      {/* errorMessage 含 \n 时让 Text 自然换行(textAlign center 让多行也居中) */}
      <Text
        fontSize="$body"
        color="$textSecondary"
        textAlign="center"
      >
        {message}
      </Text>
      {onRetry && (
        <Button
          theme="active"
          size="$buttonMd"
          onPress={onRetry}
          accessibilityLabel="重试启动"
          accessibilityRole="button"
        >
          {RETRY_BUTTON_LABEL}
        </Button>
      )}
    </YStack>
  );
}