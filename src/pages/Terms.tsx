// src/pages/Terms.tsx
import React from "react";
import { Link } from "react-router-dom";

const APP_NAME = "MySession";
const SUPPORT_EMAIL = "misha1915@live.ru"; // TODO: replace with your main support email

export default function Terms() {
    const lastUpdated = new Date().toISOString().slice(0, 10);

    return (
        <div className="min-h-[calc(100vh-80px)] bg-transparent text-white">
            <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
                <div className="overflow-hidden rounded-[28px] border border-black/10 bg-[#2f2f2f] shadow-[0_12px_40px_rgba(0,0,0,0.14)]">
                    <div className="px-6 py-7 sm:px-8 sm:py-8">
                        <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[12px] font-medium text-white/70">
                            Legal
                        </div>

                        <h1 className="mt-4 text-[30px] font-semibold tracking-tight text-white sm:text-[38px]">
                            Terms of Service
                        </h1>

                        <p className="mt-2 text-[13px] text-white/45">
                            Last updated: {lastUpdated}
                        </p>

                        <p className="mt-5 max-w-3xl text-[15px] leading-7 text-white/75">
                            Welcome to {APP_NAME}. These Terms of Service govern your access to
                            and use of the MySession website, platform, video rooms, focus
                            sessions, and related services. By accessing or using {APP_NAME},
                            you agree to these Terms.
                        </p>
                    </div>

                    <div className="border-t border-white/10" />

                    <div className="px-6 pb-6 sm:px-8 sm:pb-8">
                        <div className="space-y-0 text-[14px] leading-relaxed text-white/78">
                            <section className="py-5">
                                <h2 className="text-[17px] font-semibold text-white">
                                    1. Description of the service
                                </h2>
                                <p className="mt-2">
                                    {APP_NAME} is an online coworking and focus-session platform
                                    that lets users join shared work sessions, host sessions,
                                    create structured session formats, and interact with other
                                    participants.
                                </p>
                                <p className="mt-2">
                                    We may improve, change, remove, or add features over time.
                                </p>
                            </section>

                            <div className="border-t border-white/10" />

                            <section className="py-5">
                                <h2 className="text-[17px] font-semibold text-white">
                                    2. Eligibility
                                </h2>
                                <p className="mt-2">
                                    You must be at least <span className="font-semibold text-white">13 years old</span>{" "}
                                    to use the Service.
                                </p>
                                <p className="mt-2">
                                    If you use {APP_NAME} on behalf of an organization, you
                                    represent that you have authority to bind that organization to
                                    these Terms.
                                </p>
                            </section>

                            <div className="border-t border-white/10" />

                            <section className="py-5">
                                <h2 className="text-[17px] font-semibold text-white">
                                    3. Accounts
                                </h2>
                                <p className="mt-2">
                                    Some features require an account. You agree to provide accurate
                                    information, keep your credentials secure, and remain
                                    responsible for activity under your account.
                                </p>
                                <p className="mt-2">
                                    We may suspend or terminate accounts that violate these Terms
                                    or create risk for the platform or its users.
                                </p>
                            </section>

                            <div className="border-t border-white/10" />

                            <section className="py-5">
                                <h2 className="text-[17px] font-semibold text-white">
                                    4. Acceptable use
                                </h2>
                                <p className="mt-2">You agree not to use {APP_NAME} to:</p>
                                <ul className="mt-3 list-disc space-y-1.5 pl-5 marker:text-white/45">
                                    <li>harass, threaten, abuse, or intimidate others;</li>
                                    <li>share unlawful, infringing, or harmful content;</li>
                                    <li>disrupt sessions or interfere with others’ experience;</li>
                                    <li>attempt unauthorized access to systems, rooms, or data;</li>
                                    <li>use scripts, bots, or automation to abuse the Service;</li>
                                    <li>
                                        record, distribute, or reuse other users’ content in
                                        violation of applicable law or without required consent.
                                    </li>
                                </ul>
                            </section>

                            <div className="border-t border-white/10" />

                            <section className="py-5">
                                <h2 className="text-[17px] font-semibold text-white">
                                    5. Sessions and hosts
                                </h2>
                                <p className="mt-2">
                                    Users may create and host sessions on {APP_NAME}. Hosts are
                                    responsible for the content, structure, moderation, and
                                    conduct of their sessions.
                                </p>
                                <p className="mt-2">
                                    We are not responsible for the behavior, statements, or
                                    interactions of users inside sessions.
                                </p>
                            </section>

                            <div className="border-t borderwhite/10 border-white/10" />

                            <section className="py-5">
                                <h2 className="text-[17px] font-semibold text-white">
                                    6. User content
                                </h2>
                                <p className="mt-2">
                                    You may submit profile information, session titles,
                                    descriptions, schedules, messages, and other content through
                                    the Service.
                                </p>
                                <p className="mt-2">
                                    You retain ownership of your content. However, you grant{" "}
                                    {APP_NAME} a limited, non-exclusive, worldwide, royalty-free
                                    license to host, store, process, reproduce, and display that
                                    content as needed to operate, maintain, and improve the
                                    Service.
                                </p>
                                <p className="mt-2">
                                    You represent that you have the rights necessary to provide
                                    your content and that it does not violate the rights of others
                                    or applicable law.
                                </p>
                            </section>

                            <div className="border-t border-white/10" />

                            <section className="py-5">
                                <h2 className="text-[17px] font-semibold text-white">
                                    7. Video and third-party services
                                </h2>
                                <p className="mt-2">
                                    {APP_NAME} may rely on third-party providers for video,
                                    hosting, authentication, analytics, payments, and related
                                    infrastructure.
                                </p>
                                <p className="mt-2">
                                    We are not responsible for outages, disruptions, or failures
                                    caused by third-party services.
                                </p>
                            </section>

                            <div className="border-t border-white/10" />

                            <section className="py-5">
                                <h2 className="text-[17px] font-semibold text-white">
                                    8. Paid features and billing
                                </h2>
                                <p className="mt-2">
                                    Some parts of the Service may become paid in the future. If
                                    that happens, pricing and billing terms will be presented
                                    before purchase or subscription.
                                </p>
                                <p className="mt-2">
                                    Unless stated otherwise, fees are non-refundable except where
                                    required by law.
                                </p>
                            </section>

                            <div className="border-t border-white/10" />

                            <section className="py-5">
                                <h2 className="text-[17px] font-semibold text-white">
                                    9. Termination and suspension
                                </h2>
                                <p className="mt-2">You may stop using the Service at any time.</p>
                                <p className="mt-2">
                                    We may suspend or terminate access if you violate these Terms,
                                    misuse the platform, create risk for users, or interfere with
                                    the integrity or stability of the Service.
                                </p>
                            </section>

                            <div className="border-t border-white/10" />

                            <section className="py-5">
                                <h2 className="text-[17px] font-semibold text-white">
                                    10. Disclaimer of warranties
                                </h2>
                                <p className="mt-2">
                                    The Service is provided on an{" "}
                                    <span className="font-semibold text-white">&quot;as is&quot;</span> and{" "}
                                    <span className="font-semibold text-white">&quot;as available&quot;</span>{" "}
                                    basis, without warranties of any kind, whether express or
                                    implied.
                                </p>
                                <p className="mt-2">
                                    We do not guarantee uninterrupted availability, error-free
                                    operation, or that the Service will meet your specific needs
                                    or productivity goals.
                                </p>
                            </section>

                            <div className="border-t border-white/10" />

                            <section className="py-5">
                                <h2 className="text-[17px] font-semibold text-white">
                                    11. Limitation of liability
                                </h2>
                                <p className="mt-2">
                                    To the maximum extent permitted by law, {APP_NAME} and its
                                    operators will not be liable for indirect, incidental,
                                    consequential, special, or punitive damages, or for any loss
                                    of profits, revenue, data, goodwill, or productivity arising
                                    from or related to your use of the Service.
                                </p>
                                <p className="mt-2">
                                    To the maximum extent permitted by law, our total liability
                                    for any claim relating to the Service will not exceed the
                                    amount you paid to us, if any, during the 12 months before the
                                    event giving rise to the claim.
                                </p>
                            </section>

                            <div className="border-t border-white/10" />

                            <section className="py-5">
                                <h2 className="text-[17px] font-semibold text-white">
                                    12. Indemnification
                                </h2>
                                <p className="mt-2">
                                    You agree to indemnify and hold harmless {APP_NAME} and its
                                    operators from claims, liabilities, damages, losses, and
                                    expenses arising out of or related to:
                                </p>
                                <ul className="mt-3 list-disc space-y-1.5 pl-5 marker:text-white/45">
                                    <li>your use of the Service;</li>
                                    <li>your content;</li>
                                    <li>your sessions or interactions with other users;</li>
                                    <li>your violation of these Terms or applicable law.</li>
                                </ul>
                            </section>

                            <div className="border-t border-white/10" />

                            <section className="py-5">
                                <h2 className="text-[17px] font-semibold text-white">
                                    13. Privacy
                                </h2>
                                <p className="mt-2">
                                    Your use of the Service is also subject to our{" "}
                                    <Link
                                        to="/privacy"
                                        className="underline underline-offset-2 text-white/90 transition hover:text-white"
                                    >
                                        Privacy Policy
                                    </Link>
                                    .
                                </p>
                            </section>

                            <div className="border-t border-white/10" />

                            <section className="py-5">
                                <h2 className="text-[17px] font-semibold text-white">
                                    14. Changes to these Terms
                                </h2>
                                <p className="mt-2">
                                    We may update these Terms from time to time. If we make
                                    material changes, we may update the date at the top of this
                                    page and take other reasonable steps to notify users where
                                    appropriate.
                                </p>
                                <p className="mt-2">
                                    Your continued use of the Service after updated Terms become
                                    effective means you accept the revised Terms.
                                </p>
                            </section>

                            <div className="border-t border-white/10" />

                            <section className="py-5">
                                <h2 className="text-[17px] font-semibold text-white">
                                    15. Governing law
                                </h2>
                                <p className="mt-2">
                                    These Terms are governed by the laws applicable to the
                                    operator of {APP_NAME}, unless mandatory consumer protection
                                    law in your jurisdiction requires otherwise.
                                </p>
                            </section>

                            <div className="border-t border-white/10" />

                            <section className="py-5">
                                <h2 className="text-[17px] font-semibold text-white">
                                    16. Contact
                                </h2>
                                <p className="mt-2">
                                    For questions about these Terms, contact:{" "}
                                    <a
                                        className="underline underline-offset-2 text-white/90 hover:text-white"
                                        href={`mailto:${SUPPORT_EMAIL}`}
                                    >
                                        {SUPPORT_EMAIL}
                                    </a>
                                </p>
                            </section>
                        </div>

                        <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
                            <Link
                                to="/"
                                className="text-[13px] text-white/60 transition hover:text-white/90"
                            >
                                ← Back to home
                            </Link>

                            <div className="flex flex-wrap items-center gap-2">
                                <Link
                                    to="/privacy"
                                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white/85 transition hover:bg-white/10"
                                >
                                    Privacy policy
                                </Link>

                                <Link
                                    to="/data-deletion"
                                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white/85 transition hover:bg-white/10"
                                >
                                    Data deletion
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}