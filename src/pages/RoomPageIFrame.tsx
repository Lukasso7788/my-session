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
// ✅ MOBILE UX (<=480):
// - Bottom bar: hide Participants/Chat/Intentions buttons; show ⋯ menu instead
// - Right panel should NOT shrink video on mobile; it overlays video (modal sheet)

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

import { IntentionsPanel } from "../components/IntentionsPanel";
import { SessionStageBar } from "../components/SessionStageBar";
import { UserProfileModal } from "../components/UserProfileModal";
import ChatPanel from "../components/ChatPanel";
import { useAttendancePresence } from "../hooks/useAttendancePresence";

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

// ✅ allow env-forced domain (useful for test deployments)
const FORCE_JITSI_DOMAIN = String((import.meta as any).env.VITE_FORCE_JITSI_DOMAIN || "").trim();
// if true => ONLY this domain (no fallbacks)
const FORCE_JITSI_ONLY = (import.meta as any).env.VITE_FORCE_JITSI_ONLY === "true";

type JitsiDomain = (typeof ALL_JITSI_DOMAINS)[number] | string;

function domainsForSession(session: any): readonly string[] {
    // ✅ test override
    if (FORCE_JITSI_DOMAIN) {
        const uniq = (d: string, i: number, arr: string[]) => arr.indexOf(d) === i;

        if (FORCE_JITSI_ONLY) return [FORCE_JITSI_DOMAIN];

        return [FORCE_JITSI_DOMAIN, ...ALL_JITSI_DOMAINS].filter(uniq);
    }

    // normal behavior
    const preferred = String(session?.jitsi_domain || "").trim();
    if (preferred) {
        // if preferred is not in ALL_JITSI_DOMAINS, still allow it (dynamic)
        return [preferred, ...ALL_JITSI_DOMAINS.filter((d) => d !== preferred)];
    }
    return ALL_JITSI_DOMAINS;
}

const TOOLBAR_MOUNT_BUTTONS = ["settings"];
const TOOLBAR_VISIBLE_BUTTONS: string[] = [];
const JITSI_CUSTOM_CSS_PATH = "/jitsi-custom.css";

// ✅ Chat table for unread badge
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

// ✅ FIX: define BEFORE STAGE_COLORS
const CUSTOM_BLOCK_GRADIENT =
    "linear-gradient(90deg, #5286F6 0%, #65D46C 40%, #F65252 80%, #F65252 100%)";

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

            // ✅ CRITICAL FIX:
            // customCssUrl MUST be served from the SAME JITSI DOMAIN.
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

                    // Try to avoid “filmstrip-only / top-stuck” behavior when UI is hidden by CSS
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

// ✅ Smart icon: participants
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

// ✅ Smart icon: reload
function ReloadSmartIcon({ theme, className = "w-4 h-4" }: { theme: RoomTheme; className?: string }) {
    const candidates = [
        `/icons/reload-${theme}.svg`,
        `/icons/reload.svg`,
        `/icons/refresh-${theme}.svg`,
        `/icons/refresh.svg`,
    ];
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

    // capacity enforcement UI
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

    // ✅ participants list (right panel)
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

    // close reactions menu when panel is used (prevents overlapping popovers)
    const [showReactionsMenu, setShowReactionsMenu] = useState(false);
    useEffect(() => {
        if (rightPanelOpen) setShowReactionsMenu(false);
    }, [rightPanelOpen, rightTab]);

    // close ⋯ menu when panel is used
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

    // ✅ PRESENCE
    useAttendancePresence(session?.id && currentUserId ? String(session.id) : null, { heartbeatMs: 10_000 });

    const attendanceLeave = async () => {
        stopAttendanceHeartbeat();

        if (!session?.id || !currentUserId) return;

        const nowIso = new Date().toISOString();

        // 1) RPC
        try {
            const { error } = await supabase.rpc("attendance_leave", { p_session_id: String(session.id) });
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
                .eq("session_id", String(session.id))
                .eq("user_id", String(currentUserId));

            if (error) console.log("attendance_leave fallback error:", error);
        } catch (e2) {
            console.log("attendance_leave fallback exception:", e2);
        }
    };

    const ATT_HEARTBEAT_MS = 10_000;
    const attendanceHbTimerRef = useRef<number | null>(null);

    const attendanceJoin = async () => {
        if (!session?.id || !currentUserId) return;

        const nowIso = new Date().toISOString();

        // 1) RPC
        try {
            const { error } = await supabase.rpc("attendance_join", { p_session_id: String(session.id) });
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
                        session_id: String(session.id),
                        user_id: String(currentUserId),
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
        if (!session?.id || !currentUserId) return;

        const nowIso = new Date().toISOString();

        // 1) RPC
        try {
            const { error } = await supabase.rpc("attendance_heartbeat", { p_session_id: String(session.id) });
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
                .eq("session_id", String(session.id))
                .eq("user_id", String(currentUserId));

            if (error) console.log("attendance_heartbeat fallback error:", error);
        } catch (e2) {
            console.log("attendance_heartbeat fallback exception:", e2);
        }
    };

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

    // =========================
    // ✅ LEAVE-ONCE (covers: SPA unmount, beforeunload, pagehide)
    // =========================
    // =========================
    // ✅ LEAVE SAFETY (UI Leave button)
    // =========================
    const leavingUiRef = useRef(false);
    const leaveRedirectTimerRef = useRef<number | null>(null);

    const clearLeaveRedirectTimer = () => {
        if (!leaveRedirectTimerRef.current) return;
        window.clearTimeout(leaveRedirectTimerRef.current);
        leaveRedirectTimerRef.current = null;
    };

    const leaveOnceRef = useRef(false);

    type LeaveOnceOpts = { dispose?: boolean };

    const leaveOnce = async (opts: LeaveOnceOpts = {}) => {
        if (leaveOnceRef.current) return;
        leaveOnceRef.current = true;

        try {
            await attendanceLeave(); // stopAttendanceHeartbeat() внутри
        } catch { }

        // dispose по умолчанию TRUE (для beforeunload/pagehide/unmount)
        if (opts.dispose === false) return;

        try {
            apiRef.current?.dispose?.();
        } catch { }
    };

    // =========================
    // ✅ EXIT HOOKS: beforeunload + pagehide + SPA unmount
    // =========================
    useEffect(() => {
        // 1) hard exits (close tab, reload, navigate away)
        const onBeforeUnload = () => { void leaveOnce(); };
        const onPageHide = () => { void leaveOnce(); }; // ✅ Safari/iOS + bfcache cases

        window.addEventListener("beforeunload", onBeforeUnload);
        window.addEventListener("pagehide", onPageHide);

        return () => {
            window.removeEventListener("beforeunload", onBeforeUnload);
            window.removeEventListener("pagehide", onPageHide);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session?.id]);

    useEffect(() => {
        // 2) SPA navigation (component unmount)
        return () => {
            void leaveOnce();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
        setParticipantRows([]);

        setJitsiKey((x) => x + 1);
    };

    // =========================
    // AUDIO SYSTEM
    // =========================
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

    // ✅ stop welcome loop when tab is hidden
    useEffect(() => {
        const onVis = () => {
            if (document.hidden) stopWelcomeLoop();
        };
        document.addEventListener("visibilitychange", onVis);
        return () => document.removeEventListener("visibilitychange", onVis);
    }, []);

    // ============================================
    // AUTH GATE (NO GUESTS)
    // ============================================
    useEffect(() => {
        (async () => {
            setAuthStatus("checking");

            try {
                const { data } = await supabase.auth.getUser();
                const u = data.user;

                if (!u) {
                    setCurrentUserId(null);
                    setUserName("");
                    setAuthStatus("redirecting");

                    const redirect = encodeURIComponent(location.pathname + location.search);
                    navigate(`/login?redirect=${redirect}`, { replace: true });
                    return;
                }

                setCurrentUserId(u.id);

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

            const selectStr =
                "*, host_profile:profiles!sessions_host_id_fkey(id, full_name, avatar_url, bio), session_templates(*)";

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

                    // 50/50/50 shorthand
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
                                    if (lower.includes("outro") || lower.includes("wrap") || lower.includes("farewell") || lower.includes("end")) return "outro";
                                    if (lower.includes("focus")) return "focus";
                                    return "focus";
                                };

                                const type: Stage["type"] =
                                    rawType && rawType !== "stage" && rawType !== "block" ? inferTypeFromText(rawType) : inferTypeFromText(labelLower);

                                const secondsExplicit =
                                    Number(b?.seconds) ||
                                    Number(b?.duration_seconds) ||
                                    Number(b?.durationSeconds) ||
                                    Number(b?.duration_sec) ||
                                    0;

                                const minsLike =
                                    Number(b?.minutes) || Number(b?.mins) || Number(b?.duration_minutes) || Number(b?.durationMinutes) || 0;

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

            if (!found) {
                setRemainingTime("0:00");
            }

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

                    const videoMuted =
                        typeof p?.isVideoMuted === "boolean"
                            ? p.isVideoMuted
                            : typeof p?.videoMuted === "boolean"
                                ? p.videoMuted
                                : undefined;

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

            if (merged.length > 0) setParticipantsNow(Math.max(1, merged.length));
        } catch { }
    };

    // refresh list when opening participants tab
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
        const name = p.isLocal ? "You" : (p.displayName || "Guest");
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
            <div
                key={p.id}
                className={`flex items-center justify-between px-3 py-2 rounded-xl transition ${isLight ? "hover:bg-black/5" : "hover:bg-white/5"}`}
            >
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
                            (!audioKnown
                                ? isLight ? "bg-black/5" : "bg-white/5"
                                : p.audioMuted
                                    ? (isLight ? "bg-red-500/10" : "bg-red-500/20")
                                    : (isLight ? "bg-black/5" : "bg-white/5"))
                        }
                        title={!audioKnown ? "Audio status unknown" : p.audioMuted ? "Muted" : "Unmuted"}
                    >
                        <Icon
                            name={audioKnown && p.audioMuted ? "mic-off" : "mic-on"}
                            theme={audioKnown && p.audioMuted ? "dark" : theme}
                            className={`w-4 h-4 ${(audioKnown && p.audioMuted) ? "opacity-90" : "opacity-80"}`}
                        />
                    </div>

                    <div
                        className={
                            "w-8 h-8 rounded-lg flex items-center justify-center " +
                            (!videoKnown
                                ? isLight ? "bg-black/5" : "bg-white/5"
                                : p.videoMuted
                                    ? (isLight ? "bg-red-500/10" : "bg-red-500/20")
                                    : (isLight ? "bg-black/5" : "bg-white/5"))
                        }
                        title={!videoKnown ? "Video status unknown" : p.videoMuted ? "Video off" : "Video on"}
                    >
                        <Icon
                            name={videoKnown && p.videoMuted ? "camera-off" : "camera-on"}
                            theme={theme}
                            className={`w-4 h-4 ${(videoKnown && p.videoMuted) ? "opacity-90" : "opacity-80"}`}
                        />
                    </div>
                </div>
            </div>
        );
    };

    // ============================================
    // ✅ Reactions via Supabase realtime broadcast
    // ============================================
    const reactionsChannelRef = useRef<any>(null);
    const reactionsSubscribedRef = useRef<boolean>(false);
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

        // ✅ IMPORTANT: correct realtime channel config
        const ch = supabase.channel(key, {
            config: {
                broadcast: { ack: true, self: false },
                presence: { key: currentUserId },
            },
        });

        reactionsChannelRef.current = ch;
        reactionsSubscribedRef.current = false;

        ch.on("broadcast", { event: "reaction" }, async (msg: any) => {
            try {
                // ✅ Supabase sends { event, payload }. Some apps accidentally wrap -> payload.payload
                const raw = msg?.payload;
                const p = raw && typeof raw === "object" && "payload" in raw ? (raw as any).payload : raw;

                const fromUserId = String(p?.user_id || "");
                const type = String(p?.type || "") as ReactionType;

                const sid = String(p?.session_id || "");
                if (sid && sid !== sessionId) return;

                if (!fromUserId || !type) return;
                if (fromUserId === currentUserId) return;

                const fromName = await resolveProfileName(fromUserId);

                pushReaction({
                    type,
                    fromUserId,
                    fromName,
                });
            } catch (e) {
                console.log("[reactions] handler error", e);
            }
        });

        ch.subscribe((status: any) => {
            console.log("[reactions] subscribe status:", status, "channel:", key);
            reactionsSubscribedRef.current = String(status).toUpperCase() === "SUBSCRIBED";
        });

        return () => {
            try {
                supabase.removeChannel(ch);
            } catch { }
            reactionsChannelRef.current = null;
            reactionsSubscribedRef.current = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authStatus, sessionId, currentUserId]);

    const sendReaction = async (type: ReactionType) => {
        if (!currentUserId || !sessionId) return;

        const fromName = userName || "You";
        pushReaction({ type, fromUserId: currentUserId, fromName });

        try {
            const ch = reactionsChannelRef.current;
            if (!ch) {
                console.log("[reactions] no channel");
                return;
            }
            if (!reactionsSubscribedRef.current) {
                console.log("[reactions] channel not SUBSCRIBED yet (will still try send)");
            }

            const res = await ch.send({
                type: "broadcast",
                event: "reaction",
                payload: {
                    session_id: sessionId,
                    user_id: currentUserId,
                    type,
                    ts: Date.now(),
                },
            });

            console.log("[reactions] send result:", res);
        } catch (e) {
            console.log("[reactions] send error:", e);
        }
    };

    // reaction menu
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

    // ============================================
    // JITSI INIT + capacity enforcement
    // ============================================
    useEffect(() => {
        if (authStatus !== "authed") return;

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
            setParticipantRows([]);

            if (participantsPollTimer) {
                window.clearInterval(participantsPollTimer);
                participantsPollTimer = null;
            }
        };

        const leaveToSessions = () => {
            if (destroyed) return;
            destroyed = true;

            clearLeaveRedirectTimer(); // ✅ важно
            void leaveOnce();          // тут ок (это уже “поздно”, события уже пришли)

            cleanup();
            navigate("/sessions", { replace: true });
        };

        const canUseKickCommand = () => {
            const cmds = supportedCmdsRef.current;
            if (!Array.isArray(cmds)) return true;
            return cmds.includes("kickParticipant");
        };

        const getParticipantCount = async (api: any): Promise<number | null> => {
            try {
                const info = api?.getParticipantsInfo?.();
                if (Array.isArray(info)) {
                    const localId = localParticipantIdRef.current;
                    const includesLocal =
                        !!localId && info.some((p: any) => String(p?.participantId || p?.id || "") === String(localId));

                    const local = localJoinedRef.current ? 1 : 0;
                    const base = info.length + (includesLocal ? 0 : local);
                    return Math.max(1, base);
                }
            } catch { }

            try {
                const n = api?.getNumberOfParticipants?.();
                if (Number.isFinite(n) && Number(n) > 0) return Number(n);
            } catch { }

            try {
                const res = await api?.getRoomsInfo?.();
                const rooms = Array.isArray(res) ? res : res?.rooms;
                const main = Array.isArray(rooms) ? rooms.find((r) => r?.isMainRoom) || rooms[0] : null;
                const arr = main?.participants;
                if (Array.isArray(arr)) {
                    return Math.max(1, arr.length + 1);
                }
            } catch { }

            return null;
        };

        const refreshParticipants = async (api: any) => {
            if (destroyed) return;
            const n = await getParticipantCount(api);
            if (n != null && Number.isFinite(n)) setParticipantsNow(n);

            void refreshParticipantsList(api);
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

            if (overLimitHitsRef.current < 2) return;

            capacityTriggeredRef.current = true;
            setCapacityError(`Room is full (max ${maxParticipants}).`);
            console.log("[capacity][self-leave] over limit:", { why, count, maxParticipants });

            window.setTimeout(() => {
                try {
                    api?.executeCommand?.("hangup");
                } catch {
                    leaveToSessions();
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
                console.log("[JITSI][domains]", domainList);

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

                try {
                    if (typeof api?.isAudioMuted === "function") setMutedAudio(!!api.isAudioMuted());
                } catch { }
                try {
                    if (typeof api?.isVideoMuted === "function") setMutedVideo(!!api.isVideoMuted());
                } catch { }

                try {
                    // ✅ In forced mode we do NOT write domain back into DB (so test env won't overwrite prod data)
                    if (!FORCE_JITSI_DOMAIN) {
                        const prev = String(session?.jitsi_domain || "").trim();
                        if (session?.id && domain && prev !== domain) {
                            supabase.from("sessions").update({ jitsi_domain: domain }).eq("id", session.id);
                        }
                    }
                } catch { }

                try {
                    const cmds =
                        api.getSupportedCommands?.() ||
                        api.getAvailableCommands?.() ||
                        api._getSupportedCommands?.() ||
                        null;

                    const arr = Array.isArray(cmds) ? cmds : null;
                    supportedCmdsRef.current = arr;

                    console.log("[JITSI] supported commands:", arr);
                } catch (e) {
                    console.log("[JITSI] cannot read supported commands", e);
                    supportedCmdsRef.current = null;
                }

                try {
                    api.executeCommand("setTileView", true);
                    setTile(true);
                } catch { }
                try {
                    api.executeCommand("subject", "");
                } catch { }

                console.log("[JITSI] Domain chosen:", domain);

                participantsPollTimer = window.setInterval(() => {
                    if (destroyed) return;
                    void refreshParticipants(api);
                    void selfLeaveIfOverCapacity(api, "poll");
                }, 5000);

                api.addEventListener?.("videoConferenceJoined", async (e: any) => {
                    if (destroyed) return;

                    setApiReady(true);
                    localJoinedRef.current = true;
                    localParticipantIdRef.current = String(e?.id || "") || null;

                    // ✅ отметиться в session_attendance
                    await attendanceJoin();
                    startAttendanceHeartbeat();

                    // ✅ Ensure local user is muted on join (fallback, in case config is ignored)
                    try {
                        const currentlyMuted =
                            typeof api?.isAudioMuted === "function" ? !!api.isAudioMuted() : false;

                        if (!currentlyMuted) {
                            api.executeCommand?.("toggleAudio"); // will mute
                            setMutedAudio(true);
                        }
                    } catch { }

                    try {
                        api.executeCommand("setTileView", true);
                        setTile(true);
                    } catch { }

                    try {
                        api.executeCommand("subject", "");
                    } catch { }

                    window.setTimeout(() => void refreshParticipants(api), 250);

                    await scheduleSelfChecks(api, "videoConferenceJoined");
                });

                api.addEventListener?.("readyToClose", () => {
                    if (destroyed) return;
                    setApiReady(false);
                    leaveToSessions();
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
                    window.setTimeout(() => void refreshParticipants(api), 350);

                    if (isHost && joinedId) {
                        void hostKickIfOverCapacity(api, joinedId, "participantJoined");
                    } else {
                        void scheduleSelfChecks(api, "participantJoined");
                    }
                });

                api.addEventListener?.("participantLeft", () => {
                    if (destroyed) return;
                    window.setTimeout(() => void refreshParticipants(api), 350);
                    overLimitHitsRef.current = 0;
                    if (capacityTriggeredRef.current) {
                        setCapacityError(null);
                        capacityTriggeredRef.current = false;
                    }
                });

                api.addEventListener?.("displayNameChange", () => {
                    if (destroyed) return;
                    window.setTimeout(() => void refreshParticipants(api), 250);
                });

                api.addEventListener?.("audioMuteStatusChanged", (e: any) => {
                    if (destroyed) return;
                    setMutedAudio(!!e?.muted);
                    window.setTimeout(() => {
                        const a = apiRef.current;
                        if (a) void refreshParticipantsList(a);
                    }, 0);
                });

                api.addEventListener?.("videoMuteStatusChanged", (e: any) => {
                    if (destroyed) return;
                    setMutedVideo(!!e?.muted);
                    window.setTimeout(() => {
                        const a = apiRef.current;
                        if (a) void refreshParticipantsList(a);
                    }, 0);
                });

                api.addEventListener?.("participantMuteStatusChanged", (e: any) => {
                    try {
                        const pid = String(e?.id || "");
                        const muted = typeof e?.muted === "boolean" ? !!e.muted : undefined;
                        if (!pid || typeof muted !== "boolean") return;

                        setParticipantRows((prev) => prev.map((p) => (p.id === pid ? { ...p, audioMuted: muted } : p)));
                    } catch { }
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
            stopWelcomeLoop();
            setApiReady(false);
            try {
                apiRef.current?.dispose?.();
            } catch { }
            apiRef.current = null;
            supportedCmdsRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authStatus, session, idOrSlug, userName, roomName, navigate, jitsiKey, maxParticipants, isHost]);

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

    const hangup = async () => {
        // 0) защита от двойного клика
        if (leavingUiRef.current) return;
        leavingUiRef.current = true;

        const api = apiRef.current;

        // 1) записать left_at, но НЕ убивать iframe
        await leaveOnce({ dispose: false });

        // 2) страховка: даже если Jitsi не пришлёт события — уйдём на /sessions
        clearLeaveRedirectTimer();
        leaveRedirectTimerRef.current = window.setTimeout(() => {
            try { apiRef.current?.dispose?.(); } catch { }
            apiRef.current = null;
            supportedCmdsRef.current = null;
            navigate("/sessions", { replace: true });
        }, 600);

        // 3) попросить Jitsi выйти
        if (!api) {
            clearLeaveRedirectTimer();
            navigate("/sessions", { replace: true });
            return;
        }

        try {
            api.executeCommand("hangup");
        } catch {
            clearLeaveRedirectTimer();
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
    if (authStatus === "checking") {
        return <div className={`flex h-screen justify-center items-center ${pageBg}`}>Checking login…</div>;
    }

    if (authStatus === "redirecting") {
        return <div className={`flex h-screen justify-center items-center ${pageBg}`}>Redirecting to login…</div>;
    }

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
        <div className={`h-[100dvh] overflow-hidden ${pageBg}`}>
            {/* local CSS to ensure iframe wrapper and injected nodes fill + can be centered */}
            <style>{`
                #jitsi-mount {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                #jitsi-mount > iframe,
                #jitsi-mount iframe,
                #jitsi-mount > div,
                #jitsi-mount div {
                    width: 100% !important;
                    height: 100% !important;
                    max-width: 100% !important;
                    max-height: 100% !important;
                }
            `}</style>

            <div className="w-full px-3 sm:px-5 pt-5 pb-[calc(110px+env(safe-area-inset-bottom))] flex flex-col gap-5 h-full min-h-0 overflow-hidden">
                {/* TOP BAR */}
                <div className={`flex w-full rounded-2xl overflow-hidden ${topBarBg}`}>
                    <div className="flex-1 min-w-0 px-4 sm:px-6 py-4">
                        {/* DESKTOP (sm+) */}
                        <div className="hidden sm:flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <p className={`font-inter font-semibold text-[18px] truncate ${strongText}`}>{session.title}</p>
                                <div className={`mt-1 font-inter text-[13px] ${subtleText}`}>
                                    {participantsLabel}
                                    {isSilentRoom ? <span className="ml-2">• Silent room</span> : null}
                                </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
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

                        {/* MOBILE (<sm) */}
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
                        className={`rounded-2xl overflow-hidden min-h-0 relative ${isLight ? "bg-white/70 border border-black/10" : "bg-[#0B1220]/45 border border-white/5"}`}
                    >
                        {/* ✅ z-0 to ensure overlays win vs injected iframe */}
                        <div
                            id="jitsi-mount"
                            ref={iframeContainerRef}
                            className="w-full h-full min-h-[60vh] relative z-0"
                        />

                        {/* ===== MOBILE CHAT / INTENTIONS OVERLAY (TRUE OVERLAY, NOT INSIDE VIDEO) ===== */}
                        {rightPanelOpen && rightTab && (
                            <div className="lg:hidden fixed inset-0 z-[70] pointer-events-none">
                                {/* backdrop */}
                                <div
                                    className="absolute inset-0 bg-black/40 pointer-events-auto"
                                    onClick={() => openRightTab(null)}
                                />

                                {/* panel */}
                                <div
                                    className={
                                        "absolute left-3 right-3 top-3 " +
                                        "bottom-[calc(84px+env(safe-area-inset-bottom))] " +
                                        "rounded-2xl shadow-2xl overflow-hidden flex flex-col pointer-events-auto " +
                                        (isLight
                                            ? "bg-white/95 border border-black/10"
                                            : "bg-[#0B1220]/90 border border-white/10")
                                    }
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {/* header */}
                                    <div
                                        className={`px-5 py-4 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/10"}`}
                                    >
                                        <div className="font-inter font-semibold">
                                            {rightTab === "participants"
                                                ? "Participants"
                                                : rightTab === "chat"
                                                    ? "Chat"
                                                    : "Intentions"}
                                        </div>
                                        <button
                                            onClick={() => openRightTab(null)}
                                            className={`w-9 h-9 rounded-xl flex items-center justify-center ${isLight ? "bg-black/5 hover:bg-black/10" : "bg-[#111827] hover:bg-[#1f2937]"}`}
                                        >
                                            ✕
                                        </button>
                                    </div>

                                    {/* content */}
                                    <div className="flex-1 min-h-0">
                                        {rightTab === "chat" && sessionId && (
                                            <ChatPanel
                                                sessionId={sessionId}
                                                theme={theme}
                                                showHeader={false}
                                                onBecameVisible={() => markChatRead()}
                                            />
                                        )}

                                        {rightTab === "intentions" && (
                                            <IntentionsPanel theme={theme} sessionId={sessionId} timerText={remainingTime || "--:--"} />
                                        )}

                                        {rightTab === "participants" && (
                                            <div className="p-4 overflow-y-auto">
                                                {filteredParticipants.map((p) => renderParticipantRow(p))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ✅ Floating reactions overlay (BETON z-index) */}
                        {floatingReactions.length > 0 && (
                            <div className="absolute inset-0 z-[999] pointer-events-none flex items-end justify-center pb-10">
                                <div className="flex flex-col gap-2 items-center">
                                    {floatingReactions.slice(-4).map((r) => (
                                        <div
                                            key={r.id}
                                            className={
                                                "rounded-2xl px-4 py-2 shadow-2xl backdrop-blur border " +
                                                (isLight ? "bg-white/80 border-black/10 text-black" : "bg-[#020617]/70 border-white/10 text-white")
                                            }
                                        >
                                            <div className="flex flex-col items-center leading-none">
                                                <div className="text-2xl">{reactionEmoji[r.type]}</div>
                                                <div className={`mt-1 text-[11px] font-inter ${isLight ? "text-black/60" : "text-white/70"}`}>
                                                    {r.fromName}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

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

                    {/* RIGHT PANEL (DESKTOP >=lg only) */}
                    {rightPanelOpen && (
                        <div className={`hidden lg:flex rounded-2xl shadow-lg overflow-hidden min-h-0 h-full flex-col ${panelBg}`}>
                            {/* PARTICIPANTS */}
                            {rightTab === "participants" && (
                                <>
                                    <div className={`px-5 py-4 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"}`}>
                                        <div className="flex items-center gap-2">
                                            <div className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>Participants</div>
                                            <div className={`${isLight ? "text-black/50" : "text-white/55"} text-sm`}>
                                                ({Math.max(0, participantRows.length)})
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => openRightTab(null)}
                                            className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight ? "bg-black/5 hover:bg-black/10 text-black/60" : "bg-[#111827] hover:bg-[#1f2937] text-white/80"}`}
                                            title="Close"
                                        >
                                            ✕
                                        </button>
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

                                    <div className="flex-1 overflow-y-auto px-4 pb-4">
                                        <div className="flex flex-col gap-2">
                                            {filteredParticipants.map((p) => renderParticipantRow(p))}
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* CHAT */}
                            {rightTab === "chat" && (
                                <>
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

                                    <div className="flex-1 min-h-0 p-4">
                                        {sessionId ? (
                                            <div className="h-full min-h-0">
                                                <ChatPanel
                                                    sessionId={sessionId}
                                                    theme={theme}
                                                    showHeader={false}
                                                    onBecameVisible={() => markChatRead()}
                                                />
                                            </div>
                                        ) : null}
                                    </div>
                                </>
                            )}

                            {/* INTENTIONS */}
                            {rightTab === "intentions" && (
                                <>
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

                                    <div className="flex-1 min-h-0">
                                        <IntentionsPanel theme={theme} sessionId={sessionId} timerText={remainingTime || "--:--"} />
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* FIXED BOTTOM CONTROLS */}
            <div className="fixed inset-x-0 bottom-0 z-50">
                <div className="w-full px-3 sm:px-5 pb-[calc(12px+env(safe-area-inset-bottom))]">
                    <div className={`h-[64px] sm:h-[74px] rounded-2xl shadow-2xl backdrop-blur grid grid-cols-[auto,1fr,auto] items-center px-2 sm:px-4 ${bottomBarBg}`}>
                        {/* LEFT GROUP: Participants OR ⋯ menu on <=480 */}
                        <div className="flex items-center gap-2" ref={moreMenuRef}>
                            {/* MOBILE (<=480): dropdown */}
                            <div className="max-[480px]:relative min-[481px]:hidden">
                                <button
                                    onClick={() => setShowMoreMenu((v) => !v)}
                                    className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                    title="Menu"
                                    aria-label="Menu"
                                >
                                    <span className={isLight ? "text-black/70" : "text-white/85"}>⋯</span>
                                </button>

                                {showMoreMenu && (
                                    <div className="absolute bottom-[76px] left-0 z-[60]">
                                        <div
                                            className={
                                                `w-[220px] rounded-2xl shadow-2xl overflow-hidden ` +
                                                (isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10")
                                            }
                                        >
                                            <button
                                                onClick={() => {
                                                    openRightTab("participants");
                                                    setShowMoreMenu(false);
                                                }}
                                                className={
                                                    `w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ` +
                                                    (isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5")
                                                }
                                            >
                                                <ParticipantsSmartIcon theme={theme} className="w-4 h-4 opacity-90" />
                                                <span>Participants</span>
                                            </button>

                                            <button
                                                onClick={() => {
                                                    openRightTab("chat");
                                                    setShowMoreMenu(false);
                                                }}
                                                className={
                                                    `w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ` +
                                                    (isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5")
                                                }
                                            >
                                                <Icon name="chat" theme={theme} className="w-4 h-4 opacity-90" />
                                                <span>Chat</span>
                                            </button>

                                            <button
                                                onClick={() => {
                                                    openRightTab("intentions");
                                                    setShowMoreMenu(false);
                                                }}
                                                className={
                                                    `w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ` +
                                                    (isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5")
                                                }
                                            >
                                                <Icon name="intentions" theme={theme} className="w-4 h-4 opacity-90" />
                                                <span>Intentions</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* >=481: обычная кнопка Participants */}
                            <div className="hidden min-[481px]:flex items-center gap-2">
                                <button
                                    onClick={() => openRightTab("participants")}
                                    className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                    title="Participants"
                                >
                                    <ParticipantsSmartIcon theme={theme} className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        {/* CENTER GROUP: media + reactions + tile */}
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

                            {/* reactions */}
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
                                        {(["fire", "laugh", "clap", "heart", "thumbsUp", "thumbsDown"] as ReactionType[]).map((t) => (
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

                            <button
                                onClick={toggleTile}
                                className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                title={tile ? "Disable tile view" : "Enable tile view"}
                            >
                                <Icon name="tile-view" theme={theme} className="w-5 h-5" />
                            </button>
                        </div>

                        {/* RIGHT GROUP: Chat + Intentions + Leave */}
                        <div className="flex items-center justify-end gap-2 sm:gap-3">
                            {/* Chat with unread badge (hidden on <=480) */}
                            <div className="relative max-[480px]:hidden">
                                <button
                                    onClick={() => openRightTab("chat")}
                                    className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                    title="Chat"
                                >
                                    <Icon name="chat" theme={theme} className="w-5 h-5" />
                                </button>

                                {unreadChat > 0 && !(rightPanelOpen && rightTab === "chat") && (
                                    <div
                                        className={
                                            "absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full " +
                                            "flex items-center justify-center text-[11px] font-bold " +
                                            (isLight ? "bg-red-600 text-white" : "bg-red-500 text-[#061019]")
                                        }
                                        aria-label={`Unread messages: ${unreadChat}`}
                                        title={`${unreadChat} new`}
                                    >
                                        {unreadChat > 9 ? "9+" : unreadChat}
                                    </div>
                                )}
                            </div>

                            <button
                                onClick={() => openRightTab("intentions")}
                                className={`max-[480px]:hidden w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                                title="Intentions"
                            >
                                <Icon name="intentions" theme={theme} className="w-5 h-5" />
                            </button>

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
