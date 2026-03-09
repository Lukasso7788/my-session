// src/pages/Terms.tsx
import { Link } from "react-router-dom";

export default function Terms() {
    const lastUpdated = "March 9, 2026";

    return (
        <div className="min-h-screen bg-[#f8fafc] text-[#0f172a]">
            <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
                <div className="mb-6">
                    <Link
                        to="/"
                        className="inline-flex items-center text-sm text-[#2563eb] hover:text-[#1d4ed8] hover:underline"
                    >
                        ← Back to MySession
                    </Link>
                </div>

                <div className="overflow-hidden rounded-3xl border border-[#e2e8f0] bg-white shadow-sm">
                    <div className="border-b border-[#e2e8f0] px-6 py-8 sm:px-10">
                        <div className="mb-3 inline-flex items-center rounded-full border border-[#dbeafe] bg-[#eff6ff] px-3 py-1 text-xs font-medium text-[#1d4ed8]">
                            Legal
                        </div>
                        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                            Terms of Service
                        </h1>
                        <p className="mt-3 text-sm text-[#475569]">
                            Last updated: {lastUpdated}
                        </p>
                        <p className="mt-5 max-w-3xl text-[15px] leading-7 text-[#334155]">
                            Welcome to <span className="font-semibold">MySession</span>.
                            These Terms of Service govern your access to and use of the
                            MySession website, platform, video rooms, focus sessions, and
                            related services. By accessing or using MySession, you agree to be
                            bound by these Terms.
                        </p>
                    </div>

                    <div className="px-6 py-8 sm:px-10">
                        <div className="prose prose-slate max-w-none prose-headings:scroll-mt-24 prose-h2:mt-10 prose-h2:text-xl prose-h2:font-semibold prose-p:text-[15px] prose-p:leading-7 prose-li:text-[15px] prose-li:leading-7">
                            <h2>1. Description of the Service</h2>
                            <p>
                                MySession is an online coworking and focus session platform that
                                allows users to join shared work sessions, host sessions, create
                                structured work formats, and interact with other participants.
                            </p>
                            <p>
                                We may update, improve, remove, or change parts of the Service
                                over time.
                            </p>

                            <h2>2. Eligibility</h2>
                            <p>
                                You must be at least <strong>13 years old</strong> to use the
                                Service.
                            </p>
                            <p>
                                If you use MySession on behalf of a company, organization, or
                                other entity, you represent that you have authority to bind that
                                entity to these Terms.
                            </p>

                            <h2>3. Accounts</h2>
                            <p>
                                Some features require an account. You agree to provide accurate
                                information and keep your login credentials secure.
                            </p>
                            <p>
                                You are responsible for activity that occurs under your account.
                                If you believe your account has been compromised, you should
                                stop using the Service until you have secured access.
                            </p>

                            <h2>4. Acceptable Use</h2>
                            <p>You agree not to use MySession to:</p>
                            <ul>
                                <li>harass, threaten, abuse, or intimidate others;</li>
                                <li>share unlawful, infringing, or harmful content;</li>
                                <li>disrupt sessions or interfere with the experience of others;</li>
                                <li>attempt to gain unauthorized access to systems or data;</li>
                                <li>use bots, scripts, or automation to abuse the platform;</li>
                                <li>record or distribute other users’ audio, video, or content in violation of applicable law.</li>
                            </ul>
                            <p>
                                We may remove content, restrict access, suspend accounts, or
                                take other action if we reasonably believe a user has violated
                                these Terms or created risk for the platform or its users.
                            </p>

                            <h2>5. Sessions and Hosts</h2>
                            <p>
                                Users may create or host sessions on MySession. Hosts are
                                responsible for the content, structure, moderation, and conduct
                                of their sessions.
                            </p>
                            <p>
                                We are not responsible for the behavior, statements, or actions
                                of users inside sessions.
                            </p>

                            <h2>6. User Content</h2>
                            <p>
                                You may submit or make available content through the Service,
                                including profile information, session descriptions, messages,
                                titles, schedules, and other materials.
                            </p>
                            <p>
                                You retain ownership of your content. However, you grant
                                MySession a non-exclusive, worldwide, royalty-free license to
                                host, store, process, reproduce, and display that content only
                                as needed to operate, maintain, and improve the Service.
                            </p>
                            <p>
                                You represent that you have the rights necessary to submit your
                                content and that your content does not violate the law or the
                                rights of others.
                            </p>

                            <h2>7. Video, Infrastructure, and Third-Party Services</h2>
                            <p>
                                MySession may rely on third-party services and infrastructure,
                                including video, hosting, analytics, authentication, payments,
                                and communication tools.
                            </p>
                            <p>
                                We are not responsible for outages, interruptions, data loss, or
                                service failures caused by third-party providers.
                            </p>

                            <h2>8. Paid Features and Billing</h2>
                            <p>
                                Some parts of the Service may become paid in the future. If paid
                                features are introduced, pricing and billing terms will be
                                presented clearly before purchase.
                            </p>
                            <p>
                                Unless otherwise stated, fees are non-refundable except where
                                required by law.
                            </p>

                            <h2>9. Termination and Suspension</h2>
                            <p>
                                You may stop using the Service at any time.
                            </p>
                            <p>
                                We may suspend or terminate your access if you violate these
                                Terms, misuse the platform, create risk for users, or interfere
                                with the stability or integrity of the Service.
                            </p>

                            <h2>10. Disclaimer of Warranties</h2>
                            <p>
                                The Service is provided on an <strong>&quot;as is&quot;</strong> and{" "}
                                <strong>&quot;as available&quot;</strong> basis, without warranties
                                of any kind, whether express or implied.
                            </p>
                            <p>We do not guarantee that the Service will be uninterrupted, secure, error-free, or suitable for your specific needs.</p>
                            <p>
                                MySession is a productivity and coworking platform, not a
                                medical, mental health, or professional advisory service.
                            </p>

                            <h2>11. Limitation of Liability</h2>
                            <p>
                                To the maximum extent permitted by law, MySession and its
                                operators will not be liable for any indirect, incidental,
                                special, consequential, or punitive damages, or for any loss of
                                profits, revenues, data, business, goodwill, or productivity,
                                arising out of or related to your use of the Service.
                            </p>
                            <p>
                                To the maximum extent permitted by law, our total liability for
                                any claim relating to the Service will not exceed the amount you
                                paid to us, if any, during the 12 months before the event giving
                                rise to the claim.
                            </p>

                            <h2>12. Indemnification</h2>
                            <p>
                                You agree to indemnify and hold harmless MySession and its
                                operators from claims, liabilities, damages, losses, and
                                expenses arising out of or related to:
                            </p>
                            <ul>
                                <li>your use of the Service;</li>
                                <li>your content;</li>
                                <li>your sessions or interactions with other users;</li>
                                <li>your violation of these Terms or applicable law.</li>
                            </ul>

                            <h2>13. Privacy</h2>
                            <p>
                                Your use of the Service is also subject to our{" "}
                                <Link to="/privacy" className="text-[#2563eb] hover:underline">
                                    Privacy Policy
                                </Link>
                                , which explains how we collect, use, and store information.
                            </p>

                            <h2>14. Changes to These Terms</h2>
                            <p>
                                We may update these Terms from time to time. If we make material
                                changes, we may update the date at the top of this page and take
                                other reasonable steps to notify users where appropriate.
                            </p>
                            <p>
                                Your continued use of the Service after updated Terms become
                                effective means you accept the revised Terms.
                            </p>

                            <h2>15. Governing Law</h2>
                            <p>
                                These Terms are governed by and interpreted in accordance with
                                the laws applicable to the operator of MySession, unless
                                otherwise required by mandatory consumer protection law in your
                                jurisdiction.
                            </p>

                            <h2>16. Contact</h2>
                            <p>
                                If you have questions about these Terms, you can contact us at:{" "}
                                <a
                                    href="mailto:support@mysession.club"
                                    className="text-[#2563eb] hover:underline"
                                >
                                    support@mysession.club
                                </a>
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}