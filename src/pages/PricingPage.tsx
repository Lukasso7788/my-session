import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PricingPlanCard } from "../components/PricingPlanCard";
import { supabase } from "../lib/supabase";
import { PRICING, formatUsd } from "../lib/billing";

type BillingCycle = "monthly" | "yearly";

export default function PricingPage() {
    const KOFI_URL = "https://ko-fi.com/mysession";

    const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
    const [checkingAuth, setCheckingAuth] = useState<boolean>(true);

    const [isUpgrading, setIsUpgrading] = useState<boolean>(false);
    const [isRequestingLifetime, setIsRequestingLifetime] = useState<boolean>(false);
    const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");

    const [statusMessage, setStatusMessage] = useState<string>("");
    const [errorMessage, setErrorMessage] = useState<string>("");

    // Пока это UI-счётчик от константы.
    // Позже можно заменить на публичный реальный counter из отдельной таблицы / view / edge function.
    const [lifetimeSlotsLeft] = useState<number>(PRICING.lifetimeSlotsTotal);

    const monthlyPrice = formatUsd(PRICING.monthlyUsd);
    const yearlyPrice = formatUsd(PRICING.yearlyUsd);
    const lifetimePrice = formatUsd(PRICING.lifetimeUsd);

    const proPrice = billingCycle === "monthly" ? monthlyPrice : yearlyPrice;
    const proSubtitle =
        billingCycle === "monthly"
            ? "Unlimited access to all session formats"
            : "Unlimited access to all session formats • billed yearly";

    const proBadge =
        billingCycle === "yearly"
            ? "Save 20%"
            : "Most flexible";

    const proFootnote =
        billingCycle === "monthly"
            ? "7-day free trial • cancel anytime"
            : "7-day free trial • billed yearly";

    const lifetimeBadge = useMemo(() => {
        if (lifetimeSlotsLeft <= 0) return "Sold out";
        return `Only ${lifetimeSlotsLeft} left`;
    }, [lifetimeSlotsLeft]);

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
        async (planCode: "pro_monthly" | "pro_yearly" | "lifetime") => {
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
                note:
                    planCode === "lifetime"
                        ? "Lifetime access request from pricing page."
                        : "Invoice link missing on pricing page.",
            });

            if (error) {
                throw error;
            }
        },
        []
    );

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
            const checkoutUrl =
                billingCycle === "monthly"
                    ? profile?.pro_monthly_invoice_url
                    : profile?.pro_yearly_invoice_url;

            if (checkoutUrl) {
                setStatusMessage("Redirecting you to secure payment...");
                window.location.href = checkoutUrl;
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
    }, [billingCycle, checkingAuth, createCheckoutRequest, isLoggedIn]);

    const handleLifetimeRequest = useCallback(async () => {
        setErrorMessage("");
        setStatusMessage("");

        if (lifetimeSlotsLeft <= 0) {
            setErrorMessage("Lifetime access is currently sold out.");
            return;
        }

        if (checkingAuth) {
            setErrorMessage("Still checking your account. Try again in a second.");
            return;
        }

        if (!isLoggedIn) {
            window.location.href = "/login?redirect=/pricing";
            return;
        }

        setIsRequestingLifetime(true);

        try {
            await createCheckoutRequest("lifetime");
            setStatusMessage(
                "Your lifetime access request has been saved. We’ll prepare your lifetime payment link manually."
            );
        } catch (err) {
            console.error("Unexpected lifetime request error:", err);
            setErrorMessage("Unexpected error while requesting lifetime access.");
        } finally {
            setIsRequestingLifetime(false);
        }
    }, [checkingAuth, createCheckoutRequest, isLoggedIn, lifetimeSlotsLeft]);

    return (
        <div className="min-h-[calc(100vh-80px)] bg-transparent text-[#0B1220]">
            <main className="mx-auto w-full max-w-[1180px] px-4 py-10 sm:px-6">
                <div className="text-center">
                    <h1 className="text-[34px] font-semibold tracking-[-0.03em] sm:text-[44px]">
                        Pricing that stays simple
                    </h1>

                    <p className="mt-3 text-[15px] text-black/60">
                        Start free, build momentum, and upgrade when you want unlimited access.
                    </p>

                    <p className="mt-2 text-[14px] text-black/50">
                        Monthly and yearly Pro plans include a 7-day free trial.
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

                <div className="mt-10 grid gap-6 lg:grid-cols-3">
                    <PricingPlanCard
                        title="Free"
                        price="$0"
                        subtitle="For getting started with MySession"
                        badge="Starter"
                        highlights={[
                            `Up to ${PRICING.freeSessionsPerWeek} sessions per week`,
                            `Up to ${Math.round(PRICING.freeMinutesPerWeek / 60)} hours total per week`,
                            "Join and host sessions",
                            "Core room features, chat, reactions, intentions",
                            "Upgrade later when you want unlimited access",
                        ]}
                        ctaLabel="Start free"
                        ctaVariant="secondary"
                        footnote="No credit card"
                        onCta={handleStartFree}
                    />

                    <PricingPlanCard
                        title="Pro"
                        price={proPrice}
                        subtitle={proSubtitle}
                        badge={proBadge}
                        highlights={[
                            "Unlimited sessions per week",
                            "Unlimited hours",
                            "Join and host without limits",
                            "All formats and future premium room features",
                            billingCycle === "yearly"
                                ? `Yearly plan: ${formatUsd(PRICING.monthlyUsd * 12)} → ${yearlyPrice}`
                                : "Best for flexibility",
                        ]}
                        ctaLabel={
                            checkingAuth
                                ? "Checking account..."
                                : isUpgrading
                                    ? "Opening payment..."
                                    : billingCycle === "monthly"
                                        ? "Start Pro Monthly"
                                        : "Start Pro Yearly"
                        }
                        ctaVariant="primary"
                        footnote={proFootnote}
                        onCta={handleUpgradeToPro}
                    />

                    <PricingPlanCard
                        title="Lifetime"
                        price={lifetimePrice}
                        subtitle="Early supporter lifetime access"
                        badge={lifetimeBadge}
                        highlights={[
                            "Unlimited lifetime access",
                            "One-time payment",
                            "Early supporter deal",
                            `Only ${PRICING.lifetimeSlotsTotal} total spots in this drop`,
                            "Handled manually for now",
                        ]}
                        ctaLabel={
                            lifetimeSlotsLeft <= 0
                                ? "Sold out"
                                : checkingAuth
                                    ? "Checking account..."
                                    : isRequestingLifetime
                                        ? "Saving request..."
                                        : "Request Lifetime Access"
                        }
                        ctaVariant="secondary"
                        footnote={
                            lifetimeSlotsLeft <= 0
                                ? "This drop is sold out"
                                : `${lifetimeSlotsLeft} of ${PRICING.lifetimeSlotsTotal} available right now`
                        }
                        onCta={handleLifetimeRequest}
                    />
                </div>

                {(statusMessage || errorMessage) && (
                    <div className="mt-8 rounded-[24px] border border-black/10 bg-white p-5">
                        <div className="text-sm font-medium">Billing status</div>

                        <p className="mt-2 text-sm text-black/60">
                            If your personal invoice link is ready, the Pro button will open it
                            directly. If not, we’ll save a checkout request and prepare one for
                            you manually.
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

                <div className="mt-10 rounded-2xl border border-black/10 bg-white/85 p-6 shadow-sm sm:p-8">
                    <h2 className="text-[18px] font-semibold tracking-[-0.01em]">
                        Payment and service information
                    </h2>

                    <div className="mt-6 grid gap-6 text-[14px] leading-relaxed text-black/80 md:grid-cols-2">
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
                                Refund requests are reviewed individually. Refunds may be available
                                in cases such as duplicate payment, technical billing errors, or
                                failure to provide the paid service. See the full{" "}
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
                                className="rounded-xl border border-black/10 bg-white px-3 py-2 transition hover:bg-black/[0.03]"
                            >
                                Terms and Conditions
                            </Link>
                            <Link
                                to="/refund-policy"
                                className="rounded-xl border border-black/10 bg-white px-3 py-2 transition hover:bg-black/[0.03]"
                            >
                                Refund Policy
                            </Link>
                            <Link
                                to="/privacy"
                                className="rounded-xl border border-black/10 bg-white px-3 py-2 transition hover:bg-black/[0.03]"
                            >
                                Privacy Policy
                            </Link>
                            <Link
                                to="/contact"
                                className="rounded-xl border border-black/10 bg-white px-3 py-2 transition hover:bg-black/[0.03]"
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
                            <div className="text-sm font-medium">What does Free include?</div>
                            <p className="mt-1 text-sm text-black/60">
                                Free includes up to {PRICING.freeSessionsPerWeek} sessions per week
                                and up to {Math.round(PRICING.freeMinutesPerWeek / 60)} hours total
                                per week.
                            </p>
                        </div>

                        <div>
                            <div className="text-sm font-medium">
                                Do paid plans include a trial?
                            </div>
                            <p className="mt-1 text-sm text-black/60">
                                Yes. Monthly and yearly Pro plans include a {PRICING.trialDays}-day
                                free trial.
                            </p>
                        </div>

                        <div>
                            <div className="text-sm font-medium">
                                How does Pro billing work right now?
                            </div>
                            <p className="mt-1 text-sm text-black/60">
                                Each account can have its own personal payment link. If your link is
                                ready, clicking Pro will open it directly. If not, we’ll save a
                                checkout request.
                            </p>
                        </div>

                        <div>
                            <div className="text-sm font-medium">
                                How does Lifetime work right now?
                            </div>
                            <p className="mt-1 text-sm text-black/60">
                                Lifetime access is a limited early supporter offer. Right now it is
                                handled manually after you submit a request.
                            </p>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}