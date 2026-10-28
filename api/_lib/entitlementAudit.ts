// Read-only classification of existing user_entitlements rows, used by
// scripts/billing/audit-entitlements.mjs. Produces findings and suggested
// actions; it never writes. Historical manual grants are reported for review,
// not treated as errors.
import type { Stripe } from "stripe";
import { hasUnlimitedAccess, isPermanentPlan, isRecurringProPlan, parseEntitlementDate, type UserEntitlement } from "../../src/lib/billing.js";
import { desiredStateFromSubscription, stripeId, type EntitlementRow } from "./stripeEntitlementSync.js";

type StripeSubscription = Awaited<ReturnType<Stripe["subscriptions"]["retrieve"]>>;

export type AuditSeverity = "release_blocker" | "review" | "info";

export type AuditFinding = {
    code: string;
    severity: AuditSeverity;
    detail: string;
    suggestedAction: string;
};

export type AuditInput = {
    row: EntitlementRow;
    now: Date;
    /** The linked subscription, when Stripe was queried; null if it does not exist. */
    stripeSubscription?: StripeSubscription | null;
    /** Plan-like columns from profiles (only the ones that exist). */
    profilePlanFields?: Record<string, unknown> | null;
    /** Rows found in legacy payments/subscriptions tables, if they exist. */
    legacyPaymentRows?: number | null;
};

const PAID_SOURCES = new Set(["checkout_confirm", "stripe_webhook", "stripe_sync"]);

/** The rule before this change: plan + status only, no dates. */
export function legacyHasAccess(row: Pick<EntitlementRow, "plan" | "status">): boolean {
    return (row.status === "active" || row.status === "trialing")
        && ["pro_monthly", "pro_yearly", "lifetime", "founding_free"].includes(String(row.plan));
}

function accessRow(row: EntitlementRow) {
    return row as unknown as Pick<UserEntitlement, "plan" | "status" | "current_period_end" | "trial_ends_at">;
}

function profileSaysPro(fields: Record<string, unknown>): boolean | null {
    const values = Object.values(fields).filter((value) => value !== null && value !== undefined);
    if (!values.length) return null;
    return values.some((value) => value === true || /pro|lifetime|founding|paid|premium/i.test(String(value)));
}

export function auditEntitlement(input: AuditInput): AuditFinding[] {
    const { row, now } = input;
    const findings: AuditFinding[] = [];
    const add = (code: string, severity: AuditSeverity, detail: string, suggestedAction: string) =>
        findings.push({ code, severity, detail, suggestedAction });

    const before = legacyHasAccess(row);
    const after = hasUnlimitedAccess(accessRow(row), now);
    if (before && !after) {
        add("loses_access_with_new_rule", "release_blocker",
            `Had Pro under the old plan+status rule; the new rule denies it (status ${row.status}, period end ${row.current_period_end ?? "missing"}).`,
            "Confirm this user really has no paid period before deploying; extend a manual grant explicitly if intended.");
    }

    if (isPermanentPlan(row.plan)) {
        if (row.plan === "lifetime" && !row.stripe_customer_id) {
            add("lifetime_without_stripe_link", "info", "Lifetime without a Stripe customer (manual or historical grant).", "No action; keep as is.");
        }
        return findings;
    }
    if (!isRecurringProPlan(row.plan)) return findings;

    const end = parseEntitlementDate(row.current_period_end);
    const activeLike = row.status === "active" || row.status === "trialing";
    if (row.status === "active" && row.current_period_end && end === null) {
        add("invalid_period_end", "review", `current_period_end is not a valid date: ${row.current_period_end}.`, "Fix the date from Stripe or the grant record.");
    }
    if (row.status === "active" && !row.current_period_end) {
        add("active_without_period_end", "review", "Active monthly/yearly Pro without a paid period end.", "Find the payment or grant; set the real end, or mark it expired.");
    }
    if (activeLike && end !== null && end <= now.getTime()) {
        add("active_but_period_ended", "review", `Status ${row.status} but the paid period ended ${row.current_period_end}.`, "Sync from Stripe (reconcile) or set status expired after review.");
    }

    if (!row.stripe_subscription_id) {
        if (row.source === "admin_complimentary_pro") {
            add("manual_grant", "info", "Complimentary Pro (manual grant, no Stripe subscription).", "No action; the complimentary expiry job handles its end.");
        } else if (PAID_SOURCES.has(String(row.source))) {
            add("paid_source_missing_stripe_ids", "review",
                `Source ${row.source} but no Stripe subscription linked${row.stripe_customer_id ? "" : " and no customer"}.`,
                "Look the user up in Stripe (by checkout session or email) and link or close; do not cancel anything automatically.");
        } else {
            add("manual_or_unknown_grant", "info", `Recurring plan from source ${row.source ?? "unknown"} without Stripe link.`, "Review with the owner; historical manual grants can be valid.");
        }
    }

    if (row.stripe_subscription_id && input.stripeSubscription === null) {
        add("stripe_subscription_missing", "review", "Linked subscription was not found in Stripe (wrong mode or deleted).", "Check test/live mode and the customer's subscriptions.");
    }
    if (row.stripe_subscription_id && input.stripeSubscription) {
        const subscription = input.stripeSubscription;
        const desired = desiredStateFromSubscription(subscription, row, now);
        const stripeCustomer = stripeId(subscription.customer);
        if (row.stripe_customer_id && stripeCustomer && stripeCustomer !== row.stripe_customer_id) {
            add("customer_mismatch", "review", "Stored customer differs from the subscription's customer.", "Verify ownership before any sync.");
        }
        const sameEnd = (parseEntitlementDate(row.current_period_end) ?? null) === (parseEntitlementDate(desired.fields.current_period_end as string | null) ?? null);
        if (row.status !== desired.status || !sameEnd) {
            add("stripe_mismatch", desired.hasAccess === after ? "review" : "release_blocker",
                `Row ${row.status}/${row.current_period_end ?? "none"} vs Stripe ${subscription.status} -> ${desired.status}/${desired.fields.current_period_end ?? "none"}.`,
                "Run the reconcile (dryRun first); it applies Stripe's state.");
        }
    }

    if (input.profilePlanFields) {
        const profilePro = profileSaysPro(input.profilePlanFields);
        if (profilePro !== null && profilePro !== after) {
            add("profile_mismatch", "review", `profiles shows ${profilePro ? "Pro" : "Free"}, entitlement access is ${after ? "Pro" : "Free"}.`, "Decide which record is stale; user_entitlements is the access source.");
        }
    }
    if (input.legacyPaymentRows === 0 && PAID_SOURCES.has(String(row.source)) && !row.stripe_subscription_id) {
        add("no_payment_record", "review", "No rows in payments/subscriptions for a paid-source entitlement.", "Treat as unconfirmed payment until Stripe shows otherwise.");
    }
    return findings;
}
