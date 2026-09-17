// scripts/apply-fix.cjs — apply the RLS recursion fix migration
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
  const fix = fs.readFileSync(path.resolve(__dirname, '..', 'supabase/migrations/20250911030000_fix_undo_checkin_id_ambiguity.sql'), 'utf8');
  console.log('applying 20250911030000_fix_undo_checkin_id_ambiguity.sql...');
  await c.query(fix);
  console.log('fix applied');
  await c.end();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
