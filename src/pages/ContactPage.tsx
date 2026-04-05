import React from "react";
import { Link } from "react-router-dom";

const APP_NAME = "MySession";

const SUPPORT_EMAIL = "yaroslav@mysession.club";
const SUPPORT_PHONE = "+380678882238";
const BUSINESS_NAME = "MySession - Sydorenko Yaroslav";
const LEGAL_ADDRESS =
    "254 Chapman Rd, Ste 208 #26981, Newark, Delaware 19702 Us";
const ACTUAL_ADDRESS =
    "vul. Petra Sagaidachnogo 20, city of Zaporizhzhia, Ukraine, 69096";
const SUPPORT_HOURS = "24/7 support";

export default function ContactPage() {
    return (
        <div className="min-h-[calc(100vh-80px)] bg-transparent text-[#0B1220]">
            <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
                <div className="bg-white/85 border border-black/10 rounded-2xl shadow-sm p-6 sm:p-8">
                    <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tight">
                        Contact Information
                    </h1>
                    <p className="mt-2 text-[13px] text-black/55">
                        Seller and support details for {APP_NAME}
                    </p>

                    <div className="mt-6 space-y-6 text-[14px] leading-relaxed text-black/80">
                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                Seller details
                            </h2>

                            <div className="mt-3 rounded-2xl border border-black/10 bg-black/[0.03] p-4 space-y-3">
                                <div>
                                    <div className="text-[13px] font-medium text-black/60">
                                        Full business / seller name
                                    </div>
                                    <div className="mt-1">{BUSINESS_NAME}</div>
                                </div>

                                <div>
                                    <div className="text-[13px] font-medium text-black/60">
                                        Legal address
                                    </div>
                                    <div className="mt-1">{LEGAL_ADDRESS}</div>
                                </div>

                                <div>
                                    <div className="text-[13px] font-medium text-black/60">
                                        Actual address
                                    </div>
                                    <div className="mt-1">{ACTUAL_ADDRESS}</div>
                                </div>

                                <div>
                                    <div className="text-[13px] font-medium text-black/60">
                                        Phone
                                    </div>
                                    <div className="mt-1">
                                        <a
                                            href={`tel:${SUPPORT_PHONE}`}
                                            className="underline underline-offset-2 hover:opacity-80"
                                        >
                                            {SUPPORT_PHONE}
                                        </a>
                                    </div>
                                </div>

                                <div>
                                    <div className="text-[13px] font-medium text-black/60">
                                        Email
                                    </div>
                                    <div className="mt-1">
                                        <a
                                            href={`mailto:${SUPPORT_EMAIL}`}
                                            className="underline underline-offset-2 hover:opacity-80"
                                        >
                                            {SUPPORT_EMAIL}
                                        </a>
                                    </div>
                                </div>

                                <div>
                                    <div className="text-[13px] font-medium text-black/60">
                                        Support availability
                                    </div>
                                    <div className="mt-1">{SUPPORT_HOURS}</div>
                                </div>
                            </div>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                Support
                            </h2>
                            <p className="mt-2">
                                For billing questions, payment issues, refund requests, or service
                                access issues, please contact us by email or phone using the details
                                above.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                Related pages
                            </h2>
                            <p className="mt-2">
                                You may also want to review our{" "}
                                <Link
                                    to="/pricing"
                                    className="underline underline-offset-2 hover:opacity-80"
                                >
                                    Pricing
                                </Link>
                                ,{" "}
                                <Link
                                    to="/terms"
                                    className="underline underline-offset-2 hover:opacity-80"
                                >
                                    Terms and Conditions
                                </Link>
                                ,{" "}
                                <Link
                                    to="/refund-policy"
                                    className="underline underline-offset-2 hover:opacity-80"
                                >
                                    Refund Policy
                                </Link>
                                , and{" "}
                                <Link
                                    to="/privacy"
                                    className="underline underline-offset-2 hover:opacity-80"
                                >
                                    Privacy Policy
                                </Link>
                                .
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

                        <Link
                            to="/pricing"
                            className="text-[13px] px-3 py-2 rounded-xl border border-black/10 bg-black/5 hover:bg-black/10 transition"
                        >
                            Pricing
                        </Link>
                    </div>
                </div>
            </main>
        </div>
    );
}