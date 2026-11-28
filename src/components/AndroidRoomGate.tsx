import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ANDROID_APP_PAGE_PATH } from "../lib/appDownloads";

export function AndroidRoomGate({ children }: { children: ReactNode }) {
  const android = typeof navigator !== "undefined" && (
    /Android/i.test(navigator.userAgent) ||
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform === "Android"
  );
  const bridge = typeof window !== "undefined"
    ? (window as Window & { MySessionNative?: { postMessage?: unknown } }).MySessionNative
    : undefined;
  if (!android || typeof bridge?.postMessage === "function") return <>{children}</>;

  return (
    <main className="mx-auto flex min-h-[55vh] max-w-md flex-col items-start justify-center gap-4 px-6 py-12">
      <h1 className="text-2xl font-semibold">Join with MySession for Android</h1>
      <p>Install the Android app to join rooms on this device. Sign in with your existing account.</p>
      <Link className="rounded-full bg-[#2F2F2F] px-5 py-3 font-semibold text-white" to={ANDROID_APP_PAGE_PATH}>
        Download Android app
      </Link>
      <Link className="underline" to="/sessions">Browse sessions</Link>
    </main>
  );
}
