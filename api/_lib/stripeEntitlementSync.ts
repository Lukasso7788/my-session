// Stripe -> user_entitlements synchronization.
//
// Source of truth: Stripe owns whether a subscription is paid and until when.
// `public.user_entitlements` (one row per user) is the app's projection of it,
// read by the app and the server through hasUnlimitedAccess() in
// src/lib/billing.ts. Every Stripe-driven write goes through this module.
//
// Each webhook, the checkout return page and the periodic reconciliation all
// re-read the CURRENT object from Stripe and derive the row from it, rather
// than trusting the event payload. A replayed or out-of-order event therefore
// re-applies today's state and cannot bring back access that has ended.
// Writes are compare-and-set on updated_at, so two concurrent syncs cannot
// overwrite a newer result with an older one.
//
// See docs/billing/stripe-entitlements-handoff.md.
import type { Stripe } from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPermanentPlan, isRecurringProPlan, parseEntitlementDate } from "../../src/lib/billing.js";

type StripeSubscription = Awaited<ReturnType<Stripe["subscriptions"]["retrieve"]>>;
type StripeCheckoutSession = Awaited<ReturnType<Stripe["checkout"]["sessions"]["retrieve"]>>;
type StripeEvent = ReturnType<Stripe["webhooks"]["constructEvent"]>;

export type RecurringPlan = "pro_monthly" | "pro_yearly";
export type EntitlementStatus = "active" | "trialing" | "expired" | "canceled";

export type EntitlementRow = {
    user_id: string;
    plan: string | null;
    status: string | null;
    source?: string | null;
    current_period_start?: string | null;
    current_period_end?: string | null;
    trial_started_at?: string | null;
    trial_ends_at?: string | null;
    lifetime_granted_at?: string | null;
    founding_granted_at?: string | null;
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    updated_at?: string | null;
};

/** Narrow persistence port; production uses createSupabaseBillingStore. */
export type BillingStore = {
    getEntitlement(userId: string): Promise<EntitlementRow | null>;
    findEntitlementsBySubscription(subscriptionId: string): Promise<EntitlementRow[]>;
    findEntitlementsByCustomer(customerId: string): Promise<EntitlementRow[]>;
    /**
     * Insert when `expectedUpdatedAt` is null (fails if a row appeared), else
     * update only if the row still has that updated_at. Returns false when
     * another writer got there first.
     */
    writeEntitlement(userId: string, expectedUpdatedAt: string | null, fields: Record<string, unknown>): Promise<boolean>;
};

/** The Stripe calls this module needs (a subset of the SDK client). */
export type StripeReader = {
    subscriptions: { retrieve(id: string): Promise<StripeSubscription> };
    checkout: { sessions: { retrieve(id: string): Promise<StripeCheckoutSession> } };
};

export type SyncOutcome =
    | "granted"
    | "updated"
    | "revoked"
    | "unchanged"
    | "lifetime_granted"
    | "payment_pending"
    | "skipped_permanent_plan"
    | "skipped_other_subscription"
    | "skipped_manual_grant"
    | "skipped_no_access_no_row"
    | "user_mismatch"
    | "unlinked"
    | "not_a_subscription_checkout";

export type SyncResult = {
    outcome: SyncOutcome;
    userId: string | null;
    hasAccess: boolean;
    accessEndsAt: string | null;
    subscriptionStatus?: string | null;
};

const TERMINAL_STATUSES = new Set(["canceled", "incomplete_expired"]);
const MAX_WRITE_ATTEMPTS = 4;

export function stripeId(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (value && typeof value === "object" && "id" in value) return String((value as { id?: unknown }).id || "").trim();
    return "";
}

function isoFromSeconds(seconds: unknown): string | null {
    const value = Number(seconds);
    return Number.isFinite(value) && value > 0 ? new Date(value * 1000).toISOString() : null;
}

export function normalizeRecurringPlan(plan: unknown): RecurringPlan | null {
    if (plan === "pro_monthly" || plan === "india_upi_monthly") return "pro_monthly";
    if (plan === "pro_yearly") return "pro_yearly";
    return null;
}

/** The billing period of the subscription (dahlia: on the items). */
export function subscriptionPeriod(subscription: StripeSubscription) {
    const legacy = subscription as StripeSubscription & { current_period_start?: number; current_period_end?: number };
    const items = subscription.items?.data ?? [];
    // With several items, the subscription is paid only through the earliest end.
    const ends = items.map((item) => Number(item.current_period_end)).filter((value) => value > 0);
    const starts = items.map((item) => Number(item.current_period_start)).filter((value) => value > 0);
    return {
        start: isoFromSeconds(legacy.current_period_start || (starts.length ? Math.max(...starts) : 0)),
        end: isoFromSeconds(legacy.current_period_end || (ends.length ? Math.min(...ends) : 0)),
    };
}

function subscriptionPlan(subscription: StripeSubscription, existing: EntitlementRow | null): RecurringPlan {
    const fromMetadata = normalizeRecurringPlan(subscription.metadata?.entitlement_plan || subscription.metadata?.plan);
    if (fromMetadata) return fromMetadata;
    const interval = subscription.items?.data?.[0]?.price?.recurring?.interval;
    if (interval === "year") return "pro_yearly";
    if (interval === "month") return "pro_monthly";
    return normalizeRecurringPlan(existing?.plan) ?? "pro_monthly";
}

export type DesiredSubscriptionState = {
    plan: RecurringPlan;
    status: EntitlementStatus;
    hasAccess: boolean;
    paidThrough: string | null;
    fields: Record<string, unknown>;
};

/**
 * Access policy for one subscription, from Stripe's own status:
 * - active: paid through the current period end, including after the
 *   customer turned off renewal (cancel_at_period_end).
 * - trialing: a trial, kept apart from the paid period (trial_* columns).
 * - past_due / unpaid: the renewal was not paid, so access stops where the
 *   last paid period ended (= the current period's start). No grace period.
 * - incomplete / paused: never paid for this period, no access.
 * - canceled / incomplete_expired: ended; access stops when Stripe ended it.
 */
export function desiredStateFromSubscription(
    subscription: StripeSubscription,
    existing: EntitlementRow | null,
    now = new Date(),
): DesiredSubscriptionState {
    const plan = subscriptionPlan(subscription, existing);
    const period = subscriptionPeriod(subscription);
    const nowMs = now.getTime();
    const status = String(subscription.status || "");
    let paidThrough: string | null = null;
    let trialStart: string | null = null;
    let trialEnd: string | null = null;
    let rowStatus: EntitlementStatus;

    if (status === "trialing") {
        trialStart = isoFromSeconds(subscription.trial_start);
        trialEnd = isoFromSeconds(subscription.trial_end) ?? period.end;
        rowStatus = (parseEntitlementDate(trialEnd) ?? 0) > nowMs ? "trialing" : "expired";
    } else if (status === "active") {
        paidThrough = period.end;
        rowStatus = (parseEntitlementDate(paidThrough) ?? 0) > nowMs ? "active" : "expired";
    } else if (status === "past_due" || status === "unpaid") {
        paidThrough = period.start;
        rowStatus = (parseEntitlementDate(paidThrough) ?? 0) > nowMs ? "active" : "expired";
    } else if (TERMINAL_STATUSES.has(status)) {
        const endedAt = isoFromSeconds(subscription.ended_at);
        const candidates = [endedAt, period.end].filter((value): value is string => Boolean(value));
        paidThrough = status === "canceled" && candidates.length
            ? new Date(Math.min(...candidates.map((value) => Date.parse(value)))).toISOString()
            : null;
        rowStatus = "canceled";
    } else {
        // incomplete, paused or anything new: nothing paid for this period.
        rowStatus = "expired";
    }

    const hasAccess = rowStatus === "active" || rowStatus === "trialing";
    return {
        plan,
        status: rowStatus,
        hasAccess,
        paidThrough,
        fields: {
            plan,
            status: rowStatus,
            current_period_start: rowStatus === "trialing" ? null : period.start,
            current_period_end: rowStatus === "trialing" ? null : paidThrough,
            trial_started_at: trialStart,
            trial_ends_at: trialEnd,
            stripe_customer_id: stripeId(subscription.customer) || null,
            stripe_subscription_id: subscription.id,
            source: "stripe_sync",
            notes: `Stripe subscription ${status}; synced ${now.toISOString()}`,
        },
    };
}

/** Whether a stored row currently grants recurring Pro or a trial. */
function rowHasRecurringAccess(row: EntitlementRow | null, now: Date): boolean {
    if (!row || !isRecurringProPlan(row.plan)) return false;
    if (row.status === "trialing") return (parseEntitlementDate(row.trial_ends_at) ?? 0) > now.getTime();
    return row.status === "active" && (parseEntitlementDate(row.current_period_end) ?? 0) > now.getTime();
}

function isManualGrant(row: EntitlementRow | null): boolean {
    return Boolean(row && !row.stripe_subscription_id && isRecurringProPlan(row.plan) && row.source !== "stripe_sync" && row.source !== "stripe_webhook");
}

/** A fresh updated_at that always differs from the one being replaced. */
function nextUpdatedAt(previous: string | null | undefined): string {
    const nowMs = Date.now();
    const previousMs = parseEntitlementDate(previous) ?? 0;
    return new Date(Math.max(nowMs, previousMs + 1)).toISOString();
}

function sameFields(row: EntitlementRow, fields: Record<string, unknown>): boolean {
    return Object.entries(fields).every(([key, value]) => {
        if (key === "notes" || key === "source") return true;
        const current = (row as Record<string, unknown>)[key] ?? null;
        if (value === null || current === null) return value === current;
        const a = parseEntitlementDate(String(current));
        const b = parseEntitlementDate(String(value));
        if (a !== null && b !== null && /\d{4}-\d{2}-\d{2}T/.test(String(value))) return a === b;
        return String(current) === String(value);
    });
}

type SubscriptionSyncOptions = {
    /** Server-verified owner (e.g. the bearer-authenticated user). */
    expectedUserId?: string;
    now?: Date;
};

/**
 * Find the MySession user for a subscription. The checkout endpoint writes
 * supabase_user_id into subscription metadata on the server; client input is
 * never consulted. A row already linked to the subscription must agree.
 */
async function resolveSubscriptionUser(store: BillingStore, subscription: StripeSubscription) {
    const metadataUserId = String(subscription.metadata?.supabase_user_id || "").trim();
    const linked = await store.findEntitlementsBySubscription(subscription.id);
    const linkedUsers = [...new Set(linked.map((row) => row.user_id))];
    if (linkedUsers.length > 1) return { userId: null, mismatch: true };
    if (metadataUserId && linkedUsers.length && linkedUsers[0] !== metadataUserId) return { userId: null, mismatch: true };
    if (metadataUserId) return { userId: metadataUserId, mismatch: false };
    if (linkedUsers.length) return { userId: linkedUsers[0], mismatch: false };
    const customerId = stripeId(subscription.customer);
    if (customerId) {
        const byCustomer = [...new Set((await store.findEntitlementsByCustomer(customerId)).map((row) => row.user_id))];
        if (byCustomer.length === 1) return { userId: byCustomer[0], mismatch: false };
        if (byCustomer.length > 1) return { userId: null, mismatch: true };
    }
    return { userId: null, mismatch: false };
}

export async function syncSubscription(
    deps: { stripe: StripeReader; store: BillingStore },
    subscriptionId: string,
    options: SubscriptionSyncOptions = {},
): Promise<SyncResult> {
    const now = options.now ?? new Date();
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
        // Fresh Stripe state on every attempt; never the event snapshot.
        const subscription = await deps.stripe.subscriptions.retrieve(subscriptionId);
        const { userId, mismatch } = await resolveSubscriptionUser(deps.store, subscription);
        if (mismatch || (options.expectedUserId && userId && userId !== options.expectedUserId)) {
            return { outcome: "user_mismatch", userId: null, hasAccess: false, accessEndsAt: null, subscriptionStatus: subscription.status };
        }
        if (!userId) {
            return { outcome: "unlinked", userId: null, hasAccess: false, accessEndsAt: null, subscriptionStatus: subscription.status };
        }

        const existing = await deps.store.getEntitlement(userId);
        const desired = desiredStateFromSubscription(subscription, existing, now);
        const result = (outcome: SyncOutcome, hasAccess = desired.hasAccess): SyncResult => ({
            outcome,
            userId,
            hasAccess,
            accessEndsAt: desired.status === "trialing" ? (desired.fields.trial_ends_at as string | null) : desired.paidThrough,
            subscriptionStatus: subscription.status,
        });

        // Lifetime and Founding Member Pro are never changed by a subscription.
        if (existing && isPermanentPlan(existing.plan)) return result("skipped_permanent_plan", true);

        if (existing?.stripe_subscription_id && existing.stripe_subscription_id !== subscription.id) {
            // Two subscriptions for one user: keep the one that grants access,
            // else the newer one. An old subscription cannot displace a newer one.
            const other = await deps.stripe.subscriptions.retrieve(existing.stripe_subscription_id).catch(() => null);
            const otherDesired = other ? desiredStateFromSubscription(other, existing, now) : null;
            const keepOther = otherDesired
                ? otherDesired.hasAccess !== desired.hasAccess
                    ? otherDesired.hasAccess
                    : Number(other!.created || 0) > Number(subscription.created || 0)
                : false;
            if (keepOther) return result("skipped_other_subscription", otherDesired!.hasAccess);
        }

        // A manual (e.g. complimentary) grant is not revoked by an unpaid checkout.
        if (!desired.hasAccess && isManualGrant(existing) && rowHasRecurringAccess(existing, now)) {
            return result("skipped_manual_grant", true);
        }

        if (!existing && !desired.hasAccess) return result("skipped_no_access_no_row");
        if (existing && sameFields(existing, desired.fields)) return result("unchanged");

        const hadAccess = rowHasRecurringAccess(existing, now);
        const written = await deps.store.writeEntitlement(userId, existing?.updated_at ?? null, {
            ...desired.fields,
            ...(desired.hasAccess ? { force_paywall: false } : {}),
            updated_at: nextUpdatedAt(existing?.updated_at),
        });
        if (!written) continue; // Someone else wrote first: re-read and retry.

        return result(desired.hasAccess ? (hadAccess ? "updated" : "granted") : hadAccess ? "revoked" : "updated");
    }
    throw new Error("entitlement_write_conflict");
}

/** True once Stripe says nothing more is owed for this Checkout Session. */
export function checkoutIsPaid(session: Pick<StripeCheckoutSession, "status" | "payment_status">): boolean {
    // `no_payment_required` covers a 100%-off promotion configured by the owner.
    return session.status === "complete" && (session.payment_status === "paid" || session.payment_status === "no_payment_required");
}

/**
 * Apply a subscription/lifetime Checkout Session. Used by the webhook (checkout
 * events) and the success page. Reaching the success URL proves nothing: Pro
 * follows the Stripe subscription status or, for Lifetime, a paid session.
 */
export async function syncCheckoutSession(
    deps: { stripe: StripeReader; store: BillingStore },
    sessionId: string,
    options: SubscriptionSyncOptions = {},
): Promise<SyncResult & { plan: string | null; session: StripeCheckoutSession }> {
    const now = options.now ?? new Date();
    const session = await deps.stripe.checkout.sessions.retrieve(sessionId);
    const kind = String(session.metadata?.checkout_kind || session.metadata?.kind || "subscription");
    const rawPlan = String(session.metadata?.entitlement_plan || session.metadata?.plan || "");
    const userId = String(session.metadata?.supabase_user_id || "").trim();
    const base = { session, plan: rawPlan || null };

    if (kind !== "subscription" || !userId) {
        return { ...base, outcome: "not_a_subscription_checkout", userId: userId || null, hasAccess: false, accessEndsAt: null };
    }
    if (options.expectedUserId && options.expectedUserId !== userId) {
        return { ...base, outcome: "user_mismatch", userId: null, hasAccess: false, accessEndsAt: null };
    }

    if (session.mode === "subscription" && normalizeRecurringPlan(rawPlan)) {
        const subscriptionId = stripeId(session.subscription);
        if (!subscriptionId) return { ...base, outcome: "payment_pending", userId, hasAccess: false, accessEndsAt: null };
        const result = await syncSubscription(deps, subscriptionId, { expectedUserId: userId, now });
        if (result.outcome === "skipped_no_access_no_row" || (!result.hasAccess && !checkoutIsPaid(session))) {
            return { ...base, ...result, outcome: "payment_pending" };
        }
        return { ...base, ...result };
    }

    if (session.mode === "payment" && rawPlan === "lifetime") {
        if (!checkoutIsPaid(session)) return { ...base, outcome: "payment_pending", userId, hasAccess: false, accessEndsAt: null };
        for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
            const existing = await deps.store.getEntitlement(userId);
            if (existing?.plan === "lifetime" && existing.status === "active") {
                return { ...base, outcome: "unchanged", userId, hasAccess: true, accessEndsAt: null };
            }
            const written = await deps.store.writeEntitlement(userId, existing?.updated_at ?? null, {
                plan: "lifetime",
                status: "active",
                source: "stripe_sync",
                lifetime_granted_at: now.toISOString(),
                current_period_start: null,
                current_period_end: null,
                trial_started_at: null,
                trial_ends_at: null,
                force_paywall: false,
                stripe_customer_id: stripeId(session.customer) || existing?.stripe_customer_id || null,
                // A replaced recurring subscription is no longer this row's.
                stripe_subscription_id: null,
                notes: `Lifetime paid via Stripe Checkout ${session.id}`,
                updated_at: nextUpdatedAt(existing?.updated_at),
            });
            if (written) return { ...base, outcome: "lifetime_granted", userId, hasAccess: true, accessEndsAt: null };
        }
        throw new Error("entitlement_write_conflict");
    }

    return { ...base, outcome: "not_a_subscription_checkout", userId, hasAccess: false, accessEndsAt: null };
}

/** Subscription referenced by an invoice (dahlia: invoice.parent.subscription_details). */
export function invoiceSubscriptionId(invoice: unknown): string {
    const value = invoice as { subscription?: unknown; parent?: { subscription_details?: { subscription?: unknown } } };
    return stripeId(value?.parent?.subscription_details?.subscription) || stripeId(value?.subscription);
}

export const SUBSCRIPTION_EVENTS = new Set([
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "customer.subscription.paused",
    "customer.subscription.resumed",
    "customer.subscription.pending_update_applied",
    "customer.subscription.pending_update_expired",
]);
export const INVOICE_EVENTS = new Set(["invoice.paid", "invoice.payment_failed", "invoice.payment_action_required"]);
export const CHECKOUT_EVENTS = new Set([
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
]);

/** Event types that can change access, and that reconciliation replays. */
export const ENTITLEMENT_EVENT_TYPES = [...CHECKOUT_EVENTS, ...SUBSCRIPTION_EVENTS, ...INVOICE_EVENTS];

/** Apply the access effect of one event (side effects such as emails live in the webhook). */
export async function syncEntitlementForEvent(
    deps: { stripe: StripeReader; store: BillingStore },
    event: Pick<StripeEvent, "type"> & { data: { object: unknown } },
    now = new Date(),
): Promise<SyncResult | null> {
    const object = event.data.object as { id?: string; object?: string; metadata?: Record<string, string> | null };
    if (CHECKOUT_EVENTS.has(event.type)) {
        const kind = String(object?.metadata?.checkout_kind || object?.metadata?.kind || "");
        if (kind === "host_support") return null;
        return syncCheckoutSession(deps, String(object.id), { now });
    }
    if (SUBSCRIPTION_EVENTS.has(event.type)) return syncSubscription(deps, String(object.id), { now });
    if (INVOICE_EVENTS.has(event.type)) {
        const subscriptionId = invoiceSubscriptionId(object);
        return subscriptionId ? syncSubscription(deps, subscriptionId, { now }) : null;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Supabase persistence

type SupabaseLike = Pick<SupabaseClient, "from">;

const ENTITLEMENT_COLUMNS =
    "user_id,plan,status,source,current_period_start,current_period_end,trial_started_at,trial_ends_at,lifetime_granted_at,founding_granted_at,stripe_customer_id,stripe_subscription_id,updated_at";

export function createSupabaseBillingStore(db: SupabaseLike): BillingStore {
    return {
        async getEntitlement(userId) {
            const { data, error } = await db.from("user_entitlements").select(ENTITLEMENT_COLUMNS).eq("user_id", userId).maybeSingle();
            if (error) throw error;
            return data ?? null;
        },
        async findEntitlementsBySubscription(subscriptionId) {
            const { data, error } = await db.from("user_entitlements").select(ENTITLEMENT_COLUMNS).eq("stripe_subscription_id", subscriptionId).limit(5);
            if (error) throw error;
            return data ?? [];
        },
        async findEntitlementsByCustomer(customerId) {
            const { data, error } = await db.from("user_entitlements").select(ENTITLEMENT_COLUMNS).eq("stripe_customer_id", customerId).limit(5);
            if (error) throw error;
            return data ?? [];
        },
        async writeEntitlement(userId, expectedUpdatedAt, fields) {
            if (expectedUpdatedAt === null) {
                const { error } = await db.from("user_entitlements").insert({ user_id: userId, ...fields });
                if (!error) return true;
                if (error.code === "23505") return false; // Row appeared meanwhile.
                throw error;
            }
            const { data, error } = await db
                .from("user_entitlements")
                .update(fields)
                .eq("user_id", userId)
                .eq("updated_at", expectedUpdatedAt)
                .select("user_id");
            if (error) throw error;
            return Array.isArray(data) && data.length > 0;
        },
    };
}

// ---------------------------------------------------------------------------
// Processed-event ledger (public.stripe_webhook_events)

export type EventClaim = "claimed" | "duplicate" | "in_progress" | "ledger_unavailable";

export type EventLedger = {
    claim(event: { id: string; type: string; created: number; livemode: boolean }): Promise<EventClaim>;
    complete(eventId: string, outcome: unknown): Promise<void>;
    fail(eventId: string, message: string): Promise<void>;
};

const PROCESSING_LEASE_MS = 2 * 60_000;

function isMissingTable(error: { code?: string; message?: string } | null | undefined) {
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    return code === "42P01" || code === "PGRST205" || (/stripe_webhook_events/.test(message) && /does not exist|schema cache/.test(message));
}

/**
 * Stripe may deliver an event twice or concurrently. An event is marked
 * processed only after its effects were saved; a failure stays retryable.
 * Before the ledger migration is applied the webhook still works (all writes
 * are idempotent), it just cannot skip duplicates early.
 */
export function createSupabaseEventLedger(db: SupabaseLike, now = () => new Date()): EventLedger {
    return {
        async claim(event) {
            const startedAt = now().toISOString();
            const insert = await db.from("stripe_webhook_events").insert({
                id: event.id,
                type: event.type,
                livemode: event.livemode,
                event_created_at: new Date(event.created * 1000).toISOString(),
                status: "processing",
                attempts: 1,
                processing_started_at: startedAt,
            });
            if (!insert.error) return "claimed";
            if (isMissingTable(insert.error)) return "ledger_unavailable";
            if (insert.error.code !== "23505") throw insert.error;

            const { data: row, error } = await db
                .from("stripe_webhook_events")
                .select("status,attempts,processing_started_at")
                .eq("id", event.id)
                .maybeSingle();
            if (error) throw error;
            if (!row) return "in_progress";
            if (row.status === "processed") return "duplicate";
            const leaseActive = row.status === "processing"
                && Date.now() - (parseEntitlementDate(row.processing_started_at) ?? 0) < PROCESSING_LEASE_MS;
            if (leaseActive) return "in_progress";

            // Take over a failed or abandoned attempt, only if nobody else did.
            const { data: taken, error: takeError } = await db
                .from("stripe_webhook_events")
                .update({ status: "processing", attempts: Number(row.attempts || 0) + 1, processing_started_at: startedAt, last_error: null })
                .eq("id", event.id)
                .eq("status", row.status)
                .eq("attempts", row.attempts)
                .select("id");
            if (takeError) throw takeError;
            return Array.isArray(taken) && taken.length ? "claimed" : "in_progress";
        },
        async complete(eventId, outcome) {
            const { error } = await db
                .from("stripe_webhook_events")
                .update({ status: "processed", processed_at: now().toISOString(), outcome: outcome ?? null, last_error: null })
                .eq("id", eventId);
            if (error && !isMissingTable(error)) throw error;
        },
        async fail(eventId, message) {
            const { error } = await db
                .from("stripe_webhook_events")
                .update({ status: "failed", last_error: message.slice(0, 500) })
                .eq("id", eventId);
            if (error && !isMissingTable(error)) console.error("stripe_webhook_events: could not record failure", error);
        },
    };
}
