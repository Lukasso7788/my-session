import React from "react";
import { Link, useSearchParams } from "react-router-dom";

export default function PricingSuccessPage() {
    const [searchParams] = useSearchParams();
    const sessionId = searchParams.get("session_id") || "";

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
                        If everything went through correctly, your Pro access should update shortly.
                    </p>

                    {sessionId ? (
                        <div className="mt-6 rounded-2xl border border-black/10 bg-black/[0.03] p-4">
                            <div className="text-sm font-medium">Stripe session ID</div>
                            <div className="mt-2 break-all text-sm text-black/60">{sessionId}</div>
                        </div>
                    ) : null}

                    <div className="mt-8 rounded-2xl border border-black/10 bg-white p-5">
                        <div className="text-sm font-medium">What to do now</div>
                        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-black/65">
                            <li>Open the Header and check whether your badge changed to Pro.</li>
                            <li>Refresh the page once if the badge still shows Free.</li>
                            <li>If needed, check Stripe webhook logs and Supabase entitlements.</li>
                        </ol>
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