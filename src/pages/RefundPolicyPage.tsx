import React from "react";
import { Link } from "react-router-dom";

const APP_NAME = "MySession";
const SUPPORT_EMAIL = "yaroslav@mysession.club"; // TODO: replace with your real support email

export default function RefundPolicyPage() {
    return (
        <div className="min-h-[calc(100vh-80px)] bg-transparent text-[#0B1220]">
            <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
                <div className="bg-white/85 border border-black/10 rounded-2xl shadow-sm p-6 sm:p-8">
                    <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tight">
                        Refund Policy
                    </h1>
                    <p className="mt-2 text-[13px] text-black/55">
                        Last updated: {new Date().toISOString().slice(0, 10)}
                    </p>

                    <div className="mt-6 space-y-6 text-[14px] leading-relaxed text-black/80">
                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                1. General policy
                            </h2>
                            <p className="mt-2">
                                {APP_NAME} is a digital online service. Refund requests are reviewed
                                individually and handled in a reasonable timeframe based on the
                                payment type, service status, and the reason for the request.
                            </p>
                            <p className="mt-2">
                                To request a refund or billing review, please contact{" "}
                                <a
                                    className="underline underline-offset-2 hover:opacity-80"
                                    href={`mailto:${SUPPORT_EMAIL}`}
                                >
                                    {SUPPORT_EMAIL}
                                </a>{" "}
                                and include the email associated with your account and details of
                                the payment.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                2. Cases where a refund may be granted
                            </h2>
                            <p className="mt-2">Refunds may be approved in situations such as:</p>
                            <ul className="mt-2 list-disc pl-5 space-y-1">
                                <li>duplicate or accidental double payment;</li>
                                <li>technical billing error;</li>
                                <li>failure to provide the paid service or paid access;</li>
                                <li>another exceptional case reviewed and approved by support.</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                3. Subscription cancellation
                            </h2>
                            <p className="mt-2">
                                If your plan is billed on a recurring basis, you may request
                                cancellation before the next billing cycle.
                            </p>
                            <p className="mt-2">
                                Cancellation generally stops future charges. It does not
                                automatically refund the current paid period unless the refund is
                                separately approved under this policy or required by law.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                4. Non-refundable situations
                            </h2>
                            <p className="mt-2">
                                Because {APP_NAME} provides digital access and online participation,
                                certain payments may be non-refundable, including cases where:
                            </p>
                            <ul className="mt-2 list-disc pl-5 space-y-1">
                                <li>paid access has already been granted and used;</li>
                                <li>the current paid period is already active and functioning;</li>
                                <li>
                                    the request is based only on a change of mind after service
                                    access has already been provided;
                                </li>
                                <li>
                                    the issue was caused by the user’s own device, browser, internet
                                    connection, or third-party environment outside our control.
                                </li>
                            </ul>
                            <p className="mt-2">
                                Exceptions may still apply where required by law or where there is a
                                confirmed technical/service failure on our side.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                5. Timeframe for review
                            </h2>
                            <p className="mt-2">
                                Refund and billing requests are generally reviewed within 5–10
                                business days, although some cases may require additional
                                verification.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                6. Refund method
                            </h2>
                            <p className="mt-2">
                                If a refund is approved, it will normally be returned to the
                                original payment method where technically possible.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                7. Transaction cancellation
                            </h2>
                            <p className="mt-2">
                                If you believe a transaction should be cancelled or reversed, contact
                                support as soon as possible. If the payment has not yet been fully
                                processed or if there is a confirmed technical issue, cancellation
                                may be possible.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                8. Related pages
                            </h2>
                            <p className="mt-2">
                                You can also review our{" "}
                                <Link
                                    to="/terms"
                                    className="underline underline-offset-2 hover:opacity-80"
                                >
                                    Terms and Conditions
                                </Link>{" "}
                                and{" "}
                                <Link
                                    to="/pricing"
                                    className="underline underline-offset-2 hover:opacity-80"
                                >
                                    Pricing
                                </Link>{" "}
                                page for more information about plan access, service delivery, and
                                billing structure.
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
                                to="/terms"
                                className="text-[13px] px-3 py-2 rounded-xl border border-black/10 bg-black/5 hover:bg-black/10 transition"
                            >
                                Terms
                            </Link>
                            <Link
                                to="/contact"
                                className="text-[13px] px-3 py-2 rounded-xl border border-black/10 bg-black/5 hover:bg-black/10 transition"
                            >
                                Contact
                            </Link>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}