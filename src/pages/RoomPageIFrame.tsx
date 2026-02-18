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
// ✅ Ported + fixed (parity with RoomPage):
// - Right panel rendered ONLY ONCE (desktop OR mobile overlay) -> no double-mount flicker
// - Theme propagated to html + body (class + data-theme + color-scheme)
// - Kick layout recalculation on panel toggle (dispatch resize) + ResizeObserver for container
// - Chat unread badge (always-on)
// - Stage sounds (finite + infinite) + welcome loop
// - Attendance join/heartbeat/leave + keepalive leave write (best-effort)
//
// ✅ Refactor:
// - Top bar moved to <RoomTopBar />
// - Bottom controls moved to <VideoControls /> (src/components/VideoControls.tsx)
//
// ✅ Prejoin (NEW):
// - Enable Jitsi prejoin screen
// - Fullscreen iframe until user clicks Join
// - Hide name input + hide internal title via CSS inside iframe (jitsi-custom.css)
// - Overlay our own title during prejoin
//
// ✅ Prejoin Settings FIX (THIS ITERATION):
// - Ensure settings are actually available (TOOLBAR_BUTTONS contains "settings")
// - Provide our own clickable ⚙ Settings overlay in prejoin + in-room
// - Best-effort auto-open settings once during prejoin (toggleSettings)

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

import { IntentionsPanel } from "../components/IntentionsPanel";
import { UserProfileModal } from "../components/UserProfileModal";
import ChatPanel from "../components/ChatPanel";

import RoomTopBar from "../components/RoomTopBar";
import VideoControls, {
    Icon,
    ParticipantsSmartIcon,
    REACTION_EMOJI,
    type ReactionType,
    type RoomTheme,
} from "../components/VideoControls";

type HostProfile = {
    id: string;
    full_name: string;
    avatar_url?: string | null;
    bio?: string | null;
};

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

type RightPanelTab = "participants" | "chat" | "intentions" | null;

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

// Session Studio / builder wrappers
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
    if (phaseNameLower.includes("custom")) return "custom";
    if (phaseNameLower.includes("recap")) return "recap";
    if (phaseNameLower.includes("celebrate") || phaseNameLower.includes("celebration")) return "celebrate";
    if (phaseNameLower.includes("focus")) return "focus";
    if (phaseNameLower.includes("checkin") || phaseNameLower.includes("check-in")) return "checkin";
    if (phaseNameLower.includes("intention")) return "intentions";
    if (phaseNameLower.includes("break") || phaseNameLower.includes("rest")) return "break";
    return "focus";
}

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

// ============================================
// realtime cleanup safe
// ============================================
function safeRemoveRealtimeChannel(ch: any) {
    if (!ch) return;

    try {
        if (typeof ch.unsubscribe === "function") {
            void ch.unsubscribe();
            return;
        }
    } catch { }

    const sb: any = supabase as any;

    try {
        if (typeof sb.removeChannel === "function") {
            void sb.removeChannel(ch);
            return;
        }
    } catch { }

    try {
        if (typeof sb.removeSubscription === "function") {
            void sb.removeSubscription(ch);
            return;
        }
    } catch { }

    try {
        if (sb.realtime && typeof sb.realtime.removeChannel === "function") {
            void sb.realtime.removeChannel(ch);
            return;
        }
    } catch { }
}

// ===============================
// JITSI DOMAINS (PRIMARY + FALLBACK) + TEST OVERRIDE
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

// ✅ FIX: settings must exist in interface toolbar config, иначе в prejoin оно просто “некуда” рисоваться.
const TOOLBAR_VISIBLE_BUTTONS: string[] = ["settings"];

const JITSI_CUSTOM_CSS_PATH = "/jitsi-custom.css";

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
const ATT_HEARTBEAT_MS = 10_000;
const ONLINE_WINDOW_MS = 35_000;

// ====== adaptive video quality ======
// 1–2 => 720p, 3–4 => 480p, 5+ => 360p
function pickTargetVideoHeight(participantsTotal: number) {
    const n = Math.max(1, Math.floor(Number(participantsTotal || 1)));
    if (n <= 2) return 720;
    if (n <= 4) return 480;
    return 360;
}

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
    subject?: string;
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

                    // ✅ enable standard Jitsi prejoin screen (more keys for compatibility)
                    prejoinPageEnabled: true,
                    prejoinConfig: { enabled: true },
                    // legacy / best-effort flags (ignored if unknown)
                    enablePrejoinPage: true as any,

                    requireDisplayName: false,
                    readOnlyName: true,

                    disableDeepLinking: true,
                    disableInviteFunctions: true,

                    startWithAudioMuted: true,
                    startWithVideoMuted: false,

                    startWithTileView: true,

                    filmStripOnly: false,
                    disableFilmstrip: true,

                    // ✅ propagate pretty title into Jitsi (prejoin/meeting subject)
                    subject: String(args.subject || ""),
                    hideConferenceSubject: true,
                    hideConferenceTimer: true,
                    conferenceInfo: { alwaysVisible: [], autoHide: [] },

                    // ⚠️ kept (harmless even if ignored in some builds)
                    toolbarButtons: TOOLBAR_MOUNT_BUTTONS,

                    // ✅ allow high quality by default (we still adapt at runtime)
                    resolution: 720,
                    constraints: {
                        video: {
                            height: { ideal: 720, max: 720, min: 180 },
                        },
                    },
                    enableLayerSuspension: true,
                    disableSimulcast: false,

                    ...(cssUrl ? { customCssUrl: cssUrl } : {}),
                },

                interfaceConfigOverwrite: {
                    // ✅ FIX: settings exists
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

            // best-effort: set subject again (some builds apply after init)
            try {
                if (args.subject) api.executeCommand?.("subject", String(args.subject));
            } catch { }

            try {
                api.executeCommand?.("displayName", args.userName);
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
            // @ts-ignore
            mql.addListener(onChange);
            // @ts-ignore
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
    const [selectedUser, setSelectedUser] = useState<HostProfile | null>(null);

    const sessionId = useMemo(() => String(session?.id || ""), [session?.id]);
    const sessionTitle = useMemo(() => String(session?.title || "Session"), [session?.title]);

    // auth gate
    const [authStatus, setAuthStatus] = useState<"checking" | "authed" | "redirecting">("checking");
    const [userName, setUserName] = useState<string>("");
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const accessTokenRef = useRef<string>("");

    // theme
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

    // ✅ propagate theme to html+body (parity with RoomPage)
    useEffect(() => {
        try {
            const root = document.documentElement;
            const body = document.body;
            const isDark = theme === "dark";

            root.classList.toggle("dark", isDark);
            body.classList.toggle("dark", isDark);

            root.setAttribute("data-theme", theme);
            body.setAttribute("data-theme", theme);

            (root.style as any).colorScheme = theme;
            (body.style as any).colorScheme = theme;
        } catch { }
    }, [theme]);

    const isLgUp = useMediaQuery("(min-width: 1024px)");

    // stages
    const [stages, setStages] = useState<Stage[]>([]);
    const [, setHoveredStage] = useState<Stage | null>(null);
    const [currentStage, setCurrentStage] = useState(0);
    const [remainingTime, setRemainingTime] = useState<string>("");

    const [stagebarStartTime, setStagebarStartTime] = useState<string>("");
    const [stagebarCycleSeconds, setStagebarCycleSeconds] = useState<number | undefined>(undefined);

    const [lastErr, setLastErr] = useState<string>("");

    // capacity enforcement
    const [capacityError, setCapacityError] = useState<string | null>(null);
    const capacityTriggeredRef = useRef(false);
    const localJoinedRef = useRef(false);
    const localParticipantIdRef = useRef<string | null>(null);
    const kickedIdsRef = useRef<Set<string>>(new Set());
    const localIsModeratorRef = useRef<boolean>(false);

    // iframe state
    const [tile, setTile] = useState(true);
    const [mutedAudio, setMutedAudio] = useState(true); // startWithAudioMuted
    const [mutedVideo, setMutedVideo] = useState(false);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [apiReady, setApiReady] = useState(false);

    // ✅ prejoin fullscreen mode until user actually joins conference
    const [inPrejoin, setInPrejoin] = useState(true);

    // ✅ prejoin settings auto-open once (best-effort)
    const prejoinSettingsAutoOpenedRef = useRef(false);

    // ✅ tile view enforcement (startup only)
    const tileRef = useRef<boolean>(true);
    const tileEventSeenRef = useRef<boolean>(false);
    const tileEnforcedOnceRef = useRef<boolean>(false);

    useEffect(() => {
        tileRef.current = tile;
    }, [tile]);

    const forceTileViewOnAfterJoin = (api?: any) => {
        const a = api || apiRef.current;
        if (!a) return;
        if (tileEnforcedOnceRef.current) return;

        tileEnforcedOnceRef.current = true;

        const trySet = () => {
            try {
                a.executeCommand?.("setTileView", true);
            } catch { }
        };

        trySet();
        window.setTimeout(trySet, 180);
        window.setTimeout(trySet, 520);
        window.setTimeout(trySet, 1100);
    };

    // live participant count
    const [participantsNow, setParticipantsNow] = useState<number>(0);

    // online users (attendance)
    const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);

    // participants list (from Jitsi)
    const [participantRows, setParticipantRows] = useState<ParticipantRow[]>([]);
    const [participantsSearch, setParticipantsSearch] = useState("");

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

    // ✅ kick resize when panel toggles (parity with RoomPage)
    useEffect(() => {
        const fire = () => {
            try {
                window.dispatchEvent(new Event("resize"));
            } catch { }
        };
        requestAnimationFrame(fire);
        const t1 = window.setTimeout(fire, 60);
        const t2 = window.setTimeout(fire, 220);
        return () => {
            window.clearTimeout(t1);
            window.clearTimeout(t2);
        };
    }, [rightPanelOpen, rightTab]);

    // ✅ ResizeObserver for container changes
    const videoWrapRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const el = videoWrapRef.current;
        if (!el || typeof ResizeObserver === "undefined") return;

        let raf = 0;
        const ro = new ResizeObserver(() => {
            window.cancelAnimationFrame(raf);
            raf = window.requestAnimationFrame(() => {
                try {
                    window.dispatchEvent(new Event("resize"));
                } catch { }
            });
        });
        ro.observe(el);

        return () => {
            window.cancelAnimationFrame(raf);
            ro.disconnect();
        };
    }, []);

    // Escape closes panels/popovers
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setRightPanelOpen(false);
                setRightTab(null);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // =========================
    // CHAT UNREAD BADGE (always-on)
    // =========================
    const CHAT_MSG_TABLE = "session_chat_messages";

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
            safeRemoveRealtimeChannel(ch);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authStatus, sessionId, currentUserId, chatReadKey]);

    // =========================
    // reactions via broadcast
    // =========================
    const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
    const reactionIdRef = useRef<number>(0);
    const reactionsChannelRef = useRef<any>(null);

    useEffect(() => {
        if (authStatus !== "authed") return;
        if (!sessionId) return;
        if (!currentUserId) return;

        const ch = supabase
            .channel(`reactions:${sessionId}`, {
                config: { broadcast: { self: false }, presence: { key: currentUserId } },
            })
            .on("broadcast", { event: "reaction" }, (payload: any) => {
                const p = payload?.payload || payload;
                const t = String(p?.type || "") as ReactionType;
                const fromUserId = String(p?.fromUserId || "");
                const fromName = String(p?.fromName || "User");

                if (!t || !REACTION_EMOJI[t]) return;
                const id = reactionIdRef.current + 1;
                reactionIdRef.current = id;

                setFloatingReactions((prev) => [...prev, { id, type: t, fromUserId, fromName }]);
                window.setTimeout(() => {
                    setFloatingReactions((prev) => prev.filter((r) => r.id !== id));
                }, 1500);
            })
            .subscribe();

        reactionsChannelRef.current = ch;

        return () => {
            reactionsChannelRef.current = null;
            safeRemoveRealtimeChannel(ch);
        };
    }, [authStatus, sessionId, currentUserId]);

    const sendReaction = (type: ReactionType) => {
        try {
            if (!sessionId || !currentUserId) return;
            const ch = reactionsChannelRef.current;
            if (!ch) return;

            void ch.send({
                type: "broadcast",
                event: "reaction",
                payload: {
                    type,
                    fromUserId: currentUserId,
                    fromName: userName || "User",
                    at: Date.now(),
                },
            });
        } catch { }
    };

    // =========================
    // auth gate
    // =========================
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

                try {
                    const { data: sd } = await supabase.auth.getSession();
                    accessTokenRef.current = String(sd.session?.access_token || "");
                } catch {
                    accessTokenRef.current = "";
                }

                let name = "";

                // 1) ✅ ПЕРВЫМ делом пробуем profiles.full_name
                if (u?.id) {
                    try {
                        const { data: p } = await supabase.from("profiles").select("full_name").eq("id", u.id).single();
                        name = String(p?.full_name || "").trim();
                    } catch { }
                }

                // 2) fallback: user_metadata
                if (!name) {
                    name =
                        String((u as any)?.user_metadata?.full_name || "").trim() ||
                        String((u as any)?.user_metadata?.name || "").trim();
                }

                // 3) fallback: email
                if (!name) {
                    name = u?.email ? String(u.email.split("@")[0] || "").trim() : "";
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

    const isHost = useMemo(() => {
        const sid = String(session?.host_id || "");
        return !!currentUserId && !!sid && currentUserId === sid;
    }, [currentUserId, session?.host_id]);

    // max participants
    const maxParticipants = useMemo(() => {
        const n = Number(session?.max_participants);
        if (Number.isFinite(n) && n >= MIN_PARTICIPANTS) {
            return Math.max(MIN_PARTICIPANTS, Math.min(MAX_PARTICIPANTS, Math.floor(n)));
        }
        return DEFAULT_MAX_PARTICIPANTS;
    }, [session]);

    // Room name
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
                                    if (lower.includes("outro") || lower.includes("wrap") || lower.includes("farewell") || lower.includes("end"))
                                        return "outro";
                                    if (lower.includes("focus")) return "focus";
                                    return "focus";
                                };

                                const type: Stage["type"] =
                                    rawType && rawType !== "stage" && rawType !== "block"
                                        ? inferTypeFromText(rawType)
                                        : inferTypeFromText(labelLower);

                                const secondsExplicit =
                                    Number(b?.seconds) ||
                                    Number(b?.duration_seconds) ||
                                    Number(b?.durationSeconds) ||
                                    Number(b?.duration_sec) ||
                                    0;

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
            const diffSec =
                loopSeconds > 0 && isInfiniteRoom ? ((diffSecRaw % loopSeconds) + loopSeconds) % loopSeconds : diffSecRaw;

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

        try {
            const { error } = await supabase.rpc("attendance_join", { p_session_id: sessionId });
            if (!error) return;
        } catch { }

        try {
            await supabase
                .from("session_attendance")
                .upsert(
                    { session_id: sessionId, user_id: currentUserId, joined_at: nowIso, left_at: null, last_seen_at: nowIso },
                    { onConflict: "session_id,user_id" }
                );
        } catch { }
    };

    const attendanceHeartbeat = async () => {
        if (!sessionId || !currentUserId) return;
        const nowIso = new Date().toISOString();

        try {
            const { error } = await supabase.rpc("attendance_heartbeat", { p_session_id: sessionId });
            if (!error) return;
        } catch { }

        try {
            await supabase
                .from("session_attendance")
                .update({ last_seen_at: nowIso, left_at: null })
                .eq("session_id", sessionId)
                .eq("user_id", currentUserId);
        } catch { }
    };

    const attendanceLeave = async () => {
        stopAttendanceHeartbeat();
        if (!sessionId || !currentUserId) return;
        const nowIso = new Date().toISOString();

        try {
            const { error } = await supabase.rpc("attendance_leave", { p_session_id: sessionId });
            if (!error) return;
        } catch { }

        try {
            await supabase
                .from("session_attendance")
                .update({ left_at: nowIso, last_seen_at: nowIso })
                .eq("session_id", sessionId)
                .eq("user_id", currentUserId);
        } catch { }
    };

    const keepaliveLeaveWrite = () => {
        try {
            if (!sessionId || !currentUserId) return;
            const supabaseUrl = String((import.meta as any).env.VITE_SUPABASE_URL || "").trim();
            const anonKey = String((import.meta as any).env.VITE_SUPABASE_ANON_KEY || "").trim();
            const token = String(accessTokenRef.current || "");
            if (!supabaseUrl || !anonKey || !token) return;

            const nowIso = new Date().toISOString();
            const url = `${supabaseUrl}/rest/v1/session_attendance?session_id=eq.${encodeURIComponent(sessionId)}&user_id=eq.${encodeURIComponent(currentUserId)}`;

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

    useEffect(() => {
        const onBeforeUnload = () => {
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

    useEffect(() => {
        return () => {
            void leaveOnce({ dispose: true, keepalive: false });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ============================================
    // Live online users from session_attendance
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
            const { data, error } = await supabase
                .from("session_attendance")
                .select("user_id,last_seen_at,left_at,profiles(full_name,avatar_url)")
                .eq("session_id", sessionId);

            if (error) throw error;

            const online = computeOnline(Array.isArray(data) ? data : []);
            setOnlineUsers(online);

            if (online.length > 0) setParticipantsNow(online.length);
            else {
                const fallbackCount = participantRows?.length || 0;
                if (fallbackCount > 0) setParticipantsNow(fallbackCount);
            }
        } catch { }
    };

    useEffect(() => {
        if (authStatus !== "authed") return;
        if (!sessionId) return;
        if (!currentUserId) return;

        void fetchOnlineUsers(true);

        const ch = supabase
            .channel(`attendance-live:${sessionId}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "session_attendance", filter: `session_id=eq.${sessionId}` }, () => {
                void fetchOnlineUsers(false);
            })
            .subscribe();

        return () => {
            if (attendanceFetchTimerRef.current) {
                window.clearTimeout(attendanceFetchTimerRef.current);
                attendanceFetchTimerRef.current = null;
            }
            safeRemoveRealtimeChannel(ch);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authStatus, sessionId, currentUserId]);

    // ============================================
    // Jitsi lifecycle
    // ============================================
    const [jitsiKey, setJitsiKey] = useState(0);

    // ✅ adaptive video quality state
    const lastAppliedVideoHeightRef = useRef<number>(0);
    const videoQualityTimerRef = useRef<number | null>(null);

    const clearVideoQualityTimer = () => {
        if (videoQualityTimerRef.current) {
            window.clearTimeout(videoQualityTimerRef.current);
            videoQualityTimerRef.current = null;
        }
    };

    const applyAdaptiveVideoQualityNow = (api: any, participantsTotal: number) => {
        if (!api) return;

        const target = pickTargetVideoHeight(participantsTotal);

        if (lastAppliedVideoHeightRef.current === target) return;
        lastAppliedVideoHeightRef.current = target;

        const cmds = supportedCmdsRef.current;
        const supports = (c: string) => !cmds || cmds.includes(c);

        if (supports("setReceiverConstraints")) {
            try {
                api.executeCommand?.("setReceiverConstraints", { constraints: { maxHeight: target } });
                return;
            } catch { }
            try {
                api.executeCommand?.("setReceiverConstraints", { maxHeight: target });
                return;
            } catch { }
        }

        try {
            if (supports("setVideoQuality")) api.executeCommand?.("setVideoQuality", target);
            else api.executeCommand?.("setVideoQuality", target);
            return;
        } catch { }

        try {
            if (supports("setVideoResolution")) api.executeCommand?.("setVideoResolution", target);
        } catch { }
    };

    const scheduleAdaptiveVideoQuality = (api: any, participantsTotal: number, immediate = false) => {
        if (!api) return;

        const run = () => {
            if (!apiRef.current || apiRef.current !== api) return;
            applyAdaptiveVideoQualityNow(api, participantsTotal);
        };

        if (immediate) {
            clearVideoQualityTimer();
            run();
            return;
        }

        clearVideoQualityTimer();
        videoQualityTimerRef.current = window.setTimeout(() => {
            videoQualityTimerRef.current = null;
            run();
        }, 450);
    };

    // ✅ our command helper (supports list can be null)
    const supportsCmd = (cmd: string) => {
        const list = supportedCmdsRef.current;
        return !list || list.includes(cmd);
    };

    const openJitsiSettings = () => {
        const api = apiRef.current;
        if (!api) return;
        try {
            // Most builds support this
            if (supportsCmd("toggleSettings")) api.executeCommand?.("toggleSettings");
            else api.executeCommand?.("toggleSettings");
        } catch { }
    };

    const forceReloadJitsi = () => {
        try {
            apiRef.current?.dispose?.();
        } catch { }
        apiRef.current = null;
        supportedCmdsRef.current = null;
        setApiReady(false);
        setInPrejoin(true);
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

        setMutedAudio(true);
        setMutedVideo(false);
        setIsScreenSharing(false);
        setTile(true);

        tileEventSeenRef.current = false;
        tileEnforcedOnceRef.current = false;

        clearVideoQualityTimer();
        lastAppliedVideoHeightRef.current = 0;

        // ✅ reset prejoin auto-open
        prejoinSettingsAutoOpenedRef.current = false;

        setJitsiKey((x) => x + 1);
    };

    const maybeKickOrRejectIfOverLimit = async (api: any, joinedParticipantId?: string) => {
        try {
            if (!api) return;
            if (capacityTriggeredRef.current) return;

            const remote = Array.isArray(api.getParticipantsInfo?.()) ? api.getParticipantsInfo() : [];
            const count = 1 + remote.length;

            setParticipantsNow((prev) => (prev > 0 ? prev : count));

            if (count <= maxParticipants) return;

            capacityTriggeredRef.current = true;

            if (isHost || localIsModeratorRef.current) {
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

            setCapacityError(`Room is full (${maxParticipants}). Redirecting…`);
            try {
                api.executeCommand?.("hangup");
            } catch { }
            await leaveOnce({ dispose: true, keepalive: true });
            navigate("/sessions", { replace: true });
        } catch { }
    };

    // Participants list from Jitsi
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

            const totalInRoom = merged.length;

            setParticipantsNow((prev) => (onlineUsers.length > 0 ? onlineUsers.length : Math.max(prev || 0, totalInRoom)));

            scheduleAdaptiveVideoQuality(api, totalInRoom, false);
        } catch { }
    };

    useEffect(() => {
        if (!(rightPanelOpen && rightTab === "participants")) return;
        const api = apiRef.current;
        if (!api) return;
        void refreshParticipantsList(api);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rightPanelOpen, rightTab, apiReady, mutedAudio, mutedVideo]);

    const filteredParticipants = useMemo(() => {
        const q = participantsSearch.trim().toLowerCase();
        const base = participantRows || [];
        if (!q) return base;
        return base.filter((p) => (p.isLocal ? "you" : p.displayName || "guest").toLowerCase().includes(q));
    }, [participantRows, participantsSearch]);

    // create API when authed + session ready
    useEffect(() => {
        if (authStatus !== "authed") return;
        if (!session) return;
        if (!iframeContainerRef.current) return;
        if (!userName) return;

        let cancelled = false;

        (async () => {
            try {
                setLastErr("");
                setApiReady(false);
                setInPrejoin(true);

                // ✅ reset prejoin auto-open per init
                prejoinSettingsAutoOpenedRef.current = false;

                tileEventSeenRef.current = false;
                tileEnforcedOnceRef.current = false;

                clearVideoQualityTimer();
                lastAppliedVideoHeightRef.current = 0;

                const parent = iframeContainerRef.current!;
                const domains = domainsForSession(session);

                const { api } = await createJitsiApiWithFallback({
                    domains,
                    roomName,
                    parentNode: parent,
                    userName,
                    subject: sessionTitle,
                    cssPathOnJitsiDomain: JITSI_CUSTOM_CSS_PATH,
                });

                if (cancelled) {
                    try {
                        api.dispose?.();
                    } catch { }
                    return;
                }

                apiRef.current = api;

                try {
                    const cmds = api.getSupportedCommands?.();
                    supportedCmdsRef.current = Array.isArray(cmds) ? cmds : null;
                } catch {
                    supportedCmdsRef.current = null;
                }

                // ✅ best-effort: open Settings on prejoin once (so “prejoin настройки” точно всплывают)
                window.setTimeout(() => {
                    if (cancelled) return;
                    if (localJoinedRef.current) return;
                    if (prejoinSettingsAutoOpenedRef.current) return;
                    prejoinSettingsAutoOpenedRef.current = true;
                    try {
                        api.executeCommand?.("toggleSettings");
                    } catch { }
                }, 700);

                const onJoined = (e: any) => {
                    localJoinedRef.current = true;

                    const pid = String(e?.id || e?.participantId || e?.roomName || "");
                    if (pid) localParticipantIdRef.current = pid;

                    // ✅ once joined => exit fullscreen prejoin
                    setInPrejoin(false);
                    setApiReady(true);

                    try {
                        api.executeCommand?.("displayName", userName);
                    } catch { }

                    window.setTimeout(() => {
                        try {
                            api.executeCommand?.("displayName", userName);
                        } catch { }
                    }, 250);

                    window.setTimeout(() => {
                        try {
                            api.executeCommand?.("displayName", userName);
                        } catch { }
                    }, 900);

                    void attendanceJoin();
                    startAttendanceHeartbeat();

                    void refreshParticipantsList(api);

                    void maybeKickOrRejectIfOverLimit(api, undefined);

                    forceTileViewOnAfterJoin(api);

                    const initialTotal = 1 + (Array.isArray(api.getParticipantsInfo?.()) ? api.getParticipantsInfo().length : 0);
                    scheduleAdaptiveVideoQuality(api, initialTotal, true);
                };

                const onParticipantJoined = (e: any) => {
                    const pid = String(e?.id || e?.participantId || "");
                    void maybeKickOrRejectIfOverLimit(api, pid);
                    void refreshParticipantsList(api);
                };

                const onParticipantLeft = () => {
                    capacityTriggeredRef.current = false;
                    void refreshParticipantsList(api);
                };

                const onAudioMute = (e: any) => {
                    setMutedAudio(!!e?.muted);
                    void refreshParticipantsList(api);
                };

                const onVideoMute = (e: any) => {
                    setMutedVideo(!!e?.muted);
                    void refreshParticipantsList(api);
                };

                const onScreenShare = (e: any) => {
                    const v = typeof e?.on === "boolean" ? e.on : typeof e?.sharing === "boolean" ? e.sharing : false;
                    setIsScreenSharing(!!v);
                };

                const onTile = (e: any) => {
                    tileEventSeenRef.current = true;
                    const v = typeof e?.enabled === "boolean" ? e.enabled : typeof e?.on === "boolean" ? e.on : true;
                    setTile(!!v);
                };

                const onRole = (e: any) => {
                    const pid = String(e?.id || e?.participantId || "");
                    const role = String(e?.role || "");
                    if (!pid) return;
                    if (localParticipantIdRef.current && pid === localParticipantIdRef.current) {
                        localIsModeratorRef.current = role === "moderator";
                    }
                };

                const onReadyToClose = async () => {
                    await leaveOnce({ dispose: true, keepalive: true });
                    navigate("/sessions", { replace: true });
                };

                api.addEventListener?.("videoConferenceJoined", onJoined);
                api.addEventListener?.("participantJoined", onParticipantJoined);
                api.addEventListener?.("participantLeft", onParticipantLeft);
                api.addEventListener?.("audioMuteStatusChanged", onAudioMute);
                api.addEventListener?.("videoMuteStatusChanged", onVideoMute);
                api.addEventListener?.("screenSharingStatusChanged", onScreenShare);
                api.addEventListener?.("tileViewChanged", onTile);
                api.addEventListener?.("participantRoleChanged", onRole);
                api.addEventListener?.("readyToClose", onReadyToClose);

                void refreshParticipantsList(api);

                window.setTimeout(() => {
                    const total = 1 + (Array.isArray(api.getParticipantsInfo?.()) ? api.getParticipantsInfo().length : 0);
                    scheduleAdaptiveVideoQuality(api, total, true);
                }, 900);
            } catch (e: any) {
                console.log("Jitsi create error:", e);
                setLastErr(String(e?.message || e || "Failed to load Jitsi"));
                setApiReady(false);
                setInPrejoin(true);
            }
        })();

        return () => {
            cancelled = true;
            try {
                apiRef.current?.dispose?.();
            } catch { }
            apiRef.current = null;
            supportedCmdsRef.current = null;
            setApiReady(false);
            setInPrejoin(true);
            stopAttendanceHeartbeat();

            clearVideoQualityTimer();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authStatus, sessionId, jitsiKey, roomName, sessionTitle]);

    // ============================================
    // UI actions
    // ============================================
    const exec = (cmd: string, ...args: any[]) => {
        const api = apiRef.current;
        if (!api) return;
        try {
            api.executeCommand?.(cmd, ...args);
        } catch { }
    };

    const handleToggleAudio = () => exec("toggleAudio");
    const handleToggleVideo = () => exec("toggleVideo");
    const handleToggleScreenShare = () => exec("toggleShareScreen");
    const handleToggleTile = () => exec("toggleTileView");

    const handleLeave = async () => {
        try {
            exec("hangup");
        } catch { }
        await leaveOnce({ dispose: true, keepalive: true });
        navigate("/sessions", { replace: true });
    };

    const copyInviteLink = async () => {
        try {
            const url = window.location.href;
            await navigator.clipboard.writeText(url);
            setCapacityError("Link copied ✅");
            window.setTimeout(() => setCapacityError(null), 1300);
        } catch {
            setCapacityError("Could not copy link");
            window.setTimeout(() => setCapacityError(null), 1200);
        }
    };

    // ============================================
    // Page states
    // ============================================
    const pageBg = isLight ? "bg-[#F6F7FB] text-[#0B1220]" : "bg-[#050F1A] text-white";
    const panelBg = isLight ? "bg-white/85 border border-black/10" : "bg-[#0B1220]/55 border border-white/5";

    const participantsCount = participantsNow || onlineUsers.length || participantRows.length || 0;

    const ChatPanelAny = ChatPanel as any;

    // ✅ Prejoin UI is active while we haven't joined yet
    const isPrejoinUi = inPrejoin && !apiReady;

    const RightPanelBody = (
        <div
            className={[
                "rounded-2xl shadow-lg overflow-hidden min-h-0 h-full flex flex-col",
                panelBg,
                theme === "dark" ? "dark" : "",
            ].join(" ")}
            data-theme={theme}
            style={{ colorScheme: theme }}
        >
            {/* ... (без изменений ниже, твой RightPanelBody полностью сохранён) */}
            {rightTab === "participants" && (
                <div className="h-full min-h-0 flex flex-col">
                    <div className={`px-5 py-4 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"}`}>
                        <div className="flex items-center gap-2 min-w-0">
                            <span className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold truncate`}>Participants</span>
                            <span className={`${isLight ? "text-black/50" : "text-white/55"} text-sm`}>({participantsCount})</span>
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
                        <div className={`rounded-xl px-3 py-2 ${isLight ? "bg-black/5 border border-black/10" : "bg-[#0B1220]/70 border border-white/10"}`}>
                            <input
                                value={participantsSearch}
                                onChange={(e) => setParticipantsSearch(e.target.value)}
                                placeholder="Search participants..."
                                className={`w-full bg-transparent outline-none text-[13px] placeholder:opacity-60 ${isLight ? "text-black/80 placeholder:text-black/40" : "text-white/85 placeholder:text-white/35"
                                    }`}
                            />
                        </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
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
                                        key={p.id}
                                        className={`flex items-center justify-between px-3 py-2 rounded-xl transition ${isLight ? "hover:bg-black/5" : "hover:bg-white/5"}`}
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div
                                                className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${isLight ? "bg-blue-500/15 text-blue-700" : "bg-emerald-500/80 text-[#02140B]"
                                                    }`}
                                            >
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
                                                    (p.audioMuted ? (isLight ? "bg-red-500/10" : "bg-red-500/20") : isLight ? "bg-black/5" : "bg-white/5")
                                                }
                                                title={p.audioMuted ? "Muted" : "Unmuted"}
                                            >
                                                <Icon name={p.audioMuted ? "mic-off" : "mic-on"} theme={theme} className={`w-4 h-4 ${p.audioMuted ? "opacity-90" : "opacity-80"}`} />
                                            </div>

                                            <div
                                                className={
                                                    "w-8 h-8 rounded-lg flex items-center justify-center " +
                                                    (p.videoMuted ? (isLight ? "bg-red-500/10" : "bg-red-500/20") : isLight ? "bg-black/5" : "bg-white/5")
                                                }
                                                title={p.videoMuted ? "Video off" : "Video on"}
                                            >
                                                <Icon name={p.videoMuted ? "camera-off" : "camera-on"} theme={theme} className={`w-4 h-4 ${p.videoMuted ? "opacity-90" : "opacity-80"}`} />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className={`p-4 border-t ${isLight ? "border-black/10" : "border-white/5"}`}>
                        <button
                            onClick={copyInviteLink}
                            className={`w-full h-12 rounded-xl font-semibold flex items-center justify-center gap-2 ${isLight ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-emerald-500 hover:bg-emerald-600 text-[#02140B]"
                                }`}
                        >
                            <span className="text-lg">⎘</span>
                            <span>Copy invite link</span>
                        </button>
                    </div>
                </div>
            )}

            {rightTab === "chat" && (
                <div className="h-full min-h-0 flex flex-col">
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

                    <div className="flex-1 min-h-0 p-4 overflow-hidden">
                        <div className={`h-full min-h-0 overflow-hidden rounded-xl ${isLight ? "bg-white/70 border border-black/10" : "bg-[#020617]/40 border border-white/10"}`}>
                            <div className="h-full min-h-0 flex flex-col overflow-hidden [&>*]:h-full [&>*]:min-h-0">
                                {sessionId ? (
                                    <div data-theme={theme} style={{ colorScheme: theme }} className={theme === "dark" ? "dark h-full min-h-0" : "h-full min-h-0"}>
                                        <ChatPanelAny
                                            sessionId={sessionId}
                                            theme={theme}
                                            showHeader={false}
                                            title="Chat"
                                            onClose={() => openRightTab(null)}
                                            embedded={true}
                                            hideHeader={true}
                                            authUserId={currentUserId}
                                            displayName={userName}
                                            onAnyMessageSeen={() => markChatRead()}
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
                            className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight ? "bg-black/5 hover:bg-black/10 text-black/60" : "bg-[#111827] hover:bg-[#1f2937] text-white/80"
                                }`}
                            title="Close"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="flex-1 min-h-0 overflow-hidden p-4">
                        <div className={`h-full min-h-0 overflow-hidden rounded-xl ${isLight ? "bg-white/70 border border-black/10" : "bg-[#020617]/40 border border-white/10"}`}>
                            <div className="h-full min-h-0 overflow-y-auto [&>*]:min-h-0">
                                <div data-theme={theme} style={{ colorScheme: theme }} className={theme === "dark" ? "dark h-full min-h-0" : "h-full min-h-0"}>
                                    <IntentionsPanel key={`intentions-${sessionId}-${theme}`} theme={theme} sessionId={sessionId} timerText={remainingTime || "--:--"} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    // ============================================
    // render guards
    // ============================================
    if (authStatus === "redirecting") {
        return <div className={`flex h-screen items-center justify-center ${pageBg}`}>Redirecting…</div>;
    }

    if (authStatus !== "authed") {
        return <div className={`flex h-screen items-center justify-center ${pageBg}`}>Checking auth…</div>;
    }

    if (loading) {
        return <div className={`flex h-screen items-center justify-center ${pageBg}`}>Loading session…</div>;
    }

    if (!session) {
        return (
            <div className={`flex h-screen items-center justify-center ${pageBg}`}>
                <button onClick={() => navigate("/sessions")}>Back</button>
            </div>
        );
    }

    return (
        <div className={`h-[100dvh] overflow-hidden ${pageBg}`}>
            <div
                className={
                    "h-full w-full flex flex-col min-h-0 " +
                    (isPrejoinUi
                        ? "p-0 gap-0"
                        : "px-2 sm:px-3 pt-2 pb-[calc(80px+env(safe-area-inset-bottom))] sm:pb-[calc(90px+env(safe-area-inset-bottom))] gap-2")
                }
            >
                {!isPrejoinUi && (
                    <RoomTopBar
                        theme={theme}
                        sessionTitle={sessionTitle}
                        participantsCount={participantsCount}
                        maxParticipants={maxParticipants}
                        isSilentRoom={isSilentRoom}
                        stages={stages as any}
                        stagebarStartTime={stagebarStartTime}
                        stagebarCycleSeconds={stagebarCycleSeconds}
                        remainingTime={remainingTime}
                        hostProfile={session?.host_profile || null}
                        onHoverStage={setHoveredStage as any}
                        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                        onOpenHostProfile={() => setSelectedUser((session?.host_profile as any) || null)}
                    />
                )}

                <div
                    className={
                        isPrejoinUi
                            ? "fixed inset-0 z-[60] grid grid-rows-1 grid-cols-1"
                            : "relative grid grid-rows-1 gap-2 sm:gap-3 flex-1 min-h-0 h-full " +
                            (rightPanelOpen ? "lg:grid-cols-[minmax(0,1fr),420px]" : "grid-cols-1")
                    }
                >
                    <div
                        ref={videoWrapRef}
                        className={
                            "relative overflow-hidden min-h-0 h-full " +
                            (isPrejoinUi
                                ? (isLight ? "bg-white" : "bg-[#050F1A]")
                                : `rounded-2xl ${isLight ? "bg-white/70 border border-black/10" : "bg-[#0B1220]/45 border border-white/5"}`
                            )
                        }
                    >
                        <div className="w-full h-full min-h-0">
                            <div ref={iframeContainerRef} key={jitsiKey} className="w-full h-full min-h-0" />
                        </div>

                        {/* ✅ In-room settings quick button (our UI) */}
                        {!isPrejoinUi && (
                            <button
                                onClick={openJitsiSettings}
                                className={`absolute top-3 right-3 z-30 px-3 h-10 rounded-xl text-sm font-semibold shadow-lg pointer-events-auto ${isLight
                                    ? "bg-white/90 border border-black/10 text-black/70 hover:bg-white"
                                    : "bg-[#020617]/80 border border-white/10 text-white/80 hover:bg-[#020617]"
                                    }`}
                                title="Settings"
                            >
                                ⚙ Settings
                            </button>
                        )}

                        {/* ✅ MySession header/footer overlays during prejoin */}
                        {isPrejoinUi && (
                            <>
                                <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
                                    <div
                                        className={`pointer-events-none px-4 pt-[max(10px,env(safe-area-inset-top))] pb-3 ${isLight ? "bg-white/85" : "bg-[#050F1A]/85"} backdrop-blur`}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className={`text-sm font-semibold ${isLight ? "text-black/80" : "text-white/85"}`}>MySession</div>
                                                <div className={`text-sm font-semibold truncate ${isLight ? "text-black/80" : "text-white/85"}`}>
                                                    {sessionTitle}
                                                </div>
                                            </div>

                                            {/* ✅ clickable settings in prejoin */}
                                            <div className="pointer-events-auto flex items-center gap-2 shrink-0">
                                                <button
                                                    onClick={openJitsiSettings}
                                                    className={`h-10 px-3 rounded-xl text-sm font-semibold shadow ${isLight
                                                        ? "bg-white/95 border border-black/10 text-black/70 hover:bg-white"
                                                        : "bg-[#020617]/85 border border-white/10 text-white/80 hover:bg-[#020617]"
                                                        }`}
                                                    title="Prejoin settings"
                                                >
                                                    ⚙ Settings
                                                </button>

                                                <button
                                                    onClick={forceReloadJitsi}
                                                    className={`h-10 px-3 rounded-xl text-sm font-semibold shadow ${isLight
                                                        ? "bg-black/5 border border-black/10 text-black/60 hover:bg-black/10"
                                                        : "bg-white/5 border border-white/10 text-white/70 hover:bg-white/10"
                                                        }`}
                                                    title="Reload room"
                                                >
                                                    ↻
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
                                    <div
                                        className={`pointer-events-none px-4 pb-[max(10px,env(safe-area-inset-bottom))] pt-3 ${isLight ? "bg-white/85" : "bg-[#050F1A]/85"} backdrop-blur`}
                                    >
                                        <div className={`${isLight ? "text-black/50" : "text-white/50"} text-xs`}>
                                            Нажми ⚙ Settings чтобы выбрать микрофон/камеру. Потом Join → и ты в комнате с нашим UI.
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}

                        {(lastErr || capacityError) && (
                            <div className="absolute top-4 left-4 text-xs bg-red-600 text-white px-3 py-2 rounded-lg shadow">
                                {capacityError || lastErr}
                            </div>
                        )}

                        {/* floating reactions overlay */}
                        {floatingReactions.length > 0 && (
                            <div className="pointer-events-none absolute inset-x-0 bottom-6 flex items-center justify-center">
                                <div
                                    className={`px-3 py-2 rounded-2xl text-sm shadow-xl ${isLight ? "bg-white/90 border border-black/10 text-black/80" : "bg-[#020617]/80 border border-white/10 text-white/85"
                                        }`}
                                >
                                    {floatingReactions.slice(-2).map((r) => (
                                        <div key={r.id} className="flex items-center gap-2">
                                            <span className="text-lg leading-none">{REACTION_EMOJI[r.type]}</span>
                                            <span className="text-[12px] opacity-80 truncate max-w-[260px]">{r.fromName}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ✅ Render only one variant */}
                    {!isPrejoinUi && rightPanelOpen && isLgUp && <div className="min-h-0 h-full overflow-hidden">{RightPanelBody}</div>}

                    {!isPrejoinUi && rightPanelOpen && !isLgUp && (
                        <div className="absolute inset-0 z-40 min-h-0">
                            <div className="absolute inset-0 bg-black/40" onClick={() => openRightTab(null)} />
                            <div className="absolute inset-x-0 top-0 bottom-0 p-2 min-h-0">{RightPanelBody}</div>
                        </div>
                    )}
                </div>
            </div>

            {!isPrejoinUi && (
                <VideoControls
                    theme={theme}
                    tile={tile}
                    mutedAudio={mutedAudio}
                    mutedVideo={mutedVideo}
                    isScreenSharing={isScreenSharing}
                    unreadChat={unreadChat}
                    onOpenTab={(tab) => openRightTab(tab)}
                    onToggleAudio={handleToggleAudio}
                    onToggleVideo={handleToggleVideo}
                    onToggleScreenShare={handleToggleScreenShare}
                    onToggleTile={handleToggleTile}
                    onReloadRoom={forceReloadJitsi}
                    onSendReaction={sendReaction}
                    onLeave={handleLeave}
                />
            )}

            {selectedUser && <UserProfileModal user={selectedUser} onClose={() => setSelectedUser(null)} />}
        </div>
    );
}
