import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

type EmbeddedBrowser = {
  name: string;
  android: boolean;
  ios: boolean;
};

const DISMISS_KEY = "mysession:iab-media-gate-dismissed:v1";

function detectEmbeddedBrowser(): EmbeddedBrowser | null {
  if (typeof navigator === "undefined") return null;

  const ua = String(navigator.userAgent || "");
  const android = /Android/i.test(ua);
  const ios = /iPhone|iPad|iPod/i.test(ua);

  const knownApps: Array<[RegExp, string]> = [
    [/FBAN|FBAV|\bFB_IAB\b/i, "Facebook"],
    [/Instagram/i, "Instagram"],
    [/Telegram/i, "Telegram"],
    [/Discord/i, "Discord"],
    [/TikTok|BytedanceWebview/i, "TikTok"],
    [/Line\//i, "LINE"],
    [/Snapchat/i, "Snapchat"],
    [/Pinterest/i, "Pinterest"],
    [/LinkedInApp/i, "LinkedIn"],
    [/Twitter|X-IAB/i, "X"],
  ];

  for (const [pattern, name] of knownApps) {
    if (pattern.test(ua)) return { name, android, ios };
  }

  const androidWebView =
    android && (/;\s*wv\)/i.test(ua) || /\bwv\b/i.test(ua));
  if (androidWebView) return { name: "this app", android, ios };

  const iosEmbeddedWebView =
    ios &&
    /AppleWebKit/i.test(ua) &&
    !/Safari/i.test(ua) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  if (iosEmbeddedWebView) return { name: "this app", android, ios };

  return null;
}

function shouldProtectRoute(pathname: string) {
  const path = pathname.toLowerCase();

  return (
    path === "/sessions" ||
    path === "/login" ||
    path === "/register" ||
    path === "/one-on-one" ||
    path.startsWith("/auth/callback") ||
    path.startsWith("/room-livekit/") ||
    path.startsWith("/room-iframe/")
  );
}

function getSafeContinuationUrl() {
  const current = new URL(window.location.href);

  if (current.pathname.toLowerCase().startsWith("/auth/callback")) {
    const redirect = current.searchParams.get("redirect");
    const safeRedirect =
      redirect && redirect.startsWith("/") && !redirect.startsWith("//")
        ? redirect
        : "/sessions";
    const login = new URL("/login", current.origin);
    login.searchParams.set("redirect", safeRedirect);
    return login.toString();
  }

  current.searchParams.delete("code");
  current.searchParams.delete("access_token");
  current.searchParams.delete("refresh_token");
  current.hash = "";
  return current.toString();
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy failed");
}

export default function InAppBrowserMediaGate() {
  const location = useLocation();
  const embeddedBrowser = useMemo(() => detectEmbeddedBrowser(), []);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!embeddedBrowser || !shouldProtectRoute(location.pathname)) {
      setVisible(false);
      return;
    }

    try {
      setVisible(sessionStorage.getItem(DISMISS_KEY) !== "1");
    } catch {
      setVisible(true);
    }
  }, [embeddedBrowser, location.pathname]);

  useEffect(() => {
    if (!visible) return;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [visible]);

  if (!visible || !embeddedBrowser) return null;

  const externalUrl = getSafeContinuationUrl();
  const browserName = embeddedBrowser.ios ? "Safari" : "Chrome";
  const menuHint = embeddedBrowser.ios
    ? `Tap the menu button in ${embeddedBrowser.name}, then choose “Open in Safari”.`
    : `Tap the menu button in ${embeddedBrowser.name}, then choose “Open in browser”.`;

  const handleCopy = async () => {
    try {
      await copyText(externalUrl);
      setStatus(`Link copied. Paste it into ${browserName}.`);
    } catch {
      setStatus(`Could not copy automatically. Use the app menu and open this page in ${browserName}.`);
    }
  };

  const handleOpen = () => {
    setStatus(menuHint);

    if (embeddedBrowser.android) {
      const target = new URL(externalUrl);
      const intentTarget = `${target.host}${target.pathname}${target.search}`;
      const fallback = encodeURIComponent(externalUrl);
      window.location.href = `intent://${intentTarget}#Intent;scheme=https;action=android.intent.action.VIEW;S.browser_fallback_url=${fallback};end`;
      return;
    }

    const opened = window.open(externalUrl, "_blank", "noopener,noreferrer");
    if (!opened) void handleCopy();
  };

  const handleContinue = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // The explicit dismissal still applies to the current mounted page.
    }
    setVisible(false);
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-[3px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="in-app-browser-title"
    >
      <div className="w-full max-w-[430px] rounded-[24px] bg-white p-5 text-[#2F2F2F] shadow-[0_24px_80px_rgba(0,0,0,0.24)] sm:p-6">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-[15px] bg-[#2F2F2F] text-white">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
            <path d="M14 5h5v5M19 5l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M11 6H7.8A2.8 2.8 0 0 0 5 8.8v7.4A2.8 2.8 0 0 0 7.8 19h7.4a2.8 2.8 0 0 0 2.8-2.8V13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>

        <h2 id="in-app-browser-title" className="text-[22px] font-bold leading-tight">
          Open MySession in {browserName}
        </h2>
        <p className="mt-2 text-sm leading-6 text-black/60">
          {embeddedBrowser.name}’s built-in browser may block your camera, microphone, or sign-in. Open MySession in {browserName} before joining the room.
        </p>

        <div className="mt-4 rounded-[16px] bg-[#F3F3F3] px-4 py-3 text-sm leading-5 text-black/70">
          <span className="font-semibold text-[#2F2F2F]">How:</span> {menuHint}
        </div>

        {status ? (
          <div className="mt-3 rounded-[14px] bg-[#EAF8EE] px-3 py-2.5 text-sm text-[#26743B]" role="status">
            {status}
          </div>
        ) : null}

        <div className="mt-5 grid gap-2.5">
          <button
            type="button"
            onClick={handleOpen}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-[15px] bg-[#2F2F2F] px-4 text-sm font-semibold text-white transition hover:bg-black active:scale-[0.99]"
          >
            Open in {browserName}
            <span aria-hidden="true">↗</span>
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="h-11 w-full rounded-[15px] bg-[#F1F1F1] px-4 text-sm font-semibold text-[#2F2F2F] transition hover:bg-[#E8E8E8]"
          >
            Copy link
          </button>
          <button
            type="button"
            onClick={handleContinue}
            className="h-10 w-full px-4 text-xs font-medium text-black/45 transition hover:text-black/70"
          >
            Continue here anyway
          </button>
        </div>
      </div>
    </div>
  );
}