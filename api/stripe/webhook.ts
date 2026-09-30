import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import {
  AFFILIATE_TERMS_VERSION,
  LEGACY_AFFILIATE_TERMS_VERSION,
  calculateCommissionReversal,
  calculatePartnerCommission,
  hasSuccessfulPaidAmount,
  isWithinRevenueShareWindow,
} from "../_lib/affiliateCommission.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-03-25.dahlia",
});

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type PaidPlan = "pro_monthly" | "pro_yearly" | "lifetime";

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function normalizePaidPlan(plan: string | undefined | null): PaidPlan | null {
  if (plan === "india_upi_monthly") return "pro_monthly";
  if (plan === "pro_monthly") return "pro_monthly";
  if (plan === "pro_yearly") return "pro_yearly";
  if (plan === "lifetime") return "lifetime";
  return null;
}

async function upsertEntitlement(params: {
  userId: string;
  plan: PaidPlan;
  source: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}) {
  const { userId, plan, source, stripeCustomerId, stripeSubscriptionId } = params;
  const nowIso = new Date().toISOString();

  const payload: Record<string, unknown> = {
    user_id: userId,
    plan,
    status: "active",
    source,
    force_paywall: false,
    updated_at: nowIso,
    notes: `Activated via Stripe webhook at ${nowIso}`,
  };

  if (stripeCustomerId) payload.stripe_customer_id = stripeCustomerId;
  if (stripeSubscriptionId) payload.stripe_subscription_id = stripeSubscriptionId;

  if (plan === "pro_monthly") {
    payload.current_period_start = nowIso;
    payload.current_period_end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    payload.trial_started_at = null;
    payload.trial_ends_at = null;
    payload.lifetime_granted_at = null;
    payload.founding_granted_at = null;
  }

  if (plan === "pro_yearly") {
    payload.current_period_start = nowIso;
    payload.current_period_end = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    payload.trial_started_at = null;
    payload.trial_ends_at = null;
    payload.lifetime_granted_at = null;
    payload.founding_granted_at = null;
  }

  if (plan === "lifetime") {
    payload.lifetime_granted_at = nowIso;
    payload.current_period_start = null;
    payload.current_period_end = null;
    payload.trial_started_at = null;
    payload.trial_ends_at = null;
    payload.founding_granted_at = null;
  }

  const { error } = await supabaseAdmin
    .from("user_entitlements")
    .upsert(payload, { onConflict: "user_id" });

  if (error) throw error;

  return payload;
}

type AffiliatePlan = PaidPlan | "india_upi_monthly";

function normalizeAffiliatePlan(plan: string | undefined | null): AffiliatePlan | null {
  if (plan === "india_upi_monthly") return "india_upi_monthly";
  if (plan === "pro_monthly") return "pro_monthly";
  if (plan === "pro_yearly") return "pro_yearly";
  if (plan === "lifetime") return "lifetime";
  return null;
}

function stripeObjectId(value: any): string {
  if (typeof value === "string") return value;
  return String(value?.id || "").trim();
}

function stripeAmountToDecimal(amountMinor: unknown): number {
  const amount = Number(amountMinor);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount / 100 + Number.EPSILON) * 100) / 100;
}

async function resolveInvoicePlan(invoice: any, fallbackPlan: string | null | undefined): Promise<AffiliatePlan | null> {
  const directPlan = normalizeAffiliatePlan(
    invoice?.metadata?.plan ||
      invoice?.metadata?.entitlement_plan ||
      invoice?.parent?.subscription_details?.metadata?.plan,
  );
  if (directPlan) return directPlan;

  const subscriptionId =
    stripeObjectId(invoice?.subscription) ||
    stripeObjectId(invoice?.parent?.subscription_details?.subscription);

  if (subscriptionId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const subscriptionPlan = normalizeAffiliatePlan(
        subscription.metadata?.plan || subscription.metadata?.entitlement_plan,
      );
      if (subscriptionPlan) return subscriptionPlan;
    } catch (error) {
      console.error("Stripe webhook: affiliate subscription metadata lookup failed", {
        subscriptionId,
        invoiceId: invoice?.id,
        error,
      });
    }
  }

  return normalizeAffiliatePlan(fallbackPlan);
}

async function resolveInvoicePaymentIntentId(invoice: any): Promise<string> {
  const direct = stripeObjectId(invoice?.payment_intent);
  if (direct) return direct;

  const payments = Array.isArray(invoice?.payments?.data) ? invoice.payments.data : [];
  for (const payment of payments) {
    const candidate =
      stripeObjectId(payment?.payment?.payment_intent) ||
      stripeObjectId(payment?.payment_intent);
    if (candidate) return candidate;
  }

  try {
    const expanded = await stripe.invoices.retrieve(String(invoice.id || ""), {
      expand: ["payment_intent"],
    } as any);
    const expandedDirect = stripeObjectId((expanded as any)?.payment_intent);
    if (expandedDirect) return expandedDirect;

    const expandedPayments = Array.isArray((expanded as any)?.payments?.data)
      ? (expanded as any).payments.data
      : [];
    for (const payment of expandedPayments) {
      const candidate =
        stripeObjectId(payment?.payment?.payment_intent) ||
        stripeObjectId(payment?.payment_intent);
      if (candidate) return candidate;
    }
  } catch (error) {
    console.error("Stripe webhook: affiliate payment intent lookup failed", {
      invoiceId: invoice?.id,
      error,
    });
  }

  return "";
}

async function resolvePaidAmountUsd(params: {
  amountMinor: unknown;
  currency: string | null | undefined;
  paymentIntentId?: string;
}): Promise<number> {
  const currency = String(params.currency || "").trim().toLowerCase();
  const amountMinor = Number(params.amountMinor || 0);
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return 0;

  if (currency === "usd") return stripeAmountToDecimal(amountMinor);

  const paymentIntentId = String(params.paymentIntentId || "").trim();
  if (!paymentIntentId) {
    throw new Error(`affiliate_fx_payment_intent_missing:${currency}`);
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge.balance_transaction"],
  } as any);
  const charge = (paymentIntent as any)?.latest_charge;
  const balanceTransaction =
    charge && typeof charge !== "string" ? charge.balance_transaction : null;

  if (
    balanceTransaction &&
    typeof balanceTransaction !== "string" &&
    String(balanceTransaction.currency || "").toLowerCase() === "usd"
  ) {
    return stripeAmountToDecimal(Math.abs(Number(balanceTransaction.amount || 0)));
  }

  const chargeId = stripeObjectId(charge);
  if (chargeId) {
    const fullCharge = await stripe.charges.retrieve(chargeId, {
      expand: ["balance_transaction"],
    } as any);
    const chargeBalanceTransaction = (fullCharge as any)?.balance_transaction;

    if (
      chargeBalanceTransaction &&
      typeof chargeBalanceTransaction !== "string" &&
      String(chargeBalanceTransaction.currency || "").toLowerCase() === "usd"
    ) {
      return stripeAmountToDecimal(
        Math.abs(Number(chargeBalanceTransaction.amount || 0)),
      );
    }

    const balanceTransactionId = stripeObjectId(chargeBalanceTransaction);
    if (balanceTransactionId) {
      const transaction = await stripe.balanceTransactions.retrieve(balanceTransactionId);
      if (String(transaction.currency || "").toLowerCase() === "usd") {
        return stripeAmountToDecimal(Math.abs(Number(transaction.amount || 0)));
      }
    }
  }

  throw new Error(`affiliate_fx_usd_settlement_missing:${currency}`);
}

async function activePartnerProfile(referrerUserId: string) {
  const { data, error } = await supabaseAdmin
    .from("partner_profiles")
    .select("status, tier")
    .eq("user_id", referrerUserId)
    .maybeSingle();

  if (error) throw error;

  const status = String(data?.status || "").trim().toLowerCase();
  if (!["active", "approved"].includes(status)) return null;
  return data;
}

async function rewardReferrerForPaidPayment(params: {
  referredUserId: string;
  sourcePaymentKey: string;
  plan: AffiliatePlan;
  amountUsd: number;
  paidAt: string;
  providerInvoiceRef?: string;
  providerPaymentRef?: string;
}) {
  const {
    referredUserId,
    sourcePaymentKey,
    plan,
    amountUsd,
    paidAt,
    providerInvoiceRef,
    providerPaymentRef,
  } = params;

  if (!hasSuccessfulPaidAmount(amountUsd)) return;

  const { data: referral, error: referralError } = await supabaseAdmin
    .from("referrals")
    .select(
      "id, referrer_user_id, referred_user_id, status, first_paid_at, affiliate_terms_version",
    )
    .eq("referred_user_id", referredUserId)
    .maybeSingle();

  if (referralError) throw referralError;
  if (!referral?.id || !referral?.referrer_user_id) return;

  const termsVersion = String(
    referral.affiliate_terms_version || LEGACY_AFFILIATE_TERMS_VERSION,
  );

  if (termsVersion === LEGACY_AFFILIATE_TERMS_VERSION) {
    const nowIso = new Date().toISOString();
    const { error: legacyInsertError } = await supabaseAdmin
      .from("reward_ledger")
      .insert({
        user_id: referral.referrer_user_id,
        related_user_id: referredUserId,
        referral_id: referral.id,
        type: "first_payment_bonus",
        amount_usd: 5,
        currency: "usd",
        status: "available",
        available_at: nowIso,
        created_at: nowIso,
        source_payment_key: sourcePaymentKey,
        payment_provider: "stripe",
        provider_invoice_ref: providerInvoiceRef || null,
        provider_payment_ref: providerPaymentRef || null,
        gross_payment_usd: amountUsd,
        commission_rate: null,
      });

    if (legacyInsertError && legacyInsertError.code !== "23505") {
      throw legacyInsertError;
    }

    await supabaseAdmin
      .from("referrals")
      .update({
        status: "paid",
        first_paid_at: referral.first_paid_at || paidAt,
      })
      .eq("id", referral.id);

    return;
  }

  if (termsVersion !== AFFILIATE_TERMS_VERSION) return;
  if (!(await activePartnerProfile(referral.referrer_user_id))) return;

  const firstPaidAt = String(referral.first_paid_at || paidAt);
  if (!isWithinRevenueShareWindow(firstPaidAt, paidAt)) return;

  const { data: rewardRows, error: rewardRowsError } = await supabaseAdmin
    .from("reward_ledger")
    .select("amount_usd, type")
    .eq("referral_id", referral.id)
    .in("type", ["partner_revenue_share", "partner_revenue_share_reversal"]);

  if (rewardRowsError) throw rewardRowsError;

  const alreadyEarnedUsd = (rewardRows || []).reduce(
    (sum: number, row: any) => sum + Number(row.amount_usd || 0),
    0,
  );

  const commissionUsd = calculatePartnerCommission({
    plan,
    amountUsd,
    alreadyEarnedUsd,
  });

  if (commissionUsd <= 0) return;

  const nowIso = new Date().toISOString();
  const { error: rewardInsertError } = await supabaseAdmin
    .from("reward_ledger")
    .insert({
      user_id: referral.referrer_user_id,
      related_user_id: referredUserId,
      referral_id: referral.id,
      type: "partner_revenue_share",
      amount_usd: commissionUsd,
      currency: "usd",
      status: "available",
      available_at: nowIso,
      created_at: nowIso,
      source_payment_key: sourcePaymentKey,
      payment_provider: "stripe",
      provider_invoice_ref: providerInvoiceRef || null,
      provider_payment_ref: providerPaymentRef || null,
      gross_payment_usd: amountUsd,
      commission_rate: 0.5,
    });

  if (rewardInsertError) {
    if (rewardInsertError.code === "23505") return;
    throw rewardInsertError;
  }

  await supabaseAdmin
    .from("referrals")
    .update({
      status: "paid",
      first_paid_at: referral.first_paid_at || paidAt,
    })
    .eq("id", referral.id);

  console.log("Stripe webhook affiliate revenue share created", {
    referredUserId,
    referrerUserId: referral.referrer_user_id,
    referralId: referral.id,
    sourcePaymentKey,
    plan,
    amountUsd,
    commissionUsd,
    firstPaidAt,
  });
}

async function reversePartnerCommission(params: {
  sourcePaymentKey: string;
  paymentIntentId?: string;
  chargeId?: string;
  grossAmountMinor: number;
  reversedAmountMinor: number;
}) {
  const paymentIntentId = String(params.paymentIntentId || "").trim();
  const chargeId = String(params.chargeId || "").trim();
  if (!paymentIntentId && !chargeId) return;
  if (params.grossAmountMinor <= 0 || params.reversedAmountMinor <= 0) return;

  let query = supabaseAdmin
    .from("reward_ledger")
    .select("id, user_id, related_user_id, referral_id, amount_usd, provider_payment_ref")
    .eq("type", "partner_revenue_share");

  if (paymentIntentId && chargeId) {
    query = query.in("provider_payment_ref", [paymentIntentId, chargeId]);
  } else {
    query = query.eq("provider_payment_ref", paymentIntentId || chargeId);
  }

  const { data: originals, error: originalsError } = await query;
  if (originalsError) throw originalsError;

  for (const original of originals || []) {
    const { data: reversals, error: reversalsError } = await supabaseAdmin
      .from("reward_ledger")
      .select("amount_usd")
      .eq("reversal_of_reward_id", original.id)
      .eq("type", "partner_revenue_share_reversal");

    if (reversalsError) throw reversalsError;

    const alreadyReversedUsd = Math.abs(
      (reversals || []).reduce(
        (sum: number, row: any) => sum + Math.min(0, Number(row.amount_usd || 0)),
        0,
      ),
    );

    const reversalUsd = calculateCommissionReversal({
      commissionAmountUsd: Number(original.amount_usd || 0),
      grossPaymentAmount: params.grossAmountMinor,
      refundedPaymentAmount: params.reversedAmountMinor,
      alreadyReversedUsd,
    });

    if (reversalUsd >= 0) continue;

    const nowIso = new Date().toISOString();
    const { error: reversalInsertError } = await supabaseAdmin
      .from("reward_ledger")
      .insert({
        user_id: original.user_id,
        related_user_id: original.related_user_id,
        referral_id: original.referral_id,
        type: "partner_revenue_share_reversal",
        amount_usd: reversalUsd,
        currency: "usd",
        status: "available",
        available_at: nowIso,
        created_at: nowIso,
        source_payment_key: `${params.sourcePaymentKey}:${original.id}`,
        payment_provider: "stripe",
        provider_payment_ref: paymentIntentId || chargeId,
        gross_payment_usd: null,
        commission_rate: 0.5,
        reversal_of_reward_id: original.id,
      });

    if (reversalInsertError && reversalInsertError.code !== "23505") {
      throw reversalInsertError;
    }
  }
}

async function markHostSupportPaymentAvailable(session: any) {
  const metadata = session.metadata || {};
  const supportPaymentId = String(metadata.supportPaymentId || "").trim();

  if (!supportPaymentId) {
    console.error("Stripe webhook: missing supportPaymentId for host support", {
      sessionId: session.id,
      metadata,
    });
    throw new Error("missing_support_payment_id");
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || "";

  const nowIso = new Date().toISOString();

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("host_support_payments")
    .select("id, status")
    .eq("id", supportPaymentId)
    .maybeSingle();

  if (existingError) throw existingError;

  if (!existing?.id) {
    console.error("Stripe webhook: host support payment row not found", {
      sessionId: session.id,
      supportPaymentId,
      metadata,
    });
    throw new Error("host_support_payment_not_found");
  }

  if (existing.status === "available" || existing.status === "paid_out") {
    console.log("Stripe webhook: host support already processed", {
      sessionId: session.id,
      supportPaymentId,
      status: existing.status,
    });
    return;
  }

  const { error: updateError } = await supabaseAdmin
    .from("host_support_payments")
    .update({
      status: "available",
      stripe_payment_intent_id: paymentIntentId || null,
      available_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", supportPaymentId);

  if (updateError) throw updateError;

  console.log("Stripe webhook host support marked available", {
    sessionId: session.id,
    supportPaymentId,
    paymentIntentId,
    hostUserId: metadata.hostUserId,
    supporterUserId: metadata.supporterUserId,
    grossAmountUsd: metadata.grossAmountUsd,
    hostAmountUsd: metadata.hostAmountUsd,
  });
}

async function enqueueStripeLifecycleEvent(params: {
  userId: string;
  eventType: string;
  idempotencyKey: string;
  properties?: Record<string, unknown>;
}) {
  try {
    const { data } = await supabaseAdmin.auth.admin.getUserById(params.userId);
    const email = String(data?.user?.email || "").trim();
    if (!email) return;
    await supabaseAdmin.rpc("enqueue_sender_event", {
      p_user_id: params.userId,
      p_email: email,
      p_event_type: params.eventType,
      p_properties: {
        user_id: params.userId,
        first_name: String(data?.user?.user_metadata?.full_name || email || "Friend").split(" ")[0],
        timezone: data?.user?.user_metadata?.timezone || "UTC",
        upgrade_url: `${process.env.APP_URL || "https://mysession.club"}/pricing`,
        ...(params.properties || {}),
      },
      p_idempotency_key: params.idempotencyKey,
    });
  } catch (error) {
    console.error("Stripe lifecycle event enqueue failed", error);
  }
}

async function findEntitlementByStripeObject(object: any) {
  const subscriptionId =
    typeof object?.subscription === "string"
      ? object.subscription
      : object?.subscription?.id || (object?.object === "subscription" ? object.id : "");
  const customerId = typeof object?.customer === "string" ? object.customer : object?.customer?.id || "";
  let query = supabaseAdmin
    .from("user_entitlements")
    .select("user_id,plan,status,stripe_subscription_id,stripe_customer_id");
  if (subscriptionId) query = query.eq("stripe_subscription_id", subscriptionId);
  else if (customerId) query = query.eq("stripe_customer_id", customerId);
  else return null;
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const signature = req.headers["stripe-signature"];

  if (!signature || typeof signature !== "string") {
    return res.status(400).send("Missing stripe-signature header");
  }

  try {
    const rawBody = await readRawBody(req);

    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as any;
      const checkoutKind = String(session.metadata?.checkout_kind || session.metadata?.kind || "").trim();

      if (checkoutKind === "host_support") {
        await markHostSupportPaymentAvailable(session);
        return res.status(200).json({ received: true, kind: "host_support" });
      }

      const rawMetadataPlan = session.metadata?.entitlement_plan || session.metadata?.plan;
      const metadataPlan = normalizePaidPlan(rawMetadataPlan);
      const metadataUserId = session.metadata?.supabase_user_id || session.client_reference_id || "";

      if (!metadataPlan) {
        console.error("Stripe webhook: missing or invalid metadata plan", {
          sessionId: session.id,
          rawMetadataPlan,
          metadata: session.metadata,
        });
        return res.status(400).send("Missing or invalid metadata plan");
      }

      if (!metadataUserId) {
        console.error("Stripe webhook: missing user id metadata", {
          sessionId: session.id,
          clientReferenceId: session.client_reference_id,
          metadata: session.metadata,
        });
        return res.status(400).send("Missing user id metadata");
      }

      const stripeCustomerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id || "";

      const stripeSubscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id || "";

      const payload = await upsertEntitlement({
        userId: metadataUserId,
        plan: metadataPlan,
        source: "stripe_webhook",
        stripeCustomerId,
        stripeSubscriptionId,
      });

      if (
        metadataPlan === "lifetime" &&
        String(session.payment_status || "").toLowerCase() === "paid" &&
        Number(session.amount_total || 0) > 0
      ) {
        const paidAt = new Date(Number(event.created || Math.floor(Date.now() / 1000)) * 1000).toISOString();
        const amountUsd = await resolvePaidAmountUsd({
          amountMinor: session.amount_total,
          currency: session.currency,
          paymentIntentId: stripeObjectId(session.payment_intent),
        });

        await rewardReferrerForPaidPayment({
          referredUserId: metadataUserId,
          sourcePaymentKey: `stripe:checkout:${session.id}`,
          plan: "lifetime",
          amountUsd,
          paidAt,
          providerPaymentRef: stripeObjectId(session.payment_intent) || session.id,
        });
      }

      await enqueueStripeLifecycleEvent({
        userId: metadataUserId,
        eventType: "subscription_started",
        idempotencyKey: `subscription_started:${session.id}`,
        properties: { plan: metadataPlan, stripe_checkout_session_id: session.id },
      });

      console.log("Stripe webhook entitlement updated", {
        sessionId: session.id,
        userId: metadataUserId,
        plan: metadataPlan,
        rawMetadataPlan,
        stripeCustomerId,
        stripeSubscriptionId,
        force_paywall: payload.force_paywall,
      });
    }

    if (event.type === "invoice.payment_failed" || event.type === "invoice.paid") {
      const invoice = event.data.object as any;
      const entitlement = await findEntitlementByStripeObject(invoice);
      if (entitlement?.user_id) {
        if (event.type === "invoice.paid" && Number(invoice.amount_paid || 0) > 0) {
          const paymentIntentId = await resolveInvoicePaymentIntentId(invoice);
          const affiliatePlan = await resolveInvoicePlan(invoice, entitlement.plan);
          const paidAtSeconds =
            Number(invoice?.status_transitions?.paid_at || 0) ||
            Number(event.created || Math.floor(Date.now() / 1000));
          const paidAt = new Date(paidAtSeconds * 1000).toISOString();

          if (affiliatePlan) {
            const amountUsd = await resolvePaidAmountUsd({
              amountMinor: invoice.amount_paid,
              currency: invoice.currency,
              paymentIntentId,
            });

            await rewardReferrerForPaidPayment({
              referredUserId: entitlement.user_id,
              sourcePaymentKey: `stripe:invoice:${invoice.id}`,
              plan: affiliatePlan,
              amountUsd,
              paidAt,
              providerInvoiceRef: String(invoice.id || ""),
              providerPaymentRef: paymentIntentId || String(invoice.id || ""),
            });
          }
        }

        await enqueueStripeLifecycleEvent({
          userId: entitlement.user_id,
          eventType: event.type === "invoice.payment_failed" ? "payment_failed" : "payment_recovered",
          idempotencyKey: `${event.type}:${invoice.id}`,
          properties: { plan: entitlement.plan || "free", invoice_id: invoice.id },
        });
      }
    }

    if (event.type === "charge.refunded") {
      const charge = event.data.object as any;
      await reversePartnerCommission({
        sourcePaymentKey: `stripe:refund:${charge.id}:${Number(charge.amount_refunded || 0)}`,
        paymentIntentId: stripeObjectId(charge.payment_intent),
        chargeId: String(charge.id || ""),
        grossAmountMinor: Number(charge.amount || 0),
        reversedAmountMinor: Number(charge.amount_refunded || 0),
      });
    }

    if (event.type === "charge.dispute.created") {
      const dispute = event.data.object as any;
      const chargeId = stripeObjectId(dispute.charge);
      let paymentIntentId = "";

      if (chargeId) {
        try {
          const charge = await stripe.charges.retrieve(chargeId);
          paymentIntentId = stripeObjectId((charge as any).payment_intent);
        } catch (error) {
          console.error("Stripe webhook: dispute charge lookup failed", {
            disputeId: dispute.id,
            chargeId,
            error,
          });
        }
      }

      await reversePartnerCommission({
        sourcePaymentKey: `stripe:dispute:${dispute.id}`,
        paymentIntentId,
        chargeId,
        grossAmountMinor: Number(dispute.amount || 0),
        reversedAmountMinor: Number(dispute.amount || 0),
      });
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as any;
      const entitlement = await findEntitlementByStripeObject(subscription);
      if (entitlement?.user_id) {
        await supabaseAdmin
          .from("user_entitlements")
          .update({ status: "cancelled", updated_at: new Date().toISOString() })
          .eq("user_id", entitlement.user_id);
        await enqueueStripeLifecycleEvent({
          userId: entitlement.user_id,
          eventType: "subscription_cancelled",
          idempotencyKey: `subscription_cancelled:${subscription.id}:${subscription.canceled_at || event.created}`,
          properties: {
            plan: "free",
            access_ends_at: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000).toISOString()
              : "",
          },
        });
      }
    }

    if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object as any;
      const previous = (event.data as any)?.previous_attributes || {};
      const cancellationChanged = Object.prototype.hasOwnProperty.call(
        previous,
        "cancel_at_period_end",
      );
      const entitlement = cancellationChanged
        ? await findEntitlementByStripeObject(subscription)
        : null;

      if (entitlement?.user_id && subscription.cancel_at_period_end === true) {
        await enqueueStripeLifecycleEvent({
          userId: entitlement.user_id,
          eventType: "subscription_cancelled",
          idempotencyKey: `subscription_cancelled:${event.id}`,
          properties: {
            plan: entitlement.plan || "free",
            access_ends_at: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000).toISOString()
              : "",
          },
        });
      }

      if (
        entitlement?.user_id &&
        previous.cancel_at_period_end === true &&
        subscription.cancel_at_period_end === false
      ) {
        await enqueueStripeLifecycleEvent({
          userId: entitlement.user_id,
          eventType: "subscription_reactivated",
          idempotencyKey: `subscription_reactivated:${event.id}`,
          properties: { plan: entitlement.plan || "free" },
        });
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Stripe webhook error", error);
    return res.status(400).send(`Webhook Error: ${(error as Error).message}`);
  }
}
