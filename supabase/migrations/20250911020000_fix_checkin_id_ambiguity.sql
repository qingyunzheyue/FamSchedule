-- ============================================================
-- FamSchedule v1.0 — checkin_task function id-ambiguity fix
-- ============================================================
-- 问题:db-v1.0.sql 的 checkin_task() 函数体内,
--   WHERE id = p_task_id  和  is_makeup_allowed(id, v_caller)
--   中的 "id" 在 PL/pgSQL 中歧义(RETURNS TABLE 的 id 列 vs public.tasks.id)。
--   函数创建成功但首次调用就报 "column reference id is ambiguous"。
-- 修复:所有引用 tasks.id 的位置都加 public.tasks. 前缀。
-- 偏离:必须重写 checkin_task 函数体。已记录。
-- ============================================================

CREATE OR REPLACE FUNCTION public.checkin_task(
  p_task_id UUID,
  p_is_makeup BOOLEAN DEFAULT false
)
RETURNS TABLE (id UUID, completed_at TIMESTAMPTZ, completed_by UUID, is_makeup BOOLEAN)
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
  SET completed_at = now(),
      completed_by = v_caller,
      is_makeup = p_is_makeup
  WHERE t.id = p_task_id
    AND t.cancelled = false
    AND t.completed_at IS NULL
    AND (NOT p_is_makeup OR public.is_makeup_allowed(t.id, v_caller))
  RETURNING t.id, t.completed_at, t.completed_by, t.is_makeup;
END;
$$;

-- 同样的歧义也可能存在于 undo_checkin(检查一下)
-- undo_checkin 没有 RETURNS TABLE 的 id 列冲突,但保守起见也加前缀
-- 实际上原版 undo_checkin 用的就是 tasks.id,不会歧义,保持不变

-- 重新授权(若之前的 GRANT EXECUTE 还在则不影响)
GRANT EXECUTE ON FUNCTION public.checkin_task(UUID, BOOLEAN) TO anon, authenticated, service_role;
