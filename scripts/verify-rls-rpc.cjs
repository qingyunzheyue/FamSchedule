// scripts/verify-rls-rpc.cjs (v5) — parameterized queries
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const env = {};
for (const line of fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const m = t.match(/^([^=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1].trim()] = v;
}
const connStr = `postgresql://postgres:${encodeURIComponent(env.SUPABASE_DB_PASSWORD)}@db.${env.SUPABASE_PROJECT_REF}.supabase.co:5432/postgres`;

const setupSQL = `
DO $setup$
DECLARE v_user_a UUID := gen_random_uuid(); v_user_b UUID := gen_random_uuid(); v_user_c UUID := gen_random_uuid();
BEGIN
  PERFORM set_config('verify.user_a', v_user_a::text, false);
  PERFORM set_config('verify.user_b', v_user_b::text, false);
  PERFORM set_config('verify.user_c', v_user_c::text, false);
  INSERT INTO auth.users (id, instance_id, aud, role, created_at, updated_at)
  VALUES (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO auth.users (id, instance_id, aud, role, created_at, updated_at)
  VALUES (v_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO auth.users (id, instance_id, aud, role, created_at, updated_at)
  VALUES (v_user_c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now())
  ON CONFLICT (id) DO NOTHING;
END $setup$;
`;

const cleanupSQL = `
DO $cleanup$
DECLARE v_user_a UUID := current_setting('verify.user_a')::uuid;
        v_user_b UUID := current_setting('verify.user_b')::uuid;
        v_user_c UUID := current_setting('verify.user_c')::uuid;
BEGIN
  DELETE FROM public.family_members WHERE user_id IN (v_user_a, v_user_b, v_user_c);
  DELETE FROM public.families WHERE created_by IN (v_user_a, v_user_b, v_user_c);
  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_b, v_user_c);
END $cleanup$;
`;

(async () => {
  const c = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log('connected');
  await c.query(setupSQL);
  console.log('test users created\n');

  const results = [];
  const runInTx = async (role, jwtKey, fn) => {
    await c.query('BEGIN');
    await c.query('RESET ROLE');
    if (role) {
      await c.query(`SET LOCAL ROLE ${role}`);
      if (jwtKey) {
        await c.query(`SELECT set_config('request.jwt.claim.sub', current_setting('${jwtKey}'), true)`);
      }
    }
    try {
      const out = await fn();
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  };

  const record = (name, pass, detail) => results.push({ name, pass, detail });

  // F-1: anon 查 families
  try {
    const r = await runInTx('anon', null, () => c.query(`SELECT COUNT(*)::INT AS n FROM public.families`));
    record('F-1_anon_families_count_0', r.rows[0].n === 0, `got ${r.rows[0].n} rows (expect 0)`);
  } catch (e) { record('F-1_anon_families_count_0', false, `ERROR: ${e.message.substring(0, 150)}`); }

  // F-2: create_family
  let familyId;
  try {
    const r = await runInTx('authenticated', 'verify.user_a', () => c.query(`SELECT public.create_family() AS fid`));
    familyId = r.rows[0].fid;
    record('F-2_create_family_returns_id', familyId !== null, `family_id=${familyId}`);
  } catch (e) { record('F-2_create_family_returns_id', false, `ERROR: ${e.message.substring(0, 150)}`); }

  // F-2b: creator in family_members
  try {
    const r = await c.query(`SELECT COUNT(*)::INT AS n FROM public.family_members WHERE user_id = current_setting('verify.user_a')::uuid`);
    record('F-2b_creator_in_family_members', r.rows[0].n === 1, `rows=${r.rows[0].n} (expect 1)`);
  } catch (e) { record('F-2b_creator_in_family_members', false, `ERROR: ${e.message.substring(0, 150)}`); }

  // F-3: create_invite
  let inviteCode;
  try {
    const r = await runInTx('authenticated', 'verify.user_a', () => c.query(`SELECT code FROM public.create_invite()`));
    inviteCode = r.rows[0].code;
    record('F-3_create_invite_6digit', /^[0-9]{6}$/.test(inviteCode), `code=${inviteCode}`);
    await c.query(`SELECT set_config('verify.invite_code', $1, false)`, [inviteCode]);
  } catch (e) { record('F-3_create_invite_6digit', false, `ERROR: ${e.message.substring(0, 150)}`); }

  // F-3b: user_b accept_invite
  try {
    const r = await runInTx('authenticated', 'verify.user_b', () => c.query(`SELECT public.accept_invite($1) AS fid`, [inviteCode]));
    record('F-3b_b_joined_family', r.rows[0].fid !== null, `family_id=${r.rows[0].fid}`);
  } catch (e) { record('F-3b_b_joined_family', false, `ERROR: ${e.message.substring(0, 150)}`); }

  // F-4a: insert task
  let taskId;
  try {
    const r = await c.query(`
      WITH ins AS (
        INSERT INTO public.tasks (family_id, title, task_date, assignee_id, created_by)
        SELECT family_id, 'verify-test-task', CURRENT_DATE, current_setting('verify.user_a')::uuid, current_setting('verify.user_a')::uuid
        FROM public.family_members WHERE user_id = current_setting('verify.user_a')::uuid
        RETURNING public.tasks.id AS tid
      )
      SELECT tid FROM ins
    `);
    taskId = r.rows[0].tid;
    record('F-4a_insert_task', taskId !== null, `task_id=${taskId}`);
  } catch (e) { record('F-4a_insert_task', false, `ERROR: ${e.message.substring(0, 150)}`); }

  // F-4: user_a checkin
  if (taskId) {
    try {
      const r = await runInTx('authenticated', 'verify.user_a', () => c.query(`SELECT * FROM public.checkin_task($1, false)`, [taskId]));
      const completedBy = r.rows[0] ? r.rows[0].completed_by : null;
      record('F-4_user_a_checkin', completedBy !== null, `completed_by=${completedBy}`);
    } catch (e) {
      console.error('F-4 raw error:', e.message, 'detail:', e.detail);
      record('F-4_user_a_checkin', false, `ERROR: ${e.message.substring(0, 150)}`);
    }
  } else {
    record('F-4_user_a_checkin', false, 'skipped (no task_id from F-4a)');
  }

  // F-5: user_b second checkin (idempotent)
  if (taskId) {
    try {
      const r = await runInTx('authenticated', 'verify.user_b', () => c.query(`SELECT * FROM public.checkin_task($1, false)`, [taskId]));
      const n = r.rows.length;
      record('F-5_second_checkin_idempotent', n === 0, `rows=${n} (expect 0 — first-finisher wins)`);
    } catch (e) {
      console.error('F-5 raw error:', e.message, 'detail:', e.detail);
      record('F-5_second_checkin_idempotent', false, `ERROR: ${e.message.substring(0, 150)}`);
    }
  } else {
    record('F-5_second_checkin_idempotent', false, 'skipped');
  }

  // F-6: 3rd member cap
  try {
    await c.query(`
      INSERT INTO public.family_members (family_id, user_id)
      SELECT family_id, current_setting('verify.user_c')::uuid
      FROM public.family_members WHERE user_id = current_setting('verify.user_a')::uuid
    `);
    record('F-6_member_cap_enforced', false, 'insert did NOT throw — trigger missing!');
  } catch (e) {
    if (e.message.includes('2 members')) {
      record('F-6_member_cap_enforced', true, `rejected as expected: ${e.message.substring(0, 80)}`);
    } else {
      record('F-6_member_cap_enforced', false, `unexpected error: ${e.message.substring(0, 150)}`);
    }
  }

  await c.query(cleanupSQL);
  await c.end();

  console.log('=== DYNAMIC RLS + RPC RESULTS ===');
  let pass = 0, fail = 0;
  for (const r of results) {
    const tag = r.pass ? 'PASS' : 'FAIL';
    console.log(`  ${tag}  ${r.name.padEnd(38)} ${r.detail}`);
    if (r.pass) pass++; else fail++;
  }
  console.log(`--- dynamic: ${pass} pass / ${fail} fail ---`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(2); });
