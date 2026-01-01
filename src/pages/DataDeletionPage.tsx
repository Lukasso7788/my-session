import React from "react";
import { Link } from "react-router-dom";

const APP_NAME = "MySession";
const SUPPORT_EMAIL = "misha1915@live.ru"; // TODO: свой email

export default function DataDeletionPage() {
    return (
        <div className="min-h-[calc(100vh-80px)] bg-transparent text-[#0B1220]">
            <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
                <div className="bg-white/85 border border-black/10 rounded-2xl shadow-sm p-6 sm:p-8">
                    <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tight">
                        Data Deletion Instructions
                    </h1>
                    <p className="mt-2 text-[13px] text-black/55">
                        If you want to delete your {APP_NAME} account and associated personal data, follow the steps below.
                    </p>

                    <div className="mt-6 space-y-6 text-[14px] leading-relaxed text-black/80">
                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                Option A — Email request
                            </h2>
                            <ol className="mt-2 list-decimal pl-5 space-y-1">
                                <li>
                                    Send an email to{" "}
                                    <a
                                        className="underline underline-offset-2 hover:opacity-80"
                                        href={`mailto:${SUPPORT_EMAIL}`}
                                    >
                                        {SUPPORT_EMAIL}
                                    </a>
                                    .
                                </li>
                                <li>
                                    Subject: <span className="font-semibold">Delete MySession account</span>
                                </li>
                                <li>Include: the email you used for registration and (optional) your user ID.</li>
                                <li>We will verify the request and delete your account and associated data.</li>
                            </ol>
                            <p className="mt-2 text-[13px] text-black/55">
                                Typical processing time: up to 30 days (usually faster).
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                What gets deleted
                            </h2>
                            <ul className="mt-2 list-disc pl-5 space-y-1">
                                <li>Your account profile and authentication identifiers.</li>
                                <li>App data stored under your user ID (where applicable).</li>
                                <li>Session-related records associated with your account (where applicable).</li>
                            </ul>
                            <p className="mt-2 text-[13px] text-black/55">
                                Note: Some records may be retained if required for legal/security reasons.
                            </p>
                        </section>
                    </div>

                    <div className="mt-8 pt-6 border-t border-black/10 flex items-center justify-between gap-3">
                        <Link to="/privacy" className="text-[13px] text-black/65 hover:text-black/90 transition">
                            ← Back to Privacy
                        </Link>

                        <Link
                            to="/"
                            className="text-[13px] px-3 py-2 rounded-xl border border-black/10 bg-black/5 hover:bg-black/10 transition"
                        >
                            Home
                        </Link>
                    </div>
                </div>
            </main>
        </div>
    );
}
