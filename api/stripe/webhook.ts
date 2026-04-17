import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

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
        if (Buffer.isBuffer(chunk)) {
            chunks.push(chunk);
        } else {
            chunks.push(Buffer.from(chunk));
        }
    }

    return Buffer.concat(chunks);
}

async function upsertEntitlement(params: {
    userId: string;
    plan: PaidPlan;
    source: string;
}) {
    const { userId, plan, source } = params;

    const nowIso = new Date().toISOString();

    const payload: Record<string, unknown> = {
        user_id: userId,
        plan,
        status: "active",
        source,
        notes: `Activated via Stripe webhook at ${nowIso}`,
    };

    if (plan === "pro_monthly") {
        const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        payload.current_period_start = nowIso;
        payload.current_period_end = periodEnd;
        payload.trial_started_at = null;
        payload.trial_ends_at = null;
        payload.lifetime_granted_at = null;
        payload.founding_granted_at = null;
    } else if (plan === "pro_yearly") {
        const periodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

        payload.current_period_start = nowIso;
        payload.current_period_end = periodEnd;
        payload.trial_started_at = null;
        payload.trial_ends_at = null;
        payload.lifetime_granted_at = null;
        payload.founding_granted_at = null;
    } else if (plan === "lifetime") {
        payload.lifetime_granted_at = nowIso;
        payload.current_period_start = null;
        payload.current_period_end = null;
        payload.trial_started_at = null;
        payload.trial_ends_at = null;
    }

    const { error } = await supabaseAdmin
        .from("user_entitlements")
        .upsert(payload, { onConflict: "user_id" });

    if (error) {
        throw error;
    }
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
            const session = event.data.object as Stripe.Checkout.Session;

            const metadataPlan = session.metadata?.plan;
            const metadataUserId =
                session.metadata?.supabase_user_id || session.client_reference_id || "";

            if (!metadataPlan) {
                console.error("Stripe webhook: missing metadata.plan");
                return res.status(400).send("Missing metadata.plan");
            }

            if (!metadataUserId) {
                console.error("Stripe webhook: missing metadata.supabase_user_id/client_reference_id");
                return res.status(400).send("Missing user id metadata");
            }

            if (
                metadataPlan !== "pro_monthly" &&
                metadataPlan !== "pro_yearly" &&
                metadataPlan !== "lifetime"
            ) {
                console.error("Stripe webhook: invalid metadata.plan", metadataPlan);
                return res.status(400).send("Invalid metadata.plan");
            }

            await upsertEntitlement({
                userId: metadataUserId,
                plan: metadataPlan,
                source: "stripe_webhook",
            });

            console.log("Stripe webhook entitlement updated", {
                userId: metadataUserId,
                plan: metadataPlan,
            });
        }

        return res.status(200).json({ received: true });
    } catch (error) {
        console.error("Stripe webhook error", error);
        return res.status(400).send(`Webhook Error: ${(error as Error).message}`);
    }
}