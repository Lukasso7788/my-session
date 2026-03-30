import { Link } from "react-router-dom";

const SUPPORT_EMAIL = "misha1915@live.ru"; // TODO: replace with your main support email
const DISCORD_URL = "https://discord.com";
const TELEGRAM_URL = "https://t.me";
const TWITTER_URL = "https://twitter.com";

export default function Footer() {
    return (
        <footer className="w-full bg-white border-t border-[#EAEAEA]">
            <div className="w-full px-3 md:px-6 lg:px-10">
                <div className="py-10">
                    {/* Top row */}
                    <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
                        {/* Brand */}
                        <div className="max-w-[420px]">
                            <div className="text-[22px] font-semibold text-[#2F2F2F]">
                                MySession
                            </div>

                            <p className="mt-3 text-[14px] leading-relaxed text-[#606060]">
                                High-accountability focus sessions with structured check-ins,
                                intentions tracking, and AI assistance — so you actually move
                                your work forward.
                            </p>

                            <div className="mt-4 flex flex-wrap items-center gap-2">
                                <span className="text-[12px] px-3 py-1 rounded-full border border-[#DBD8D8] text-[#2F2F2F]">
                                    No downloads
                                </span>
                                <span className="text-[12px] px-3 py-1 rounded-full border border-[#DBD8D8] text-[#2F2F2F]">
                                    Browser-based
                                </span>
                                <span className="text-[12px] px-3 py-1 rounded-full border border-[#DBD8D8] text-[#2F2F2F]">
                                    Structured accountability
                                </span>
                            </div>
                        </div>

                        {/* Links */}
                        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
                            <div className="flex flex-col gap-3">
                                <div className="text-[12px] font-semibold tracking-wide text-[#2F2F2F]">
                                    Product
                                </div>

                                <Link
                                    className="text-[14px] text-[#606060] hover:text-[#2F2F2F]"
                                    to="/sessions"
                                >
                                    Sessions
                                </Link>

                                <Link
                                    className="text-[14px] text-[#606060] hover:text-[#2F2F2F]"
                                    to="/pricing"
                                >
                                    Pricing
                                </Link>

                                <Link
                                    className="text-[14px] text-[#606060] hover:text-[#2F2F2F]"
                                    to="/updates"
                                >
                                    Latest updates
                                </Link>

                                <Link
                                    className="text-[14px] text-[#606060] hover:text-[#2F2F2F]"
                                    to="/blog"
                                >
                                    Blog
                                </Link>
                            </div>

                            <div className="flex flex-col gap-3">
                                <div className="text-[12px] font-semibold tracking-wide text-[#2F2F2F]">
                                    Legal
                                </div>

                                <Link
                                    className="text-[14px] text-[#606060] hover:text-[#2F2F2F]"
                                    to="/rules"
                                >
                                    Rules
                                </Link>

                                <Link
                                    className="text-[14px] text-[#606060] hover:text-[#2F2F2F]"
                                    to="/terms"
                                >
                                    Terms
                                </Link>

                                <Link
                                    className="text-[14px] text-[#606060] hover:text-[#2F2F2F]"
                                    to="/privacy"
                                >
                                    Privacy
                                </Link>

                                <Link
                                    className="text-[14px] text-[#606060] hover:text-[#2F2F2F]"
                                    to="/refund-policy"
                                >
                                    Refund Policy
                                </Link>

                                <Link
                                    className="text-[14px] text-[#606060] hover:text-[#2F2F2F]"
                                    to="/data-deletion"
                                >
                                    Data deletion
                                </Link>
                            </div>

                            <div className="flex flex-col gap-3">
                                <div className="text-[12px] font-semibold tracking-wide text-[#2F2F2F]">
                                    Support
                                </div>

                                <Link
                                    className="text-[14px] text-[#606060] hover:text-[#2F2F2F]"
                                    to="/contact"
                                >
                                    Contact page
                                </Link>

                                <a
                                    className="text-[14px] text-[#606060] hover:text-[#2F2F2F]"
                                    href={`mailto:${SUPPORT_EMAIL}`}
                                >
                                    {SUPPORT_EMAIL}
                                </a>

                                <Link
                                    className="text-[14px] text-[#606060] hover:text-[#2F2F2F]"
                                    to="/updates"
                                >
                                    Updates
                                </Link>

                                <Link
                                    className="text-[14px] text-[#606060] hover:text-[#2F2F2F]"
                                    to="/pricing"
                                >
                                    Billing info
                                </Link>
                            </div>
                        </div>
                    </div>

                    {/* Bottom row */}
                    <div className="mt-10 pt-6 border-t border-[#EAEAEA] flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-[13px] text-[#606060]">
                            © {new Date().getFullYear()} MySession. All rights reserved.
                        </div>

                        <div className="flex items-center gap-4">
                            <a
                                className="text-[13px] text-[#606060] hover:text-[#2F2F2F]"
                                href={TWITTER_URL}
                                target="_blank"
                                rel="noreferrer"
                            >
                                Twitter
                            </a>

                            <a
                                className="text-[13px] text-[#606060] hover:text-[#2F2F2F]"
                                href={DISCORD_URL}
                                target="_blank"
                                rel="noreferrer"
                            >
                                Discord
                            </a>

                            <a
                                className="text-[13px] text-[#606060] hover:text-[#2F2F2F]"
                                href={TELEGRAM_URL}
                                target="_blank"
                                rel="noreferrer"
                            >
                                Telegram
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </footer>
    );
}