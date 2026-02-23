// src/pages/RoomPageLiveKit.tsx
import "@livekit/components-styles";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  useLocalParticipant,
  useRoomContext,
} from "@livekit/components-react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import ChatPanel from "../components/ChatPanel";
import { IntentionsPanel } from "../components/IntentionsPanel";
import { SessionStageBar } from "../components/SessionStageBar";

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
function deviceLabel(d: MediaDeviceInfo, fallback: string) {
  const l = (d.label || "").trim();
  return l || fallback;
}
function normalizeTemplates(
  t: SessionTemplate | SessionTemplate[] | null | undefined
): SessionTemplate[] {
  if (!t) return [];
  return Array.isArray(t) ? t : [t];
}

/**
 * LiveKit components may read localStorage key "lk-user-choices".
 * Some versions crash if it's missing or malformed.
 *
 * KEY FIX: we must ensure it exists *before* LK UI renders (not in useEffect).
 */
function ensureLiveKitLocalStorageSafeSync() {
  try {
    const key = "lk-user-choices";
    const raw = localStorage.getItem(key);

    const safeValue = {
      version: 1,
      audioEnabled: true,
      videoEnabled: true,
      // IMPORTANT: keep as strings (never undefined)
      audioDeviceId: "default",
      videoDeviceId: "default",
      audioOutputDeviceId: "default",
      // optional fields some builds expect
      username: "",
      // some builds may store array-ish fields; keep them stable
      preferredDevices: {
        audio: "default",
        video: "default",
        speaker: "default",
      },
    };

    if (!raw) {
      localStorage.setItem(key, JSON.stringify(safeValue));
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") throw new Error("bad");

      // Repair missing fields that might be read with `.length`
      const repaired: any = { ...safeValue, ...(parsed as any) };

      if (typeof repaired.audioDeviceId !== "string") repaired.audioDeviceId = "default";
      if (typeof repaired.videoDeviceId !== "string") repaired.videoDeviceId = "default";
      if (typeof repaired.audioOutputDeviceId !== "string") repaired.audioOutputDeviceId = "default";
      if (typeof repaired.audioEnabled !== "boolean") repaired.audioEnabled = true;
      if (typeof repaired.videoEnabled !== "boolean") repaired.videoEnabled = true;

      localStorage.setItem(key, JSON.stringify(repaired));
    } catch {
      localStorage.setItem(key, JSON.stringify(safeValue));
    }
  } catch {
    // ignore (private mode etc.)
  }
}

// ---- PreJoin ----
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

function PreJoinModal({
  open,
  theme,
  devices,
  value,
  onChange,
  onJoin,
  onCancel,
  onRefreshDevices,
}: {
  open: boolean;
  theme: RoomTheme;
  devices: MediaDevicesResult;
  value: PreJoinSettings;
  onChange: (next: PreJoinSettings) => void;
  onJoin: () => void;
  onCancel: () => void;
  onRefreshDevices: () => void;
}) {
  if (!open) return null;

  const isLight = theme === "light";

  const overlay = "fixed inset-0 z-[999] flex items-center justify-center px-3";
  const backdrop = "absolute inset-0 bg-black/55";
  const card = [
    "relative w-full max-w-[520px] rounded-3xl shadow-2xl overflow-hidden",
    isLight ? "bg-white text-black" : "bg-[#020617] text-white",
    "border",
    isLight ? "border-black/10" : "border-white/10",
  ].join(" ");

  const inputWrap = isLight
    ? "bg-black/5 border border-black/10"
    : "bg-white/5 border border-white/10";

  const inputCls = isLight
    ? "text-black placeholder:text-black/40"
    : "text-white placeholder:text-white/40";

  const labelCls = isLight ? "text-black/70" : "text-white/70";

  const btnPrimary = isLight
    ? "bg-blue-600 hover:bg-blue-700 text-white"
    : "bg-emerald-500 hover:bg-emerald-600 text-[#02140B]";

  const btnGhost = isLight
    ? "bg-black/5 hover:bg-black/10 text-black/70"
    : "bg-white/5 hover:bg-white/10 text-white/80";

  return (
    <div className={overlay} data-theme={theme} style={{ colorScheme: theme }}>
      <div className={backdrop} onClick={onCancel} />
      <div className={card}>
        <div
          className={`px-6 py-5 border-b ${isLight ? "border-black/10" : "border-white/10"
            }`}
        >
          <div className="flex items-center justify-between">
            <div className="font-inter font-semibold text-[16px]">
              Before you join (LiveKit)
            </div>
            <button
              onClick={onCancel}
              className={`w-9 h-9 rounded-2xl flex items-center justify-center ${btnGhost}`}
              title="Close"
            >
              ✕
            </button>
          </div>
          <div className={`mt-1 text-[12px] ${labelCls}`}>
            Choose devices + name, then Join.
          </div>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className={`text-[12px] ${labelCls}`}>Display name</div>
            <div className={`rounded-2xl px-4 py-3 ${inputWrap}`}>
              <input
                value={value.displayName}
                onChange={(e) => onChange({ ...value, displayName: e.target.value })}
                placeholder="Your name…"
                className={`w-full bg-transparent outline-none text-[14px] ${inputCls}`}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <div className={`text-[12px] ${labelCls}`}>Microphone</div>
              <div className={`rounded-2xl px-3 py-2 ${inputWrap}`}>
                <select
                  value={value.audioInputId}
                  onChange={(e) => onChange({ ...value, audioInputId: e.target.value })}
                  className={`w-full bg-transparent outline-none text-[13px] ${inputCls}`}
                >
                  <option value="">Default</option>
                  {devices.audioInputs.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {deviceLabel(d, `Microphone ${i + 1}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className={`text-[12px] ${labelCls}`}>Camera</div>
              <div className={`rounded-2xl px-3 py-2 ${inputWrap}`}>
                <select
                  value={value.videoInputId}
                  onChange={(e) => onChange({ ...value, videoInputId: e.target.value })}
                  className={`w-full bg-transparent outline-none text-[13px] ${inputCls}`}
                >
                  <option value="">Default</option>
                  {devices.videoInputs.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {deviceLabel(d, `Camera ${i + 1}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="sm:col-span-2 flex flex-col gap-2">
              <div className={`text-[12px] ${labelCls}`}>Speaker</div>
              <div className={`rounded-2xl px-3 py-2 ${inputWrap}`}>
                <select
                  value={value.audioOutputId}
                  onChange={(e) => onChange({ ...value, audioOutputId: e.target.value })}
                  className={`w-full bg-transparent outline-none text-[13px] ${inputCls}`}
                >
                  <option value="default">Default</option>
                  {devices.audioOutputs.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {deviceLabel(d, `Speaker ${i + 1}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className={`rounded-2xl p-4 ${inputWrap}`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={value.audioEnabled}
                  onChange={(e) => onChange({ ...value, audioEnabled: e.target.checked })}
                />
                <span className={labelCls}>Audio enabled</span>
              </label>

              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={value.videoEnabled}
                  onChange={(e) => onChange({ ...value, videoEnabled: e.target.checked })}
                />
                <span className={labelCls}>Video enabled</span>
              </label>

              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={value.echoCancellation}
                  onChange={(e) =>
                    onChange({ ...value, echoCancellation: e.target.checked })
                  }
                />
                <span className={labelCls}>Echo cancellation</span>
              </label>

              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={value.noiseSuppression}
                  onChange={(e) =>
                    onChange({ ...value, noiseSuppression: e.target.checked })
                  }
                />
                <span className={labelCls}>Noise suppression</span>
              </label>

              <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
                <input
                  type="checkbox"
                  checked={value.autoGainControl}
                  onChange={(e) =>
                    onChange({ ...value, autoGainControl: e.target.checked })
                  }
                />
                <span className={labelCls}>Auto gain control</span>
              </label>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={onRefreshDevices}
                className={`h-10 px-4 rounded-2xl text-[13px] ${btnGhost}`}
              >
                Refresh devices
              </button>

              <div className={`text-[12px] ${labelCls}`}>
                Tip: allow mic/cam to see device names
              </div>
            </div>
          </div>
        </div>

        <div
          className={`px-6 py-5 border-t flex items-center justify-end gap-3 ${isLight ? "border-black/10" : "border-white/10"
            }`}
        >
          <button
            onClick={onCancel}
            className={`h-11 px-5 rounded-2xl text-[13px] font-semibold ${btnGhost}`}
          >
            Cancel
          </button>
          <button
            onClick={onJoin}
            className={`h-11 px-6 rounded-2xl text-[13px] font-semibold ${btnPrimary}`}
          >
            Join room
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- ErrorBoundary to avoid full-page crash if LiveKit UI throws ----
class LiveKitErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset: () => void; isLight: boolean },
  { hasError: boolean; errorText: string }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, errorText: "" };
  }
  static getDerivedStateFromError(err: any) {
    return { hasError: true, errorText: String(err?.message || err || "LiveKit error") };
  }
  componentDidCatch(err: any) {
    console.error("LiveKit UI crashed:", err);
  }
  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-3 px-6">
        <div className="text-red-500 font-semibold">LiveKit UI crashed</div>
        <div className="text-xs opacity-80 break-words text-center">
          {this.state.errorText}
        </div>
        <button
          onClick={() => {
            this.setState({ hasError: false, errorText: "" });
            this.props.onReset();
          }}
          className={
            this.props.isLight
              ? "px-4 py-2 rounded-xl bg-black/5 hover:bg-black/10"
              : "px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10"
          }
        >
          Reset + retry
        </button>
      </div>
    );
  }
}

// ---- Minimal custom controls (avoid LK ControlBar / persistent user choices) ----
function LiveKitControls({
  theme,
  onLeave,
}: {
  theme: RoomTheme;
  onLeave: () => void;
}) {
  const isLight = theme === "light";
  const room = useRoomContext();
  const lp = useLocalParticipant();

  // These are present in current LK components versions; fallback to safe booleans.
  const micOn = Boolean((lp as any)?.isMicrophoneEnabled);
  const camOn = Boolean((lp as any)?.isCameraEnabled);
  const ssOn = Boolean((lp as any)?.isScreenShareEnabled);

  const btnBase = isLight
    ? "px-3 py-2 rounded-xl bg-black/5 hover:bg-black/10 text-black/80"
    : "px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/85";

  const btnRed = "px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold";

  const toggleMic = async () => {
    try {
      await room.localParticipant.setMicrophoneEnabled(!micOn);
    } catch (e) {
      console.error("toggleMic error:", e);
    }
  };

  const toggleCam = async () => {
    try {
      await room.localParticipant.setCameraEnabled(!camOn);
    } catch (e) {
      console.error("toggleCam error:", e);
    }
  };

  const toggleSS = async () => {
    try {
      await room.localParticipant.setScreenShareEnabled(!ssOn);
    } catch (e) {
      console.error("toggleScreenShare error:", e);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={toggleMic} className={btnBase} title="Toggle microphone">
        {micOn ? "🎤 Mic on" : "🔇 Mic off"}
      </button>
      <button onClick={toggleCam} className={btnBase} title="Toggle camera">
        {camOn ? "📷 Cam on" : "🚫 Cam off"}
      </button>
      <button onClick={toggleSS} className={btnBase} title="Toggle screen share">
        {ssOn ? "🖥️ Sharing" : "🖥️ Share"}
      </button>
      <button onClick={onLeave} className={btnRed} title="Leave">
        Leave
      </button>
    </div>
  );
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

  // KEY FIX: run sync ensure BEFORE any LK UI render
  const [lkStorageReady] = useState<boolean>(() => {
    ensureLiveKitLocalStorageSafeSync();
    return true;
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
    } catch { }
  }, [theme]);

  const isLight = theme === "light";
  const pageBg = isLight ? "bg-[#F6F7FB] text-[#0B1220]" : "bg-[#050F1A] text-white";
  const panelBg = isLight
    ? "bg-white/85 border border-black/10"
    : "bg-[#0B1220]/55 border border-white/5";

  const [session, setSession] = useState<SessionRow | null>(null);
  const [templatesCount, setTemplatesCount] = useState(0);
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

  // right panel
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
        .select(
          "*, host_profile:profiles!sessions_host_id_fkey(id, full_name, avatar_url, bio), session_templates(*)"
        )
        .eq("id", id)
        .single();

      if (data && !error) {
        const t = normalizeTemplates((data as any)?.session_templates);
        const norm = { ...(data as any), session_templates: t };
        setSession(norm as any);
        setTemplatesCount(t.length);
      }

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
        str((u as any)?.user_metadata?.full_name) ||
        str((u as any)?.user_metadata?.name) ||
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

  // enumerate devices
  const loadBrowserDevices = async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;

      // best effort: this helps reveal labels
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        s.getTracks().forEach((t) => t.stop());
      } catch { }

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
    loadBrowserDevices().catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session, displayName, userName, joinRequested]);

  // LiveKit env
  const lkServerUrl = String((import.meta as any)?.env?.VITE_LIVEKIT_URL || "").trim();
  const tokenEndpoint = String(
    (import.meta as any)?.env?.VITE_LIVEKIT_TOKEN_ENDPOINT || "/api/livekit/token"
  ).trim();

  // token + connect
  const [lkToken, setLkToken] = useState<string>("");
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState<string>("");

  const resetLiveKit = () => {
    setLkToken("");
    setTokenError("");
    setTokenLoading(false);
    ensureLiveKitLocalStorageSafeSync();
  };

  const requestToken = async () => {
    if (!session) return;
    setTokenError("");
    setTokenLoading(true);

    try {
      const pj = prejoinRef.current;
      const nameToUse = (pj.displayName || displayName || userName || "Guest").trim() || "Guest";

      const roomName = safeRoomName(`session-${session.id}`);
      const identity = safeIdentity(authUserId || nameToUse);

      const res = await fetch(tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName, identity, name: nameToUse }),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        const msg = `Token endpoint error: ${res.status} ${t || ""}`.trim();
        console.error(msg);
        setTokenError(msg);
        setTokenLoading(false);
        return;
      }

      const json = (await res.json()) as { token?: string };
      const tok = String(json.token || "");
      if (!tok) {
        setTokenError("Token endpoint returned empty token");
        setTokenLoading(false);
        return;
      }

      setLkToken(tok);
      setTokenLoading(false);
    } catch (e: any) {
      console.error("requestToken exception:", e);
      setTokenError(String(e?.message || e || "token_request_failed"));
      setTokenLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      if (!session) return;
      if (!joinRequested) return;
      if (lkToken) return;
      await requestToken();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, joinRequested]);

  if (loading) {
    return (
      <div className={`flex h-screen items-center justify-center ${pageBg}`}>
        Loading session...
      </div>
    );
  }

  if (!session) {
    return (
      <div className={`flex h-screen items-center justify-center ${pageBg}`}>
        <button onClick={() => navigate("/sessions")}>Back</button>
      </div>
    );
  }

  const ChatPanelAny = ChatPanel as any;

  const lkOptions: any = {
    publishDefaults: { simulcast: true },
    audioCaptureDefaults: {
      deviceId: prejoin.audioInputId ? { exact: prejoin.audioInputId } : undefined,
      echoCancellation: prejoin.echoCancellation,
      noiseSuppression: prejoin.noiseSuppression,
      autoGainControl: prejoin.autoGainControl,
    },
    videoCaptureDefaults: {
      deviceId: prejoin.videoInputId ? { exact: prejoin.videoInputId } : undefined,
    },
  };

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
          {/* top bar */}
          <div className={`rounded-2xl px-4 py-3 ${panelBg}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-inter font-semibold text-[16px] sm:text-[18px] truncate">
                  {session.title || "Session"}
                </div>
                <div className={isLight ? "text-black/50 text-xs" : "text-white/50 text-xs"}>
                  LiveKit room: session-{session.id} (limit {maxParticipants})
                </div>

                <div className={isLight ? "text-black/40 text-[11px]" : "text-white/40 text-[11px]"}>
                  LK_URL: {lkServerUrl || "(missing)"} • token: {tokenEndpoint} • templates:{" "}
                  {templatesCount} • storage: {lkStorageReady ? "ok" : "…"}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                  className={
                    isLight ? "px-3 py-2 rounded-xl bg-black/5" : "px-3 py-2 rounded-xl bg-white/5"
                  }
                  title="Toggle theme"
                >
                  {theme === "dark" ? "🌙" : "☀️"}
                </button>

                <button
                  onClick={() => openRightTab("chat")}
                  className={
                    isLight ? "px-3 py-2 rounded-xl bg-black/5" : "px-3 py-2 rounded-xl bg-white/5"
                  }
                >
                  Chat
                </button>

                <button
                  onClick={() => openRightTab("intentions")}
                  className={
                    isLight ? "px-3 py-2 rounded-xl bg-black/5" : "px-3 py-2 rounded-xl bg-white/5"
                  }
                >
                  Intentions
                </button>
              </div>
            </div>

            <div className="mt-3">
              <SessionStageBar
                stages={[]}
                startTime={String(session.start_time || session.created_at || new Date().toISOString())}
                onHoverStage={() => { }}
              />
            </div>
          </div>

          <div
            className={
              "relative grid grid-rows-1 gap-3 flex-1 min-h-0 h-full " +
              (rightPanelOpen ? "lg:grid-cols-[minmax(0,1fr),380px]" : "grid-cols-1")
            }
          >
            {/* VIDEO */}
            <div
              className={`relative rounded-2xl overflow-hidden min-h-0 h-full ${isLight ? "bg-white/70 border border-black/10" : "bg-[#0B1220]/45 border border-white/5"
                }`}
            >
              {!joinRequested ? (
                <div className="h-full w-full flex flex-col items-center justify-center opacity-80 text-sm gap-2">
                  <div>Waiting for join…</div>
                  <button
                    onClick={() => setPrejoinOpen(true)}
                    className={isLight ? "px-4 py-2 rounded-xl bg-black/5" : "px-4 py-2 rounded-xl bg-white/5"}
                  >
                    Open join dialog
                  </button>
                </div>
              ) : !lkServerUrl ? (
                <div className="h-full w-full flex flex-col items-center justify-center text-sm text-red-500 gap-2">
                  <div>Missing VITE_LIVEKIT_URL</div>
                  <div className="text-xs opacity-80">Set it in Vercel env + .env.local</div>
                </div>
              ) : tokenLoading ? (
                <div className="h-full w-full flex items-center justify-center opacity-70 text-sm">
                  Getting token…
                </div>
              ) : tokenError ? (
                <div className="h-full w-full flex flex-col items-center justify-center text-sm gap-3 px-6">
                  <div className="text-red-500 font-semibold">Token error</div>
                  <div className="text-xs opacity-80 break-words text-center">{tokenError}</div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => requestToken()}
                      className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                    >
                      Retry
                    </button>
                    <button
                      onClick={() => {
                        resetLiveKit();
                        requestToken();
                      }}
                      className={
                        isLight ? "px-4 py-2 rounded-xl bg-black/5 hover:bg-black/10" : "px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10"
                      }
                    >
                      Reset
                    </button>
                  </div>
                </div>
              ) : !lkToken ? (
                <div className="h-full w-full flex items-center justify-center opacity-70 text-sm">
                  Token is empty…
                </div>
              ) : (
                <LiveKitErrorBoundary
                  isLight={isLight}
                  onReset={() => {
                    resetLiveKit();
                    requestToken();
                  }}
                >
                  <LiveKitRoom
                    key={`${session.id}:${lkToken.slice(0, 12)}`}
                    serverUrl={lkServerUrl}
                    token={lkToken}
                    connect={true}
                    video={prejoin.videoEnabled}
                    audio={prejoin.audioEnabled}
                    options={lkOptions}
                    data-theme={theme}
                    style={{ height: "100%", width: "100%" }}
                    onDisconnected={() => setLkToken("")}
                  >
                    <div className="h-full w-full flex flex-col min-h-0">
                      <div className="flex-1 min-h-0 p-2">
                        <GridLayout className="h-full w-full">
                          <ParticipantTile />
                        </GridLayout>
                      </div>

                      <div className="p-2 flex items-center justify-between gap-3">
                        <LiveKitControls
                          theme={theme}
                          onLeave={() => navigate("/sessions", { replace: true })}
                        />

                        <button
                          onClick={() => openRightTab("chat")}
                          className={
                            isLight ? "px-3 py-2 rounded-xl bg-black/5 hover:bg-black/10" : "px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10"
                          }
                          title="Toggle chat panel"
                        >
                          💬
                        </button>
                      </div>
                    </div>
                  </LiveKitRoom>
                </LiveKitErrorBoundary>
              )}
            </div>

            {/* RIGHT PANEL */}
            {rightPanelOpen && (
              <div className="min-h-0 h-full overflow-hidden">
                <div
                  className={`rounded-2xl shadow-lg overflow-hidden min-h-0 h-full flex flex-col ${panelBg}`}
                  data-theme={theme}
                >
                  <div
                    className={`px-4 py-3 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"
                      }`}
                  >
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
                        <div
                          data-theme={theme}
                          style={{ colorScheme: theme }}
                          className={theme === "dark" ? "dark h-full min-h-0" : "h-full min-h-0"}
                        >
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
                        <div
                          data-theme={theme}
                          style={{ colorScheme: theme }}
                          className={theme === "dark" ? "dark h-full min-h-0" : "h-full min-h-0"}
                        >
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

        {/* leave */}
        <div className="fixed bottom-3 right-3 z-50">
          <button
            onClick={() => navigate("/sessions", { replace: true })}
            className="px-4 py-3 rounded-2xl bg-red-600 text-white font-semibold"
          >
            Leave
          </button>
        </div>
      </div>
    </>
  );
}

export default RoomPageLiveKit;