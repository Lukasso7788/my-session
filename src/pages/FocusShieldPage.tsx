import React from "react";

export default function FocusShieldPage() {
    return (
        <main className="min-h-screen bg-white text-gray-950">
            <div className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-14">
                <div className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm">
                    <div className="mb-4 inline-flex rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
                        🛡 FocusShield by MySession
                    </div>

                    <h1 className="text-4xl font-bold tracking-tight text-gray-950">
                        Block distracting websites instantly.
                    </h1>

                    <p className="mt-4 max-w-2xl text-lg leading-8 text-gray-600">
                        FocusShield helps you block social media, video feeds, news sites,
                        and even specific pages like YouTube Shorts or a single YouTube
                        channel while you work.
                    </p>

                    <div className="mt-8 flex flex-wrap gap-3">
                        <a
                            href="/focusshield/extension"
                            className="rounded-2xl bg-gray-950 px-5 py-3 text-sm font-semibold text-white hover:bg-gray-800"
                        >
                            Install Chrome / Edge Extension
                        </a>

                        <a
                            href="/sessions"
                            className="rounded-2xl border border-gray-300 px-5 py-3 text-sm font-semibold text-gray-900 hover:bg-gray-50"
                        >
                            Back to MySession
                        </a>
                    </div>
                </div>

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
                        <h2 className="font-semibold text-gray-950">Built for focus</h2>
                        <p className="mt-2 text-sm leading-6 text-gray-600">
                            Designed to work together with MySession deep work sessions.
                        </p>
                    </div>
                </section>

                <section className="rounded-3xl bg-gray-50 p-6">
                    <h2 className="text-xl font-semibold text-gray-950">
                        How to use it
                    </h2>

                    <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-gray-700">
                        <li>Install the FocusShield Chrome / Edge extension.</li>
                        <li>Open the extension from your browser toolbar.</li>
                        <li>Select sites, categories, or paste custom links/pages.</li>
                        <li>Click Activate Shield.</li>
                    </ol>
                </section>
            </div>
        </main>
    );
}