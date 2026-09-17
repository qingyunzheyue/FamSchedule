-- ============================================================
-- FamSchedule v1.0 — Database Schema (PostgreSQL / Supabase)
-- ============================================================
-- 对应 ADR:
--   001  Supabase 后端
--   002  Anon Sign-in + RLS(auth.users 由 Supabase 管理,本文件不创建)
--   003  任务预展开(60 天)
--   004  invite_codes + 原子 join
--   005  行级 LWW(updated_at trigger)
--   007  家庭共享 + 设备本地 混合
--
-- 部署:在 Supabase SQL Editor 中按顺序执行
-- 兼容:PostgreSQL 15+(Supabase 默认)
-- ============================================================

-- 1. 扩展
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
-- Supabase 默认启用 uuid-ossp + pgcrypto,这里显式声明以便其他 Postgres 实例参考

-- 2. 通用工具函数
-- ============================================================

-- 自动维护 updated_at(ADR-005:server 权威,client 不可伪造时间)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 3. 表定义
-- ============================================================

-- 3.1 families:家庭本身
CREATE TABLE IF NOT EXISTS public.families (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by   UUID        NOT NULL REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3.2 family_members:家庭成员(2 人上限,trigger 强制 — ADR-002 / PRD C1)
CREATE TABLE IF NOT EXISTS public.family_members (
  family_id    UUID        NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, user_id)
);

-- 2 人上限 trigger
CREATE OR REPLACE FUNCTION public.enforce_family_member_cap()
RETURNS TRIGGER AS $$
DECLARE
  current_count INT;
BEGIN
  SELECT COUNT(*) INTO current_count
  FROM public.family_members
  WHERE family_id = NEW.family_id;
  IF current_count >= 2 THEN
    RAISE EXCEPTION 'Family % already has 2 members (PRD C1)', NEW.family_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_family_members_cap
  BEFORE INSERT ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_family_member_cap();

-- 3.3 task_templates:周期任务规则(ADR-003)
CREATE TABLE IF NOT EXISTS public.task_templates (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id       UUID        NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  title           TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description     TEXT        CHECK (description IS NULL OR length(description) <= 2000),

  -- 周期规则(JSONB)
  -- {"freq":"daily"}
  -- {"freq":"weekly","byday":["MO","WE","FR"]}
  -- {"freq":"monthly","bymonthday":15}
  recurrence_rule JSONB       NOT NULL,

  start_date      DATE        NOT NULL,
  end_date        DATE        CHECK (end_date IS NULL OR end_date >= start_date),
  task_time       TIME        CHECK (task_time IS NULL OR (task_time >= '00:00:00' AND task_time < '24:00:00')),

  assignee_id     UUID        NOT NULL REFERENCES auth.users(id),
  co_executor_ids UUID[]      NOT NULL DEFAULT '{}',
  is_shared_view  BOOLEAN     NOT NULL DEFAULT false,

  active          BOOLEAN     NOT NULL DEFAULT true,   -- 软删除:false = 系列已停用
  created_by      UUID        NOT NULL REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_task_templates_updated_at
  BEFORE UPDATE ON public.task_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3.4 tasks:任务实例(每次发生一行 — ADR-003)
CREATE TABLE IF NOT EXISTS public.tasks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     UUID        REFERENCES public.task_templates(id) ON DELETE SET NULL,
  family_id       UUID        NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,

  -- 字段快照(从 template 拷过来,避免 join)
  title           TEXT        NOT NULL,
  description     TEXT,
  task_date       DATE        NOT NULL,
  task_time       TIME,
  assignee_id     UUID        NOT NULL REFERENCES auth.users(id),
  co_executor_ids UUID[]      NOT NULL DEFAULT '{}',
  is_shared_view  BOOLEAN     NOT NULL DEFAULT false,
  created_by      UUID        NOT NULL REFERENCES auth.users(id),

  -- 打卡 / 补卡
  completed_at    TIMESTAMPTZ,
  completed_by    UUID        REFERENCES auth.users(id),
  is_makeup       BOOLEAN     NOT NULL DEFAULT false,

  -- 单实例软删除(US-003:"周期任务可单独删除某一实例而不影响后续")
  cancelled       BOOLEAN     NOT NULL DEFAULT false,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 约束:打卡时间与打卡人一致
  CONSTRAINT chk_completed_consistent CHECK (
    (completed_at IS NULL  AND completed_by IS NULL) OR
    (completed_at IS NOT NULL AND completed_by IS NOT NULL)
  ),
  -- 约束:补卡必有 completed_at
  CONSTRAINT chk_makeup_implies_completed CHECK (
    is_makeup = false OR completed_at IS NOT NULL
  )
);

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3.5 invite_codes:邀请码(ADR-004)
CREATE TABLE IF NOT EXISTS public.invite_codes (
  code         TEXT        PRIMARY KEY CHECK (code ~ '^\d{6}$'),
  family_id    UUID        NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  created_by   UUID        NOT NULL REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  used_by      UUID        REFERENCES auth.users(id),

  CONSTRAINT chk_expires_after CHECK (expires_at > created_at),
  CONSTRAINT chk_used_consistent CHECK (
    (used_at IS NULL  AND used_by IS NULL) OR
    (used_at IS NOT NULL AND used_by IS NOT NULL)
  )
);

-- 3.6 family_settings:家庭共享设置(ADR-007)
CREATE TABLE IF NOT EXISTS public.family_settings (
  family_id              UUID        PRIMARY KEY REFERENCES public.families(id) ON DELETE CASCADE,

  -- 推送时间(US-008)
  morning_digest_time    TIME        NOT NULL DEFAULT '08:00:00',
  evening_digest_time    TIME        NOT NULL DEFAULT '20:00:00',
  digest_time_min        TIME        NOT NULL DEFAULT '06:00:00',
  digest_time_max        TIME        NOT NULL DEFAULT '22:00:00',

  -- 过期提示窗口(US-015)
  expiry_window          TEXT        NOT NULL DEFAULT 'yesterday_today'
                                       CHECK (expiry_window IN ('yesterday_today','this_week','all','off')),

  -- 补卡截止(US-006)
  late_checkin_cutoff    TEXT        NOT NULL DEFAULT 'same_day_2359'
                                       CHECK (late_checkin_cutoff IN ('same_day_2359','next_day_1200','off')),

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_family_settings_updated_at
  BEFORE UPDATE ON public.family_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. RPC(业务逻辑,带 SECURITY DEFINER 旁路 RLS)
-- ============================================================

-- 4.1 create_family:创建家庭(由第一个 anon user 触发,US-012)
-- 同时创建 families 行 + family_members 行 + family_settings 默认行
CREATE OR REPLACE FUNCTION public.create_family()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_family_id UUID;
  v_existing_family UUID;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 同一 user 不能同时在多个 family(MVP 限制)
  SELECT family_id INTO v_existing_family
  FROM public.family_members
  WHERE user_id = v_caller
  LIMIT 1;
  IF v_existing_family IS NOT NULL THEN
    RAISE EXCEPTION 'User % is already in a family (MVP: one family per user)', v_caller;
  END IF;

  INSERT INTO public.families (created_by) VALUES (v_caller)
  RETURNING id INTO v_family_id;

  INSERT INTO public.family_members (family_id, user_id) VALUES (v_family_id, v_caller);

  INSERT INTO public.family_settings (family_id) VALUES (v_family_id);

  RETURN v_family_id;
END;
$$;

-- 4.2 create_invite:创建邀请码(US-012,10 分钟有效,ADR-004)
CREATE OR REPLACE FUNCTION public.create_invite()
RETURNS TABLE (code TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_family_id UUID;
  v_code TEXT;
  v_attempts INT := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 调用者必须是某 family 成员
  SELECT family_id INTO v_family_id
  FROM public.family_members
  WHERE user_id = v_caller
  LIMIT 1;
  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'Caller is not in any family';
  END IF;

  -- 6 位数字,碰撞重试
  LOOP
    v_code := lpad(floor(random() * 1000000)::text, 6, '0');
    BEGIN
      INSERT INTO public.invite_codes (code, family_id, created_by, expires_at)
      VALUES (v_code, v_family_id, v_caller, now() + interval '10 minutes');
      RETURN QUERY SELECT v_code, now() + interval '10 minutes';
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      v_attempts := v_attempts + 1;
      IF v_attempts >= 5 THEN
        RAISE EXCEPTION 'Failed to generate unique invite code after 5 attempts';
      END IF;
    END;
  END LOOP;
END;
$$;

-- 4.3 accept_invite:加入家庭(US-012,原子操作 — ADR-004)
-- 单事务:check code + mark used + insert family_member
CREATE OR REPLACE FUNCTION public.accept_invite(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_family_id UUID;
  v_existing_family UUID;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 调用者不能已在某 family(MVP 限制)
  SELECT family_id INTO v_existing_family
  FROM public.family_members
  WHERE user_id = v_caller
  LIMIT 1;
  IF v_existing_family IS NOT NULL THEN
    RAISE EXCEPTION 'User % is already in a family (MVP: one family per user)', v_caller;
  END IF;

  -- 原子 check + lock(行锁防并发)
  SELECT family_id INTO v_family_id
  FROM public.invite_codes
  WHERE code = p_code
    AND expires_at > now()
    AND used_at IS NULL
  FOR UPDATE;

  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'Invalid, expired, or already used invite code';
  END IF;

  -- mark used
  UPDATE public.invite_codes
  SET used_at = now(), used_by = v_caller
  WHERE code = p_code;

  -- 加入 family(2 人上限 trigger 在这里生效)
  INSERT INTO public.family_members (family_id, user_id) VALUES (v_family_id, v_caller);

  -- 清掉同 family 其他未用的邀请码
  DELETE FROM public.invite_codes
  WHERE family_id = v_family_id
    AND code != p_code
    AND used_at IS NULL;

  RETURN v_family_id;
END;
$$;

-- 4.4 update_family_setting:更新家庭设置(带时段范围校验,ADR-007)
CREATE OR REPLACE FUNCTION public.update_family_setting(
  p_key TEXT,
  p_value TEXT  -- 统一用 text,服务端 cast 成对应类型
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_family_id UUID;
  v_min TIME;
  v_max TIME;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT family_id INTO v_family_id
  FROM public.family_members
  WHERE user_id = v_caller
  LIMIT 1;
  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'Caller is not in any family';
  END IF;

  IF p_key IN ('morning_digest_time', 'evening_digest_time') THEN
    -- 校验时段范围
    SELECT digest_time_min, digest_time_max INTO v_min, v_max
    FROM public.family_settings
    WHERE family_id = v_family_id;
    IF (p_value::TIME) < v_min OR (p_value::TIME) > v_max THEN
      RAISE EXCEPTION 'Time % outside allowed range [% - %]', p_value, v_min, v_max;
    END IF;
    EXECUTE format('UPDATE public.family_settings SET %I = $1::TIME WHERE family_id = $2', p_key)
      USING p_value, v_family_id;
  ELSIF p_key IN ('expiry_window', 'late_checkin_cutoff') THEN
    EXECUTE format('UPDATE public.family_settings SET %I = $1 WHERE family_id = $2', p_key)
      USING p_value, v_family_id;
  ELSE
    RAISE EXCEPTION 'Unknown setting key: %', p_key;
  END IF;
END;
$$;

-- 4.5 checkin_task:打卡 / 补卡(US-005 / US-006,幂等 — ADR-005)
-- first-finisher wins;后续调用 0 行影响
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
  UPDATE public.tasks
  SET completed_at = now(),
      completed_by = v_caller,
      is_makeup = p_is_makeup
  WHERE id = p_task_id
    AND cancelled = false
    AND completed_at IS NULL
    -- 补卡截止校验(若 family 设置为 off 则禁止补卡;same_day_2359 / next_day_1200 按 PRD 默认)
    AND (NOT p_is_makeup OR public.is_makeup_allowed(id, v_caller))
  RETURNING tasks.id, tasks.completed_at, tasks.completed_by, tasks.is_makeup;
END;
$$;

-- 补卡截止判断(被 checkin_task 调用)
CREATE OR REPLACE FUNCTION public.is_makeup_allowed(p_task_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
  v_cutoff TEXT;
  v_task_date DATE;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT family_id, task_date INTO v_family_id, v_task_date
  FROM public.tasks WHERE id = p_task_id;

  SELECT late_checkin_cutoff INTO v_cutoff
  FROM public.family_settings
  WHERE family_id = v_family_id;

  IF v_cutoff = 'off' THEN
    RETURN false;
  ELSIF v_cutoff = 'same_day_2359' THEN
    RETURN v_task_date >= (v_now - interval '1 day')::DATE;
  ELSIF v_cutoff = 'next_day_1200' THEN
    RETURN v_task_date >= (v_now - interval '1 day')::DATE
       OR (v_task_date = (v_now)::DATE AND v_now::TIME < '12:00:00');
  END IF;
  RETURN false;
END;
$$;

-- 4.6 undo_checkin:撤销打卡(US-005 5 分钟窗口)
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
  UPDATE public.tasks
  SET completed_at = NULL,
      completed_by = NULL,
      is_makeup = false
  WHERE id = p_task_id
    AND completed_by = v_caller
    AND completed_at > now() - interval '5 minutes'
  RETURNING tasks.id, tasks.completed_at, tasks.completed_by;
END;
$$;

-- ============================================================
-- 5. RLS(行级安全)
-- ============================================================

-- 启用 RLS
ALTER TABLE public.families        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite_codes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_settings ENABLE ROW LEVEL SECURITY;

-- 5.1 families
CREATE POLICY families_select ON public.families
  FOR SELECT USING (
    id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid())
  );
-- INSERT/UPDATE/DELETE 全部走 RPC(SECURITY DEFINER 旁路 RLS),无 policy 即禁止直接写

-- 5.2 family_members
CREATE POLICY family_members_select ON public.family_members
  FOR SELECT USING (
    family_id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid())
  );
-- INSERT 走 accept_invite RPC;UPDATE/DELETE 不允许

-- 5.3 task_templates
CREATE POLICY task_templates_select ON public.task_templates
  FOR SELECT USING (
    family_id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid())
  );
CREATE POLICY task_templates_insert ON public.task_templates
  FOR INSERT WITH CHECK (
    family_id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid())
    AND created_by = auth.uid()
  );
CREATE POLICY task_templates_update ON public.task_templates
  FOR UPDATE USING (
    family_id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid())
  );
CREATE POLICY task_templates_delete ON public.task_templates
  FOR DELETE USING (
    family_id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid())
  );

-- 5.4 tasks
CREATE POLICY tasks_select ON public.tasks
  FOR SELECT USING (
    family_id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid())
  );
CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT WITH CHECK (
    family_id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid())
  );
CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE USING (
    family_id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid())
  );
CREATE POLICY tasks_delete ON public.tasks
  FOR DELETE USING (
    family_id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid())
  );

-- 5.5 invite_codes
CREATE POLICY invite_codes_select ON public.invite_codes
  FOR SELECT USING (
    family_id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid())
  );
-- INSERT 走 create_invite RPC
CREATE POLICY invite_codes_delete_unused ON public.invite_codes
  FOR DELETE USING (
    family_id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid())
    AND used_at IS NULL
  );
-- UPDATE 走 accept_invite RPC

-- 5.6 family_settings
CREATE POLICY family_settings_select ON public.family_settings
  FOR SELECT USING (
    family_id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid())
  );
-- INSERT 走 create_family RPC
-- UPDATE 走 update_family_setting RPC

-- ============================================================
-- 6. 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_families_created_by        ON public.families(created_by);
CREATE INDEX IF NOT EXISTS idx_family_members_user        ON public.family_members(user_id);
CREATE INDEX IF NOT EXISTS idx_task_templates_family      ON public.task_templates(family_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_tasks_family_date         ON public.tasks(family_id, task_date);
CREATE INDEX IF NOT EXISTS idx_tasks_template_date       ON public.tasks(template_id, task_date) WHERE template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_pending             ON public.tasks(family_id, task_date) WHERE completed_at IS NULL AND cancelled = false;
CREATE INDEX IF NOT EXISTS idx_tasks_assignee            ON public.tasks(assignee_id, task_date) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invite_codes_family        ON public.invite_codes(family_id);
CREATE INDEX IF NOT EXISTS idx_invite_codes_active        ON public.invite_codes(expires_at) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_family_settings_updated_at ON public.family_settings(updated_at);

-- 模板+日期 唯一约束(防续期重复展开,ADR-003)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_template_date
  ON public.tasks(template_id, task_date) WHERE template_id IS NOT NULL;

-- ============================================================
-- 7. 视图(US-011 家庭公开看板)
-- ============================================================
CREATE OR REPLACE VIEW public.family_shared_tasks AS
SELECT t.*
FROM public.tasks t
WHERE t.is_shared_view = true
  AND t.cancelled = false;
-- 注:RLS 仍生效,只返回调用者所在 family 的行

-- ============================================================
-- 8. Realtime 发布的表
-- ============================================================
-- Supabase Realtime 需要在 supabase_realtime publication 中发布表
-- (在 Supabase 控制台 SQL Editor 中执行,或由 dashboard 自动处理)
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_templates;
ALTER PUBLICATION supabase_realtime ADD TABLE public.family_settings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.family_members;

-- ============================================================
-- 9. Grant
-- ============================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
-- anon 不直接操作数据,只通过 authenticated(auth.signInAnonymously 之后即 authenticated 角色)

-- ============================================================
-- 完毕。共 6 张业务表 + 6 个 RPC + RLS 全套 + 索引 9 条 + 视图 1 个
-- ============================================================
