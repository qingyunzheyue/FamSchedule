/**
 * Supabase DB schema types — T-SETUP-4
 *
 * 手写自 `document/tech-decision/db-v1.1.sql`。
 * 为什么手写而不是 `supabase gen types typescript`:
 *   1. CLI 需要 `supabase login` + `supabase link` + 一个本地 docker,
 *      自动化流程里多一层依赖(凭证管理 + 网络往返)
 *   2. db-v1.1.sql 是单一权威源(SHA256 校验过的),手写与之 1:1 对齐,
 *      schema 漂移只可能从这一个文件产生
 *   3. CLI 输出包含表/视图/函数的 nullable 推断,PostgreSQL domain / CHECK
 *      约束很难精确反推,不如照着 DDL 抄
 *
 * 兼容性:与 `@supabase/supabase-js` 2.116 的 `Database` generic shape 一致
 *   (public.Tables / public.Views / public.Functions / public.Enums / public.CompositeTypes)
 *
 * 注意:
 *   - 所有 UUID 列一律用 `string`(JS 没有原生 UUID 类型)
 *   - TIMESTAMPTZ → `string`(ISO 8601,Supabase JS 客户端默认行为)
 *   - DATE / TIME → `string`(YYYY-MM-DD / HH:MM:SS,客户端按需 new Date())
 *   - JSONB → 业务侧定义的具体 shape(避免 `any` 在前端扩散)
 *   - INSERT/UPDATE 类型用 Partial<Row> 派生,但因为有 NOT NULL 约束,显式重写更安全
 */

// ---- 通用 JSONB 形状(任务周期规则 ADR-003)----------------------------------

/**
 * recurrence_rule JSONB 结构,见 db-v1.1.sql §3.3 注释:
 *   {"freq":"daily"}
 *   {"freq":"weekly","byday":["MO","WE","FR"]}
 *   {"freq":"monthly","bymonthday":15}
 *
 * 故意保持扁平、封闭 union,客户端用 `discriminated by freq` 分发
 */
export type RecurrenceRule =
  | { freq: 'daily' }
  | { freq: 'weekly'; byday: Array<'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'> }
  | { freq: 'monthly'; bymonthday: number };

// ---- 表行类型 --------------------------------------------------------------

export interface FamilyRow {
  id: string;
  created_by: string;
  created_at: string;
}

export interface FamilyMemberRow {
  family_id: string;
  user_id: string;
  joined_at: string;
}

export interface TaskTemplateRow {
  id: string;
  family_id: string;
  title: string;
  description: string | null;
  recurrence_rule: RecurrenceRule;
  start_date: string;
  end_date: string | null;
  task_time: string | null;
  assignee_id: string;
  co_executor_ids: string[];
  is_shared_view: boolean;
  active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  id: string;
  template_id: string | null;
  family_id: string;
  title: string;
  description: string | null;
  task_date: string;
  task_time: string | null;
  assignee_id: string;
  co_executor_ids: string[];
  is_shared_view: boolean;
  created_by: string;
  completed_at: string | null;
  completed_by: string | null;
  is_makeup: boolean;
  cancelled: boolean;
  created_at: string;
  updated_at: string;
}

export interface InviteCodeRow {
  code: string;
  family_id: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
}

export interface FamilySettingsRow {
  family_id: string;
  morning_digest_time: string;
  evening_digest_time: string;
  digest_time_min: string;
  digest_time_max: string;
  expiry_window: 'yesterday_today' | 'this_week' | 'all' | 'off';
  late_checkin_cutoff: 'same_day_2359' | 'next_day_1200' | 'off';
  created_at: string;
  updated_at: string;
}

// ---- Insert / Update 派生类型 ---------------------------------------------
// 注:PostgreSQL DEFAULT 由 DB 生成,INSERT 时 client 可以省略;UPDATE 时 PK 不变。

export type FamilyInsert = Pick<FamilyRow, 'created_by'>;
export type FamilyUpdate = Partial<FamilyRow>;

export type FamilyMemberInsert = Pick<FamilyMemberRow, 'family_id' | 'user_id'>;

export type TaskTemplateInsert = Omit<
  TaskTemplateRow,
  'id' | 'created_at' | 'updated_at' | 'co_executor_ids' | 'is_shared_view' | 'active'
> &
  Partial<
    Pick<
      TaskTemplateRow,
      'co_executor_ids' | 'is_shared_view' | 'active' | 'description' | 'end_date' | 'task_time'
    >
  >;
export type TaskTemplateUpdate = Partial<Omit<TaskTemplateRow, 'id' | 'created_at' | 'updated_at'>>;

export type TaskInsert = Omit<
  TaskRow,
  | 'id'
  | 'created_at'
  | 'updated_at'
  | 'template_id'
  | 'completed_at'
  | 'completed_by'
  | 'is_makeup'
  | 'cancelled'
  | 'description'
  | 'task_time'
> &
  Partial<
    Pick<
      TaskRow,
      'template_id' | 'description' | 'task_time' | 'co_executor_ids' | 'is_shared_view'
    >
  >;
export type TaskUpdate = Partial<Omit<TaskRow, 'id' | 'created_at' | 'updated_at'>>;

// ---- 视图 -----------------------------------------------------------------

export type FamilySharedTasksRow = TaskRow;

// ---- RPC 函数(签名)-------------------------------------------------------

export type CreateFamilyArgs = undefined; // db-v1.1.sql §4.1: create_family() 无参
export type CreateFamilyReturns = string; // family_id UUID

export type CreateInviteArgs = undefined; // db-v1.1.sql §4.2: create_invite() 无参
export interface CreateInviteReturns {
  code: string;
  expires_at: string;
}

export interface AcceptInviteArgs {
  p_code: string; // db-v1.1.sql §4.3: accept_invite(p_code TEXT)
}
export type AcceptInviteReturns = string; // family_id UUID

export interface CheckinTaskArgs {
  p_task_id: string;
  p_is_makeup?: boolean;
}
export interface CheckinTaskReturns {
  id: string;
  completed_at: string;
  completed_by: string;
  is_makeup: boolean;
}

export interface UndoCheckinArgs {
  p_task_id: string;
}
export interface UndoCheckinReturns {
  id: string;
  completed_at: string;
  completed_by: string;
}

/**
 * update_family_setting(p_key, p_value) — 实际是 2 个位置参数。
 * 但 db-v1.1.sql §4.4 接受 `p_key TEXT, p_value TEXT` 是命名参数,SDK 自动映射。
 * 命名风格保持 snake_case 以匹配 SQL。
 */
export interface UpdateFamilySettingArgs {
  p_key: 'morning_digest_time' | 'evening_digest_time' | 'expiry_window' | 'late_checkin_cutoff';
  p_value: string;
}
export type UpdateFamilySettingReturns = void;

// ---- Database 根类型(@supabase/supabase-js generic)------------------------

export interface Database {
  public: {
    Tables: {
      families: {
        Row: FamilyRow;
        Insert: FamilyInsert;
        Update: FamilyUpdate;
        Relationships: [];
      };
      family_members: {
        Row: FamilyMemberRow;
        Insert: FamilyMemberInsert;
        Update: Partial<FamilyMemberRow>;
        Relationships: [];
      };
      task_templates: {
        Row: TaskTemplateRow;
        Insert: TaskTemplateInsert;
        Update: TaskTemplateUpdate;
        Relationships: [];
      };
      tasks: {
        Row: TaskRow;
        Insert: TaskInsert;
        Update: TaskUpdate;
        Relationships: [];
      };
      invite_codes: {
        Row: InviteCodeRow;
        // INSERT/UPDATE 走 RPC,客户端无直接写
        Insert: never;
        Update: never;
        Relationships: [];
      };
      family_settings: {
        Row: FamilySettingsRow;
        // INSERT 走 create_family RPC;UPDATE 走 update_family_setting RPC
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      family_shared_tasks: {
        Row: FamilySharedTasksRow;
        Relationships: [];
      };
    };
    Functions: {
      create_family: {
        Args: CreateFamilyArgs;
        Returns: CreateFamilyReturns;
      };
      create_invite: {
        Args: CreateInviteArgs;
        Returns: CreateInviteReturns;
      };
      accept_invite: {
        Args: AcceptInviteArgs;
        Returns: AcceptInviteReturns;
      };
      checkin_task: {
        Args: CheckinTaskArgs;
        Returns: CheckinTaskReturns;
      };
      undo_checkin: {
        Args: UndoCheckinArgs;
        Returns: UndoCheckinReturns;
      };
      update_family_setting: {
        Args: UpdateFamilySettingArgs;
        Returns: UpdateFamilySettingReturns;
      };
    };
    Enums: {
      // 暂无独立 Postgres enum;枚举值在表内 CHECK 约束中(见 expiry_window / late_checkin_cutoff)
      // 留空避免 SDK generic 报错。
    };
    CompositeTypes: {};
  };
}