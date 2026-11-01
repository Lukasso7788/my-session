import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PricingPlanCard } from "../components/PricingPlanCard";
import { supabase } from "../lib/supabase";

type BillingCycle = "monthly" | "yearly" | "lifetime";
type CheckoutPlan = "pro_monthly" | "pro_yearly" | "lifetime" | "india_upi_monthly";
type DisplayPrice = { amount: number; currency: string };
type PricingInfo = {
    region: "south_asia" | "default";
    prices: Partial<Record<CheckoutPlan, DisplayPrice | null>>;
};

// Shown until the server answers (or if it cannot): the regular prices.
const FALLBACK_PRICES: Record<Exclude<CheckoutPlan, "india_upi_monthly">, DisplayPrice> = {
    pro_monthly: { amount: 10, currency: "usd" },
    pro_yearly: { amount: 96, currency: "usd" },
    lifetime: { amount: 300, currency: "usd" },
};

function formatPrice(price: DisplayPrice) {
    try {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: price.currency.toUpperCase(),
            minimumFractionDigits: Number.isInteger(price.amount) ? 0 : 2,
            maximumFractionDigits: 2,
        }).format(price.amount);
    } catch {
        return `${price.amount} ${price.currency.toUpperCase()}`;
    }
}

export default function PricingPage() {
    const KOFI_URL = "https://ko-fi.com/mysession";

    const LIFETIME_TOTAL_SLOTS = 5;
    const LIFETIME_LEFT_SLOTS = 5;

    const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
    const [checkingAuth, setCheckingAuth] = useState<boolean>(true);

    const [isUpgrading, setIsUpgrading] = useState<boolean>(false);
    const [checkoutLoadingPlan, setCheckoutLoadingPlan] = useState<CheckoutPlan | null>(null);
    const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");

    const [statusMessage, setStatusMessage] = useState<string>("");
    const [errorMessage, setErrorMessage] = useState<string>("");
    const [pricing, setPricing] = useState<PricingInfo | null>(null);
    const [pricingLoaded, setPricingLoaded] = useState(false);

    // The server picks the prices for this visitor's region (South Asia pays
    // regional prices) and reads them from Stripe, so they match checkout.
    useEffect(() => {
        let cancelled = false;
        fetch("/api/billing/create-checkout-session", { method: "GET" })
            .then((response) => (response.ok ? response.json() : null))
            .then((data) => {
                if (!cancelled && data?.prices) setPricing(data as PricingInfo);
            })
            .catch(() => { })
            .finally(() => {
                if (!cancelled) setPricingLoaded(true);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const priceFor = useCallback(
        (plan: Exclude<CheckoutPlan, "india_upi_monthly">) =>
            pricing?.prices?.[plan] || FALLBACK_PRICES[plan],
        [pricing],
    );
    const monthlyPrice = priceFor("pro_monthly");
    const yearlyPrice = priceFor("pro_yearly");
    const lifetimePrice = priceFor("lifetime");
    const indiaUpiPrice = pricing?.prices?.india_upi_monthly || null;
    const yearlyAsMonthly = { amount: monthlyPrice.amount * 12, currency: monthlyPrice.currency };
    const yearlySavingPercent =
        yearlyAsMonthly.amount > 0 && yearlyPrice.currency === monthlyPrice.currency
            ? Math.round((1 - yearlyPrice.amount / yearlyAsMonthly.amount) * 100)
            : 0;
    const showPrice = (price: DisplayPrice) => (pricingLoaded ? formatPrice(price) : "…");

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

    const startCheckout = useCallback(async (plan: CheckoutPlan) => {
        try {
            setCheckoutLoadingPlan(plan);
            setErrorMessage("");
            setStatusMessage("");

            const {
                data: { session },
            } = await supabase.auth.getSession();

            const accessToken = session?.access_token;

            if (!accessToken) {
                window.location.href = `/login?redirect=${encodeURIComponent("/pricing")}`;
                return;
            }

            const response = await fetch("/api/billing/create-checkout-session", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({ plan }),
            });

            const data = await response.json();

            if (!response.ok || !data?.url) {
                throw new Error(data?.error || "Failed to create checkout session");
            }

            setStatusMessage("Redirecting you to secure payment...");
            window.location.href = data.url;
        } catch (err) {
            console.error("startCheckout error:", err);
            setErrorMessage("Failed to start checkout. Please try again.");
        } finally {
            setCheckoutLoadingPlan(null);
        }
    }, []);

    const ensureCanCheckout = useCallback(() => {
        setErrorMessage("");
        setStatusMessage("");

        if (checkingAuth) {
            setErrorMessage("Still checking your account. Try again in a second.");
            return false;
        }

        if (!isLoggedIn) {
            window.location.href = "/login?redirect=/pricing";
            return false;
        }

        return true;
    }, [checkingAuth, isLoggedIn]);

    const handleUpgrade = useCallback(async () => {
        if (!ensureCanCheckout()) return;

        if (billingCycle === "lifetime" && LIFETIME_LEFT_SLOTS <= 0) {
            setErrorMessage("Lifetime access is currently sold out.");
            return;
        }

        setIsUpgrading(true);

        try {
            const planCode: CheckoutPlan =
                billingCycle === "monthly"
                    ? "pro_monthly"
                    : billingCycle === "yearly"
                        ? "pro_yearly"
                        : "lifetime";

            await startCheckout(planCode);
        } catch (err) {
            console.error("Unexpected upgrade error:", err);
            setErrorMessage("Unexpected error while starting the upgrade.");
        } finally {
            setIsUpgrading(false);
        }
    }, [LIFETIME_LEFT_SLOTS, billingCycle, ensureCanCheckout, startCheckout]);

    const handleIndiaUpiUpgrade = useCallback(async () => {
        if (!ensureCanCheckout()) return;

        setIsUpgrading(true);

        try {
            await startCheckout("india_upi_monthly");
        } catch (err) {
            console.error("Unexpected India UPI upgrade error:", err);
            setErrorMessage("Unexpected error while starting India UPI checkout.");
        } finally {
            setIsUpgrading(false);
        }
    }, [ensureCanCheckout, startCheckout]);

    const activeCard = useMemo(() => {
        if (billingCycle === "monthly") {
            return {
                title: "Pro Monthly",
                price: showPrice(monthlyPrice),
                subtitle: "Unlimited access to all formats",
                badge: "Most flexible",
                highlights: [
                    "Unlimited sessions",
                    "Join and host without limits",
                    "All formats: Group sessions, Infinite rooms, Body tripling",
                    "Priority access to new features",
                ],
                ctaLabel: checkingAuth
                    ? "Checking account..."
                    : isUpgrading || checkoutLoadingPlan === "pro_monthly"
                        ? "Opening payment..."
                        : "Upgrade to Pro Monthly",
                footnote: "Cancel anytime",
            };
        }

        if (billingCycle === "yearly") {
            return {
                title: "Pro Yearly",
                price: showPrice(yearlyPrice),
                subtitle: "Unlimited access • billed yearly",
                badge: yearlySavingPercent > 0 ? `Save ${yearlySavingPercent}%` : "Best value",
                highlights: [
                    "Unlimited sessions",
                    "Join and host without limits",
                    "All formats: Group sessions, Infinite rooms, Body tripling",
                    "Priority access to new features",
                ],
                ctaLabel: checkingAuth
                    ? "Checking account..."
                    : isUpgrading || checkoutLoadingPlan === "pro_yearly"
                        ? "Opening payment..."
                        : "Upgrade to Pro Yearly",
                footnote: `Pay ${showPrice(yearlyPrice)}/year instead of ${showPrice(yearlyAsMonthly)}`,
            };
        }

        return {
            title: "Lifetime",
            price: showPrice(lifetimePrice),
            subtitle: "Early supporter lifetime access",
            badge:
                LIFETIME_LEFT_SLOTS > 0
                    ? `${LIFETIME_LEFT_SLOTS}/${LIFETIME_TOTAL_SLOTS} left`
                    : "Sold out",
            highlights: [
                "One payment, lifetime access",
                "Unlimited sessions and hosting",
                "All formats included",
                "Early supporter offer",
                `Only ${LIFETIME_TOTAL_SLOTS} spots available in this drop`,
            ],
            ctaLabel: checkingAuth
                ? "Checking account..."
                : isUpgrading || checkoutLoadingPlan === "lifetime"
                    ? "Opening payment..."
                    : LIFETIME_LEFT_SLOTS > 0
                        ? "Get Lifetime Access"
                        : "Sold out",
            footnote:
                LIFETIME_LEFT_SLOTS > 0
                    ? "Limited drop"
                    : "No spots left in this drop",
        };
    }, [LIFETIME_LEFT_SLOTS, billingCycle, checkingAuth, checkoutLoadingPlan, isUpgrading, monthlyPrice, yearlyPrice, lifetimePrice, yearlySavingPercent, yearlyAsMonthly, showPrice]);

    const indiaUpiLoading = checkoutLoadingPlan === "india_upi_monthly";

    return (
        <div className="min-h-[calc(100vh-80px)] bg-transparent text-[#0B1220]">
            <main className="mx-auto w-full max-w-[1100px] px-4 py-10 sm:px-6">
                <div className="text-center">
                    <h1 className="text-[34px] font-semibold tracking-[-0.03em] sm:text-[44px]">
                        Pricing that stays simple
                    </h1>
                    <p className="mt-3 text-[15px] text-black/60">
                        Start free. Upgrade when you want unlimited access.
                    </p>
                    <p className="mt-2 text-[14px] text-black/50">
                        Your first 15 sessions are free. No credit card needed.
                    </p>
                </div>

                <div className="mx-auto mt-8 w-full max-w-[760px] rounded-full border border-black/10 bg-white p-1">
                    <div className="grid grid-cols-3 gap-1">
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
                            Yearly
                        </button>

                        <button
                            type="button"
                            className={`h-10 rounded-full text-sm font-medium transition ${billingCycle === "lifetime"
                                    ? "bg-black text-white"
                                    : "text-black/70 hover:bg-black/5"
                                }`}
                            onClick={() => setBillingCycle("lifetime")}
                        >
                            Lifetime
                        </button>
                    </div>
                </div>

                <div className="mt-10 grid gap-6 md:grid-cols-2">
                    <PricingPlanCard
                        title="Free"
                        price="$0"
                        subtitle="For getting started"
                        badge="Starter"
                        highlights={[
                            "Your first 15 sessions are free",
                            "Join and host sessions",
                            "Upgrade later when you want unlimited access",
                        ]}
                        ctaLabel="Start free"
                        ctaVariant="secondary"
                        footnote="No credit card"
                        onCta={handleStartFree}
                    />

                    <div className="rounded-[28px] border border-black/10 bg-white p-6 shadow-sm">
                        <PricingPlanCard
                            title={activeCard.title}
                            price={activeCard.price}
                            subtitle={activeCard.subtitle}
                            badge={activeCard.badge}
                            highlights={activeCard.highlights}
                            ctaLabel={activeCard.ctaLabel}
                            ctaVariant="primary"
                            footnote={activeCard.footnote}
                            onCta={handleUpgrade}
                        />

                        {pricing?.region === "south_asia" ? (
                            <p className="mt-3 text-center text-xs text-black/50">
                                Regional pricing for South Asia.
                            </p>
                        ) : null}

                        {billingCycle === "monthly" ? (
                            <div className="mt-4 rounded-[22px] border border-black/10 bg-black/[0.03] p-4">
                                <div className="flex items-start gap-3">
                                    <img
                                        src="/icons/flag-india.svg"
                                        alt="India"
                                        className="mt-0.5 h-6 w-6 rounded-full object-cover"
                                        onError={(event) => {
                                            event.currentTarget.style.display = "none";
                                        }}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-semibold text-black/85">
                                            India UPI option
                                        </div>
                                        <p className="mt-1 text-sm leading-relaxed text-black/60">
                                            Pay in INR with UPI. Same Pro Monthly access.
                                        </p>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleIndiaUpiUpgrade}
                                    disabled={checkingAuth || isUpgrading || indiaUpiLoading}
                                    className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white px-4 text-sm font-semibold text-black transition hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <img
                                        src="/icons/flag-india.svg"
                                        alt=""
                                        className="h-5 w-5 rounded-full object-cover"
                                        onError={(event) => {
                                            event.currentTarget.style.display = "none";
                                        }}
                                    />
                                    {checkingAuth
                                        ? "Checking account..."
                                        : indiaUpiLoading
                                            ? "Opening UPI checkout..."
                                            : indiaUpiPrice
                                                ? `Upgrade India — ${formatPrice(indiaUpiPrice)}/month`
                                                : "Upgrade India with UPI"}
                                </button>

                                <p className="mt-3 text-center text-xs text-black/45">
                                    Best for users in India who prefer UPI payments.
                                </p>
                            </div>
                        ) : null}
                    </div>
                </div>

                {(statusMessage || errorMessage) && (
                    <div className="mt-8 rounded-[24px] border border-black/10 bg-white p-5">
                        <div className="text-sm font-medium">Billing status</div>

                        <p className="mt-2 text-sm text-black/60">
                            Clicking upgrade will open secure checkout for your selected plan.
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
                                You’ll be asked to log in before starting checkout.
                            </div>
                        ) : null}
                    </div>
                )}

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
                                payments, UPI for eligible India payments, and other supported
                                payment methods via supported payment providers.
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
                            <div className="text-sm font-medium">What is included on Free?</div>
                            <p className="mt-1 text-sm text-black/60">
                                Your first 15 sessions are free. After that, Pro keeps joining and
                                hosting unlimited while supporting the video infrastructure.
                            </p>
                        </div>

                        <div>
                            <div className="text-sm font-medium">
                                Can I try MySession before paying?
                            </div>
                            <p className="mt-1 text-sm text-black/60">
                                Yes. Your first 15 sessions are free on the Free plan, no credit card
                                needed. Upgrade to Pro whenever you want unlimited sessions.
                            </p>
                        </div>

                        <div>
                            <div className="text-sm font-medium">
                                How does billing work right now?
                            </div>
                            <p className="mt-1 text-sm text-black/60">
                                Clicking upgrade opens secure checkout for the selected plan.
                            </p>
                        </div>

                        <div>
                            <div className="text-sm font-medium">
                                How does Lifetime work?
                            </div>
                            <p className="mt-1 text-sm text-black/60">
                                Lifetime is a limited early supporter offer with a fixed number of
                                spots in the current drop.
                            </p>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
