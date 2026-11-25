import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowDownToLine, ArrowRight, Check, Monitor, Smartphone } from "lucide-react";
import { WINDOWS_APP_DOWNLOAD } from "../lib/appDownloads";

export default function DownloadAppPage() {
    useEffect(() => {
        const previous = document.title;
        document.title = "Download the MySession app | MySession";
        return () => { document.title = previous; };
    }, []);

    return (
        <main className="bg-[#F7F8FA] text-[#2F2F2F]">
            <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-20">
                <div className="max-w-2xl">
                    <span className="inline-flex items-center gap-2 rounded-full border border-[#DCE5F5] bg-white px-3 py-1.5 text-xs font-medium text-[#315DCB]">
                        <Monitor size={14} aria-hidden="true" /> MySession, on your desktop
                    </span>
                    <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">A little more space<br className="hidden sm:block" /> for your focus.</h1>
                    <p className="mt-5 max-w-xl text-base leading-7 text-[#63666D]">Give your focus sessions a window of their own. Download MySession, sign in with your existing account, and join your next room.</p>
                </div>

                <div className="mt-10 grid items-start gap-5 md:grid-cols-[1.4fr_1fr]">
                    <section id="windows" aria-labelledby="windows-app-heading" className="scroll-mt-24 rounded-3xl border border-[#DFE4EB] bg-white p-6 shadow-sm sm:p-8">
                        <div className="flex items-center justify-between gap-3">
                            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#EDF3FF] text-[#315DCB]"><Monitor size={24} aria-hidden="true" /></div>
                            <span className="rounded-full bg-[#F1F4F8] px-3 py-1 text-xs font-medium text-[#60656E]">Available now</span>
                        </div>
                        <h2 id="windows-app-heading" className="mt-6 text-2xl font-semibold">MySession for Windows</h2>
                        <p className="mt-2 text-sm leading-6 text-[#686C73]">Your rooms, your account, and your community — in a dedicated desktop app.</p>
                        <ul className="mt-6 space-y-3 text-sm text-[#50555E]">
                            {["Use your existing MySession account", "Keep your sessions in their own window", "Check for app updates from the app menu"].map(text => (
                                <li key={text} className="flex items-start gap-2.5"><Check size={16} className="mt-0.5 shrink-0 text-[#5288FF]" aria-hidden="true" />{text}</li>
                            ))}
                        </ul>
                        <a href={WINDOWS_APP_DOWNLOAD.url} className="mt-8 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#2F2F2F] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#444444] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5288FF]">
                            <ArrowDownToLine size={18} aria-hidden="true" /> Download for Windows
                        </a>
                        <p className="mt-3 text-center text-xs leading-5 text-[#737780]">{WINDOWS_APP_DOWNLOAD.platform} · Version {WINDOWS_APP_DOWNLOAD.version} · {WINDOWS_APP_DOWNLOAD.size}</p>
                        <p className="mt-1 text-center text-xs text-[#737780]">Installer hosted on our GitHub releases.</p>
                    </section>

                    <section id="android" aria-labelledby="android-app-heading" className="scroll-mt-24 rounded-3xl border border-[#E2E5EA] bg-[#F0F2F5] p-6 sm:p-8">
                        <div className="grid h-12 w-12 place-items-center rounded-2xl border border-white bg-white/70 text-[#747B87]"><Smartphone size={24} aria-hidden="true" /></div>
                        <h2 id="android-app-heading" className="mt-6 text-xl font-semibold">MySession for Android</h2>
                        <span className="mt-3 inline-block rounded-full border border-[#D9DDE4] px-3 py-1 text-xs font-medium text-[#626A77]">In development</span>
                        <p className="mt-4 text-sm leading-6 text-[#686C73]">The Android app is not publicly available yet. You can still join MySession from your browser on your phone or tablet.</p>
                        <Link to="/sessions" className="mt-5 inline-flex items-center gap-2 rounded text-sm font-medium text-[#315DCB] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5288FF]">Continue in your browser <ArrowRight size={15} aria-hidden="true" /></Link>
                    </section>
                </div>

                <section aria-labelledby="app-install-heading" className="mt-10 rounded-3xl border border-[#E2E5EA] bg-white p-6 sm:p-8">
                    <h2 id="app-install-heading" className="text-lg font-semibold">Ready in a few steps</h2>
                    <ol className="mt-5 grid gap-5 text-sm sm:grid-cols-3">
                        {[["Download", "Save the Windows installer to your computer."], ["Install", "Open the downloaded file and follow the setup steps."], ["Join", "Sign in with your MySession account and choose a session."]].map(([title, text], index) => (
                            <li key={title} className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#EDF3FF] text-xs font-semibold text-[#315DCB]">{index + 1}</span><div><h3 className="font-semibold">{title}</h3><p className="mt-1 leading-6 text-[#686C73]">{text}</p></div></li>
                        ))}
                    </ol>
                </section>
                <p className="mt-6 text-sm text-[#737780]">Prefer the web version? <Link to="/sessions" className="rounded font-medium text-[#315DCB] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5288FF]">Open MySession in your browser</Link></p>
            </div>
        </main>
    );
}
