import React from "react";
import { Link } from "react-router-dom";

const APP_NAME = "MySession";
const SUPPORT_EMAIL = "misha1915@live.ru"; // TODO: свой email

export default function PrivacyPage() {
    return (
        <div className="min-h-[calc(100vh-80px)] bg-transparent text-[#0B1220]">
            <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
                <div className="bg-white/85 border border-black/10 rounded-2xl shadow-sm p-6 sm:p-8">
                    <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tight">
                        Privacy Policy
                    </h1>
                    <p className="mt-2 text-[13px] text-black/55">
                        Last updated: {new Date().toISOString().slice(0, 10)}
                    </p>

                    <div className="mt-6 space-y-6 text-[14px] leading-relaxed text-black/80">
                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                1. Who we are
                            </h2>
                            <p className="mt-2">
                                {APP_NAME} is a productivity platform for joining focus sessions
                                (including video rooms) to help users stay accountable.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                2. What data we collect
                            </h2>
                            <ul className="mt-2 list-disc pl-5 space-y-1">
                                <li>Account data: name, email, and profile information you provide.</li>
                                <li>
                                    Authentication data: when you sign in with a provider (e.g. Google/Facebook/Apple),
                                    we receive a provider identifier and basic profile details allowed by you.
                                </li>
                                <li>Session data: sessions you create/join, timestamps, and attendance.</li>
                                <li>Technical data: device/browser information, IP address, logs for debugging and security.</li>
                                <li>Media: audio/video streams are used for real-time communication. We do not record your calls by default.</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                3. How we use your data
                            </h2>
                            <ul className="mt-2 list-disc pl-5 space-y-1">
                                <li>Provide and operate the service (sessions, rooms, etc.).</li>
                                <li>Authenticate you and prevent fraud/abuse.</li>
                                <li>Improve reliability, performance, and user experience.</li>
                                <li>Customer support and communication related to your account.</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                4. Sharing of data
                            </h2>
                            <p className="mt-2">
                                We may share limited data with service providers necessary to run {APP_NAME}
                                (e.g. hosting, analytics, authentication, real-time communication). We do not sell
                                your personal information.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                5. Retention
                            </h2>
                            <p className="mt-2">
                                We keep your data as long as needed to provide the service and comply with legal
                                obligations. You can request deletion (see “Data Deletion” page).
                            </p>
                        </section>

                        <section>
                            <h2 className="text-[16px] font-semibold text-black/85">
                                6. Contact
                            </h2>
                            <p className="mt-2">
                                For privacy questions or data requests, contact:{" "}
                                <a
                                    className="underline underline-offset-2 hover:opacity-80"
                                    href={`mailto:${SUPPORT_EMAIL}`}
                                >
                                    {SUPPORT_EMAIL}
                                </a>
                            </p>
                        </section>
                    </div>

                    <div className="mt-8 pt-6 border-t border-black/10 flex items-center justify-between gap-3">
                        <Link to="/" className="text-[13px] text-black/65 hover:text-black/90 transition">
                            ← Back to home
                        </Link>

                        <Link
                            to="/data-deletion"
                            className="text-[13px] px-3 py-2 rounded-xl border border-black/10 bg-black/5 hover:bg-black/10 transition"
                        >
                            Data deletion
                        </Link>
                    </div>
                </div>
            </main>
        </div>
    );
}
