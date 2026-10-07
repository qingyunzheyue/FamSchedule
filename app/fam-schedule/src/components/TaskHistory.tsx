/**
 * TaskHistory — 任务详情页"打卡历史"区块 — T-US006-2
 *
 * 职责(US-006 故事 2/2 — 设计 task-detail-v1.0.md §3.2 / §6 / §7):
 *   - 详情页 InfoSection 替换原 HISTORY_PLACEHOLDER,真正显示当前 task 的打卡记录
 *   - 视觉(§3.2):`✓ HH:mm  我` / `✓ 昨天 HH:mm  配偶(补卡)`
 *   - a11y(§7 line 212):整个 section `accessibilityRole="list"`,每条 `role="listitem"`
 *   - 补卡条目带"(补卡)"标签
 *   - 按 completed_at 倒序(tasks 表是单行 completed,天然只有 1 条 — 排序 trivial)
 *
 * 设计依据:
 *   - 任务 brief §C.7 + §D.6
 *   - 数据契约:`tasks` 表只有 `completed_at` / `completed_by` / `is_makeup` 单行字段,
 *     **无多行历史表**(留后续 v2 扩展);本组件只需派生 1 条记录
 *   - 用户标签:'我' / '配偶'(沿用 HomeScreen.buildAssigneeLabels 2-人家庭简化)
 *   - 未知 user id 兜底:'家庭成员'(同 HomeScreen buildAssigneeLabels unknown 兜底)
 *
 * 派生纯函数导出(便于 jest 单测 + 后续 i18n):
 *   - formatHistoryTime(iso, now?):ISO datetime → 'HH:mm' / '昨天 HH:mm' / 'MM-dd'
 *   - formatHistoryEntry(iso, completedBy, isMakeup, assigneeLabels, now?):
 *     → { timeText, userLabel, makeupLabel }
 *   - buildHistoryRowA11yLabel(timeText, userLabel, makeupLabel):
 *     → 屏幕阅读器 label
 *
 * Props:
 *   - completedAt: ISO datetime (task.completed_at)
 *   - completedBy: user.id (task.completed_by)— null 时显示 '家庭成员'
 *   - isMakeup: boolean (task.is_makeup)
 *   - assigneeLabels: Record<user.id, '我' | '配偶'>(复用 HomeScreen buildAssigneeLabels 模式)
 *
 * 边界(dev self-acknowledge scope):
 *   - ❌ 多行历史(留 v2 扩展)— 当前 tasks 表是单行 completed_at,只有 1 条记录
 *   - ❌ 国际化(留 react-i18next)— 当前硬编码中文文案,派生纯函数抽出便于后续 i18n
 *   - ❌ 撤销入口(由 CheckInButton.UndoChip 独立承担,不在本组件重复)
 *   - ✅ completedAt === null → 组件 return null(父层条件渲染,本组件是普通区块)
 *
 * a11y(Component):
 *   - 外层 View `accessibilityRole="list"` + label '打卡历史'(设计 §7 line 212)
 *   - 每条历史 View  `accessibilityRole="listitem"` + 综合 label(屏读友好)
 */

import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Clock } from 'phosphor-react-native';

// =====================================================================
// 1. Constants
// =====================================================================

/** 未知 user id 兜底文案 */
const UNKNOWN_USER_LABEL = '家庭成员';

/** 补卡标签文案(独立常量便于 i18n) */
const MAKEUP_LABEL = '(补卡)';

/** 跨日 '昨天' 前缀 */
const YESTERDAY_PREFIX = '昨天';

/** 区块 label 文案(设计 §3.2 line 68) */
const SECTION_LABEL = '打卡历史';

// 颜色常量(与 TaskDetailScreen COLOR_* 对齐;后续如需统一可移至 tamagui token)
const COLOR_TEXT_PRIMARY = '#3A2E20';
const COLOR_TEXT_SECONDARY = '#7A6B57';
const COLOR_SUCCESS = '#5C9D7E';
const COLOR_WARNING = '#C95444';
const COLOR_BORDER = '#E8DFD0';

// =====================================================================
// 2. Types
// =====================================================================

/** user.id → '我' / '配偶' 映射(复用 HomeScreen buildAssigneeLabels 模式) */
export type AssigneeLabels = Record<string, '我' | '配偶'>;

export interface TaskHistoryProps {
  /** ISO datetime(task.completed_at)— null 时组件不渲染(父层条件渲染 wrapper) */
  completedAt: string | null;
  /** user.id(task.completed_by)— null 时兜底 '家庭成员' */
  completedBy: string | null;
  /** 是否补卡(task.is_makeup) */
  isMakeup: boolean;
  /** user.id → 标签 映射 */
  assigneeLabels: AssigneeLabels;
}

/** formatHistoryEntry 返回值 */
export interface HistoryEntry {
  /** 时间文案:'HH:mm' / '昨天 HH:mm' / 'MM-dd' */
  timeText: string;
  /** 用户文案:'我' / '配偶' / '家庭成员'(兜底) */
  userLabel: string;
  /** 补卡标签:'(补卡)' 或 null */
  makeupLabel: string | null;
}

// =====================================================================
// 3. 派生纯函数 — formatHistoryTime
// =====================================================================

/**
 * 把 ISO datetime 转成 UI 显示文案。
 *
 * 规则:
 *   - 同日(本地时区,与 today 日期字符串相同)→ 'HH:mm'
 *   - 跨日 1 天(昨天,本地时区)→ '昨天 HH:mm'
 *   - 跨日 > 1 天 → 'MM-dd'
 *
 * 设计动机:
 *   - 同日:用户关注"今天几点打的卡",'HH:mm' 直接
 *   - 跨 1 日:用户关注"是不是昨天补的卡",'昨天 HH:mm' 一眼可见
 *   - 跨多日:不常见(撤销后即正常 5 分钟窗口),简化为 'MM-dd'(与列表 TaskCard.date badge 对齐)
 *
 * @param iso — task.completed_at ISO datetime
 * @param now — 注入 now 用于测试;默认 Date.now()(组件内调用走默认)
 * @returns 'HH:mm' | '昨天 HH:mm' | 'MM-dd'
 */
export function formatHistoryTime(iso: string, now: Date = new Date()): string {
  // 用本地时区构造(避免 UTC 偏移)— 与 taskListFilters.addDays 同策略
  const dt = new Date(iso);
  const hh = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  const timeText = `${hh}:${mi}`;

  // 比较"完成日期 vs now 日期"(本地时区,YYYY-MM-DD 字符串)
  const dtYmd = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const nowYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  if (dtYmd === nowYmd) {
    return timeText;
  }

  // 跨日:算天数差(本地时区,同 taskListFilters.daysBetween 策略)
  const dtMidnight = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const daysDiff = Math.round((dtMidnight - nowMidnight) / 86_400_000);

  if (daysDiff === -1) {
    return `${YESTERDAY_PREFIX} ${timeText}`;
  }

  // > 1 天前:M-dd(月份 + 日期,不带年前缀 — 详情页内一年内的任务常见,年外罕见)
  const m = dt.getMonth() + 1;
  const d = dt.getDate();
  return `${m}-${String(d).padStart(2, '0')}`;
}

// =====================================================================
// 4. 派生纯函数 — formatHistoryEntry
// =====================================================================

/**
 * 把 (completedAt, completedBy, isMakeup) 派生完整条目文案。
 *
 * 派生:
 *   - timeText ← formatHistoryTime(iso, now)
 *   - userLabel ← assigneeLabels[completedBy] ?? '家庭成员'
 *     (completedBy === null 或不在 map 中 → 兜底)
 *   - makeupLabel ← isMakeup ? '(补卡)' : null
 *
 * @param iso — ISO datetime(task.completed_at)
 * @param completedBy — user.id(task.completed_by)
 * @param isMakeup — task.is_makeup
 * @param assigneeLabels — user.id → '我' / '配偶' 映射
 * @param now — 注入 now 用于测试;默认 Date.now()
 */
export function formatHistoryEntry(
  iso: string,
  completedBy: string | null,
  isMakeup: boolean,
  assigneeLabels: AssigneeLabels,
  now: Date = new Date(),
): HistoryEntry {
  const timeText = formatHistoryTime(iso, now);
  const userLabel =
    completedBy !== null && completedBy in assigneeLabels
      ? assigneeLabels[completedBy]
      : UNKNOWN_USER_LABEL;
  const makeupLabel = isMakeup ? MAKEUP_LABEL : null;
  return { timeText, userLabel, makeupLabel };
}

// =====================================================================
// 5. 派生纯函数 — a11y label
// =====================================================================

/**
 * 构造单条打卡记录的 a11y label — 屏幕阅读器朗读完整语义。
 *
 * 设计(任务 brief §C.7):
 *   - 非补卡:`<timeText> <userLabel> 完成`  → 例:'10:05 我 完成'
 *   - 补卡  :`<timeText> <userLabel> 补卡完成` → 例:'昨天 10:02 配偶 补卡完成'
 *
 * 选词动机:
 *   - "完成"而非"已完成"→ 设计 task-detail-v1.0 §10 line 243:"由小张完成 而非 小张已完成"(更顺)
 *   - "补卡完成"= "完成" + "补卡"修饰词 → 屏幕阅读器先把播报"补卡"前置语位,让用户立即明白这是补卡而非普通打卡
 *
 * @param timeText — 已格式化的 'HH:mm' / '昨天 HH:mm' / 'MM-dd'
 * @param userLabel — '我' / '配偶' / '家庭成员'
 * @param makeupLabel — '(补卡)' 或 null
 */
export function buildHistoryRowA11yLabel(
  timeText: string,
  userLabel: string,
  makeupLabel: string | null,
): string {
  // 补卡时把 "(补卡)" 括号去掉,改用更口语化的 "补卡完成"(屏读更顺)
  if (makeupLabel !== null) {
    return `${timeText} ${userLabel} 补卡完成`;
  }
  return `${timeText} ${userLabel} 完成`;
}

// =====================================================================
// 6. Component
// =====================================================================

/**
 * 任务详情页"打卡历史"区块 — `✓ HH:mm  我`(可带 "(补卡)" 后缀)。
 *
 * 渲染策略:
 *   - completedAt === null → return null(父层 TaskDetailScreen 应已条件渲染,本层防御)
 *   - 否则:render label header + 一条历史(单行 completed_at 字段)
 *
 * a11y(任务 detail-v1.0 §7 line 212):
 *   - 外层 View `accessibilityRole="list"` + label '打卡历史'(屏幕阅读器播报区段)
 *   - 内层单条 `accessibilityRole="listitem"` + 综合 buildHistoryRowA11yLabel 文案
 *
 * testID:`task-history`(便于 E2E / 截图回归)
 *
 * ⚠️ 故意不接 Service:本组件保持纯展示 — 数据由父层从 SyncManager.tasks 拿,
 *    跟 OverdueBanner / CheckInButton 同策略。
 */
function TaskHistoryImpl({
  completedAt,
  completedBy,
  isMakeup,
  assigneeLabels,
}: TaskHistoryProps): React.JSX.Element | null {
  // -------------------------------------------------------------------------
  // 防御:completedAt === null → 不渲染(父层应已条件渲染,这里二次防御)
  // -------------------------------------------------------------------------
  if (completedAt === null) {
    return null;
  }

  // -------------------------------------------------------------------------
  // 派生
  // -------------------------------------------------------------------------
  const entry = formatHistoryEntry(completedAt, completedBy, isMakeup, assigneeLabels);
  const rowA11yLabel = buildHistoryRowA11yLabel(entry.timeText, entry.userLabel, entry.makeupLabel);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <View
      style={styles.section}
      accessibilityRole="list"
      accessibilityLabel={SECTION_LABEL}
      testID="task-history"
    >
      {/* Header:Clock icon + '打卡历史' label — 与 InfoSection 一致布局 */}
      <View style={styles.headerRow}>
        <Clock size={20} color={COLOR_TEXT_SECONDARY} weight="regular" />
        <Text style={styles.headerLabel}>{SECTION_LABEL}</Text>
      </View>

      {/* 时间线分割线 — 设计 §3.2 line 69 视觉锚点 */}
      <View style={styles.timelineDivider} />

      {/* 单条记录(数据模型是单行,排序 trivial)— listitem
       *
       * ⚠️ TS cast:'listitem' 不在 react-native AccessibilityRole 枚举里
       * (RN 类型只列了 'none' / 'button' / 'image' / 'list' 等常见 role,
       * 没列 'listitem')。设计 task-detail-v1.0 §7 line 212 明确要求用 'listitem',
       * 屏幕阅读器(iOS VoiceOver / Android TalkBack)也都识别此 role,直接 cast 跳过类型层。
       * 后续如 RN 升级后类型补齐可移除此 cast。 */}
      <View
        style={styles.row}
        accessibilityRole={'listitem' as any}
        accessibilityLabel={rowA11yLabel}
        testID="task-history-row"
      >
        {/* ✓ 标记 — 设计 §3.2 line 70 视觉锚点 */}
        <Text
          style={styles.checkMark}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          ✓
        </Text>
        {/* 时间文案 */}
        <Text style={styles.timeText}>{entry.timeText}</Text>
        {/* 用户文案 + (可选) 补卡标签 */}
        <Text style={styles.userLabel}>
          {'  '}
          {entry.userLabel}
          {entry.makeupLabel !== null ? (
            <Text style={styles.makeupLabel}>{entry.makeupLabel}</Text>
          ) : null}
        </Text>
      </View>
    </View>
  );
}

/**
 * memo 包过:同 props 引用稳定时不重渲染。
 * 父层 TaskDetailScreen 用 useMemo(assigneeLabels) + 完成态属性稳定时,引用一致。
 */
export const TaskHistory = memo(TaskHistoryImpl);

// =====================================================================
// 7. Styles
// =====================================================================

const styles = StyleSheet.create({
  section: {
    marginTop: 16, // 与 InfoSection marginTop="$md" 一致
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLOR_BORDER,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  headerLabel: {
    fontSize: 13,
    color: COLOR_TEXT_SECONDARY,
    fontWeight: '600',
    fontFamily: 'System', // 接近 Tamagui.$heading 视觉
  },
  timelineDivider: {
    height: 1,
    backgroundColor: COLOR_BORDER,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  checkMark: {
    fontSize: 14,
    color: COLOR_SUCCESS,
    fontWeight: '600',
    marginRight: 6,
  },
  timeText: {
    fontSize: 15,
    color: COLOR_TEXT_PRIMARY,
    fontWeight: '500',
  },
  userLabel: {
    fontSize: 15,
    color: COLOR_TEXT_SECONDARY,
    flexShrink: 1,
  },
  makeupLabel: {
    fontSize: 13,
    color: COLOR_WARNING,
    fontWeight: '600',
  },
});