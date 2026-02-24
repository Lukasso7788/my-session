// src/pages/RoomPageLiveKit.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Room,
  RoomEvent,
  Track,
  RemoteParticipant,
  LocalVideoTrack,
  RemoteAudioTrack,
  RemoteAudioTrackPublication,
  LocalTrackPublication,
  RemoteTrackPublication,
  createLocalVideoTrack,
} from "livekit-client";

import { supabase } from "../lib/supabase";
import ChatPanel from "../components/ChatPanel";
import { IntentionsPanel } from "../components/IntentionsPanel";
import { SessionStageBar } from "../components/SessionStageBar";
import { UserProfileModal } from "../components/UserProfileModal";

type RoomTheme = "dark" | "light";
type RightPanelTab = "participants" | "chat" | "intentions" | null;
type FxMode = "off" | "blur" | "bg";

type ReactionType =
  | "fire"
  | "laugh"
  | "clap"
  | "heart"
  | "thumbsUp"
  | "thumbsDown";

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
  host_id?: string | null;
};

type Stage = {
  name: string;
  duration: number; // minutes (display / legacy)
  color: string;
  type: "intro" | "intentions" | "focus" | "break" | "outro" | string;
  durationSeconds?: number; // preferred when present
};

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

type HostTileActions = {
  canMuteMic: boolean;
  canMuteCam: boolean;
  micMuted?: boolean;
  camMuted?: boolean;
  onToggleMuteMic?: () => void;
  onToggleMuteCam?: () => void;
  onKick?: () => void;
  busy?: boolean;
};

type TileModel = {
  id: string;
  label: string;
  isLocal: boolean;
  videoTrack?: Track;

  participantIdentity?: string;
  micTrackSid?: string;
  camTrackSid?: string;
  micMuted?: boolean;
  camMuted?: boolean;
};

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

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeParseJson(raw: unknown): unknown | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s || s === "undefined" || s === "null") return null;
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return null;
    }
  }
  return raw;
}

function parse50505(raw: unknown): { focus: number; break: number; intentions: number } | null {
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

/**
 * Normalize labels like:
 * - "check-in" -> "checkin"
 * - "check in" -> "checkin"
 * - "check_in" -> "checkin"
 */
function normalizeKey(v: unknown): string {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function inferStageTypeFromLabel(raw: string): Stage["type"] {
  const k = normalizeKey(raw);

  if (!k) return "focus";

  if (k.includes("welcome") || k.includes("intro")) return "intro";
  if (
    k.includes("outro") ||
    k.includes("farewell") ||
    k.includes("celebrat") ||
    k.includes("finish") ||
    k.includes("end")
  ) {
    return "outro";
  }

  if (k.includes("checkin") || k.includes("intention") || k.includes("checkinspoken")) {
    return "intentions";
  }

  if (k.includes("break") || k.includes("rest") || k.includes("pause")) return "break";

  if (
    k.includes("focus") ||
    k.includes("work") ||
    k.includes("deepwork") ||
    k.includes("pomodoro")
  ) {
    return "focus";
  }

  return "focus";
}

function isCheckInLikeLabel(raw: string): boolean {
  const k = normalizeKey(raw);
  return k.includes("checkin");
}

function normalizeInfinitePhases(anyPhases: unknown): { name: string; seconds: number }[] {
  if (!anyPhases) return [];

  const toSeconds = (raw: unknown): number => {
    if (isRecord(raw)) {
      const explicitSeconds =
        num(raw.seconds) || num(raw.duration_seconds) || num(raw.durationSeconds);
      if (explicitSeconds > 0) return explicitSeconds;

      const explicitMinutes =
        num(raw.minutes) ||
        num(raw.mins) ||
        num(raw.duration_minutes) ||
        num(raw.durationMinutes);
      if (explicitMinutes > 0) return explicitMinutes * 60;

      const n = num(raw.duration ?? raw.value ?? raw);
      if (!Number.isFinite(n) || n <= 0) return 0;

      if (n <= 180) return n * 60;
      return n;
    }

    const n = num(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (n <= 180) return n * 60;
    return n;
  };

  if (Array.isArray(anyPhases)) {
    return anyPhases
      .map((p) => {
        const name = isRecord(p) ? str(p.name || p.key || p.type) : "";
        const seconds = toSeconds(p);
        return { name, seconds };
      })
      .filter((x) => x.seconds > 0);
  }

  if (isRecord(anyPhases)) {
    return Object.entries(anyPhases)
      .map(([k, v]) => {
        const name = String(k || "");
        const seconds =
          typeof v === "number"
            ? v <= 180
              ? Number(v) * 60
              : Number(v)
            : toSeconds(v);
        return { name, seconds };
      })
      .filter((x) => x.seconds > 0);
  }

  return [];
}

function phaseToStageType(phaseName: string): Stage["type"] {
  const k = normalizeKey(phaseName);

  if (k.includes("welcome") || k.includes("intro")) return "intro";
  if (
    k.includes("outro") ||
    k.includes("farewell") ||
    k.includes("celebrat") ||
    k.includes("finish") ||
    k.includes("end")
  ) {
    return "outro";
  }

  if (k.includes("checkin") || k.includes("intention")) return "intentions";
  if (k.includes("break") || k.includes("rest") || k.includes("pause")) return "break";
  if (
    k.includes("focus") ||
    k.includes("work") ||
    k.includes("deepwork") ||
    k.includes("pomodoro")
  ) {
    return "focus";
  }

  return "focus";
}

const STAGE_COLORS: Record<string, string> = {
  intro: "#80DF86",
  intentions: "#ADD3FF",
  focus: "#4CA0FF",
  break: "#F9ADA2",
  outro: "#80DF86",
};

function getTemplateFirst(tpl: SessionRow["session_templates"]): SessionTemplate | null {
  if (!tpl) return null;
  return Array.isArray(tpl) ? tpl[0] ?? null : tpl;
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
  | "reaction"
  | "leave"
  | "participants"
  | "chat"
  | "intentions"
  | "settings"
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

function ParticipantsSmartIcon({
  theme,
  className = "w-4 h-4",
}: {
  theme: RoomTheme;
  className?: string;
}) {
  return <Icon name="participants" theme={theme} className={className} alt="" />;
}

const reactionEmoji: Record<ReactionType, string> = {
  fire: "🔥",
  laugh: "😂",
  clap: "👏",
  heart: "❤️",
  thumbsUp: "👍",
  thumbsDown: "👎",
};

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

// ---- PreJoin ----
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
          className={`px-6 py-5 border-b ${isLight ? "border-black/10" : "border-white/10"}`}
        >
          <div className="flex items-center justify-between">
            <div className="font-inter font-semibold text-[16px]">Before you join</div>
            <button
              onClick={onCancel}
              className={`w-9 h-9 rounded-2xl flex items-center justify-center ${btnGhost}`}
              title="Close"
            >
              ✕
            </button>
          </div>
          <div className={`mt-1 text-[12px] ${labelCls}`}>Pick devices + name. Then join.</div>
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
                  onChange={(e) => onChange({ ...value, echoCancellation: e.target.checked })}
                />
                <span className={labelCls}>Echo cancellation</span>
              </label>

              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={value.noiseSuppression}
                  onChange={(e) => onChange({ ...value, noiseSuppression: e.target.checked })}
                />
                <span className={labelCls}>Noise suppression</span>
              </label>

              <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
                <input
                  type="checkbox"
                  checked={value.autoGainControl}
                  onChange={(e) => onChange({ ...value, autoGainControl: e.target.checked })}
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

              <div className={`text-[12px] ${labelCls}`}>Tip: allow mic/camera to see device names</div>
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
    return {
      hasError: true,
      errorText: String(err?.message || err || "LiveKit error"),
    };
  }
  componentDidCatch(err: any) {
    console.error("LiveKit UI crashed:", err);
  }
  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-3 px-6">
        <div className="text-red-500 font-semibold">LiveKit UI crashed</div>
        <div className="text-xs opacity-80 break-words text-center">{this.state.errorText}</div>
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

// ---- default background (data url) ----
const DEFAULT_BG_DATA_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1220"/>
      <stop offset="0.5" stop-color="#0b3b6f"/>
      <stop offset="1" stop-color="#041018"/>
    </linearGradient>
    <radialGradient id="r" cx="30%" cy="30%" r="70%">
      <stop offset="0" stop-color="#38bdf8" stop-opacity="0.25"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#g)"/>
  <rect width="1280" height="720" fill="url(#r)"/>
  <circle cx="980" cy="210" r="240" fill="#22c55e" opacity="0.08"/>
  <circle cx="420" cy="520" r="320" fill="#a78bfa" opacity="0.07"/>
</svg>
`);

function makeBgPresetDataUrl(a: string, b: string, c: string, d: string) {
  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/>
      <stop offset="0.5" stop-color="${b}"/>
      <stop offset="1" stop-color="${c}"/>
    </linearGradient>
    <radialGradient id="r" cx="25%" cy="25%" r="80%">
      <stop offset="0" stop-color="${d}" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#g)"/>
  <rect width="1280" height="720" fill="url(#r)"/>
  <circle cx="1030" cy="170" r="230" fill="#ffffff" opacity="0.04"/>
  <circle cx="360" cy="520" r="310" fill="#ffffff" opacity="0.03"/>
</svg>
`)
  );
}

const FX_BG_PRESETS = [
  {
    id: "ocean",
    label: "Ocean",
    url: makeBgPresetDataUrl("#081226", "#123a76", "#031019", "#38bdf8"),
  },
  {
    id: "forest",
    label: "Forest",
    url: makeBgPresetDataUrl("#07160f", "#124b2c", "#040d08", "#22c55e"),
  },
  {
    id: "violet",
    label: "Violet",
    url: makeBgPresetDataUrl("#120a22", "#3b2378", "#090512", "#a78bfa"),
  },
  {
    id: "sunset",
    label: "Sunset",
    url: makeBgPresetDataUrl("#1c0d10", "#7c2d12", "#11070a", "#fb7185"),
  },
];

// ---- Settings Modal (FX only, renamed to parity "Settings") ----
function RoomSettingsModalLiveKit({
  open,
  theme,
  mode,
  blurStrength,
  onBlurStrengthChange,
  bgImageUrl,
  onSetBgImageUrl,
  onApplyMode,
  onClose,
  fxError,
  fxApplying,
  fxStatusText,
  onUploadBg,
  onResetBg,
}: {
  open: boolean;
  theme: RoomTheme;
  mode: FxMode;
  blurStrength: number;
  onBlurStrengthChange: (v: number) => void;
  bgImageUrl: string;
  onSetBgImageUrl: (url: string) => void;
  onApplyMode: (m: FxMode) => void;
  onClose: () => void;
  fxError: string;
  fxApplying: boolean;
  fxStatusText: string;
  onUploadBg: (file: File) => void;
  onResetBg: () => void;
}) {
  if (!open) return null;

  const isLight = theme === "light";
  const overlay = "fixed inset-0 z-[1001] flex items-center justify-center px-3";
  const backdrop = "absolute inset-0 bg-black/60";
  const card = [
    "relative w-full max-w-[680px] rounded-3xl shadow-2xl overflow-hidden",
    isLight
      ? "bg-white text-black border border-black/10"
      : "bg-[#020617] text-white border border-white/10",
  ].join(" ");

  const inputWrap = isLight
    ? "bg-black/5 border border-black/10"
    : "bg-white/5 border border-white/10";
  const ghostBtn = isLight
    ? "bg-black/5 hover:bg-black/10 text-black/80"
    : "bg-white/5 hover:bg-white/10 text-white/85";
  const activeBtn = isLight ? "bg-blue-600 text-white" : "bg-emerald-500 text-[#03110a]";
  const subtleText = isLight ? "text-black/60" : "text-white/60";

  return (
    <div className={overlay} data-theme={theme} style={{ colorScheme: theme }}>
      <div className={backdrop} onClick={onClose} />
      <div className={card}>
        <div
          className={`px-6 py-5 border-b ${isLight ? "border-black/10" : "border-white/10"}`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-[16px]">Settings</div>
              <div className={`text-[12px] mt-1 ${subtleText}`}>
                Background blur / virtual background for your LiveKit camera.
              </div>
            </div>
            <button onClick={onClose} className={`w-9 h-9 rounded-2xl ${ghostBtn}`}>
              ✕
            </button>
          </div>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          <div className={`rounded-2xl p-4 ${inputWrap}`}>
            <div className="text-[13px] font-semibold mb-3">Effect mode</div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onApplyMode("off")}
                className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${mode === "off" ? activeBtn : ghostBtn
                  }`}
                disabled={fxApplying}
              >
                FX off
              </button>
              <button
                onClick={() => onApplyMode("blur")}
                className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${mode === "blur" ? activeBtn : ghostBtn
                  }`}
                disabled={fxApplying}
              >
                Blur
              </button>
              <button
                onClick={() => onApplyMode("bg")}
                className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${mode === "bg" ? activeBtn : ghostBtn
                  }`}
                disabled={fxApplying}
              >
                Background image
              </button>
            </div>

            <div className={`mt-3 text-[12px] ${subtleText}`}>
              {fxApplying ? "Applying effect…" : fxStatusText || "Ready"}
            </div>
            {fxError ? <div className="mt-2 text-[12px] text-red-500 break-words">{fxError}</div> : null}
          </div>

          <div className={`rounded-2xl p-4 ${inputWrap}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-semibold">Blur strength</div>
                <div className={`text-[12px] mt-1 ${subtleText}`}>Used when Blur mode is active.</div>
              </div>
              <div className="text-[13px] font-semibold">{blurStrength}</div>
            </div>

            <input
              type="range"
              min={4}
              max={30}
              step={1}
              value={blurStrength}
              onChange={(e) => onBlurStrengthChange(Number(e.target.value))}
              className="w-full mt-3"
            />
          </div>

          <div className={`rounded-2xl p-4 ${inputWrap}`}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <div className="text-[13px] font-semibold">Background presets</div>
                <div className={`text-[12px] mt-1 ${subtleText}`}>
                  Used when Background image mode is active.
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={onResetBg}
                  className={`h-9 px-3 rounded-xl text-[12px] ${ghostBtn}`}
                  disabled={fxApplying}
                >
                  Reset
                </button>
                <label
                  className={`h-9 px-3 rounded-xl text-[12px] ${ghostBtn} cursor-pointer flex items-center`}
                >
                  Upload
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      onUploadBg(f);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {FX_BG_PRESETS.map((p) => {
                const selected = bgImageUrl === p.url;
                return (
                  <button
                    key={p.id}
                    onClick={() => onSetBgImageUrl(p.url)}
                    className={
                      "rounded-2xl overflow-hidden border text-left " +
                      (selected
                        ? isLight
                          ? "border-blue-500 ring-2 ring-blue-300"
                          : "border-emerald-400 ring-2 ring-emerald-300/25"
                        : isLight
                          ? "border-black/10"
                          : "border-white/10")
                    }
                    title={p.label}
                    disabled={fxApplying}
                  >
                    <div className="aspect-video w-full">
                      <img src={p.url} alt={p.label} className="w-full h-full object-cover" />
                    </div>
                    <div className={`px-2 py-2 text-[12px] ${isLight ? "bg-white" : "bg-[#0b1220]"}`}>
                      {p.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div
          className={`px-6 py-4 border-t flex items-center justify-end gap-3 ${isLight ? "border-black/10" : "border-white/10"
            }`}
        >
          <button onClick={onClose} className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${ghostBtn}`}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Video tile ----
function VideoTile({
  label,
  videoTrack,
  isLocal,
  theme,
  showBadge,
  hostActions,
}: {
  label: string;
  videoTrack?: Track;
  isLocal: boolean;
  theme: RoomTheme;
  showBadge?: string | null;
  hostActions?: HostTileActions;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const isLight = theme === "light";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let cleanupAttached = false;

    try {
      if (videoTrack && typeof (videoTrack as any)?.detach === "function") {
        (videoTrack as any).detach(el);
      }
    } catch { }
    try {
      el.pause();
    } catch { }
    try {
      (el as any).srcObject = null;
    } catch { }

    if (!videoTrack) return;

    try {
      if (typeof (videoTrack as any)?.attach === "function") {
        (videoTrack as any).attach(el);
        cleanupAttached = true;
      } else {
        console.warn("videoTrack.attach is not a function", videoTrack);
      }
    } catch (e) {
      console.error("attach video failed:", e);
    }

    return () => {
      try {
        if (cleanupAttached && typeof (videoTrack as any)?.detach === "function") {
          (videoTrack as any).detach(el);
        }
      } catch { }
      try {
        el.pause();
      } catch { }
      try {
        (el as any).srcObject = null;
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
      <div className="w-full aspect-video">
        {videoTrack ? (
          <video ref={ref} autoPlay playsInline muted={isLocal} className="w-full h-full object-cover" />
        ) : (
          <div
            className={
              "w-full h-full flex items-center justify-center text-sm " +
              (isLight ? "text-black/60 bg-black/5" : "text-white/60 bg-white/5")
            }
          >
            Camera off
          </div>
        )}
      </div>

      <div
        className={
          "absolute left-2 bottom-2 px-2 py-1 rounded-lg text-[11px] " +
          (isLight ? "bg-white/80 text-black" : "bg-black/50 text-white")
        }
      >
        {label}
        {isLocal ? " (you)" : ""}
      </div>

      {showBadge ? (
        <div
          className={
            "absolute right-2 top-2 px-2 py-1 rounded-lg text-[11px] font-semibold " +
            (isLight
              ? "bg-amber-200/80 text-amber-900"
              : "bg-amber-400/20 text-amber-200 border border-amber-300/20")
          }
        >
          {showBadge}
        </div>
      ) : null}

      {!isLocal && hostActions && (hostActions.canMuteMic || hostActions.canMuteCam) ? (
        <div className="absolute right-2 bottom-2 flex flex-wrap justify-end gap-1 max-w-[90%]">
          {hostActions.canMuteMic ? (
            <button
              onClick={hostActions.onToggleMuteMic}
              disabled={hostActions.busy}
              className={
                "px-2 py-1 rounded-lg text-[11px] border " +
                (isLight
                  ? "bg-white/85 text-black border-black/10 disabled:opacity-50"
                  : "bg-black/60 text-white border-white/10 disabled:opacity-50")
              }
              title="Mute / unmute remote microphone (host action)"
            >
              {hostActions.micMuted ? "Unmute mic" : "Mute mic"}
            </button>
          ) : null}

          {hostActions.canMuteCam ? (
            <button
              onClick={hostActions.onToggleMuteCam}
              disabled={hostActions.busy}
              className={
                "px-2 py-1 rounded-lg text-[11px] border " +
                (isLight
                  ? "bg-white/85 text-black border-black/10 disabled:opacity-50"
                  : "bg-black/60 text-white border-white/10 disabled:opacity-50")
              }
              title="Mute / unmute remote camera (host action)"
            >
              {hostActions.camMuted ? "Unmute cam" : "Mute cam"}
            </button>
          ) : null}

          <button
            onClick={hostActions.onKick}
            disabled={hostActions.busy}
            className="px-2 py-1 rounded-lg text-[11px] bg-red-600/90 hover:bg-red-700 text-white disabled:opacity-50"
            title="Remove participant from room"
          >
            Kick
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---- Remote audio renderer ----
function RemoteAudioRenderer({
  room,
  audioOutputId,
}: {
  room: Room | null;
  audioOutputId: string;
}) {
  const [tracks, setTracks] = useState<{ id: string; track: RemoteAudioTrack; label: string }[]>([]);

  const rebuild = () => {
    if (!room) {
      setTracks([]);
      return;
    }

    const next: { id: string; track: RemoteAudioTrack; label: string }[] = [];

    room.remoteParticipants.forEach((p: RemoteParticipant) => {
      p.audioTrackPublications.forEach((pub: RemoteAudioTrackPublication) => {
        if (pub.source !== Track.Source.Microphone) return;
        const t = pub.track;
        if (!t) return;
        const label = (p.name || p.identity || "Guest").trim() || "Guest";
        next.push({ id: `${p.sid}:${pub.trackSid}`, track: t, label });
      });
    });

    setTracks(next);
  };

  useEffect(() => {
    rebuild();
    if (!room) return;

    const onAny = () => rebuild();

    room.on(RoomEvent.ParticipantConnected, onAny);
    room.on(RoomEvent.ParticipantDisconnected, onAny);
    room.on(RoomEvent.TrackSubscribed, onAny);
    room.on(RoomEvent.TrackUnsubscribed, onAny);
    room.on(RoomEvent.Reconnected, onAny);

    return () => {
      room.off(RoomEvent.ParticipantConnected, onAny);
      room.off(RoomEvent.ParticipantDisconnected, onAny);
      room.off(RoomEvent.TrackSubscribed, onAny);
      room.off(RoomEvent.TrackUnsubscribed, onAny);
      room.off(RoomEvent.Reconnected, onAny);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  return (
    <>
      {tracks.map((t) => (
        <AudioEl key={t.id} track={t.track} audioOutputId={audioOutputId} debugLabel={t.label} />
      ))}
    </>
  );
}

function AudioEl({
  track,
  audioOutputId,
  debugLabel,
}: {
  track: RemoteAudioTrack;
  audioOutputId: string;
  debugLabel: string;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    try {
      track.attach(el);
    } catch (e) {
      console.error("attach audio failed:", e);
    }

    (async () => {
      try {
        const anyEl = el as any;
        if (audioOutputId && audioOutputId !== "default" && typeof anyEl.setSinkId === "function") {
          await anyEl.setSinkId(audioOutputId);
        }
      } catch {
        // ignore unsupported browsers
      }

      try {
        await el.play();
      } catch (e) {
        console.warn("audio play blocked for", debugLabel, e);
      }
    })();

    return () => {
      try {
        track.detach(el);
      } catch { }
    };
  }, [track, audioOutputId, debugLabel]);

  return <audio ref={ref} autoPlay playsInline />;
}

// ---- Track processors ----
function mergeModuleExports(mod: any): any {
  return {
    ...(mod?.default && typeof mod.default === "object" ? mod.default : {}),
    ...(mod || {}),
  };
}

let lkTrackProcessorsModulePromise: Promise<any> | null = null;

async function resolveTrackProcessorsModule(): Promise<any> {
  if (!lkTrackProcessorsModulePromise) {
    lkTrackProcessorsModulePromise = import("@livekit/track-processors").then((raw: any) => {
      const mod = mergeModuleExports(raw);
      try {
        console.log("[LK FX] @livekit/track-processors exports:", Object.keys(mod || {}));
      } catch { }
      return mod;
    });
  }
  return lkTrackProcessorsModulePromise;
}

async function ensureBackgroundProcessorsSupported(mod: any) {
  if (typeof mod?.supportsModernBackgroundProcessors === "function") {
    const ok = !!mod.supportsModernBackgroundProcessors();
    if (!ok) {
      // fallback check below
    }
  }
  if (typeof mod?.supportsBackgroundProcessors === "function") {
    const ok = await Promise.resolve(mod.supportsBackgroundProcessors());
    if (!ok) throw new Error("Background processors are not supported in this browser/device");
  }
}

async function makeBlurPipeline(blurRadius: number) {
  const mod = await resolveTrackProcessorsModule();
  await ensureBackgroundProcessorsSupported(mod);

  if (typeof mod?.BackgroundBlur === "function") {
    return mod.BackgroundBlur(blurRadius);
  }
  if (typeof mod?.default?.BackgroundBlur === "function") {
    return mod.default.BackgroundBlur(blurRadius);
  }

  throw new Error("BackgroundBlur() is unavailable in @livekit/track-processors");
}

async function makeVirtualBgPipeline(imagePath: string) {
  const mod = await resolveTrackProcessorsModule();
  await ensureBackgroundProcessorsSupported(mod);

  if (typeof mod?.VirtualBackground === "function") {
    return mod.VirtualBackground(imagePath);
  }
  if (typeof mod?.default?.VirtualBackground === "function") {
    return mod.default.VirtualBackground(imagePath);
  }

  throw new Error("VirtualBackground() is unavailable in @livekit/track-processors");
}

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
    } catch { }
  }, [theme]);

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

  const isLight = theme === "light";
  const isLgUp = useMediaQuery("(min-width: 1024px)");

  const pageBg = isLight ? "bg-[#F6F7FB] text-[#0B1220]" : "bg-[#050F1A] text-white";
  const topBarBg = isLight
    ? "bg-white/85 border border-black/10"
    : "bg-[#111827]/40 border border-white/5";
  const chipBg = isLight
    ? "bg-black/5 border border-black/10"
    : "bg-[#0B1220]/70 border border-white/5";
  const strongText = isLight ? "text-black/85" : "text-[#F3F4F6]/90";
  const panelBg = isLight
    ? "bg-white/85 border border-black/10"
    : "bg-[#0B1220]/55 border border-white/5";
  const bottomBarBg = isLight
    ? "bg-white/85 border border-black/10"
    : "bg-[#07101E]/85 border border-white/10";
  const ctlBtnBase = isLight
    ? "bg-black/5 hover:bg-black/10"
    : "bg-[#111827] hover:bg-[#1f2937]";

  const [session, setSession] = useState<SessionRow | null>(null);
  const [loading, setLoading] = useState(true);

  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [userName, setUserName] = useState("");
  const [displayName, setDisplayName] = useState("");

  const [selectedUser, setSelectedUser] = useState<HostProfile | null>(null);

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

  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState<string>("default");

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

  // session stages / timer / sounds (copied parity from RoomPage)
  const [stages, setStages] = useState<Stage[]>([]);
  const [, setHoveredStage] = useState<Stage | null>(null);
  const [currentStage, setCurrentStage] = useState(0);
  const [remainingTime, setRemainingTime] = useState<string>("");

  const [stagebarStartTime, setStagebarStartTime] = useState<string>("");
  const [stagebarCycleSeconds, setStagebarCycleSeconds] = useState<number | undefined>(undefined);

  const prevStageRef = useRef<number>(-1);
  const firstTickDoneRef = useRef<boolean>(false);
  const welcomeLoopRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef<boolean>(false);

  const STAGE_SOUND_MAP: Record<string, string> = {
    intentions: "/sounds/intentions.mp3",
    focus: "/sounds/focus.mp3",
    break: "/sounds/break_start.mp3",
    outro: "/sounds/outro.mp3",
  };
  const BREAK_END_SOUND = "/sounds/break_end.mp3";
  const WELCOME_LOOP_SOUND = "/sounds/welcome_loop.mp3";

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

  const maxParticipants = useMemo(() => {
    const raw = num((session as any)?.max_participants);
    const v = raw > 0 ? raw : 16;
    return Math.max(2, Math.min(50, Math.round(v)));
  }, [session]);

  const isInfiniteRoom = useMemo(() => {
    const raw = session?.schedule;
    if (parse50505(raw)) return true;

    const parsed = safeParseJson(raw);
    if (!isRecord(parsed)) return false;

    const kind = str(parsed.kind).toLowerCase();
    if (kind === "infinite_room") return true;
    if (kind.includes("infinite")) return true;

    if (isRecord(parsed.timer) && (parsed.timer.phases || parsed.timer.segments)) return true;
    if (parsed.phases || parsed.segments) return true;

    return false;
  }, [session]);

  const isSilentRoom = useMemo(() => {
    const fmt = str(session?.format).toLowerCase();
    const title = str(session?.title).toLowerCase();

    const tpl0 = getTemplateFirst(session?.session_templates ?? null);
    const tplName = str(tpl0?.name || tpl0?.title).toLowerCase();
    const tplKey = str(tpl0?.key || tpl0?.slug || tpl0?.type).toLowerCase();
    const tplFmt = str(tpl0?.format).toLowerCase();

    const hay = `${fmt} ${title} ${tplName} ${tplKey} ${tplFmt}`.toLowerCase();
    return hay.includes("silent");
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
      }

      setLoading(false);
    })();
  }, [id]);

  // build stages from Supabase schedule (copied parity from RoomPage)
  useEffect(() => {
    if (!session) return;

    setStages([]);
    setStagebarCycleSeconds(undefined);
    setStagebarStartTime("");

    const fallbackStart = String(session?.start_time || session?.created_at || new Date().toISOString());

    let parsed: unknown = safeParseJson(session.schedule);

    if (!parsed) {
      const t = parse50505(session.schedule);
      if (t) {
        parsed = {
          kind: "infinite_room",
          timer: { phases: { focus: t.focus, break: t.break, intentions: t.intentions } },
          anchor_ts: session?.start_time || session?.created_at || fallbackStart,
        };
      }
    }

    if (isRecord(parsed)) {
      const maybeBlocks =
        parsed.blocks || parsed.script || parsed.agenda || parsed.items || parsed.stages;
      if (Array.isArray(maybeBlocks)) parsed = maybeBlocks;
    }

    if (Array.isArray(parsed)) {
      const formatted: Stage[] = parsed
        .map((b): Stage | null => {
          const blk = isRecord(b) ? b : null;
          if (!blk) return null;

          const rawName =
            str(blk.name) ||
            str(blk.title) ||
            str(blk.label) ||
            str(blk.text) ||
            str(blk.key) ||
            "Stage";

          const rawType = str(blk.type) || str(blk.category);

          const inferredType: Stage["type"] = rawType
            ? inferStageTypeFromLabel(rawType)
            : inferStageTypeFromLabel(rawName);

          const minutes =
            num(blk.minutes) ||
            num(blk.mins) ||
            num(blk.duration_minutes) ||
            num(blk.durationMinutes) ||
            num(blk.durationMin) ||
            num(blk.duration) ||
            0;

          const seconds =
            num(blk.seconds) || num(blk.durationSeconds) || num(blk.duration_seconds) || 0;

          const durationSeconds = seconds > 0 ? seconds : minutes > 0 ? minutes * 60 : 0;
          const displayMinutes =
            minutes > 0 ? minutes : seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0;

          if (durationSeconds <= 0 || displayMinutes <= 0) return null;

          const color = str(blk.color) || STAGE_COLORS[inferredType] || "#F63135";

          return {
            name: rawName,
            duration: displayMinutes,
            color,
            type: inferredType,
            durationSeconds,
          };
        })
        .filter((x): x is Stage => !!x);

      setStages(formatted);
      setStagebarStartTime(String(session.start_time || fallbackStart));
      setStagebarCycleSeconds(undefined);
    }

    const isInfiniteScheduleObject =
      isRecord(parsed) &&
      (str(parsed.kind).toLowerCase().includes("infinite") ||
        (isRecord(parsed.timer) && (parsed.timer.phases || parsed.timer.segments)) ||
        !!parsed.phases ||
        !!parsed.segments);

    if (isInfiniteScheduleObject && isRecord(parsed)) {
      const timer = isRecord(parsed.timer) ? parsed.timer : null;

      const phasesRaw = (timer?.phases ?? timer?.segments ?? parsed.phases ?? parsed.segments) ?? null;
      const phases = normalizeInfinitePhases(phasesRaw);

      const formatted: Stage[] = phases.map((p) => {
        const rawPhaseName = String(p.name || "");
        const type = phaseToStageType(rawPhaseName);

        const displayName =
          type === "focus"
            ? "Focus"
            : type === "intentions"
              ? isCheckInLikeLabel(rawPhaseName)
                ? "Check-in"
                : "Intentions"
              : type === "break"
                ? "Break"
                : type === "intro"
                  ? "Intro"
                  : type === "outro"
                    ? "Outro"
                    : rawPhaseName || "Stage";

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
        str(parsed.anchor_ts) || str(parsed.anchorTs) || str(session?.start_time) || fallbackStart
      );
      setStagebarStartTime(anchor);

      const sumSeconds = phases.reduce((acc, p) => acc + (Number(p.seconds) || 0), 0);

      const timerCycle =
        timer && isRecord(timer) ? num(timer.cycle_seconds) || num(timer.cycleSeconds) : 0;

      let cycleSeconds =
        timerCycle || num(parsed.cycle_seconds) || num(parsed.cycleSeconds) || 0;

      if (!cycleSeconds || cycleSeconds <= 0) cycleSeconds = sumSeconds;
      if (cycleSeconds < sumSeconds) cycleSeconds = sumSeconds;

      setStagebarCycleSeconds(Math.max(1, cycleSeconds));
    }

    if (!parsed) setStagebarStartTime(fallbackStart);
  }, [session]);

  // stage timer + sounds
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
      const mins = Number(s.duration || 0);
      return mins > 0 ? mins * 60 : 0;
    });

    const sumStageSeconds = stageSeconds.reduce((acc, v) => acc + v, 0);
    const loopSeconds =
      (Number(stagebarCycleSeconds) || 0) > 0
        ? Number(stagebarCycleSeconds)
        : Math.max(1, sumStageSeconds);

    const timer = window.setInterval(() => {
      const now = Date.now();
      const diffSecRaw = (now - startMs) / 1000;

      const diffSec =
        loopSeconds > 0 && isInfiniteRoom
          ? ((diffSecRaw % loopSeconds) + loopSeconds) % loopSeconds
          : diffSecRaw;

      let total = 0;
      let active = 0;
      let found = false;

      for (let i = 0; i < stages.length; i++) {
        const dur = stageSeconds[i] || 0;
        const next = total + dur;

        if (dur <= 0) continue;

        if (diffSec < next) {
          active = i;
          const rem = next - diffSec;
          setRemainingTime(
            `${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(2, "0")}`
          );
          found = true;
          break;
        }

        total = next;
        active = i;
      }

      if (!found && !isInfiniteRoom) {
        setRemainingTime("0:00");
      }

      setCurrentStage(active);

      const stage = stages[active];

      if (!firstTickDoneRef.current) {
        if (stage?.type === "intro") startWelcomeLoop();
        else stopWelcomeLoop();

        prevStageRef.current = active;
        firstTickDoneRef.current = true;
        return;
      }

      if (prevStageRef.current !== active) {
        const prev = stages[prevStageRef.current];
        const prevType = prev?.type;
        const newType = stage?.type;

        if (prevType === "break" && newType !== "break") playOneShot(BREAK_END_SOUND);

        if (newType === "intro") {
          startWelcomeLoop();
        } else {
          stopWelcomeLoop();
          if (newType) {
            const t = inferStageTypeFromLabel(String(newType));
            const sound = STAGE_SOUND_MAP[t];
            if (sound) playOneShot(sound);
          }
        }

        prevStageRef.current = active;
      }

      if (stage?.type !== "intro" && welcomeLoopRef.current) stopWelcomeLoop();
    }, 1000);

    return () => window.clearInterval(timer);
  }, [stagebarStartTime, stages, isSilentRoom, isInfiniteRoom, stagebarCycleSeconds]);

  // auth user
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const u = data.user;
        setAuthUserId(u?.id || null);

        let name =
          str((u as any)?.user_metadata?.full_name) ||
          str((u as any)?.user_metadata?.name) ||
          (u?.email ? u.email.split("@")[0] : "");

        if (!name && u?.id) {
          const { data: p } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", u.id)
            .single();
          name = str((p as any)?.full_name);
        }

        setUserName(name);
        setDisplayName((prev) => prev || name || "Guest");
        setPrejoin((prev) => ({ ...prev, displayName: prev.displayName || name || "Guest" }));
      } finally {
        setAuthReady(true);
      }
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
    if (joinRequested) return;

    setPrejoinOpen(true);
    loadBrowserDevices().catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session, joinRequested]);

  // host flag
  const isHost = useMemo(() => {
    if (!authUserId) return false;
    const hostId = (session as any)?.host_profile?.id || (session as any)?.host_id;
    return !!hostId && String(hostId) === String(authUserId);
  }, [authUserId, session]);

  // LiveKit env
  const lkServerUrl = String((import.meta as any)?.env?.VITE_LIVEKIT_URL || "").trim();
  const tokenEndpoint = String(
    (import.meta as any)?.env?.VITE_LIVEKIT_TOKEN_ENDPOINT || "/api/livekit/token"
  ).trim();
  const adminEndpoint = String(
    (import.meta as any)?.env?.VITE_LIVEKIT_ADMIN_ENDPOINT || "/api/livekit/admin"
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
        body: JSON.stringify({ roomName, identity, name: nameToUse, isHost, sessionId: session.id }),
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
      if (!authReady) return;
      if (lkToken) return;
      await requestToken();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, joinRequested, authReady, isHost]);

  // ---- livekit room ----
  const roomRef = useRef<Room | null>(null);
  const [roomState, setRoomState] = useState<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [clientError, setClientError] = useState<string>("");

  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenShareOn, setScreenShareOn] = useState(false);

  const [tiles, setTiles] = useState<TileModel[]>([]);
  const [adminBusyKey, setAdminBusyKey] = useState<string>("");

  const participantsCount = useMemo(() => {
    const r = roomRef.current;
    if (!r) return 0;
    return 1 + r.remoteParticipants.size;
  }, [roomState, tiles]);

  // ---- background/blur state ----
  const [videoFxMode, setVideoFxMode] = useState<FxMode>("off");
  const [bgImageUrl, setBgImageUrl] = useState<string>(DEFAULT_BG_DATA_URL);
  const [fxError, setFxError] = useState<string>("");
  const [fxApplying, setFxApplying] = useState(false);
  const [fxStatusText, setFxStatusText] = useState<string>("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [blurStrength, setBlurStrength] = useState<number>(12);

  const uploadedBgUrlRef = useRef<string | null>(null);
  const currentFxPipelineRef = useRef<any>(null);

  const roomNameForApi = useMemo(() => {
    if (!session) return "";
    return safeRoomName(`session-${session.id}`);
  }, [session]);

  const rebuildTiles = () => {
    const room = roomRef.current;
    if (!room) return;

    const next: TileModel[] = [];

    const lp = room.localParticipant;
    const localCamPub = Array.from(lp.videoTrackPublications.values()).find(
      (p) => p.source === Track.Source.Camera
    );
    const localTrack = (localCamPub?.track as any) || undefined;

    const localMicPub = Array.from(lp.audioTrackPublications.values()).find(
      (p) => p.source === Track.Source.Microphone
    ) as any;

    next.push({
      id: "local",
      label: (displayName || userName || "You").trim() || "You",
      isLocal: true,
      videoTrack: localTrack,
      micMuted: !!localMicPub?.isMuted || !micOn,
      camMuted: !localCamPub?.track || !!(localCamPub as any)?.isMuted || !camOn,
    });

    room.remoteParticipants.forEach((rp: RemoteParticipant) => {
      const allVideoPubs = Array.from(rp.videoTrackPublications.values()) as RemoteTrackPublication[];
      const allAudioPubs = Array.from(
        rp.audioTrackPublications.values()
      ) as RemoteAudioTrackPublication[];

      const camPub = allVideoPubs.find((p: any) => p.source === Track.Source.Camera);
      const micPub = allAudioPubs.find((p: any) => p.source === Track.Source.Microphone);

      const vt = (camPub?.track as any) || undefined;
      const nm = (rp.name || rp.identity || "Guest").trim() || "Guest";

      next.push({
        id: rp.sid,
        label: nm,
        isLocal: false,
        videoTrack: vt,
        participantIdentity: rp.identity,
        micTrackSid: micPub?.trackSid,
        camTrackSid: camPub?.trackSid,
        micMuted: !!(micPub as any)?.isMuted,
        camMuted: !!(camPub as any)?.isMuted || !vt,
      });
    });

    setTiles(next);

    try {
      const lpScreenPub = Array.from(lp.videoTrackPublications.values()).find(
        (p: any) => p.source === Track.Source.ScreenShare
      ) as any;
      setScreenShareOn(!!lpScreenPub?.track && !lpScreenPub?.isMuted);
    } catch {
      setScreenShareOn(false);
    }
  };

  const disconnectRoom = async () => {
    try {
      const r = roomRef.current;
      roomRef.current = null;
      setRoomState(null);

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
      setScreenShareOn(false);
      setTiles([]);
      setFxStatusText("");
      setFxError("");
      setFxApplying(false);
      currentFxPipelineRef.current = null;
    }
  };

  const connectRoom = async () => {
    if (!lkServerUrl || !lkToken) return;

    setClientError("");
    setFxError("");
    await disconnectRoom();

    try {
      const pj = prejoinRef.current;

      const r = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      roomRef.current = r;
      setRoomState(r);

      const refresh = () => rebuildTiles();

      r.on(RoomEvent.Connected, () => {
        setConnected(true);
        refresh();
      });

      r.on(RoomEvent.Disconnected, () => {
        setConnected(false);
        setTiles([]);
        currentFxPipelineRef.current = null;
      });

      r.on(RoomEvent.Reconnected, refresh);
      r.on(RoomEvent.ParticipantConnected, refresh);
      r.on(RoomEvent.ParticipantDisconnected, refresh);
      r.on(RoomEvent.TrackSubscribed, refresh);
      r.on(RoomEvent.TrackUnsubscribed, refresh);
      r.on(RoomEvent.LocalTrackPublished as any, refresh as any);
      r.on(RoomEvent.LocalTrackUnpublished as any, refresh as any);
      r.on(RoomEvent.TrackMuted as any, refresh as any);
      r.on(RoomEvent.TrackUnmuted as any, refresh as any);

      await r.connect(lkServerUrl, lkToken, { autoSubscribe: true });

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

      refresh();
    } catch (e: any) {
      console.error("LiveKit connect failed:", e);
      setClientError(String(e?.message || e || "connect_failed"));
      await disconnectRoom();
    }
  };

  useEffect(() => {
    if (!joinRequested) return;
    if (!lkToken) return;
    if (!lkServerUrl) return;
    connectRoom().catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinRequested, lkToken, lkServerUrl]);

  useEffect(() => {
    return () => {
      disconnectRoom().catch(() => { });
      if (uploadedBgUrlRef.current) {
        try {
          URL.revokeObjectURL(uploadedBgUrlRef.current);
        } catch { }
      }
      stopWelcomeLoop();
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
      setTimeout(() => rebuildTiles(), 30);
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

      if (!next) {
        currentFxPipelineRef.current = null;
        setVideoFxMode("off");
        setFxStatusText("");
        setFxError("");
      }

      rebuildTiles();
    } catch (e) {
      console.error("toggleCam error:", e);
    }
  };

  const toggleScreenShare = async () => {
    const r = roomRef.current;
    if (!r) return;
    try {
      const next = !screenShareOn;
      await (r.localParticipant as any).setScreenShareEnabled(next);
      setScreenShareOn(next);
      setTimeout(() => rebuildTiles(), 80);
    } catch (e) {
      console.error("toggleScreenShare error:", e);
    }
  };

  const leave = async () => {
    await disconnectRoom();
    navigate("/sessions", { replace: true });
  };

  // ---- Host moderation calls ----
  const callHostAdmin = async (body: Record<string, unknown>) => {
    const res = await fetch(adminEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, isHost }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Admin endpoint error: ${res.status} ${t || ""}`.trim());
    }

    return res.json().catch(() => ({}));
  };

  const hostToggleRemoteTrackMute = async (
    participantIdentity: string,
    trackSid: string,
    currentlyMuted: boolean | undefined,
    kind: "mic" | "cam"
  ) => {
    const roomName = roomNameForApi;
    if (!roomName) return;

    const busyKey = `${participantIdentity}:${trackSid}`;
    setAdminBusyKey(busyKey);

    try {
      await callHostAdmin({
        action: currentlyMuted ? "unmute_track" : "mute_track",
        roomName,
        participantIdentity,
        trackSid,
      });

      window.setTimeout(() => rebuildTiles(), 150);
    } catch (e: any) {
      console.error(`host ${kind} toggle failed:`, e);
      alert(String(e?.message || e || "host_action_failed"));
    } finally {
      setAdminBusyKey("");
    }
  };

  const hostKickParticipant = async (participantIdentity: string) => {
    const roomName = roomNameForApi;
    if (!roomName) return;

    const busyKey = `${participantIdentity}:kick`;
    setAdminBusyKey(busyKey);

    try {
      await callHostAdmin({
        action: "remove_participant",
        roomName,
        participantIdentity,
      });
      window.setTimeout(() => rebuildTiles(), 150);
    } catch (e: any) {
      console.error("host kick failed:", e);
      alert(String(e?.message || e || "host_kick_failed"));
    } finally {
      setAdminBusyKey("");
    }
  };

  // ---- FX APPLY ----
  const getLocalCameraPublication = () => {
    const r = roomRef.current;
    if (!r) return null;
    const lp = r.localParticipant;
    const pub = Array.from(lp.videoTrackPublications.values()).find(
      (p: LocalTrackPublication) => p.source === Track.Source.Camera
    );
    return pub || null;
  };

  const getLocalCameraTrack = (): LocalVideoTrack | null => {
    const pub = getLocalCameraPublication();
    return (pub?.track as any) || null;
  };

  const stopAnyProcessorOnTrack = async (tr: any) => {
    if (!tr) return;
    try {
      if (typeof tr.stopProcessor === "function") {
        await tr.stopProcessor();
        await delay(80);
        return;
      }
    } catch { }
    try {
      if (typeof tr.setProcessor === "function") {
        await tr.setProcessor(null as any);
        await delay(80);
      }
    } catch { }
  };

  const replacePublishedCameraTrack = async (newTrack: LocalVideoTrack) => {
    const r = roomRef.current;
    if (!r) throw new Error("Room is not ready");

    const lp = r.localParticipant;
    const oldPub = getLocalCameraPublication();
    const oldTrack = oldPub?.track as any;

    if (oldTrack) {
      try {
        await lp.unpublishTrack(oldTrack, true);
      } catch { }
      try {
        await stopAnyProcessorOnTrack(oldTrack);
      } catch { }
      try {
        oldTrack.stop?.();
      } catch { }
    }

    await lp.publishTrack(newTrack, { source: Track.Source.Camera } as any);
  };

  const applyVideoFx = async (mode: FxMode) => {
    const r = roomRef.current;
    if (!r) return;

    setFxError("");
    setFxApplying(true);
    setFxStatusText("");

    try {
      if (!camOn) throw new Error("Turn camera on first (Cam on), then apply FX.");

      if (mode === "off") {
        const tr = getLocalCameraTrack();
        await stopAnyProcessorOnTrack(tr);
        currentFxPipelineRef.current = null;
        setVideoFxMode("off");
        setFxStatusText("FX disabled");
        rebuildTiles();
        return;
      }

      const pj = prejoinRef.current;
      const deviceId = pj.videoInputId || undefined;

      const newTrack = await createLocalVideoTrack({
        deviceId,
        resolution: { width: 1280, height: 720 },
      } as any);

      let pipeline: any = null;

      if (mode === "blur") {
        pipeline = await makeBlurPipeline(blurStrength);
      } else if (mode === "bg") {
        pipeline = await makeVirtualBgPipeline(bgImageUrl);
      }

      if (!pipeline) throw new Error("FX pipeline creation failed");

      currentFxPipelineRef.current = pipeline;

      try {
        await (newTrack as any).setProcessor(pipeline, { showProcessedStreamLocally: true });
      } catch {
        await (newTrack as any).setProcessor(pipeline, true);
      }

      await replacePublishedCameraTrack(newTrack);

      setVideoFxMode(mode);
      setFxStatusText(
        mode === "blur" ? `Blur applied (strength ${blurStrength})` : "Virtual background applied"
      );

      await delay(120);
      rebuildTiles();
    } catch (e: any) {
      console.error("applyVideoFx failed:", e);
      setFxError(String(e?.message || e || "video_fx_failed"));
    } finally {
      setFxApplying(false);
    }
  };

  useEffect(() => {
    if (!connected || !camOn) return;
    if (videoFxMode !== "blur") return;
    if (fxApplying) return;

    const pipeline = currentFxPipelineRef.current;
    const t = window.setTimeout(async () => {
      try {
        if (pipeline && typeof pipeline.updateTransformerOptions === "function") {
          await pipeline.updateTransformerOptions({ blurRadius: blurStrength });
          setFxStatusText(`Blur updated (strength ${blurStrength})`);
        } else {
          await applyVideoFx("blur");
        }
      } catch {
        await applyVideoFx("blur");
      }
    }, 260);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blurStrength]);

  useEffect(() => {
    if (!connected || !camOn) return;
    if (videoFxMode !== "bg") return;
    if (fxApplying) return;

    const pipeline = currentFxPipelineRef.current;
    const t = window.setTimeout(async () => {
      try {
        if (pipeline && typeof pipeline.updateTransformerOptions === "function") {
          await pipeline.updateTransformerOptions({ imagePath: bgImageUrl });
          setFxStatusText("Background updated");
        } else {
          await applyVideoFx("bg");
        }
      } catch {
        await applyVideoFx("bg");
      }
    }, 260);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgImageUrl]);

  // reactions UI (local-only parity button)
  const [showReactionsMenu, setShowReactionsMenu] = useState(false);
  const reactionsMenuRef = useRef<HTMLDivElement | null>(null);
  const [localReactions, setLocalReactions] = useState<{ id: number; type: ReactionType }[]>([]);
  const localReactionIdRef = useRef<number>(0);

  const handleSendReaction = (type: ReactionType) => {
    const rid = localReactionIdRef.current + 1;
    localReactionIdRef.current = rid;
    setLocalReactions((prev) => [...prev, { id: rid, type }]);
    setTimeout(() => {
      setLocalReactions((prev) => prev.filter((r) => r.id !== rid));
    }, 1500);
  };

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

  // mobile more menu
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (mql.matches) setShowMoreMenu(false);
    };
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
  }, []);

  const [participantsSearch, setParticipantsSearch] = useState("");

  const filteredParticipants = useMemo(() => {
    const q = participantsSearch.trim().toLowerCase();
    if (!q) return tiles;
    return tiles.filter((t) => (t.label || "").toLowerCase().includes(q));
  }, [tiles, participantsSearch]);

  const switchTrackCls =
    "w-[84px] max-[480px]:w-[78px] h-[32px] rounded-full border relative transition flex items-center px-[3px] " +
    (isLight
      ? "bg-black/5 border-black/10 hover:bg-black/10"
      : "bg-white/5 border-white/10 hover:bg-white/10");

  const switchThumb = "absolute top-[2px] w-[26px] h-[26px] rounded-full shadow-md transition-transform bg-white flex items-center justify-center";
  const thumbTranslate = isLight ? "translateX(0px)" : "translateX(52px)";

  // video wrap resize observer
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

  // Error text surface
  const lastErr = tokenError || clientError;

  // ---- UI helpers ----
  const gridColsClass = useMemo(() => {
    const n = tiles.length;
    if (n <= 1) return "grid-cols-1";
    if (n === 2) return "grid-cols-1 sm:grid-cols-2";
    if (n <= 4) return "grid-cols-1 sm:grid-cols-2";
    return "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3";
  }, [tiles.length]);

  const roomReadyText = !joinRequested
    ? "Waiting to join…"
    : tokenLoading
      ? "Preparing token…"
      : !connected
        ? "Connecting to LiveKit…"
        : "";

  const videoContent = (
    <div className="w-full h-full min-h-0 relative">
      {roomReadyText ? (
        <div
          className={`absolute inset-0 flex items-center justify-center z-10 ${isLight ? "text-black/60" : "text-white/70"
            }`}
        >
          <div className={`px-4 py-2 rounded-xl ${isLight ? "bg-white/70" : "bg-black/30"}`}>
            {roomReadyText}
          </div>
        </div>
      ) : null}

      <div className={`h-full min-h-0 overflow-auto p-2 sm:p-3 grid ${gridColsClass} gap-2 sm:gap-3`}>
        {tiles.map((t) => {
          const hostActions: HostTileActions | undefined =
            isHost && !t.isLocal && t.participantIdentity
              ? {
                canMuteMic: !!t.micTrackSid,
                canMuteCam: !!t.camTrackSid,
                micMuted: !!t.micMuted,
                camMuted: !!t.camMuted,
                busy:
                  adminBusyKey === `${t.participantIdentity}:${t.micTrackSid}` ||
                  adminBusyKey === `${t.participantIdentity}:${t.camTrackSid}` ||
                  adminBusyKey === `${t.participantIdentity}:kick`,
                onToggleMuteMic:
                  t.micTrackSid && t.participantIdentity
                    ? () =>
                      hostToggleRemoteTrackMute(
                        t.participantIdentity!,
                        t.micTrackSid!,
                        t.micMuted,
                        "mic"
                      )
                    : undefined,
                onToggleMuteCam:
                  t.camTrackSid && t.participantIdentity
                    ? () =>
                      hostToggleRemoteTrackMute(
                        t.participantIdentity!,
                        t.camTrackSid!,
                        t.camMuted,
                        "cam"
                      )
                    : undefined,
                onKick: t.participantIdentity
                  ? () => hostKickParticipant(t.participantIdentity!)
                  : undefined,
              }
              : undefined;

          return (
            <VideoTile
              key={t.id}
              label={t.label}
              videoTrack={t.videoTrack}
              isLocal={t.isLocal}
              theme={theme}
              showBadge={t.isLocal && isHost ? "Host" : null}
              hostActions={hostActions}
            />
          );
        })}

        {!tiles.length && connected && (
          <div
            className={`col-span-full h-full min-h-[240px] rounded-2xl border flex items-center justify-center ${isLight ? "border-black/10 bg-black/5 text-black/60" : "border-white/10 bg-white/5 text-white/60"
              }`}
          >
            No participants yet
          </div>
        )}
      </div>

      {localReactions.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center pb-20 sm:pb-24">
          <div className="flex items-center gap-2">
            {localReactions.map((r) => (
              <div
                key={r.id}
                className="text-2xl sm:text-3xl animate-bounce select-none"
                style={{ animationDuration: "700ms" }}
              >
                {reactionEmoji[r.type]}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

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

  const RightPanelBody = (
    <div
      className={`rounded-2xl shadow-lg overflow-hidden min-h-0 h-full flex flex-col ${panelBg} ${theme === "dark" ? "dark" : ""
        }`}
      data-theme={theme}
    >
      {rightTab === "participants" && (
        <div className="h-full min-h-0 flex flex-col">
          <div
            className={`px-4 py-3 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"
              }`}
          >
            <div className="flex items-center gap-2">
              <span className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>
                Participants
              </span>
              <span className={`${isLight ? "text-black/50" : "text-white/55"} text-sm`}>
                ({participantsCount})
              </span>
            </div>
            <button
              onClick={() => openRightTab(null)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight
                  ? "bg-black/5 hover:bg-black/10 text-black/60"
                  : "bg-[#111827] hover:bg-[#1f2937] text-white/80"
                }`}
              title="Close"
            >
              ✕
            </button>
          </div>

          <div className="p-4">
            <div
              className={`rounded-xl px-3 py-2 ${isLight ? "bg-black/5 border border-black/10" : "bg-[#0B1220]/70 border border-white/10"
                }`}
            >
              <input
                value={participantsSearch}
                onChange={(e) => setParticipantsSearch(e.target.value)}
                placeholder="Search participants..."
                className={`w-full bg-transparent outline-none text-[13px] placeholder:opacity-60 ${isLight
                    ? "text-black/80 placeholder:text-black/40"
                    : "text-white/85 placeholder:text-white/35"
                  }`}
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
            <div className="flex flex-col gap-2">
              {filteredParticipants.map((p) => {
                const name = p.isLocal ? "You" : p.label || "Guest";
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
                    className={`flex items-center justify-between px-3 py-2 rounded-xl transition ${isLight ? "hover:bg-black/5" : "hover:bg-white/5"
                      }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${p.isLocal
                            ? isLight
                              ? "bg-blue-500/15 text-blue-700"
                              : "bg-emerald-500/80 text-[#02140B]"
                            : isLight
                              ? "bg-black/5 text-black/75"
                              : "bg-white/10 text-white/85"
                          }`}
                      >
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <div
                          className={`text-[13px] font-medium truncate ${isLight ? "text-black/85" : "text-white/90"
                            }`}
                        >
                          {name}
                        </div>
                        <div
                          className={`text-[11px] truncate ${isLight ? "text-black/45" : "text-white/45"
                            }`}
                        >
                          {p.isLocal ? "You" : "Participant"}
                          {p.isLocal && isHost ? " • Host" : ""}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div
                        className={
                          "w-8 h-8 rounded-lg flex items-center justify-center " +
                          (p.micMuted
                            ? isLight
                              ? "bg-red-500/10"
                              : "bg-red-500/20"
                            : isLight
                              ? "bg-black/5"
                              : "bg-white/5")
                        }
                        title={p.micMuted ? "Muted" : "Unmuted"}
                      >
                        <Icon
                          name={p.micMuted ? "mic-off" : "mic-on"}
                          theme={theme}
                          className={`w-4 h-4 ${p.micMuted ? "opacity-90" : "opacity-80"}`}
                        />
                      </div>

                      <div
                        className={
                          "w-8 h-8 rounded-lg flex items-center justify-center " +
                          (p.camMuted
                            ? isLight
                              ? "bg-red-500/10"
                              : "bg-red-500/20"
                            : isLight
                              ? "bg-black/5"
                              : "bg-white/5")
                        }
                        title={p.camMuted ? "Video off" : "Video on"}
                      >
                        <Icon
                          name={p.camMuted ? "camera-off" : "camera-on"}
                          theme={theme}
                          className={`w-4 h-4 ${p.camMuted ? "opacity-90" : "opacity-80"}`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={`p-3 border-t ${isLight ? "border-black/10" : "border-white/5"}`}>
            <button
              onClick={() => { }}
              className={`w-full h-12 rounded-xl font-semibold flex items-center justify-center gap-2 ${isLight
                  ? "bg-blue-600 hover:bg-blue-700 text-white"
                  : "bg-emerald-500 hover:bg-emerald-600 text-[#02140B]"
                }`}
            >
              <span className="text-lg">+</span>
              <span>Invite People</span>
            </button>
          </div>
        </div>
      )}

      {rightTab === "chat" && (
        <div className="h-full min-h-0 flex flex-col">
          <div
            className={`px-4 py-3 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"
              }`}
          >
            <div className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>Chat</div>
            <button
              onClick={() => openRightTab(null)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight
                  ? "bg-black/5 hover:bg-black/10 text-black/60"
                  : "bg-[#111827] hover:bg-[#1f2937] text-white/80"
                }`}
              title="Close"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 min-h-0 p-3 overflow-hidden">
            <div
              className={`h-full min-h-0 overflow-hidden rounded-xl ${isLight ? "bg-white/70 border border-black/10" : "bg-[#020617]/40 border border-white/10"
                }`}
            >
              <div className="h-full min-h-0 flex flex-col overflow-hidden [&>*]:h-full [&>*]:min-h-0">
                {session?.id ? (
                  <div
                    data-theme={theme}
                    style={{ colorScheme: theme }}
                    className={theme === "dark" ? "dark h-full min-h-0" : "h-full min-h-0"}
                  >
                    <ChatPanelAny
                      sessionId={session.id}
                      theme={theme}
                      showHeader={false}
                      title="Chat"
                      onClose={() => openRightTab(null)}
                      embedded={true}
                      hideHeader={true}
                      authUserId={authUserId}
                      displayName={displayName || userName}
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
          <div
            className={`px-4 py-3 border-b flex items-center justify-between ${isLight ? "border-black/10" : "border-white/5"
              }`}
          >
            <div className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>
              Intentions
            </div>
            <button
              onClick={() => openRightTab(null)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${isLight
                  ? "bg-black/5 hover:bg-black/10 text-black/60"
                  : "bg-[#111827] hover:bg-[#1f2937] text-white/80"
                }`}
              title="Close"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden p-3">
            <div
              className={`h-full min-h-0 overflow-hidden rounded-xl ${isLight ? "bg-white/70 border border-black/10" : "bg-[#020617]/40 border border-white/10"
                }`}
            >
              <div className="h-full min-h-0 overflow-y-auto [&>*]:min-h-0">
                <div
                  data-theme={theme}
                  style={{ colorScheme: theme }}
                  className={theme === "dark" ? "dark h-full min-h-0" : "h-full min-h-0"}
                >
                  <IntentionsPanel
                    key={`intentions-${session.id}-${theme}`}
                    theme={theme}
                    sessionId={session.id}
                    timerText={remainingTime || "--:--"}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const TopBar = (
    <div className={`flex w-full rounded-2xl overflow-hidden ${topBarBg}`}>
      <div className="flex-1 px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex flex-col gap-2 max-[480px]:gap-2">
          {/* ROW 1 */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <p className={`min-w-0 font-inter font-semibold text-[16px] sm:text-[18px] truncate ${strongText}`}>
                  {String(session?.title || "Session")}
                </p>

                <span
                  className={[
                    "shrink-0 px-2 py-[3px] rounded-lg border text-[12px] font-inter",
                    chipBg,
                    isLight ? "text-black/65" : "text-white/80",
                  ].join(" ")}
                  title="Participants now / limit"
                >
                  {participantsCount}/{maxParticipants}
                </span>

                <span
                  className={[
                    "hidden sm:inline-flex shrink-0 px-2 py-[3px] rounded-lg border text-[11px] font-inter",
                    chipBg,
                    isLight ? "text-black/65" : "text-white/75",
                  ].join(" ")}
                  title="Engine"
                >
                  LiveKit
                </span>
              </div>
            </div>

            <div className="hidden min-[481px]:flex items-center gap-2 shrink-0">
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
                className={switchTrackCls}
                title="Toggle theme"
                aria-label="Toggle theme"
              >
                <div className={switchThumb} style={{ transform: thumbTranslate }}>
                  <Icon name={isLight ? "theme-sun" : "theme-moon"} theme={theme} className="w-4 h-4" />
                </div>
              </button>

              {session.host_profile && (
                <button
                  onClick={() => setSelectedUser(session.host_profile || null)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition text-[13px] ${isLight
                      ? "border-black/10 bg-black/5 hover:bg-black/10 text-black/75"
                      : "border-white/10 bg-[#0B1220]/60 hover:bg-[#0B1220]/80 text-[#F3F4F6]/85"
                    }`}
                  title="Host profile"
                >
                  <ParticipantsSmartIcon theme={theme} className="w-4 h-4 opacity-90" />
                  <span className="font-inter">
                    <span className="font-light">Host:</span>{" "}
                    <span className="font-bold">{String(session.host_profile.full_name || "Host")}</span>
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* ROW 2 mobile controls */}
          <div className="min-[481px]:hidden flex items-center justify-start gap-2">
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
              className={switchTrackCls}
              title="Toggle theme"
              aria-label="Toggle theme"
            >
              <div className={switchThumb} style={{ transform: thumbTranslate }}>
                <Icon name={isLight ? "theme-sun" : "theme-moon"} theme={theme} className="w-4 h-4" />
              </div>
            </button>

            {session.host_profile && (
              <button
                onClick={() => setSelectedUser(session.host_profile || null)}
                className={`w-10 h-10 rounded-2xl flex items-center justify-center border transition ${isLight
                    ? "border-black/10 bg-black/5 hover:bg-black/10 text-black/70"
                    : "border-white/10 bg-[#0B1220]/60 hover:bg-[#0B1220]/80 text-white/85"
                  }`}
                title={`Host: ${String(session.host_profile.full_name || "Host")}`}
                aria-label="Host profile"
              >
                <ParticipantsSmartIcon theme={theme} className="w-5 h-5 opacity-90" />
              </button>
            )}
          </div>

          {/* ROW 3 stagebar */}
          {!isSilentRoom && stages.length > 0 && !!stagebarStartTime && (
            <div className="mt-1 max-[480px]:mt-1 w-full overflow-hidden">
              <SessionStageBar
                stages={stages}
                startTime={stagebarStartTime}
                cycleSeconds={stagebarCycleSeconds}
                onHoverStage={setHoveredStage}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <PreJoinModal
        open={prejoinOpen}
        theme={theme}
        devices={devices}
        value={prejoin}
        onChange={setPrejoin}
        onRefreshDevices={() => {
          loadBrowserDevices().catch(() => { });
        }}
        onCancel={() => {
          navigate("/sessions", { replace: true });
        }}
        onJoin={() => {
          const pj = prejoinRef.current;
          const nm = (pj.displayName || displayName || userName || "Guest").trim() || "Guest";

          setDisplayName(nm);
          setSelectedAudioOutputId(pj.audioOutputId || "default");

          setPrejoinOpen(false);
          setJoinRequested(true);
        }}
      />

      <div className={`h-[100dvh] overflow-hidden ${pageBg}`}>
        <div className="h-full w-full px-2 sm:px-4 pt-3 pb-[calc(84px+env(safe-area-inset-bottom))] sm:pb-[calc(94px+env(safe-area-inset-bottom))] flex flex-col gap-3 sm:gap-4 min-h-0">
          {TopBar}

          <div
            className={
              "relative grid grid-rows-1 gap-3 sm:gap-4 flex-1 min-h-0 h-full " +
              (rightPanelOpen
                ? "lg:grid-cols-[minmax(0,1fr),380px] xl:grid-cols-[minmax(0,1fr),420px]"
                : "grid-cols-1")
            }
          >
            <div
              ref={videoWrapRef}
              className={`relative rounded-2xl overflow-hidden min-h-0 h-full ${isLight ? "bg-white/70 border border-black/10" : "bg-[#0B1220]/45 border border-white/5"
                }`}
            >
              <LiveKitErrorBoundary
                isLight={isLight}
                onReset={() => {
                  setClientError("");
                  setTokenError("");
                  if (joinRequested && lkToken && lkServerUrl) {
                    connectRoom().catch(() => { });
                  }
                }}
              >
                {videoContent}
              </LiveKitErrorBoundary>

              {lastErr && (
                <div className="absolute top-4 left-4 text-xs bg-red-600 text-white px-3 py-2 rounded-lg shadow z-30 max-w-[80%] break-words">
                  {lastErr}
                </div>
              )}
            </div>

            {rightPanelOpen && isLgUp && <div className="min-h-0 h-full overflow-hidden">{RightPanelBody}</div>}

            {rightPanelOpen && !isLgUp && (
              <div className="absolute inset-0 z-40 min-h-0">
                <div className="absolute inset-0 bg-black/40" onClick={() => openRightTab(null)} />
                <div className="absolute inset-x-0 top-0 bottom-0 p-1 sm:p-2 min-h-0">{RightPanelBody}</div>
              </div>
            )}
          </div>
        </div>

        {/* remote audio renderers */}
        <RemoteAudioRenderer room={roomState} audioOutputId={selectedAudioOutputId} />

        {/* bottom controls (RoomPage parity) */}
        <div className="fixed inset-x-0 bottom-0 z-50">
          <div className="w-full px-2 sm:px-4 pb-[calc(8px+env(safe-area-inset-bottom))]">
            <div
              className={`h-[64px] sm:h-[74px] rounded-2xl shadow-2xl backdrop-blur grid grid-cols-[auto,1fr,auto] items-center px-2 sm:px-4 ${bottomBarBg}`}
            >
              <div className="flex items-center gap-2" ref={moreMenuRef}>
                <div className="md:hidden relative">
                  <button
                    onClick={() => setShowMoreMenu((v) => !v)}
                    className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                    title="Menu"
                  >
                    <span className={isLight ? "text-black/70" : "text-white/85"}>⋯</span>
                  </button>

                  {showMoreMenu && (
                    <div className="absolute bottom-[76px] sm:bottom-[86px] left-0">
                      <div
                        className={`w-[240px] rounded-2xl shadow-2xl overflow-hidden ${isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10"
                          }`}
                      >
                        <button
                          onClick={() => {
                            openRightTab("participants");
                            setShowMoreMenu(false);
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"
                            }`}
                        >
                          <Icon name="participants" theme={theme} className="w-4 h-4 opacity-90" />
                          <span>Participants</span>
                        </button>

                        <button
                          onClick={() => {
                            openRightTab("chat");
                            setShowMoreMenu(false);
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"
                            }`}
                        >
                          <Icon name="chat" theme={theme} className="w-4 h-4 opacity-90" />
                          <span>Chat</span>
                        </button>

                        <button
                          onClick={() => {
                            openRightTab("intentions");
                            setShowMoreMenu(false);
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"
                            }`}
                        >
                          <Icon name="intentions" theme={theme} className="w-4 h-4 opacity-90" />
                          <span>Intentions</span>
                        </button>

                        <div className={isLight ? "h-px bg-black/10" : "h-px bg-white/10"} />

                        <button
                          onClick={() => {
                            setSettingsOpen(true);
                            setShowMoreMenu(false);
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"
                            }`}
                        >
                          <Icon name="settings" theme={theme} className="w-4 h-4 opacity-90" />
                          <span>Settings</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="hidden md:flex items-center gap-2">
                  <button
                    onClick={() => openRightTab("participants")}
                    className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                    title="Participants"
                  >
                    <Icon name="participants" theme={theme} className="w-5 h-5" />
                  </button>

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
                    onClick={() => setSettingsOpen(true)}
                    className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                    title="Settings"
                  >
                    <Icon name="settings" theme={theme} className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 sm:gap-3">
                <button
                  onClick={toggleMic}
                  disabled={!connected}
                  className={
                    "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition disabled:opacity-50 " +
                    (!micOn ? "bg-red-600 hover:bg-red-700" : ctlBtnBase)
                  }
                  title="Toggle mic"
                >
                  <Icon
                    name={!micOn ? "mic-off" : "mic-on"}
                    theme={!micOn ? "dark" : theme}
                    className="w-5 h-5"
                  />
                </button>

                <button
                  onClick={toggleCam}
                  disabled={!connected}
                  className={
                    "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition disabled:opacity-50 " +
                    (!camOn ? "bg-red-600 hover:bg-red-700" : ctlBtnBase)
                  }
                  title="Toggle camera"
                >
                  <Icon name={!camOn ? "camera-off" : "camera-on"} theme={theme} className="w-5 h-5" />
                </button>

                <button
                  onClick={toggleScreenShare}
                  disabled={!connected}
                  className={
                    "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition disabled:opacity-50 " +
                    (screenShareOn ? "bg-blue-600 hover:bg-blue-700" : ctlBtnBase)
                  }
                  title="Share screen"
                >
                  <Icon name="screen-share" theme={theme} className="w-5 h-5" />
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
                      {(["fire", "laugh", "clap", "heart", "thumbsUp", "thumbsDown"] as ReactionType[]).map(
                        (t) => (
                          <button
                            key={t}
                            onClick={() => {
                              handleSendReaction(t);
                              setShowReactionsMenu(false);
                            }}
                            className="hover:scale-[1.06] transition"
                            title={t}
                          >
                            {reactionEmoji[t]}
                          </button>
                        )
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 sm:gap-3">
                {/* only one leave button group here (removed extra outside-video leave) */}
                <button
                  onClick={leave}
                  className="hidden sm:flex h-11 px-6 rounded-2xl font-semibold items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white"
                  title="Leave"
                >
                  <Icon name="leave" theme={theme} className="w-5 h-5" />
                  <span className="text-[14px]">Leave</span>
                </button>

                <button
                  onClick={leave}
                  className="sm:hidden w-10 h-10 rounded-2xl bg-red-600 hover:bg-red-700 text-white flex items-center justify-center"
                  title="Leave"
                >
                  <Icon name="leave" theme={theme} className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <RoomSettingsModalLiveKit
          open={settingsOpen}
          theme={theme}
          mode={videoFxMode}
          blurStrength={blurStrength}
          onBlurStrengthChange={setBlurStrength}
          bgImageUrl={bgImageUrl}
          onSetBgImageUrl={setBgImageUrl}
          onApplyMode={async (m) => {
            await applyVideoFx(m);
          }}
          onClose={() => setSettingsOpen(false)}
          fxError={fxError}
          fxApplying={fxApplying}
          fxStatusText={fxStatusText}
          onUploadBg={(file) => {
            try {
              if (uploadedBgUrlRef.current) {
                URL.revokeObjectURL(uploadedBgUrlRef.current);
                uploadedBgUrlRef.current = null;
              }
              const url = URL.createObjectURL(file);
              uploadedBgUrlRef.current = url;
              setBgImageUrl(url);
            } catch (e) {
              console.error("upload bg failed", e);
              setFxError("Failed to load selected image");
            }
          }}
          onResetBg={() => {
            if (uploadedBgUrlRef.current) {
              try {
                URL.revokeObjectURL(uploadedBgUrlRef.current);
              } catch { }
              uploadedBgUrlRef.current = null;
            }
            setBgImageUrl(DEFAULT_BG_DATA_URL);
          }}
        />

        {selectedUser && <UserProfileModal user={selectedUser} onClose={() => setSelectedUser(null)} />}
      </div>
    </>
  );
}

export default RoomPageLiveKit;