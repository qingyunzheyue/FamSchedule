-- ============================================================
-- FamSchedule v1.0 — RLS recursion fix
-- ============================================================
-- 问题:db-v1.0.sql 中所有 RLS policy 使用
--   family_id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid())
--   该子查询触发 family_members 自身的 RLS,无限递归,SELECT 报错。
-- 修复:抽出 SECURITY DEFINER 函数 my_family_ids(),绕过 RLS 自查询。
-- 偏离:必须修改 RLS policy 体。已记录在 task-breakdown-v1.0.md T-SETUP-1 的 handoff。
-- ============================================================

CREATE OR REPLACE FUNCTION public.my_family_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT family_id FROM public.family_members WHERE user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.my_family_ids() TO anon, authenticated, service_role;

-- 重建所有受影响的 RLS policy

DROP POLICY IF EXISTS families_select ON public.families;
CREATE POLICY families_select ON public.families
  FOR SELECT USING (id IN (SELECT public.my_family_ids()));

DROP POLICY IF EXISTS family_members_select ON public.family_members;
CREATE POLICY family_members_select ON public.family_members
  FOR SELECT USING (family_id IN (SELECT public.my_family_ids()));

DROP POLICY IF EXISTS task_templates_select ON public.task_templates;
CREATE POLICY task_templates_select ON public.task_templates
  FOR SELECT USING (family_id IN (SELECT public.my_family_ids()));
DROP POLICY IF EXISTS task_templates_insert ON public.task_templates;
CREATE POLICY task_templates_insert ON public.task_templates
  FOR INSERT WITH CHECK (family_id IN (SELECT public.my_family_ids()) AND created_by = auth.uid());
DROP POLICY IF EXISTS task_templates_update ON public.task_templates;
CREATE POLICY task_templates_update ON public.task_templates
  FOR UPDATE USING (family_id IN (SELECT public.my_family_ids()));
DROP POLICY IF EXISTS task_templates_delete ON public.task_templates;
CREATE POLICY task_templates_delete ON public.task_templates
  FOR DELETE USING (family_id IN (SELECT public.my_family_ids()));

DROP POLICY IF EXISTS tasks_select ON public.tasks;
CREATE POLICY tasks_select ON public.tasks
  FOR SELECT USING (family_id IN (SELECT public.my_family_ids()));
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT WITH CHECK (family_id IN (SELECT public.my_family_ids()));
DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE USING (family_id IN (SELECT public.my_family_ids()));
DROP POLICY IF EXISTS tasks_delete ON public.tasks;
CREATE POLICY tasks_delete ON public.tasks
  FOR DELETE USING (family_id IN (SELECT public.my_family_ids()));

DROP POLICY IF EXISTS invite_codes_select ON public.invite_codes;
CREATE POLICY invite_codes_select ON public.invite_codes
  FOR SELECT USING (family_id IN (SELECT public.my_family_ids()));
DROP POLICY IF EXISTS invite_codes_delete_unused ON public.invite_codes;
CREATE POLICY invite_codes_delete_unused ON public.invite_codes
  FOR DELETE USING (family_id IN (SELECT public.my_family_ids()) AND used_at IS NULL);

DROP POLICY IF EXISTS family_settings_select ON public.family_settings;
CREATE POLICY family_settings_select ON public.family_settings
  FOR SELECT USING (family_id IN (SELECT public.my_family_ids()));

-- 修正 anon 默认 0 行(v08 已验证过 — 没有 anon-targeted SELECT policy)
-- 重新确认:
--  v10_no_anon_select_policies: pg_policies WHERE roles @> ['anon'] AND cmd='SELECT' = 0
--  因为 my_family_ids() 在 auth.uid() IS NULL 时返回空集,RLS USING 永远 false,等于 deny。
--  无需额外修改。

-- 注意:family_member_cap trigger 仍然在 — F-6 测试会再次确认
