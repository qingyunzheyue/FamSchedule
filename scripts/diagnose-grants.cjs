// scripts/diagnose-grants.cjs — verify schema/table grants landed correctly
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
const ref = env.SUPABASE_PROJECT_REF;
const pwd = env.SUPABASE_DB_PASSWORD;
const connStr = `postgresql://postgres:${encodeURIComponent(pwd)}@db.${ref}.supabase.co:5432/postgres`;

(async () => {
  const c = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('--- schema public ACL ---');
  const r1 = await c.query(`SELECT n.nspname, n.nspacl FROM pg_namespace n WHERE n.nspname='public'`);
  console.log(JSON.stringify(r1.rows[0]));

  console.log('\n--- table grants (per grantee / privilege) ---');
  const r2 = await c.query(`SELECT grantee, privilege_type, count(*)::int AS n
    FROM information_schema.table_privileges
    WHERE table_schema='public' GROUP BY 1,2 ORDER BY 1,2`);
  for (const row of r2.rows) console.log(`  ${row.grantee.padEnd(15)} ${row.privilege_type.padEnd(10)} count=${row.n}`);

  console.log('\n--- routine (function) grants per grantee ---');
  const r3 = await c.query(`SELECT grantee, count(*)::int AS n
    FROM information_schema.routine_privileges
    WHERE routine_schema='public' GROUP BY 1 ORDER BY 1`);
  for (const row of r3.rows) console.log(`  ${row.grantee.padEnd(15)} count=${row.n}`);

  console.log('\n--- routine USAGE grantee (schema-level) ---');
  // Schema-level USAGE is on the schema, not the routine; check via pg_namespace ACL
  const r4 = await c.query(`SELECT (aclexplode(n.nspacl)).grantee::regrole::text AS grantee,
    (aclexplode(n.nspacl)).privilege_type AS priv FROM pg_namespace n WHERE n.nspname='public'`);
  for (const row of r4.rows) console.log(`  ${row.grantee.padEnd(20)} ${row.priv}`);

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
