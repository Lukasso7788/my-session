import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

type ConfirmState = "idle" | "loading" | "success" | "error";

export default function PricingSuccessPage() {
    const [searchParams] = useSearchParams();
    const sessionId = searchParams.get("session_id") || "";

    const [confirmState, setConfirmState] = useState<ConfirmState>("idle");
    const [message, setMessage] = useState<string>("");

    useEffect(() => {
        let cancelled = false;

        async function confirmCheckout() {
            if (!sessionId) {
                setConfirmState("error");
                setMessage("Missing Stripe session ID.");
                return;
            }

            try {
                setConfirmState("loading");
                setMessage("Confirming your payment and activating Pro...");

                const {
                    data: { session },
                } = await supabase.auth.getSession();

                const accessToken = session?.access_token;

                if (!accessToken) {
                    setConfirmState("error");
                    setMessage("You need to be logged in to confirm checkout.");
                    return;
                }

                const response = await fetch("/api/billing/confirm-checkout-session", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${accessToken}`,
                    },
                    body: JSON.stringify({ sessionId }),
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data?.details || data?.error || "Failed to confirm checkout");
                }

                if (cancelled) return;

                setConfirmState("success");
                setMessage("Your Pro access has been activated.");
            } catch (error) {
                console.error("confirmCheckout error", error);

                if (cancelled) return;

                setConfirmState("error");
                setMessage(
                    error instanceof Error
                        ? error.message
                        : "Failed to confirm checkout."
                );
            }
        }

        void confirmCheckout();

        return () => {
            cancelled = true;
        };
    }, [sessionId]);

    return (
        <div className="min-h-[calc(100vh-80px)] bg-transparent text-[#0B1220]">
            <main className="mx-auto w-full max-w-[840px] px-4 py-12 sm:px-6">
                <div className="rounded-[28px] border border-black/10 bg-white p-8 shadow-sm">
                    <div className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
                        Checkout completed
                    </div>

                    <h1 className="mt-5 text-[34px] font-semibold tracking-[-0.03em] sm:text-[42px]">
                        Payment flow completed
                    </h1>

                    <p className="mt-3 text-[15px] text-black/65">
                        We’re confirming your checkout and updating your plan now.
                    </p>

                    {sessionId ? (
                        <div className="mt-6 rounded-2xl border border-black/10 bg-black/[0.03] p-4">
                            <div className="text-sm font-medium">Stripe session ID</div>
                            <div className="mt-2 break-all text-sm text-black/60">{sessionId}</div>
                        </div>
                    ) : null}

                    <div className="mt-6 rounded-2xl border border-black/10 bg-white p-5">
                        <div className="text-sm font-medium">Activation status</div>

                        <div className="mt-3 text-sm text-black/65">
                            {confirmState === "loading" && "Confirming checkout..."}
                            {confirmState === "success" && message}
                            {confirmState === "error" && message}
                            {confirmState === "idle" && "Waiting to confirm checkout..."}
                        </div>

                        {confirmState === "success" ? (
                            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                                Your plan should now show as Pro in the header.
                            </div>
                        ) : null}

                        {confirmState === "error" ? (
                            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                {message}
                            </div>
                        ) : null}
                    </div>

                    <div className="mt-8 flex flex-wrap gap-3">
                        <Link
                            to="/pricing"
                            className="rounded-2xl border border-black/10 bg-white px-5 py-3 text-sm font-medium transition hover:bg-black/[0.03]"
                        >
                            Back to pricing
                        </Link>

                        <Link
                            to="/sessions"
                            className="rounded-2xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
                        >
                            Go to sessions
                        </Link>
                    </div>
                </div>
            </main>
        </div>
    );
}