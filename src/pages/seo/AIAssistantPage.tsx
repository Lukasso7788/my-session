// src/pages/seo/AIAssistantPage.tsx
import React from "react";
import { Link } from "react-router-dom";

export default function AIAssistantPage() {
    return (
        <main className="min-h-screen bg-white text-[#2F2F2F] font-inter">
            <div className="max-w-[980px] mx-auto px-4 md:px-8 py-16">
                <div className="text-[12px] tracking-wide text-[#606060] mb-3">
                    MySession • SEO Pillar
                </div>

                <h1 className="text-[30px] md:text-[42px] font-normal leading-tight">
                    Real-time AI assistant for focus sessions
                </h1>

                <p className="mt-5 text-[14px] md:text-[16px] text-[#606060] leading-relaxed">
                    MySession includes an AI assistant built into the focus loop: it helps you choose the next step,
                    break down tasks, and keep momentum during live body doubling / online coworking sessions.
                    Screenshare support can be used to unblock you without leaving the session.
                </p>

                <div className="mt-8 flex flex-col sm:flex-row gap-3">
                    <Link
                        to="/sessions"
                        className="h-12 rounded-full px-7 text-[14px] font-semibold bg-[#111827] text-white hover:opacity-90 transition inline-flex items-center justify-center"
                    >
                        Browse sessions
                    </Link>

                    <Link
                        to="/"
                        className="h-12 rounded-full px-7 text-[14px] font-semibold border border-[#2F2F2F] text-[#2F2F2F] hover:bg-[#2F2F2F] hover:text-white transition inline-flex items-center justify-center"
                    >
                        Back to home
                    </Link>
                </div>
            </div>
        </main>
    );
}
