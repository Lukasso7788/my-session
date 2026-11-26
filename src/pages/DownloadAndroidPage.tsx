import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowDownToLine } from "lucide-react";
import { ANDROID_APP_DOWNLOAD, APP_DOWNLOAD_PAGE_PATH } from "../lib/appDownloads";

export default function DownloadAndroidPage() {
    useEffect(() => {
        const previous = document.title;
        document.title = "Download MySession for Android | MySession";
        return () => { document.title = previous; };
    }, []);

    return (
        <main className="bg-[#F7F8FA] px-5 py-12 text-[#2F2F2F] sm:py-20">
            <div className="mx-auto max-w-xl rounded-3xl border border-[#DFE4EB] bg-white p-6 sm:p-10">
                <img src="/icons/android-app.svg" alt="" className="h-12 w-12" />
                <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">MySession for Android</h1>
                <p className="mt-3 leading-7 text-gray-600">Join focus rooms and sign in with your existing MySession account.</p>
                <a href={ANDROID_APP_DOWNLOAD.url} className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-full bg-[#2F2F2F] px-6 text-sm font-semibold text-white hover:bg-[#444444] focus-visible:outline focus-visible:outline-offset-4">
                    <ArrowDownToLine size={18} aria-hidden="true" /> Download APK
                </a>
                <p className="mt-3 text-sm text-gray-600">Preview {ANDROID_APP_DOWNLOAD.version} · Android 8.0+ · {ANDROID_APP_DOWNLOAD.size}</p>
                <h2 className="mt-8 text-lg font-semibold">Install the app</h2>
                <p className="mt-2 text-sm leading-6 text-gray-600">Open the APK on your Android device. If prompted, allow your browser or file manager to install it, then follow the Android installer.</p>
                <p className="mt-3 text-sm leading-6 text-gray-600">Screen sharing is unavailable in this preview. Tablet compatibility is still being tested.</p>
                <Link to={APP_DOWNLOAD_PAGE_PATH} className="mt-6 inline-block text-sm font-medium text-[#315DCB] hover:underline">Get MySession for Windows</Link>
            </div>
        </main>
    );
}
