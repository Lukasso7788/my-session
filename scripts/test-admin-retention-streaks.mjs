// Runs supabase/tests/admin_retention_streaks.sql against PGlite with the
// tables the migration reads. No network.
//
//   PGLITE_MODULE=<path to @electric-sql/pglite/dist/index.js> node scripts/test-admin-retention-streaks.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = process.env.PGLITE_MODULE;
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : "@electric-sql/pglite");

const stubs = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function public.is_app_admin() returns boolean language sql stable as $$ select current_setting('test.admin', true) = 'on' $$;
create table public.profiles (id uuid primary key, full_name text, avatar_url text);
create table public.attendance_daily_users (attendance_date date not null, user_id uuid not null, first_seen_at timestamptz not null, last_seen_at timestamptz not null, created_at timestamptz default now(), updated_at timestamptz default now(), primary key (attendance_date, user_id));
`;
const read = (file) => readFileSync(path.join(root, file), "utf8").replace(/^set local .*$/gm, "");

const db = new PGlite();
const notices = [];
await db.exec(stubs);
await db.exec(read("supabase/migrations/20261018130000_admin_retention_streaks.sql"));
await db.exec(read("supabase/migrations/20261021090000_profile_streaks.sql"));

// Only admins may call the public function.
let refused = false;
try {
  await db.exec(`set test.uid = 'f0000000-0000-4000-8000-0000000000aa'; select public.admin_retention_streaks('2026-10-14');`);
} catch {
  refused = true;
}
if (!refused) throw new Error("FAILED: non-admin was allowed");
notices.push("ok - non-admins are refused");
await db.exec(`set test.uid = 'f0000000-0000-4000-8000-0000000000aa'; set test.admin = 'on'; select public.admin_retention_streaks('2026-10-14'); reset test.admin; reset test.uid;`);
notices.push("ok - admins get the report (empty data)");

try {
  await db.exec(read("supabase/tests/admin_retention_streaks.sql"), { onNotice: (n) => notices.push(n.message) });
} catch (error) {
  for (const line of notices) console.log(line);
  console.error(String(error?.message || error));
  process.exit(1);
}
for (const line of notices) console.log(line);
console.log(`\n${notices.filter((l) => l.startsWith("ok -")).length} checks passed`);
