// src/pages/RoomPageIFrame.tsx
// ROOMPAGE (IFRAME) + JITSI EXTERNAL API + OUR UI CONTROLS
//
// ✅ Goal now:
// - Hide ALL native Jitsi UI inside iframe (CSS from SAME Jitsi domain)
// - Use our own controls only
// - Tile view ON by default
// - ✅ Enforce participant limit from sessions.max_participants (default 16)
// - ✅ Allow opening by UUID OR by sessions.custom_slug (no uuid cast error)
//
// Fixes in this version:
// - ✅ Prevent "everyone gets kicked" when capacity is reached:
//    * Only the *new joiner* self-leaves if over capacity (checked on videoConferenceJoined)
//    * Host (if possible) kicks only the extra participant on participantJoined
// - ✅ More reliable participant counting (no naive +1)
//
// ✅ FIXES ADDED (important):
// 1) CUSTOM_BLOCK_GRADIENT declared BEFORE STAGE_COLORS (prevents ReferenceError on import)
// 2) rawName defined in infinite schedule branch (prevents ReferenceError)
// 3) Array schedule: preserve custom block names (don't overwrite focus/custom/recap etc with defaults)

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
    type:
    | "intro"
    | "intentions"
    | "focus"
    | "break"
    | "outro"
    | "checkin"
    | "recap"
    | "celebrate"
    | "custom"
    | string;
    durationSeconds?: number;
};

type RightPanelTab = "chat" | "intentions" | null;
type RoomTheme = "dark" | "light";

declare global {
    interface Window {
        JitsiMeetExternalAPI?: any;
    }
}

// ===============================
// helpers: uuid / slug
// ===============================
const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sanitizeSlug(input: string) {
    const raw = String(input || "").trim().toLowerCase();
    const spaced = raw.replace(/\s+/g, "-");
    const clean = spaced.replace(/[^a-z0-9-_]/g, "");
    return clean;
}

// ===============================
// JITSI DOMAINS (PRIMARY + FALLBACK)
// ===============================
const ALL_JITSI_DOMAINS = [
    "meet-eu.mysession.club",
    "meet-us-east.mysession.club",
    "meet-apac.mysession.club",
] as const;

type JitsiDomain = (typeof ALL_JITSI_DOMAINS)[number];

function domainsForSession(session: any): readonly string[] {
    const preferred = String(session?.jitsi_domain || "").trim();
    if (preferred && (ALL_JITSI_DOMAINS as readonly string[]).includes(preferred)) {
        return [preferred, ...ALL_JITSI_DOMAINS.filter((d) => d !== preferred)];
    }
    return ALL_JITSI_DOMAINS;
}

const TOOLBAR_MOUNT_BUTTONS = ["settings"];
const TOOLBAR_VISIBLE_BUTTONS: string[] = [];
const JITSI_CUSTOM_CSS_PATH = "/jitsi-custom.css";

// ====== AUDIO ======
const STAGE_SOUND_MAP: Record<string, string> = {
    // ✅ check-in должен иметь звук старта
    checkin: "/sounds/intentions.mp3",

    // talking / planning
    intentions: "/sounds/intentions.mp3",

    // work / rest
    focus: "/sounds/focus.mp3",
    break: "/sounds/break_start.mp3",

    // ending
    outro: "/sounds/outro.mp3",

    // optional: если хочешь, можно задействовать существующий outro как “wrap-up”:
    recap: "/sounds/outro.mp3",
    celebrate: "/sounds/outro.mp3",
};
const BREAK_END_SOUND = "/sounds/break_end.mp3";
const WELCOME_LOOP_SOUND = "/sounds/welcome_loop.mp3";

// ====== participants limit ======
const DEFAULT_MAX_PARTICIPANTS = 16;
const MIN_PARTICIPANTS = 3;
const MAX_PARTICIPANTS = 64;

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

// ✅ Session Studio / builder wrappers can be like { blocks: [...] } / { agenda: [...] } etc
function unwrapScheduleBlocks(parsed: any): any {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;

    const candidates: any[] = [
        (parsed as any)?.blocks,
        (parsed as any)?.script,
        (parsed as any)?.agenda,
        (parsed as any)?.items,
        (parsed as any)?.stages,
        (parsed as any)?.data?.blocks,
        (parsed as any)?.data?.script,
        (parsed as any)?.data?.agenda,
        (parsed as any)?.data?.items,
        (parsed as any)?.data?.stages,
    ];

    for (const c of candidates) {
        if (Array.isArray(c)) return c;
    }
    return parsed;
}

function normalizeInfinitePhases(anyPhases: any): { name: string; seconds: number }[] {
    if (!anyPhases) return [];

    const toSeconds = (raw: any): number => {
        const explicitSeconds = Number(raw?.seconds) || Number(raw?.duration_seconds) || Number(raw?.durationSeconds);
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
                const seconds = typeof v === "number" ? (v <= 180 ? Number(v) * 60 : Number(v)) : toSeconds(v);
                return { name, seconds };
            })
            .filter((x) => x.seconds > 0);
    }

    return [];
}

function phaseToStageType(phaseNameLower: string): Stage["type"] {
    if (phaseNameLower.includes("custom")) return "custom";
    if (phaseNameLower.includes("recap")) return "recap";
    if (phaseNameLower.includes("celebrate") || phaseNameLower.includes("celebration")) return "celebrate";
    if (phaseNameLower.includes("focus")) return "focus";
    if (phaseNameLower.includes("checkin") || phaseNameLower.includes("check-in")) return "checkin";
    if (phaseNameLower.includes("intention")) return "intentions";
    if (phaseNameLower.includes("break") || phaseNameLower.includes("rest")) return "break";
    return "focus";
}

// ✅ FIX #1: define BEFORE STAGE_COLORS (const is not hoisted)
const CUSTOM_BLOCK_GRADIENT =
    "linear-gradient(90deg, #5286F6 0%, #65D46C 40%, #F65252 80%, #F65252 100%)";

const STAGE_COLORS: Record<string, string> = {
    intro: "#80DF86",
    intentions: "#ADD3FF",
    checkin: "#ADD3FF",

    focus: "#4CA0FF",

    recap: "#A78BFA",
    celebrate: "#F472B6",
    custom: CUSTOM_BLOCK_GRADIENT,

    break: "#F9ADA2",
    outro: "#80DF86",
};

// ===============================
// JITSI EXTERNAL API LOADER
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
    cssPathOnJitsiDomain?: string; // like "/jitsi-custom.css"
    onDomainChosen?: (d: string) => void;
}) {
    let lastError: any = null;

    for (const domain of args.domains) {
        try {
            await loadJitsiExternalApi(domain);

            args.parentNode.innerHTML = "";

            const cssUrl =
                args.cssPathOnJitsiDomain && args.cssPathOnJitsiDomain.startsWith("/")
                    ? `https://${domain}${args.cssPathOnJitsiDomain}?v=${Date.now()}`
                    : undefined;

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

                    startWithTileView: true,

                    subject: "",
                    hideConferenceSubject: true,
                    hideConferenceTimer: true,
                    conferenceInfo: { alwaysVisible: [], autoHide: [] },

                    toolbarButtons: TOOLBAR_MOUNT_BUTTONS,

                    ...(cssUrl ? { customCssUrl: cssUrl } : {}),
                },

                interfaceConfigOverwrite: {
                    TOOLBAR_BUTTONS: TOOLBAR_VISIBLE_BUTTONS,
                    TOOLBAR_ALWAYS_VISIBLE: false,
                    TOOLBAR_TIMEOUT: 0,
                    TOOLBAR_TIMEOUT_NO_HOVER: 0,

                    SHOW_JITSI_WATERMARK: false,
                    SHOW_WATERMARK_FOR_GUESTS: false,
                    SHOW_BRAND_WATERMARK: false,
                    SHOW_POWERED_BY: false,
                    SHOW_PROMOTIONAL_CLOSE_PAGE: false,

                    JITSI_WATERMARK_LINK: "",
                    BRAND_WATERMARK_LINK: "",

                    HIDE_INVITE_MORE_HEADER: true,
                    DISABLE_FOCUS_INDICATOR: true,
                    DISABLE_DOMINANT_SPEAKER_INDICATOR: true,

                    DEFAULT_REMOTE_DISPLAY_NAME: "Guest",
                },
            });

            try {
                api.executeCommand?.("subject", "");
            } catch { }

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

// ✅ Inline icons to avoid missing assets on mobile
function UsersInlineIcon({ className = "w-4 h-4" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
            <path
                d="M16 11a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 16 11Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M4.5 11.5a3 3 0 1 0-3-3 3 3 0 0 0 3 3Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M10.5 20c0-3 2.5-5.5 5.5-5.5S21.5 17 21.5 20"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M1.5 20c0-2.2 1.6-4.1 3.7-4.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function RefreshInlineIcon({ className = "w-4 h-4" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
            <path
                d="M21 12a9 9 0 0 1-15.4 6.4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M3 12a9 9 0 0 1 15.4-6.4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path d="M21 7v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 17v-5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// ✅ Smart icon: participants (tries existing assets, then inline fallback)
function ParticipantsSmartIcon({
    theme,
    className = "w-4 h-4",
}: {
    theme: RoomTheme;
    className?: string;
}) {
    const candidates = [
        `/icons/participants-${theme}.svg`,
        `/icons/participants.svg`,
        `/icons/users-${theme}.svg`,
        `/icons/users.svg`,
    ];
    const [idx, setIdx] = useState(0);
    const [inline, setInline] = useState(false);

    useEffect(() => {
        setIdx(0);
        setInline(false);
    }, [theme]);

    if (inline) return <UsersInlineIcon className={className} />;

    const src = candidates[idx] || candidates[candidates.length - 1];

    return (
        <img
            src={src}
            onError={() => {
                if (idx < candidates.length - 1) setIdx((x) => x + 1);
                else setInline(true);
            }}
            className={className}
            alt=""
            draggable={false}
        />
    );
}

// ✅ Smart icon: reload (expects /icons/reload.svg, then inline fallback)
function ReloadSmartIcon({ theme, className = "w-4 h-4" }: { theme: RoomTheme; className?: string }) {
    const candidates = [`/icons/reload-${theme}.svg`, `/icons/reload.svg`, `/icons/refresh-${theme}.svg`, `/icons/refresh.svg`];
    const [idx, setIdx] = useState(0);
    const [inline, setInline] = useState(false);

    useEffect(() => {
        setIdx(0);
        setInline(false);
    }, [theme]);

    if (inline) return <RefreshInlineIcon className={className} />;

    const src = candidates[idx] || candidates[candidates.length - 1];

    return (
        <img
            src={src}
            onError={() => {
                if (idx < candidates.length - 1) setIdx((x) => x + 1);
                else setInline(true);
            }}
            className={className}
            alt=""
            draggable={false}
        />
    );
}

export default function RoomPageIFrame() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const idOrSlug = String(id || "").trim();

    const iframeContainerRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<any>(null);
    const supportedCmdsRef = useRef<string[] | null>(null);

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
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);

    const [lastErr, setLastErr] = useState<string>("");

    // capacity enforcement UI (only for the client who is being rejected)
    const [capacityError, setCapacityError] = useState<string | null>(null);
    const capacityTriggeredRef = useRef(false);
    const localJoinedRef = useRef(false);
    const localParticipantIdRef = useRef<string | null>(null);
    const overLimitHitsRef = useRef(0);
    const kickedIdsRef = useRef<Set<string>>(new Set());
    const localIsModeratorRef = useRef<boolean>(false);

    // iframe state
    const [tile, setTile] = useState(true);
    const [mutedAudio, setMutedAudio] = useState(false);
    const [mutedVideo, setMutedVideo] = useState(false);
    const [isScreenSharing, setIsScreenSharing] = useState(false);

    const [apiReady, setApiReady] = useState(false);

    // ✅ live participant count for UI (current/max)
    const [participantsNow, setParticipantsNow] = useState<number>(0);

    // right panel
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

    const isHost = useMemo(() => {
        const sid = String(session?.host_id || "");
        return !!currentUserId && !!sid && currentUserId === sid;
    }, [currentUserId, session?.host_id]);

    // ✅ max participants from DB (default 16)
    const maxParticipants = useMemo(() => {
        const n = Number(session?.max_participants);
        if (Number.isFinite(n) && n >= MIN_PARTICIPANTS) {
            return Math.max(MIN_PARTICIPANTS, Math.min(MAX_PARTICIPANTS, Math.floor(n)));
        }
        return DEFAULT_MAX_PARTICIPANTS;
    }, [session]);

    // ✅ Room name
    const roomName = useMemo(() => {
        const fallback = idOrSlug ? `session-${idOrSlug}` : "session-unknown";

        const rawFromDb = String(session?.jitsi_room_name || "").trim();
        if (rawFromDb) {
            const safe = rawFromDb.toLowerCase().replace(/[^a-z0-9-_]/g, "");
            return safe || fallback;
        }

        const dailyUrl = String(session?.daily_room_url || "").trim();
        if (dailyUrl) {
            try {
                const u = new URL(dailyUrl);
                const path = String(u.pathname || "").replace(/^\//, "").split("/")[0] || "";
                const safe = path.toLowerCase().replace(/[^a-z0-9-_]/g, "");
                return safe || fallback;
            } catch { }
        }

        return fallback;
    }, [session, idOrSlug]);

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
        const tplName = Array.isArray(tpl) ? String(tpl?.[0]?.name || tpl?.[0]?.title || "") : String(tpl?.name || tpl?.title || "");
        const tplKey = Array.isArray(tpl) ? String(tpl?.[0]?.key || tpl?.[0]?.slug || tpl?.[0]?.type || "") : String(tpl?.key || tpl?.slug || tpl?.type || "");
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
        supportedCmdsRef.current = null;
        setApiReady(false);
        if (iframeContainerRef.current) iframeContainerRef.current.innerHTML = "";
        setLastErr("");

        setCapacityError(null);
        capacityTriggeredRef.current = false;
        localJoinedRef.current = false;
        localParticipantIdRef.current = null;
        overLimitHitsRef.current = 0;
        kickedIdsRef.current = new Set();
        localIsModeratorRef.current = false;

        setParticipantsNow(0);

        setJitsiKey((x) => x + 1);
    };

    // =========================
    // AUDIO SYSTEM (FIXED)
    // =========================
    const prevStageRef = useRef<number>(-1);
    const firstTickDoneRef = useRef<boolean>(false);
    const welcomeLoopRef = useRef<HTMLAudioElement | null>(null);
    const audioUnlockedRef = useRef<boolean>(false);

    // ✅ cache audio so first play doesn't miss due to load
    const audioCacheRef = useRef<Record<string, HTMLAudioElement>>({});

    const getCachedAudio = (url: string) => {
        const key = String(url || "").trim();
        if (!key) return null;
        let a = audioCacheRef.current[key];
        if (!a) {
            a = new Audio(key);
            a.preload = "auto";
            audioCacheRef.current[key] = a;
        }
        return a;
    };

    const playOneShot = (url: string, volume = 0.9) => {
        if (!url) return;
        try {
            const a = getCachedAudio(url);
            if (!a) return;
            a.volume = volume;
            try {
                a.currentTime = 0;
            } catch { }
            const p = a.play();
            // ignore autoplay rejections (gesture gating)
            (p as any)?.catch?.(() => { });
        } catch { }
    };

    const stopWelcomeLoop = () => {
        try {
            if (welcomeLoopRef.current) {
                welcomeLoopRef.current.pause();
                try {
                    welcomeLoopRef.current.currentTime = 0;
                } catch { }
                // reset loop flag to be safe
                welcomeLoopRef.current.loop = false;
                welcomeLoopRef.current = null;
            }
        } catch { }
    };

    const startWelcomeLoop = () => {
        stopWelcomeLoop();
        try {
            const a = getCachedAudio(WELCOME_LOOP_SOUND) || new Audio(WELCOME_LOOP_SOUND);
            a.loop = true;
            a.volume = 0.6;
            welcomeLoopRef.current = a;
            const p = a.play();
            (p as any)?.catch?.(() => { });
        } catch { }
    };

    // ✅ prime audio on first user gesture (much more reliable than empty Audio())
    useEffect(() => {
        const prime = () => {
            if (audioUnlockedRef.current) return;
            audioUnlockedRef.current = true;

            const urls = Array.from(
                new Set([
                    ...Object.values(STAGE_SOUND_MAP),
                    BREAK_END_SOUND,
                    WELCOME_LOOP_SOUND,
                ])
            );

            for (const u of urls) {
                const a = getCachedAudio(u);
                if (!a) continue;

                try {
                    const oldVol = a.volume;
                    a.volume = 0.0001;
                    try {
                        a.currentTime = 0;
                    } catch { }

                    const p = a.play();
                    (p as any)?.then?.(() => {
                        try {
                            a.pause();
                            a.volume = oldVol;
                            a.currentTime = 0;
                        } catch { }
                    });
                    (p as any)?.catch?.(() => {
                        try {
                            a.volume = oldVol;
                        } catch { }
                    });
                } catch { }
            }

            window.removeEventListener("pointerdown", prime, true);
            window.removeEventListener("keydown", prime, true);
            window.removeEventListener("touchstart", prime, true);
        };

        window.addEventListener("pointerdown", prime, true);
        window.addEventListener("keydown", prime, true);
        window.addEventListener("touchstart", prime, true);

        return () => {
            window.removeEventListener("pointerdown", prime, true);
            window.removeEventListener("keydown", prime, true);
            window.removeEventListener("touchstart", prime, true);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ============================================
    // LOAD SESSION + BUILD STAGES (UUID OR SLUG)
    // ============================================
    useEffect(() => {
        (async () => {
            if (!idOrSlug) return;

            setLoading(true);

            const selectStr = "*, host_profile:profiles!sessions_host_id_fkey(id, full_name, avatar_url, bio), session_templates(*)";

            try {
                const isUuid = UUID_RE.test(idOrSlug);
                const slug = sanitizeSlug(idOrSlug);

                const q = supabase.from("sessions").select(selectStr);

                const { data, error } = isUuid ? await q.eq("id", idOrSlug).single() : await q.eq("custom_slug", slug).single();

                if (data && !error) {
                    setSession(data);

                    setStages([]);
                    setStagebarCycleSeconds(undefined);
                    setStagebarStartTime("");

                    const fallbackStart = String(data?.start_time || data?.created_at || new Date().toISOString());

                    let parsed: any = safeParseJson(data.schedule);

                    // 50/50/50 legacy shorthand -> treat like infinite
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

                    parsed = unwrapScheduleBlocks(parsed);

                    // legacy array schedule
                    if (Array.isArray(parsed)) {
                        const formatted: Stage[] = parsed
                            .map((b: any) => {
                                const rawName = String(b?.name || b?.title || b?.label || b?.text || b?.key || "").trim();

                                const labelLower = rawName.toLowerCase();
                                const rawType = String(b?.type || b?.kind || b?.stageType || "").toLowerCase().trim();

                                const inferTypeFromText = (lower: string): Stage["type"] => {
                                    if (lower.includes("welcome") || lower.includes("intro")) return "intro";

                                    if (lower.includes("checkin") || lower.includes("check-in")) return "checkin";
                                    if (lower.includes("intention")) return "intentions";

                                    if (lower.includes("recap")) return "recap";
                                    if (lower.includes("celebrate") || lower.includes("celebration")) return "celebrate";
                                    if (lower.includes("custom")) return "custom";

                                    if (lower.includes("break") || lower.includes("rest") || lower.includes("pause")) return "break";

                                    // раньше wrap/outro попадало в outro — оставляю как было
                                    if (lower.includes("outro") || lower.includes("wrap") || lower.includes("farewell") || lower.includes("end")) return "outro";

                                    if (lower.includes("focus")) return "focus";
                                    return "focus";
                                };

                                const type: Stage["type"] = rawType && rawType !== "stage" && rawType !== "block" ? inferTypeFromText(rawType) : inferTypeFromText(labelLower);

                                const secondsExplicit =
                                    Number(b?.seconds) || Number(b?.duration_seconds) || Number(b?.durationSeconds) || Number(b?.duration_sec) || 0;

                                const minsLike =
                                    Number(b?.minutes) || Number(b?.mins) || Number(b?.duration_minutes) || Number(b?.durationMinutes) || 0;

                                const n = typeof b === "number" ? b : Number(b?.duration ?? b?.value ?? 0);

                                let durationSeconds = 0;

                                if (secondsExplicit > 0) {
                                    durationSeconds = secondsExplicit;
                                } else if (minsLike > 0) {
                                    durationSeconds = minsLike * 60;
                                } else if (Number.isFinite(n) && n > 0) {
                                    durationSeconds = n <= 180 ? n * 60 : n;
                                }

                                if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;

                                const minutes = Math.max(1, Math.round(durationSeconds / 60));

                                // ✅ FIX #3: preserve custom name if provided
                                const defaultLabel =
                                    type === "focus"
                                        ? "Focus"
                                        : type === "intentions"
                                            ? "Intentions (spoken)"
                                            : type === "checkin"
                                                ? "Check-in"
                                                : type === "break"
                                                    ? "Break"
                                                    : type === "intro"
                                                        ? "Welcome"
                                                        : type === "outro"
                                                            ? "Outro"
                                                            : type === "recap"
                                                                ? "Recap"
                                                                : type === "celebrate"
                                                                    ? "Celebrate"
                                                                    : type === "custom"
                                                                        ? "Custom"
                                                                        : "Stage";

                                const displayName = rawName || defaultLabel;

                                return {
                                    name: displayName,
                                    duration: minutes,
                                    durationSeconds,
                                    color: STAGE_COLORS[type] || "#F63135",
                                    type,
                                } as Stage;
                            })
                            .filter(Boolean) as Stage[];

                        setStages(formatted);
                        setStagebarStartTime(String(data.start_time || fallbackStart));
                        setStagebarCycleSeconds(undefined);
                    }

                    // infinite object schedule
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
                            // ✅ FIX #2: rawName must exist here
                            const rawName = String(p.name || "").trim();
                            const lower = rawName.toLowerCase();
                            const type = phaseToStageType(lower);

                            const defaultLabel =
                                type === "focus"
                                    ? "Focus"
                                    : type === "intentions"
                                        ? "Intentions (spoken)"
                                        : type === "checkin"
                                            ? "Check-in"
                                            : type === "break"
                                                ? "Break"
                                                : type === "intro"
                                                    ? "Welcome"
                                                    : type === "outro"
                                                        ? "Outro"
                                                        : type === "recap"
                                                            ? "Recap"
                                                            : type === "celebrate"
                                                                ? "Celebrate"
                                                                : type === "custom"
                                                                    ? "Custom"
                                                                    : "Stage";

                            // ✅ если в студии задано кастомное имя — оно побеждает
                            const displayName = rawName || defaultLabel;

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
            } catch (e) {
                console.log("Failed to load session:", e);
                setSession(null);
            } finally {
                setLoading(false);
            }
        })();
    }, [idOrSlug]);

    // ============================================
    // RESOLVE USER NAME (no prompt)
    // ============================================
    useEffect(() => {
        (async () => {
            const { data } = await supabase.auth.getUser();
            const u = data.user;

            setCurrentUserId(u?.id || null);

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
    // STAGES TIMER + SOUND (FIXED)
    // ============================================
    useEffect(() => {
        // silent room => no timer/sounds
        if (isSilentRoom) {
            setRemainingTime("");
            setCurrentStage(0);
            firstTickDoneRef.current = false;
            prevStageRef.current = -1;
            stopWelcomeLoop();
            return;
        }

        if (!stagebarStartTime || !stages.length) {
            // reset refs so when stages appear we play start sound correctly
            setRemainingTime("");
            setCurrentStage(0);
            firstTickDoneRef.current = false;
            prevStageRef.current = -1;
            stopWelcomeLoop();
            return;
        }

        // ✅ reset on (re)start so “start check-in sound” works reliably
        firstTickDoneRef.current = false;
        prevStageRef.current = -1;
        stopWelcomeLoop();

        const startMs = new Date(stagebarStartTime).getTime();
        if (Number.isNaN(startMs)) return;

        const stageSeconds = stages.map((s) => {
            const sec = Number(s.durationSeconds || 0);
            if (sec > 0) return sec;
            const mins = Number(s.duration) || 0;
            return mins > 0 ? mins * 60 : 0;
        });

        const sumStageSeconds = stageSeconds.reduce((acc, v) => acc + v, 0);
        const loopSeconds = (Number(stagebarCycleSeconds) || 0) > 0 ? Number(stagebarCycleSeconds) : Math.max(1, sumStageSeconds);

        const tick = () => {
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

            const stage = stages[active];
            const newType = String(stage?.type || "").toLowerCase();

            // ✅ First tick: play start sound for current stage (e.g. check-in), and/or start welcome loop
            if (!firstTickDoneRef.current) {
                if (newType === "intro") {
                    startWelcomeLoop();
                } else {
                    stopWelcomeLoop();
                    const startSound = STAGE_SOUND_MAP[newType];
                    if (startSound) playOneShot(startSound);
                }

                prevStageRef.current = active;
                firstTickDoneRef.current = true;
                return;
            }

            // Stage change: play end-of-break + new-stage sound
            if (prevStageRef.current !== active) {
                const prev = stages[prevStageRef.current];
                const prevType = String(prev?.type || "").toLowerCase();

                if (prevType === "break" && newType !== "break") {
                    playOneShot(BREAK_END_SOUND);
                }

                if (newType === "intro") {
                    startWelcomeLoop();
                } else {
                    stopWelcomeLoop();
                    const sound = STAGE_SOUND_MAP[newType];
                    if (sound) playOneShot(sound);
                }

                prevStageRef.current = active;
            }

            // safety: stop loop if we are not in intro anymore
            if (newType !== "intro" && welcomeLoopRef.current) stopWelcomeLoop();
        };

        // ✅ run immediately (don’t wait 1s)
        tick();
        const timer = window.setInterval(tick, 1000);

        return () => window.clearInterval(timer);
    }, [stagebarStartTime, stages, isSilentRoom, isInfiniteRoom, stagebarCycleSeconds]);

    // ============================================
    // JITSI INIT + capacity enforcement (fixed)
    // ============================================
    useEffect(() => {
        if (!session || !idOrSlug) return;
        if (!iframeContainerRef.current) return;
        if (!userName) return;

        let destroyed = false;

        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

        let participantsPollTimer: number | null = null;

        const cleanup = () => {
            stopWelcomeLoop();
            setApiReady(false);
            try {
                apiRef.current?.dispose?.();
            } catch { }
            apiRef.current = null;
            supportedCmdsRef.current = null;

            capacityTriggeredRef.current = false;
            localJoinedRef.current = false;
            localParticipantIdRef.current = null;
            overLimitHitsRef.current = 0;
            kickedIdsRef.current = new Set();
            localIsModeratorRef.current = false;

            setParticipantsNow(0);

            if (participantsPollTimer) {
                window.clearInterval(participantsPollTimer);
                participantsPollTimer = null;
            }
        };

        const leaveToSessions = () => {
            if (destroyed) return;
            destroyed = true;
            cleanup();
            navigate("/sessions", { replace: true });
        };

        const canUseKickCommand = () => {
            const cmds = supportedCmdsRef.current;
            if (!Array.isArray(cmds)) return true; // unknown -> try
            return cmds.includes("kickParticipant");
        };

        const getParticipantCount = async (api: any): Promise<number | null> => {
            // 1) Preferred: getNumberOfParticipants (sync)
            try {
                const n = api?.getNumberOfParticipants?.();
                if (Number.isFinite(n) && Number(n) > 0) return Number(n);
            } catch { }

            // 2) getRoomsInfo (promise)
            try {
                const res = await api?.getRoomsInfo?.();
                const rooms = Array.isArray(res) ? res : res?.rooms;
                const main = Array.isArray(rooms) ? rooms.find((r) => r?.isMainRoom) || rooms[0] : null;
                const arr = main?.participants;
                if (Array.isArray(arr)) {
                    // Try infer local presence via getParticipantsInfo
                    try {
                        const info = api?.getParticipantsInfo?.();
                        if (Array.isArray(info)) {
                            const localId = localParticipantIdRef.current;
                            const hasLocal =
                                !!localId && info.some((p: any) => String(p?.participantId || p?.id || "") === String(localId));
                            if (hasLocal) return Math.max(1, info.length);
                            return Math.max(1, info.length + 1);
                        }
                    } catch { }

                    // Fallback heuristic: assume roomsInfo excludes local => +1
                    return Math.max(1, arr.length + 1);
                }
            } catch { }

            // 3) Deprecated fallback: getParticipantsInfo
            try {
                const info = api?.getParticipantsInfo?.();
                if (Array.isArray(info)) {
                    const localId = localParticipantIdRef.current;
                    const hasLocal =
                        !!localId && info.some((p: any) => String(p?.participantId || p?.id || "") === String(localId));
                    return hasLocal ? Math.max(1, info.length) : Math.max(1, info.length + 1);
                }
            } catch { }

            return null;
        };

        const refreshParticipants = async (api: any) => {
            if (destroyed) return;
            const n = await getParticipantCount(api);
            if (n != null && Number.isFinite(n)) setParticipantsNow(n);
        };

        const selfLeaveIfOverCapacity = async (api: any, why: string) => {
            if (destroyed) return;
            if (capacityTriggeredRef.current) return;

            const count = await getParticipantCount(api);
            if (count == null) return;

            if (count > maxParticipants) {
                overLimitHitsRef.current += 1;
            } else {
                overLimitHitsRef.current = 0;
                return;
            }

            // Require 2 consecutive confirmations to reduce false positives
            if (overLimitHitsRef.current < 2) return;

            capacityTriggeredRef.current = true;
            setCapacityError(`Room is full (max ${maxParticipants}).`);
            console.log("[capacity][self-leave] over limit:", { why, count, maxParticipants });

            window.setTimeout(() => {
                try {
                    api?.executeCommand?.("hangup");
                } catch {
                    navigate("/sessions", { replace: true });
                }
            }, 600);
        };

        const scheduleSelfChecks = async (api: any, why: string) => {
            const delays = [250, 700, 1400, 2200];
            for (const d of delays) {
                if (destroyed || capacityTriggeredRef.current) return;
                await sleep(d);
                await selfLeaveIfOverCapacity(api, `${why}@${d}ms`);
            }
        };

        const hostKickIfOverCapacity = async (api: any, joinedId: string, why: string) => {
            if (destroyed) return;
            if (!isHost) return;
            if (!joinedId) return;

            if (localParticipantIdRef.current && joinedId === localParticipantIdRef.current) return;
            if (kickedIdsRef.current.has(joinedId)) return;
            if (!canUseKickCommand()) return;

            await sleep(250);

            const count = await getParticipantCount(api);
            if (count == null) return;

            if (count > maxParticipants) {
                kickedIdsRef.current.add(joinedId);

                console.log("[capacity][host-kick] over limit:", { why, count, maxParticipants, joinedId });

                try {
                    api?.executeCommand?.("kickParticipant", joinedId);
                } catch (e) {
                    console.log("[capacity][host-kick] failed:", e);
                }
            }
        };

        (async () => {
            try {
                const domainList = domainsForSession(session);

                const { api, domain } = await createJitsiApiWithFallback({
                    domains: domainList,
                    roomName,
                    parentNode: iframeContainerRef.current!,
                    userName,
                    cssPathOnJitsiDomain: JITSI_CUSTOM_CSS_PATH,
                    onDomainChosen: (d) => console.log("[JITSI] Using domain:", d),
                });

                if (destroyed) {
                    try {
                        api?.dispose?.();
                    } catch { }
                    return;
                }

                apiRef.current = api;
                setApiReady(false);
                setCapacityError(null);
                setParticipantsNow(0);

                capacityTriggeredRef.current = false;
                localJoinedRef.current = false;
                localParticipantIdRef.current = null;
                overLimitHitsRef.current = 0;
                kickedIdsRef.current = new Set();
                localIsModeratorRef.current = false;

                // ✅ persist chosen domain to DB (do NOT block join)
                try {
                    const prev = String(session?.jitsi_domain || "").trim();
                    if (session?.id && domain && prev !== domain) {
                        supabase.from("sessions").update({ jitsi_domain: domain }).eq("id", session.id);
                    }
                } catch { }

                // Supported commands (best-effort)
                try {
                    const cmds =
                        api.getSupportedCommands?.() || api.getAvailableCommands?.() || api._getSupportedCommands?.() || null;

                    const arr = Array.isArray(cmds) ? cmds : null;
                    supportedCmdsRef.current = arr;

                    console.log("[JITSI] supported commands:", arr);
                } catch (e) {
                    console.log("[JITSI] cannot read supported commands", e);
                    supportedCmdsRef.current = null;
                }

                // initial commands
                try {
                    api.executeCommand("setTileView", true);
                    setTile(true);
                } catch { }
                try {
                    api.executeCommand("subject", "");
                } catch { }

                console.log("[JITSI] Domain chosen:", domain);

                // ✅ lightweight poll to keep participants accurate (desktop UX)
                participantsPollTimer = window.setInterval(() => {
                    if (destroyed) return;
                    void refreshParticipants(api);
                }, 5000);

                // --------------------------
                // Events
                // --------------------------
                api.addEventListener?.("videoConferenceJoined", async (e: any) => {
                    if (destroyed) return;

                    setApiReady(true);
                    localJoinedRef.current = true;
                    localParticipantIdRef.current = String(e?.id || "") || null;

                    try {
                        api.executeCommand("setTileView", true);
                        setTile(true);
                    } catch { }

                    try {
                        api.executeCommand("subject", "");
                    } catch { }

                    // refresh participants
                    window.setTimeout(() => void refreshParticipants(api), 250);

                    await scheduleSelfChecks(api, "videoConferenceJoined");
                });

                api.addEventListener?.("videoConferenceLeft", () => {
                    if (destroyed) return;
                    setApiReady(false);
                    leaveToSessions();
                });

                api.addEventListener?.("participantRoleChanged", (e: any) => {
                    try {
                        const pid = String(e?.id || "");
                        const role = String(e?.role || "").toLowerCase();
                        if (pid && localParticipantIdRef.current && pid === localParticipantIdRef.current) {
                            localIsModeratorRef.current = role === "moderator";
                        }
                    } catch { }
                });

                api.addEventListener?.("participantJoined", (e: any) => {
                    if (destroyed) return;

                    const joinedId = String(e?.id || "");

                    // update UI count (after Jitsi settles)
                    window.setTimeout(() => void refreshParticipants(api), 350);

                    if (isHost && joinedId) {
                        hostKickIfOverCapacity(api, joinedId, "participantJoined");
                    }
                });

                api.addEventListener?.("participantLeft", () => {
                    if (destroyed) return;
                    window.setTimeout(() => void refreshParticipants(api), 350);
                });

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
    }, [session, idOrSlug, userName, roomName, navigate, jitsiKey, maxParticipants, isHost]);

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

    const switchTrack = "w-[84px] h-[32px] rounded-full border relative transition flex items-center px-[3px]";
    const switchTrackCls = isLight ? "bg-black/5 border-black/10 hover:bg-black/10" : "bg-white/5 border-white/10 hover:bg-white/10";
    const switchThumb =
        "absolute top-[2px] w-[26px] h-[26px] rounded-full shadow-md transition-transform bg-white flex items-center justify-center";
    const thumbTranslate = isLight ? "translateX(0px)" : "translateX(50px)";

    const participantsLabel = `${Math.max(0, participantsNow)}/${maxParticipants} participants`;

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

    const sessionId = String(session?.id || "");

    return (
        <div className={`min-h-screen ${pageBg}`}>
            <div className="w-full px-3 sm:px-5 pt-5 pb-[calc(110px+env(safe-area-inset-bottom))] flex flex-col gap-5 min-h-screen">
                {/* TOP BAR */}
                <div className={`flex w-full rounded-2xl overflow-hidden ${topBarBg}`}>
                    <div className="flex-1 min-w-0 px-4 sm:px-6 py-4">
                        {/* ✅ DESKTOP (sm+): like your screenshot */}
                        <div className="hidden sm:flex items-start justify-between gap-4">
                            {/* LEFT: title + participants under title */}
                            <div className="min-w-0">
                                <p className={`font-inter font-semibold text-[18px] truncate ${strongText}`}>{session.title}</p>
                                <div className={`mt-1 font-inter text-[13px] ${subtleText}`}>
                                    {participantsLabel}
                                    {isSilentRoom ? <span className="ml-2">• Silent room</span> : null}
                                </div>
                            </div>

                            {/* RIGHT: timer + theme + reload + host */}
                            <div className="flex items-center gap-2 shrink-0">
                                {!isSilentRoom && stages.length > 0 && !!stagebarStartTime && (
                                    <div className={`h-[32px] flex items-center gap-2 px-3 rounded-xl ${chipBg}`}>
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
                                    className={
                                        `h-[32px] w-[32px] rounded-xl border transition inline-flex items-center justify-center ` +
                                        (isLight
                                            ? "border-black/10 bg-black/5 hover:bg-black/10 text-black/70"
                                            : "border-white/10 bg-[#0B1220]/60 hover:bg-[#0B1220]/80 text-white/80")
                                    }
                                    title="Reload video engine"
                                    aria-label="Reload video engine"
                                >
                                    <ReloadSmartIcon theme={theme} className="w-4 h-4" />
                                </button>

                                {/* Host */}
                                {session.host_profile && (
                                    <button
                                        onClick={() => setSelectedUser(session.host_profile)}
                                        className={`flex items-center gap-2 px-3 h-[32px] rounded-xl border transition font-inter text-[13px] ${isLight
                                                ? "border-black/10 bg-black/5 hover:bg-black/10 text-black/75"
                                                : "border-white/10 bg-[#0B1220]/60 hover:bg-[#0B1220]/80 text-[#F3F4F6]/85"
                                            }`}
                                    >
                                        <span className="flex items-center gap-2 leading-none">
                                            <span className={isLight ? "text-black/60" : "text-white/70"}>
                                                <ParticipantsSmartIcon theme={theme} className="w-4 h-4" />
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <span className={isLight ? "font-normal text-black/55" : "font-normal text-white/70"}>Host:</span>
                                                <span className="font-semibold">{session.host_profile.full_name}</span>
                                            </span>
                                        </span>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* ✅ MOBILE (<sm): keep the “acceptable” layout */}
                        <div className="sm:hidden">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className={`font-inter font-semibold text-[18px] truncate ${strongText}`}>{session.title}</p>
                                    {isSilentRoom && <div className={`mt-1 font-inter text-[13px] ${subtleText}`}>Silent room</div>}
                                </div>

                                <div
                                    className={`inline-flex items-center gap-2 h-[32px] px-3 rounded-xl ${chipBg}`}
                                    title="Participants"
                                    aria-label={`Participants ${participantsLabel}`}
                                >
                                    <span className={isLight ? "text-black/70" : "text-white/80"}>
                                        <ParticipantsSmartIcon theme={theme} className="w-4 h-4" />
                                    </span>
                                    <span className={`font-inter text-[13px] ${isLight ? "text-black/75" : "text-white/90"}`}>
                                        {Math.max(0, participantsNow)}/{maxParticipants}
                                    </span>
                                </div>
                            </div>

                            <div className="mt-3 flex items-center gap-2 justify-start flex-wrap">
                                {!isSilentRoom && stages.length > 0 && !!stagebarStartTime && (
                                    <div className={`h-[32px] flex items-center gap-2 px-3 rounded-xl ${chipBg}`}>
                                        <Icon name="timer" theme={theme} className="w-4 h-4 opacity-80" alt="Timer" />
                                        <span className={`font-inter text-[13px] ${isLight ? "text-black/75" : "text-white/90"}`}>
                                            {remainingTime || "--:--"}
                                        </span>
                                    </div>
                                )}

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

                                <button
                                    onClick={forceReloadJitsi}
                                    className={
                                        `h-[32px] w-[32px] rounded-xl border transition inline-flex items-center justify-center ` +
                                        (isLight
                                            ? "border-black/10 bg-black/5 hover:bg-black/10 text-black/70"
                                            : "border-white/10 bg-[#0B1220]/60 hover:bg-[#0B1220]/80 text-white/80")
                                    }
                                    title="Reload video engine"
                                    aria-label="Reload video engine"
                                >
                                    <ReloadSmartIcon theme={theme} className="w-4 h-4" />
                                </button>

                                {session.host_profile && (
                                    <button
                                        onClick={() => setSelectedUser(session.host_profile)}
                                        className={`max-[520px]:hidden flex items-center gap-2 px-3 h-[32px] rounded-xl border transition font-inter text-[13px] ${isLight
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
                            <div className="mt-3 w-full max-w-full min-w-0 overflow-hidden">
                                <div className="w-full max-w-full min-w-0 overflow-hidden">
                                    <SessionStageBar
                                        stages={stages as any}
                                        startTime={stagebarStartTime}
                                        cycleSeconds={stagebarCycleSeconds}
                                        onHoverStage={setHoveredStage as any}
                                    />
                                </div>
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
                    <div
                        className={`rounded-2xl overflow-hidden min-h-0 relative ${isLight ? "bg-white/70 border border-black/10" : "bg-[#0B1220]/45 border border-white/5"
                            }`}
                    >
                        <div ref={iframeContainerRef} className="w-full h-full min-h-[60vh]" />

                        {capacityError && (
                            <div className="absolute inset-0 z-40 flex items-center justify-center p-6 bg-black/55">
                                <div className="max-w-md w-full bg-white rounded-2xl p-5 shadow-2xl">
                                    <div className="font-inter font-semibold text-[16px] text-brandBlack">Room is full</div>
                                    <div className="mt-1 font-inter text-[13px] text-gray-600">{capacityError} You’ll be redirected.</div>
                                    <div className="mt-4 flex gap-2 justify-end">
                                        <button
                                            onClick={() => navigate("/sessions")}
                                            className="px-4 py-2 rounded-xl bg-black text-white font-inter text-[13px] hover:bg-black/90"
                                        >
                                            Back to sessions
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

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

                                    <div className="p-4 h-[calc(100%-64px)]">{sessionId ? <ChatPanel sessionId={sessionId} theme={theme} /> : null}</div>
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
                                        <IntentionsPanel theme={theme} />
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
