import React, { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { RoomTheme } from "../pages/livekit/LiveKitUI";

type BugReportModalProps = {
    open: boolean;
    theme: RoomTheme;
    isLight: boolean;
    onClose: () => void;

    sessionId?: string | null;
    roomName?: string | null;
    userId?: string | null;
};

const PROBLEM_TYPES = [
    ["disconnected", "I got disconnected"],
    ["camera_stopped", "My camera stopped working"],
    ["mic_stopped", "My microphone stopped working"],
    ["could_not_hear", "I could not hear others"],
    ["others_could_not_hear_me", "Others could not hear me"],
    ["video_froze", "Video froze"],
    ["screen_share_failed", "Screen sharing failed"],
    ["could_not_join", "I could not join the room"],
    ["laggy_room", "The room was laggy"],
    ["other", "Something else"],
] as const;

const BEFORE_ACTIONS = [
    ["stayed_in_tab", "I stayed in the MySession tab"],
    ["switched_browser_tab", "I switched to another browser tab"],
    ["switched_app", "I switched to another app"],
    ["home_screen", "I went to the home screen"],
    ["locked_screen", "I locked my screen"],
    ["joined_another_call", "I joined another call"],
    ["opened_discord_zoom_whatsapp", "I opened Discord / Zoom / WhatsApp / Telegram"],
    ["opened_camera_mic_app", "I opened camera or microphone in another app"],
    ["lost_internet", "I lost internet connection"],
    ["changed_network", "I changed Wi-Fi / mobile data"],
    ["same_room_other_tab_device", "I opened MySession in another tab/device"],
    ["not_sure", "I’m not sure"],
] as const;

const WHAT_USER_SAW = [
    ["i_disappeared", "I disappeared from the room"],
    ["others_disappeared", "Other people disappeared"],
    ["reconnecting", "I saw “Reconnecting”"],
    ["rejoin", "I saw “Rejoin”"],
    ["camera_off", "I saw camera off"],
    ["mic_off", "I saw microphone off"],
    ["frozen_video", "I saw a frozen video"],
    ["page_refreshed", "The page refreshed"],
    ["blank_page", "The page went blank"],
    ["others_said_i_was_gone", "Nothing changed, but others said I was gone"],
    ["not_sure", "I’m not sure"],
] as const;

const OTHER_CALL_APPS = [
    ["none", "No"],
    ["discord", "Discord"],
    ["zoom", "Zoom"],
    ["google_meet", "Google Meet"],
    ["whatsapp", "WhatsApp"],
    ["telegram", "Telegram"],
    ["phone_call", "Phone call"],
    ["camera_app", "Camera app"],
    ["other", "Other"],
    ["not_sure", "I’m not sure"],
] as const;

function toggleInList(list: string[], value: string) {
    return list.includes(value)
        ? list.filter((x) => x !== value)
        : [...list, value];
}

function getBrowserDetails() {
    if (typeof navigator === "undefined") {
        return { browser: "unknown", browserVersion: "", os: "unknown" };
    }

    const ua = String(navigator.userAgent || "");
    const uaLower = ua.toLowerCase();

    const matchVersion = (re: RegExp) => {
        const m = ua.match(re);
        return m?.[1] || "";
    };

    let browser = "unknown";
    let browserVersion = "";

    if (uaLower.includes("samsungbrowser")) {
        browser = "Samsung Internet";
        browserVersion = matchVersion(/SamsungBrowser\/([\d.]+)/i);
    } else if (
        uaLower.includes("edg/") ||
        uaLower.includes("edga/") ||
        uaLower.includes("edgios/")
    ) {
        browser = "Microsoft Edge";
        browserVersion =
            matchVersion(/EdgA?\/([\d.]+)/i) || matchVersion(/EdgiOS\/([\d.]+)/i);
    } else if (uaLower.includes("crios")) {
        browser = "Chrome iOS";
        browserVersion = matchVersion(/CriOS\/([\d.]+)/i);
    } else if (uaLower.includes("chrome") || uaLower.includes("chromium")) {
        browser = "Chrome";
        browserVersion = matchVersion(/(?:Chrome|Chromium)\/([\d.]+)/i);
    } else if (uaLower.includes("firefox") || uaLower.includes("fxios")) {
        browser = "Firefox";
        browserVersion = matchVersion(/(?:Firefox|FxiOS)\/([\d.]+)/i);
    } else if (uaLower.includes("safari")) {
        browser = "Safari";
        browserVersion = matchVersion(/Version\/([\d.]+)/i);
    }

    let os = "unknown";
    if (/ipad|iphone|ipod/i.test(ua)) os = "iOS/iPadOS";
    else if (/android/i.test(ua)) os = "Android";
    else if (/cros/i.test(ua)) os = "ChromeOS";
    else if (/windows/i.test(ua)) os = "Windows";
    else if (/mac os x|macintosh/i.test(ua)) os = "macOS";
    else if (/linux/i.test(ua)) os = "Linux";

    return { browser, browserVersion, os };
}

function inferDeviceType() {
    if (typeof navigator === "undefined" || typeof window === "undefined") {
        return "unknown";
    }

    const ua = String(navigator.userAgent || "").toLowerCase();
    const platform = String(
        (navigator as any).userAgentData?.platform || navigator.platform || "",
    ).toLowerCase();
    const maxTouchPoints = Number((navigator as any).maxTouchPoints || 0);
    const minSide = Math.min(
        window.screen?.width || window.innerWidth || 0,
        window.screen?.height || window.innerHeight || 0,
    );
    const maxSide = Math.max(
        window.screen?.width || window.innerWidth || 0,
        window.screen?.height || window.innerHeight || 0,
    );

    if (/ipad|tablet|playbook|silk/i.test(ua)) return "tablet";
    if (/android/i.test(ua) && !/mobile/i.test(ua)) return "tablet";
    if (platform.includes("mac") && maxTouchPoints > 1 && minSide >= 700) {
        return "tablet";
    }
    if (/mobi|iphone|ipod|android.*mobile/i.test(ua)) return "mobile";
    if (maxTouchPoints > 1 && minSide >= 700 && maxSide >= 900) return "tablet";

    return "desktop";
}

function getNetworkSnapshot() {
    if (typeof navigator === "undefined") {
        return {
            online: null,
            effectiveType: "",
            connectionType: "",
            downlink: null,
            rtt: null,
            saveData: null,
        };
    }

    const connection =
        (navigator as any).connection ||
        (navigator as any).mozConnection ||
        (navigator as any).webkitConnection ||
        null;

    return {
        online: typeof navigator.onLine === "boolean" ? navigator.onLine : null,
        effectiveType: String(connection?.effectiveType || ""),
        connectionType: String(connection?.type || ""),
        downlink: Number.isFinite(Number(connection?.downlink))
            ? Number(connection.downlink)
            : null,
        rtt: Number.isFinite(Number(connection?.rtt))
            ? Number(connection.rtt)
            : null,
        saveData:
            typeof connection?.saveData === "boolean" ? connection.saveData : null,
    };
}

function readLocalConnectionDiagnostics() {
    if (typeof window === "undefined") return [];

    try {
        const raw = window.localStorage.getItem(
            "mysession_connection_diagnostics_buffer_v1",
        );
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.slice(-50) : [];
    } catch {
        return [];
    }
}

function FieldTitle({ children }: { children: React.ReactNode }) {
    return (
        <div className="mb-2 text-[13px] font-bold tracking-[-0.01em]">
            {children}
        </div>
    );
}

function CheckboxPill({
    checked,
    label,
    onClick,
    isLight,
}: {
    checked: boolean;
    label: string;
    onClick: () => void;
    isLight: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={[
                "rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition",
                checked
                    ? "bg-[#2F2F2F] text-white"
                    : isLight
                        ? "bg-[#E9E7E7] text-[#2F2F2F] hover:bg-[#DFDDDD]"
                        : "bg-[#2A2A2A] text-white/80 hover:bg-[#333333]",
            ].join(" ")}
        >
            {label}
        </button>
    );
}
export default function BugReportModal({
    open,
    theme,
    isLight,
    onClose,
    sessionId,
    roomName,
    userId,
}: BugReportModalProps) {
    const [problemTypes, setProblemTypes] = useState<string[]>([]);
    const [happenedWhere, setHappenedWhere] = useState("inside_live_room");
    const [beforeProblemActions, setBeforeProblemActions] = useState<string[]>([]);
    const [awayDuration, setAwayDuration] = useState("");
    const [lockedScreen, setLockedScreen] = useState("");
    const [otherCallApps, setOtherCallApps] = useState<string[]>([]);
    const [whatUserSaw, setWhatUserSaw] = useState<string[]>([]);
    const [recoveryAction, setRecoveryAction] = useState("");
    const [deviceModel, setDeviceModel] = useState("");
    const [description, setDescription] = useState("");
    const [contactAllowed, setContactAllowed] = useState(true);
    const [contactEmail, setContactEmail] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState("");

    const detected = useMemo(() => {
        const { browser, browserVersion, os } = getBrowserDetails();
        const deviceType = inferDeviceType();

        return {
            browser,
            browserVersion,
            os,
            deviceType,
            userAgent:
                typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "",
        };
    }, [open]);

    if (!open) return null;

    const cardClass = isLight
        ? "bg-[#F7F6F6] text-[#2F2F2F] shadow-[0_20px_60px_rgba(0,0,0,0.16)]"
        : "bg-[#1B1B1B] text-white shadow-[0_20px_60px_rgba(0,0,0,0.42)]";

    const inputClass = [
        "w-full rounded-xl border-0 px-4 py-3 text-[14px] outline-none transition",
        isLight
            ? "bg-[#E9E7E7] text-[#2F2F2F] placeholder:text-black/35 focus:ring-2 focus:ring-[#2F2F2F]/15"
            : "bg-[#292929] text-white placeholder:text-white/35 focus:ring-2 focus:ring-white/15",
    ].join(" ");

    const subtleText = isLight ? "text-black/55" : "text-white/55";

    const handleSubmit = async () => {
        if (!problemTypes.length) {
            setError("Choose what happened first.");
            return;
        }

        try {
            setSubmitting(true);
            setError("");

            const win = typeof window !== "undefined" ? window : null;
            const network = getNetworkSnapshot();

            const diagnostics = {
                sent_at: new Date().toISOString(),
                document_visibility:
                    typeof document !== "undefined" ? document.visibilityState : "unknown",
                local_connection_events: readLocalConnectionDiagnostics(),
            };

            const { error: insertError } = await supabase.from("bug_reports").insert({
                user_id: userId || null,
                session_id: sessionId || null,
                room_name: roomName || null,
                page_url: win?.location?.href || null,

                problem_types: problemTypes,
                happened_where: happenedWhere || null,
                before_problem_actions: beforeProblemActions,
                away_duration: awayDuration || null,
                locked_screen: lockedScreen || null,
                other_call_apps: otherCallApps,

                what_user_saw: whatUserSaw,
                recovery_action: recoveryAction || null,

                description: description.trim() || null,
                contact_allowed: contactAllowed,
                contact_email: contactEmail.trim() || null,

                device_model: deviceModel.trim() || null,
                detected_device_type: detected.deviceType,
                detected_browser: detected.browser,
                detected_browser_version: detected.browserVersion,
                detected_os: detected.os,
                detected_user_agent: detected.userAgent,

                screen_width: Number(win?.screen?.width || 0) || null,
                screen_height: Number(win?.screen?.height || 0) || null,
                viewport_width: Number(win?.innerWidth || 0) || null,
                viewport_height: Number(win?.innerHeight || 0) || null,
                device_pixel_ratio: Number(win?.devicePixelRatio || 1) || null,

                network_online: network.online,
                effective_connection_type: network.effectiveType || null,
                connection_type: network.connectionType || null,
                downlink: network.downlink,
                rtt: network.rtt,
                save_data: network.saveData,

                diagnostics,
                status: "new",
            });

            if (insertError) throw insertError;

            setSent(true);
        } catch (e: any) {
            setError(e?.message || "Failed to send bug report.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[160] flex items-center justify-center px-3 py-4">
            <div
                className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
                onClick={onClose}
            />

            <div
                className={`relative max-h-[92vh] w-full max-w-[720px] overflow-y-auto rounded-[24px] ${cardClass}`}
                data-theme={theme}
            >
                <div className={`sticky top-0 z-10 flex items-start justify-between gap-4 px-5 py-4 sm:px-6 ${isLight ? "bg-[#F7F6F6]/95" : "bg-[#1B1B1B]/95"} backdrop-blur-md`}>
                    <div>
                        <h2 className="text-[20px] font-semibold leading-tight">
                            Report a problem
                        </h2>
                        <p className={`mt-1 text-[12px] leading-5 ${subtleText}`}>
                            Room and connection details are attached automatically.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className={`flex h-9 w-9 items-center justify-center rounded-xl text-[14px] font-medium transition ${isLight ? "bg-[#E9E7E7] hover:bg-[#DFDDDD]" : "bg-[#292929] hover:bg-[#333333]"}`}
                        aria-label="Close report modal"
                    >
                        ✕
                    </button>
                </div>
                {sent ? (
                    <div className="mx-5 mb-5 rounded-2xl bg-emerald-500/10 p-5 sm:mx-6">
                        <div className="text-[18px] font-bold">Thanks — report sent.</div>
                        <p className={`mt-2 text-[14px] leading-6 ${subtleText}`}>
                            If this happened during a live session, try Rejoin or refresh once.
                        </p>
                        <button
                            type="button"
                            onClick={onClose}
                            className="mt-4 rounded-xl bg-[#2F2F2F] px-5 py-3 text-[14px] font-semibold text-white hover:bg-black"
                        >
                            Close
                        </button>
                    </div>
                ) : (
                    <div className="space-y-6 px-5 pb-5 sm:px-6 sm:pb-6">
                        <section>
                            <FieldTitle>1. What happened?</FieldTitle>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {PROBLEM_TYPES.map(([value, label]) => (
                                    <CheckboxPill
                                        key={value}
                                        checked={problemTypes.includes(value)}
                                        label={label}
                                        isLight={isLight}
                                        onClick={() => setProblemTypes((prev) => toggleInList(prev, value))}
                                    />
                                ))}
                            </div>
                        </section>

                        <section>
                            <FieldTitle>2. Where did it happen?</FieldTitle>
                            <select
                                value={happenedWhere}
                                onChange={(e) => setHappenedWhere(e.target.value)}
                                className={inputClass}
                            >
                                <option value="before_joining">Before joining the room</option>
                                <option value="prejoin">In the pre-join screen</option>
                                <option value="inside_live_room">Inside the live room</option>
                                <option value="focus_block">During a focus block</option>
                                <option value="break_checkin">During a break/check-in</option>
                                <option value="leaving_and_returning">When leaving and coming back</option>
                                <option value="sessions_page">On the sessions page</option>
                                <option value="payment">Payment / subscription</option>
                                <option value="other">Other</option>
                            </select>
                        </section>

                        <section>
                            <FieldTitle>3. What were you doing right before it happened?</FieldTitle>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {BEFORE_ACTIONS.map(([value, label]) => (
                                    <CheckboxPill
                                        key={value}
                                        checked={beforeProblemActions.includes(value)}
                                        label={label}
                                        isLight={isLight}
                                        onClick={() =>
                                            setBeforeProblemActions((prev) => toggleInList(prev, value))
                                        }
                                    />
                                ))}
                            </div>
                        </section>

                        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                                <FieldTitle>4. How long were you away?</FieldTitle>
                                <select
                                    value={awayDuration}
                                    onChange={(e) => setAwayDuration(e.target.value)}
                                    className={inputClass}
                                >
                                    <option value="">Not applicable / I stayed in the room</option>
                                    <option value="less_than_30_sec">Less than 30 seconds</option>
                                    <option value="30_sec_1_min">30 seconds – 1 minute</option>
                                    <option value="1_2_min">1–2 minutes</option>
                                    <option value="2_5_min">2–5 minutes</option>
                                    <option value="5_10_min">5–10 minutes</option>
                                    <option value="more_than_10_min">More than 10 minutes</option>
                                    <option value="dont_remember">I don’t remember</option>
                                </select>
                            </div>

                            <div>
                                <FieldTitle>5. Did you lock your screen?</FieldTitle>
                                <select
                                    value={lockedScreen}
                                    onChange={(e) => setLockedScreen(e.target.value)}
                                    className={inputClass}
                                >
                                    <option value="">Choose one</option>
                                    <option value="no">No</option>
                                    <option value="yes_briefly">Yes, briefly</option>
                                    <option value="yes_few_minutes">Yes, for a few minutes</option>
                                    <option value="not_sure">I’m not sure</option>
                                </select>
                            </div>
                        </section>

                        <section>
                            <FieldTitle>6. Did you use another app that may use camera or microphone?</FieldTitle>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                {OTHER_CALL_APPS.map(([value, label]) => (
                                    <CheckboxPill
                                        key={value}
                                        checked={otherCallApps.includes(value)}
                                        label={label}
                                        isLight={isLight}
                                        onClick={() => setOtherCallApps((prev) => toggleInList(prev, value))}
                                    />
                                ))}
                            </div>
                        </section>

                        <section>
                            <FieldTitle>7. What did you see?</FieldTitle>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {WHAT_USER_SAW.map(([value, label]) => (
                                    <CheckboxPill
                                        key={value}
                                        checked={whatUserSaw.includes(value)}
                                        label={label}
                                        isLight={isLight}
                                        onClick={() => setWhatUserSaw((prev) => toggleInList(prev, value))}
                                    />
                                ))}
                            </div>
                        </section>

                        <section>
                            <FieldTitle>8. What helped?</FieldTitle>
                            <select
                                value={recoveryAction}
                                onChange={(e) => setRecoveryAction(e.target.value)}
                                className={inputClass}
                            >
                                <option value="">Choose one</option>
                                <option value="fixed_itself">It fixed itself</option>
                                <option value="clicked_rejoin">I clicked Rejoin</option>
                                <option value="refreshed_page">I refreshed the page</option>
                                <option value="camera_mic_off_on">I turned camera/mic off and on</option>
                                <option value="closed_reopened_browser">I closed and reopened the browser</option>
                                <option value="restarted_device">I restarted the device</option>
                                <option value="nothing_helped">Nothing helped</option>
                                <option value="did_not_try">I did not try</option>
                            </select>
                        </section>

                        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                                <FieldTitle>Device model, if you know it</FieldTitle>
                                <input
                                    value={deviceModel}
                                    onChange={(e) => setDeviceModel(e.target.value)}
                                    className={inputClass}
                                    placeholder="Example: iPad 9th gen, Galaxy Tab S8, iPhone 13"
                                />
                            </div>

                            <div>
                                <FieldTitle>Detected device info</FieldTitle>
                                <div
                                    className={[
                                        "rounded-xl px-4 py-3 text-[13px] leading-6",
                                        isLight
                                            ? "bg-[#E9E7E7] text-black/70"
                                            : "bg-[#292929] text-white/70",
                                    ].join(" ")}
                                >
                                    <div>Device: {detected.deviceType}</div>
                                    <div>
                                        Browser: {detected.browser} {detected.browserVersion}
                                    </div>
                                    <div>OS: {detected.os}</div>
                                </div>
                            </div>
                        </section>

                        <section>
                            <FieldTitle>Describe what happened in your own words</FieldTitle>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                className={`${inputClass} min-h-[110px] resize-y`}
                                placeholder="Example: I joined the room on my iPad, switched to YouTube for about 2 minutes, came back, and saw Rejoin. Other people said my video disappeared."
                            />
                        </section>

                        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <label
                                className={[
                                    "flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-[13px] font-medium",
                                    isLight
                                        ? "bg-[#E9E7E7] text-black/75"
                                        : "bg-[#292929] text-white/80",
                                ].join(" ")}
                            >
                                <input
                                    type="checkbox"
                                    checked={contactAllowed}
                                    onChange={(e) => setContactAllowed(e.target.checked)}
                                />
                                You can contact me if needed
                            </label>

                            <input
                                value={contactEmail}
                                onChange={(e) => setContactEmail(e.target.value)}
                                className={inputClass}
                                placeholder="Email, optional"
                            />
                        </section>

                        {error ? (
                            <div className="rounded-xl bg-red-500/10 px-4 py-3 text-[13px] text-red-400">
                                {error}
                            </div>
                        ) : null}

                        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={onClose}
                                className={[
                                    "rounded-xl px-5 py-3 text-[14px] font-semibold transition",
                                    isLight ? "bg-[#E9E7E7] hover:bg-[#DFDDDD]" : "bg-[#292929] hover:bg-[#333333]",
                                ].join(" ")}
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                disabled={submitting}
                                onClick={() => void handleSubmit()}
                                className="rounded-xl bg-[#2F2F2F] px-5 py-3 text-[14px] font-semibold text-white transition hover:bg-black disabled:opacity-60"
                            >
                                {submitting ? "Sending..." : "Send report"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}