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
        <main className="min-h-screen bg-white text-gray-950">
            <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-14">
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
                            <><div className="font-semibold">Could not reach FocusShield Desktop</div><p className="mt-1 text-sm opacity-75">Open the desktop app and press Connect MySession again. The pairing code can only be used once.</p></>
                        )}
                    </section>
                )}
                <section className="rounded-[32px] border border-gray-200 bg-white p-8 shadow-sm md:p-10">
                    <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
                        <img src="/icons/focus-shield.svg" className="h-4 w-4" alt="" />
                        <span>FocusShield by MySession</span>
                    </div>

                    <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
                        <div>
                            <h1 className="text-4xl font-bold tracking-tight text-gray-950 md:text-5xl">
                                FocusShield
                            </h1>

                            <p className="mt-4 max-w-2xl text-xl font-medium leading-8 text-gray-800">
                                Instant website and page blocker for deep work.
                            </p>

                            <p className="mt-4 max-w-2xl text-base leading-7 text-gray-600">
                                Block distracting websites, social feeds, news, YouTube Shorts,
                                or even one specific YouTube channel while you work in MySession.
                            </p>

                            <div className="mt-8 flex flex-wrap gap-3">
                                <a
                                    href="/downloads/focusshield-extension.zip"
                                    download
                                    className="inline-flex items-center gap-2 rounded-2xl bg-gray-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-gray-800"
                                >
                                    <img src="/icons/install-extension.svg" className="h-5 w-5" alt="" />
                                    <span>Download Chrome / Edge Extension</span>
                                </a>

                                <a
                                    href="/sessions"
                                    className="rounded-2xl border border-gray-300 px-5 py-3 text-sm font-semibold text-gray-900 transition hover:bg-gray-50"
                                >
                                    Back to MySession
                                </a>
                            </div>

                            <p className="mt-3 max-w-2xl text-xs leading-5 text-gray-500">
                                Dev install: download the zip, unzip it, open Chrome Extensions,
                                click “Load unpacked”, and select the nested{" "}
                                <span className="font-mono font-semibold text-gray-700">
                                    focusshield-extension/extension
                                </span>{" "}
                                folder — not the top-level unzipped folder.
                            </p>
                        </div>

                        <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-[32px] border border-gray-200 bg-gray-50 md:h-36 md:w-36">
                            <img src="/icons/focus-shield.svg" className="h-16 w-16 md:h-20 md:w-20" alt="FocusShield" />
                        </div>
                    </div>
                </section>

                <section className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-2xl border border-gray-200 p-5">
                        <h2 className="font-semibold text-gray-950">Instant blocking</h2>
                        <p className="mt-2 text-sm leading-6 text-gray-600">
                            Already-open distracting tabs are redirected immediately.
                        </p>
                    </div>

                    <div className="rounded-2xl border border-gray-200 p-5">
                        <h2 className="font-semibold text-gray-950">Page-level control</h2>
                        <p className="mt-2 text-sm leading-6 text-gray-600">
                            Block all of YouTube, only Shorts, or one specific channel.
                        </p>
                    </div>

                    <div className="rounded-2xl border border-gray-200 p-5">
                        <h2 className="font-semibold text-gray-950">MySession-native</h2>
                        <p className="mt-2 text-sm leading-6 text-gray-600">
                            Built as a focus layer for MySession deep work sessions.
                        </p>
                    </div>
                </section>

                <section className="rounded-3xl bg-gray-50 p-6">
                    <h2 className="text-xl font-semibold text-gray-950">
                        How to install
                    </h2>

                    <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-gray-700">
                        <li>Click “Download Chrome / Edge Extension”.</li>
                        <li>Unzip the downloaded file.</li>
                        <li>
                            Open{" "}
                            <span className="font-mono">chrome://extensions</span>{" "}
                            or <span className="font-mono">edge://extensions</span>.
                        </li>
                        <li>Enable Developer mode.</li>
                        <li>Click “Load unpacked”.</li>
                        <li>
                            Select the nested{" "}
                            <span className="font-mono font-semibold text-gray-950">
                                focusshield-extension/extension
                            </span>{" "}
                            folder.
                        </li>
                        <li>
                            Do not select the top-level unzipped folder. Chrome / Edge needs the
                            folder that directly contains the extension files, including{" "}
                            <span className="font-mono">manifest.json</span>.
                        </li>
                    </ol>

                    <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                        <div className="font-semibold">Important</div>
                        <p className="mt-1">
                            If “Load unpacked” does nothing or shows a manifest error, you probably
                            selected the wrong folder. Go one level deeper and choose{" "}
                            <span className="font-mono font-semibold">
                                focusshield-extension/extension
                            </span>.
                        </p>
                    </div>
                </section>
            </div>
        </main>
    );
}
