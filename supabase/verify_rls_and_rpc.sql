-- ============================================================
-- FamSchedule v1.0 — Dynamic RLS / RPC Functional Verification
-- ============================================================
-- 用于 T-SETUP-1 部署后的功能层验证。
-- 必须以 service_role(或 postgres)运行,内部会 SET LOCAL ROLE 模拟 anon / authenticated。
-- 这一组比 verify.sql 更"贵"——会创建临时 family / user,跑完后需要清理。
--
-- 跑法(在 Supabase SQL Editor 中以 postgres / service_role 身份):
--   1. 整段复制到 SQL Editor
--   2. 一次性 RUN
--   3. 观察每个 check 行 pass = true
-- ============================================================

-- ============================================================
-- Prepare:创建两个临时 test user 的 auth.users 行(用 gen_random_uuid 模拟 anon sign-in)
-- 用 SECURITY DEFINER 的 service_role 写 auth.users 是允许的(超管)
-- ============================================================

DO $$
DECLARE
  v_user_a UUID := gen_random_uuid();
  v_user_b UUID := gen_random_uuid();
  v_family_id UUID;
  v_task_id UUID;
  v_code TEXT;
  v_rows INT;
BEGIN
  -- 写入两个 test user(没有 email/phone,模拟 anon sign-in 的产物)
  INSERT INTO auth.users (id, instance_id, aud, role, created_at, updated_at)
  VALUES (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO auth.users (id, instance_id, aud, role, created_at, updated_at)
  VALUES (v_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now())
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================
  -- Test F-1: anon 角色查询 families 应返回 0 行(RLS deny-by-default)
  -- ============================================================
  SET LOCAL ROLE anon;
  SELECT COUNT(*) INTO v_rows FROM public.families;
  RESET ROLE;
  RAISE NOTICE 'F-1 anon families count: % (expect 0)', v_rows;

  -- ============================================================
  -- Test F-2: 模拟 user_a 调 create_family RPC(必须返回新 family_id)
  -- ============================================================
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  SET LOCAL ROLE authenticated;
  SELECT public.create_family() INTO v_family_id;
  RESET ROLE;
  RAISE NOTICE 'F-2 create_family by user_a: family_id=%', v_family_id;

  -- ============================================================
  -- Test F-3: 模拟 user_b 通过 user_a 生成的邀请码加入
  -- ============================================================
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  SET LOCAL ROLE authenticated;
  SELECT (code)::text INTO v_code FROM public.create_invite();
  RESET ROLE;
  RAISE NOTICE 'F-3 create_invite code: %', v_code;

  PERFORM set_config('request.jwt.claim.sub', v_user_b::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.accept_invite(v_code);
  RESET ROLE;
  RAISE NOTICE 'F-3 accept_invite by user_b: joined family_id=%', v_family_id;

  -- ============================================================
  -- Test F-4: 在该 family 中插入一个 task,user_a 打卡
  -- ============================================================
  INSERT INTO public.tasks (
    family_id, title, task_date, assignee_id, created_by
  ) VALUES (
    v_family_id, 'verify-test-task', CURRENT_DATE, v_user_a, v_user_a
  ) RETURNING id INTO v_task_id;

  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.checkin_task(v_task_id, false);
  RESET ROLE;
  RAISE NOTICE 'F-4 checkin_task by user_a on task=%', v_task_id;

  -- ============================================================
  -- Test F-5: 同一 task 再打卡(幂等 / first-finisher wins → 0 行)
  -- ============================================================
  PERFORM set_config('request.jwt.claim.sub', v_user_b::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO v_rows FROM public.checkin_task(v_task_id, false);
  RESET ROLE;
  RAISE NOTICE 'F-5 second checkin (by user_b) rows: % (expect 0)', v_rows;

  -- ============================================================
  -- Cleanup
  -- ============================================================
  DELETE FROM public.family_members WHERE family_id = v_family_id;
  DELETE FROM public.families WHERE id = v_family_id;
  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_b);
  RAISE NOTICE 'Cleanup done: family_id=% users=%', v_family_id, v_user_a;

EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'VERIFY FAILED: % %', SQLERRM, SQLSTATE;
END $$;
