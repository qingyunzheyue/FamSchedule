// scripts/diagnose-checkin.cjs — figure out why checkin_task query fails
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

(async () => {
  const c = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // Use a fake UUID — we just want to test the query PARSING, not the runtime result
  const taskId = '00000000-0000-0000-0000-000000000001';
  console.log('using fake taskId=', taskId);

  // Try different query variants
  const variants = [
    ['SELECT 1', []],
    ['SELECT public.checkin_task($1, false) AS x', [taskId]],
    ['SELECT * FROM public.checkin_task($1, false)', [taskId]],
    ['SELECT (r.id)::TEXT FROM public.checkin_task($1, false) r', [taskId]],
    ['SELECT (r.completed_by)::TEXT FROM public.checkin_task($1, false) r', [taskId]],
  ];
  for (const [sql, params] of variants) {
    try {
      const r = await c.query(sql, params);
      console.log('OK :', sql.substring(0, 60).padEnd(62), '->', JSON.stringify(r.rows).substring(0, 150));
    } catch (e) {
      console.log('ERR:', sql.substring(0, 60).padEnd(62), '->', e.message);
    }
  }

  // Also check if the function RETURNS TABLE definition is healthy
  const fnDef = await c.query(`
    SELECT p.proname, pg_get_function_result(p.oid) AS returns,
           pg_get_function_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
    WHERE n.nspname='public' AND p.proname='checkin_task'
  `);
  console.log('\nfn def:', JSON.stringify(fnDef.rows[0], null, 2));

  await c.end();
})().catch(e => console.error('FATAL:', e.message));
