import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PricingPlanCard } from "../components/PricingPlanCard";
import { supabase } from "../lib/supabase";

type BillingMode = "unknown" | "test" | "live";

export default function PricingPage() {
    const KOFI_URL = "https://ko-fi.com/mysession";

    const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
    const [checkingAuth, setCheckingAuth] = useState<boolean>(true);

    const [isUpgrading, setIsUpgrading] = useState<boolean>(false);
    const [billingMode, setBillingMode] = useState<BillingMode>("unknown");
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

    const supportText = useMemo(() => {
        if (billingMode === "test") {
            return "Test mode is enabled right now. Clicking Pro should activate access without charging money.";
        }
        if (billingMode === "live") {
            return "Live billing is enabled. Pro will open the secure payment flow.";
        }
        return "Billing is being wired up. If anything fails, you can still support via Ko-fi for now.";
    }, [billingMode]);

    const handleStartFree = useCallback(() => {
        window.location.href = "/sessions";
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
            const { data, error } = await supabase.functions.invoke("create-payment-session", {
                body: { planId: "monthly_10" },
            });

            if (error) {
                console.error("create-payment-session error:", error);
                setErrorMessage(
                    error.message || "Could not start payment. Please try again."
                );
                return;
            }

            console.log("create-payment-session response:", data);

            if (data?.mode === "test") {
                setBillingMode("test");
                setStatusMessage(
                    "Test payment succeeded. Your Pro subscription should now be activated."
                );
                return;
            }

            if (data?.mode === "live" && data?.checkoutUrl) {
                setBillingMode("live");
                setStatusMessage("Redirecting you to secure payment...");
                window.location.href = data.checkoutUrl;
                return;
            }

            setErrorMessage("Unexpected payment response. Check the function logs.");
        } catch (err) {
            console.error("Unexpected upgrade error:", err);
            setErrorMessage("Unexpected error while starting payment.");
        } finally {
            setIsUpgrading(false);
        }
    }, [checkingAuth, isLoggedIn]);

    return (
        <div className="mx-auto w-full max-w-[1100px] px-6 pb-20">
            <div className="mt-16 text-center">
                <h1 className="text-[44px] font-semibold tracking-[-0.03em]">
                    Pricing that stays simple
                </h1>
                <p className="mt-3 text-[15px] text-black/60">
                    Join focus sessions for accountability. Upgrade when you want unlimited access.
                </p>
            </div>

            <div className="mx-auto mt-8 w-full max-w-[560px] rounded-full border border-black/10 bg-white p-1">
                <div className="grid grid-cols-2 gap-1">
                    <button
                        type="button"
                        className="h-10 rounded-full bg-black text-sm font-medium text-white"
                    >
                        Monthly
                    </button>
                    <button
                        type="button"
                        className="h-10 rounded-full text-sm font-medium text-black/70 hover:bg-black/5"
                    >
                        Yearly (soon)
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
                    price="$10"
                    subtitle="Full access to all formats"
                    badge="Best value"
                    highlights={[
                        "Unlimited sessions per week",
                        "All formats: Group sessions, Infinite rooms, Body tripling",
                        "Create & host sessions",
                        "Priority access to new features (AI layer, backgrounds)",
                        "Support the project ❤️",
                    ]}
                    ctaLabel={
                        checkingAuth
                            ? "Checking account..."
                            : isUpgrading
                                ? "Starting payment..."
                                : "Upgrade to Pro"
                    }
                    ctaVariant="primary"
                    footnote="Cancel anytime"
                    onCta={handleUpgradeToPro}
                />
            </div>

            {(statusMessage || errorMessage || supportText) && (
                <div className="mt-8 rounded-[24px] border border-black/10 bg-white p-5">
                    <div className="text-sm font-medium">Billing status</div>

                    <p className="mt-2 text-sm text-black/60">{supportText}</p>

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

            <div className="mt-10 rounded-[28px] border border-black/10 bg-white p-6">
                <h2 className="text-[18px] font-semibold tracking-[-0.01em]">FAQ</h2>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                        <div className="text-sm font-medium">Why weekly limits on Free?</div>
                        <p className="mt-1 text-sm text-black/60">
                            Video calls are expensive to run. Limits keep Free sustainable while Pro supports the infrastructure.
                        </p>
                    </div>

                    <div>
                        <div className="text-sm font-medium">How does Pro billing work right now?</div>
                        <p className="mt-1 text-sm text-black/60">
                            The Pro button now calls the new billing function. In test mode it activates access without charging money. In live mode it will redirect to the payment link.
                        </p>
                    </div>

                    <div>
                        <div className="text-sm font-medium">What should happen during testing?</div>
                        <p className="mt-1 text-sm text-black/60">
                            Clicking “Upgrade to Pro” while logged in should create a payment row and activate your subscription immediately if PAYMENTS_MODE is set to test.
                        </p>
                    </div>

                    <div>
                        <div className="text-sm font-medium">What if the upgrade fails?</div>
                        <p className="mt-1 text-sm text-black/60">
                            Check the browser console, then open the Supabase function logs for create-payment-session. That will usually show whether the issue is auth, missing tables, or the SQL activation function.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}