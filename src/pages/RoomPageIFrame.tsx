// src/pages/RoomPageIFrame.tsx
// ROOMPAGE (IFRAME) + JITSI EXTERNAL API + OUR UI CONTROLS
//
// ✅ Goal now:
// - Hide ALL native Jitsi UI inside iframe (CSS from SAME Jitsi domain)
// - Use our own controls only
// - Tile view ON by default
// - ✅ Enforce participant limit from sessions.max_participants (default 16)
// - ✅ Allow opening by UUID OR by sessions.custom_slug (no uuid cast error)
// - ✅ Require login to enter room (redirect to /login on unauth)
//
// ✅ NEW (ported features from RoomPage):
// - Participants right panel (search + list)
// - Emoji reactions with micro-label (sender name), delivered via Supabase realtime broadcast
// - Bottom controls rearranged: Participants (left), media (center), Chat+Intentions+Leave (right)
//
// ✅ FIX (attendance):
// - Always write left_at on Leave button
// - Best-effort write left_at on tab close / reload / pagehide with keepalive fetch + user JWT
// - Online count derived from session_attendance (last_seen window), usable for SessionCard

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
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

type RoomTheme = "dark" | "light";
type RightPanelTab = "participants" | "chat" | "intentions" | null;

type ReactionType = "fire" | "laugh" | "clap" | "heart" | "thumbsUp" | "thumbsDown";
const reactionEmoji: Record<ReactionType, string> = {
    fire: "🔥",
    laugh: "😂",
    clap: "👏",
    heart: "❤️",
    thumbsUp: "👍",
    thumbsDown: "👎",
};

type FloatingReaction = {
    id: number;
    type: ReactionType;
    fromUserId: string;
    fromName: string;
};

type ParticipantRow = {
    id: string;
    displayName: string;
    isLocal: boolean;
    audioMuted?: boolean;
    videoMuted?: boolean;
};

type OnlineUser = {
    user_id: string;
    full_name: string;
    avatar_url?: string | null;
    last_seen_at?: string | null;
};

declare global {
    interface Window {
        JitsiMeetExternalAPI?: any;
    }
}

// ===============================
// helpers: uuid / slug
// ===============================
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sanitizeSlug(input: string) {
    const raw = String(input || "").trim().toLowerCase();
    const spaced = raw.replace(/\s+/g, "-");
    const clean = spaced.replace(/[^a-z0-9-_]/g, "");
    return clean;
}

// ===============================
// JITSI DOMAINS (PRIMARY + FALLBACK) + ✅ TEST OVERRIDE
// ===============================
const DEFAULT_JITSI_DOMAIN = "jitsi.mysession.club";

const ALL_JITSI_DOMAINS = [
    DEFAULT_JITSI_DOMAIN,
    "meet-eu.mysession.club",
    "meet-us-east.mysession.club",
    "meet-apac.mysession.club",
] as const;

const FORCE_JITSI_DOMAIN = String((import.meta as any).env.VITE_FORCE_JITSI_DOMAIN || "").trim();
const FORCE_JITSI_ONLY = (import.meta as any).env.VITE_FORCE_JITSI_ONLY === "true";

type JitsiDomain = (typeof ALL_JITSI_DOMAINS)[number] | string;

function domainsForSession(session: any): readonly string[] {
    if (FORCE_JITSI_DOMAIN) {
        const uniq = (d: string, i: number, arr: string[]) => arr.indexOf(d) === i;
        if (FORCE_JITSI_ONLY) return [FORCE_JITSI_DOMAIN];
        return [FORCE_JITSI_DOMAIN, ...ALL_JITSI_DOMAINS].filter(uniq);
    }

    const preferred = String(session?.jitsi_domain || "").trim();
    if (preferred) return [preferred, ...ALL_JITSI_DOMAINS.filter((d) => d !== preferred)];
    return ALL_JITSI_DOMAINS;
}

const TOOLBAR_MOUNT_BUTTONS = ["settings"];
const TOOLBAR_VISIBLE_BUTTONS: string[] = [];
const JITSI_CUSTOM_CSS_PATH = "/jitsi-custom.css";

const CHAT_MSG_TABLE = "session_chat_messages";

// ====== AUDIO ======
const STAGE_SOUND_MAP: Record<string, string> = {
    intentions: "/sounds/intentions.mp3",
    checkin: "/sounds/intentions.mp3",
    focus: "/sounds/focus.mp3",
    break: "/sounds/break_start.mp3",
    outro: "/sounds/outro.mp3",
    celebrate: "/sounds/outro.mp3",
};
const BREAK_END_SOUND = "/sounds/break_end.mp3";
const WELCOME_LOOP_SOUND = "/sounds/welcome_loop.mp3";

// ====== participants limit ======
const DEFAULT_MAX_PARTICIPANTS = 16;
const MIN_PARTICIPANTS = 3;
const MAX_PARTICIPANTS = 64;

// ====== attendance ======
// online = left_at is null AND last_seen_at is within this window
const ATT_HEARTBEAT_MS = 10_000;
const ONLINE_WINDOW_MS = 35_000;

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

// ✅ Session Studio / builder wrappers
function unwrapScheduleBlocks(parsed: any): any {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;

    const candidates: any[] = [
        parsed?.blocks,
        parsed?.script,
        parsed?.agenda,
        parsed?.items,
        parsed?.stages,
        parsed?.data?.blocks,
        parsed?.data?.script,
        parsed?.data?.agenda,
        parsed?.data?.items,
        parsed?.data?.stages,
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
            Number(raw?.minutes) || Number(raw?.mins) || Number(raw?.duration_minutes) || Number(raw?.durationMinutes);
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
    if (phaseNameLower.includes("custom")) return "custom";
    if (phaseNameLower.includes("recap")) return "recap";
    if (phaseNameLower.includes("celebrate") || phaseNameLower.includes("celebration")) return "celebrate";
    if (phaseNameLower.includes("focus")) return "focus";
    if (phaseNameLower.includes("checkin") || phaseNameLower.includes("check-in")) return "checkin";
    if (phaseNameLower.includes("intention")) return "intentions";
    if (phaseNameLower.includes("break") || phaseNameLower.includes("rest")) return "break";
    return "focus";
}

const CUSTOM_BLOCK_GRADIENT = "linear-gradient(90deg, #5286F6 0%, #65D46C 40%, #F65252 80%, #F65252 100%)";
const STAGE_COLORS: Record<string, string> = {
    intro: "#80DF86",
    intentions: "#ADD3FF",
    checkin: "#ADD3FF",
    focus: "#4CA0FF",
    recap: "#A78BFA",
    celebrate: "#80DF86",
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
    cssPathOnJitsiDomain?: string;
    onDomainChosen?: (d: string) => void;
}) {
    let lastError: any = null;

    for (const domain of args.domains) {
        try {
            await loadJitsiExternalApi(domain);

            args.parentNode.innerHTML = "";

            const cssPath = String(args.cssPathOnJitsiDomain || "").trim() || JITSI_CUSTOM_CSS_PATH;
            const cssUrl = `https://${domain}${cssPath}?v=${Date.now()}`;

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

                    startWithAudioMuted: true,
                    startWithVideoMuted: false,

                    startWithTileView: true,

                    filmStripOnly: false,
                    disableFilmstrip: true,

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
    | "tile-view"
    | "reaction"
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

function ParticipantsSmartIcon({ theme, className = "w-4 h-4" }: { theme: RoomTheme; className?: string }) {
    const candidates = [`/icons/participants-${theme}.svg`, `/icons/participants.svg`, `/icons/users-${theme}.svg`, `/icons/users.svg`];
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

function useMediaQuery(query: string) {
    const [matches, setMatches] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return;
        const mql = window.matchMedia(query);
        const onChange = () => setMatches(!!mql.matches);
        onChange();

        try {
            mql.addEventListener("change", onChange);
            return () => mql.removeEventListener("change", onChange);
        } catch {
            mql.addListener(onChange);
            return () => mql.removeListener(onChange);
        }
    }, [query]);

    return matches;
}

export default function RoomPageIFrame() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const location = useLocation();

    const idOrSlug = String(id || "").trim();

    const iframeContainerRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<any>(null);
    const supportedCmdsRef = useRef<string[] | null>(null);

    const [session, setSession] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const sessionId = useMemo(() => String(session?.id || ""), [session?.id]);

    // ✅ auth gate
    const [authStatus, setAuthStatus] = useState<"checking" | "authed" | "redirecting">("checking");
    const [userName, setUserName] = useState<string>("");
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);

    // keep user JWT for keepalive leave write
    const accessTokenRef = useRef<string>("");

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

    const isLgUp = useMediaQuery("(min-width: 1024px)");

    const [stages, setStages] = useState<Stage[]>([]);
    const [hoveredStage, setHoveredStage] = useState<Stage | null>(null);
    const [currentStage, setCurrentStage] = useState(0);
    const [remainingTime, setRemainingTime] = useState<string>("");

    const [stagebarStartTime, setStagebarStartTime] = useState<string>("");
    const [stagebarCycleSeconds, setStagebarCycleSeconds] = useState<number | undefined>(undefined);

    const [selectedUser, setSelectedUser] = useState<any>(null);
    const [lastErr, setLastErr] = useState<string>("");

    // capacity enforcement UI
    const [capacityError, setCapacityError] = useState<string | null>(null);
    const capacityTriggeredRef = useRef(false);
    const localJoinedRef = useRef(false);
    const localParticipantIdRef = useRef<string | null>(null);
    const kickedIdsRef = useRef<Set<string>>(new Set());
    const localIsModeratorRef = useRef<boolean>(false);

    // iframe state
    const [tile, setTile] = useState(true);
    const [mutedAudio, setMutedAudio] = useState(false);
    const [mutedVideo, setMutedVideo] = useState(false);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [apiReady, setApiReady] = useState(false);

    // ✅ live participant count for UI (from session_attendance primarily)
    const [participantsNow, setParticipantsNow] = useState<number>(0);

    // ✅ online users (from session_attendance + profiles) — THIS is what SessionCard wants too
    const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);

    // ✅ participants list (right panel) from Jitsi API
    const [participantRows, setParticipantRows] = useState<ParticipantRow[]>([]);
    const [participantsSearch, setParticipantsSearch] = useState("");

    // right panel
    const [rightPanelOpen, setRightPanelOpen] = useState<boolean>(false);
    const [rightTab, setRightTab] = useState<RightPanelTab>(null);

    // MOBILE ⋯ MENU (<=480)
    const [showMoreMenu, setShowMoreMenu] = useState(false);
    const moreMenuRef = useRef<HTMLDivElement | null>(null);

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

    // close reactions menu when panel is used
    const [showReactionsMenu, setShowReactionsMenu] = useState(false);
    useEffect(() => {
        if (rightPanelOpen) setShowReactionsMenu(false);
    }, [rightPanelOpen, rightTab]);

    useEffect(() => {
        if (rightPanelOpen) setShowMoreMenu(false);
    }, [rightPanelOpen, rightTab]);

    // Close ⋯ menu by click outside
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

    // Escape closes panels/popovers
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setShowReactionsMenu(false);
                setShowMoreMenu(false);
                setRightPanelOpen(false);
                setRightTab(null);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // =========================
    // ✅ CHAT UNREAD BADGE (always-on)
    // =========================
    const [unreadChat, setUnreadChat] = useState<number>(0);
    const chatVisibleRef = useRef<boolean>(false);
    const lastChatReadAtRef = useRef<number>(0);

    useEffect(() => {
        chatVisibleRef.current = rightPanelOpen && rightTab === "chat";
    }, [rightPanelOpen, rightTab]);

    const chatReadKey = useMemo(() => {
        return sessionId ? `mysession_chat_last_read_at:${sessionId}` : "";
    }, [sessionId]);

    const markChatRead = (atMs?: number) => {
        if (!sessionId) return;

        const now = Number.isFinite(atMs as any) ? Number(atMs) : Date.now();
        lastChatReadAtRef.current = Math.max(lastChatReadAtRef.current || 0, now);

        setUnreadChat(0);

        try {
            if (chatReadKey) localStorage.setItem(chatReadKey, String(lastChatReadAtRef.current));
        } catch { }
    };

    useEffect(() => {
        if (rightPanelOpen && rightTab === "chat") {
            markChatRead();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rightPanelOpen, rightTab, sessionId]);

    useEffect(() => {
        if (authStatus !== "authed") return;
        if (!sessionId) return;
        if (!currentUserId) return;

        let cancelled = false;

        (async () => {
            let lastRead = 0;
            try {
                const raw = localStorage.getItem(chatReadKey);
                lastRead = raw ? Number(raw) : 0;
                if (!Number.isFinite(lastRead)) lastRead = 0;
            } catch {
                lastRead = 0;
            }
            lastChatReadAtRef.current = lastRead;

            try {
                const sinceIso = lastRead > 0 ? new Date(lastRead).toISOString() : "1970-01-01T00:00:00.000Z";

                const { count } = await supabase
                    .from(CHAT_MSG_TABLE)
                    .select("id", { count: "exact", head: true })
                    .eq("session_id", sessionId)
                    .neq("user_id", currentUserId)
                    .gt("created_at", sinceIso);

                if (!cancelled) setUnreadChat(Math.min(99, Math.max(0, Number(count || 0))));
            } catch {
                if (!cancelled) setUnreadChat(0);
            }
        })();

        const ch = supabase
            .channel(`chat-unread:${sessionId}`)
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: CHAT_MSG_TABLE, filter: `session_id=eq.${sessionId}` },
                (payload: any) => {
                    const row = payload?.new;
                    if (!row) return;

                    const senderId = String(row.user_id || "");
                    if (!senderId) return;

                    if (senderId === currentUserId) return;

                    const ts = new Date(row.created_at).getTime();
                    const msgMs = Number.isFinite(ts) ? ts : Date.now();

                    if (chatVisibleRef.current) {
                        markChatRead(msgMs);
                        return;
                    }

                    if (msgMs > (lastChatReadAtRef.current || 0)) {
                        setUnreadChat((prev) => Math.min(99, prev + 1));
                    }
                }
            )
            .subscribe();

        return () => {
            cancelled = true;
            supabase.removeChannel(ch);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authStatus, sessionId, currentUserId, chatReadKey]);

    const isHost = useMemo(() => {
        const sid = String(session?.host_id || "");
        return !!currentUserId && !!sid && currentUserId === sid;
    }, [currentUserId, session?.host_id]);

    // ✅ max participants
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

        const kind = String(parsed?.kind || "").toLowerCase();
        if (kind === "infinite_room") return true;
        if (kind.includes("infinite")) return true;

        if (parsed?.timer?.phases) return true;
        if (parsed?.timer?.segments) return true;
        if (parsed?.phases) return true;
        if (parsed?.segments) return true;

        return false;
    }, [session]);

    const isSilentRoom = useMemo(() => {
        const fmt = String(session?.format || "").toLowerCase();
        const title = String(session?.title || "").toLowerCase();

        const tpl = session?.session_templates;
        const tplName = Array.isArray(tpl) ? String(tpl?.[0]?.name || tpl?.[0]?.title || "") : String(tpl?.name || tpl?.title || "");
        const tplKey = Array.isArray(tpl)
            ? String(tpl?.[0]?.key || tpl?.[0]?.slug || tpl?.[0]?.type || "")
            : String(tpl?.key || tpl?.slug || tpl?.type || "");
        const tplFmt = Array.isArray(tpl) ? String(tpl?.[0]?.format || "") : String(tpl?.format || "");

        const hay = `${fmt} ${title} ${tplName} ${tplKey} ${tplFmt}`.toLowerCase();
        return hay.includes("silent");
    }, [session]);

    // ============================================
    // AUTH GATE (NO GUESTS) + grab access token
    // ============================================
    useEffect(() => {
        (async () => {
            setAuthStatus("checking");

            try {
                const { data: ud } = await supabase.auth.getUser();
                const u = ud.user;

                if (!u) {
                    setCurrentUserId(null);
                    setUserName("");
                    accessTokenRef.current = "";
                    setAuthStatus("redirecting");

                    const redirect = encodeURIComponent(location.pathname + location.search);
                    navigate(`/login?redirect=${redirect}`, { replace: true });
                    return;
                }

                setCurrentUserId(u.id);

                // session token (for keepalive leave write)
                try {
                    const { data: sd } = await supabase.auth.getSession();
                    accessTokenRef.current = String(sd.session?.access_token || "");
                } catch {
                    accessTokenRef.current = "";
                }

                let name =
                    (u?.user_metadata?.full_name as string) ||
                    (u?.user_metadata?.name as string) ||
                    (u?.email ? u.email.split("@")[0] : "");

                if (!name && u?.id) {
                    const { data: p } = await supabase.from("profiles").select("full_name").eq("id", u.id).single();
                    name = p?.full_name || "";
                }

                setUserName(name || "User");
                setAuthStatus("authed");
            } catch {
                setCurrentUserId(null);
                setUserName("");
                accessTokenRef.current = "";
                setAuthStatus("redirecting");
                const redirect = encodeURIComponent(location.pathname + location.search);
                navigate(`/login?redirect=${redirect}`, { replace: true });
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigate, location.pathname, location.search]);

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
                                    if (lower.includes("outro") || lower.includes("wrap") || lower.includes("farewell") || lower.includes("end")) return "outro";
                                    if (lower.includes("focus")) return "focus";
                                    return "focus";
                                };

                                const type: Stage["type"] =
                                    rawType && rawType !== "stage" && rawType !== "block" ? inferTypeFromText(rawType) : inferTypeFromText(labelLower);

                                const secondsExplicit =
                                    Number(b?.seconds) || Number(b?.duration_seconds) || Number(b?.durationSeconds) || Number(b?.duration_sec) || 0;

                                const minsLike = Number(b?.minutes) || Number(b?.mins) || Number(b?.duration_minutes) || Number(b?.durationMinutes) || 0;

                                const n = typeof b === "number" ? b : Number(b?.duration ?? b?.value ?? 0);

                                let durationSeconds = 0;

                                if (secondsExplicit > 0) durationSeconds = secondsExplicit;
                                else if (minsLike > 0) durationSeconds = minsLike * 60;
                                else if (Number.isFinite(n) && n > 0) durationSeconds = n <= 180 ? n * 60 : n;

                                if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;

                                const minutes = Math.max(1, Math.round(durationSeconds / 60));

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

                    const isInfiniteScheduleObject =
                        parsed &&
                        typeof parsed === "object" &&
                        !Array.isArray(parsed) &&
                        (String(parsed?.kind || "").toLowerCase().includes("infinite") ||
                            parsed?.timer?.phases ||
                            parsed?.timer?.segments ||
                            parsed?.phases ||
                            parsed?.segments);

                    if (isInfiniteScheduleObject) {
                        const phasesRaw = parsed?.timer?.phases || parsed?.timer?.segments || parsed?.phases || parsed?.segments || null;

                        const phases = normalizeInfinitePhases(phasesRaw);

                        const formatted: Stage[] = phases.map((p) => {
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

                        const anchor = String(parsed?.anchor_ts || parsed?.anchorTs || data?.start_time || fallbackStart);
                        setStagebarStartTime(anchor);

                        const sumSeconds = phases.reduce((acc, p) => acc + (Number(p.seconds) || 0), 0);

                        let cycleSeconds =
                            Number(parsed?.timer?.cycle_seconds) ||
                            Number(parsed?.timer?.cycleSeconds) ||
                            Number(parsed?.cycle_seconds) ||
                            Number(parsed?.cycleSeconds) ||
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
    // STAGES TIMER + SOUND
    // ============================================
    const prevStageRef = useRef<number>(-1);
    const firstTickDoneRef = useRef<boolean>(false);
    const welcomeLoopRef = useRef<HTMLAudioElement | null>(null);
    const audioUnlockedRef = useRef<boolean>(false);

    const tryUnlockAudio = async () => {
        try {
            const AnyWindow = window as any;
            const AudioCtx = window.AudioContext || AnyWindow.webkitAudioContext;
            if (AudioCtx) {
                const ctx = new AudioCtx();
                try {
                    await ctx.resume?.();
                } catch { }

                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                gain.gain.value = 0.0001;

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start();
                osc.stop(ctx.currentTime + 0.02);

                window.setTimeout(() => {
                    try {
                        ctx.close?.();
                    } catch { }
                }, 80);
            }
        } catch { }
    };

    useLayoutEffect(() => {
        void tryUnlockAudio();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const unlock = () => {
            if (audioUnlockedRef.current) return;

            audioUnlockedRef.current = true;
            void tryUnlockAudio();

            window.removeEventListener("pointerdown", unlock, true);
            window.removeEventListener("keydown", unlock, true);
            window.removeEventListener("touchstart", unlock, true);
            window.removeEventListener("click", unlock, true);
        };

        window.addEventListener("pointerdown", unlock, true);
        window.addEventListener("keydown", unlock, true);
        window.addEventListener("touchstart", unlock, true);
        window.addEventListener("click", unlock, true);

        return () => {
            window.removeEventListener("pointerdown", unlock, true);
            window.removeEventListener("keydown", unlock, true);
            window.removeEventListener("touchstart", unlock, true);
            window.removeEventListener("click", unlock, true);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
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

    useEffect(() => {
        const onVis = () => {
            if (document.hidden) stopWelcomeLoop();
        };
        document.addEventListener("visibilitychange", onVis);
        return () => document.removeEventListener("visibilitychange", onVis);
    }, []);

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
        const loopSeconds = (Number(stagebarCycleSeconds) || 0) > 0 ? Number(stagebarCycleSeconds) : Math.max(1, sumStageSeconds);

        const timer = window.setInterval(() => {
            const now = Date.now();
            const diffSecRaw = (now - startMs) / 1000;

            const diffSec = loopSeconds > 0 && isInfiniteRoom ? ((diffSecRaw % loopSeconds) + loopSeconds) % loopSeconds : diffSecRaw;

            let total = 0;
            let active = stages.length - 1;
            let found = false;

            for (let i = 0; i < stages.length; i++) {
                const dur = stageSeconds[i] || 0;
                const next = total + dur;

                if (dur <= 0) continue;

                if (diffSec < next) {
                    active = i;
                    const rem = next - diffSec;
                    setRemainingTime(`${Math.max(0, Math.floor(rem / 60))}:${String(Math.max(0, Math.floor(rem % 60))).padStart(2, "0")}`);
                    found = true;
                    break;
                }
                total = next;
            }

            if (!found) setRemainingTime("0:00");
            setCurrentStage(active);

            const stage = stages[active];
            if (!stage) return;

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
        }, 1000);

        return () => window.clearInterval(timer);
    }, [stagebarStartTime, stages, isSilentRoom, isInfiniteRoom, stagebarCycleSeconds]);

    // ============================================
    // Attendance: join / heartbeat / leave (+ keepalive leave)
    // ============================================
    const attendanceHbTimerRef = useRef<number | null>(null);
    const leaveOnceRef = useRef(false);

    const startAttendanceHeartbeat = () => {
        if (attendanceHbTimerRef.current) return;
        attendanceHbTimerRef.current = window.setInterval(() => {
            void attendanceHeartbeat();
        }, ATT_HEARTBEAT_MS);
    };

    const stopAttendanceHeartbeat = () => {
        if (!attendanceHbTimerRef.current) return;
        window.clearInterval(attendanceHbTimerRef.current);
        attendanceHbTimerRef.current = null;
    };

    const attendanceJoin = async () => {
        if (!sessionId || !currentUserId) return;

        const nowIso = new Date().toISOString();

        // 1) RPC
        try {
            const { error } = await supabase.rpc("attendance_join", { p_session_id: sessionId });
            if (!error) return;
            console.log("attendance_join rpc error:", error);
        } catch (e) {
            console.log("attendance_join rpc exception:", e);
        }

        // 2) fallback UPSERT
        try {
            const { error } = await supabase
                .from("session_attendance")
                .upsert(
                    {
                        session_id: sessionId,
                        user_id: currentUserId,
                        joined_at: nowIso,
                        left_at: null,
                        last_seen_at: nowIso,
                    },
                    { onConflict: "session_id,user_id" }
                );
            if (error) console.log("attendance_join fallback error:", error);
        } catch (e2) {
            console.log("attendance_join fallback exception:", e2);
        }
    };

    const attendanceHeartbeat = async () => {
        if (!sessionId || !currentUserId) return;

        const nowIso = new Date().toISOString();

        // 1) RPC
        try {
            const { error } = await supabase.rpc("attendance_heartbeat", { p_session_id: sessionId });
            if (!error) return;
            console.log("attendance_heartbeat rpc error:", error);
        } catch (e) {
            console.log("attendance_heartbeat rpc exception:", e);
        }

        // 2) fallback UPDATE
        try {
            const { error } = await supabase
                .from("session_attendance")
                .update({ last_seen_at: nowIso, left_at: null })
                .eq("session_id", sessionId)
                .eq("user_id", currentUserId);

            if (error) console.log("attendance_heartbeat fallback error:", error);
        } catch (e2) {
            console.log("attendance_heartbeat fallback exception:", e2);
        }
    };

    const attendanceLeave = async () => {
        stopAttendanceHeartbeat();

        if (!sessionId || !currentUserId) return;

        const nowIso = new Date().toISOString();

        // 1) RPC
        try {
            const { error } = await supabase.rpc("attendance_leave", { p_session_id: sessionId });
            if (!error) return;
            console.log("attendance_leave rpc error:", error);
        } catch (e) {
            console.log("attendance_leave rpc exception:", e);
        }

        // 2) fallback UPDATE
        try {
            const { error } = await supabase
                .from("session_attendance")
                .update({ left_at: nowIso, last_seen_at: nowIso })
                .eq("session_id", sessionId)
                .eq("user_id", currentUserId);

            if (error) console.log("attendance_leave fallback error:", error);
        } catch (e2) {
            console.log("attendance_leave fallback exception:", e2);
        }
    };

    // keepalive write on hard exits
    const keepaliveLeaveWrite = () => {
        try {
            if (!sessionId || !currentUserId) return;
            const supabaseUrl = String((import.meta as any).env.VITE_SUPABASE_URL || "").trim();
            const anonKey = String((import.meta as any).env.VITE_SUPABASE_ANON_KEY || "").trim();
            const token = String(accessTokenRef.current || "");

            if (!supabaseUrl || !anonKey || !token) return;

            const nowIso = new Date().toISOString();
            const url = `${supabaseUrl}/rest/v1/session_attendance?session_id=eq.${encodeURIComponent(
                sessionId
            )}&user_id=eq.${encodeURIComponent(currentUserId)}`;

            // IMPORTANT: keepalive true
            void fetch(url, {
                method: "PATCH",
                headers: {
                    apikey: anonKey,
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                    Prefer: "return=minimal",
                },
                body: JSON.stringify({ left_at: nowIso, last_seen_at: nowIso }),
                keepalive: true as any,
            }).catch(() => { });
        } catch { }
    };

    const leaveOnce = async (opts: { dispose?: boolean; keepalive?: boolean } = {}) => {
        if (leaveOnceRef.current) return;
        leaveOnceRef.current = true;

        if (opts.keepalive) keepaliveLeaveWrite();

        try {
            await attendanceLeave();
        } catch { }

        if (opts.dispose === false) return;

        try {
            apiRef.current?.dispose?.();
        } catch { }
    };

    // hard exits
    useEffect(() => {
        const onBeforeUnload = () => {
            // do both: keepalive + best-effort async
            void leaveOnce({ dispose: false, keepalive: true });
        };
        const onPageHide = () => {
            void leaveOnce({ dispose: false, keepalive: true });
        };

        window.addEventListener("beforeunload", onBeforeUnload);
        window.addEventListener("pagehide", onPageHide);

        return () => {
            window.removeEventListener("beforeunload", onBeforeUnload);
            window.removeEventListener("pagehide", onPageHide);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, currentUserId]);

    // SPA unmount
    useEffect(() => {
        return () => {
            void leaveOnce({ dispose: true, keepalive: false });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ============================================
    // Live online users from session_attendance (for count + SessionCard)
    // ============================================
    const attendanceFetchTimerRef = useRef<number | null>(null);
    const lastAttendanceFetchAtRef = useRef<number>(0);

    const computeOnline = (rows: any[]): OnlineUser[] => {
        const now = Date.now();
        const out: OnlineUser[] = [];

        for (const r of rows || []) {
            const uid = String(r?.user_id || "");
            if (!uid) continue;

            const leftAt = r?.left_at ? String(r.left_at) : "";
            if (leftAt) continue;

            const lastSeen = r?.last_seen_at ? new Date(String(r.last_seen_at)).getTime() : 0;
            if (!lastSeen || !Number.isFinite(lastSeen)) continue;

            if (now - lastSeen > ONLINE_WINDOW_MS) continue;

            const full = String(r?.profiles?.full_name || r?.full_name || "User");
            const ava = (r?.profiles?.avatar_url ?? r?.avatar_url ?? null) as string | null;

            out.push({
                user_id: uid,
                full_name: full,
                avatar_url: ava,
                last_seen_at: r?.last_seen_at ? String(r.last_seen_at) : null,
            });
        }

        // stable sort: most recently seen first
        out.sort((a, b) => {
            const ta = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
            const tb = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0;
            return (tb || 0) - (ta || 0);
        });

        return out;
    };

    const fetchOnlineUsers = async (immediate = false) => {
        if (!sessionId) return;
        if (!currentUserId) return;

        const now = Date.now();
        const since = lastAttendanceFetchAtRef.current || 0;

        if (!immediate && now - since < 1200) {
            if (attendanceFetchTimerRef.current) return;
            attendanceFetchTimerRef.current = window.setTimeout(() => {
                attendanceFetchTimerRef.current = null;
                void fetchOnlineUsers(true);
            }, 1300);
            return;
        }

        lastAttendanceFetchAtRef.current = now;

        try {
            // NOTE: requires relationship session_attendance.user_id -> profiles.id
            const { data, error } = await supabase
                .from("session_attendance")
                .select("user_id,last_seen_at,left_at,profiles(full_name,avatar_url)")
                .eq("session_id", sessionId);

            if (error) throw error;

            const online = computeOnline(Array.isArray(data) ? data : []);
            setOnlineUsers(online);

            // ✅ primary count source
            if (online.length > 0) setParticipantsNow(online.length);
            else {
                // fallback: if nobody yet in attendance, use Jitsi list length
                const fallbackCount = participantRows?.length || 0;
                if (fallbackCount > 0) setParticipantsNow(fallbackCount);
            }
        } catch (e) {
            // don't spam UI; just keep last state
            // console.log("fetchOnlineUsers error", e);
        }
    };

    useEffect(() => {
        if (authStatus !== "authed") return;
        if (!sessionId) return;
        if (!currentUserId) return;

        void fetchOnlineUsers(true);

        const ch = supabase
            .channel(`attendance-live:${sessionId}`)
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "session_attendance", filter: `session_id=eq.${sessionId}` },
                () => {
                    void fetchOnlineUsers(false);
                }
            )
            .subscribe();

        return () => {
            if (attendanceFetchTimerRef.current) {
                window.clearTimeout(attendanceFetchTimerRef.current);
                attendanceFetchTimerRef.current = null;
            }
            supabase.removeChannel(ch);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authStatus, sessionId, currentUserId]);

    // ============================================
    // Jitsi lifecycle
    // ============================================
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
        kickedIdsRef.current = new Set();
        localIsModeratorRef.current = false;

        setParticipantsNow(0);
        setParticipantRows([]);

        setJitsiKey((x) => x + 1);
    };

    const maybeKickOrRejectIfOverLimit = async (api: any, joinedParticipantId?: string) => {
        try {
            if (!api) return;
            if (capacityTriggeredRef.current) return;

            const remote = Array.isArray(api.getParticipantsInfo?.()) ? api.getParticipantsInfo() : [];
            const count = 1 + remote.length; // local + remote

            // keep Jitsi-derived count as fallback; attendance count will override shortly
            setParticipantsNow((prev) => (prev > 0 ? prev : count));

            if (count <= maxParticipants) return;

            capacityTriggeredRef.current = true;

            if (isHost || localIsModeratorRef.current) {
                // kick the just-joined participant if provided
                const pid = String(joinedParticipantId || "");
                if (pid && !kickedIdsRef.current.has(pid)) {
                    kickedIdsRef.current.add(pid);
                    try {
                        api.executeCommand?.("kickParticipant", pid);
                    } catch { }
                }
                setCapacityError(`Room is full (${maxParticipants}). Extra participants will be removed.`);
                window.setTimeout(() => {
                    setCapacityError(null);
                    capacityTriggeredRef.current = false;
                }, 3500);
                return;
            }

            // not moderator -> self-leave
            setCapacityError(`Room is full (${maxParticipants}). Redirecting…`);
            try {
                api.executeCommand?.("hangup");
            } catch { }
            await leaveOnce({ dispose: true, keepalive: true });
            navigate("/sessions", { replace: true });
        } catch { }
    };

    // ============================================
    // Participants list helpers (Jitsi External API)
    // ============================================
    const refreshParticipantsList = async (api: any) => {
        try {
            const localId = String(localParticipantIdRef.current || "local");
            const localName = "You";

            let remote: any[] = [];
            try {
                const info = api?.getParticipantsInfo?.();
                if (Array.isArray(info)) remote = info;
            } catch { }

            const remoteRows: ParticipantRow[] = remote
                .map((p: any) => {
                    const pid = String(p?.participantId || p?.id || "");
                    if (!pid) return null;

                    const name = String(p?.displayName || p?.formattedDisplayName || p?.name || "Guest");
                    const audioMuted =
                        typeof p?.isAudioMuted === "boolean"
                            ? p.isAudioMuted
                            : typeof p?.audioMuted === "boolean"
                                ? p.audioMuted
                                : typeof p?.muted === "boolean"
                                    ? p.muted
                                    : undefined;

                    const videoMuted = typeof p?.isVideoMuted === "boolean" ? p.isVideoMuted : typeof p?.videoMuted === "boolean" ? p.videoMuted : undefined;

                    return {
                        id: pid,
                        displayName: name || "Guest",
                        isLocal: false,
                        audioMuted,
                        videoMuted,
                    } as ParticipantRow;
                })
                .filter(Boolean) as ParticipantRow[];

            const localRow: ParticipantRow = {
                id: localId,
                displayName: localName,
                isLocal: true,
                audioMuted: mutedAudio,
                videoMuted: mutedVideo,
            };

            const merged = [localRow, ...remoteRows.filter((r) => r.id !== localId)];
            setParticipantRows(merged);

            // fallback count if attendance not yet ready
            setParticipantsNow((prev) => (onlineUsers.length > 0 ? onlineUsers.length : Math.max(prev || 0, merged.length)));
        } catch { }
    };

    useEffect(() => {
        if (!(rightPanelOpen && rightTab === "participants")) return;
        const api = apiRef.current;
        if (!api) return;
        void refreshParticipantsList(api);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rightPanelOpen, rightTab]);

    const filteredParticipants = useMemo(() => {
        const q = participantsSearch.trim().toLowerCase();
        if (!q) return participantRows;
        return participantRows.filter((p) => (p.displayName || "").toLowerCase().includes(q));
    }, [participantRows, participantsSearch]);

    const renderParticipantRow = (p: ParticipantRow) => {
        const name = p.isLocal ? "You" : p.displayName || "Guest";
        const initials =
            name
                .split(" ")
                .filter(Boolean)
                .slice(0, 2)
                .map((x) => x[0]?.toUpperCase())
                .join("") || "U";

        const audioKnown = typeof p.audioMuted === "boolean";
        const videoKnown = typeof p.videoMuted === "boolean";

        return (
            <div key={p.id} className={`flex items-center justify-between px-3 py-2 rounded-xl transition ${isLight ? "hover:bg-black/5" : "hover:bg-white/5"}`}>
                <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${isLight ? "bg-blue-500/15 text-blue-700" : "bg-emerald-500/80 text-[#02140B]"}`}>
                        {initials}
                    </div>
                    <div className="min-w-0">
                        <div className={`text-[13px] font-medium truncate ${isLight ? "text-black/85" : "text-white/90"}`}>{name}</div>
                        <div className={`text-[11px] truncate ${isLight ? "text-black/45" : "text-white/45"}`}>{p.isLocal ? "Team member" : "Participant"}</div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <div
                        className={
                            "w-8 h-8 rounded-lg flex items-center justify-center " +
                            (!audioKnown ? (isLight ? "bg-black/5" : "bg-white/5") : p.audioMuted ? (isLight ? "bg-red-500/10" : "bg-red-500/20") : isLight ? "bg-black/5" : "bg-white/5")
                        }
                        title={!audioKnown ? "Audio status unknown" : p.audioMuted ? "Muted" : "Unmuted"}
                    >
                        <Icon
                            name={audioKnown && p.audioMuted ? "mic-off" : "mic-on"}
                            theme={audioKnown && p.audioMuted ? "dark" : theme}
                            className={`w-4 h-4 ${audioKnown && p.audioMuted ? "opacity-90" : "opacity-80"}`}
                        />
                    </div>

                    <div
                        className={
                            "w-8 h-8 rounded-lg flex items-center justify-center " +
                            (!videoKnown ? (isLight ? "bg-black/5" : "bg-white/5") : p.videoMuted ? (isLight ? "bg-red-500/10" : "bg-red-500/20") : isLight ? "bg-black/5" : "bg-white/5")
                        }
                        title={!videoKnown ? "Video status unknown" : p.videoMuted ? "Video off" : "Video on"}
                    >
                        <Icon name={videoKnown && p.videoMuted ? "camera-off" : "camera-on"} theme={theme} className={`w-4 h-4 ${videoKnown && p.videoMuted ? "opacity-90" : "opacity-80"}`} />
                    </div>
                </div>
            </div>
        );
    };

    // ============================================
    // ✅ Reactions via Supabase realtime broadcast
    // ============================================
    const reactionsChannelRef = useRef<any>(null);
    const reactionIdRef = useRef<number>(0);
    const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
    const profileNameCacheRef = useRef<Map<string, string>>(new Map());

    const resolveProfileName = async (uid: string): Promise<string> => {
        const id = String(uid || "");
        if (!id) return "User";

        const cached = profileNameCacheRef.current.get(id);
        if (cached) return cached;

        if (currentUserId && id === currentUserId) {
            const n = userName || "You";
            profileNameCacheRef.current.set(id, n);
            return n;
        }

        try {
            const { data } = await supabase.from("profiles").select("full_name").eq("id", id).single();
            const n = String(data?.full_name || "User");
            profileNameCacheRef.current.set(id, n);
            return n;
        } catch {
            profileNameCacheRef.current.set(id, "User");
            return "User";
        }
    };

    const pushReaction = (r: Omit<FloatingReaction, "id">) => {
        const rid = reactionIdRef.current + 1;
        reactionIdRef.current = rid;

        const item: FloatingReaction = { id: rid, ...r };
        setFloatingReactions((prev) => [...prev, item]);

        window.setTimeout(() => {
            setFloatingReactions((prev) => prev.filter((x) => x.id !== rid));
        }, 1500);
    };

    useEffect(() => {
        if (authStatus !== "authed") return;
        if (!sessionId) return;
        if (!currentUserId) return;

        const key = `reactions:${sessionId}`;

        const ch = supabase.channel(key, {
            config: {
                broadcast: { ack: true, self: false },
                presence: { key: currentUserId },
            },
        });

        reactionsChannelRef.current = ch;

        ch.on("broadcast", { event: "reaction" }, async (msg: any) => {
            try {
                const raw = msg?.payload;
                const p = raw && typeof raw === "object" && "payload" in raw ? (raw as any).payload : raw;

                const fromUserId = String(p?.user_id || "");
                const type = String(p?.type || "") as ReactionType;

                const sid = String(p?.session_id || "");
                if (sid && sid !== sessionId) return;

                if (!fromUserId || !type) return;
                if (fromUserId === currentUserId) return;

                const fromName = await resolveProfileName(fromUserId);
                pushReaction({ type, fromUserId, fromName });
            } catch (e) {
                console.log("[reactions] handler error", e);
            }
        });

        ch.subscribe();

        return () => {
            try {
                supabase.removeChannel(ch);
            } catch { }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authStatus, sessionId, currentUserId]);

    const sendReaction = async (type: ReactionType) => {
        if (!sessionId || !currentUserId) return;

        // local float
        pushReaction({
            type,
            fromUserId: currentUserId,
            fromName: userName || "You",
        });

        try {
            const ch = reactionsChannelRef.current;
            if (!ch) return;
            await ch.send({
                type: "broadcast",
                event: "reaction",
                payload: { session_id: sessionId, user_id: currentUserId, type },
            });
        } catch { }
    };

    // ============================================
    // JITSI INIT
    // ============================================
    useEffect(() => {
        if (authStatus !== "authed") return;
        if (!session) return;
        if (!iframeContainerRef.current) return;
        if (!roomName) return;

        // reset flags on each init
        leaveOnceRef.current = false;
        localJoinedRef.current = false;
        capacityTriggeredRef.current = false;
        localParticipantIdRef.current = null;
        localIsModeratorRef.current = false;

        let cancelled = false;

        (async () => {
            try {
                setLastErr("");
                setCapacityError(null);

                const { api } = await createJitsiApiWithFallback({
                    domains: domainsForSession(session),
                    roomName,
                    parentNode: iframeContainerRef.current!,
                    userName: userName || "User",
                    cssPathOnJitsiDomain: JITSI_CUSTOM_CSS_PATH,
                });

                if (cancelled) {
                    try {
                        api?.dispose?.();
                    } catch { }
                    return;
                }

                apiRef.current = api;
                setApiReady(true);

                try {
                    supportedCmdsRef.current = Array.isArray(api.getSupportedCommands?.()) ? api.getSupportedCommands() : null;
                } catch {
                    supportedCmdsRef.current = null;
                }

                // ---- events
                api.addEventListener?.("videoConferenceJoined", async (e: any) => {
                    try {
                        localJoinedRef.current = true;
                        const pid = String(e?.id || e?.participantId || "");
                        if (pid) localParticipantIdRef.current = pid;

                        // join attendance + start heartbeat
                        await attendanceJoin();
                        startAttendanceHeartbeat();
                        void fetchOnlineUsers(true);

                        // initial participants list
                        void refreshParticipantsList(api);

                        // capacity check
                        await maybeKickOrRejectIfOverLimit(api);
                    } catch { }
                });

                api.addEventListener?.("videoConferenceLeft", async () => {
                    try {
                        // ensure leave is recorded even if user leaves via internal flow
                        await leaveOnce({ dispose: true, keepalive: true });
                    } catch { }
                });

                api.addEventListener?.("readyToClose", async () => {
                    try {
                        await leaveOnce({ dispose: true, keepalive: true });
                        navigate("/sessions", { replace: true });
                    } catch { }
                });

                api.addEventListener?.("audioMuteStatusChanged", (e: any) => {
                    const m = !!e?.muted;
                    setMutedAudio(m);
                    // update local row quickly
                    setParticipantRows((prev) => prev.map((r) => (r.isLocal ? { ...r, audioMuted: m } : r)));
                });

                api.addEventListener?.("videoMuteStatusChanged", (e: any) => {
                    const m = !!e?.muted;
                    setMutedVideo(m);
                    setParticipantRows((prev) => prev.map((r) => (r.isLocal ? { ...r, videoMuted: m } : r)));
                });

                api.addEventListener?.("screenSharingStatusChanged", (e: any) => {
                    setIsScreenSharing(!!e?.on);
                });

                api.addEventListener?.("tileViewChanged", (e: any) => {
                    setTile(!!e?.enabled);
                });

                api.addEventListener?.("participantJoined", async (e: any) => {
                    try {
                        void refreshParticipantsList(api);
                        await maybeKickOrRejectIfOverLimit(api, String(e?.id || e?.participantId || ""));
                    } catch { }
                });

                api.addEventListener?.("participantLeft", async () => {
                    try {
                        void refreshParticipantsList(api);
                        capacityTriggeredRef.current = false;
                        setCapacityError(null);
                    } catch { }
                });

                api.addEventListener?.("participantRoleChanged", (e: any) => {
                    // e: { id, role }
                    try {
                        const pid = String(e?.id || "");
                        const role = String(e?.role || "").toLowerCase();
                        const myId = String(localParticipantIdRef.current || "");
                        if (pid && myId && pid === myId) {
                            localIsModeratorRef.current = role === "moderator";
                        }
                    } catch { }
                });

                // best-effort: set tile view on
                try {
                    api.executeCommand?.("setTileView", true);
                } catch { }

                // keep list fresh occasionally (cheap)
                window.setTimeout(() => void refreshParticipantsList(api), 800);
                window.setTimeout(() => void refreshParticipantsList(api), 2500);
            } catch (e: any) {
                const msg = String(e?.message || e || "Failed to start room");
                setLastErr(msg);
            }
        })();

        return () => {
            cancelled = true;
            try {
                apiRef.current?.dispose?.();
            } catch { }
            apiRef.current = null;
            setApiReady(false);
            stopAttendanceHeartbeat();
            stopWelcomeLoop();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authStatus, sessionId, jitsiKey, roomName]);

    // ============================================
    // Controls
    // ============================================
    const exec = (cmd: string, ...args: any[]) => {
        const api = apiRef.current;
        if (!api) return;
        try {
            api.executeCommand?.(cmd, ...args);
        } catch { }
    };

    const toggleMic = () => exec("toggleAudio");
    const toggleCamera = () => exec("toggleVideo");
    const toggleScreen = () => exec("toggleShareScreen");
    const toggleTile = () => exec("toggleTileView");

    const leavingUiRef = useRef(false);

    const onLeaveClick = async () => {
        if (leavingUiRef.current) return;
        leavingUiRef.current = true;

        try {
            // leave meeting first (will also fire videoConferenceLeft)
            try {
                apiRef.current?.executeCommand?.("hangup");
            } catch { }

            await leaveOnce({ dispose: true, keepalive: true });
        } catch {
            // fallback
            try {
                keepaliveLeaveWrite();
            } catch { }
        } finally {
            navigate("/sessions", { replace: true });
        }
    };

    // ============================================
    // UI classes
    // ============================================
    const pageBg = isLight ? "bg-[#F6F7FB] text-[#0B1220]" : "bg-[#050F1A] text-white";
    const topBarBg = isLight ? "bg-white/85 border border-black/10" : "bg-[#111827]/40 border border-white/5";
    const chipBg = isLight ? "bg-black/5 border border-black/10" : "bg-[#0B1220]/70 border border-white/5";
    const subtleText = isLight ? "text-black/55" : "text-[#9CA3AF]";
    const strongText = isLight ? "text-black/85" : "text-[#F3F4F6]/90";
    const panelBg = isLight ? "bg-white/85 border border-black/10" : "bg-[#0B1220]/55 border border-white/5";
    const bottomBarBg = isLight ? "bg-white/85 border border-black/10" : "bg-[#07101E]/85 border border-white/10";
    const ctlBtnBase = isLight ? "bg-black/5 hover:bg-black/10" : "bg-[#111827] hover:bg-[#1f2937]";

    const participantsCountLabel = useMemo(() => {
        const now = Number(participantsNow || 0);
        const max = Number(maxParticipants || 0);
        if (max > 0) return `${Math.max(0, now)} / ${max}`;
        return String(Math.max(0, now));
    }, [participantsNow, maxParticipants]);

    // ============================================
    // Loading / auth redirects
    // ============================================
    if (authStatus === "redirecting") {
        return <div className={`flex h-screen items-center justify-center ${pageBg}`}>Redirecting…</div>;
    }

    if (loading) {
        return <div className={`flex h-screen items-center justify-center ${pageBg}`}>Loading session…</div>;
    }

    if (!session) {
        return (
            <div className={`flex h-screen items-center justify-center ${pageBg}`}>
                <button
                    className={`h-10 px-4 rounded-xl ${isLight ? "bg-black/5 hover:bg-black/10" : "bg-white/10 hover:bg-white/15"}`}
                    onClick={() => navigate("/sessions")}
                >
                    Back
                </button>
            </div>
        );
    }

    const ChatPanelAny = ChatPanel as any;

    const RightPanelBody = (
        <div className={["rounded-2xl shadow-lg overflow-hidden min-h-0 h-full flex flex-col", panelBg, theme === "dark" ? "dark" : ""].join(" ")} data-theme={theme}>
            {rightTab === "participants" && (
                <div className="h-full min-h-0 flex flex-col">
                    <div className={`px-5 py-4 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"}`}>
                        <div className="flex items-center gap-2">
                            <span className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>Participants</span>
                            <span className={`${isLight ? "text-black/50" : "text-white/55"} text-sm`}>({participantsCountLabel})</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => void fetchOnlineUsers(true)}
                                className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight ? "bg-black/5 hover:bg-black/10 text-black/60" : "bg-[#111827] hover:bg-[#1f2937] text-white/80"}`}
                                title="Refresh"
                            >
                                <ReloadSmartIcon theme={theme} className="w-4 h-4 opacity-90" />
                            </button>
                            <button
                                onClick={() => openRightTab(null)}
                                className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight ? "bg-black/5 hover:bg-black/10 text-black/60" : "bg-[#111827] hover:bg-[#1f2937] text-white/80"}`}
                                title="Close"
                            >
                                ✕
                            </button>
                        </div>
                    </div>

                    {/* Online users (attendance-based) */}
                    <div className="px-4 pt-4">
                        <div className={`rounded-xl px-3 py-2 text-[12px] ${isLight ? "bg-black/5 border border-black/10 text-black/65" : "bg-[#0B1220]/70 border border-white/10 text-white/70"}`}>
                            Online now: <span className="font-semibold">{onlineUsers.length}</span> (by presence)
                        </div>
                        {onlineUsers.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                                {onlineUsers.slice(0, 12).map((u) => {
                                    const initials =
                                        (u.full_name || "U")
                                            .split(" ")
                                            .filter(Boolean)
                                            .slice(0, 2)
                                            .map((x) => x[0]?.toUpperCase())
                                            .join("") || "U";

                                    return (
                                        <div
                                            key={u.user_id}
                                            className={`h-9 px-3 rounded-full flex items-center gap-2 text-[12px] ${isLight ? "bg-white border border-black/10 text-black/75" : "bg-[#020617]/40 border border-white/10 text-white/80"}`}
                                            title={u.full_name}
                                        >
                                            <div className={`w-7 h-7 rounded-full flex items-center justify-center font-semibold ${isLight ? "bg-blue-500/15 text-blue-700" : "bg-emerald-500/80 text-[#02140B]"}`}>
                                                {initials}
                                            </div>
                                            <div className="max-w-[140px] truncate">{u.full_name}</div>
                                        </div>
                                    );
                                })}
                                {onlineUsers.length > 12 && (
                                    <div className={`h-9 px-3 rounded-full flex items-center text-[12px] ${isLight ? "bg-black/5 text-black/60" : "bg-white/10 text-white/70"}`}>
                                        +{onlineUsers.length - 12}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="p-4">
                        <div className={`rounded-xl px-3 py-2 ${isLight ? "bg-black/5 border border-black/10" : "bg-[#0B1220]/70 border border-white/10"}`}>
                            <input
                                value={participantsSearch}
                                onChange={(e) => setParticipantsSearch(e.target.value)}
                                placeholder="Search participants..."
                                className={`w-full bg-transparent outline-none text-[13px] placeholder:opacity-60 ${isLight ? "text-black/80 placeholder:text-black/40" : "text-white/85 placeholder:text-white/35"}`}
                            />
                        </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
                        <div className="flex flex-col gap-2">{filteredParticipants.map(renderParticipantRow)}</div>
                    </div>
                </div>
            )}

            {rightTab === "chat" && (
                <div className="h-full min-h-0 flex flex-col">
                    <div className={`px-5 py-4 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"}`}>
                        <div className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>Chat</div>
                        <button
                            onClick={() => openRightTab(null)}
                            className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight ? "bg-black/5 hover:bg-black/10 text-black/60" : "bg-[#111827] hover:bg-[#1f2937] text-white/80"}`}
                            title="Close"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="flex-1 min-h-0 p-4 overflow-hidden">
                        <div className={`h-full min-h-0 overflow-hidden rounded-xl ${isLight ? "bg-white/70 border border-black/10" : "bg-[#020617]/40 border border-white/10"}`}>
                            <div className="h-full min-h-0 flex flex-col overflow-hidden [&>*]:h-full [&>*]:min-h-0">
                                {session?.id ? (
                                    <div data-theme={theme} style={{ colorScheme: theme as any }} className={theme === "dark" ? "dark h-full min-h-0" : "h-full min-h-0"}>
                                        <ChatPanelAny
                                            sessionId={session.id}
                                            theme={theme}
                                            showHeader={false}
                                            title="Chat"
                                            onClose={() => openRightTab(null)}
                                            embedded={true}
                                            hideHeader={true}
                                            authUserId={currentUserId}
                                            displayName={userName}
                                        />
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {rightTab === "intentions" && (
                <div className="h-full min-h-0 flex flex-col">
                    <div className={`px-5 py-4 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"}`}>
                        <div className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>Intentions</div>
                        <button
                            onClick={() => openRightTab(null)}
                            className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight ? "bg-black/5 hover:bg-black/10 text-black/60" : "bg-[#111827] hover:bg-[#1f2937] text-white/80"}`}
                            title="Close"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="flex-1 min-h-0 overflow-hidden p-4">
                        <div className={`h-full min-h-0 overflow-hidden rounded-xl ${isLight ? "bg-white/70 border border-black/10" : "bg-[#020617]/40 border border-white/10"}`}>
                            <div className="h-full min-h-0 overflow-y-auto [&>*]:min-h-0">
                                <div data-theme={theme} style={{ colorScheme: theme as any }} className={theme === "dark" ? "dark h-full min-h-0" : "h-full min-h-0"}>
                                    <IntentionsPanel key={`intentions-${session.id}-${theme}`} theme={theme} sessionId={session.id} timerText={remainingTime || "--:--"} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    const reactionsMenuRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!showReactionsMenu) return;

        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node | null;
            if (!reactionsMenuRef.current || !target) return;
            if (!reactionsMenuRef.current.contains(target)) setShowReactionsMenu(false);
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [showReactionsMenu]);

    return (
        <div className={`h-[100dvh] overflow-hidden ${pageBg}`}>
            {/* top */}
            <div className="h-full w-full px-3 sm:px-5 pt-5 pb-[calc(110px+env(safe-area-inset-bottom))] flex flex-col gap-5 min-h-0">
                <div className={`flex w-full rounded-2xl overflow-hidden ${topBarBg}`}>
                    <div className="flex-1 px-6 py-4">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <p className={`font-inter font-semibold text-[18px] truncate ${strongText}`}>{session.title}</p>
                                <p className={`font-inter text-[13px] ${subtleText}`}>
                                    {participantsCountLabel} participants
                                </p>
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

                                <button
                                    onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                                    className={`w-[84px] h-[32px] rounded-full border relative transition flex items-center px-[3px] ${isLight ? "bg-black/5 border-black/10 hover:bg-black/10" : "bg-white/5 border-white/10 hover:bg-white/10"
                                        }`}
                                    title="Toggle theme"
                                    aria-label="Toggle theme"
                                >
                                    <div
                                        className="absolute top-[2px] w-[26px] h-[26px] rounded-full shadow-md transition-transform bg-white flex items-center justify-center"
                                        style={{ transform: isLight ? "translateX(0px)" : "translateX(50px)" }}
                                    >
                                        <Icon name={isLight ? "theme-sun" : "theme-moon"} theme={theme} className="w-4 h-4" alt="" />
                                    </div>
                                </button>

                                {session.host_profile && (
                                    <button
                                        onClick={() => setSelectedUser(session.host_profile || null)}
                                        className={`max-[480px]:hidden flex items-center gap-2 px-3 py-1.5 rounded-xl border transition font-inter text-[13px] ${isLight
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

                        {!isSilentRoom && stages.length > 0 && !!stagebarStartTime && (
                            <div className="mt-3 w-full overflow-hidden">
                                <div className="w-full overflow-hidden">
                                    <SessionStageBar stages={stages} startTime={stagebarStartTime} cycleSeconds={stagebarCycleSeconds} onHoverStage={setHoveredStage} />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* main */}
                <div className={"relative grid grid-rows-1 gap-5 flex-1 min-h-0 h-full " + (rightPanelOpen ? "lg:grid-cols-[minmax(0,1fr),420px]" : "grid-cols-1")}>
                    <div className={`relative rounded-2xl overflow-hidden min-h-0 h-full ${isLight ? "bg-white/70 border border-black/10" : "bg-[#0B1220]/45 border border-white/5"}`}>
                        <div className="w-full h-full min-h-0">
                            <div className="w-full h-full" ref={iframeContainerRef} key={jitsiKey} />
                        </div>

                        {/* floating reactions */}
                        <div className="pointer-events-none absolute inset-0">
                            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex flex-col gap-2 items-center">
                                {floatingReactions.map((r) => (
                                    <div
                                        key={r.id}
                                        className={`px-3 py-1.5 rounded-2xl shadow-lg text-[14px] flex items-center gap-2 ${isLight ? "bg-white border border-black/10 text-black/80" : "bg-[#020617] border border-white/10 text-white/90"
                                            }`}
                                    >
                                        <span className="text-[18px]">{reactionEmoji[r.type]}</span>
                                        <span className={`text-[12px] ${isLight ? "text-black/60" : "text-white/70"}`}>{r.fromName}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {(lastErr || capacityError) && (
                            <div className="absolute top-4 left-4 text-xs bg-red-600 text-white px-3 py-2 rounded-lg shadow">
                                {capacityError || lastErr}
                            </div>
                        )}

                        {!apiReady && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className={`px-4 py-3 rounded-2xl shadow-lg ${isLight ? "bg-white border border-black/10 text-black/70" : "bg-[#020617] border border-white/10 text-white/80"}`}>
                                    Connecting…
                                </div>
                            </div>
                        )}
                    </div>

                    {/* right panel desktop */}
                    {rightPanelOpen && isLgUp && <div className="min-h-0 h-full overflow-hidden">{RightPanelBody}</div>}

                    {/* right panel mobile overlay */}
                    {rightPanelOpen && !isLgUp && (
                        <div className="absolute inset-0 z-40 min-h-0">
                            <div className="absolute inset-0 bg-black/40" onClick={() => openRightTab(null)} />
                            <div className="absolute inset-x-0 top-0 bottom-0 p-2 min-h-0">{RightPanelBody}</div>
                        </div>
                    )}
                </div>
            </div>

            {/* bottom bar */}
            <div className="fixed inset-x-0 bottom-0 z-50">
                <div className="w-full px-3 sm:px-5 pb-[calc(12px+env(safe-area-inset-bottom))]">
                    <div className={`h-[64px] sm:h-[74px] rounded-2xl shadow-2xl backdrop-blur grid grid-cols-[auto,1fr,auto] items-center px-2 sm:px-4 ${bottomBarBg}`}>
                        {/* left: participants + more menu */}
                        <div className="flex items-center gap-2" ref={moreMenuRef}>
                            <div className="md:hidden relative">
                                <button onClick={() => setShowMoreMenu((v) => !v)} className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`} title="Menu">
                                    <span className={isLight ? "text-black/70" : "text-white/85"}>⋯</span>
                                </button>

                                {showMoreMenu && (
                                    <div className="absolute bottom-[76px] sm:bottom-[86px] left-0">
                                        <div className={`w-[240px] rounded-2xl shadow-2xl overflow-hidden ${isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10"}`}>
                                            <button
                                                onClick={() => {
                                                    openRightTab("participants");
                                                    setShowMoreMenu(false);
                                                }}
                                                className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"}`}
                                            >
                                                <ParticipantsSmartIcon theme={theme} className="w-4 h-4 opacity-90" />
                                                <span>Participants</span>
                                                <span className={`ml-auto text-[12px] ${isLight ? "text-black/45" : "text-white/45"}`}>{participantsCountLabel}</span>
                                            </button>

                                            <button
                                                onClick={() => {
                                                    openRightTab("chat");
                                                    setShowMoreMenu(false);
                                                }}
                                                className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"}`}
                                            >
                                                <Icon name="chat" theme={theme} className="w-4 h-4 opacity-90" />
                                                <span>Chat</span>
                                                {unreadChat > 0 && (
                                                    <span className={`ml-auto min-w-[22px] h-[18px] px-2 rounded-full text-[11px] flex items-center justify-center ${isLight ? "bg-blue-600 text-white" : "bg-emerald-500 text-[#02140B]"}`}>
                                                        {unreadChat > 99 ? "99+" : unreadChat}
                                                    </span>
                                                )}
                                            </button>

                                            <button
                                                onClick={() => {
                                                    openRightTab("intentions");
                                                    setShowMoreMenu(false);
                                                }}
                                                className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"}`}
                                            >
                                                <Icon name="intentions" theme={theme} className="w-4 h-4 opacity-90" />
                                                <span>Intentions</span>
                                            </button>

                                            <div className={isLight ? "h-px bg-black/10" : "h-px bg-white/10"} />

                                            <button
                                                onClick={() => {
                                                    forceReloadJitsi();
                                                    setShowMoreMenu(false);
                                                }}
                                                className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"}`}
                                            >
                                                <ReloadSmartIcon theme={theme} className="w-4 h-4 opacity-90" />
                                                <span>Reload room</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="hidden md:flex items-center gap-2">
                                <button onClick={() => openRightTab("participants")} className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`} title="Participants">
                                    <ParticipantsSmartIcon theme={theme} className="w-5 h-5" />
                                </button>

                                <button onClick={() => openRightTab("chat")} className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`} title="Chat">
                                    <div className="relative">
                                        <Icon name="chat" theme={theme} className="w-5 h-5" />
                                        {unreadChat > 0 && (
                                            <div className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] flex items-center justify-center ${isLight ? "bg-blue-600 text-white" : "bg-emerald-500 text-[#02140B]"}`}>
                                                {unreadChat > 99 ? "99+" : unreadChat}
                                            </div>
                                        )}
                                    </div>
                                </button>

                                <button onClick={() => openRightTab("intentions")} className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`} title="Intentions">
                                    <Icon name="intentions" theme={theme} className="w-5 h-5" />
                                </button>

                                <button onClick={forceReloadJitsi} className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`} title="Reload room">
                                    <ReloadSmartIcon theme={theme} className="w-5 h-5 opacity-90" />
                                </button>
                            </div>
                        </div>

                        {/* center: media */}
                        <div className="flex items-center justify-center gap-2 sm:gap-3">
                            <button
                                onClick={toggleMic}
                                className={"w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition " + (mutedAudio ? "bg-red-600 hover:bg-red-700" : ctlBtnBase)}
                                title="Toggle mic"
                            >
                                <Icon name={mutedAudio ? "mic-off" : "mic-on"} theme={mutedAudio ? "dark" : theme} className="w-5 h-5" />
                            </button>

                            <button
                                onClick={toggleCamera}
                                className={"w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition " + (mutedVideo ? "bg-red-600 hover:bg-red-700" : ctlBtnBase)}
                                title="Toggle camera"
                            >
                                <Icon name={mutedVideo ? "camera-off" : "camera-on"} theme={theme} className="w-5 h-5" />
                            </button>

                            <button
                                onClick={toggleScreen}
                                className={"w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition " + (isScreenSharing ? "bg-blue-600 hover:bg-blue-700" : ctlBtnBase)}
                                title="Share screen"
                            >
                                <Icon name="screen-share" theme={theme} className="w-5 h-5" />
                            </button>

                            <button onClick={toggleTile} className={`hidden sm:flex w-10 h-10 sm:w-11 sm:h-11 rounded-2xl items-center justify-center transition ${ctlBtnBase}`} title="Toggle tile view">
                                <Icon name="tile-view" theme={theme} className="w-5 h-5" />
                            </button>

                            <div className="relative" ref={reactionsMenuRef}>
                                <button
                                    onClick={() => setShowReactionsMenu((v) => !v)}
                                    className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                    title="Reactions"
                                >
                                    <Icon name="reaction" theme={theme} className="w-5 h-5" />
                                </button>

                                {showReactionsMenu && (
                                    <div
                                        className={`absolute bottom-[54px] sm:bottom-[58px] left-1/2 -translate-x-1/2 rounded-2xl px-3 py-2 flex gap-2 text-xl shadow-xl ${isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10"
                                            }`}
                                    >
                                        {(Object.keys(reactionEmoji) as ReactionType[]).map((t) => (
                                            <button
                                                key={t}
                                                onClick={() => {
                                                    void sendReaction(t);
                                                    setShowReactionsMenu(false);
                                                }}
                                                className="hover:scale-[1.06] transition"
                                                title={t}
                                            >
                                                {reactionEmoji[t]}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* right: leave */}
                        <div className="flex items-center justify-end gap-2 sm:gap-3">
                            <button onClick={onLeaveClick} className={`hidden sm:flex h-11 px-6 rounded-2xl font-semibold items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white`} title="Leave">
                                <Icon name="leave" theme={theme} className="w-5 h-5" />
                                <span className="text-[14px]">Leave</span>
                            </button>

                            <button onClick={onLeaveClick} className="sm:hidden w-10 h-10 rounded-2xl bg-red-600 hover:bg-red-700 text-white flex items-center justify-center" title="Leave">
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
