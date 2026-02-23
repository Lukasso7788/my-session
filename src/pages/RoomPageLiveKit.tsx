// src/pages/RoomPageLiveKit.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Room, RoomEvent, Track, RemoteParticipant, LocalParticipant } from "livekit-client";

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

// ---- ErrorBoundary ----
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

// ---- Tiny video tile ----
function VideoTile({
  label,
  videoTrack,
  isLocal,
  theme,
}: {
  label: string;
  videoTrack?: Track;
  isLocal: boolean;
  theme: RoomTheme;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const isLight = theme === "light";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // detach anything old
    try {
      // @ts-ignore
      if (typeof (videoTrack as any)?.detach === "function") {
        // @ts-ignore
        (videoTrack as any).detach(el);
      }
    } catch { }

    if (!videoTrack) return;

    try {
      // @ts-ignore
      (videoTrack as any).attach(el);
    } catch (e) {
      console.error("attach video failed:", e);
    }

    return () => {
      try {
        // @ts-ignore
        if (typeof (videoTrack as any)?.detach === "function") {
          // @ts-ignore
          (videoTrack as any).detach(el);
        }
      } catch { }
    };
  }, [videoTrack]);

  return (
    <div
      className={
        "relative rounded-2xl overflow-hidden border " +
        (isLight ? "border-black/10 bg-white/70" : "border-white/10 bg-black/20")
      }
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={isLocal} // local must be muted to avoid echo
        className="w-full h-full object-cover"
      />
      <div
        className={
          "absolute left-2 bottom-2 px-2 py-1 rounded-lg text-[11px] " +
          (isLight ? "bg-white/80 text-black" : "bg-black/50 text-white")
        }
      >
        {label}{isLocal ? " (you)" : ""}
      </div>
    </div>
  );
}

type TileModel = {
  id: string;
  label: string;
  isLocal: boolean;
  videoTrack?: Track;
};

// ---- MAIN ----
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

  // ---- livekit-client room ----
  const roomRef = useRef<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [clientError, setClientError] = useState<string>("");

  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);

  const [tiles, setTiles] = useState<TileModel[]>([]);

  const rebuildTiles = () => {
    const room = roomRef.current;
    if (!room) return;

    const next: TileModel[] = [];

    // local
    const lp = room.localParticipant;
    const localCamPub = Array.from(lp.videoTrackPublications.values()).find(
      (p) => p.source === Track.Source.Camera
    );
    const localTrack = (localCamPub?.track as any) || undefined;

    next.push({
      id: "local",
      label: (displayName || userName || "You").trim() || "You",
      isLocal: true,
      videoTrack: localTrack,
    });

    // remotes
    room.remoteParticipants.forEach((rp: RemoteParticipant) => {
      const camPub = Array.from(rp.videoTrackPublications.values()).find(
        (p) => p.source === Track.Source.Camera
      );
      const vt = (camPub?.track as any) || undefined;

      const nm = (rp.name || rp.identity || "Guest").trim() || "Guest";
      next.push({
        id: rp.sid,
        label: nm,
        isLocal: false,
        videoTrack: vt,
      });
    });

    setTiles(next);
  };

  const disconnectRoom = async () => {
    try {
      const r = roomRef.current;
      roomRef.current = null;
      if (r) {
        r.removeAllListeners();
        await r.disconnect();
      }
    } catch (e) {
      console.warn("disconnect error:", e);
    } finally {
      setConnected(false);
      setMicOn(false);
      setCamOn(false);
      setTiles([]);
    }
  };

  const connectRoom = async () => {
    if (!lkServerUrl || !lkToken) return;

    setClientError("");
    await disconnectRoom();

    try {
      const pj = prejoinRef.current;

      const r = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      roomRef.current = r;

      r.on(RoomEvent.Connected, () => {
        setConnected(true);
        rebuildTiles();
      });

      r.on(RoomEvent.Disconnected, () => {
        setConnected(false);
        setTiles([]);
      });

      const refresh = () => rebuildTiles();

      // when tracks/participants change, rebuild
      r.on(RoomEvent.ParticipantConnected, refresh);
      r.on(RoomEvent.ParticipantDisconnected, refresh);
      r.on(RoomEvent.TrackSubscribed, refresh);
      r.on(RoomEvent.TrackUnsubscribed, refresh);
      r.on(RoomEvent.LocalTrackPublished, refresh);
      r.on(RoomEvent.LocalTrackUnpublished, refresh);
      r.on(RoomEvent.TrackPublished, refresh);
      r.on(RoomEvent.TrackUnpublished, refresh);

      await r.connect(lkServerUrl, lkToken, {
        autoSubscribe: true,
      });

      // enable devices based on prejoin
      if (pj.audioEnabled) {
        await r.localParticipant.setMicrophoneEnabled(true, {
          deviceId: pj.audioInputId || undefined,
        } as any);
        setMicOn(true);
      } else {
        await r.localParticipant.setMicrophoneEnabled(false);
        setMicOn(false);
      }

      if (pj.videoEnabled) {
        await r.localParticipant.setCameraEnabled(true, {
          deviceId: pj.videoInputId || undefined,
        } as any);
        setCamOn(true);
      } else {
        await r.localParticipant.setCameraEnabled(false);
        setCamOn(false);
      }

      rebuildTiles();
    } catch (e: any) {
      console.error("LiveKit connect failed:", e);
      setClientError(String(e?.message || e || "connect_failed"));
      await disconnectRoom();
    }
  };

  // connect after token ready
  useEffect(() => {
    if (!joinRequested) return;
    if (!lkToken) return;
    if (!lkServerUrl) return;
    connectRoom().catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinRequested, lkToken, lkServerUrl]);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      disconnectRoom().catch(() => { });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMic = async () => {
    const r = roomRef.current;
    if (!r) return;
    try {
      const next = !micOn;
      await r.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
    } catch (e) {
      console.error("toggleMic error:", e);
    }
  };

  const toggleCam = async () => {
    const r = roomRef.current;
    if (!r) return;
    try {
      const next = !camOn;
      await r.localParticipant.setCameraEnabled(next);
      setCamOn(next);
      rebuildTiles();
    } catch (e) {
      console.error("toggleCam error:", e);
    }
  };

  const leave = async () => {
    await disconnectRoom();
    navigate("/sessions", { replace: true });
  };

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
                  LiveKit room: session-{session.id} (limit {maxParticipants}) • {connected ? "connected" : "not connected"}
                </div>
                <div className={isLight ? "text-black/40 text-[11px]" : "text-white/40 text-[11px]"}>
                  LK_URL: {lkServerUrl || "(missing)"} • token: {tokenEndpoint} • templates: {templatesCount}
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
                  <button
                    onClick={() => requestToken()}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                  >
                    Retry
                  </button>
                </div>
              ) : clientError ? (
                <LiveKitErrorBoundary
                  isLight={isLight}
                  onReset={() => {
                    setClientError("");
                    connectRoom().catch(() => { });
                  }}
                >
                  <div className="h-full w-full flex flex-col items-center justify-center gap-3 px-6">
                    <div className="text-red-500 font-semibold">LiveKit connect failed</div>
                    <div className="text-xs opacity-80 break-words text-center">{clientError}</div>
                    <button
                      onClick={() => connectRoom()}
                      className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                    >
                      Retry connect
                    </button>
                  </div>
                </LiveKitErrorBoundary>
              ) : (
                <>
                  <div className="h-full w-full p-2 flex flex-col min-h-0">
                    <div className="flex-1 min-h-0">
                      <div className="h-full w-full grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr">
                        {tiles.map((t) => (
                          <VideoTile
                            key={t.id}
                            label={t.label}
                            videoTrack={t.videoTrack}
                            isLocal={t.isLocal}
                            theme={theme}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={toggleMic}
                          className={
                            isLight
                              ? "px-3 py-2 rounded-xl bg-black/5 hover:bg-black/10 text-black/80"
                              : "px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/85"
                          }
                        >
                          {micOn ? "🎤 Mic on" : "🔇 Mic off"}
                        </button>

                        <button
                          onClick={toggleCam}
                          className={
                            isLight
                              ? "px-3 py-2 rounded-xl bg-black/5 hover:bg-black/10 text-black/80"
                              : "px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/85"
                          }
                        >
                          {camOn ? "📷 Cam on" : "🚫 Cam off"}
                        </button>

                        <button
                          onClick={leave}
                          className="px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold"
                        >
                          Leave
                        </button>
                      </div>

                      <button
                        onClick={() => openRightTab("chat")}
                        className={
                          isLight
                            ? "px-3 py-2 rounded-xl bg-black/5 hover:bg-black/10"
                            : "px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10"
                        }
                        title="Toggle chat panel"
                      >
                        💬
                      </button>
                    </div>
                  </div>
                </>
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
            onClick={leave}
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