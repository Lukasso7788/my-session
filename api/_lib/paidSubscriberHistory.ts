// Paid subscribers per month for the admin dashboard, from Stripe's own
// payment history. user_entitlements keeps only each person's latest period
// (and later grants overwrite it), so it cannot answer "who paid in April".
//
//   Subscriptions: every paid invoice (amount > 0) covers its line period.
//   Lifetime:      a paid one-time checkout counts from its month onwards.
//   Manual:        user_entitlements rows granted by hand for a paid period
//                  (source manual_admin_grant, e.g. paid by bank transfer).
//
// People are matched by the checkout's client_reference_id / metadata user
// id, then by the Stripe customer id, then by billing email.

export type PaidRange = { userId: string; start: number; end: number | null; source: "invoice" | "lifetime" | "manual" };

export type PaidMonth = { month: string; paidSubscribers: number; subscriberIds: string[] };

const MONTH_MS_GUARD = 1000; // a period ending exactly at midnight does not touch the next month

function monthStartUtc(key: string): number {
  const [year, month] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, 1);
}

function nextMonthStartUtc(key: string): number {
  const [year, month] = key.split("-").map(Number);
  return Date.UTC(year, month, 1);
}

/** Months as "YYYY-MM" from start to end, inclusive. */
export function monthKeys(startKey: string, endKey: string): string[] {
  const keys: string[] = [];
  let [year, month] = startKey.split("-").map(Number);
  const [endYear, endMonth] = endKey.split("-").map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    keys.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return keys;
}

/** Counts each person once per month in which any of their paid ranges falls. */
export function countPaidByMonth(ranges: PaidRange[], months: string[], now = Date.now()): PaidMonth[] {
  return months.map((month) => {
    const start = monthStartUtc(month);
    const end = nextMonthStartUtc(month);
    if (start > now) return { month, paidSubscribers: 0, subscriberIds: [] };
    const ids = new Set<string>();
    for (const range of ranges) {
      const rangeEnd = range.end == null ? Number.POSITIVE_INFINITY : range.end - MONTH_MS_GUARD;
      if (range.start < end && rangeEnd >= start) ids.add(range.userId);
    }
    return { month, paidSubscribers: ids.size, subscriberIds: Array.from(ids).sort() };
  });
}

type StripeLike = {
  checkout: { sessions: { list: (params: Record<string, unknown>) => AsyncIterable<any> } };
  invoices: { list: (params: Record<string, unknown>) => AsyncIterable<any> };
};

type SupabaseLike = {
  from: (table: string) => any;
};

function idOf(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return String((value as { id?: string }).id || "");
}

function lower(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

/** Stripe + database → paid ranges per person. Read-only. */
export async function loadPaidRanges(params: { stripe: StripeLike; sb: SupabaseLike; sinceMs: number }) {
  const { stripe, sb, sinceMs } = params;
  const since = Math.floor(sinceMs / 1000);
  const ranges: PaidRange[] = [];
  const userByCustomer = new Map<string, string>();
  const userByEmail = new Map<string, string>();
  const unmatched: string[] = [];

  const [{ data: profiles }, { data: entitlementRows }] = await Promise.all([
    sb.from("profiles").select("id, email").not("email", "is", null),
    sb.from("user_entitlements").select("user_id, plan, source, current_period_start, current_period_end, stripe_customer_id"),
  ]);
  for (const row of (profiles || []) as Array<{ id: string; email: string | null }>) {
    if (row.email) userByEmail.set(lower(row.email), row.id);
  }
  for (const row of (entitlementRows || []) as any[]) {
    if (row.stripe_customer_id) userByCustomer.set(String(row.stripe_customer_id), String(row.user_id));
    if (
      row.source === "manual_admin_grant" &&
      ["pro_monthly", "pro_yearly", "lifetime"].includes(String(row.plan)) &&
      row.current_period_start
    ) {
      ranges.push({
        userId: String(row.user_id),
        start: Date.parse(row.current_period_start),
        end: row.plan === "lifetime" || !row.current_period_end ? null : Date.parse(row.current_period_end),
        source: "manual",
      });
    }
  }

  // Checkouts: who each Stripe customer is, and lifetime purchases.
  for await (const session of stripe.checkout.sessions.list({ status: "complete", limit: 100, created: { gte: since - 400 * 86400 } })) {
    const kind = String(session?.metadata?.checkout_kind || "");
    if (kind && kind !== "subscription") continue; // host support payments are not subscriptions
    const userId = String(session?.client_reference_id || session?.metadata?.supabase_user_id || "").trim();
    const customer = idOf(session?.customer);
    if (userId && customer) userByCustomer.set(customer, userId);
    if (userId && session?.customer_details?.email) userByEmail.set(lower(session.customer_details.email), userId);
    const plan = String(session?.metadata?.entitlement_plan || session?.metadata?.plan || "");
    if (session?.mode === "payment" && plan === "lifetime" && session?.payment_status === "paid" && userId) {
      ranges.push({ userId, start: Number(session.created) * 1000, end: null, source: "lifetime" });
    }
  }

  // Subscription invoices: each paid one covers its billing period.
  for await (const invoice of stripe.invoices.list({ status: "paid", limit: 100, created: { gte: since - 400 * 86400 } })) {
    if (!(Number(invoice?.amount_paid) > 0)) continue;
    const userId =
      String(invoice?.subscription_details?.metadata?.supabase_user_id || invoice?.parent?.subscription_details?.metadata?.supabase_user_id || "").trim() ||
      userByCustomer.get(idOf(invoice?.customer)) ||
      userByEmail.get(lower(invoice?.customer_email)) ||
      "";
    if (!userId) {
      unmatched.push(String(invoice?.id || ""));
      continue;
    }
    const lines: any[] = Array.isArray(invoice?.lines?.data) ? invoice.lines.data : [];
    const periods = lines
      .map((line) => line?.period)
      .filter((period) => period && Number(period.end) > Number(period.start));
    if (!periods.length) {
      const paidAt = Number(invoice?.status_transitions?.paid_at || invoice?.created) * 1000;
      ranges.push({ userId, start: paidAt, end: paidAt + 30 * 86400 * 1000, source: "invoice" });
      continue;
    }
    for (const period of periods) {
      ranges.push({ userId, start: Number(period.start) * 1000, end: Number(period.end) * 1000, source: "invoice" });
    }
  }

  return { ranges, unmatchedInvoices: unmatched.filter(Boolean) };
}
