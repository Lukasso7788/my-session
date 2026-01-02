// src/pages/RoomPageIFrame.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { IntentionsPanel } from "../components/IntentionsPanel";
import { SessionStageBar } from "../components/SessionStageBar";
import { UserProfileModal } from "../components/UserProfileModal";

type Stage = {
    name: string;
    duration: number; // minutes
    color: string;
    type: "intro" | "intentions" | "focus" | "break" | "outro" | string;
};

// ====== JITSI DOMAIN (same as your engine) ======
const JITSI_DOMAIN = "jitsi.lukassodesign.site";

// ====== Minimal types for External API ======
declare global {
    interface Window {
        JitsiMeetExternalAPI?: any;
    }
}

function safeLower(x: any) {
    return String(x || "").toLowerCase();
}

function parseStagesFromSchedule(schedule: any): Stage[] {
    if (!schedule) return [];
    try {
        const parsed = typeof schedule === "string" ? JSON.parse(schedule) : schedule;
        if (!Array.isArray(parsed)) return [];
        const formatted: Stage[] = parsed.map((b: any) => {
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
        });

        // filter out weird 0-min blocks if any
        return formatted.filter((s) => Number.isFinite(s.duration) && s.duration > 0);
    } catch {
        return [];
    }
}

function getStageWindows(startISO: string, items: Stage[]) {
    const startMs = new Date(startISO).getTime();
    let acc = 0;
    const starts = items.map((st) => {
        const ms = startMs + acc * 60 * 1000;
        acc += st.duration;
        return ms;
    });
    const ends = items.map((_, i) => starts[i] + items[i].duration * 60 * 1000);
    return { starts, ends };
}

/**
 * Loads https://<domain>/external_api.js
 * (works for self-hosted Jitsi if you expose external_api.js)
 */
async function loadJitsiExternalApi(domain: string) {
    if (typeof window === "undefined") return;
    if (window.JitsiMeetExternalAPI) return;

    await new Promise<void>((resolve, reject) => {
        const src = `https://${domain}/external_api.js`;
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) {
            // script exists but may not be ready yet
            const t = setInterval(() => {
                if (window.JitsiMeetExternalAPI) {
                    clearInterval(t);
                    resolve();
                }
            }, 50);
            setTimeout(() => {
                clearInterval(t);
                if (!window.JitsiMeetExternalAPI) reject(new Error("Jitsi external_api.js loaded but API missing"));
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

    // ========= OPTIONAL: simple local chat UI (hook later to Jitsi events if needed)
    // Here we keep it minimal and safe: send via executeCommand if available.
    const [chatInput, setChatInput] = useState("");
    const [chatLog, setChatLog] = useState<Array<{ at: number; from: string; text: string }>>([]);

    const roomName = useMemo(() => {
        // safest: stable room name for same session id
        // (if you later store explicit jitsi_room_name in DB, swap here)
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
    // STAGE TIME CALC (same as RoomPage)
    // ============================================
    useEffect(() => {
        if (!session?.start_time || !stages.length) return;

        const timer = setInterval(() => {
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

        return () => clearInterval(timer);
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

                // clear container (in case remount)
                iframeContainerRef.current!.innerHTML = "";

                // ---- interfaceConfigOverwrite / configOverwrite
                // We intentionally hide participants pane and most UI,
                // and control key things with our own buttons.
                const api = new window.JitsiMeetExternalAPI(JITSI_DOMAIN, {
                    roomName,
                    parentNode: iframeContainerRef.current,
                    width: "100%",
                    height: "100%",
                    userInfo: {
                        displayName: userName,
                    },
                    configOverwrite: {
                        // force tile default; we still toggle via command
                        startWithVideoMuted: false,
                        startWithAudioMuted: false,

                        // reduce distractions
                        disableDeepLinking: true,
                        prejoinPageEnabled: false,

                        // in many deployments this hides the lobby name prompt etc.
                        enableWelcomePage: false,
                    },
                    interfaceConfigOverwrite: {
                        // Hide left-side panels & extra stuff:
                        // (exact keys depend on Jitsi version; safe to leave)
                        SHOW_JITSI_WATERMARK: false,
                        SHOW_WATERMARK_FOR_GUESTS: false,
                        HIDE_INVITE_MORE_HEADER: true,

                        // Keep toolbar minimal or empty; we add our own controls outside.
                        TOOLBAR_BUTTONS: [
                            "microphone",
                            "camera",
                            "hangup",
                            // you can keep tileview if you want, but we control ourselves
                            // "tileview",
                        ],
                        DEFAULT_REMOTE_DISPLAY_NAME: "Guest",
                    },
                });

                apiRef.current = api;

                // Try to force tile view on start
                try {
                    api.executeCommand("setTileView", true);
                    setTile(true);
                } catch { }

                // Events (best-effort)
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

                // Chat events are version-dependent.
                // We'll attempt to listen if the deployment exposes it:
                api.addEventListener?.("incomingMessage", (e: any) => {
                    if (destroyed) return;
                    const text = String(e?.message || e?.text || "");
                    const from = String(e?.from || e?.nick || "Guest");
                    if (!text) return;
                    setChatLog((prev) => [...prev, { at: Date.now(), from, text }].slice(-120));
                });

                // In some versions this exists:
                api.addEventListener?.("endpointTextMessageReceived", (e: any) => {
                    if (destroyed) return;
                    const text = String(e?.data?.eventData?.text || e?.eventData?.text || e?.text || "");
                    const from = String(e?.data?.senderInfo?.displayName || e?.senderInfo?.displayName || "Guest");
                    if (!text) return;
                    setChatLog((prev) => [...prev, { at: Date.now(), from, text }].slice(-120));
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
    // UI actions (custom controls)
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

    const sendChat = () => {
        const api = apiRef.current;
        const text = chatInput.trim();
        if (!text) return;

        // optimistic local append
        setChatLog((prev) => [...prev, { at: Date.now(), from: userName || "Me", text }].slice(-120));
        setChatInput("");

        // try to send via API (best-effort)
        try {
            // common command name:
            api.executeCommand?.("sendChatMessage", text);
        } catch {
            // fallback: some versions use openChat + internal; ignore if not supported
        }
    };

    // ============================================
    // Render
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
                {/* TOP STAGE CARD (same structure as RoomPage) */}
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

                    {/* Host modal link like before */}
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
                    {/* LEFT: JITSI VIDEO */}
                    <div
                        className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-lg overflow-hidden relative h-[77vh]"
                        style={{ minHeight: "70vh" }}
                    >
                        {/* Custom control strip (your UI, not Jitsi toolbar) */}
                        <div className="absolute top-3 right-3 z-20 flex gap-2">
                            <button
                                onClick={toggleTile}
                                className="px-3 h-9 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/15 border border-white/10"
                                title="Toggle tile / speaker layout"
                            >
                                {tile ? "Tile: ON" : "Tile: OFF"}
                            </button>

                            <button
                                onClick={toggleMic}
                                className="px-3 h-9 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/15 border border-white/10"
                                title="Toggle microphone"
                            >
                                {mutedAudio ? "Mic: OFF" : "Mic: ON"}
                            </button>

                            <button
                                onClick={toggleCam}
                                className="px-3 h-9 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/15 border border-white/10"
                                title="Toggle camera"
                            >
                                {mutedVideo ? "Cam: OFF" : "Cam: ON"}
                            </button>

                            <button
                                onClick={hangup}
                                className="px-3 h-9 rounded-lg text-xs font-semibold bg-red-500/80 hover:bg-red-500 border border-red-300/20"
                                title="Leave"
                            >
                                Leave
                            </button>
                        </div>

                        <div ref={iframeContainerRef} className="w-full h-full" style={{ minHeight: "70vh" }} />

                        {lastErr && (
                            <div className="absolute top-4 left-4 text-xs bg-red-600 text-white px-3 py-2 rounded-lg shadow z-20">
                                {lastErr}
                            </div>
                        )}
                    </div>

                    {/* RIGHT: panels (Intentions + Chat) */}
                    <div className="rounded-2xl border border-slate-800 bg-white text-black shadow-lg h-[77vh] overflow-hidden">
                        <div className="p-4 h-full flex flex-col gap-4">
                            {/* Intentions */}
                            <div className="flex-1 min-h-0 rounded-xl border border-slate-200 overflow-hidden">
                                <div className="px-3 py-2 border-b border-slate-200 text-xs font-semibold text-slate-600">
                                    Intentions
                                </div>
                                <div className="p-3 h-full overflow-auto">
                                    <IntentionsPanel />
                                </div>
                            </div>

                            {/* Chat (minimal custom UI) */}
                            <div className="h-[42%] min-h-[220px] rounded-xl border border-slate-200 overflow-hidden flex flex-col">
                                <div className="px-3 py-2 border-b border-slate-200 text-xs font-semibold text-slate-600">
                                    Chat
                                </div>

                                <div className="flex-1 overflow-auto p-3 space-y-2 bg-white">
                                    {chatLog.length === 0 ? (
                                        <div className="text-xs text-slate-400">
                                            Chat is ready. If your Jitsi deployment does not expose chat events/commands, messages may remain local.
                                        </div>
                                    ) : (
                                        chatLog.map((m, i) => (
                                            <div key={i} className="text-xs">
                                                <span className="font-semibold text-slate-700">{m.from}:</span>{" "}
                                                <span className="text-slate-800">{m.text}</span>
                                            </div>
                                        ))
                                    )}
                                </div>

                                <div className="p-2 border-t border-slate-200 flex gap-2">
                                    <input
                                        value={chatInput}
                                        onChange={(e) => setChatInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") sendChat();
                                        }}
                                        className="flex-1 h-9 px-3 rounded-lg border border-slate-300 text-sm outline-none"
                                        placeholder="Type a message…"
                                    />
                                    <button
                                        onClick={sendChat}
                                        className="h-9 px-3 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                                    >
                                        Send
                                    </button>
                                </div>
                            </div>

                            {/* NOTE: No participants list/pane here by request */}
                        </div>
                    </div>
                </div>
            </div>

            {selectedUser && <UserProfileModal user={selectedUser} onClose={() => setSelectedUser(null)} />}
        </div>
    );
}
