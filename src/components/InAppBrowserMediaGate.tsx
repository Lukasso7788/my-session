import { type ReactNode, useEffect, useMemo, useState } from "react";

type EmbeddedBrowser = {
  name: string;
  android: boolean;
  ios: boolean;
};

function isMobileOrTablet(ua: string) {
  const ipadDesktopMode =
    /Macintosh/i.test(ua) &&
    typeof navigator !== "undefined" &&
    navigator.maxTouchPoints > 1;

  return /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua) || ipadDesktopMode;
}

function detectEmbeddedBrowser(): EmbeddedBrowser | null {
  if (typeof navigator === "undefined") return null;

  const ua = String(navigator.userAgent || "");
  if (!isMobileOrTablet(ua)) return null;

  const android = /Android/i.test(ua);
  const ios =
    /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);

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
    [/WhatsApp/i, "WhatsApp"],
    [/MicroMessenger/i, "WeChat"],
    [/Viber/i, "Viber"],
    [/Reddit/i, "Reddit"],
    [/Threads/i, "Threads"],
    [/VKClient|VKAndroidApp/i, "VK"],
    [/GSA/i, "Google"],
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

function getChromeUrl(externalUrl: string, browser: EmbeddedBrowser) {
  const target = new URL(externalUrl);

  if (browser.android) {
    const scheme = target.protocol.replace(":", "");
    return `intent://${target.host}${target.pathname}${target.search}#Intent;scheme=${scheme};package=com.android.chrome;action=android.intent.action.VIEW;end`;
  }

  if (browser.ios) {
    const scheme = target.protocol === "https:" ? "googlechromes" : "googlechrome";
    return `${scheme}://${target.host}${target.pathname}${target.search}`;
  }

  return externalUrl;
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

export default function InAppBrowserMediaGate({ children }: { children: ReactNode }) {
  const embeddedBrowser = useMemo(() => detectEmbeddedBrowser(), []);
  const [status, setStatus] = useState("");
  const externalUrl = useMemo(
    () => (embeddedBrowser ? getSafeContinuationUrl() : ""),
    [embeddedBrowser],
  );

  useEffect(() => {
    if (!embeddedBrowser || !externalUrl) return;

    const timer = window.setTimeout(() => {
      setStatus("If Chrome did not open, use the button again or copy the link.");
      window.location.replace(getChromeUrl(externalUrl, embeddedBrowser));
    }, 150);

    return () => window.clearTimeout(timer);
  }, [embeddedBrowser, externalUrl]);

  if (!embeddedBrowser) return <>{children}</>;

  const handleCopy = async () => {
    try {
      await copyText(externalUrl);
      setStatus("Link copied. Paste it into Chrome.");
    } catch {
      setStatus("Use the app menu and choose “Open in browser”, then select Chrome.");
    }
  };

  const handleOpen = () => {
    setStatus("If Chrome did not open, copy the link and paste it into Chrome.");
    window.location.replace(getChromeUrl(externalUrl, embeddedBrowser));
  };

  return (
    <main
      className="fixed inset-0 z-[10000] flex min-h-[100dvh] items-center justify-center overflow-y-auto bg-[#F6F4EF] px-4 py-6 text-[#2F2F2F]"
      role="alertdialog"
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

        <h1 id="in-app-browser-title" className="text-[22px] font-bold leading-tight">
          Open MySession in Chrome
        </h1>
        <p className="mt-2 text-sm leading-6 text-black/60">
          MySession does not work inside {embeddedBrowser.name}’s built-in browser because it may block camera and microphone access.
        </p>

        <div className="mt-4 rounded-[16px] bg-[#F3F3F3] px-4 py-3 text-sm leading-5 text-black/70">
          If Chrome does not open automatically, tap the button below. You can also use {embeddedBrowser.name}’s menu and choose “Open in browser”.
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
            Open in Chrome
            <span aria-hidden="true">↗</span>
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="h-11 w-full rounded-[15px] bg-[#F1F1F1] px-4 text-sm font-semibold text-[#2F2F2F] transition hover:bg-[#E8E8E8]"
          >
            Copy link
          </button>
        </div>
      </div>
    </main>
  );
}
