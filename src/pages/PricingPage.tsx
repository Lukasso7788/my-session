import React from "react";
import { PricingPlanCard } from "../components/PricingPlanCard";

export default function PricingPage() {
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
                    <button className="h-10 rounded-full bg-black text-sm font-medium text-white">
                        Monthly
                    </button>
                    <button className="h-10 rounded-full text-sm font-medium text-black/70 hover:bg-black/5">
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
                    onCta={() => {
                        // TODO: route to sessions or sign up
                        window.location.href = "/sessions";
                    }}
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
                    ctaLabel="Upgrade to Pro"
                    ctaVariant="primary"
                    footnote="Cancel anytime"
                    onCta={() => {
                        // TODO: open Stripe checkout
                        alert("Stripe checkout: TODO");
                    }}
                />
            </div>

            <div className="mt-10 rounded-[28px] border border-black/10 bg-white p-6">
                <h2 className="text-[18px] font-semibold tracking-[-0.01em]">FAQ</h2>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                        <div className="text-sm font-medium">Why weekly limits on Free?</div>
                        <p className="mt-1 text-sm text-black/60">
                            Video calls are expensive to run (bandwidth + server load). Limits keep Free sustainable.
                        </p>
                    </div>
                    <div>
                        <div className="text-sm font-medium">Can I change plans later?</div>
                        <p className="mt-1 text-sm text-black/60">
                            Yes — upgrade/downgrade anytime (Stripe flow soon).
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
