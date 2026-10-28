// DRY RUN: read-only audit of user_entitlements against Stripe and profiles.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... [STRIPE_SECRET_KEY=...] \
//     node scripts/billing/audit-entitlements.mjs [--out report.json] [--no-stripe]
//
// Never writes: the Supabase client below rejects every write method, and only
// Stripe GET calls are made. Nothing is canceled, charged or updated.
// The JSON report contains internal user and Stripe IDs (no emails or names).
// Keep it out of the repository; by default it goes to the OS temp folder.
import { build } from "esbuild";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const useStripe = !args.includes("--no-stripe") && Boolean(process.env.STRIPE_SECRET_KEY);
const outIndex = args.indexOf("--out");
const outPath = outIndex >= 0 ? args[outIndex + 1] : path.join(tmpdir(), `billing-audit-${new Date().toISOString().slice(0, 10)}.json`);

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read access is all that is used).");
  process.exit(2);
}

const bundled = await build({ entryPoints: ["api/_lib/entitlementAudit.ts"], bundle: true, platform: "node", format: "esm", external: ["stripe", "@supabase/supabase-js"], write: false, logLevel: "silent" });
const { auditEntitlement } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const rawDb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
// Read-only guard: any write method throws before a request is made.
const db = {
  from(table) {
    const query = rawDb.from(table);
    return new Proxy(query, {
      get(target, prop) {
        if (["insert", "update", "upsert", "delete"].includes(String(prop))) throw new Error(`audit is read-only (${String(prop)} on ${table})`);
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  },
};
const stripe = useStripe ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-03-25.dahlia" }) : null;

async function selectAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).order("user_id").range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

async function optionalUserCounts(table, userIds) {
  const probe = await db.from(table).select("user_id").limit(1);
  if (probe.error) return null; // Table (or user_id column) does not exist.
  const counts = new Map();
  for (let i = 0; i < userIds.length; i += 200) {
    const { data, error } = await db.from(table).select("user_id").in("user_id", userIds.slice(i, i + 200));
    if (error) return null;
    for (const row of data ?? []) counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
  }
  return counts;
}

async function profilePlanFields(userIds) {
  const probe = await db.from("profiles").select("*").limit(1);
  if (probe.error || !probe.data?.length) return { columns: [], byUser: new Map() };
  const columns = Object.keys(probe.data[0]).filter((key) => /plan|is_pro|premium|membership|subscription|tier|lifetime|founding/i.test(key));
  const byUser = new Map();
  if (!columns.length) return { columns, byUser };
  for (let i = 0; i < userIds.length; i += 200) {
    const { data, error } = await db.from("profiles").select(["id", ...columns].join(",")).in("id", userIds.slice(i, i + 200));
    if (error) throw error;
    for (const row of data ?? []) {
      const { id, ...fields } = row;
      byUser.set(id, fields);
    }
  }
  return { columns, byUser };
}

const now = new Date();
const rows = await selectAll(
  "user_entitlements",
  "user_id,plan,status,source,current_period_start,current_period_end,trial_started_at,trial_ends_at,lifetime_granted_at,founding_granted_at,stripe_customer_id,stripe_subscription_id,updated_at",
);
const userIds = rows.map((row) => row.user_id);
const profiles = await profilePlanFields(userIds);
const payments = await optionalUserCounts("payments", userIds);
const legacySubscriptions = await optionalUserCounts("subscriptions", userIds);

const results = [];
for (const row of rows) {
  let stripeSubscription;
  if (stripe && row.stripe_subscription_id && /^pro_(monthly|yearly)$/.test(String(row.plan))) {
    try {
      stripeSubscription = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    } catch (error) {
      stripeSubscription = error?.code === "resource_missing" ? null : undefined;
      if (stripeSubscription === undefined) console.warn("Stripe lookup failed for one row:", error?.message);
    }
  }
  const legacyRows = payments || legacySubscriptions
    ? (payments?.get(row.user_id) ?? 0) + (legacySubscriptions?.get(row.user_id) ?? 0)
    : null;
  const findings = auditEntitlement({
    row,
    now,
    stripeSubscription,
    profilePlanFields: profiles.byUser.get(row.user_id) ?? null,
    legacyPaymentRows: legacyRows,
  });
  if (findings.length) {
    results.push({
      user_id: row.user_id,
      plan: row.plan,
      status: row.status,
      source: row.source,
      current_period_end: row.current_period_end,
      stripe_customer_id: row.stripe_customer_id,
      stripe_subscription_id: row.stripe_subscription_id,
      findings,
    });
  }
}

const totals = {};
for (const result of results) for (const finding of result.findings) {
  const key = `${finding.severity}:${finding.code}`;
  totals[key] = (totals[key] ?? 0) + 1;
}
const report = {
  generatedAt: now.toISOString(),
  dryRun: true,
  stripeChecked: Boolean(stripe),
  rowsScanned: rows.length,
  profilePlanColumns: profiles.columns,
  legacyTables: { payments: payments !== null, subscriptions: legacySubscriptions !== null },
  totals,
  results,
};
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ rowsScanned: rows.length, stripeChecked: Boolean(stripe), profilePlanColumns: profiles.columns, legacyTables: report.legacyTables, totals }, null, 2));
console.log(`Full report (contains internal IDs, do not commit): ${outPath}`);
