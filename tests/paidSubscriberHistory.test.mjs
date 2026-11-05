import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [resolve("api/_lib/paidSubscriberHistory.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { countPaidByMonth, loadPaidRanges, monthKeys } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
);

const at = (iso) => Date.parse(iso);
const NOW = at("2026-11-05T12:00:00Z");
const MONTHS = monthKeys("2026-03", "2026-11");

test("month keys run inclusive across a year boundary", () => {
  assert.deepEqual(monthKeys("2025-11", "2026-02"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
});

test("each paid period counts its person in every month it touches, once", () => {
  const ranges = [
    { userId: "heather", start: at("2026-04-02T01:00:00Z"), end: at("2026-05-02T01:00:00Z"), source: "invoice" },
    { userId: "heather", start: at("2026-05-02T01:00:00Z"), end: at("2026-06-02T01:00:00Z"), source: "invoice" },
    { userId: "emma", start: at("2026-04-17T00:00:00Z"), end: at("2026-05-17T00:00:00Z"), source: "manual" },
    // Later overwritten by a founding grant in the database; Stripe still has it.
    { userId: "vedant", start: at("2026-05-05T22:00:00Z"), end: at("2026-06-05T22:00:00Z"), source: "invoice" },
    // Ends exactly at midnight on June 1: not a June subscriber.
    { userId: "edge", start: at("2026-05-01T00:00:00Z"), end: at("2026-06-01T00:00:00Z"), source: "invoice" },
    { userId: "lifer", start: at("2026-06-11T13:45:00Z"), end: null, source: "lifetime" },
  ];
  const byMonth = Object.fromEntries(countPaidByMonth(ranges, MONTHS, NOW).map((row) => [row.month, row.subscriberIds]));
  assert.deepEqual(byMonth["2026-03"], []);
  assert.deepEqual(byMonth["2026-04"], ["emma", "heather"]);
  assert.deepEqual(byMonth["2026-05"], ["edge", "emma", "heather", "vedant"]);
  assert.deepEqual(byMonth["2026-06"], ["heather", "lifer", "vedant"]);
  assert.deepEqual(byMonth["2026-11"], ["lifer"]);
});

test("Stripe invoices and lifetime checkouts become ranges, matched to people", async () => {
  const sb = {
    from: (name) =>
      name === "profiles"
        ? { select: () => ({ not: async () => ({ data: [{ id: "u-email", email: "Jo@Example.com" }] }) }) }
        : { select: async () => ({ data: [{ user_id: "u-manual", plan: "pro_monthly", source: "manual_admin_grant", current_period_start: "2026-04-17T00:00:00Z", current_period_end: "2026-05-17T00:00:00Z" }] }) },
  };
  async function* iter(items) { for (const item of items) yield item; }
  const stripe = {
    checkout: { sessions: { list: () => iter([
      { mode: "subscription", customer: "cus_A", client_reference_id: "u-sub", metadata: { checkout_kind: "subscription", plan: "pro_monthly" }, payment_status: "paid", created: 1 },
      { mode: "payment", customer: "cus_L", client_reference_id: "u-life", metadata: { checkout_kind: "subscription", plan: "lifetime", entitlement_plan: "lifetime" }, payment_status: "paid", created: at("2026-06-11T00:00:00Z") / 1000 },
      { mode: "payment", customer: "cus_S", client_reference_id: "u-support", metadata: { checkout_kind: "host_support" }, payment_status: "paid", created: 1 },
    ]) } },
    invoices: { list: () => iter([
      { id: "in_1", amount_paid: 1000, customer: "cus_A", lines: { data: [{ period: { start: at("2026-04-02T00:00:00Z") / 1000, end: at("2026-05-02T00:00:00Z") / 1000 } }] } },
      { id: "in_2", amount_paid: 1000, customer: "cus_unknown", customer_email: "jo@example.com", lines: { data: [{ period: { start: at("2026-06-11T00:00:00Z") / 1000, end: at("2026-07-11T00:00:00Z") / 1000 } }] } },
      { id: "in_free", amount_paid: 0, customer: "cus_A", lines: { data: [] } },
      { id: "in_orphan", amount_paid: 1000, customer: "cus_x", lines: { data: [] } },
    ]) },
  };
  const { ranges, unmatchedInvoices } = await loadPaidRanges({ stripe, sb, sinceMs: at("2026-03-01T00:00:00Z") });
  const users = ranges.map((range) => `${range.userId}:${range.source}`).sort();
  assert.deepEqual(users, ["u-email:invoice", "u-life:lifetime", "u-manual:manual", "u-sub:invoice"]);
  assert.deepEqual(unmatchedInvoices, ["in_orphan"]);
});

test("the admin action is admin-only and the chart reads it", () => {
  const admin = readFileSync("api/livekit/admin.ts", "utf8");
  assert.match(admin, /async function handlePaidSubscribersMonthly[\s\S]{0,300}await assertAppAdmin\(/);
  const page = readFileSync("src/pages/AdminPage.tsx", "utf8");
  assert.match(page, /action: "admin_paid_subscribers_monthly"/);
});
