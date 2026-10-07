/**
 * ExpiredTasksScreen — 过期任务列表屏 — T-US015-3 + T-US015-4
 *
 * 职责(US-015 故事 3/3 — 端到端收尾:点击 banner 进入完整过期列表):
 *   1. 渲染 Header:左返回按钮 + 中"过期任务"标题 + 右占位
 *   2. 读 family_settings.expiry_window → getExpiredTasksSummary(familyId, tasks, today)
 *      → window state(filterExpiredTasks 输入)
 *   3. 派生 useMemo(tasks, window, today) → filterExpiredTasks → 已排序的过期列表
 *   4. N>0 时复用 TaskList 渲染(TaskList 自带 TaskCard + RefreshControl)
 *      N=0 时用 EmptyState 渲染过期上下文文案(不进 TaskList 内嵌 EmptyState)
 *   5. 复用 HomeScreen 已有 handle 模式:
 *      - handleTaskCheckIn → CheckInService.checkin(taskId, isMakeup=true)
 *        (T-US015-3 范围:过期列表里的 task 调 isMakeup=true 走补卡路径)
 *      - handleTaskUndo → CheckInService.undoCheckin(同 HomeScreen)
 *      - handleTaskPress → router.push 到 task/[id]
 *   6. family 上下文变化 / tasks 推送 / today 跨日 → 自动重算 expired 列表
 *      (useTasks 订阅 + useFamilyValue 触发 effect)
 *   7. **T-US015-4 增量**:
 *      - EmptyState polish:N=0 改用过期上下文文案"暂无过期任务"
 *        + subtitle "保持节奏,真棒",不再用 TaskList view="today" 错配的
 *        "今天没有任务" + "创建任务"按钮(过期列表不应允许顺手新建)
 *      - 下拉刷新 RefreshControl 接 SyncManager.pullSince(本屏接 onRefresh)
 *
 * 设计依据:
 *   - 设计 home-v1.0 §3.3 过期 banner + §3.5 任务列表卡片视觉
 *   - task-detail-v1.0 §10 配偶先完成语义
 *   - ADR-005:SyncManager 是 server 镜像 single source of truth,UI 不直接调 supabase
 *   - T-US015-1 + T-US015-2 + useExpiredTaskCount 已建立 family_settings.expiry_window 单一来源
 *
 * 设计决策(window 来源):
 *   - 复用 ExpiryService.getExpiredTasksSummary 单行 SELECT family_settings 派生 window
 *     (与 useExpiredTaskCount 同 source of truth)— 不再额外开 hook,直接 inline useEffect + useState
 *   - state 拆为 3 段:`loading`(初始 true) → `window`(expiry_window 字段)→ `expired` 列表
 *     (filterExpiredTasks 派生)
 *   - fallback:'yesterday_today'(同 useExpiredTaskCount,同 ExpiryService)
 *
 * 设计决策(EmptyState 文案 — T-US015-4 polish):
 *   - **N=0 不再用 TaskList view="today" 占位复用**(以前会显示"今天没有任务" + "创建任务"按钮
 *     与过期列表语境严重错配)— 改为独立 <EmptyState icon title subtitle />:
 *       - icon: <CheckCircle /> — 隐喻"无过期任务,安心"
 *       - title: "暂无过期任务"
 *       - subtitle: "保持节奏,真棒"
 *   - handleCreatePress 已删除 — 过期列表不应允许"顺手新建",过期/历史上下文
 *     应纯净,新建入口保留在 Home 主屏 header。
 *   - 复用 src/components/EmptyState.tsx(presentational)— 通用,后续搜索结果 / 归档
 *     屏也可复用。
 *
 * 设计决策(下拉刷新 — T-US015-4 C):
 *   - ScrollView 包 TaskList → FlatList 嵌套会触发 RN 警告 — 改用 TaskList 自带
 *     RefreshControl + onRefresh 走 SyncManager.pullSince(lastSyncAt)(onRefresh 已
 *     在 T-US015-3 占位为 noop,本任务接通 pullSince)
 *   - 失败策略同 HomeScreen:throw → Alert "网络异常";status.ok=false → Alert "同步未完成";
 *     finally setRefreshing(false)
 *   - 不再走 useSyncManager 自动 pullSince 的双触发(避免重叠请求)—— 下拉时主动 pullSince
 *     即可,Realtime 推送仍由 SyncManager 兜底
 *
 * 设计决策(补卡语义):
 *   - T-US006 真补卡 RPC 是后续任务(留 T-US006)— 当前 task 在过期列表里
 *     调 CheckInService.checkin(taskId, true) 走 make-up 路径占位
 *   - HomeScreen 列表调 checkin(taskId, false);这里调 checkin(taskId, true)
 *     让 CheckInService 走 make-up 流程(若有)— 后续 T-US006 真补卡 RPC 时替换
 *   - 严格 scope:本任务**不**碰 CheckInService / RPC,只复用现有 checkin(...) 接口
 *
 * 设计决策(handleTaskPress navigation):
 *   - 跳 task/[id] 复用 HomeScreen.handleTaskPress 同一形态(让 TaskDetailScreen
 *     共享路由)— 不在 expired.tsx 单独 path
 *   - handleTaskLongPress(列表 long-press 删除)在过期列表禁用 — 过期任务
 *     主要是"补打 / 撤销"行为,删除不在过期列表暴露(避免误删历史)
 *
 * 复用约定:
 *   - TaskCard 渲染:复用现有 TaskList → TaskCard 链
 *   - CheckInButton 渲染:复用现有 TaskCard → CheckInButton 链
 *   - EmptyState:用 src/components/EmptyState.tsx 通用组件(语境化文案)
 *   - 撤销 UndoChip:复用 TaskCard → CheckInButton → UndoChip 链
 *
 * 不在本屏范围(留后续任务):
 *   - ❌ Banner 关闭状态持久化(HomeScreen 完成 T-US015-4)
 *   - ❌ 真补卡 RPC(T-US006)— 本任务复用现有 checkin(... true) 占位
 *   - ❌ 过期任务批量操作(全部打卡 / 一键撤销)— 留后续
 *   - ❌ 过期窗口设置 UI(T-US017-3)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Text as TamaguiText, XStack, YStack } from 'tamagui';
import { CaretLeft, CheckCircle } from 'phosphor-react-native';

import { useTasks } from '../hooks/useTasks';
import { useFamilyValue, useCurrentUserId } from '../contexts/FamilyContext';
import {
  filterExpiredTasks,
  getExpiredTasksSummary,
  type ExpiryWindow,
} from '../services/ExpiryService';
import { TaskList } from '../components/TaskList';
import { EmptyState } from '../components/EmptyState';
import { CheckInService } from '../services/CheckInService';
import {
  mapCheckInFailureReason,
  mapUndoCheckInFailureReason,
  mapCheckInResultToToast,
} from '../lib/createTaskForm';
import { showConfirmDialog } from '../components/ConfirmDialog';
import { pullSince, type PullStatus } from '../lib/SyncManager';
import { getLastSyncAt } from '../lib/LocalStore';
import type { Task } from '../lib/LocalStore';

// =====================================================================
// Constants — UI 文案(集中常量,便于国际化)
// =====================================================================

const HEADER_TITLE = '过期任务';
const HEADER_BACK_LABEL = '返回';

const COLOR_PRIMARY = '#DC5A24';
const COLOR_TEXT_PRIMARY = '#3A2E20';
const COLOR_TEXT_SECONDARY = '#7A6B57';
const COLOR_BG = '#F4ECDC';

const ALERT_CHECKIN_FAILED_TITLE = '打卡失败';
const ALERT_CHECKIN_FAILED_OK_LABEL = '好';
const ALERT_UNDO_FAILED_TITLE = '撤销失败';
const ALERT_UNDO_FAILED_OK_LABEL = '好';
const SPOUSE_COMPLETED_OK_LABEL = '知道了';
const SPOUSE_COMPLETED_DISMISS_LABEL = '关闭';

// T-US015-4 C:下拉刷新失败文案 — 与 HomeScreen 保持一致
const ALERT_SYNC_TITLE = '同步未完成';
const ALERT_SYNC_MESSAGE = '部分数据未拉到,稍后会自动重试';
const ALERT_NETWORK_TITLE = '网络异常';
const ALERT_NETWORK_MESSAGE = '请检查网络连接后下拉刷新';

// T-US015-4 B:EmptyState 文案 — 过期上下文
const EMPTY_TITLE = '暂无过期任务';
const EMPTY_SUBTITLE = '保持节奏,真棒';

const DEFAULT_EXPIRY_WINDOW: ExpiryWindow = 'yesterday_today';

/**
 * 把 Date 转成 'YYYY-MM-DD'(本地时区)。
 * 与 HomeScreen.toYyyyMmDd 同形态 — 故意不复用 HomeScreen 私有 helper,本屏
 * 自包含(toYyyyMmDd 是 1 行小函数,共享反而引入 import 链耦合)。
 */
function toYyyyMmDd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 给定 family.members + created_by → user.id → '我' | '配偶' 映射。
 * 与 HomeScreen.buildAssigneeLabels 同形态 — 同样本屏自包含(避免 import HomeScreen 私有 helper)。
 */
function buildAssigneeLabels(
  members: Array<{ user_id: string }>,
  createdBy: string,
): Record<string, '我' | '配偶'> {
  const labels: Record<string, '我' | '配偶'> = {};
  for (const m of members) {
    labels[m.user_id] = m.user_id === createdBy ? '我' : '配偶';
  }
  return labels;
}

// =====================================================================
// Component
// =====================================================================

/**
 * ExpiredTasksScreen —— 过期任务列表屏。
 *
 * 数据流:
 *   - useFamilyValue() → 拿 family.id + members
 *   - useTasks() → 订阅 SyncManager.tasksSnapshot
 *   - useEffect deps:[family?.family.id, tasks.length, today]
 *     → getExpiredTasksSummary(familyId, tasks, today)
 *     → setWindow(state filter)
 *   - useMemo deps:[tasks, window, today]
 *     → filterExpiredTasks(tasks, window, today)
 *     → 已排序的过期列表
 *   - TaskList(tasks=expired, ...) → TaskCard 链渲染
 *
 * 注意:
 *   - family null(loading / no_family)→ 渲染 spinner(理论上 Gate 控制,但防御)
 *   - 初始 window state = 'yesterday_today'(fallback),直到 useEffect 异步补完
 *     → 期间列表已是 fallback 窗口下的过滤结果(无 network 调用也立刻可渲染)
 *   - getExpiredTasksSummary 内部 try/catch,失败返 fallback,不阻塞 UI
 */
export function ExpiredTasksScreen(): React.JSX.Element {
  const router = useRouter();
  const familyValue = useFamilyValue();
  const currentUserId = useCurrentUserId();
  const tasks = useTasks();

  // 当前日期(YYYY-MM-DD)— 一次性 useMemo 让 mount 期不重算;跨日由 pullSince/realtime 触发
  // tasks 数组引用变化兜底(本屏有 tasks.length 依赖,跨夜会重跑 summary)
  const today = useMemo(() => toYyyyMmDd(new Date()), []);

  // ---- assignee labels:family.members → user.id → '我' / '配偶' ----
  const assigneeLabels = useMemo(() => {
    if (!familyValue) return {};
    return buildAssigneeLabels(familyValue.members, familyValue.family.created_by);
  }, [familyValue]);

  // ---- window state:family_settings.expiry_window(单行 SELECT 派生)----
  //
  // 初始值 = DEFAULT_EXPIRY_WINDOW ('yesterday_today')— 与 useExpiredTaskCount 同步
  // 异步补完:setWindow(summary.window)。useEffect deps 包含 family.id + tasks.length + today
  // — 任一变化触发重拉(family 上下文变化 / Realtime 推送 / 跨日)
  const [window, setWindow] = useState<ExpiryWindow>(DEFAULT_EXPIRY_WINDOW);
  useEffect(() => {
    if (!familyValue) return;
    let cancelled = false;
    void getExpiredTasksSummary(familyValue.family.id, tasks, today)
      .then((summary) => {
        if (cancelled) return;
        setWindow(summary.window);
      })
      .catch((err) => {
        if (cancelled) return;
        // ExpiryService 内部 try/catch,理论上不到这;保留兜底避免 UI 卡死
        // eslint-disable-next-line no-console
        console.warn('[ExpiredTasksScreen] getExpiredTasksSummary threw:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [familyValue, tasks, today]);

  // ---- expired 列表派生:filterExpiredTasks 内部 3 排除 + 4 窗口 + 排序 ----
  const expired = useMemo(
    () => filterExpiredTasks(tasks, window, today),
    [tasks, window, today],
  );

  // ---- 返回 ----
  const handleBackPress = useCallback((): void => {
    router.back();
  }, [router]);

  // ---- 任务点击 — 跳 task/[id] 详情页(同 HomeScreen.handleTaskPress)----
  const handleTaskPress = useCallback(
    (task: Task): void => {
      router.push({
        pathname: '/(main)/(home)/task/[id]',
        params: { id: task.id },
      });
    },
    [router],
  );

  // ---- 任务打卡(过期 → isMakeup=true)----
  //
  // T-US015-3 范围:复用 CheckInService.checkin 现有接口,传 isMakeup=true 占位
  // 让 CheckInService 走 make-up 路径(若有)— T-US006 真补卡 RPC 替换占位
  //
  // 行为 3 status 同 HomeScreen.handleTaskCheckIn:
  //   - checked_in → 乐观 UI 自然切换,no toast
  //   - spouse_completed → showConfirmDialog(同 HomeScreen T-FIX-06-B M10)
  //   - failed → Alert + mapCheckInFailureReason
  const handleTaskCheckIn = useCallback(
    async (task: Task): Promise<void> => {
      const result = await CheckInService.checkin(task.id, true);
      if (result.status === 'spouse_completed') {
        const msg = mapCheckInResultToToast(result, task.title);
        showConfirmDialog({
          title: msg.title,
          message: msg.body,
          confirmLabel: SPOUSE_COMPLETED_OK_LABEL,
          cancelLabel: SPOUSE_COMPLETED_DISMISS_LABEL,
          destructive: false,
          onConfirm: () => undefined,
          onCancel: () => undefined,
        });
      } else if (result.status === 'failed') {
        Alert.alert(
          ALERT_CHECKIN_FAILED_TITLE,
          mapCheckInFailureReason(result.reason),
          [{ text: ALERT_CHECKIN_FAILED_OK_LABEL, style: 'default' }],
        );
      }
    },
    [],
  );

  // ---- 任务撤销(同 HomeScreen.handleTaskUndo)----
  const handleTaskUndo = useCallback(
    async (task: Task): Promise<void> => {
      const result = await CheckInService.undoCheckin(task.id);
      if (result.status === 'failed') {
        Alert.alert(
          ALERT_UNDO_FAILED_TITLE,
          mapUndoCheckInFailureReason(result.reason),
          [{ text: ALERT_UNDO_FAILED_OK_LABEL, style: 'default' }],
        );
      }
    },
    [],
  );

  // ---- T-US015-4 C:下拉刷新接 SyncManager.pullSince ----
  //
  // 过期列表默认依赖 Realtime 推送 + useTasks 订阅被动刷新;用户主动下拉时
  // 走 pullSince(lastSyncAt) 增量拉取增量,失败弹 Alert。
  // 设计决策:不调 useSyncManager(它内部已自动 subscribe + initial pullSince;
  //          下拉只需主动增量拉,避免重叠请求)。
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const lastSyncAt = await getLastSyncAt();
      const status: PullStatus = await pullSince(lastSyncAt);
      if (!status.ok) {
        Alert.alert(ALERT_SYNC_TITLE, ALERT_SYNC_MESSAGE);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[ExpiredTasksScreen] onRefresh failed:', e);
      Alert.alert(ALERT_NETWORK_TITLE, ALERT_NETWORK_MESSAGE);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // ---- 创建任务按钮(EmptyState 回调)— 已删除 T-US015-4 ----
  //
  // 原 TaskList view="today" 占位复用导致过期 N=0 时显示"创建任务"按钮,与
  // 过期列表语境严重错配。T-US015-4 polish 改用 EmptyState 通用组件 + 过期
  // 文案,过期列表不允许"顺手新建";新建入口保留在 Home 主屏 header。
  // 留作历史注释,避免后续重构又加回来。

  // ---- 渲染:family loading 防御 ----
  if (!familyValue) {
    return (
      <View
        style={styles.loadingContainer}
        accessibilityRole="progressbar"
        accessibilityLabel="加载中"
        testID="expired-tasks-loading"
      >
        <ActivityIndicator size="large" color={COLOR_PRIMARY} />
      </View>
    );
  }

  return (
    <YStack flex={1} backgroundColor={COLOR_BG}>
      {/* Header:左 CaretLeft + 中"过期任务"标题 + 右占位 */}
      <XStack
        alignItems="center"
        justifyContent="space-between"
        paddingHorizontal="$md"
        paddingVertical="$sm"
        backgroundColor={COLOR_BG}
      >
        <XStack
          alignItems="center"
          gap="$xs"
          onPress={handleBackPress}
          accessibilityRole="button"
          accessibilityLabel={HEADER_BACK_LABEL}
          testID="expired-tasks-back"
          pressStyle={{ opacity: 0.6 }}
        >
          <CaretLeft size={20} color={COLOR_PRIMARY} weight="bold" />
          <TamaguiText
            fontSize="$body"
            color={COLOR_PRIMARY}
            fontWeight="600"
          >
            {HEADER_BACK_LABEL}
          </TamaguiText>
        </XStack>
        <TamaguiText
          fontSize="$title"
          fontFamily="$heading"
          fontWeight="semibold"
          color={COLOR_TEXT_PRIMARY}
          accessibilityRole="header"
        >
          {HEADER_TITLE}
        </TamaguiText>
        <View style={styles.headerRightSpacer} testID="expired-tasks-header-spacer" />
      </XStack>

      {/* 过期任务数 meta 行(轻量提示,不抢视觉) */}
      <XStack
        paddingHorizontal="$md"
        paddingBottom="$sm"
        alignItems="center"
      >
        <Text style={styles.metaText} testID="expired-tasks-count">
          {expired.length === 0
            ? '暂无过期任务'
            : `共 ${expired.length} 个过期任务(按日期排序)`}
        </Text>
      </XStack>

      {/* T-US015-4 B + C:
          - N>0 时用 TaskList 渲染 TaskCard;refresh 接 onRefresh → pullSince
          - N=0 时用 EmptyState(过期上下文文案)— 不再走 TaskList 错配的 view="today"
          - 移除 onCreatePress:过期列表不允许"顺手新建",新建入口保留在 Home 主屏 */}
      {expired.length > 0 ? (
        <TaskList
          tasks={expired}
          assigneeLabels={assigneeLabels}
          today={today}
          view="today"
          refreshing={refreshing}
          onRefresh={onRefresh}
          onTaskPress={handleTaskPress}
          onTaskCheckIn={handleTaskCheckIn}
          onTaskUndo={handleTaskUndo}
          currentUserId={currentUserId}
        />
      ) : (
        <EmptyState
          icon={<CheckCircle size={48} color={COLOR_PRIMARY} weight="duotone" />}
          title={EMPTY_TITLE}
          subtitle={EMPTY_SUBTITLE}
          testID="expired-tasks-empty"
        />
      )}
    </YStack>
  );
}

// =====================================================================
// Styles
// =====================================================================

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLOR_BG,
  },
  metaText: {
    fontSize: 13,
    color: COLOR_TEXT_SECONDARY,
    fontFamily: 'NotoSansSC_Regular',
  },
  /** Header 右侧占位 — 保留布局对齐(返回 / 标题 / 右侧空位) */
  headerRightSpacer: {
    minWidth: 60,
  },
});