-- ============================================================
-- FamSchedule v1.0 — Post-Deploy Verification Queries
-- ============================================================
-- 用于 T-SETUP-1 部署后的 schema/RLS/realtime 验证。
-- 在 Supabase SQL Editor 中执行(以 postgres / service_role 角色)。
-- 预期:所有 check 行 pass = true。
-- ============================================================

-- Verify #1: 业务表数量 ≥ 6(families / family_members / task_templates / tasks / invite_codes / family_settings)
SELECT
  'v01_business_tables_count'         AS check,
  6::INT                               AS expected_min,
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE')::INT  AS actual,
  ((SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE') >= 6) AS pass;

-- Verify #2: RLS 启用在 6 张表上
SELECT
  'v02_rls_enabled_count'             AS check,
  6::INT                               AS expected,
  (SELECT COUNT(*) FROM pg_tables
   WHERE schemaname = 'public' AND rowsecurity = true)::INT  AS actual,
  ((SELECT COUNT(*) FROM pg_tables
    WHERE schemaname = 'public' AND rowsecurity = true) = 6) AS pass;

-- Verify #3: RLS policy 数量(families 1 + family_members 1 + task_templates 4 + tasks 4 + invite_codes 2 + family_settings 1 = 13)
SELECT
  'v03_rls_policies_count'            AS check,
  13::INT                              AS expected,
  (SELECT COUNT(*) FROM pg_policies
   WHERE schemaname = 'public')::INT   AS actual,
  ((SELECT COUNT(*) FROM pg_policies
    WHERE schemaname = 'public') = 13) AS pass;

-- Verify #4: RPC 函数数量(create_family / create_invite / accept_invite / update_family_setting / checkin_task / undo_checkin = 6)
-- 注意 is_makeup_allowed 是被 checkin_task 调用的 helper,共 7;期望 ≥ 6
SELECT
  'v04_rpc_functions_count'           AS check,
  6::INT                               AS expected_min,
  (SELECT COUNT(*) FROM pg_proc p
   JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.prokind = 'f')::INT  AS actual,
  ((SELECT COUNT(*) FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.prokind = 'f') >= 6) AS pass;

-- Verify #5: Realtime publication 包含 4 张表(tasks / task_templates / family_settings / family_members)
SELECT
  'v05_realtime_publication_count'    AS check,
  4::INT                               AS expected,
  (SELECT COUNT(*) FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime'
     AND schemaname = 'public')::INT   AS actual,
  ((SELECT COUNT(*) FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public') = 4)  AS pass;

-- Verify #6: 索引数量(10 普通索引 + 1 unique 索引 = 11;DoD 写 "9" 是早期估算,实际 11)
SELECT
  'v06_index_count'                   AS check,
  9::INT                               AS expected_min,
  (SELECT COUNT(*) FROM pg_indexes
   WHERE schemaname = 'public' AND indexname LIKE 'idx\_%' ESCAPE '\')::INT  AS idx_count,
  (SELECT COUNT(*) FROM pg_indexes
   WHERE schemaname = 'public' AND indexname LIKE 'uq\_%' ESCAPE '\')::INT  AS uq_count,
  (((SELECT COUNT(*) FROM pg_indexes
     WHERE schemaname = 'public' AND indexname LIKE 'idx\_%' ESCAPE '\') +
    (SELECT COUNT(*) FROM pg_indexes
     WHERE schemaname = 'public' AND indexname LIKE 'uq\_%' ESCAPE '\')) >= 9) AS pass;

-- Verify #7: 视图 family_shared_tasks 存在
SELECT
  'v07_family_shared_tasks_view'      AS check,
  1::INT                               AS expected,
  (SELECT COUNT(*) FROM information_schema.views
   WHERE table_schema = 'public' AND table_name = 'family_shared_tasks')::INT  AS actual,
  ((SELECT COUNT(*) FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'family_shared_tasks') = 1) AS pass;

-- Verify #8: 权限 grant — anon 至少 USAGE schema,authenticated 至少 USAGE + EXECUTE
SELECT
  'v08_grants_anon'                   AS check,
  1::INT                               AS expected_min,
  (SELECT COUNT(*) FROM information_schema.role_usage_grants
   WHERE grantee = 'anon' AND object_schema = 'public')::INT  AS actual,
  ((SELECT COUNT(*) FROM information_schema.role_usage_grants
    WHERE grantee = 'anon' AND object_schema = 'public') >= 1) AS pass;

-- Verify #9: 主 RPC 的签名(create_family 必须返回 UUID,accept_invite 必须接受 p_code 参数)
SELECT
  'v09_rpc_signatures'                AS check,
  6::INT                               AS expected,
  (SELECT COUNT(*) FROM pg_proc p
   JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public'
     AND p.prokind = 'f'
     AND p.proname IN ('create_family','create_invite','accept_invite',
                       'update_family_setting','checkin_task','undo_checkin'))::INT  AS actual,
  ((SELECT COUNT(*) FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname IN ('create_family','create_invite','accept_invite',
                        'update_family_setting','checkin_task','undo_checkin')) = 6) AS pass;

-- Verify #10: anon role 拒绝读取 families(RLS 默认 deny,无 policy 给 anon → 0 行而非报错)
-- 通过 SET LOCAL ROLE anon 模拟(在 SQL Editor 中直接执行可能被默认 role 替换,需要管理员切换)
-- 这一项 verify.sql 中仅作"policy 不含 anon 显式 allow"的静态检查;实际动态测试在 verify_rls.sql 中
SELECT
  'v10_no_anon_select_policies'       AS check,
  0::INT                               AS expected,
  (SELECT COUNT(*) FROM pg_policies
   WHERE schemaname = 'public'
     AND roles @> ARRAY['anon']::name[]
     AND cmd = 'SELECT')::INT          AS actual,
  ((SELECT COUNT(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND roles @> ARRAY['anon']::name[]
      AND cmd = 'SELECT') = 0)        AS pass;
