import React from "react";
import { Link } from "react-router-dom";

const APP_NAME = "MySession";
const SUPPORT_EMAIL = "misha1915@live.ru"; // TODO: replace with your real support email

export default function TermsPage() {
    return (
        <div className="min-h-[calc(100vh-80px)] bg-transparent text-[#0B1220]">
            <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
                <div className="bg-white/85 border border-black/10 rounded-2xl shadow-sm p-6 sm:p-8">
                    <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tight">
                        Terms and Conditions
                    </h1>
                    <p className="mt-2 text-[13px] text-black/55">
                        Last updated: {new Date().toISOString().slice(0, 10)}
                    </p>

                    <div className="mt-6 space-y-6 text-[14px] leading-relaxed text-black/80">
                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                1. About the service
                            </h2>
                            <p className="mt-2">
                                {APP_NAME} is an online productivity platform that helps users join
                                focus sessions, virtual coworking rooms, body doubling sessions,
                                silent rooms, and other structured accountability experiences.
                            </p>
                            <p className="mt-2">
                                The service is provided digitally through the {APP_NAME} website and
                                related online room infrastructure.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                2. Acceptance of these terms
                            </h2>
                            <p className="mt-2">
                                By accessing or using {APP_NAME}, creating an account, joining a
                                room, or purchasing a paid plan, you agree to these Terms and
                                Conditions.
                            </p>
                            <p className="mt-2">
                                If you do not agree with these terms, please do not use the
                                platform.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                3. What users receive
                            </h2>
                            <p className="mt-2">
                                Depending on the selected plan or offer, users may receive access
                                to:
                            </p>
                            <ul className="mt-2 list-disc pl-5 space-y-1">
                                <li>group focus sessions;</li>
                                <li>silent rooms and virtual coworking rooms;</li>
                                <li>body doubling or related productivity formats;</li>
                                <li>session hosting and room creation tools;</li>
                                <li>additional premium features made available in paid plans.</li>
                            </ul>
                            <p className="mt-2">
                                Specific plan features, limits, and availability may vary depending
                                on the pricing page and current product configuration.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                4. Service delivery
                            </h2>
                            <p className="mt-2">
                                {APP_NAME} is a digital service. No physical product or physical
                                delivery is involved.
                            </p>
                            <p className="mt-2">
                                Access to paid features is provided online after successful payment
                                and account activation. To use the service, you may need a stable
                                internet connection, a compatible browser, and in some cases a
                                camera, microphone, or speakers.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                5. Pricing and payment methods
                            </h2>
                            <p className="mt-2">
                                Current prices, plans, and billing periods are shown on the{" "}
                                <Link
                                    to="/pricing"
                                    className="underline underline-offset-2 hover:opacity-80"
                                >
                                    Pricing
                                </Link>{" "}
                                page or during checkout.
                            </p>
                            <p className="mt-2">
                                Payments are made online using the payment methods available on the
                                checkout page. These may include bank card payments via supported
                                payment providers.
                            </p>
                            <p className="mt-2">
                                Access to paid functionality begins after successful payment
                                confirmation, unless stated otherwise for a particular offer.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                6. Subscriptions and billing periods
                            </h2>
                            <p className="mt-2">
                                Some paid plans may be offered on a recurring subscription basis,
                                while others may be one-time purchases or custom paid access.
                            </p>
                            <p className="mt-2">
                                If a plan is recurring, cancellation will generally prevent future
                                charges but will not automatically refund the current paid period
                                unless a refund is approved under the Refund Policy or required by
                                law.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                7. User responsibilities
                            </h2>
                            <p className="mt-2">
                                You agree to use {APP_NAME} lawfully and respectfully. You must not:
                            </p>
                            <ul className="mt-2 list-disc pl-5 space-y-1">
                                <li>abuse, harass, threaten, or disrupt other users;</li>
                                <li>attempt unauthorized access to accounts, rooms, or systems;</li>
                                <li>use the platform for fraud, spam, or illegal activity;</li>
                                <li>interfere with the stability or security of the service.</li>
                            </ul>
                            <p className="mt-2">
                                We may suspend or restrict access where abuse, fraud, or serious
                                policy violations are detected.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                8. Availability and changes
                            </h2>
                            <p className="mt-2">
                                We aim to keep {APP_NAME} available and reliable, but uninterrupted
                                access cannot be guaranteed at all times.
                            </p>
                            <p className="mt-2">
                                We may update features, pricing, room formats, limits, or service
                                policies over time. The current version published on the site is the
                                version that applies going forward.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                9. Refunds and cancellations
                            </h2>
                            <p className="mt-2">
                                Refunds, billing corrections, and cancellation requests are handled
                                according to our{" "}
                                <Link
                                    to="/refund-policy"
                                    className="underline underline-offset-2 hover:opacity-80"
                                >
                                    Refund Policy
                                </Link>
                                .
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                10. Contact
                            </h2>
                            <p className="mt-2">
                                For service, billing, or legal questions, contact us at{" "}
                                <a
                                    className="underline underline-offset-2 hover:opacity-80"
                                    href={`mailto:${SUPPORT_EMAIL}`}
                                >
                                    {SUPPORT_EMAIL}
                                </a>
                                .
                            </p>
                            <p className="mt-2">
                                Additional seller and contact details are available on the{" "}
                                <Link
                                    to="/contact"
                                    className="underline underline-offset-2 hover:opacity-80"
                                >
                                    Contact
                                </Link>{" "}
                                page.
                            </p>
                        </section>
                    </div>

                    <div className="mt-8 pt-6 border-t border-black/10 flex flex-wrap items-center justify-between gap-3">
                        <Link
                            to="/"
                            className="text-[13px] text-black/65 hover:text-black/90 transition"
                        >
                            ← Back to home
                        </Link>

                        <div className="flex flex-wrap gap-2">
                            <Link
                                to="/pricing"
                                className="text-[13px] px-3 py-2 rounded-xl border border-black/10 bg-black/5 hover:bg-black/10 transition"
                            >
                                Pricing
                            </Link>
                            <Link
                                to="/refund-policy"
                                className="text-[13px] px-3 py-2 rounded-xl border border-black/10 bg-black/5 hover:bg-black/10 transition"
                            >
                                Refund policy
                            </Link>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}