// Periodic recovery after missed or failed Stripe webhooks.
//
// 1. Replays recent access-changing events from Stripe's event log through the
//    normal webhook path. The processed-event ledger skips events that were
//    already handled, so only missed or failed ones do work.
// 2. Re-syncs recurring rows whose paid period is ending or has ended (any
//    age while the row still says active; expired rows for 40 days), so
//    a renewal or failure is picked up even if its event fell out of the log.
//
// Runs hourly from the existing Cloudflare Worker cron. Never cancels or
// charges anything in Stripe; it only reads Stripe and writes user_entitlements.
import type { Stripe } from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
    desiredStateFromSubscription,
    syncSubscription,
    type BillingStore,
    type StripeReader,
} from "./stripeEntitlementSync.js";

type StripeEvent = ReturnType<Stripe["webhooks"]["constructEvent"]>;

export type ReconcileStripe = StripeReader & {
    events: { list(params: Record<string, unknown>): Promise<{ data: StripeEvent[]; has_more: boolean }> };
};

export type ReconcileSummary = {
    dryRun: boolean;
    events: { listed: number; processed: number; duplicates: number; inProgress: number; failed: number };
    rows: { checked: number; outcomes: Record<string, number> };
    errors: string[];
};

const DEFAULT_LOOKBACK_HOURS = 72;
const MAX_EVENTS = 400;
const MAX_ROWS = 100;

export async function reconcileStripeEntitlements(params: {
    stripe: ReconcileStripe;
    store: BillingStore;
    db: Pick<SupabaseClient, "from">;
    handleEvent: (event: StripeEvent) => Promise<{ status: number; body: Record<string, unknown> }>;
    eventTypes: string[];
    dryRun?: boolean;
    now?: Date;
    lookbackHours?: number;
}): Promise<ReconcileSummary> {
    const now = params.now ?? new Date();
    const dryRun = Boolean(params.dryRun);
    const summary: ReconcileSummary = {
        dryRun,
        events: { listed: 0, processed: 0, duplicates: 0, inProgress: 0, failed: 0 },
        rows: { checked: 0, outcomes: {} },
        errors: [],
    };

    // 1. Event replay, oldest first so effects apply in the order they happened.
    const since = Math.floor(now.getTime() / 1000) - (params.lookbackHours ?? DEFAULT_LOOKBACK_HOURS) * 3600;
    const events: StripeEvent[] = [];
    let startingAfter: string | undefined;
    try {
        while (events.length < MAX_EVENTS) {
            const page = await params.stripe.events.list({
                types: params.eventTypes,
                created: { gte: since },
                limit: 100,
                ...(startingAfter ? { starting_after: startingAfter } : {}),
            });
            events.push(...page.data);
            if (!page.has_more || !page.data.length) break;
            startingAfter = page.data[page.data.length - 1].id;
        }
    } catch (error) {
        summary.errors.push(`events_list_failed: ${(error as Error).message}`);
    }
    summary.events.listed = events.length;
    if (!dryRun) {
        for (const event of events.reverse()) {
            const { status, body } = await params.handleEvent(event);
            if (status === 200 && body.duplicate) summary.events.duplicates += 1;
            else if (status === 200) summary.events.processed += 1;
            else if (status === 409) summary.events.inProgress += 1;
            else summary.events.failed += 1;
        }
    }

    // 2. Rows around the end of their paid period.
    const soon = new Date(now.getTime() + 2 * 3600_000).toISOString();
    const recent = new Date(now.getTime() - 40 * 86_400_000).toISOString();
    const { data: rows, error } = await params.db
        .from("user_entitlements")
        .select("user_id,stripe_subscription_id")
        .in("plan", ["pro_monthly", "pro_yearly"])
        .in("status", ["active", "trialing", "expired"])
        .not("stripe_subscription_id", "is", null)
        .or(`current_period_end.is.null,current_period_end.lt.${soon}`)
        // Still-"active" rows of any age (old webhooks never extended periods
        // on renewal); expired ones only recently, so long-gone ones drop out.
        .or(`status.in.(active,trialing),current_period_end.is.null,current_period_end.gt.${recent}`)
        .order("current_period_end", { ascending: true, nullsFirst: true })
        .limit(MAX_ROWS);
    if (error) {
        summary.errors.push(`row_query_failed: ${error.message || error.code}`);
        return summary;
    }

    for (const row of rows ?? []) {
        summary.rows.checked += 1;
        try {
            let outcome: string;
            if (dryRun) {
                const subscription = await params.stripe.subscriptions.retrieve(String(row.stripe_subscription_id));
                const existing = await params.store.getEntitlement(row.user_id);
                const desired = desiredStateFromSubscription(subscription, existing, now);
                const sameEnd = Date.parse(String(existing?.current_period_end)) === Date.parse(String(desired.fields.current_period_end))
                    || (!existing?.current_period_end && !desired.fields.current_period_end);
                outcome = existing?.status === desired.status && sameEnd
                    ? "would_keep"
                    : `would_set_${desired.status}`;
            } else {
                outcome = (await syncSubscription(params, String(row.stripe_subscription_id), { now })).outcome;
            }
            summary.rows.outcomes[outcome] = (summary.rows.outcomes[outcome] ?? 0) + 1;
        } catch (rowError) {
            summary.errors.push(`row_sync_failed: ${(rowError as Error).message}`);
        }
    }
    return summary;
}
