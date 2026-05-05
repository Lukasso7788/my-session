import React from "react";

export default function FocusShieldPage() {
    return (
        <main className="min-h-screen bg-white text-gray-950">
            <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-14">
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

                            <p className="mt-3 text-xs leading-5 text-gray-500">
                                Dev install: download the zip, unzip it, then open Chrome Extensions
                                and click “Load unpacked”.
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
                        <li>Open <span className="font-mono">chrome://extensions</span> or <span className="font-mono">edge://extensions</span>.</li>
                        <li>Enable Developer mode.</li>
                        <li>Click “Load unpacked” and select the unzipped FocusShield extension folder.</li>
                    </ol>
                </section>
            </div>
        </main>
    );
}