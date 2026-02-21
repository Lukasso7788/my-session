// src/pages/RoomPageLiveKit.tsx
import "@livekit/components-styles";
import { LiveKitRoom, GridLayout, ParticipantTile, ControlBar } from "@livekit/components-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import ChatPanel from "../components/ChatPanel";
import { IntentionsPanel } from "../components/IntentionsPanel";
import { SessionStageBar } from "../components/SessionStageBar";

// ✅ Можешь прямо импортнуть твой PreJoinModal отсюда же,
// либо временно скопировать из RoomPage.tsx.
import type { RoomMediaSettings } from "../components/RoomMediaSettingsModal";

type RoomTheme = "dark" | "light";
type RightPanelTab = "participants" | "chat" | "intentions" | null;

type HostProfile = {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  bio?: string | null;
};

type SessionTemplate = {
  name?: string | null;
  title?: string | null;
  key?: string | null;
  slug?: string | null;
  type?: string | null;
  format?: string | null;
};

type SessionRow = {
  id: string;
  title: string;
  schedule: unknown;
  format?: string | null;
  start_time?: string | null;
  created_at?: string | null;
  host_profile?: HostProfile | null;
  session_templates?: SessionTemplate | SessionTemplate[] | null;
  max_participants?: number | null;
};

// ---- helpers ----
function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function safeRoomName(raw: string) {
  const base = (raw || "").toLowerCase();
  const cleaned = base.replace(/[^a-z0-9-_]/g, "");
  return cleaned || "room";
}
function safeIdentity(raw: string) {
  return (raw || "guest").toLowerCase().replace(/[^a-z0-9-_]/g, "") || "guest";
}

// ---- YOU: вставь сюда свой PreJoinModal из RoomPage.tsx ----
type MediaDevicesResult = {
  videoInputs: MediaDeviceInfo[];
  audioInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
};

type PreJoinSettings = {
  displayName: string;
  audioInputId: string;
  videoInputId: string;
  audioOutputId: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
};

function PreJoinModal(_props: any) {
  // ⛔️ заглушка: замени на твой реальный PreJoinModal (он у тебя уже готов)
  return null;
}

export function RoomPageLiveKit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

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
      const root = document.documentElement;
      const body = document.body;
      const isDark = theme === "dark";
      root.classList.toggle("dark", isDark);
      body.classList.toggle("dark", isDark);
      root.setAttribute("data-theme", theme);
      body.setAttribute("data-theme", theme);
      (root.style as any).colorScheme = theme;
      (body.style as any).colorScheme = theme;
    } catch {}
  }, [theme]);

  const isLight = theme === "light";
  const pageBg = isLight ? "bg-[#F6F7FB] text-[#0B1220]" : "bg-[#050F1A] text-white";
  const panelBg = isLight
    ? "bg-white/85 border border-black/10"
    : "bg-[#0B1220]/55 border border-white/5";

  const [session, setSession] = useState<SessionRow | null>(null);
  const [loading, setLoading] = useState(true);

  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [displayName, setDisplayName] = useState("");

  const [prejoinOpen, setPrejoinOpen] = useState(false);
  const [joinRequested, setJoinRequested] = useState(false);

  const [devices, setDevices] = useState<MediaDevicesResult>({
    videoInputs: [],
    audioInputs: [],
    audioOutputs: [],
  });

  const [prejoin, setPrejoin] = useState<PreJoinSettings>(() => ({
    displayName: "",
    audioInputId: "",
    videoInputId: "",
    audioOutputId: "default",
    audioEnabled: true,
    videoEnabled: true,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }));
  const prejoinRef = useRef(prejoin);
  useEffect(() => {
    prejoinRef.current = prejoin;
  }, [prejoin]);

  // right panel (оставляем твой UX)
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightTab, setRightTab] = useState<RightPanelTab>(null);
  const openRightTab = (tab: RightPanelTab) => {
    if (!tab) {
      setRightPanelOpen(false);
      setRightTab(null);
      return;
    }
    setRightTab((prev) => {
      const same = prev === tab;
      setRightPanelOpen((prevOpen) => (same ? !prevOpen : true));
      return tab;
    });
  };

  const maxParticipants = useMemo(() => {
    const raw = num((session as any)?.max_participants);
    const v = raw > 0 ? raw : 16;
    return Math.max(2, Math.min(50, Math.round(v)));
  }, [session]);

  // load session
  useEffect(() => {
    (async () => {
      if (!id) return;
      setLoading(true);

      const { data, error } = await supabase
        .from("sessions")
        .select("*, host_profile:profiles!sessions_host_id_fkey(id, full_name, avatar_url, bio), session_templates(*)")
        .eq("id", id)
        .single();

      if (data && !error) setSession(data as any);
      setLoading(false);
    })();
  }, [id]);

  // auth user
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data.user;
      setAuthUserId(u?.id || null);

      let name =
        str(u?.user_metadata?.full_name) ||
        str(u?.user_metadata?.name) ||
        (u?.email ? u.email.split("@")[0] : "");

      if (!name && u?.id) {
        const { data: p } = await supabase.from("profiles").select("full_name").eq("id", u.id).single();
        name = str((p as any)?.full_name);
      }

      setUserName(name);
      setDisplayName((prev) => prev || name);
      setPrejoin((prev) => ({ ...prev, displayName: prev.displayName || name }));
    })();
  }, []);

  // enumerate devices (best-effort)
  const loadBrowserDevices = async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;

      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        s.getTracks().forEach((t) => t.stop());
      } catch {}

      const list = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = list.filter((d) => d.kind === "videoinput");
      const audioInputs = list.filter((d) => d.kind === "audioinput");
      const audioOutputs = list.filter((d) => d.kind === "audiooutput");

      setDevices({ videoInputs, audioInputs, audioOutputs });

      setPrejoin((prev) => ({
        ...prev,
        videoInputId: prev.videoInputId || videoInputs?.[0]?.deviceId || "",
        audioInputId: prev.audioInputId || audioInputs?.[0]?.deviceId || "",
        audioOutputId: prev.audioOutputId || "default",
      }));
    } catch (e) {
      console.error("loadBrowserDevices error:", e);
    }
  };

  // show prejoin once ready
  useEffect(() => {
    if (loading) return;
    if (!session) return;
    if (!displayName && !userName) return;
    if (joinRequested) return;

    setPrejoinOpen(true);
    loadBrowserDevices().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session, displayName, userName, joinRequested]);

  // token + connect
  const [lkToken, setLkToken] = useState<string>("");
  const [lkServerUrl, setLkServerUrl] = useState<string>(() => {
    return ((import.meta as any)?.env?.VITE_LIVEKIT_URL as string) || "";
  });

  const tokenEndpoint =
    ((import.meta as any)?.env?.VITE_LIVEKIT_TOKEN_ENDPOINT as string) || "/api/livekit/token";

  useEffect(() => {
    (async () => {
      if (!session) return;
      if (!joinRequested) return;
      if (lkToken) return;

      const pj = prejoinRef.current;
      const nameToUse = (pj.displayName || displayName || userName || "Guest").trim() || "Guest";

      const roomName = safeRoomName(`session-${session.id}`);
      const identity = safeIdentity(authUserId || nameToUse);

      const res = await fetch(tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomName,
          identity,
          name: nameToUse,
        }),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.error("token error:", res.status, t);
        return;
      }

      const json = (await res.json()) as { token?: string };
      setLkToken(json.token || "");
    })();
  }, [session, joinRequested, lkToken, tokenEndpoint, authUserId, displayName, userName]);

  if (loading) {
    return <div className={`flex h-screen items-center justify-center ${pageBg}`}>Loading session...</div>;
  }
  if (!session) {
    return (
      <div className={`flex h-screen items-center justify-center ${pageBg}`}>
        <button onClick={() => navigate("/sessions")}>Back</button>
      </div>
    );
  }

  const ChatPanelAny = ChatPanel as any;

  return (
    <>
      <PreJoinModal
        open={prejoinOpen}
        theme={theme}
        devices={devices}
        value={prejoin}
        onChange={setPrejoin}
        onRefreshDevices={loadBrowserDevices}
        onCancel={() => navigate("/sessions", { replace: true })}
        onJoin={() => {
          const pj = prejoinRef.current;
          const nm = (pj.displayName || displayName || userName || "Guest").trim() || "Guest";
          setDisplayName(nm);
          setPrejoinOpen(false);
          setJoinRequested(true);
        }}
      />

      <div className={`h-[100dvh] overflow-hidden ${pageBg}`}>
        <div className="h-full w-full px-2 sm:px-4 pt-3 pb-[calc(84px+env(safe-area-inset-bottom))] flex flex-col gap-3 min-h-0">
          {/* top bar (минимальная версия; можешь перенести 1:1 из RoomPage) */}
          <div className={`rounded-2xl px-4 py-3 ${panelBg}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-inter font-semibold text-[16px] sm:text-[18px] truncate">
                  {session.title || "Session"}
                </div>
                <div className={isLight ? "text-black/50 text-xs" : "text-white/50 text-xs"}>
                  LiveKit room: session-{session.id} (limit {maxParticipants})
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                  className={isLight ? "px-3 py-2 rounded-xl bg-black/5" : "px-3 py-2 rounded-xl bg-white/5"}
                  title="Toggle theme"
                >
                  {theme === "dark" ? "🌙" : "☀️"}
                </button>
                <button
                  onClick={() => openRightTab("chat")}
                  className={isLight ? "px-3 py-2 rounded-xl bg-black/5" : "px-3 py-2 rounded-xl bg-white/5"}
                >
                  Chat
                </button>
                <button
                  onClick={() => openRightTab("intentions")}
                  className={isLight ? "px-3 py-2 rounded-xl bg-black/5" : "px-3 py-2 rounded-xl bg-white/5"}
                >
                  Intentions
                </button>
              </div>
            </div>

            {/* если хочешь — воткни сюда SessionStageBar как в RoomPage */}
            <div className="mt-3">
              <SessionStageBar
                stages={[]}
                startTime={String(session.start_time || session.created_at || new Date().toISOString())}
                onHoverStage={() => {}}
              />
            </div>
          </div>

          <div className={"relative grid grid-rows-1 gap-3 flex-1 min-h-0 h-full " + (rightPanelOpen ? "lg:grid-cols-[minmax(0,1fr),380px]" : "grid-cols-1")}>
            {/* VIDEO */}
            <div className={`relative rounded-2xl overflow-hidden min-h-0 h-full ${isLight ? "bg-white/70 border border-black/10" : "bg-[#0B1220]/45 border border-white/5"}`}>
              {!joinRequested ? (
                <div className="h-full w-full flex items-center justify-center opacity-70 text-sm">
                  Waiting for join…
                </div>
              ) : !lkServerUrl ? (
                <div className="h-full w-full flex items-center justify-center text-sm text-red-500">
                  Missing VITE_LIVEKIT_URL
                </div>
              ) : !lkToken ? (
                <div className="h-full w-full flex items-center justify-center opacity-70 text-sm">
                  Getting token…
                </div>
              ) : (
                <LiveKitRoom
                  serverUrl={lkServerUrl}
                  token={lkToken}
                  connect={true}
                  video={prejoin.videoEnabled}
                  audio={prejoin.audioEnabled}
                  data-theme={theme}
                  style={{ height: "100%", width: "100%" }}
                  onDisconnected={() => {
                    // вернись или покажи “reconnect”
                  }}
                >
                  <div className="h-full w-full flex flex-col min-h-0">
                    <div className="flex-1 min-h-0 p-2">
                      <GridLayout className="h-full w-full" >
                        <ParticipantTile />
                      </GridLayout>
                    </div>
                    <div className="p-2">
                      <ControlBar variation="minimal" />
                    </div>
                  </div>
                </LiveKitRoom>
              )}
            </div>

            {/* RIGHT PANEL */}
            {rightPanelOpen && (
              <div className="min-h-0 h-full overflow-hidden">
                <div className={`rounded-2xl shadow-lg overflow-hidden min-h-0 h-full flex flex-col ${panelBg}`} data-theme={theme}>
                  <div className={`px-4 py-3 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"}`}>
                    <div className="font-inter font-semibold">
                      {rightTab === "chat" ? "Chat" : rightTab === "intentions" ? "Intentions" : "Panel"}
                    </div>
                    <button
                      onClick={() => openRightTab(null)}
                      className={isLight ? "w-9 h-9 rounded-xl bg-black/5" : "w-9 h-9 rounded-xl bg-white/5"}
                    >
                      ✕
                    </button>
                  </div>

                  <div className="flex-1 min-h-0 overflow-hidden p-3">
                    {rightTab === "chat" && (
                      <div className="h-full min-h-0 overflow-hidden rounded-xl">
                        <div data-theme={theme} style={{ colorScheme: theme }} className={theme === "dark" ? "dark h-full min-h-0" : "h-full min-h-0"}>
                          <ChatPanelAny
                            sessionId={session.id}
                            theme={theme}
                            showHeader={false}
                            embedded={true}
                            hideHeader={true}
                            authUserId={authUserId}
                            displayName={displayName || userName}
                          />
                        </div>
                      </div>
                    )}

                    {rightTab === "intentions" && (
                      <div className="h-full min-h-0 overflow-y-auto rounded-xl">
                        <div data-theme={theme} style={{ colorScheme: theme }} className={theme === "dark" ? "dark h-full min-h-0" : "h-full min-h-0"}>
                          <IntentionsPanel theme={theme} sessionId={session.id} timerText={"--:--"} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* leave button */}
        <div className="fixed bottom-3 right-3 z-50">
          <button
            onClick={() => navigate("/sessions", { replace: true })}
            className={isLight ? "px-4 py-3 rounded-2xl bg-red-600 text-white font-semibold" : "px-4 py-3 rounded-2xl bg-red-600 text-white font-semibold"}
          >
            Leave
          </button>
        </div>
      </div>
    </>
  );
}

export default RoomPageLiveKit;