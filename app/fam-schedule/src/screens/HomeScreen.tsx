/**
 * HomeScreen — 任务列表主页 — T-US002-1 + T-US003-2 + T-US005-1 + T-US005-2
 *
 * 职责(US-002 故事 1/3 — 端到端任务可视化 + US-005 故事 1/4 — 列表打卡 +
 *       US-005 故事 2/4 — 配偶先完成 toast):
 *   1. mount 时通过 useSyncManager(familyId) 自动 subscribe + Realtime + pullSince
 *   2. 通过 useTasks() 订阅 SyncManager.tasksSnapshot,响应 setTasks / pullSince / realtime 变更
 *   3. URL `?view=today|week|all` 作为视图 source of truth,默认 today
 *   4. filterTasks 筛选 + 排序(today/week/all)
 *   5. SegmentedTab 切换视图 + TaskList 渲染 TaskCard
 *   6. 下拉刷新 → pullSince,失败弹 Alert
 *   7. **T-US003-2**:列表 long-press 删除入口(简化版直接删,留 T-FIX-06 polish)
 *   8. **T-US005-1 新增**:打卡回调(handleTaskCheckIn)→ 调 CheckInService.checkin
 *      → 失败 Alert(翻译 mapCheckInFailureReason) / 成功 noop(乐观 UI 自然切换)
 *   9. **T-US005-2 新增**:打卡回调 3 status 分支 —
 *      - checked_in(我先完成):UI 乐观切到 completed 态,no toast
 *      - spouse_completed(配偶先完成):Alert.alert("配偶已先一步完成", "由配偶于 HH:MM 完成")
 *      - failed:Alert 翻译失败 reason
 *
 * 设计依据:
 *   - home-v1.0.md §3 布局 + §6 文案 + §7 a11y
 *   - ADR-005:SyncManager 是 server 镜像的 single source of truth,UI 不直接调 supabase
 *   - 设计 task-detail-v1.0 §10:配偶先完成用 Toast(本任务用 Alert 跨平台一致,留 polish)
 *
 * 简化决策(本任务严格 scope):
 *   - **Header 简化版**:只渲染"任务列表"标题 + 右上角 + 按钮;不渲染大日期 + 时段问候
 *     (留 T-US002-2)。brief 明确说"❌ Header 大日期 + 时段问候"
 *   - **过期 banner**:无(留 T-US014 / T-US015)
 *   - **Skeleton / OfflineBanner**:无(留 Wave 3)
 *   - **TaskCard 点击**:跳 task/[id](TaskDetailScreen)— T-US003-1 已闭环
 *   - **T-US003-2 列表 long-press 删除**:不走二次确认,直接删除 + Alert 已删除
 *   - **T-US005-1 列表打卡**:走乐观 UI — 点击 → CheckInService → SyncManager
 *     enqueueAndApply → LocalStore 立即标 completed_at → useTasks() 自然刷新 → CheckInButton
 *     切到 completed 视觉态。失败的 case 弹 Alert,成功的 noop。
 *   - **T-US005-2 spouse_completed 用 Alert 而非 iOS Toast**:跨平台一致(无 2 秒自动消失)
 *     TODO 后续 T-FIX-06 polish 用 react-native-toast-message 提供原生 iOS Toast 体验
 *
 * URL 同步:
 *   - view 参数是 router state(URL `?view=today`)。useSearchParams 读 → 渲染;
 *     SegmentedTab onChange → router.setParams → URL 变 → useSearchParams 重读 → 重渲染。
 *   - 这样用户从 home tab 切到 family tab 再回来,view 状态保留(URL 是 router 单例)。
 *
 * 下拉刷新:
 *   - 调 pullSince(lastSyncAt);PullStatus.ok=false → Alert「同步未完成」
 *   - throw(网络断等)→ Alert「网络异常」
 *
 * 不在本屏范围:
 *   - 任务详情页(T-US003)
 *   - 创建任务(走 router.push 到 task-create route,T-US001-1 已闭环)
 *   - 过期 banner / Skeleton / 共同执行人 / 周期 / 共享(T-US002-2+ 后续)
 *   - 打卡历史 / 撤销打卡 / 补卡(US-005 / US-006 后续任务)
 *   - iOS Toast(留 T-FIX-06 polish)
 */

import { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Button, XStack, YStack } from 'tamagui';
import { Plus, ListChecks } from 'phosphor-react-native';

import { useTasks } from '../hooks/useTasks';
import { useFamilyValue, useCurrentUserId } from '../contexts/FamilyContext';
import { pullSince, useSyncManager, type PullStatus } from '../lib/SyncManager';
import { getLastSyncAt } from '../lib/LocalStore';
import { filterTasks, type ViewMode } from '../lib/taskListFilters';
import { mapDeleteFailureReason, mapCheckInFailureReason, mapCheckInResultToToast } from '../lib/createTaskForm';
import { SegmentedTab } from '../components/SegmentedTab';
import { TaskList } from '../components/TaskList';
import { TaskService } from '../services/TaskService';
import { CheckInService } from '../services/CheckInService';
import type { Task } from '../lib/LocalStore';

// =====================================================================
// Constants — UI 文案 + 颜色(集中常量,便于后续国际化)
// =====================================================================

const HEADER_TITLE = '任务列表';
const CREATE_BUTTON_LABEL = '新建任务';

const COLOR_PRIMARY = '#DC5A24';
const COLOR_TEXT_PRIMARY = '#3A2E20';
const COLOR_TEXT_SECONDARY = '#7A6B57';
const COLOR_BG = '#F4ECDC';

const ALERT_SYNC_TITLE = '同步未完成';
const ALERT_SYNC_MESSAGE = '部分数据未拉到,稍后会自动重试';
const ALERT_NETWORK_TITLE = '网络异常';
const ALERT_NETWORK_MESSAGE = '请检查网络连接后下拉刷新';

/** T-US005-1 列表打卡失败标题 */
const CHECKIN_FAILED_TITLE = '打卡失败';
const CHECKIN_FAILED_OK_LABEL = '好';

/** T-US005-2 列表打卡 — 配偶先完成提示按钮 label */
const SPOUSE_COMPLETED_OK_LABEL = '好';

/** T-US003-2 列表 long-press 删除文案 */
const LONGPRESS_DELETED_TITLE = '已删除';
const LONGPRESS_DELETED_MESSAGE_PREFIX = '任务"';
const LONGPRESS_DELETED_MESSAGE_SUFFIX = '"已删除';
const LONGPRESS_DELETED_OK_LABEL = '好';
const LONGPRESS_TEMPLATE_BLOCKED_TITLE = '模板任务暂不支持删除';
const LONGPRESS_TEMPLATE_BLOCKED_MESSAGE = '请进详情页操作';
const LONGPRESS_DELETE_FAILED_TITLE = '删除失败';
const LONGPRESS_DELETE_FAILED_OK_LABEL = '好';

const VIEW_MODES: ReadonlyArray<ViewMode> = ['today', 'week', 'all'];

/**
 * URL ?view= 参数解析 + 校验。
 * 非法 / 缺失 → fallback 'today'(默认行为)。
 *
 * 暴露为独立函数便于 HomeScreen useMemo 缓存 + 单测覆盖。
 */
export function parseViewParam(raw: string | string[] | undefined): ViewMode {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v && (VIEW_MODES as ReadonlyArray<string>).includes(v)) {
    return v as ViewMode;
  }
  return 'today';
}

/**
 * 把 family members 翻译成 user.id → '我' | '配偶' 映射。
 *
 * 简化决策:
 *   - 2 人家庭里:family.created_by 是"我",其余一个 member 是"配偶"
 *   - 多人家庭(T-US012+ 扩展):非 created_by 的全部 label 为"家人 N"(留后续)
 *
 * 本任务范围内只支持 2 人家庭场景(任务 DoD 明确)。
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

/**
 * 把 Date 转成 'YYYY-MM-DD'(本地时区)。
 * 用于今天的日期字符串(传给 filterTasks / computeTaskBadge 的 today 参数)。
 */
function toYyyyMmDd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// =====================================================================
// Component
// =====================================================================

/**
 * HomeScreen —— 任务列表主页(US-002 故事 1/3)。
 *
 * 数据流:
 *   - useSyncManager(familyId) → 自动 subscribe + Realtime + 初始 pullSince
 *   - useTasks() → tasks 快照(SyncManager 写入即响应)
 *   - useLocalSearchParams().view → 当前 view(today/week/all)
 *   - filterTasks(tasks, view, today) → 已排序的列表
 *   - TaskList 渲染 + FlatList 下拉刷新 → pullSince
 *
 * 注意:
 *   - useSyncManager 必须在 familyId 非 null 时才调用(mount 时 familyContext 还在 loading)。
 *     这里传 nullable,hook 内部会处理 null 情况。
 *   - familyValue 为 null(familyContext loading / no_family)时,本屏渲染加载态 —
 *     实际上 family context 是顶层 Gate 管的,HomeScreen 只在 in_family 后才被挂载
 *     (Expo Router + Gate 控制),所以这里再防御一层。
 */
export function HomeScreen(): React.JSX.Element {
  const router = useRouter();
  const familyValue = useFamilyValue();
  const params = useLocalSearchParams<{ view?: string }>();

  // 当前 view(today/week/all)—— 默认 today
  const view: ViewMode = useMemo(() => parseViewParam(params.view), [params.view]);

  // 订阅 SyncManager(familyId 变化时自动重订阅 + pullSince)
  useSyncManager(familyValue?.family.id ?? null);

  // 订阅 tasks 快照
  const tasks = useTasks();

  // assigneeLabels:family.members → user.id → '我' / '配偶'
  const assigneeLabels = useMemo(() => {
    if (!familyValue) return {};
    return buildAssigneeLabels(familyValue.members, familyValue.family.created_by);
  }, [familyValue]);

  // 当前日期(YYYY-MM-DD)—— 用于 filterTasks / computeTaskBadge
  // 每次 render 都算;Date.now() 改变不会触发 re-render(用户停留页面期间日期不跨日),
  // 跨日的边界情况由后续 pullSince / realtime 自然刷新兜底。
  const today = useMemo(() => toYyyyMmDd(new Date()), []);

  // 筛选 + 排序后的列表
  const filtered = useMemo(
    () => filterTasks(tasks, view, today),
    [tasks, view, today],
  );

  // ---- 视图切换 ----

  const handleViewChange = useCallback(
    (next: ViewMode) => {
      router.setParams({ view: next });
    },
    [router],
  );

  // ---- 创建任务(跳 route) ----

  const handleCreatePress = useCallback(() => {
    router.push('/(main)/(home)/task-create');
  }, [router]);

  // ---- 任务点击 — T-US003-1:真正跳详情页 ----

  const handleTaskPress = useCallback(
    (task: Task): void => {
      // T-US003-1:TaskCard 内部不再 useRouter,改为纯展示 + onPress 回调;
      // HomeScreen 统一管理 navigation(便于埋点 / 拦截 / 替换路由)。
      router.push({
        pathname: '/(main)/(home)/task/[id]',
        params: { id: task.id },
      });
    },
    [router],
  );

  // ---- 任务长按 — T-US003-2:列表 long-press 直接删除(简化版) ----
  //
  // 与详情页删除(⋮ → 二次确认 → DELETE)的差异化:
  //   - 详情页删除走 RN Alert 二次确认(⋮ 是显式操作,需要慎重)
  //   - 列表 long-press **不**走二次确认(简化 UX),直接 DELETE + Alert 已删除
  //   - T-FIX-06 polish 时再加二次确认
  //
  // 简化决策(本任务严格 scope):
  //   - 仅一次性任务(template_id === null)走 DELETE
  //   - 模板任务 → Alert "模板任务暂不支持删除,请进详情页操作"
  //   - 失败 → Alert "删除失败" + mapDeleteFailureReason 翻译
  const handleTaskLongPress = useCallback(async (task: Task): Promise<void> => {
    // 模板任务分支:占位,留 T-US004-1 后做整系列级联
    if (task.template_id !== null) {
      Alert.alert(LONGPRESS_TEMPLATE_BLOCKED_TITLE, LONGPRESS_TEMPLATE_BLOCKED_MESSAGE);
      return;
    }

    const result = await TaskService.deleteTask(task.id);
    if (result.status === 'deleted') {
      // 列表走 useTasks() 订阅,SyncManager.realtime 会自然刷新,无需手动 setTasks
      Alert.alert(
        LONGPRESS_DELETED_TITLE,
        `${LONGPRESS_DELETED_MESSAGE_PREFIX}${task.title}${LONGPRESS_DELETED_MESSAGE_SUFFIX}`,
        [{ text: LONGPRESS_DELETED_OK_LABEL, style: 'default' }],
      );
    } else {
      Alert.alert(
        LONGPRESS_DELETE_FAILED_TITLE,
        mapDeleteFailureReason(result.reason),
        [{ text: LONGPRESS_DELETE_FAILED_OK_LABEL, style: 'default' }],
      );
    }
  }, []);

  // ---- 任务打卡 — T-US005-1 + T-US005-2 ----
  //
  // 列表 CheckInButton 点击触发。行为:
  //   - 调 CheckInService.checkin(taskId, false)— 走 SyncManager.enqueueAndApply
  //     乐观更新 + 入队 + 在线即触发 RPC(ADR-005 contract)
  //   - CheckInService.checkin 在 T-US005-2 后返回 3 种 status:
  //     a) 'checked_in'        — 我先完成(成功)— UI 乐观切到 completed 态,
  //                              跨组件一致地不弹 toast(简洁);Realtime 推送兜底
  //     b) 'spouse_completed'  — 配偶先 done(0 行 RPC)— Alert "配偶已先一步完成"
  //     c) 'failed'            — pre-check 失败 — Alert "打卡失败" + 翻译 reason
  //   - 留后续:
  //     - 5 分钟内撤销入口(T-US005-3)— CheckInButton completed 态点击目前 noop
  //     - iOS Toast polish(react-native-toast-message)— 当前用 Alert.alert 跨平台一致
  const handleTaskCheckIn = useCallback(
    async (task: Task): Promise<void> => {
      const result = await CheckInService.checkin(task.id, false);
      // checked_in:乐观 UI 自然切换,不弹 toast(简洁)
      if (result.status === 'spouse_completed') {
        const msg = mapCheckInResultToToast(result, task.title);
        Alert.alert(msg.title, msg.body, [
          { text: SPOUSE_COMPLETED_OK_LABEL, style: 'default' },
        ]);
      } else if (result.status === 'failed') {
        Alert.alert(
          CHECKIN_FAILED_TITLE,
          mapCheckInFailureReason(result.reason),
          [{ text: CHECKIN_FAILED_OK_LABEL, style: 'default' }],
        );
      }
    },
    [],
  );

  // ---- 当前用户 ID(T-US005-1)— 透传给 CheckInButton 用于派生 me / spouse 视觉 ----

  const currentUserId = useCurrentUserId();

  // ---- 下拉刷新 ----

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
      console.warn('[HomeScreen] onRefresh failed:', e);
      Alert.alert(ALERT_NETWORK_TITLE, ALERT_NETWORK_MESSAGE);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // ---- 渲染 ----

  // Family 还在 loading 时显示 spinner(理论上 Gate 控制,但防御)
  if (!familyValue) {
    return (
      <View
        style={styles.loadingContainer}
        accessibilityRole="progressbar"
        accessibilityLabel="加载中"
      >
        <ActivityIndicator size="large" color={COLOR_PRIMARY} />
      </View>
    );
  }

  return (
    <YStack flex={1} backgroundColor={COLOR_BG}>
      {/* Header 简化版 —— 标题 + + 按钮(无大日期 / 时段问候) */}
      <XStack
        alignItems="center"
        justifyContent="space-between"
        paddingHorizontal="$md"
        paddingVertical="$sm"
        backgroundColor={COLOR_BG}
      >
        <XStack gap="$sm" alignItems="center">
          <ListChecks size={28} color={COLOR_PRIMARY} weight="duotone" />
          <Text
            style={styles.headerTitle}
            accessibilityRole="header"
          >
            {HEADER_TITLE}
          </Text>
        </XStack>
        <Button
          theme="active"
          size="$md"
          icon={<Plus size={20} color="#FFFFFF" weight="bold" />}
          onPress={handleCreatePress}
          accessibilityLabel={CREATE_BUTTON_LABEL}
          testID="header-create-button"
        >
          {CREATE_BUTTON_LABEL}
        </Button>
      </XStack>

      {/* SegmentedTab —— view switcher */}
      <SegmentedTab value={view} onChange={handleViewChange} />

      {/* TaskList —— 列表 + 空状态 + 下拉刷新 */}
      <TaskList
        tasks={filtered}
        assigneeLabels={assigneeLabels}
        today={today}
        view={view}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onTaskPress={handleTaskPress}
        onTaskLongPress={handleTaskLongPress}
        onTaskCheckIn={handleTaskCheckIn}
        currentUserId={currentUserId}
        onCreatePress={handleCreatePress}
      />
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
  headerTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: COLOR_TEXT_PRIMARY,
    fontFamily: 'NotoSansSC_Semibold',
  },
});
