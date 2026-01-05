// src/pages/RoomPageIFrame.tsx
// ROOMPAGE (IFRAME) + JITSI EXTERNAL API + OUR UI CONTROLS
//
// ✅ VARIANT A (stable):
// - Inside Jitsi iframe: show ONLY native "Settings" button
// - Hide all other native Jitsi UI chrome via interfaceConfigOverwrite + /public/jitsi-custom.css
// - Keep internal "mount" toolbarButtons in configOverwrite to ensure settings module/commands load on more builds
//
// Note:
// - We do NOT hide toolbar containers entirely anymore (otherwise Settings disappears too).
// - We hide everything except settings via CSS selectors.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

import { IntentionsPanel } from "../components/IntentionsPanel";
import { SessionStageBar } from "../components/SessionStageBar";
import { UserProfileModal } from "../components/UserProfileModal";
import ChatPanel from "../components/ChatPanel";

type Stage = {
    name: string;
    duration: number; // minutes (display/legacy)
    color: string;
    type: "intro" | "intentions" | "focus" | "break" | "outro" | string;
    durationSeconds?: number;
};

type RightPanelTab = "chat" | "intentions" | null;
type RoomTheme = "dark" | "light";

declare global {
    interface Window {
        JitsiMeetExternalAPI?: any;
    }
}

// ====== JITSI DOMAINS (PRIMARY + FALLBACK) ======
const JITSI_DOMAINS = ["meet2.mysession.club", "meet.mysession.club"] as const;
type JitsiDomain = (typeof JITSI_DOMAINS)[number];

// ✅ INTERNAL: keep modules mounted / commands working on more Jitsi builds
const TOOLBAR_MOUNT_BUTTONS = [
    "microphone",
    "camera",
    "desktop",
    "participants-pane",
    "settings",
    "tileview",
    "hangup",
];

// ✅ DISPLAY ONLY THIS in the iframe (native UI)
const TOOLBAR_VISIBLE_BUTTONS = ["settings"];

// ====== AUDIO ======
const STAGE_SOUND_MAP: Record<string, string> = {
    intentions: "/sounds/intentions.mp3",
    focus: "/sounds/focus.mp3",
    break: "/sounds/break_start.mp3",
    outro: "/sounds/outro.mp3",
};
const BREAK_END_SOUND = "/sounds/break_end.mp3";
const WELCOME_LOOP_SOUND = "/sounds/welcome_loop.mp3";

// ====== helpers ======
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

        // heuristic: <=180 means minutes, else seconds
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
                const seconds =
                    typeof v === "number" ? (v <= 180 ? Number(v) * 60 : Number(v)) : toSeconds(v);
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
    return "focus";
}

const STAGE_COLORS: Record<string, string> = {
    intro: "#80DF86",
    intentions: "#ADD3FF",
    focus: "#4CA0FF",
    break: "#F9ADA2",
    outro: "#80DF86",
};

// ===============================
// JITSI EXTERNAL API LOADER
// - loads external_api.js from chosen domain
// - does NOT bail out early just because window.JitsiMeetExternalAPI already exists
//   (we still want to try domains in order and have reliable behavior)
// ===============================
async function loadJitsiExternalApi(domain: string) {
    if (typeof window === "undefined") return;

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
                if (!window.JitsiMeetExternalAPI) reject(new Error(`external_api.js present but API missing (${domain})`));
            }, 6000);

            return;
        }

        const s = document.createElement("script");
        s.src = src;
        s.async = true;

        s.onload = () => {
            const t = setInterval(() => {
                if (window.JitsiMeetExternalAPI) {
                    clearInterval(t);
                    resolve();
                }
            }, 50);

            setTimeout(() => {
                clearInterval(t);
                if (!window.JitsiMeetExternalAPI) reject(new Error(`external_api.js loaded but API missing (${domain})`));
            }, 3000);
        };

        s.onerror = () => reject(new Error(`Failed to load Jitsi external_api.js (${domain})`));
        document.head.appendChild(s);
    });
}

async function createJitsiApiWithFallback(args: {
    domains: readonly string[];
    roomName: string;
    parentNode: HTMLElement;
    userName: string;
    customCssUrl?: string;
    onDomainChosen?: (d: string) => void;
}) {
    let lastError: any = null;

    for (const domain of args.domains) {
        try {
            await loadJitsiExternalApi(domain);

            // Clear container before creating iframe
            args.parentNode.innerHTML = "";

            const api = new window.JitsiMeetExternalAPI(domain, {
                roomName: args.roomName,
                parentNode: args.parentNode,
                width: "100%",
                height: "100%",
                userInfo: { displayName: args.userName },

                configOverwrite: {
                    disableWelcomePage: true,
                    enableWelcomePage: false,

                    prejoinPageEnabled: false,
                    prejoinConfig: { enabled: false },
                    requireDisplayName: false,

                    disableDeepLinking: true,
                    disableInviteFunctions: true,

                    startWithAudioMuted: false,
                    startWithVideoMuted: false,

                    // ✅ Keep modules mounted on more builds
                    toolbarButtons: TOOLBAR_MOUNT_BUTTONS,

                    ...(args.customCssUrl ? { customCssUrl: args.customCssUrl } : {}),
                },

                interfaceConfigOverwrite: {
                    // ✅ Show ONLY settings in the iframe UI
                    TOOLBAR_BUTTONS: TOOLBAR_VISIBLE_BUTTONS,
                    TOOLBAR_ALWAYS_VISIBLE: true,
                    TOOLBAR_TIMEOUT: 0,
                    TOOLBAR_TIMEOUT_NO_HOVER: 0,

                    SHOW_JITSI_WATERMARK: false,
                    SHOW_WATERMARK_FOR_GUESTS: false,
                    SHOW_BRAND_WATERMARK: false,
                    JITSI_WATERMARK_LINK: "",

                    HIDE_INVITE_MORE_HEADER: true,
                    DISABLE_FOCUS_INDICATOR: true,
                    DISABLE_DOMINANT_SPEAKER_INDICATOR: true,

                    DEFAULT_REMOTE_DISPLAY_NAME: "Guest",
                },
            });

            args.onDomainChosen?.(domain);
            return { api, domain: domain as JitsiDomain };
        } catch (e) {
            lastError = e;
            try {
                args.parentNode.innerHTML = "";
            } catch { }
            continue;
        }
    }

    throw lastError || new Error("Failed to create Jitsi API on all domains");
}

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
    | "chat"
    | "intentions"
    | "settings"
    | "tile-on"
    | "tile-off"
    | "theme-sun"
    | "theme-moon"
    | "timer";
    theme: RoomTheme;
    className?: string;
    alt?: string;
}) {
    const themedSrc = `/icons/${name}-${theme}.svg`;
    const fallbackSrc = `/icons/${name}.svg`;
    const [src, setSrc] = useState(themedSrc);

    useEffect(() => {
        setSrc(themedSrc);
    }, [themedSrc]);

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

export default function RoomPageIFrame() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const iframeContainerRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<any>(null);

    const [session, setSession] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const [theme, setTheme] = useState<RoomTheme>(() => {
        try {
            const v = String(localStorage.getItem("room_theme") || "").toLowerCase();
            return v === "light" ? "light" : "dark";
        } catch {
            return "dark";
        }
    });
    const isLight = theme === "light";

    useEffect(() => {
        try {
            localStorage.setItem("room_theme", theme);
        } catch { }
    }, [theme]);

    const [stages, setStages] = useState<Stage[]>([]);
    const [hoveredStage, setHoveredStage] = useState<Stage | null>(null);
    const [currentStage, setCurrentStage] = useState(0);
    const [remainingTime, setRemainingTime] = useState<string>("");

    const [stagebarStartTime, setStagebarStartTime] = useState<string>("");
    const [stagebarCycleSeconds, setStagebarCycleSeconds] = useState<number | undefined>(undefined);

    const [selectedUser, setSelectedUser] = useState<any>(null);
    const [userName, setUserName] = useState<string>("");

    const [lastErr, setLastErr] = useState<string>("");

    // iframe state
    const [tile, setTile] = useState(true);
    const [mutedAudio, setMutedAudio] = useState(false);
    const [mutedVideo, setMutedVideo] = useState(false);
    const [isScreenSharing, setIsScreenSharing] = useState(false);

    // right panel (for chat/intentions only)
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

    const roomName = useMemo(() => (id ? `session-${id}` : "session-unknown"), [id]);

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

    const isSilentRoom = useMemo(() => {
        const fmt = String(session?.format || "").toLowerCase();
        const title = String(session?.title || "").toLowerCase();

        const tpl = session?.session_templates;
        const tplName = Array.isArray(tpl)
            ? String(tpl?.[0]?.name || tpl?.[0]?.title || "")
            : String(tpl?.name || tpl?.title || "");
        const tplKey = Array.isArray(tpl)
            ? String(tpl?.[0]?.key || tpl?.[0]?.slug || tpl?.[0]?.type || "")
            : String(tpl?.key || tpl?.slug || tpl?.type || "");
        const tplFmt = Array.isArray(tpl) ? String(tpl?.[0]?.format || "") : String(tpl?.format || "");

        const hay = `${fmt} ${title} ${tplName} ${tplKey} ${tplFmt}`.toLowerCase();
        return hay.includes("silent");
    }, [session]);

    // Key to force recreate Jitsi iframe reliably
    const [jitsiKey, setJitsiKey] = useState(0);
    const forceReloadJitsi = () => {
        try {
            apiRef.current?.dispose?.();
        } catch { }
        apiRef.current = null;
        if (iframeContainerRef.current) iframeContainerRef.current.innerHTML = "";
        setLastErr("");
        setJitsiKey((x) => x + 1);
    };

    // =========================
    // AUDIO SYSTEM
    // =========================
    const prevStageRef = useRef<number>(-1);
    const firstTickDoneRef = useRef<boolean>(false);
    const welcomeLoopRef = useRef<HTMLAudioElement | null>(null);
    const audioUnlockedRef = useRef<boolean>(false);

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

    const startWelcomeLoop = () => {
        stopWelcomeLoop();
        const a = new Audio(WELCOME_LOOP_SOUND);
        a.loop = true;
        a.volume = 0.6;
        welcomeLoopRef.current = a;
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

    // ============================================
    // LOAD SESSION + BUILD STAGES
    // ============================================
    useEffect(() => {
        (async () => {
            if (!id) return;

            const { data, error } = await supabase
                .from("sessions")
                .select(
                    "*, host_profile:profiles!sessions_host_id_fkey(id, full_name, avatar_url, bio), session_templates(*)"
                )
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

                // legacy array schedule
                if (Array.isArray(parsed)) {
                    const formatted: Stage[] = parsed
                        .map((b: any) => {
                            const lower = String(b?.name || "").toLowerCase();
                            const type: Stage["type"] =
                                b.type ||
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
                                name: b.name,
                                duration: Number(b.minutes) || 0,
                                color: STAGE_COLORS[type] || "#F63135",
                                type,
                            };
                        })
                        .filter((s) => Number.isFinite(s.duration) && s.duration > 0);

                    setStages(formatted);
                    setStagebarStartTime(String(data.start_time || fallbackStart));
                    setStagebarCycleSeconds(undefined);
                }

                // infinite object schedule
                const isInfiniteScheduleObject =
                    parsed &&
                    typeof parsed === "object" &&
                    !Array.isArray(parsed) &&
                    (String((parsed as any)?.kind || "")
                        .toLowerCase()
                        .includes("infinite") ||
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
                                        : String(p.name || "Stage");

                        const seconds = Number(p.seconds) || 0;
                        const minutes = Math.max(1, Math.round(seconds / 60));

                        return {
                            name: displayName,
                            duration: minutes,
                            color: STAGE_COLORS[type] || "#F63135",
                            type,
                            durationSeconds: seconds,
                        };
                    });

                    setStages(formatted);

                    const anchor = String(
                        (parsed as any)?.anchor_ts ||
                        (parsed as any)?.anchorTs ||
                        data?.start_time ||
                        fallbackStart
                    );
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

    // ============================================
    // RESOLVE USER NAME (no prompt)
    // ============================================
    useEffect(() => {
        (async () => {
            const { data } = await supabase.auth.getUser();
            const u = data.user;

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

    // ============================================
    // STAGES TIMER + SOUND
    // ============================================
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
            const sec = Number(s.durationSeconds || 0);
            if (sec > 0) return sec;
            const mins = Number(s.duration) || 0;
            return mins > 0 ? mins * 60 : 0;
        });

        const sumStageSeconds = stageSeconds.reduce((acc, v) => acc + v, 0);
        const loopSeconds =
            (Number(stagebarCycleSeconds) || 0) > 0 ? Number(stagebarCycleSeconds) : Math.max(1, sumStageSeconds);

        const timer = window.setInterval(() => {
            const now = Date.now();
            const diffSecRaw = (now - startMs) / 1000;

            const diffSec =
                loopSeconds > 0 && isInfiniteRoom
                    ? ((diffSecRaw % loopSeconds) + loopSeconds) % loopSeconds
                    : diffSecRaw;

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

    // ============================================
    // JITSI INIT (External API) with fallback domains
    // ============================================
    useEffect(() => {
        if (!session || !id) return;
        if (!iframeContainerRef.current) return;
        if (!userName) return;

        let destroyed = false;

        const cleanup = () => {
            stopWelcomeLoop();
            try {
                apiRef.current?.dispose?.();
            } catch { }
            apiRef.current = null;
        };

        const leaveToSessions = () => {
            if (destroyed) return;
            destroyed = true;
            cleanup();
            navigate("/sessions", { replace: true });
        };

        (async () => {
            try {
                const customCssUrl =
                    typeof window !== "undefined" ? `${window.location.origin}/jitsi-custom.css` : undefined;

                const { api, domain } = await createJitsiApiWithFallback({
                    domains: JITSI_DOMAINS,
                    roomName,
                    parentNode: iframeContainerRef.current!,
                    userName,
                    customCssUrl,
                    onDomainChosen: (d) => console.log("[JITSI] Using domain:", d),
                });

                if (destroyed) {
                    try {
                        api?.dispose?.();
                    } catch { }
                    return;
                }

                apiRef.current = api;

                // Tile view on start
                try {
                    api.executeCommand("setTileView", true);
                    setTile(true);
                } catch { }

                // Optional: store chosen domain in console only (for debugging)
                console.log("[JITSI] Domain chosen:", domain);

                api.addEventListener?.("readyToClose", leaveToSessions);
                api.addEventListener?.("videoConferenceLeft", leaveToSessions);

                api.addEventListener?.("audioMuteStatusChanged", (e: any) => {
                    if (destroyed) return;
                    setMutedAudio(!!e?.muted);
                });

                api.addEventListener?.("videoMuteStatusChanged", (e: any) => {
                    if (destroyed) return;
                    setMutedVideo(!!e?.muted);
                });

                api.addEventListener?.("tileViewChanged", (e: any) => {
                    if (destroyed) return;
                    if (typeof e?.enabled === "boolean") setTile(!!e.enabled);
                });

                api.addEventListener?.("screenSharingStatusChanged", (e: any) => {
                    if (destroyed) return;
                    if (typeof e?.on === "boolean") setIsScreenSharing(!!e.on);
                    if (typeof e?.enabled === "boolean") setIsScreenSharing(!!e.enabled);
                });

                api.addEventListener?.("errorOccurred", (e: any) => {
                    if (destroyed) return;
                    setLastErr(String(e?.error || e?.message || "Jitsi error"));
                });
            } catch (e: any) {
                if (destroyed) return;
                setLastErr(String(e?.message || e || "Jitsi init error"));
            }
        })();

        return () => {
            destroyed = true;
            cleanup();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session, id, userName, roomName, navigate, jitsiKey]);

    // ============================================
    // Controls (bottom bar)
    // ============================================
    const toggleTile = () => {
        const api = apiRef.current;
        if (!api) return;
        const next = !tile;
        setTile(next);
        try {
            api.executeCommand("setTileView", next);
        } catch { }
    };

    const toggleMic = () => {
        const api = apiRef.current;
        if (!api) return;
        try {
            api.executeCommand("toggleAudio");
        } catch { }
    };

    const toggleCam = () => {
        const api = apiRef.current;
        if (!api) return;
        try {
            api.executeCommand("toggleVideo");
        } catch { }
    };

    const toggleScreenShare = () => {
        const api = apiRef.current;
        if (!api) return;
        try {
            api.executeCommand("toggleShareScreen");
        } catch { }
    };

    // Our button - try to open settings via command (not guaranteed on all builds),
    // BUT native settings button exists in iframe anyway (Variant A), so we're safe.
    const openNativeSettings = () => {
        const api = apiRef.current;
        if (!api) return;

        try {
            api.executeCommand("toggleSettings");
            return;
        } catch { }

        try {
            api.executeCommand("toggleDeviceSelection");
            return;
        } catch { }

        try {
            api.executeCommand("openSettings");
        } catch { }
    };

    const hangup = () => {
        const api = apiRef.current;
        if (!api) {
            navigate("/sessions", { replace: true });
            return;
        }
        try {
            api.executeCommand("hangup");
        } catch {
            navigate("/sessions", { replace: true });
        }
    };

    // ============================================
    // UI TOKENS
    // ============================================
    const pageBg = isLight ? "bg-[#F6F7FB] text-[#0B1220]" : "bg-[#050F1A] text-white";
    const topBarBg = isLight ? "bg-white/85 border border-black/10" : "bg-[#111827]/40 border border-white/5";
    const chipBg = isLight ? "bg-black/5 border border-black/10" : "bg-[#0B1220]/70 border border-white/5";
    const subtleText = isLight ? "text-black/55" : "text-[#9CA3AF]";
    const strongText = isLight ? "text-black/85" : "text-[#F3F4F6]/90";
    const panelBg = isLight ? "bg-white/85 border border-black/10" : "bg-[#0B1220]/55 border border-white/5";
    const bottomBarBg = isLight ? "bg-white/85 border border-black/10" : "bg-[#07101E]/85 border border-white/10";
    const ctlBtnBase = isLight ? "bg-black/5 hover:bg-black/10" : "bg-[#111827] hover:bg-[#1f2937]";

    // Theme switcher
    const switchTrack = "w-[84px] h-[32px] rounded-full border relative transition flex items-center px-[3px]";
    const switchTrackCls = isLight
        ? "bg-black/5 border-black/10 hover:bg-black/10"
        : "bg-white/5 border-white/10 hover:bg-white/10";
    const switchThumb =
        "absolute top-[2px] w-[26px] h-[26px] rounded-full shadow-md transition-transform bg-white flex items-center justify-center";
    const thumbTranslate = isLight ? "translateX(0px)" : "translateX(50px)";

    // ============================================
    // RENDER
    // ============================================
    if (loading) {
        return <div className={`flex h-screen justify-center items-center ${pageBg}`}>Loading session...</div>;
    }

    if (!session) {
        return (
            <div className={`flex h-screen justify-center items-center ${pageBg}`}>
                <button onClick={() => navigate("/sessions")}>Back</button>
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
                                <p className={`font-inter text-[13px] ${subtleText}`}>{isSilentRoom ? "Silent room" : "Video session"}</p>
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
                                    className={`${switchTrack} ${switchTrackCls}`}
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
                                    className={`px-3 py-2 rounded-xl border transition font-inter text-[13px] ${isLight
                                            ? "border-black/10 bg-black/5 hover:bg-black/10 text-black/75"
                                            : "border-white/10 bg-[#0B1220]/60 hover:bg-[#0B1220]/80 text-[#F3F4F6]/85"
                                        }`}
                                    title="Reload video engine"
                                >
                                    Reload
                                </button>

                                {/* Host */}
                                {session.host_profile && (
                                    <button
                                        onClick={() => setSelectedUser(session.host_profile)}
                                        className={`max-[520px]:hidden flex items-center gap-2 px-3 py-2 rounded-xl border transition font-inter text-[13px] ${isLight
                                                ? "border-black/10 bg-black/5 hover:bg-black/10 text-black/75"
                                                : "border-white/10 bg-[#0B1220]/60 hover:bg-[#0B1220]/80 text-[#F3F4F6]/85"
                                            }`}
                                    >
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
                                <SessionStageBar
                                    stages={stages as any}
                                    startTime={stagebarStartTime}
                                    cycleSeconds={stagebarCycleSeconds}
                                    onHoverStage={setHoveredStage as any}
                                />
                            </div>
                        )}

                        {!isSilentRoom && stages.length > 0 && (
                            <div className={`mt-2 text-[13px] font-inter ${isLight ? "text-black/60" : "text-white/60"}`}>
                                {hoveredStage ? `${hoveredStage.name} • ${hoveredStage.duration} min` : stages[currentStage]?.name}
                            </div>
                        )}
                    </div>
                </div>

                {/* MAIN AREA */}
                <div className={"grid gap-5 flex-1 min-h-0 " + (rightPanelOpen ? "lg:grid-cols-[minmax(0,1fr),420px]" : "grid-cols-1")}>
                    {/* VIDEO */}
                    <div className={`rounded-2xl overflow-hidden min-h-0 relative ${isLight ? "bg-white/70 border border-black/10" : "bg-[#0B1220]/45 border border-white/5"}`}>
                        <div ref={iframeContainerRef} className="w-full h-full min-h-[60vh]" />
                        {lastErr && (
                            <div className="absolute top-4 left-4 text-xs bg-red-600 text-white px-3 py-2 rounded-lg shadow z-30">
                                {lastErr}
                            </div>
                        )}
                    </div>

                    {/* RIGHT PANEL (chat/intentions) */}
                    {rightPanelOpen && (
                        <div className={`rounded-2xl shadow-lg overflow-hidden min-h-0 ${panelBg}`}>
                            {rightTab === "chat" && (
                                <div className="h-full">
                                    <div className={`px-5 py-4 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"}`}>
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

                            {rightTab === "intentions" && (
                                <div className="h-full">
                                    <div className={`px-5 py-4 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"}`}>
                                        <div className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>Intentions</div>
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
                    <div className={`h-[64px] sm:h-[74px] rounded-2xl shadow-2xl backdrop-blur grid grid-cols-[auto,1fr,auto] items-center px-2 sm:px-4 ${bottomBarBg}`}>
                        {/* LEFT GROUP */}
                        <div className="flex items-center gap-2">
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
                                onClick={openNativeSettings}
                                className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                title="Settings (Jitsi)"
                            >
                                <Icon name="settings" theme={theme} className="w-5 h-5" />
                            </button>
                        </div>

                        {/* CENTER GROUP */}
                        <div className="flex items-center justify-center gap-2 sm:gap-3">
                            <button
                                onClick={toggleMic}
                                className={
                                    "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition " +
                                    (mutedAudio ? "bg-red-600 hover:bg-red-700" : ctlBtnBase)
                                }
                                title={mutedAudio ? "Unmute mic" : "Mute mic"}
                            >
                                <Icon name={mutedAudio ? "mic-off" : "mic-on"} theme={mutedAudio ? "dark" : theme} className="w-5 h-5" />
                            </button>

                            <button
                                onClick={toggleCam}
                                className={
                                    "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition " +
                                    (mutedVideo ? "bg-red-600 hover:bg-red-700" : ctlBtnBase)
                                }
                                title={mutedVideo ? "Turn camera on" : "Turn camera off"}
                            >
                                <Icon name={mutedVideo ? "camera-off" : "camera-on"} theme={theme} className="w-5 h-5" />
                            </button>

                            <button
                                onClick={toggleScreenShare}
                                className={
                                    "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition " +
                                    (isScreenSharing ? "bg-blue-600 hover:bg-blue-700" : ctlBtnBase)
                                }
                                title="Share screen"
                            >
                                <Icon name="screen-share" theme={theme} className="w-5 h-5" />
                            </button>

                            <button
                                onClick={toggleTile}
                                className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                title={tile ? "Disable tile view" : "Enable tile view"}
                            >
                                <Icon name={tile ? "tile-on" : "tile-off"} theme={theme} className="w-5 h-5" />
                            </button>
                        </div>

                        {/* RIGHT GROUP */}
                        <div className="flex items-center justify-end gap-2 sm:gap-3">
                            <button
                                onClick={hangup}
                                className={`hidden sm:flex h-11 px-6 rounded-2xl font-semibold items-center justify-center gap-2 ${isLight ? "bg-red-600 hover:bg-red-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"
                                    }`}
                                title="Leave"
                            >
                                <Icon name="leave" theme={theme} className="w-5 h-5" />
                                <span className="text-[14px]">Leave</span>
                            </button>

                            <button
                                onClick={hangup}
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
