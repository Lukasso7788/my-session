// src/pages/RoomPageIFrame.tsx
// ROOMPAGE (IFRAME) + JITSI EXTERNAL API + FULL UI PARITY (UPDATED)
// ✅ Bottom fixed controls (like RoomPage.tsx)
// ✅ Light/Dark theme switcher (thumb icon, persisted in localStorage)
// ✅ StageBar supports legacy schedule + infinite schedule (50/5/5 + object phases)
// ✅ Full audio system: unlock, stage sounds, break-end, welcome loop, user-joined sound
// ✅ Right panel tabs (participants/chat/intentions) like RoomPage
// ✅ Uses Jitsi built-in Settings dialog (toggleSettings) — native device/video settings
// ✅ Tile view toggle button (setTileView)
// ✅ Attempts to force Inter font inside iframe (best-effort; may be blocked by cross-origin)
// ✅ Hard disables prejoin / welcome / watermark as much as External API allows

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

import { IntentionsPanel } from "../components/IntentionsPanel";
import { SessionStageBar } from "../components/SessionStageBar";
import { UserProfileModal } from "../components/UserProfileModal";

// ✅ keep this import style because it already worked for you on Vercel/Linux
import ChatPanel from "../components/ChatPanel";

import { useAttendancePresence } from "../hooks/useAttendancePresence";

type RoomTheme = "dark" | "light";
type RightPanelTab = "participants" | "chat" | "intentions" | null;

type Stage = {
    name: string;
    duration: number; // minutes (display / legacy)
    color: string;
    type: "intro" | "intentions" | "focus" | "break" | "outro" | string;
    durationSeconds?: number;
};

type IFrameParticipant = {
    id: string;
    displayName: string;
    avatarURL?: string;
    role?: string;
    isLocal?: boolean;
};

declare global {
    interface Window {
        JitsiMeetExternalAPI?: any;
    }
}

// ====== JITSI DOMAIN ======
const JITSI_DOMAIN = "jitsi.lukassodesign.site";

// ====== SOUNDS ======
const STAGE_SOUND_MAP: Record<string, string> = {
    intentions: "/sounds/intentions.mp3",
    focus: "/sounds/focus.mp3",
    break: "/sounds/break_start.mp3",
    outro: "/sounds/outro.mp3",
};
const BREAK_END_SOUND = "/sounds/break_end.mp3";
const WELCOME_LOOP_SOUND = "/sounds/welcome_loop.mp3";
const USER_JOINED_SOUND = "/sounds/user_joined.mp3";

// ====== ICONS (theme-aware fallback: /icons/<name>-<theme>.svg => /icons/<name>.svg) ======
function Icon({
    name,
    theme,
    className = "w-5 h-5",
    alt = "",
}: {
    name:
    | "mic-on"
    | "mic-off"
    | "camera-on"
    | "camera-off"
    | "screen-share"
    | "leave"
    | "participants"
    | "chat"
    | "intentions"
    | "settings"
    | "theme-sun"
    | "theme-moon"
    | "timer"
    | "host_session_icon"
    | "tile-on"
    | "tile-off";
    theme: RoomTheme;
    className?: string;
    alt?: string;
}) {
    const themedSrc = `/icons/${name}-${theme}.svg`;
    const fallbackSrc = `/icons/${name}.svg`;
    const [src, setSrc] = useState(themedSrc);

    useEffect(() => setSrc(themedSrc), [themedSrc]);

    return (
        <img
            src={src}
            onError={() => {
                if (src !== fallbackSrc) setSrc(fallbackSrc);
            }}
            className={className}
            alt={alt}
            draggable={false}
        />
    );
}

// ====== schedule helpers (copied/normalized from RoomPage.tsx) ======
function safeParseJson(raw: any) {
    if (!raw) return null;
    if (typeof raw === "string") {
        const s = raw.trim();
        if (!s || s === "undefined" || s === "null") return null;
        try {
            return JSON.parse(s);
        } catch {
            return null;
        }
    }
    return raw;
}

function parse50505(raw: any): { focus: number; break: number; intentions: number } | null {
    if (typeof raw !== "string") return null;
    const s = raw.trim();
    const m1 = s.match(/^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)$/);
    const m2 = s.match(/^(\d+)\s*-\s*(\d+)\s*-\s*(\d+)$/);
    const m = m1 || m2;
    if (!m) return null;

    const focus = Number(m[1]);
    const br = Number(m[2]);
    const intentions = Number(m[3]);

    if (!Number.isFinite(focus) || !Number.isFinite(br) || !Number.isFinite(intentions)) return null;
    if (focus <= 0 || br <= 0 || intentions <= 0) return null;

    return { focus, break: br, intentions };
}

function normalizeInfinitePhases(anyPhases: any): { name: string; seconds: number }[] {
    if (!anyPhases) return [];

    const toSeconds = (raw: any): number => {
        const explicitSeconds =
            Number(raw?.seconds) || Number(raw?.duration_seconds) || Number(raw?.durationSeconds);
        if (explicitSeconds > 0) return explicitSeconds;

        const explicitMinutes =
            Number(raw?.minutes) ||
            Number(raw?.mins) ||
            Number(raw?.duration_minutes) ||
            Number(raw?.durationMinutes);
        if (explicitMinutes > 0) return explicitMinutes * 60;

        const n = typeof raw === "number" ? raw : Number(raw?.duration ?? raw?.value ?? raw ?? 0);
        if (!Number.isFinite(n) || n <= 0) return 0;

        if (n <= 180) return n * 60;
        return n;
    };

    if (Array.isArray(anyPhases)) {
        return anyPhases
            .map((p: any) => {
                const name = String(p?.name || p?.key || p?.type || "");
                const seconds = toSeconds(p);
                return { name, seconds };
            })
            .filter((x) => x.seconds > 0);
    }

    if (typeof anyPhases === "object") {
        return Object.entries(anyPhases)
            .map(([k, v]: any) => {
                const name = String(k || "");
                const seconds = typeof v === "number" ? (v <= 180 ? Number(v) * 60 : Number(v)) : toSeconds(v);
                return { name, seconds };
            })
            .filter((x) => x.seconds > 0);
    }

    return [];
}

function phaseToStageType(phaseNameLower: string): Stage["type"] {
    if (phaseNameLower.includes("focus")) return "focus";
    if (phaseNameLower.includes("checkin") || phaseNameLower.includes("intention")) return "intentions";
    if (phaseNameLower.includes("break") || phaseNameLower.includes("rest")) return "break";
    if (phaseNameLower.includes("intro") || phaseNameLower.includes("welcome")) return "intro";
    if (phaseNameLower.includes("outro") || phaseNameLower.includes("farewell") || phaseNameLower.includes("celebrat"))
        return "outro";
    return "focus";
}

const STAGE_COLORS: Record<string, string> = {
    intro: "#80DF86",
    intentions: "#ADD3FF",
    focus: "#4CA0FF",
    break: "#F9ADA2",
    outro: "#80DF86",
};

function safeLower(x: any) {
    return String(x || "").toLowerCase();
}

// ====== Jitsi external api loader ======
async function loadJitsiExternalApi(domain: string) {
    if (typeof window === "undefined") return;
    if (window.JitsiMeetExternalAPI) return;

    await new Promise<void>((resolve, reject) => {
        const src = `https://${domain}/external_api.js?v=1`;
        const existing = document.querySelector(`script[src^="https://${domain}/external_api.js"]`);

        if (existing) {
            const t = setInterval(() => {
                if (window.JitsiMeetExternalAPI) {
                    clearInterval(t);
                    resolve();
                }
            }, 50);

            setTimeout(() => {
                clearInterval(t);
                if (!window.JitsiMeetExternalAPI) reject(new Error("external_api.js loaded but API missing"));
            }, 6000);

            return;
        }

        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Failed to load Jitsi external_api.js"));
        document.head.appendChild(s);
    });
}

// ====== Best-effort: try to force Inter inside iframe (may be blocked by cross-origin) ======
function tryApplyInterToIFrame(api: any) {
    try {
        const iframe: HTMLIFrameElement | undefined = api?.getIFrame?.();
        const doc = iframe?.contentWindow?.document;
        if (!doc) return false;

        // inject Inter
        const existing = doc.querySelector(`link[data-mysession-inter="1"]`);
        if (!existing) {
            const link = doc.createElement("link");
            link.setAttribute("rel", "stylesheet");
            link.setAttribute("href", "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");
            link.setAttribute("data-mysession-inter", "1");
            doc.head.appendChild(link);
        }

        // force font-family globally
        const styleExisting = doc.querySelector(`style[data-mysession-font="1"]`);
        if (!styleExisting) {
            const style = doc.createElement("style");
            style.setAttribute("data-mysession-font", "1");
            style.textContent = `
        html, body, button, input, textarea, select, div, span, p, h1, h2, h3, h4, h5, h6 {
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Noto Sans", "Liberation Sans", sans-serif !important;
        }
      `;
            doc.head.appendChild(style);
        }

        return true;
    } catch {
        // cross-origin will throw -> not possible
        return false;
    }
}

export default function RoomPageIFrame() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    // ====== Theme ======
    const [theme, setTheme] = useState<RoomTheme>(() => {
        try {
            const v = String(localStorage.getItem("room_theme") || "").toLowerCase();
            return v === "light" ? "light" : "dark";
        } catch {
            return "dark";
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem("room_theme", theme);
        } catch { }
    }, [theme]);

    const isLight = theme === "light";

    // theme tokens (same as RoomPage)
    const pageBg = isLight ? "bg-[#F6F7FB] text-[#0B1220]" : "bg-[#050F1A] text-white";
    const topBarBg = isLight ? "bg-white/85 border border-black/10" : "bg-[#111827]/40 border border-white/5";
    const chipBg = isLight ? "bg-black/5 border border-black/10" : "bg-[#0B1220]/70 border border-white/5";
    const subtleText = isLight ? "text-black/55" : "text-[#9CA3AF]";
    const strongText = isLight ? "text-black/85" : "text-[#F3F4F6]/90";
    const panelBg = isLight ? "bg-white/85 border border-black/10" : "bg-[#0B1220]/55 border border-white/5";
    const bottomBarBg = isLight ? "bg-white/85 border border-black/10" : "bg-[#07101E]/85 border border-white/10";
    const ctlBtnBase = isLight ? "bg-black/5 hover:bg-black/10" : "bg-[#111827] hover:bg-[#1f2937]";

    // Theme switcher UI (thumb icon)
    const switchTrack = "w-[84px] h-[32px] rounded-full border relative transition flex items-center px-[3px]";
    const switchTrackCls = isLight
        ? "bg-black/5 border-black/10 hover:bg-black/10"
        : "bg-white/5 border-white/10 hover:bg-white/10";
    const switchThumb =
        "absolute top-[2px] w-[26px] h-[26px] rounded-full shadow-md transition-transform bg-white flex items-center justify-center";
    const thumbTranslate = isLight ? "translateX(0px)" : "translateX(50px)";

    // ====== Session + user ======
    const [session, setSession] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const [selectedUser, setSelectedUser] = useState<any>(null);
    const [userName, setUserName] = useState<string>("");
    const [authUserId, setAuthUserId] = useState<string | null>(null);

    // ====== Stages + timers ======
    const [stages, setStages] = useState<Stage[]>([]);
    const [hoveredStage, setHoveredStage] = useState<Stage | null>(null);
    const [currentStage, setCurrentStage] = useState(0);
    const [remainingTime, setRemainingTime] = useState<string>("");

    const [stagebarStartTime, setStagebarStartTime] = useState<string>("");
    const [stagebarCycleSeconds, setStagebarCycleSeconds] = useState<number | undefined>(undefined);

    // detect infinite room
    const isInfiniteRoom = useMemo(() => {
        const raw = session?.schedule;
        if (parse50505(raw)) return true;

        const parsed = safeParseJson(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;

        const kind = String((parsed as any)?.kind || "").toLowerCase();
        if (kind === "infinite_room") return true;
        if (kind.includes("infinite")) return true;

        if ((parsed as any)?.timer?.phases) return true;
        if ((parsed as any)?.timer?.segments) return true;
        if ((parsed as any)?.phases) return true;
        if ((parsed as any)?.segments) return true;

        return false;
    }, [session]);

    // silent room detection
    const isSilentRoom = useMemo(() => {
        const fmt = String(session?.format || "").toLowerCase();
        const title = String(session?.title || "").toLowerCase();

        const tpl = session?.session_templates;
        const tplName =
            Array.isArray(tpl) ? String(tpl?.[0]?.name || tpl?.[0]?.title || "") : String(tpl?.name || tpl?.title || "");
        const tplKey =
            Array.isArray(tpl)
                ? String(tpl?.[0]?.key || tpl?.[0]?.slug || tpl?.[0]?.type || "")
                : String(tpl?.key || tpl?.slug || tpl?.type || "");
        const tplFmt = Array.isArray(tpl) ? String(tpl?.[0]?.format || "") : String(tpl?.format || "");

        const hay = `${fmt} ${title} ${tplName} ${tplKey} ${tplFmt}`.toLowerCase();
        return hay.includes("silent");
    }, [session]);

    // ====== Attendance presence ======
    useAttendancePresence(id && authUserId ? id : null, { heartbeatMs: 10_000 });

    // ====== Jitsi iFrame API ======
    const iframeContainerRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<any>(null);

    const [lastErr, setLastErr] = useState<string>("");

    const [isAudioMuted, setIsAudioMuted] = useState(false);
    const [isVideoMuted, setIsVideoMuted] = useState(false);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [tile, setTile] = useState(true);

    const [participants, setParticipants] = useState<IFrameParticipant[]>([]);
    const [participantsSearch, setParticipantsSearch] = useState("");
    const participantsCount = participants.length;

    const prevCountRef = useRef<number>(0);

    const [jitsiKey, setJitsiKey] = useState(0);

    const roomName = useMemo(() => {
        return id ? `session-${id}` : "session-unknown";
    }, [id]);

    const forceReloadJitsi = () => {
        try {
            apiRef.current?.dispose?.();
        } catch { }
        apiRef.current = null;
        if (iframeContainerRef.current) iframeContainerRef.current.innerHTML = "";
        setLastErr("");
        setParticipants([]);
        setIsAudioMuted(false);
        setIsVideoMuted(false);
        setIsScreenSharing(false);
        setTile(true);
        setJitsiKey((x) => x + 1);
    };

    // ====== Right panel ======
    const [rightPanelOpen, setRightPanelOpen] = useState<boolean>(false);
    const [rightTab, setRightTab] = useState<RightPanelTab>(null);

    const openRightTab = (tab: RightPanelTab) => {
        if (!tab) {
            setRightPanelOpen(false);
            setRightTab(null);
            return;
        }
        setRightTab((prevTab) => {
            const same = prevTab === tab;
            setRightPanelOpen((prevOpen) => (same ? !prevOpen : true));
            return tab;
        });
    };

    // ====== Mobile "more" menu ======
    const [showMoreMenu, setShowMoreMenu] = useState(false);
    const moreMenuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!showMoreMenu) return;
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node | null;
            if (!moreMenuRef.current || !t) return;
            if (!moreMenuRef.current.contains(t)) setShowMoreMenu(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [showMoreMenu]);

    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return;
        const mql = window.matchMedia("(min-width: 768px)");
        const onChange = () => {
            if (mql.matches) setShowMoreMenu(false);
        };
        onChange();
        try {
            mql.addEventListener("change", onChange);
            return () => mql.removeEventListener("change", onChange);
        } catch {
            mql.addListener(onChange);
            return () => mql.removeListener(onChange);
        }
    }, []);

    // ====== Audio system ======
    const audioUnlockedRef = useRef<boolean>(false);
    const welcomeLoopRef = useRef<HTMLAudioElement | null>(null);
    const prevStageRef = useRef<number>(-1);
    const firstTickDoneRef = useRef<boolean>(false);

    useEffect(() => {
        const unlock = () => {
            if (audioUnlockedRef.current) return;
            const a = new Audio();
            a.play().catch(() => { });
            audioUnlockedRef.current = true;
            window.removeEventListener("click", unlock, true);
            window.removeEventListener("keydown", unlock, true);
            window.removeEventListener("touchstart", unlock, true);
        };

        window.addEventListener("click", unlock, true);
        window.addEventListener("keydown", unlock, true);
        window.addEventListener("touchstart", unlock, true);

        return () => {
            window.removeEventListener("click", unlock, true);
            window.removeEventListener("keydown", unlock, true);
            window.removeEventListener("touchstart", unlock, true);
        };
    }, []);

    const playOneShot = (url: string, volume = 0.9) => {
        if (!url) return;
        const a = new Audio(url);
        a.volume = volume;
        a.play().catch(() => { });
    };

    const stopWelcomeLoop = () => {
        try {
            if (welcomeLoopRef.current) {
                welcomeLoopRef.current.pause();
                welcomeLoopRef.current.currentTime = 0;
                welcomeLoopRef.current = null;
            }
        } catch { }
    };

    const startWelcomeLoop = () => {
        stopWelcomeLoop();
        const a = new Audio(WELCOME_LOOP_SOUND);
        a.loop = true;
        a.volume = 0.6;
        welcomeLoopRef.current = a;
        a.play().catch(() => { });
    };

    // ====== LOAD SESSION + BUILD STAGES ======
    useEffect(() => {
        (async () => {
            if (!id) return;

            const { data, error } = await supabase
                .from("sessions")
                .select("*, host_profile:profiles!sessions_host_id_fkey(id, full_name, avatar_url, bio), session_templates(*)")
                .eq("id", id)
                .single();

            if (data && !error) {
                setSession(data);

                setStages([]);
                setStagebarCycleSeconds(undefined);
                setStagebarStartTime("");

                const fallbackStart = String(data?.start_time || data?.created_at || new Date().toISOString());
                let parsed: any = safeParseJson(data.schedule);

                if (!parsed) {
                    const t = parse50505(data.schedule);
                    if (t) {
                        parsed = {
                            kind: "infinite_room",
                            timer: { phases: { focus: t.focus, break: t.break, intentions: t.intentions } },
                            anchor_ts: data?.start_time || data?.created_at || fallbackStart,
                        };
                    }
                }

                if (Array.isArray(parsed)) {
                    const formatted: Stage[] = parsed
                        .map((b: any) => {
                            const lower = safeLower(b?.name);
                            const type: Stage["type"] =
                                b?.type ||
                                (lower.includes("welcome") || lower.includes("intro")
                                    ? "intro"
                                    : lower.includes("intention")
                                        ? "intentions"
                                        : lower.includes("focus")
                                            ? "focus"
                                            : lower.includes("break") || lower.includes("pause")
                                                ? "break"
                                                : lower.includes("farewell") || lower.includes("celebrat")
                                                    ? "outro"
                                                    : "focus");

                            return {
                                name: String(b?.name || "Stage"),
                                duration: Number(b?.minutes || b?.duration || 0),
                                color: STAGE_COLORS[type] || "#4CA0FF",
                                type,
                            };
                        })
                        .filter((s) => Number.isFinite(s.duration) && s.duration > 0);

                    setStages(formatted);
                    setStagebarStartTime(String(data.start_time || fallbackStart));
                    setStagebarCycleSeconds(undefined);
                }

                const isInfiniteScheduleObject =
                    parsed &&
                    typeof parsed === "object" &&
                    !Array.isArray(parsed) &&
                    (String((parsed as any)?.kind || "").toLowerCase().includes("infinite") ||
                        (parsed as any)?.timer?.phases ||
                        (parsed as any)?.timer?.segments ||
                        (parsed as any)?.phases ||
                        (parsed as any)?.segments);

                if (isInfiniteScheduleObject) {
                    const phasesRaw =
                        (parsed as any)?.timer?.phases ||
                        (parsed as any)?.timer?.segments ||
                        (parsed as any)?.phases ||
                        (parsed as any)?.segments ||
                        null;

                    const phases = normalizeInfinitePhases(phasesRaw);

                    const formatted: Stage[] = phases.map((p) => {
                        const lower = String(p.name || "").toLowerCase();
                        const type = phaseToStageType(lower);

                        const displayName =
                            type === "focus"
                                ? "Focus"
                                : type === "intentions"
                                    ? "Intentions (spoken)"
                                    : type === "break"
                                        ? "Break"
                                        : type === "intro"
                                            ? "Welcome"
                                            : type === "outro"
                                                ? "Celebrate & Farewell"
                                                : String(p.name || "Stage");

                        const seconds = Number(p.seconds) || 0;
                        const minutes = Math.max(1, Math.round(seconds / 60));

                        return {
                            name: displayName,
                            duration: minutes,
                            durationSeconds: seconds,
                            color: STAGE_COLORS[type] || "#4CA0FF",
                            type,
                        };
                    });

                    setStages(formatted);

                    const anchor = String((parsed as any)?.anchor_ts || (parsed as any)?.anchorTs || data?.start_time || fallbackStart);
                    setStagebarStartTime(anchor);

                    const sumSeconds = phases.reduce((acc, p) => acc + (Number(p.seconds) || 0), 0);

                    let cycleSeconds =
                        Number((parsed as any)?.timer?.cycle_seconds) ||
                        Number((parsed as any)?.timer?.cycleSeconds) ||
                        Number((parsed as any)?.cycle_seconds) ||
                        Number((parsed as any)?.cycleSeconds) ||
                        0;

                    if (!cycleSeconds || cycleSeconds <= 0) cycleSeconds = sumSeconds;
                    if (cycleSeconds < sumSeconds) cycleSeconds = sumSeconds;

                    setStagebarCycleSeconds(Math.max(1, cycleSeconds));
                }

                if (!parsed) setStagebarStartTime(fallbackStart);
            } else {
                setSession(null);
            }

            setLoading(false);
        })();
    }, [id]);

    // ====== Resolve user name ======
    useEffect(() => {
        (async () => {
            const { data } = await supabase.auth.getUser();
            const u = data.user;
            setAuthUserId(u?.id || null);

            let name =
                (u?.user_metadata?.full_name as string) ||
                (u?.user_metadata?.name as string) ||
                (u?.email ? u.email.split("@")[0] : "");

            if (!name && u?.id) {
                const { data: p } = await supabase.from("profiles").select("full_name").eq("id", u.id).single();
                name = p?.full_name || "";
            }

            setUserName(name || "Guest");
        })();
    }, []);

    // ====== Stage timer + sounds ======
    useEffect(() => {
        if (isSilentRoom) {
            setRemainingTime("");
            setCurrentStage(0);
            firstTickDoneRef.current = false;
            prevStageRef.current = -1;
            stopWelcomeLoop();
            return;
        }

        if (!stagebarStartTime || !stages.length) return;

        const startMs = new Date(stagebarStartTime).getTime();
        if (Number.isNaN(startMs)) return;

        const stageSeconds = stages.map((s) => {
            const sec = Number((s as any)?.durationSeconds) || 0;
            if (sec > 0) return sec;
            const mins = Number(s?.duration) || 0;
            return mins > 0 ? mins * 60 : 0;
        });

        const sumStageSeconds = stageSeconds.reduce((acc, v) => acc + v, 0);
        const loopSeconds =
            (Number(stagebarCycleSeconds) || 0) > 0 ? Number(stagebarCycleSeconds) : Math.max(1, sumStageSeconds);

        const timer = window.setInterval(() => {
            const now = Date.now();
            const diffSecRaw = (now - startMs) / 1000;

            const diffSec =
                loopSeconds > 0 && isInfiniteRoom ? ((diffSecRaw % loopSeconds) + loopSeconds) % loopSeconds : diffSecRaw;

            let total = 0;
            let active = 0;

            for (let i = 0; i < stages.length; i++) {
                const dur = stageSeconds[i] || 0;
                const next = total + dur;
                if (dur <= 0) continue;

                if (diffSec < next) {
                    active = i;
                    const rem = next - diffSec;
                    setRemainingTime(`${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(2, "0")}`);
                    break;
                }
                total = next;
                active = i;
            }

            setCurrentStage(active);

            if (!isInfiniteRoom) {
                const stage = stages[active];

                if (!firstTickDoneRef.current) {
                    if (stage.type === "intro") startWelcomeLoop();
                    else stopWelcomeLoop();

                    prevStageRef.current = active;
                    firstTickDoneRef.current = true;
                    return;
                }

                if (prevStageRef.current !== active) {
                    const prev = stages[prevStageRef.current];
                    const prevType = prev?.type;
                    const newType = stage.type;

                    if (prevType === "break" && newType !== "break") playOneShot(BREAK_END_SOUND);

                    if (newType === "intro") {
                        startWelcomeLoop();
                    } else {
                        stopWelcomeLoop();
                        const sound = STAGE_SOUND_MAP[newType];
                        if (sound) playOneShot(sound);
                    }

                    prevStageRef.current = active;
                }

                if (stage.type !== "intro" && welcomeLoopRef.current) stopWelcomeLoop();
            }
        }, 1000);

        return () => window.clearInterval(timer);
    }, [stagebarStartTime, stages, isSilentRoom, isInfiniteRoom, stagebarCycleSeconds]);

    // ====== Participants ======
    const upsertLocalParticipant = (list: IFrameParticipant[]) => {
        const local: IFrameParticipant = { id: "local", displayName: "You", isLocal: true };
        const hasLocal = list.some((p) => p.isLocal);
        return hasLocal ? list : [local, ...list];
    };

    const refreshParticipants = async () => {
        const api = apiRef.current;
        if (!api) return;

        try {
            const info = (await api.getParticipantsInfo?.()) || [];
            const mapped: IFrameParticipant[] = (Array.isArray(info) ? info : []).map((p: any) => ({
                id: String(p?.participantId || p?.id || ""),
                displayName: String(p?.displayName || p?.formattedDisplayName || "Guest"),
                avatarURL: p?.avatarURL ? String(p.avatarURL) : undefined,
                role: p?.role ? String(p.role) : undefined,
                isLocal: false,
            }));

            const next = upsertLocalParticipant(mapped.filter((p) => p.id));
            setParticipants(next);

            if (prevCountRef.current < 2 && next.length >= 2) {
                playOneShot(USER_JOINED_SOUND, 0.9);
            }
            prevCountRef.current = next.length;
        } catch {
            // ignore
        }
    };

    const filteredParticipants = useMemo(() => {
        const q = participantsSearch.trim().toLowerCase();
        if (!q) return participants;
        return participants.filter((p) => (p.isLocal ? "you" : p.displayName || "guest").toLowerCase().includes(q));
    }, [participants, participantsSearch]);

    // ====== JITSI INIT ======
    useEffect(() => {
        if (!session || !id) return;
        if (!iframeContainerRef.current) return;
        if (!userName) return;

        let destroyed = false;

        const cleanup = () => {
            try {
                apiRef.current?.dispose?.();
            } catch { }
            apiRef.current = null;
        };

        const leaveToSessions = async () => {
            if (destroyed) return;
            destroyed = true;

            try {
                if (id && authUserId) {
                    await supabase.rpc("attendance_leave", { p_session_id: id });
                }
            } catch {
                // ignore
            } finally {
                cleanup();
                navigate("/sessions", { replace: true });
            }
        };

        (async () => {
            try {
                await loadJitsiExternalApi(JITSI_DOMAIN);
                if (destroyed) return;

                iframeContainerRef.current!.innerHTML = "";

                const roomNameRaw =
                    session.jitsi_room_name ||
                    (session.daily_room_url
                        ? (() => {
                            try {
                                const u = new URL(session.daily_room_url);
                                const parts = u.pathname.split("/").filter(Boolean);
                                return parts[parts.length - 1] || `session-${session.id}`;
                            } catch {
                                return `session-${session.id}`;
                            }
                        })()
                        : `session-${session.id}`);

                const safeRoomName = String(roomNameRaw || roomName).toLowerCase().replace(/[^a-z0-9-_]/g, "");
                const finalRoomName = safeRoomName || `session-${session.id}`;

                const api = new window.JitsiMeetExternalAPI(JITSI_DOMAIN, {
                    roomName: finalRoomName,
                    parentNode: iframeContainerRef.current,
                    width: "100%",
                    height: "100%",
                    userInfo: { displayName: userName },

                    // ✅ Keep Jitsi native device/video settings (we open them via toggleSettings).
                    // ✅ Still disable prejoin/name prompt/watermark.
                    configOverwrite: {
                        disableWelcomePage: true,
                        enableWelcomePage: false,

                        prejoinPageEnabled: false,
                        prejoinConfig: {
                            enabled: false,
                            hideDisplayName: true,
                        },
                        requireDisplayName: false,

                        disableDeepLinking: true,

                        startWithAudioMuted: false,
                        startWithVideoMuted: false,

                        disableInviteFunctions: true,
                    },

                    interfaceConfigOverwrite: {
                        SHOW_JITSI_WATERMARK: false,
                        SHOW_WATERMARK_FOR_GUESTS: false,
                        SHOW_BRAND_WATERMARK: false,
                        JITSI_WATERMARK_LINK: "",
                        BRAND_WATERMARK_LINK: "",

                        HIDE_INVITE_MORE_HEADER: true,

                        // keep iframe clean (no Jitsi toolbar), but settings dialog still accessible via executeCommand("toggleSettings")
                        TOOLBAR_BUTTONS: [],

                        DISABLE_FOCUS_INDICATOR: true,
                        DISABLE_DOMINANT_SPEAKER_INDICATOR: true,

                        DEFAULT_REMOTE_DISPLAY_NAME: "Guest",

                        // If your Jitsi build supports it, this helps ensure settings has what we need:
                        // SETTINGS_SECTIONS: ["devices", "profile", "calendar"],
                    },
                });

                apiRef.current = api;

                // Force tile view on start
                try {
                    api.executeCommand("setTileView", true);
                    setTile(true);
                } catch { }

                // Try apply Inter inside iframe (best-effort). Retry a few times after join.
                const tryFont = () => tryApplyInterToIFrame(api);
                const fontTryTimer = window.setInterval(() => {
                    if (destroyed) return;
                    const ok = tryFont();
                    if (ok) window.clearInterval(fontTryTimer);
                }, 800);

                // Stop retries after 8s
                window.setTimeout(() => {
                    try {
                        window.clearInterval(fontTryTimer);
                    } catch { }
                }, 8000);

                // participants poll
                const poll = window.setInterval(() => {
                    if (!destroyed) refreshParticipants();
                }, 1500);

                api.addEventListener?.("readyToClose", leaveToSessions);
                api.addEventListener?.("videoConferenceLeft", leaveToSessions);

                api.addEventListener?.("audioMuteStatusChanged", (e: any) => {
                    if (destroyed) return;
                    setIsAudioMuted(!!e?.muted);
                });
                api.addEventListener?.("videoMuteStatusChanged", (e: any) => {
                    if (destroyed) return;
                    setIsVideoMuted(!!e?.muted);
                });

                api.addEventListener?.("screenSharingStatusChanged", (e: any) => {
                    if (destroyed) return;
                    setIsScreenSharing(!!e?.on);
                });

                api.addEventListener?.("tileViewChanged", (e: any) => {
                    if (destroyed) return;
                    if (typeof e?.enabled === "boolean") setTile(!!e.enabled);
                });

                api.addEventListener?.("participantJoined", () => {
                    if (destroyed) return;
                    refreshParticipants();
                });
                api.addEventListener?.("participantLeft", () => {
                    if (destroyed) return;
                    refreshParticipants();
                });

                api.addEventListener?.("videoConferenceJoined", () => {
                    if (destroyed) return;
                    // another shot at Inter after join
                    tryFont();
                });

                api.addEventListener?.("errorOccurred", (e: any) => {
                    if (destroyed) return;
                    setLastErr(String(e?.error || e?.message || "Jitsi error"));
                });

                refreshParticipants();

                return () => {
                    window.clearInterval(poll);
                    try {
                        window.clearInterval(fontTryTimer);
                    } catch { }
                };
            } catch (e: any) {
                if (destroyed) return;
                setLastErr(String(e?.message || e || "Jitsi init error"));
            }
        })();

        return () => {
            destroyed = true;
            cleanup();
            stopWelcomeLoop();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session, id, userName, navigate, jitsiKey, authUserId]);

    // ====== Controls ======
    const exec = (cmd: string, ...args: any[]) => {
        const api = apiRef.current;
        if (!api) return;
        try {
            api.executeCommand(cmd, ...args);
        } catch { }
    };

    const handleToggleAudio = () => exec("toggleAudio");
    const handleToggleVideo = () => exec("toggleVideo");
    const handleToggleScreenShare = () => exec("toggleShareScreen");

    const handleToggleTile = () => {
        const next = !tile;
        setTile(next);
        exec("setTileView", next);
    };

    // ✅ Native Jitsi settings dialog (devices/video/etc.)
    const handleOpenSettings = () => exec("toggleSettings");

    const handleLeave = async () => {
        const api = apiRef.current;
        if (!api) {
            try {
                if (id && authUserId) await supabase.rpc("attendance_leave", { p_session_id: id });
            } catch { }
            navigate("/sessions", { replace: true });
            return;
        }
        try {
            api.executeCommand("hangup");
        } catch {
            try {
                if (id && authUserId) await supabase.rpc("attendance_leave", { p_session_id: id });
            } catch { }
            navigate("/sessions", { replace: true });
        }
    };

    // ====== Render ======
    if (loading) {
        return <div className={`flex h-screen justify-center items-center ${pageBg}`}>Loading session...</div>;
    }

    if (!session) {
        return (
            <div className={`flex h-screen justify-center items-center ${pageBg}`}>
                <button onClick={() => navigate("/sessions")} className="px-4 py-2 rounded bg-black/10 hover:bg-black/15">
                    Back
                </button>
            </div>
        );
    }

    return (
        <div className={`min-h-screen ${pageBg}`}>
            <div className="w-full px-3 sm:px-5 pt-5 pb-[calc(110px+env(safe-area-inset-bottom))] flex flex-col gap-5 min-h-screen">
                {/* TOP BAR */}
                <div className={`flex w-full rounded-2xl overflow-hidden ${topBarBg}`}>
                    <div className="flex-1 px-6 py-4">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <p className={`font-inter font-semibold text-[18px] truncate ${strongText}`}>{session.title}</p>
                                <p className={`font-inter text-[13px] ${subtleText}`}>{participantsCount} participants</p>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                                {!isSilentRoom && stages.length > 0 && !!stagebarStartTime && (
                                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl ${chipBg}`}>
                                        <Icon name="timer" theme={theme} className="w-4 h-4 opacity-80" alt="Timer" />
                                        <span className={`font-inter text-[13px] ${isLight ? "text-black/75" : "text-white/90"}`}>
                                            {remainingTime || "--:--"}
                                        </span>
                                    </div>
                                )}

                                {/* Theme switcher */}
                                <button
                                    onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                                    className={`w-[84px] h-[32px] rounded-full border relative transition flex items-center px-[3px] ${switchTrackCls}`}
                                    title="Toggle theme"
                                    aria-label="Toggle theme"
                                >
                                    <div className={switchThumb} style={{ transform: thumbTranslate }}>
                                        <Icon
                                            name={isLight ? "theme-sun" : "theme-moon"}
                                            theme={theme}
                                            className="w-4 h-4"
                                            alt={isLight ? "Light" : "Dark"}
                                        />
                                    </div>
                                </button>

                                {/* Reload */}
                                <button
                                    onClick={forceReloadJitsi}
                                    className={`px-3 py-1.5 rounded-xl border transition text-[13px] ${isLight
                                            ? "border-black/10 bg-black/5 hover:bg-black/10 text-black/75"
                                            : "border-white/10 bg-[#0B1220]/60 hover:bg-[#0B1220]/80 text-white/80"
                                        }`}
                                    title="Reload video engine"
                                >
                                    Reload
                                </button>

                                {/* Host */}
                                {session.host_profile && (
                                    <button
                                        onClick={() => setSelectedUser(session.host_profile)}
                                        className={`max-[480px]:hidden flex items-center gap-2 px-3 py-1.5 rounded-xl border transition font-inter text-[13px] ${isLight
                                                ? "border-black/10 bg-black/5 hover:bg-black/10 text-black/75"
                                                : "border-white/10 bg-[#0B1220]/60 hover:bg-[#0B1220]/80 text-[#F3F4F6]/85"
                                            }`}
                                    >
                                        <Icon name="host_session_icon" theme={theme} className="h-5 w-5 opacity-90" alt="" />
                                        <span className="flex items-center gap-1 leading-none">
                                            <span className={isLight ? "font-normal text-black/55" : "font-normal text-white/70"}>Host:</span>
                                            <span className="font-semibold">{session.host_profile.full_name}</span>
                                        </span>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* StageBar */}
                        {!isSilentRoom && stages.length > 0 && !!stagebarStartTime && (
                            <div className="mt-3 w-full overflow-hidden">
                                <div className="w-full overflow-hidden">
                                    <SessionStageBar
                                        stages={stages as any}
                                        startTime={stagebarStartTime}
                                        cycleSeconds={stagebarCycleSeconds}
                                        onHoverStage={setHoveredStage as any}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* MAIN AREA */}
                <div
                    className={
                        "grid gap-5 flex-1 min-h-0 " + (rightPanelOpen ? "lg:grid-cols-[minmax(0,1fr),420px]" : "grid-cols-1")
                    }
                >
                    {/* VIDEO AREA (iFrame) */}
                    <div
                        className={`rounded-2xl overflow-hidden min-h-0 ${isLight ? "bg-white/70 border border-black/10" : "bg-[#0B1220]/45 border border-white/5"
                            }`}
                    >
                        <div className="w-full h-[72vh] min-h-[520px] relative">
                            <div ref={iframeContainerRef} className="w-full h-full" />
                            {lastErr && (
                                <div className="absolute top-4 left-4 text-xs bg-red-600 text-white px-3 py-2 rounded-lg shadow">
                                    {lastErr}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* RIGHT PANEL */}
                    {rightPanelOpen && (
                        <div className={`rounded-2xl shadow-lg overflow-hidden min-h-0 ${panelBg}`}>
                            {/* participants */}
                            {rightTab === "participants" && (
                                <div className="h-full flex flex-col">
                                    <div
                                        className={`px-5 py-4 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"
                                            }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>
                                                Participants
                                            </span>
                                            <span className={`${isLight ? "text-black/50" : "text-white/55"} text-sm`}>
                                                ({participantsCount})
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => openRightTab(null)}
                                            className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight ? "bg-black/5 hover:bg-black/10 text-black/60" : "bg-[#111827] hover:bg-[#1f2937] text-white/80"
                                                }`}
                                            title="Close"
                                        >
                                            ✕
                                        </button>
                                    </div>

                                    <div className="p-4">
                                        <div
                                            className={`rounded-xl px-3 py-2 ${isLight ? "bg-black/5 border border-black/10" : "bg-[#0B1220]/70 border border-white/10"
                                                }`}
                                        >
                                            <input
                                                value={participantsSearch}
                                                onChange={(e) => setParticipantsSearch(e.target.value)}
                                                placeholder="Search participants..."
                                                className={`w-full bg-transparent outline-none text-[13px] placeholder:opacity-60 ${isLight ? "text-black/80 placeholder:text-black/40" : "text-white/85 placeholder:text-white/35"
                                                    }`}
                                            />
                                        </div>
                                    </div>

                                    <div className="flex-1 overflow-y-auto px-4 pb-4">
                                        <div className="flex flex-col gap-2">
                                            {filteredParticipants.map((p) => {
                                                const name = p.isLocal ? "You" : p.displayName || "Guest";
                                                const initials =
                                                    name
                                                        .split(" ")
                                                        .filter(Boolean)
                                                        .slice(0, 2)
                                                        .map((x) => x[0]?.toUpperCase())
                                                        .join("") || "U";

                                                return (
                                                    <div
                                                        key={p.id || name}
                                                        className={`flex items-center justify-between px-3 py-2 rounded-xl transition ${isLight ? "hover:bg-black/5" : "hover:bg-white/5"
                                                            }`}
                                                    >
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <div
                                                                className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${isLight ? "bg-blue-500/15 text-blue-700" : "bg-emerald-500/80 text-[#02140B]"
                                                                    }`}
                                                            >
                                                                {initials}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <div
                                                                    className={`text-[13px] font-medium truncate ${isLight ? "text-black/85" : "text-white/90"
                                                                        }`}
                                                                >
                                                                    {name}
                                                                </div>
                                                                <div className={`text-[11px] truncate ${isLight ? "text-black/45" : "text-white/45"}`}>
                                                                    {p.isLocal ? "Team member" : "Participant"}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-2">
                                                            {p.isLocal ? (
                                                                <>
                                                                    <div
                                                                        className={
                                                                            "w-8 h-8 rounded-lg flex items-center justify-center " +
                                                                            (isAudioMuted ? (isLight ? "bg-red-500/10" : "bg-red-500/20") : isLight ? "bg-black/5" : "bg-white/5")
                                                                        }
                                                                        title={isAudioMuted ? "Muted" : "Unmuted"}
                                                                    >
                                                                        <Icon
                                                                            name={isAudioMuted ? "mic-off" : "mic-on"}
                                                                            theme={isAudioMuted ? "dark" : theme}
                                                                            className={`w-4 h-4 ${isAudioMuted ? "opacity-90" : "opacity-80"}`}
                                                                        />
                                                                    </div>

                                                                    <div
                                                                        className={
                                                                            "w-8 h-8 rounded-lg flex items-center justify-center " +
                                                                            (isVideoMuted ? (isLight ? "bg-red-500/10" : "bg-red-500/20") : isLight ? "bg-black/5" : "bg-white/5")
                                                                        }
                                                                        title={isVideoMuted ? "Video off" : "Video on"}
                                                                    >
                                                                        <Icon
                                                                            name={isVideoMuted ? "camera-off" : "camera-on"}
                                                                            theme={theme}
                                                                            className={`w-4 h-4 ${isVideoMuted ? "opacity-90" : "opacity-80"}`}
                                                                        />
                                                                    </div>
                                                                </>
                                                            ) : (
                                                                <span className={`text-[11px] ${isLight ? "text-black/40" : "text-white/35"}`}>—</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className={`p-4 border-t ${isLight ? "border-black/10" : "border-white/5"}`}>
                                        <button
                                            onClick={() => { }}
                                            className={`w-full h-12 rounded-xl font-semibold flex items-center justify-center gap-2 ${isLight ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-emerald-500 hover:bg-emerald-600 text-[#02140B]"
                                                }`}
                                        >
                                            <span className="text-lg">+</span>
                                            <span>Invite People</span>
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* chat */}
                            {rightTab === "chat" && (
                                <div className="h-full">
                                    <div
                                        className={`px-5 py-4 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"
                                            }`}
                                    >
                                        <div className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>Chat</div>
                                        <button
                                            onClick={() => openRightTab(null)}
                                            className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight ? "bg-black/5 hover:bg-black/10 text-black/60" : "bg-[#111827] hover:bg-[#1f2937] text-white/80"
                                                }`}
                                            title="Close"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                    <div className="p-4 h-[calc(100%-64px)]">{id ? <ChatPanel sessionId={id} /> : null}</div>
                                </div>
                            )}

                            {/* intentions */}
                            {rightTab === "intentions" && (
                                <div className="h-full">
                                    <div
                                        className={`px-5 py-4 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"
                                            }`}
                                    >
                                        <div className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>
                                            Intentions
                                        </div>
                                        <button
                                            onClick={() => openRightTab(null)}
                                            className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight ? "bg-black/5 hover:bg-black/10 text-black/60" : "bg-[#111827] hover:bg-[#1f2937] text-white/80"
                                                }`}
                                            title="Close"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                    <div className="h-[calc(100%-64px)]">
                                        <IntentionsPanel />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* FIXED BOTTOM CONTROLS */}
            <div className="fixed inset-x-0 bottom-0 z-50">
                <div className="w-full px-3 sm:px-5 pb-[calc(12px+env(safe-area-inset-bottom))]">
                    <div
                        className={`h-[64px] sm:h-[74px] rounded-2xl shadow-2xl backdrop-blur grid grid-cols-[auto,1fr,auto] items-center px-2 sm:px-4 ${bottomBarBg}`}
                    >
                        {/* LEFT GROUP */}
                        <div className="flex items-center gap-2" ref={moreMenuRef}>
                            {/* MOBILE */}
                            <div className="md:hidden relative">
                                <button
                                    onClick={() => setShowMoreMenu((v) => !v)}
                                    className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                    title="Menu"
                                >
                                    <span className={isLight ? "text-black/70" : "text-white/85"}>⋯</span>
                                </button>

                                {showMoreMenu && (
                                    <div className="absolute bottom-[76px] sm:bottom-[86px] left-0">
                                        <div
                                            className={`w-[260px] rounded-2xl shadow-2xl overflow-hidden ${isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10"
                                                }`}
                                        >
                                            <button
                                                onClick={() => {
                                                    openRightTab("participants");
                                                    setShowMoreMenu(false);
                                                }}
                                                className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"
                                                    }`}
                                            >
                                                <Icon name="participants" theme={theme} className="w-4 h-4 opacity-90" />
                                                <span>Participants</span>
                                            </button>

                                            <button
                                                onClick={() => {
                                                    openRightTab("chat");
                                                    setShowMoreMenu(false);
                                                }}
                                                className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"
                                                    }`}
                                            >
                                                <Icon name="chat" theme={theme} className="w-4 h-4 opacity-90" />
                                                <span>Chat</span>
                                            </button>

                                            <button
                                                onClick={() => {
                                                    openRightTab("intentions");
                                                    setShowMoreMenu(false);
                                                }}
                                                className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"
                                                    }`}
                                            >
                                                <Icon name="intentions" theme={theme} className="w-4 h-4 opacity-90" />
                                                <span>Intentions</span>
                                            </button>

                                            <div className={isLight ? "h-px bg-black/10" : "h-px bg-white/10"} />

                                            <button
                                                onClick={() => {
                                                    handleOpenSettings();
                                                    setShowMoreMenu(false);
                                                }}
                                                className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"
                                                    }`}
                                            >
                                                <Icon name="settings" theme={theme} className="w-4 h-4 opacity-90" />
                                                <span>Video settings (Jitsi)</span>
                                            </button>

                                            <button
                                                onClick={() => {
                                                    handleToggleTile();
                                                    setShowMoreMenu(false);
                                                }}
                                                className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"
                                                    }`}
                                            >
                                                <Icon name={tile ? "tile-on" : "tile-off"} theme={theme} className="w-4 h-4 opacity-90" />
                                                <span>{tile ? "Tile view: On" : "Tile view: Off"}</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* DESKTOP */}
                            <div className="hidden md:flex items-center gap-2">
                                <button
                                    onClick={() => openRightTab("participants")}
                                    className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                    title="Participants"
                                >
                                    <Icon name="participants" theme={theme} className="w-5 h-5" />
                                </button>

                                <button
                                    onClick={() => openRightTab("chat")}
                                    className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                    title="Chat"
                                >
                                    <Icon name="chat" theme={theme} className="w-5 h-5" />
                                </button>

                                <button
                                    onClick={() => openRightTab("intentions")}
                                    className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                    title="Intentions"
                                >
                                    <Icon name="intentions" theme={theme} className="w-5 h-5" />
                                </button>

                                <button
                                    onClick={handleOpenSettings}
                                    className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                    title="Video settings (Jitsi)"
                                >
                                    <Icon name="settings" theme={theme} className="w-5 h-5" />
                                </button>

                                <button
                                    onClick={handleToggleTile}
                                    className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                    title="Tile view"
                                >
                                    <Icon name={tile ? "tile-on" : "tile-off"} theme={theme} className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        {/* CENTER GROUP */}
                        <div className="flex items-center justify-center gap-2 sm:gap-3">
                            <button
                                onClick={handleToggleAudio}
                                className={
                                    "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition " +
                                    (isAudioMuted ? "bg-red-600 hover:bg-red-700" : ctlBtnBase)
                                }
                                title="Toggle mic"
                            >
                                <Icon
                                    name={isAudioMuted ? "mic-off" : "mic-on"}
                                    theme={isAudioMuted ? "dark" : theme}
                                    className="w-5 h-5"
                                />
                            </button>

                            <button
                                onClick={handleToggleVideo}
                                className={
                                    "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition " +
                                    (isVideoMuted ? "bg-red-600 hover:bg-red-700" : ctlBtnBase)
                                }
                                title="Toggle camera"
                            >
                                <Icon name={isVideoMuted ? "camera-off" : "camera-on"} theme={theme} className="w-5 h-5" />
                            </button>

                            <button
                                onClick={handleToggleScreenShare}
                                className={
                                    "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition " +
                                    (isScreenSharing ? "bg-blue-600 hover:bg-blue-700" : ctlBtnBase)
                                }
                                title="Share screen"
                            >
                                <Icon name="screen-share" theme={theme} className="w-5 h-5" />
                            </button>
                        </div>

                        {/* RIGHT GROUP */}
                        <div className="flex items-center justify-end gap-2 sm:gap-3">
                            <button
                                onClick={handleLeave}
                                className={`hidden sm:flex h-11 px-6 rounded-2xl font-semibold items-center justify-center gap-2 ${isLight ? "bg-red-600 hover:bg-red-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"
                                    }`}
                                title="Leave"
                            >
                                <Icon name="leave" theme={theme} className="w-5 h-5" />
                                <span className="text-[14px]">Leave</span>
                            </button>

                            <button
                                onClick={handleLeave}
                                className="sm:hidden w-10 h-10 rounded-2xl bg-red-600 hover:bg-red-700 text-white flex items-center justify-center"
                                title="Leave"
                            >
                                <Icon name="leave" theme={theme} className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {selectedUser && <UserProfileModal user={selectedUser} onClose={() => setSelectedUser(null)} />}
        </div>
    );
}
