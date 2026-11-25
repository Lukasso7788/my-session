import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function FocusShieldPage() {
    const [searchParams] = useSearchParams();
    const desktopConnectNonce = String(searchParams.get("desktopConnect") || "").trim();
    const [desktopConnectState, setDesktopConnectState] = useState<
        "idle" | "connecting" | "login-required" | "connected" | "failed"
    >("idle");

    useEffect(() => {
        if (!/^[a-f0-9]{48}$/i.test(desktopConnectNonce)) return;
        let cancelled = false;

        const connectDesktop = async () => {
            setDesktopConnectState("connecting");
            const { data } = await supabase.auth.getSession();
            const session = data.session;
            if (!session) {
                if (!cancelled) setDesktopConnectState("login-required");
                return;
            }

            try {
                const response = await fetch("http://127.0.0.1:43117/v1/connect", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        nonce: desktopConnectNonce,
                        supabaseUrl: String(import.meta.env.VITE_SUPABASE_URL || ""),
                        anonKey: String(import.meta.env.VITE_SUPABASE_ANON_KEY || ""),
                        accessToken: session.access_token,
                        refreshToken: session.refresh_token,
                        expiresAt: session.expires_at,
                        user: {
                            id: session.user.id,
                            email: session.user.email || "",
                            user_metadata: session.user.user_metadata || {},
                        },
                    }),
                });
                if (!response.ok) throw new Error("desktop_pairing_failed");
                if (!cancelled) setDesktopConnectState("connected");
            } catch {
                if (!cancelled) setDesktopConnectState("failed");
            }
        };

        void connectDesktop();
        return () => { cancelled = true; };
    }, [desktopConnectNonce]);

    const desktopRedirect = `/focus-shield?desktopConnect=${encodeURIComponent(desktopConnectNonce)}`;

    return (
        <main className="min-h-screen bg-[#f5f6f8] text-[#202124]">
            <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 md:py-12">
                <nav className="mb-10 flex items-center justify-between" aria-label="FocusShield navigation">
                    <Link to="/" className="text-base font-semibold text-[#5286f6]">MySession</Link>
                    <Link to="/sessions" className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium hover:bg-gray-50">Back to MySession</Link>
                </nav>
                {desktopConnectState !== "idle" && (
                    <section className="rounded-[24px] border border-[#BEEBC1] bg-[#F1FCF2] px-6 py-5 text-[#173D1A]">
                        {desktopConnectState === "connecting" && (
                            <><div className="font-semibold">Connecting FocusShield Desktop…</div><p className="mt-1 text-sm opacity-75">Keep the desktop app open for a moment.</p></>
                        )}
                        {desktopConnectState === "connected" && (
                            <><div className="font-semibold">FocusShield Desktop is connected</div><p className="mt-1 text-sm opacity-75">You can close this tab. Policies will now synchronize between your computers.</p></>
                        )}
                        {desktopConnectState === "login-required" && (
                            <>
                                <div className="font-semibold">Log in to connect this computer</div>
                                <p className="mt-1 text-sm opacity-75">Use your existing Discord, Google, or email MySession account.</p>
                                <Link to={`/login?redirect=${encodeURIComponent(desktopRedirect)}`} className="mt-3 inline-flex rounded-xl bg-[#1F2A21] px-4 py-2 text-sm font-semibold text-white">Log in to MySession</Link>
                            </>
                        )}
                        {desktopConnectState === "failed" && (
                            <><div className="font-semibold">Could not reach FocusShield Desktop</div><p className="mt-1 text-sm opacity-75">Open the desktop app and try connecting again. The pairing code can only be used once.</p></>
                        )}
                    </section>
                )}
                <header className="mb-9 max-w-3xl">
                    <div className="mb-5 flex items-center gap-3">
                        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#5286f6]"><img src="/icons/focus-shield.svg" className="h-7 w-7" alt="" /></span>
                        <span className="text-sm font-semibold text-gray-600">FocusShield by MySession</span>
                    </div>
                    <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">FocusShield</h1>
                    <p className="mt-5 text-lg leading-8 text-gray-600">Block distracting apps and websites, plan focus time, and get help from AI Coach. Start with the FocusShield app for Windows.</p>
                </header>

                <section className="grid gap-5 lg:grid-cols-[1.35fr_1fr]" aria-label="Download FocusShield">
                    <article className="rounded-3xl bg-[#202b43] p-7 text-white sm:p-8" aria-labelledby="desktop-download-title">
                        <p className="text-sm font-medium text-[#b6ceff]">The FocusShield desktop app</p>
                        <h2 id="desktop-download-title" className="mt-3 text-3xl font-semibold">Your focus, protected on Windows.</h2>
                        <a href="https://github.com/Lukasso7788/focus-shield-releases/releases/download/v0.4.15/FocusShield-Setup-0.4.15.exe" className="mt-7 inline-flex items-center justify-center rounded-full bg-[#5286f6] px-6 py-3.5 text-base font-semibold text-white transition hover:bg-[#4477e3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Download FocusShield for Windows</a>
                        <p className="mt-4 text-sm leading-6 text-[#b6c4de]">Version 0.4.15 · Windows 10 / 11 · 64-bit · About 544 MB</p>
                        <p className="mt-4 text-base leading-7 text-[#d1daeb]">Block selected applications, run independent focus timers, save block lists and schedules, or work on one task in Hyper Focus. Switch between FocusShield, Hyper Focus and AI Coach at the top. All three can run together. AI Coach can remind you about distractions and suggest a next step.</p>
                        <a href="#install-desktop" className="mt-3 inline-block text-sm font-medium text-white underline underline-offset-4">Windows installation instructions</a>
                    </article>
                    <article className="rounded-3xl border border-gray-200 bg-white p-7 sm:p-8" aria-labelledby="extension-download-title">
                        <p className="text-sm font-medium text-[#4678d8]">Add website blocking in your browser</p>
                        <h2 id="extension-download-title" className="mt-3 text-2xl font-semibold">Chrome &amp; Edge extension</h2>
                        <p className="mt-4 text-base leading-7 text-gray-600">Extension files are included with the Windows app. Click Browser extension in FocusShield to enable website blocking in Chrome or Edge. A separate ZIP is also available below.</p>
                        <a href="/downloads/focusshield-extension.zip" download className="mt-7 inline-flex items-center justify-center rounded-full border border-gray-300 px-5 py-3 text-base font-semibold transition hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5286f6]">Download browser extension</a>
                        <p className="mt-4 text-sm leading-6 text-gray-500">Version 0.2.5 · Included in the Windows installer · Optional ZIP</p>
                        <a href="#install-extension" className="mt-3 inline-block text-sm font-medium text-[#4678d8] underline underline-offset-4">Browser installation instructions</a>
                    </article>
                </section>

                <section className="mt-6 grid gap-4 md:grid-cols-3" aria-label="How FocusShield helps">
                    {[
                        ["Block what pulls you away", "Choose Windows applications, websites or individual URLs. Website blocking uses the browser extension."],
                        ["Make focus a routine", "Save reusable lists, schedule focus windows and run multiple independent sessions. Keep the app running in the tray."],
                        ["Stay on track", "Use distraction reminders and task advice together. Choose “Install package for AI usage” in the app to get started (about 3.4 GB download)."],
                    ].map(([title, description]) => <article key={title} className="rounded-2xl border border-gray-200 bg-white p-6"><h2 className="text-base font-semibold">{title}</h2><p className="mt-3 text-base leading-7 text-gray-600">{description}</p></article>)}
                </section>

                <section id="install-desktop" className="mt-12 scroll-mt-6 rounded-3xl border border-gray-200 bg-white p-7 sm:p-8" aria-labelledby="install-desktop-title">
                    <p className="text-sm font-medium text-[#4678d8]">Start here</p>
                    <h2 id="install-desktop-title" className="mt-2 text-2xl font-semibold">Install the Windows app</h2>
                    <ol className="mt-6 list-decimal space-y-4 pl-6 text-base leading-7 text-gray-600 marker:font-semibold marker:text-[#4678d8]">
                        <li>Click <strong className="text-gray-900">Download FocusShield for Windows</strong> and wait for the EXE to finish downloading.</li>
                        <li>Run <code className="break-all text-sm text-gray-900">FocusShield-Setup-0.4.15.exe</code> and follow the installer. If FocusShield is already open, finish your active sessions and close it before upgrading.</li>
                        <li>Open FocusShield from your desktop or Start menu. Choose the apps to block, set a duration, then start your session.</li>
                        <li>For website blocking, click Browser extension in FocusShield. The files are already included. Follow the one-time browser steps below and keep FocusShield running in the system tray.</li>
                        <li>Need to stop Locked Mode early? In the Windows app, use <strong className="text-gray-900">Cancel Locked Mode (use 1)</strong>. You start with one cancellation and earn one every 7 days; unused cancellations stack on this computer.</li>
                        <li>To use AI Coach, choose the AI Coach tab at the top and click <strong className="text-gray-900">Install package for AI usage</strong>. Once the download finishes, enter your task and start coaching.</li>
                    </ol>
                    <div className="mt-6 rounded-2xl bg-[#edf3ff] p-5 text-base leading-7 text-[#2a426e]"><strong>Future desktop updates</strong><p className="mt-1">When a new release is available, FocusShield shows “New version available”. Click “Click to update” to download it, then “Restart to install” after your active sessions finish.</p></div>
                </section>

                <section id="install-extension" className="mt-6 scroll-mt-6 rounded-3xl border border-gray-200 bg-white p-7 sm:p-8" aria-labelledby="install-extension-title">
                    <h2 id="install-extension-title" className="text-2xl font-semibold">Install the browser extension</h2>
                    <p className="mt-3 text-base leading-7 text-gray-600">The extension comes with the Windows installer. Enable it once in each Chrome or Edge profile. The browser requires this confirmation; installing the EXE alone does not activate website blocking.</p>
                    <ol className="mt-6 list-decimal space-y-4 pl-6 text-base leading-7 text-gray-600 marker:font-semibold marker:text-[#4678d8]">
                        <li>In FocusShield, click <strong className="text-gray-900">Browser extension</strong>, then <strong className="text-gray-900">Copy folder path</strong>. No extra download or extraction is needed.</li>
                        <li>Open <code className="break-all text-sm text-gray-900">chrome://extensions</code> in Chrome, or <code className="break-all text-sm text-gray-900">edge://extensions</code> in Edge.</li>
                        <li>Turn on <strong className="text-gray-900">Developer mode</strong>, then click <strong className="text-gray-900">Load unpacked</strong>.</li>
                        <li>Paste the copied path into the folder picker and select that folder. This folder directly contains <code className="text-sm text-gray-900">manifest.json</code>, <code className="text-sm text-gray-900">service_worker.js</code> and <code className="text-sm text-gray-900">popup.html</code>.</li>
                        <li>Make sure <strong className="text-gray-900">FocusShield by MySession</strong> is enabled. Open the desktop app and check that its browser-extension indicator is connected.</li>
                        <li>Start a short session with a distracting site selected, then open that site to check the blocking screen. Repeat installation in each browser profile you want to protect.</li>
                    </ol>
                    <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-5 text-base leading-7 text-gray-600"><strong className="text-gray-900">If Chrome or Edge reports a missing manifest</strong><p className="mt-1">Use Copy folder path or Open extension folder in the app to find the folder containing manifest.json. Keep only one FocusShield extension per profile. After upgrading the app, click Reload on the browser’s Extensions page to load the bundled files. ZIP users can extract the optional download to a permanent folder and select the focusshield-extension folder instead.</p></div>
                </section>

                <footer className="py-8 text-sm leading-6 text-gray-500">FocusShield is a Windows app with a companion browser extension. No MySession account is needed to use the app or its browser extension.</footer>
            </div>
        </main>
    );
}
