import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", {
            headers: corsHeaders,
        });
    }

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
        const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        const paymentsMode = Deno.env.get("PAYMENTS_MODE") || "test";
        const wiseQuickPayUrl = Deno.env.get("WISE_QUICK_PAY_URL") || "";

        if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
            return new Response(
                JSON.stringify({
                    error: "Missing required environment variables",
                }),
                {
                    status: 500,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                    },
                }
            );
        }

        console.log("PAYMENTS_MODE =", paymentsMode);

        const authHeader = req.headers.get("Authorization") || "";

        const userClient = createClient(supabaseUrl, supabaseAnonKey, {
            global: {
                headers: {
                    Authorization: authHeader,
                },
            },
        });

        const {
            data: { user },
            error: userError,
        } = await userClient.auth.getUser();

        if (userError || !user) {
            return new Response(
                JSON.stringify({
                    error: "Unauthorized",
                    details: userError?.message ?? null,
                }),
                {
                    status: 401,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                    },
                }
            );
        }

        const body = await req.json().catch(() => ({}));
        const planId = body.planId || "monthly_10";

        const admin = createClient(supabaseUrl, supabaseServiceRoleKey);

        const { data: plan, error: planError } = await admin
            .from("plans")
            .select("*")
            .eq("id", planId)
            .single();

        if (planError || !plan) {
            return new Response(
                JSON.stringify({
                    error: "Plan not found",
                    details: planError?.message ?? null,
                }),
                {
                    status: 404,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                    },
                }
            );
        }

        const paymentPayload = {
            user_id: user.id,
            plan_id: plan.id,
            provider: "wise",
            amount_usd: plan.price_usd,
            currency: "USD",
            status: paymentsMode === "test" ? "test_paid" : "pending",
            checkout_url: paymentsMode === "test" ? null : wiseQuickPayUrl,
            note: `MySession user: ${user.email ?? user.id}`,
        };

        const { data: payment, error: paymentError } = await admin
            .from("payments")
            .insert(paymentPayload)
            .select("*")
            .single();

        if (paymentError || !payment) {
            return new Response(
                JSON.stringify({
                    error: "Failed to create payment",
                    details: paymentError?.message ?? null,
                }),
                {
                    status: 500,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                    },
                }
            );
        }

        if (paymentsMode === "test") {
            const { error: activateError } = await admin.rpc(
                "activate_subscription_for_payment",
                {
                    p_payment_id: payment.id,
                }
            );

            if (activateError) {
                return new Response(
                    JSON.stringify({
                        error: "Failed to activate subscription",
                        details: activateError.message,
                    }),
                    {
                        status: 500,
                        headers: {
                            ...corsHeaders,
                            "Content-Type": "application/json",
                        },
                    }
                );
            }

            return new Response(
                JSON.stringify({
                    ok: true,
                    mode: "test",
                    paymentId: payment.id,
                    activated: true,
                }),
                {
                    status: 200,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                    },
                }
            );
        }

        return new Response(
            JSON.stringify({
                ok: true,
                mode: "live",
                paymentId: payment.id,
                checkoutUrl: wiseQuickPayUrl,
            }),
            {
                status: 200,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                },
            }
        );
    } catch (e) {
        console.error("Unexpected error in create-payment-session:", e);

        return new Response(
            JSON.stringify({
                error: "Unexpected error",
                details: e instanceof Error ? e.message : String(e),
            }),
            {
                status: 500,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                },
            }
        );
    }
});