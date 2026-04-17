import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PricingPlanCard } from "../components/PricingPlanCard";
import { supabase } from "../lib/supabase";

type BillingCycle = "monthly" | "yearly";

export default function PricingPage() {
    const KOFI_URL = "https://ko-fi.com/mysession";

    // Stripe Payment Links
    // Put these in your Vite env:
    // VITE_STRIPE_PRO_MONTHLY_URL=https://buy.stripe.com/...
    // VITE_STRIPE_PRO_YEARLY_URL=https://buy.stripe.com/...
    const STRIPE_PRO_MONTHLY_URL = import.meta.env.VITE_STRIPE_PRO_MONTHLY_URL?.trim() || "";
    const STRIPE_PRO_YEARLY_URL = import.meta.env.VITE_STRIPE_PRO_YEARLY_URL?.trim() || "";

    const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
    const [checkingAuth, setCheckingAuth] = useState<boolean>(true);

    const [isUpgrading, setIsUpgrading] = useState<boolean>(false);
    const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");

    const [statusMessage, setStatusMessage] = useState<string>("");
    const [errorMessage, setErrorMessage] = useState<string>("");

    useEffect(() => {
        let isMounted = true;

        async function loadAuth() {
            try {
                const {
                    data: { user },
                } = await supabase.auth.getUser();

                if (!isMounted) return;
                setIsLoggedIn(Boolean(user));
            } catch (err) {
                console.error("Failed to check auth:", err);
                if (!isMounted) return;
                setIsLoggedIn(false);
            } finally {
                if (!isMounted) return;
                setCheckingAuth(false);
            }
        }

        void loadAuth();

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setIsLoggedIn(Boolean(session?.user));
            setCheckingAuth(false);
        });

        return () => {
            isMounted = false;
            subscription.unsubscribe();
        };
    }, []);

    const handleStartFree = useCallback(() => {
        window.location.href = "/sessions";
    }, []);

    const createCheckoutRequest = useCallback(
        async (planCode: "pro_monthly" | "pro_yearly") => {
            const {
                data: { user },
                error: userError,
            } = await supabase.auth.getUser();

            if (userError || !user) {
                throw new Error("You must be logged in to request a checkout link.");
            }

            const { error } = await supabase.from("checkout_requests").insert({
                user_id: user.id,
                plan_code: planCode,
                source: "pricing_page",
                note: "Stripe payment link missing on pricing page.",
            });

            if (error) {
                throw error;
            }
        },
        []
    );

    const addPrefilledEmail = useCallback((baseUrl: string, email?: string | null) => {
        if (!email) return baseUrl;

        try {
            const url = new URL(baseUrl);
            url.searchParams.set("prefilled_email", email);
            return url.toString();
        } catch (err) {
            console.error("Failed to append prefilled email:", err);
            return baseUrl;
        }
    }, []);

    const handleUpgradeToPro = useCallback(async () => {
        setErrorMessage("");
        setStatusMessage("");

        if (checkingAuth) {
            setErrorMessage("Still checking your account. Try again in a second.");
            return;
        }

        if (!isLoggedIn) {
            window.location.href = "/login?redirect=/pricing";
            return;
        }

        setIsUpgrading(true);

        try {
            const {
                data: { user },
                error: userError,
            } = await supabase.auth.getUser();

            if (userError || !user) {
                setErrorMessage("Could not verify your account. Please log in again.");
                return;
            }

            const { data: profile, error: profileError } = await supabase
                .from("profiles")
                .select(
                    "pro_monthly_invoice_url, pro_yearly_invoice_url, plan_code, plan_status, pro_expires_at"
                )
                .eq("id", user.id)
                .single();

            if (profileError) {
                console.error("Failed to load billing links:", profileError);
                setErrorMessage("Could not load your billing link.");
                return;
            }

            const isAlreadyActive =
                profile?.plan_status === "active" &&
                (profile?.plan_code === "pro_monthly" || profile?.plan_code === "pro_yearly");

            if (isAlreadyActive) {
                setStatusMessage("Your Pro plan is already active.");
                return;
            }

            const planCode = billingCycle === "monthly" ? "pro_monthly" : "pro_yearly";

            const legacyProfileCheckoutUrl =
                billingCycle === "monthly"
                    ? profile?.pro_monthly_invoice_url
                    : profile?.pro_yearly_invoice_url;

            const envStripeCheckoutUrl =
                billingCycle === "monthly" ? STRIPE_PRO_MONTHLY_URL : STRIPE_PRO_YEARLY_URL;

            const finalCheckoutUrl = envStripeCheckoutUrl
                ? addPrefilledEmail(envStripeCheckoutUrl, user.email)
                : legacyProfileCheckoutUrl || "";

            if (finalCheckoutUrl) {
                setStatusMessage("Redirecting you to secure payment...");
                window.location.href = finalCheckoutUrl;
                return;
            }

            await createCheckoutRequest(planCode);

            setStatusMessage(
                billingCycle === "monthly"
                    ? "Your monthly checkout request has been sent. We’re preparing your payment link."
                    : "Your yearly checkout request has been sent. We’re preparing your payment link."
            );
        } catch (err) {
            console.error("Unexpected upgrade error:", err);
            setErrorMessage("Unexpected error while starting the upgrade.");
        } finally {
            setIsUpgrading(false);
        }
    }, [
        STRIPE_PRO_MONTHLY_URL,
        STRIPE_PRO_YEARLY_URL,
        addPrefilledEmail,
        billingCycle,
        checkingAuth,
        createCheckoutRequest,
        isLoggedIn,
    ]);

    return (
        <div className="min-h-[calc(100vh-80px)] bg-transparent text-[#0B1220]">
            <main className="mx-auto w-full max-w-[1100px] px-4 sm:px-6 py-10">
                <div className="text-center">
                    <h1 className="text-[34px] sm:text-[44px] font-semibold tracking-[-0.03em]">
                        Pricing that stays simple
                    </h1>
                    <p className="mt-3 text-[15px] text-black/60">
                        Join focus sessions for accountability. Upgrade when you want unlimited
                        access.
                    </p>
                </div>

                <div className="mx-auto mt-8 w-full max-w-[560px] rounded-full border border-black/10 bg-white p-1">
                    <div className="grid grid-cols-2 gap-1">
                        <button
                            type="button"
                            className={`h-10 rounded-full text-sm font-medium transition ${billingCycle === "monthly"
                                    ? "bg-black text-white"
                                    : "text-black/70 hover:bg-black/5"
                                }`}
                            onClick={() => setBillingCycle("monthly")}
                        >
                            Monthly
                        </button>
                        <button
                            type="button"
                            className={`h-10 rounded-full text-sm font-medium transition ${billingCycle === "yearly"
                                    ? "bg-black text-white"
                                    : "text-black/70 hover:bg-black/5"
                                }`}
                            onClick={() => setBillingCycle("yearly")}
                        >
                            Yearly (save 20%)
                        </button>
                    </div>
                </div>

                <div className="mt-10 grid gap-6 md:grid-cols-2">
                    <PricingPlanCard
                        title="Free"
                        price="$0"
                        subtitle="For trying MySession"
                        badge="Starter"
                        highlights={[
                            "Join up to 3 group sessions per week",
                            "Up to 2 hours per session",
                            "Basic chat + reactions",
                            "No hosting / creating sessions",
                            "Infinite rooms & Body tripling: Pro only",
                        ]}
                        ctaLabel="Start free"
                        ctaVariant="secondary"
                        footnote="No credit card"
                        onCta={handleStartFree}
                    />

                    <PricingPlanCard
                        title="Pro"
                        price={billingCycle === "monthly" ? "$10" : "$96"}
                        subtitle={
                            billingCycle === "monthly"
                                ? "Full access to all formats"
                                : "Full access to all formats • billed yearly"
                        }
                        badge={billingCycle === "yearly" ? "Save 20%" : "Best value"}
                        highlights={[
                            "Unlimited sessions per week",
                            "All formats: Group sessions, Infinite rooms, Body tripling",
                            "Create & host sessions",
                            "Priority access to new features (AI layer, backgrounds)",
                            billingCycle === "yearly"
                                ? "Yearly plan: $120 → $96 with 20% discount"
                                : "Support the project ❤️",
                        ]}
                        ctaLabel={
                            checkingAuth
                                ? "Checking account..."
                                : isUpgrading
                                    ? "Opening payment..."
                                    : billingCycle === "monthly"
                                        ? "Upgrade to Pro Monthly"
                                        : "Upgrade to Pro Yearly"
                        }
                        ctaVariant="primary"
                        footnote={
                            billingCycle === "monthly"
                                ? "Cancel anytime"
                                : "Pay $96/year instead of $120"
                        }
                        onCta={handleUpgradeToPro}
                    />
                </div>

                {(statusMessage || errorMessage) && (
                    <div className="mt-8 rounded-[24px] border border-black/10 bg-white p-5">
                        <div className="text-sm font-medium">Billing status</div>

                        <p className="mt-2 text-sm text-black/60">
                            If your Stripe payment link is ready, the Pro button will open it
                            directly. If not, we’ll save a checkout request and prepare one for
                            you.
                        </p>

                        {statusMessage ? (
                            <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                                {statusMessage}
                            </div>
                        ) : null}

                        {errorMessage ? (
                            <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                {errorMessage}
                            </div>
                        ) : null}

                        {!isLoggedIn && !checkingAuth ? (
                            <div className="mt-3 text-sm text-black/60">
                                You’ll be asked to log in before starting the upgrade flow.
                            </div>
                        ) : null}
                    </div>
                )}

                <div className="mt-8 text-center text-sm text-black/60">
                    Prefer supporting via Ko-fi?{" "}
                    <a
                        href={KOFI_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-black underline underline-offset-4 hover:opacity-80"
                    >
                        Open MySession on Ko-fi
                    </a>
                    .
                </div>

                <div className="mt-10 rounded-2xl border border-black/10 bg-white/85 shadow-sm p-6 sm:p-8">
                    <h2 className="text-[18px] font-semibold tracking-[-0.01em]">
                        Payment and service information
                    </h2>

                    <div className="mt-6 grid gap-6 md:grid-cols-2 text-[14px] leading-relaxed text-black/80">
                        <section>
                            <h3 className="text-[16px] font-semibold text-black/85">
                                Payment methods
                            </h3>
                            <p className="mt-2">
                                Payments for paid plans are processed online. Available payment
                                methods are shown during checkout and may include bank card
                                payments via supported payment providers.
                            </p>
                        </section>

                        <section>
                            <h3 className="text-[16px] font-semibold text-black/85">
                                Delivery of the service
                            </h3>
                            <p className="mt-2">
                                MySession is a digital online service. No physical delivery applies.
                                Access to paid features is provided through your account and the
                                MySession website after successful payment.
                            </p>
                        </section>

                        <section>
                            <h3 className="text-[16px] font-semibold text-black/85">
                                Subscription and cancellation
                            </h3>
                            <p className="mt-2">
                                Paid access may be offered as a recurring subscription or another
                                digital plan format shown at checkout. You can request cancellation
                                by contacting support. Cancellation stops future charges, while the
                                current paid period remains available unless a refund is approved.
                            </p>
                        </section>

                        <section>
                            <h3 className="text-[16px] font-semibold text-black/85">
                                Refunds
                            </h3>
                            <p className="mt-2">
                                Refund requests are handled according to the{" "}
                                <Link
                                    to="/refund-policy"
                                    className="underline underline-offset-2 hover:opacity-80"
                                >
                                    Refund Policy
                                </Link>
                                .
                            </p>
                        </section>
                    </div>

                    <div className="mt-6 rounded-2xl border border-black/10 bg-black/[0.03] p-4">
                        <div className="text-sm font-medium">Legal pages</div>
                        <div className="mt-3 flex flex-wrap gap-3 text-sm">
                            <Link
                                to="/terms"
                                className="rounded-xl border border-black/10 bg-white px-3 py-2 hover:bg-black/[0.03] transition"
                            >
                                Terms and Conditions
                            </Link>
                            <Link
                                to="/refund-policy"
                                className="rounded-xl border border-black/10 bg-white px-3 py-2 hover:bg-black/[0.03] transition"
                            >
                                Refund Policy
                            </Link>
                            <Link
                                to="/privacy"
                                className="rounded-xl border border-black/10 bg-white px-3 py-2 hover:bg-black/[0.03] transition"
                            >
                                Privacy Policy
                            </Link>
                            <Link
                                to="/contact"
                                className="rounded-xl border border-black/10 bg-white px-3 py-2 hover:bg-black/[0.03] transition"
                            >
                                Contact information
                            </Link>
                        </div>
                    </div>
                </div>

                <div className="mt-10 rounded-[28px] border border-black/10 bg-white p-6">
                    <h2 className="text-[18px] font-semibold tracking-[-0.01em]">FAQ</h2>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <div>
                            <div className="text-sm font-medium">Why weekly limits on Free?</div>
                            <p className="mt-1 text-sm text-black/60">
                                Video calls are expensive to run. Limits keep Free sustainable while
                                Pro supports the infrastructure.
                            </p>
                        </div>

                        <div>
                            <div className="text-sm font-medium">
                                How does Pro billing work right now?
                            </div>
                            <p className="mt-1 text-sm text-black/60">
                                If your Stripe payment link is ready, clicking Pro will open it
                                directly. If not, we’ll save a checkout request.
                            </p>
                        </div>

                        <div>
                            <div className="text-sm font-medium">
                                What if my payment link is not ready yet?
                            </div>
                            <p className="mt-1 text-sm text-black/60">
                                We’ll save a checkout request for your account so your payment link
                                can be prepared manually.
                            </p>
                        </div>

                        <div>
                            <div className="text-sm font-medium">
                                How should this be tested?
                            </div>
                            <p className="mt-1 text-sm text-black/60">
                                First test the MySession flow with live Stripe payment links. Then
                                run one real low-risk payment test to confirm the live payment flow.
                            </p>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}