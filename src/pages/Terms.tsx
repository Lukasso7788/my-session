import React from "react";
import { Link } from "react-router-dom";

const APP_NAME = "MySession";
const SUPPORT_EMAIL = "yaroslav@mysession.club";

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
                                1. Legal entity
                            </h2>
                            <p className="mt-2">
                                These Terms and Conditions apply to <b>MySession LLC</b>, which operates the {APP_NAME} platform.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                2. About the service
                            </h2>
                            <p className="mt-2">
                                {APP_NAME} is a digital productivity platform providing access to online focus sessions,
                                coworking rooms, body doubling formats, and related tools.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                3. Acceptance of terms
                            </h2>
                            <p className="mt-2">
                                By using {APP_NAME}, creating an account, or purchasing access, you agree to these Terms.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                4. Service delivery
                            </h2>
                            <p className="mt-2">
                                The service is provided digitally. No physical goods are delivered.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                5. Payments
                            </h2>
                            <p className="mt-2">
                                Payments are processed by Paddle as the authorised reseller.
                            </p>
                            <p className="mt-2">
                                Accepted payment methods include card payments and other methods provided at checkout.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                6. Subscriptions
                            </h2>
                            <p className="mt-2">
                                Some plans are subscription-based and renew automatically unless cancelled.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                7. Refunds
                            </h2>
                            <p className="mt-2">
                                Refunds are handled in accordance with our{" "}
                                <Link to="/refund-policy" className="underline">
                                    Refund Policy
                                </Link>{" "}
                                and Paddle policies.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                8. User conduct
                            </h2>
                            <p className="mt-2">
                                Users must not abuse, disrupt, or misuse the platform.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                9. Contact
                            </h2>
                            <p className="mt-2">
                                Contact us at{" "}
                                <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
                                    {SUPPORT_EMAIL}
                                </a>.
                            </p>
                        </section>

                    </div>
                </div>
            </main>
        </div>
    );
}