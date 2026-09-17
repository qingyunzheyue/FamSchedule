// scripts/verify-pg.cjs — fallback verifier using node-postgres direct connection
// Used only if `supabase db execute` doesn't return SELECT rows for verify.sql.
// Connection: postgresql://postgres:${DB_PASSWORD}@db.${REF}.supabase.co:5432/postgres

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
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  env[m[1].trim()] = v;
}

const required = ['SUPABASE_URL', 'SUPABASE_PROJECT_REF', 'SUPABASE_DB_PASSWORD'];
for (const k of required) {
  if (!env[k]) { console.error(`FAIL: ${k} missing`); process.exit(1); }
}

const ref = env.SUPABASE_PROJECT_REF;
const pwd = env.SUPABASE_DB_PASSWORD;
// Direct connection (no region needed)
const connStr = `postgresql://postgres:${encodeURIComponent(pwd)}@db.${ref}.supabase.co:5432/postgres`;

(async () => {
  const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
  try {
    await client.connect();
    console.log('connected to db');

    // Static verify
    const staticSql = fs.readFileSync(path.join(root, 'supabase/verify.sql'), 'utf8');
    const staticRes = await client.query(staticSql);
    console.log('\n=== STATIC VERIFY ===');
    let passCount = 0, failCount = 0;
    for (const row of staticRes.rows) {
      const ok = row.pass === true;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${row.check.padEnd(40)} expected=${row.expected ?? row.expected_min} actual=${row.actual ?? row.idx_count}/${row.uq_count}`);
      if (ok) passCount++; else failCount++;
    }
    console.log(`\nstatic: ${passCount} pass / ${failCount} fail / ${staticRes.rows.length} total`);

    // Dynamic RLS + RPC
    const rlsSql = fs.readFileSync(path.join(root, 'supabase/verify_rls_and_rpc.sql'), 'utf8');
    const rlsRes = await client.query(rlsSql);
    console.log('\n=== DYNAMIC RLS+RPC (NOTICEs) ===');
    for (const row of rlsRes.rows) {
      if (row.notice) console.log(row.notice);
    }

    await client.end();
    process.exit(failCount > 0 ? 1 : 0);
  } catch (e) {
    console.error('ERROR:', e.message);
    if (e.code) console.error('code:', e.code);
    process.exit(2);
  }
})();
