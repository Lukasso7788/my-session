import { Link } from "react-router-dom";
import AndroidIcon from "../components/AndroidIcon";

const WINDOWS_DESKTOP_DOWNLOAD_URL =
    "https://github.com/Lukasso7788/my-session/releases/download/desktop-latest/MySession-Setup-0.4.5.exe";

function WindowsAppIcon({ className = "h-7 w-7" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M2 4.4 10.8 3v8.2H2V4.4Zm10.2-1.6L22 1.3v9.9h-9.8V2.8ZM2 12.6h8.8v8.2L2 19.4v-6.8Zm10.2 0H22v9.9L12.2 21v-8.4Z" />
        </svg>
    );
}

export default function DesktopDownloadPage() {
    return (
        <main className="min-h-[calc(100vh-80px)] bg-[#f5f6f8] text-[#202124]">
            <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 md:py-12">
                <nav className="mb-10 flex items-center justify-between" aria-label="Desktop download navigation">
                    <Link to="/" className="text-base font-semibold text-[#5286f6]">MySession</Link>
                    <Link to="/sessions" className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium hover:bg-gray-50">Back to sessions</Link>
                </nav>

                <header className="mb-9 max-w-3xl">
                    <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#24532c] text-white">
                        <WindowsAppIcon className="h-7 w-7" />
                    </div>
                    <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Download MySession for Windows</h1>
                    <p className="mt-5 text-lg leading-8 text-gray-600">
                        Run MySession in its own window on Windows. The installer is only offered here.
                    </p>
                </header>

                <section className="grid gap-5 lg:grid-cols-[1.35fr_1fr]" aria-label="Download MySession">
                    <article className="rounded-3xl bg-[#202b43] p-7 text-white sm:p-8">
                        <p className="text-sm font-medium text-[#b6ceff]">Windows desktop app</p>
                        <h2 className="mt-3 text-3xl font-semibold">MySession for Windows</h2>
                        <a
                            href={WINDOWS_DESKTOP_DOWNLOAD_URL}
                            rel="noopener noreferrer"
                            className="mt-7 inline-flex items-center justify-center gap-2 rounded-full bg-[#5286f6] px-6 py-3.5 text-base font-semibold text-white transition hover:bg-[#4477e3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
                        >
                            <WindowsAppIcon className="h-5 w-5" />
                            Download for Windows
                        </a>
                        <p className="mt-4 text-sm leading-6 text-[#b6c4de]">Version 0.4.5 · Windows · 64-bit installer</p>
                        <p className="mt-4 text-base leading-7 text-[#d1daeb]">
                            Run <span className="font-medium text-white">MySession-Setup-0.4.5.exe</span>, then sign in with the same MySession account you use on the web.
                        </p>
                    </article>

                    <article className="rounded-3xl border border-gray-200 bg-white p-7 sm:p-8" aria-label="MySession for Android is coming soon">
                        <p className="text-sm font-medium text-gray-500">Mobile</p>
                        <h2 className="mt-3 text-2xl font-semibold">Android</h2>
                        <div className="mt-7 inline-flex items-center gap-2 rounded-full border border-dashed border-gray-300 px-5 py-3 text-base font-semibold text-gray-500">
                            <AndroidIcon className="h-5 w-5" />
                            Coming soon
                        </div>
                        <p className="mt-4 text-base leading-7 text-gray-600">
                            The Android app is not available yet. This page will be the place to get it.
                        </p>
                    </article>
                </section>

                <section className="mt-6 rounded-3xl border border-gray-200 bg-white p-7 sm:p-8" aria-labelledby="install-windows-title">
                    <h2 id="install-windows-title" className="text-2xl font-semibold">Install on Windows</h2>
                    <ol className="mt-6 list-decimal space-y-4 pl-6 text-base leading-7 text-gray-600 marker:font-semibold marker:text-[#4678d8]">
                        <li>Click <strong className="text-gray-900">Download for Windows</strong> and wait for the EXE to finish.</li>
                        <li>Open <code className="text-sm text-gray-900">MySession-Setup-0.4.5.exe</code> and follow the installer. Close MySession first if it is already open.</li>
                        <li>Launch MySession from the desktop or Start menu and sign in.</li>
                    </ol>
                </section>
            </div>
        </main>
    );
}
