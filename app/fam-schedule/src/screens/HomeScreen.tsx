/**
 * HomeScreen — 任务列表主页 — T-US002-1
 *
 * 职责(US-002 故事 1/3 — 端到端任务可视化):
 *   1. mount 时通过 useSyncManager(familyId) 自动 subscribe + Realtime + pullSince
 *   2. 通过 useTasks() 订阅 SyncManager.tasksSnapshot,响应 setTasks / pullSince / realtime 变更
 *   3. URL `?view=today|week|all` 作为视图 source of truth,默认 today
 *   4. filterTasks 筛选 + 排序(today/week/all)
 *   5. SegmentedTab 切换视图 + TaskList 渲染 TaskCard
 *   6. 下拉刷新 → pullSince,失败弹 Alert
 *
 * 设计依据:
 *   - home-v1.0.md §3 布局 + §6 文案 + §7 a11y
 *   - ADR-005:SyncManager 是 server 镜像的 single source of truth,UI 不直接调 supabase
 *
 * 简化决策(本任务严格 scope):
 *   - **Header 简化版**:只渲染"任务列表"标题 + 右上角 + 按钮;不渲染大日期 + 时段问候
 *     (留 T-US002-2)。brief 明确说"❌ Header 大日期 + 时段问候"
 *   - **过期 banner**:无(留 T-US014 / T-US015)
 *   - **打卡 button**:无(留 T-US005)
 *   - **Skeleton / OfflineBanner**:无(留 Wave 3)
 *   - **TaskCard 点击**:跳 task/[id] 占位 wrapper(无副作用,等 T-US003 接入)
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
 *   - 过期 banner / 打卡按钮 / Skeleton / 共同执行人 / 周期 / 共享(T-US002-2+ 后续)
 */

import { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Button, XStack, YStack } from 'tamagui';
import { Plus, ListChecks } from 'phosphor-react-native';

import { useTasks } from '../hooks/useTasks';
import { useFamilyValue } from '../contexts/FamilyContext';
import { pullSince, useSyncManager, type PullStatus } from '../lib/SyncManager';
import { getLastSyncAt } from '../lib/LocalStore';
import { filterTasks, type ViewMode } from '../lib/taskListFilters';
import { SegmentedTab } from '../components/SegmentedTab';
import { TaskList } from '../components/TaskList';
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

  // ---- 任务点击(目前 TaskCard 内部已自己 push,这里留 hook 给后续埋点) ----

  const handleTaskPress = useCallback((_task: Task) => {
    // T-US002-1 不做埋点;TaskCard 内部 router.push 已生效
    // 留 hook 给 T-US003 / analytics 用
  }, []);

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
