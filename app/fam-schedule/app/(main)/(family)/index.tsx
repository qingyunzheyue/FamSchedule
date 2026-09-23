import { Link, Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { YStack, XStack, Text, Button } from 'tamagui';
import { UserPlus, House, Crown } from 'phosphor-react-native';

import { useAuth } from '../../../src/contexts/AuthContext';
import { useFamilyValue } from '../../../src/contexts/FamilyContext';
import { useTasks } from '../../../src/hooks/useTasks';
import { useSyncManager } from '../../../src/lib/SyncManager';
import type { FamilyMemberRow } from '../../../src/types/database';

/**
 * T-US012-1 + T-US005-4 — Family dashboard(US-011 公开看板 + US-012 邀请码入口 + Realtime 预占)。
 *
 * 升级内容:
 *   - 之前是 placeholder,只有硬编码的我 / 配偶两行 + "邀请配偶" 按钮
 *   - T-US012-1 起消费 useFamilyValue():从 FamilyContext 拿真实 family + members
 *   - 当前 user 始终是第一个 member row(family_members 的 joined_at 升序自己排第几不一定,
 *     这里按"我"匹配 user_id 高亮 → 配偶是其他 member);根据 myRole 显示 creator/member 徽标
 *
 * 设计依据:
 *   - family-dashboard-v1.0.md §3 布局 — 简化为 v1:成员卡 + 邀请入口
 *     (完成度 / 共享任务 / 看板留给后续 US-002/009/010)
 *   - DD-002 ghost avatar pattern:A 我 / B 配偶 双色 tag,根据 joined_at 顺序推断
 *     谁是 A 谁是 B(先 joined 的 → A = 我/creator,后 joined 的 → B = 配偶)
 *
 * 不在范围(后续任务):
 *   - US-012-2 邀请码倒计时
 *   - US-011 家庭公开看板完整版(连续打卡 / 周完成统计)
 *   - US-009 / US-010 共享任务列表
 *
 * T-US005-4 预占(Realtime 数据流提前挂载):
 *   - 当前 placeholder 只展示成员卡 + 邀请入口,**不**消费 tasks
 *   - mount useSyncManager —— 提前订阅 family Realtime channel + NetInfo 监听,
 *     未来 US-011 看板(连续打卡 / 周完成统计)与 US-009 / US-010 共享任务列表接入
 *     时,直接读 useTasks() 即可,无需再补订阅基础设施
 *   - mount useTasks() —— 预占 data flow,返回值本任务暂不消费(消费场景
 *   - 留待后续 US-011 / US-009 / US-010)
 *   - **不**改 placeholder 渲染逻辑 — 严格 forward-only
 */
export default function FamilyHome(): React.JSX.Element {
  const { user } = useAuth();
  const family = useFamilyValue();

  // T-US005-4:Realtime 数据流预占 —— 挂 hook 让家庭 Tab 进入时即订阅 tasks 表,
  // 后续 US-011 看板完成度统计直接读 useTasks() 即可。
  // ⚠️ useTasks() 返回值本任务暂不消费,仅预占数据流(避免 placeholder 渲染变更)。
  useTasks();
  useSyncManager(family?.family.id ?? null);

  // FamilyContext 还没拿到 family 数据 → 兜底回 onboarding
  // (理论上 Gate 已拦住,但 useFamilyValue 的 null 分支仍要兜住)
  if (!family) {
    return <Redirect href="/(onboarding)/pair-create" />;
  }

  const myUserId = user?.id ?? '';
  // 按 joined_at 升序给成员排序,先加入的算 A(creator) / 后加入的算 B(member)
  const sortedMembers = [...family.members].sort((a, b) =>
    a.joined_at.localeCompare(b.joined_at),
  );

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <YStack
        flex={1}
        padding="$lg"
        gap="$lg"
        backgroundColor="$background"
      >
        <XStack gap="$sm" alignItems="center">
          <House size={28} color="#DC5A24" weight="duotone" />
          <Text
            fontSize="$title"
            fontFamily="$heading"
            fontWeight="semibold"
            color="$textPrimary"
          >
            我的家庭
          </Text>
        </XStack>

        {/* 家庭成员卡 — T-US012-1 真实数据 */}
        <YStack
          gap="$md"
          padding="$lg"
          borderRadius="$lg"
          backgroundColor="$surface"
          borderColor="$border"
          borderWidth={1}
        >
          <Text
            fontSize="$heading"
            fontFamily="$heading"
            fontWeight="semibold"
            color="$textPrimary"
          >
            家庭成员({family.members.length})
          </Text>

          {sortedMembers.map((member, idx) => (
            <MemberRow
              key={`${member.family_id}-${member.user_id}`}
              member={member}
              identity={idx === 0 ? 'A' : 'B'}
              isMe={member.user_id === myUserId}
              isCreator={member.user_id === family.family.created_by}
            />
          ))}

          {/* 还没配偶时(只有 1 个 member)显示"邀请配偶" 引导 */}
          {family.members.length < 2 ? (
            <Text fontSize="$meta" color="$textTertiary" marginTop="$sm">
              等待配偶加入…
            </Text>
          ) : null}
        </YStack>

        {/* 邀请配偶入口 */}
        <Link href="/(main)/(family)/invite-display" asChild>
          <Button
            theme="active"
            icon={<UserPlus size={20} color="#FFFFFF" weight="bold" />}
          >
            邀请配偶加入
          </Button>
        </Link>

        <Text fontSize="$meta" color="$textTertiary" textAlign="center">
          {family.members.length} 位成员 · 家庭 ID: {family.family.id.slice(0, 8)}…
        </Text>
      </YStack>
    </SafeAreaView>
  );
}

interface MemberRowProps {
  member: FamilyMemberRow;
  identity: 'A' | 'B';
  isMe: boolean;
  isCreator: boolean;
}

function MemberRow({ member, identity, isMe, isCreator }: MemberRowProps): React.JSX.Element {
  const isA = identity === 'A';
  const tagBg = isA ? '$identityABg' : '$identityBBg';
  const tagColor = isA ? '$identityA' : '$identityB';
  const displayName = isMe ? '我' : '配偶';

  return (
    <XStack
      gap="$md"
      alignItems="center"
      justifyContent="space-between"
      paddingVertical="$sm"
    >
      <XStack gap="$sm" alignItems="center">
        <YStack
          width={40}
          height={40}
          borderRadius="$full"
          backgroundColor={tagBg}
          alignItems="center"
          justifyContent="center"
        >
          <Text fontSize="$heading" color={tagColor} fontWeight="semibold">
            {displayName.slice(0, 1)}
          </Text>
        </YStack>
        <YStack gap="$xs">
          <Text fontSize="$heading" color="$textPrimary" fontWeight="medium">
            {displayName}
          </Text>
          <Text fontSize="$micro" color="$textTertiary">
            加入于 {formatJoinedAt(member.joined_at)}
          </Text>
        </YStack>
      </XStack>
      <YStack gap="$xs" alignItems="flex-end">
        <XStack gap="$xs" alignItems="center">
          {isCreator ? (
            <Crown size={12} color="#DC5A24" weight="fill" />
          ) : null}
          <Text
            fontSize="$micro"
            color={tagColor}
            backgroundColor={tagBg}
            paddingHorizontal="$sm"
            paddingVertical="$xs"
            borderRadius="$md"
            fontWeight="semibold"
          >
            Identity {identity}
          </Text>
        </XStack>
        {isCreator ? (
          <Text fontSize="$micro" color="$textTertiary">
            创建者
          </Text>
        ) : null}
      </YStack>
    </XStack>
  );
}

/**
 * 格式化 joined_at 为"9 月 1 日"中文短版(避免显示完整 ISO 字符串)。
 * MVP 简化:取 YYYY-MM-DD,中文月日拼接。
 * i18n 留后续;P0 阶段只服务中文用户。
 */
function formatJoinedAt(iso: string): string {
  // iso = 'YYYY-MM-DDTHH:MM:SS.sssZ' → 截前 10 位
  const date = iso.slice(0, 10);
  const [, month, day] = date.split('-');
  return `${parseInt(month, 10)} 月 ${parseInt(day, 10)} 日`;
}