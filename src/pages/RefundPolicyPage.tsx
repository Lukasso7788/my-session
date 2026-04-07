import React from "react";
import { Link } from "react-router-dom";

const APP_NAME = "MySession";
const SUPPORT_EMAIL = "yaroslav@mysession.club";

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
                                All purchases are processed by Paddle as an authorised reseller.
                            </p>
                            <p className="mt-2">
                                Unless required by applicable law, transactions are non-refundable.
                            </p>
                            <p className="mt-2">
                                Refund requests must be submitted within <b>14 days</b> from the date of the transaction.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                2. Statutory refund rights
                            </h2>
                            <p className="mt-2">
                                Depending on your country, you may have a legal right to withdraw from a purchase and receive a refund.
                            </p>
                            <p className="mt-2">
                                For users in the European Union, EEA, Switzerland, and the United Kingdom, this period is <b>14 days</b>.
                            </p>
                            <p className="mt-2">
                                For other regions, different statutory periods (such as 7 days or 5 days) may apply.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                3. Digital service usage
                            </h2>
                            <p className="mt-2">
                                {APP_NAME} is a digital service. If access to the service has been provided and used,
                                your right to withdraw may be limited where permitted by law.
                            </p>
                            <p className="mt-2">
                                By using the service after purchase, you may be deemed to have waived certain withdrawal rights.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                4. How to request a refund
                            </h2>
                            <p className="mt-2">
                                To request a refund, you must contact Paddle using one of the following:
                            </p>
                            <ul className="mt-2 list-disc pl-5 space-y-1">
                                <li>the receipt email you received after purchase;</li>
                                <li>the “Manage subscription” or “View receipt” link;</li>
                                <li>or Paddle support at https://paddle.net.</li>
                            </ul>
                            <p className="mt-2">
                                You may also contact us at{" "}
                                <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
                                    {SUPPORT_EMAIL}
                                </a>{" "}
                                for assistance.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                5. Refund processing
                            </h2>
                            <p className="mt-2">
                                If approved, refunds will be issued to the original payment method where possible.
                            </p>
                            <p className="mt-2">
                                Refunds are typically processed within 14 days after approval.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                6. Subscriptions
                            </h2>
                            <p className="mt-2">
                                Subscriptions can be cancelled at any time to prevent future billing.
                            </p>
                            <p className="mt-2">
                                Cancellation does not automatically result in a refund for the current billing period.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                7. Chargebacks and disputes
                            </h2>
                            <p className="mt-2">
                                We recommend contacting Paddle before initiating a chargeback or dispute with your payment provider.
                            </p>
                            <p className="mt-2">
                                Access to the service may be suspended during dispute resolution.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                8. Related pages
                            </h2>
                            <p className="mt-2">
                                See also our{" "}
                                <Link to="/terms" className="underline">Terms and Conditions</Link>{" "}
                                and{" "}
                                <Link to="/pricing" className="underline">Pricing</Link>.
                            </p>
                        </section>

                    </div>
                </div>
            </main>
        </div>
    );
}