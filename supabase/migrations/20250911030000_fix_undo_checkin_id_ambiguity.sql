-- ============================================================
-- FamSchedule v1.0 — undo_checkin function id-ambiguity fix
-- ============================================================
-- 问题:与 checkin_task 同样的 PL/pgSQL 变量歧义 bug
--   SET completed_at = ...  WHERE id = p_task_id
--   WHERE completed_by = ... AND completed_at > ...
--   RETURNS TABLE 的 id / completed_at / completed_by / is_makeup 与
--   public.tasks 同名列歧义,undo_checkin 调用时报 "column reference X is ambiguous"。
--   静态测试未发现是因为 verify.sql 不实际调 undo_checkin。
-- 修复:UPDATE 用表别名 AS t 解除歧义。
-- ============================================================

CREATE OR REPLACE FUNCTION public.undo_checkin(p_task_id UUID)
RETURNS TABLE (id UUID, completed_at TIMESTAMPTZ, completed_by UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  UPDATE public.tasks AS t
  SET completed_at = NULL,
      completed_by = NULL,
      is_makeup = false
  WHERE t.id = p_task_id
    AND t.completed_by = v_caller
    AND t.completed_at > now() - interval '5 minutes'
  RETURNING t.id, t.completed_at, t.completed_by;
END;
$$;

GRANT EXECUTE ON FUNCTION public.undo_checkin(UUID) TO anon, authenticated, service_role;
