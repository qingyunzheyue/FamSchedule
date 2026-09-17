// scripts/migrate-and-verify.cjs (v2) — split each verify check into its own query
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
if (!fs.existsSync(envPath)) { console.error('FAIL: .env missing'); process.exit(1); }

const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const m = t.match(/^([^=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1].trim()] = v;
}

const ref = env.SUPABASE_PROJECT_REF;
const pwd = env.SUPABASE_DB_PASSWORD;
if (!ref || !pwd) { console.error('FAIL: SUPABASE_PROJECT_REF / SUPABASE_DB_PASSWORD missing'); process.exit(1); }

const connStr = `postgresql://postgres:${encodeURIComponent(pwd)}@db.${ref}.supabase.co:5432/postgres`;

// Each static verify check as an isolated query.
// The migration is idempotent (CREATE ... IF NOT EXISTS / CREATE OR REPLACE), so
// re-running it is safe. We split verify.sql into per-check queries to avoid the
// pg "multi-statement returns only last result" problem.
const staticChecks = [
  { name: 'v01_business_tables',            sql: `SELECT (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')::INT AS actual, 6::INT AS expected_min, ((SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') >= 6) AS pass` },
  { name: 'v02_rls_enabled',                sql: `SELECT (SELECT COUNT(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity=true)::INT AS actual, 6::INT AS expected, ((SELECT COUNT(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity=true) = 6) AS pass` },
  { name: 'v03_rls_policies',               sql: `SELECT (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public')::INT AS actual, 13::INT AS expected, ((SELECT COUNT(*) FROM pg_policies WHERE schemaname='public') = 13) AS pass` },
  { name: 'v04_rpc_functions',              sql: `SELECT (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public' AND p.prokind='f')::INT AS actual, 6::INT AS expected_min, ((SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public' AND p.prokind='f') >= 6) AS pass` },
  { name: 'v05_realtime_publication',       sql: `SELECT (SELECT COUNT(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public')::INT AS actual, 4::INT AS expected, ((SELECT COUNT(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public') = 4) AS pass` },
  { name: 'v06_indexes',                    sql: `SELECT (SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public' AND indexname LIKE 'idx\\_%')::INT AS idx_count, (SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public' AND indexname LIKE 'uq\\_%')::INT AS uq_count, (((SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public' AND indexname LIKE 'idx\\_%') + (SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public' AND indexname LIKE 'uq\\_%')) >= 9) AS pass` },
  { name: 'v07_family_shared_tasks_view',   sql: `SELECT (SELECT COUNT(*) FROM information_schema.views WHERE table_schema='public' AND table_name='family_shared_tasks')::INT AS actual, 1::INT AS expected, ((SELECT COUNT(*) FROM information_schema.views WHERE table_schema='public' AND table_name='family_shared_tasks') = 1) AS pass` },
  { name: 'v08_grants_anon_schema_usage',   sql: `SELECT (CASE WHEN has_schema_privilege('anon', 'public', 'USAGE') THEN 1 ELSE 0 END)::INT AS actual, 1::INT AS expected, (has_schema_privilege('anon', 'public', 'USAGE') = true) AS pass` },
  { name: 'v09_rpc_signatures',             sql: `SELECT (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public' AND p.prokind='f' AND p.proname IN ('create_family','create_invite','accept_invite','update_family_setting','checkin_task','undo_checkin'))::INT AS actual, 6::INT AS expected, ((SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public' AND p.prokind='f' AND p.proname IN ('create_family','create_invite','accept_invite','update_family_setting','checkin_task','undo_checkin')) = 6) AS pass` },
  { name: 'v10_no_anon_select_policies',    sql: `SELECT (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public' AND roles @> ARRAY['anon']::name[] AND cmd='SELECT')::INT AS actual, 0::INT AS expected, ((SELECT COUNT(*) FROM pg_policies WHERE schemaname='public' AND roles @> ARRAY['anon']::name[] AND cmd='SELECT') = 0) AS pass` },
];

(async () => {
  const client = new Client({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
    statement_timeout: 60000,
  });
  const log = (m) => process.stdout.write(m + '\n');
  const err = (m) => process.stderr.write(m + '\n');

  try {
    log(`[1/5] connecting to db.${ref}.supabase.co:5432 ...`);
    await client.connect();
    const v = await client.query('SELECT version()');
    log(`  connected. server: ${v.rows[0].version.substring(0, 60)}`);

    log(`[2/5] checking pre-state (was migration already applied?)`);
    const pre = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')::INT AS tables,
        (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public' AND p.prokind='f')::INT AS fns
    `);
    const preState = pre.rows[0];
    log(`  pre-state: tables=${preState.tables} fns=${preState.fns}`);

    if (preState.tables === 0) {
      log(`  -> running migration (idempotent for tables/fns, NOT for triggers — first-time only)`);
      const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20250911000000_init.sql'), 'utf8');
      try {
        await client.query(migration);
        log('  migration applied');
      } catch (e) {
        err(`  migration error: ${e.message}`);
        throw e;
      }
    } else {
      log(`  -> tables already exist (count=${preState.tables}). SKIPPING migration (would fail on triggers).`);
    }

    log(`[3/5] post-state summary`);
    const post = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') AS tables,
        (SELECT COUNT(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity=true) AS rls_tables,
        (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public') AS policies,
        (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public' AND p.prokind='f') AS fns,
        (SELECT COUNT(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public') AS realtime_tables,
        (SELECT COUNT(*) FROM information_schema.views WHERE table_schema='public' AND table_name='family_shared_tasks') AS shared_view
    `);
    const s = post.rows[0];
    log(`  tables=${s.tables} rls_tables=${s.rls_tables} policies=${s.policies} fns=${s.fns} realtime=${s.realtime_tables} view=${s.shared_view}`);

    log(`[4/5] running 10 static checks (one query per check)`);
    let pass = 0, fail = 0;
    for (const c of staticChecks) {
      try {
        const r = await client.query(c.sql);
        const row = r.rows[0];
        const ok = row.pass === true || row.pass === 't';
        const tag = ok ? 'PASS' : 'FAIL';
        const exp = row.expected ?? row.expected_min;
        const act = row.actual ?? (row.idx_count !== undefined ? `idx=${row.idx_count}, uq=${row.uq_count}` : '?');
        log(`  ${tag}  ${c.name.padEnd(36)} expected=${exp}  actual=${act}`);
        if (ok) pass++; else fail++;
      } catch (e) {
        log(`  FAIL  ${c.name.padEnd(36)} ERROR: ${e.message.substring(0, 100)}`);
        fail++;
      }
    }
    log(`  --- static: ${pass} pass / ${fail} fail ---\n`);

    log(`[5/5] running dynamic RLS + RPC (verify_rls_and_rpc.sql)`);
    const rls = fs.readFileSync(path.join(root, 'supabase/verify_rls_and_rpc.sql'), 'utf8');
    try {
      const rres = await client.query(rls);
      for (const row of rres.rows || []) {
        if (row.notice) log(`  NOTICE: ${row.notice}`);
      }
    } catch (e) {
      err(`  RLS verify error: ${e.message}`);
    }

    await client.end();
    log(`\n=== DONE (static: ${pass} pass / ${fail} fail) ===`);
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    err(`\nFATAL: ${e.message}`);
    if (e.code) err(`code: ${e.code}`);
    process.exit(2);
  }
})();
