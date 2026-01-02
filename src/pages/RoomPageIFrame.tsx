// src/pages/RoomPageIFrame.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

import { IntentionsPanel } from "../components/IntentionsPanel";
import { SessionStageBar } from "../components/SessionStageBar";
import { UserProfileModal } from "../components/UserProfileModal";

// ✅ FIX: your chat component
import ChatPanel from "../components/chatpanel";

type Stage = {
    name: string;
    duration: number; // minutes
    color: string;
    type: "intro" | "intentions" | "focus" | "break" | "outro" | string;
};

declare global {
    interface Window {
        JitsiMeetExternalAPI?: any;
    }
}

// ====== JITSI DOMAIN ======
const JITSI_DOMAIN = "jitsi.lukassodesign.site";

// ====== YOUR ICONS (put your svg files here) ======
const ICONS = {
    tileOn: "/icons/tile-on.svg",
    tileOff: "/icons/tile-off.svg",
    micOn: "/icons/mic-on.svg",
    micOff: "/icons/mic-off.svg",
    camOn: "/icons/cam-on.svg",
    camOff: "/icons/cam-off.svg",
    leave: "/icons/leave.svg",
};

function safeLower(x: any) {
    return String(x || "").toLowerCase();
}

function parseStagesFromSchedule(schedule: any): Stage[] {
    if (!schedule) return [];
    try {
        const parsed = typeof schedule === "string" ? JSON.parse(schedule) : schedule;
        if (!Array.isArray(parsed)) return [];

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
                    name: b?.name || "Stage",
                    duration: Number(b?.minutes || b?.duration || 0),
                    color:
                        (
                            {
                                intro: "#8FD8C6",
                                intentions: "#FFF9F2",
                                focus: "#9ADEDC",
                                break: "#FF9F8E",
                                outro: "#8FD8C6",
                            } as any
                        )[type] || "#9ADEDC",
                    type,
                };
            })
            .filter((s) => Number.isFinite(s.duration) && s.duration > 0);

        return formatted;
    } catch {
        return [];
    }
}

async function loadJitsiExternalApi(domain: string) {
    if (typeof window === "undefined") return;
    if (window.JitsiMeetExternalAPI) return;

    await new Promise<void>((resolve, reject) => {
        const src = `https://${domain}/external_api.js`;

        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) {
            const t = window.setInterval(() => {
                if (window.JitsiMeetExternalAPI) {
                    window.clearInterval(t);
                    resolve();
                }
            }, 50);

            window.setTimeout(() => {
                window.clearInterval(t);
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

export default function RoomPageIFrame() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const iframeContainerRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<any>(null);
    const initGuardRef = useRef(false);

    const [session, setSession] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const [stages, setStages] = useState<Stage[]>([]);
    const [hoveredStage, setHoveredStage] = useState<Stage | null>(null);
    const [currentStage, setCurrentStage] = useState(0);
    const [remainingTime, setRemainingTime] = useState<string>("");

    const [selectedUser, setSelectedUser] = useState<any>(null);
    const [userName, setUserName] = useState<string>("");

    const [lastErr, setLastErr] = useState<string>("");

    const [tile, setTile] = useState(true);
    const [mutedAudio, setMutedAudio] = useState(false);
    const [mutedVideo, setMutedVideo] = useState(false);

    const roomName = useMemo(() => {
        return id ? `session-${id}` : "session-unknown";
    }, [id]);

    // ============================================
    // LOAD SESSION
    // ============================================
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
                setStages(parseStagesFromSchedule(data.schedule));
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
    // STAGE TIMER
    // ============================================
    useEffect(() => {
        if (!session?.start_time || !stages.length) return;

        const timer = window.setInterval(() => {
            const diffSec = (Date.now() - new Date(session.start_time).getTime()) / 1000;

            let total = 0;
            let active = stages.length - 1;

            for (let i = 0; i < stages.length; i++) {
                const next = total + stages[i].duration * 60;
                if (diffSec < next) {
                    active = i;
                    const rem = next - diffSec;
                    setRemainingTime(`${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(2, "0")}`);
                    break;
                }
                total = next;
            }

            setCurrentStage(active);
        }, 1000);

        return () => window.clearInterval(timer);
    }, [session?.start_time, stages]);

    // ============================================
    // JITSI INIT (External API)
    // ============================================
    useEffect(() => {
        if (!session || !id) return;
        if (!iframeContainerRef.current) return;
        if (!userName) return;
        if (initGuardRef.current) return;
        initGuardRef.current = true;

        let destroyed = false;

        const cleanup = () => {
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
                await loadJitsiExternalApi(JITSI_DOMAIN);
                if (destroyed) return;

                iframeContainerRef.current!.innerHTML = "";

                const api = new window.JitsiMeetExternalAPI(JITSI_DOMAIN, {
                    roomName,
                    parentNode: iframeContainerRef.current,
                    width: "100%",
                    height: "100%",
                    userInfo: { displayName: userName },

                    configOverwrite: {
                        prejoinPageEnabled: false,
                        enableWelcomePage: false,
                        disableDeepLinking: true,

                        startWithAudioMuted: false,
                        startWithVideoMuted: false,

                        disableInviteFunctions: true,
                    },

                    interfaceConfigOverwrite: {
                        SHOW_JITSI_WATERMARK: false,
                        SHOW_WATERMARK_FOR_GUESTS: false,
                        JITSI_WATERMARK_LINK: "",

                        HIDE_INVITE_MORE_HEADER: true,

                        // ✅ hide Jitsi toolbar completely (we use custom controls)
                        TOOLBAR_BUTTONS: [],

                        DISABLE_FOCUS_INDICATOR: true,
                        DISABLE_DOMINANT_SPEAKER_INDICATOR: true,

                        DEFAULT_REMOTE_DISPLAY_NAME: "Guest",
                    },
                });

                apiRef.current = api;

                // default tile view
                try {
                    api.executeCommand("setTileView", true);
                    setTile(true);
                } catch { }

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
    }, [session, id, userName, roomName, navigate]);

    // ============================================
    // Custom controls (your icons)
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
    // UI
    // ============================================
    if (loading) {
        return (
            <div className="flex h-screen justify-center items-center text-white bg-slate-900">
                Loading session...
            </div>
        );
    }

    if (!session) {
        return (
            <div className="flex h-screen justify-center items-center text-white bg-slate-900">
                <button onClick={() => navigate("/sessions")} className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600">
                    Back
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-900 text-white flex justify-center">
            <div className="max-w-[1720px] w-full px-5 py-5 space-y-5">
                {/* TOP STAGE CARD */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 shadow-lg p-4">
                    <div className="flex justify-between mb-3">
                        <span className="text-slate-400">{session.title}</span>
                        <span className="text-xs text-slate-500">
                            Stage {currentStage + 1} / {stages.length || 0}
                        </span>
                    </div>

                    <div className="bg-white p-4 rounded-2xl space-y-3 shadow-sm">
                        <SessionStageBar stages={stages} startTime={session.start_time} onHoverStage={setHoveredStage} />
                        <div className="flex justify-between text-sm text-slate-700">
                            <span>
                                {hoveredStage ? `${hoveredStage.name} • ${hoveredStage.duration} min` : stages[currentStage]?.name}
                            </span>
                            <span className="text-slate-500">⏱ {remainingTime}</span>
                        </div>
                    </div>

                    {session.host_profile && (
                        <p
                            onClick={() => setSelectedUser(session.host_profile)}
                            className="cursor-pointer text-sm text-slate-400 hover:text-blue-400 mt-3"
                        >
                            👤 Hosted by {session.host_profile.full_name}
                        </p>
                    )}
                </div>

                {/* MAIN GRID */}
                <div className="grid lg:grid-cols-[1fr,370px] gap-5">
                    {/* LEFT: JITSI */}
                    <div
                        className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-lg overflow-hidden relative h-[77vh]"
                        style={{ minHeight: "70vh" }}
                    >
                        <div ref={iframeContainerRef} className="w-full h-full" style={{ minHeight: "70vh" }} />

                        {/* Custom control bar */}
                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3">
                            <button
                                onClick={toggleMic}
                                className="h-11 w-11 rounded-full bg-white/10 hover:bg-white/15 border border-white/10 flex items-center justify-center"
                                title={mutedAudio ? "Unmute mic" : "Mute mic"}
                            >
                                <img
                                    src={mutedAudio ? ICONS.micOff : ICONS.micOn}
                                    className="w-5 h-5"
                                    alt="mic"
                                    onError={(e) => {
                                        (e.currentTarget as HTMLImageElement).style.display = "none";
                                    }}
                                />
                                <span className="text-xs">{mutedAudio ? "🎙️✖" : "🎙️"}</span>
                            </button>

                            <button
                                onClick={toggleCam}
                                className="h-11 w-11 rounded-full bg-white/10 hover:bg-white/15 border border-white/10 flex items-center justify-center"
                                title={mutedVideo ? "Turn camera on" : "Turn camera off"}
                            >
                                <img
                                    src={mutedVideo ? ICONS.camOff : ICONS.camOn}
                                    className="w-5 h-5"
                                    alt="cam"
                                    onError={(e) => {
                                        (e.currentTarget as HTMLImageElement).style.display = "none";
                                    }}
                                />
                                <span className="text-xs">{mutedVideo ? "📷✖" : "📷"}</span>
                            </button>

                            <button
                                onClick={toggleTile}
                                className="h-11 w-11 rounded-full bg-white/10 hover:bg-white/15 border border-white/10 flex items-center justify-center"
                                title={tile ? "Disable tile view" : "Enable tile view"}
                            >
                                <img
                                    src={tile ? ICONS.tileOn : ICONS.tileOff}
                                    className="w-5 h-5"
                                    alt="tile"
                                    onError={(e) => {
                                        (e.currentTarget as HTMLImageElement).style.display = "none";
                                    }}
                                />
                                <span className="text-xs">{tile ? "▦" : "▢"}</span>
                            </button>

                            <button
                                onClick={hangup}
                                className="h-11 px-4 rounded-full bg-red-500/85 hover:bg-red-500 border border-red-300/20 flex items-center justify-center gap-2"
                                title="Leave"
                            >
                                <img
                                    src={ICONS.leave}
                                    className="w-5 h-5"
                                    alt="leave"
                                    onError={(e) => {
                                        (e.currentTarget as HTMLImageElement).style.display = "none";
                                    }}
                                />
                                <span className="text-sm font-semibold">Leave</span>
                            </button>
                        </div>

                        {lastErr && (
                            <div className="absolute top-4 left-4 text-xs bg-red-600 text-white px-3 py-2 rounded-lg shadow z-30">
                                {lastErr}
                            </div>
                        )}
                    </div>

                    {/* RIGHT: DARK PANEL */}
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 text-white shadow-lg h-[77vh] overflow-hidden">
                        <div className="p-4 h-full flex flex-col gap-4">
                            <div className="flex-1 min-h-0 rounded-2xl border border-slate-800 bg-slate-900/70 overflow-hidden">
                                <div className="px-4 py-3 border-b border-slate-800 text-xs font-semibold text-slate-300">
                                    Intentions
                                </div>
                                <div className="p-3 h-full overflow-auto">
                                    <IntentionsPanel />
                                </div>
                            </div>

                            {/* ✅ your chatpanel */}
                            <div className="h-[42%] min-h-[220px] rounded-2xl border border-slate-800 bg-slate-900/70 overflow-hidden">
                                <div className="px-4 py-3 border-b border-slate-800 text-xs font-semibold text-slate-300">Chat</div>
                                <div className="h-[calc(100%-44px)]">
                                    {/* If your chatpanel needs props, add them here */}
                                    <ChatPanel />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {selectedUser && <UserProfileModal user={selectedUser} onClose={() => setSelectedUser(null)} />}
        </div>
    );
}
