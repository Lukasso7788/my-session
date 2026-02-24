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

type RoomTheme = "dark" | "light";
type RightPanelTab = "participants" | "chat" | "intentions" | null;
type FxMode = "off" | "blur" | "bg";

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
function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// keep parity with RoomPage mobile/desktop single-panel rendering
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
                onChange={(e) =>
                  onChange({ ...value, displayName: e.target.value })
                }
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
                  onChange={(e) =>
                    onChange({ ...value, audioInputId: e.target.value })
                  }
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
                  onChange={(e) =>
                    onChange({ ...value, videoInputId: e.target.value })
                  }
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
                  onChange={(e) =>
                    onChange({ ...value, audioOutputId: e.target.value })
                  }
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
                  onChange={(e) =>
                    onChange({ ...value, audioEnabled: e.target.checked })
                  }
                />
                <span className={labelCls}>Audio enabled</span>
              </label>

              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={value.videoEnabled}
                  onChange={(e) =>
                    onChange({ ...value, videoEnabled: e.target.checked })
                  }
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

// ---- Host action types ----
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

// ---- Video FX Settings Modal ----
function VideoFxSettingsModal({
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
  const activeBtn = isLight
    ? "bg-blue-600 text-white"
    : "bg-emerald-500 text-[#03110a]";
  const subtleText = isLight ? "text-black/60" : "text-white/60";

  return (
    <div className={overlay} data-theme={theme} style={{ colorScheme: theme }}>
      <div className={backdrop} onClick={onClose} />
      <div className={card}>
        <div
          className={`px-6 py-5 border-b ${isLight ? "border-black/10" : "border-white/10"
            }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-[16px]">Video FX Settings</div>
              <div className={`text-[12px] mt-1 ${subtleText}`}>
                Apply background blur or virtual background to your camera.
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
            {fxError ? (
              <div className="mt-2 text-[12px] text-red-500 break-words">{fxError}</div>
            ) : null}
          </div>

          <div className={`rounded-2xl p-4 ${inputWrap}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-semibold">Blur strength</div>
                <div className={`text-[12px] mt-1 ${subtleText}`}>
                  Used when Blur mode is active.
                </div>
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
  const [tracks, setTracks] = useState<
    { id: string; track: RemoteAudioTrack; label: string }[]
  >([]);

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

// ---- Track processors (v0.7.0 style) ----
function mergeModuleExports(mod: any): any {
  const merged = {
    ...(mod?.default && typeof mod.default === "object" ? mod.default : {}),
    ...(mod || {}),
  };
  return merged;
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
      // fallback checked below
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
  const isLgUp = useMediaQuery("(min-width: 1024px)");

  const pageBg = isLight ? "bg-[#F6F7FB] text-[#0B1220]" : "bg-[#050F1A] text-white";
  const topBarBg = isLight
    ? "bg-white/85 border border-black/10"
    : "bg-[#111827]/40 border border-white/5";
  const chipBg = isLight
    ? "bg-black/5 border border-black/10"
    : "bg-[#0B1220]/70 border border-white/5";
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
  const [templatesCount, setTemplatesCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

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

  // host flag
  const isHost = useMemo(() => {
    if (!authUserId) return false;
    const hostId = (session as any)?.host_profile?.id || (session as any)?.host_id;
    return !!hostId && String(hostId) === String(authUserId);
  }, [authUserId, session]);

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

  // force relayout when panel changes
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
      try {
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

  // LiveKit env
  const lkServerUrl = String((import.meta as any)?.env?.VITE_LIVEKIT_URL || "").trim();
  const tokenEndpoint = String((import.meta as any)?.env?.VITE_LIVEKIT_TOKEN_ENDPOINT || "/api/livekit/token").trim();
  const adminEndpoint = String((import.meta as any)?.env?.VITE_LIVEKIT_ADMIN_ENDPOINT || "/api/livekit/admin").trim();

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
        body: JSON.stringify({
          roomName,
          identity,
          name: nameToUse,
          isHost,
          sessionId: session.id,
        }),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        const msg = `Token endpoint error: ${res.status} ${t || ""}`.trim();
        console.error(msg);
        setTokenError(msg);
        setTokenLoading(false);
        return;
      }

      const json = (await res.json()) as { token?: string; isHost?: boolean };
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

  // IMPORTANT: wait for authReady before minting token
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

  // ---- livekit-client room ----
  const roomRef = useRef<Room | null>(null);
  const [roomState, setRoomState] = useState<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [clientError, setClientError] = useState<string>("");

  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);

  const [tiles, setTiles] = useState<TileModel[]>([]);
  const [adminBusyKey, setAdminBusyKey] = useState<string>("");

  // ---- background/blur state ----
  const [videoFxMode, setVideoFxMode] = useState<FxMode>("off");
  const [bgImageUrl, setBgImageUrl] = useState<string>(DEFAULT_BG_DATA_URL);
  const [fxError, setFxError] = useState<string>("");
  const [fxApplying, setFxApplying] = useState(false);
  const [fxStatusText, setFxStatusText] = useState<string>("");
  const [fxSettingsOpen, setFxSettingsOpen] = useState(false);
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

    // local
    const lp = room.localParticipant;
    const localCamPub = Array.from(lp.videoTrackPublications.values()).find((p) => p.source === Track.Source.Camera);
    const localTrack = (localCamPub?.track as any) || undefined;

    next.push({
      id: "local",
      label: (displayName || userName || "You").trim() || "You",
      isLocal: true,
      videoTrack: localTrack,
      micMuted: !micOn,
      camMuted: !camOn,
    });

    // remote
    room.remoteParticipants.forEach((rp: RemoteParticipant) => {
      const allVideoPubs = Array.from(rp.videoTrackPublications.values()) as RemoteTrackPublication[];
      const allAudioPubs = Array.from(rp.audioTrackPublications.values()) as RemoteAudioTrackPublication[];

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
        camMuted: !!(camPub as any)?.isMuted,
      });
    });

    setTiles(next);
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
      r.on(RoomEvent.LocalTrackPublished, refresh);
      r.on(RoomEvent.LocalTrackUnpublished, refresh);
      r.on(RoomEvent.TrackMuted, refresh as any);
      r.on(RoomEvent.TrackUnmuted, refresh as any);

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
      if (uploadedBgUrlRef.current) {
        try {
          URL.revokeObjectURL(uploadedBgUrlRef.current);
        } catch { }
      }
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

  const leave = async () => {
    await disconnectRoom();
    navigate("/sessions", { replace: true });
  };

  // ---- Host moderation calls (server-side) ----
  const callHostAdmin = async (body: Record<string, unknown>) => {
    const res = await fetch(adminEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        isHost,
      }),
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
    const pub = Array.from(lp.videoTrackPublications.values()).find((p: LocalTrackPublication) => p.source === Track.Source.Camera);
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
      if (!camOn) {
        throw new Error("Turn camera on first (Cam on), then apply FX.");
      }

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
      } else {
        pipeline = null;
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

  const participantsCount = tiles.length;
  const [participantsSearch, setParticipantsSearch] = useState("");

  const filteredParticipants = useMemo(() => {
    const q = participantsSearch.trim().toLowerCase();
    if (!q) return tiles;
    return tiles.filter((t) => (t.label || "").toLowerCase().includes(q));
  }, [tiles, participantsSearch]);

  const switchTrack =
    "w-[84px] max-[480px]:w-[78px] h-[32px] rounded-full border relative transition flex items-center px-[3px]";
  const switchTrackCls = isLight
    ? "bg-black/5 border-black/10 hover:bg-black/10"
    : "bg-white/5 border-white/10 hover:bg-white/10";
  const switchThumb =
    "absolute top-[2px] w-[26px] h-[26px] rounded-full shadow-md transition-transform bg-white flex items-center justify-center";
  const thumbTranslate = isLight ? "translateX(0px)" : "translateX(52px)";

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
      className={`rounded-2xl shadow-lg overflow-hidden min-h-0 h-full flex flex-col ${panelBg}`}
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
              className={`rounded-xl px-3 py-2 ${isLight
                ? "bg-black/5 border border-black/10"
                : "bg-[#0B1220]/70 border border-white/10"
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
                        <div className={`text-[13px] font-medium truncate ${isLight ? "text-black/85" : "text-white/90"}`}>
                          {name}
                        </div>
                        <div className={`text-[11px] truncate ${isLight ? "text-black/45" : "text-white/45"}`}>
                          {p.isLocal ? "You" : "Participant"}
                          {p.isLocal && isHost ? " • Host" : ""}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div
                        className={
                          "w-8 h-8 rounded-lg flex items-center justify-center text-[12px] " +
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
                        {p.micMuted ? "🔇" : "🎤"}
                      </div>

                      <div
                        className={
                          "w-8 h-8 rounded-lg flex items-center justify-center text-[12px] " +
                          (p.camMuted || !p.videoTrack
                            ? isLight
                              ? "bg-red-500/10"
                              : "bg-red-500/20"
                            : isLight
                              ? "bg-black/5"
                              : "bg-white/5")
                        }
                        title={p.camMuted || !p.videoTrack ? "Video off" : "Video on"}
                      >
                        {p.camMuted || !p.videoTrack ? "🚫" : "📷"}
                      </div>
                    </div>
                  </div>
                );
              })}

              {!filteredParticipants.length && (
                <div className={`px-3 py-6 text-center text-sm ${isLight ? "text-black/50" : "text-white/50"}`}>
                  No participants found
                </div>
              )}
            </div>
          </div>

          <div className={`p-3 border-t ${isLight ? "border-black/10" : "border-white/5"}`}>
            <button
              onClick={() => navigator.clipboard?.writeText(window.location.href).catch(() => { })}
              className={`w-full h-12 rounded-xl font-semibold flex items-center justify-center gap-2 ${isLight
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-emerald-500 hover:bg-emerald-600 text-[#02140B]"
                }`}
              title="Copy session link"
            >
              <span>🔗</span>
              <span>Copy Invite Link</span>
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
            <div className={`${isLight ? "text-black/80" : "text-white/85"} font-inter font-semibold`}>
              Chat
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

          <div className="flex-1 min-h-0 p-3 overflow-hidden">
            <div
              className={`h-full min-h-0 overflow-hidden rounded-xl ${isLight
                ? "bg-white/70 border border-black/10"
                : "bg-[#020617]/40 border border-white/10"
                }`}
            >
              <div className="h-full min-h-0 flex flex-col overflow-hidden [&>*]:h-full [&>*]:min-h-0">
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
              className={`h-full min-h-0 overflow-hidden rounded-xl ${isLight
                ? "bg-white/70 border border-black/10"
                : "bg-[#020617]/40 border border-white/10"
                }`}
            >
              <div className="h-full min-h-0 overflow-y-auto [&>*]:min-h-0">
                <div
                  data-theme={theme}
                  style={{ colorScheme: theme }}
                  className={theme === "dark" ? "dark h-full min-h-0" : "h-full min-h-0"}
                >
                  <IntentionsPanel theme={theme} sessionId={session.id} timerText={"--:--"} />
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
          {/* row 1 */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <p
                  className={`min-w-0 font-inter font-semibold text-[16px] sm:text-[18px] truncate ${isLight ? "text-black/85" : "text-[#F3F4F6]/90"
                    }`}
                >
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
                    "hidden sm:inline-flex shrink-0 px-2 py-[3px] rounded-lg border text-[12px] font-inter",
                    chipBg,
                    isLight ? "text-black/60" : "text-white/70",
                  ].join(" ")}
                  title="Connection state"
                >
                  {connected ? "Connected" : "Not connected"}
                </span>

                {isHost && (
                  <span
                    className={[
                      "hidden sm:inline-flex shrink-0 px-2 py-[3px] rounded-lg border text-[12px] font-semibold",
                      isLight
                        ? "bg-amber-100 border-amber-200 text-amber-800"
                        : "bg-amber-400/10 border-amber-300/20 text-amber-200",
                    ].join(" ")}
                  >
                    HOST
                  </span>
                )}
              </div>
            </div>

            {/* desktop+ controls */}
            <div className="hidden min-[481px]:flex items-center gap-2 shrink-0">
              <button
                onClick={() => setFxSettingsOpen(true)}
                className={`px-3 py-1.5 rounded-xl border text-[13px] ${chipBg} ${isLight ? "text-black/75" : "text-white/85"
                  }`}
                title="Video FX settings"
              >
                🎛️ Video
              </button>

              <button
                onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                className={`${switchTrack} ${switchTrackCls}`}
                title="Toggle theme"
                aria-label="Toggle theme"
              >
                <div className={switchThumb} style={{ transform: thumbTranslate }}>
                  <span className="text-[12px]">{isLight ? "☀️" : "🌙"}</span>
                </div>
              </button>

              {session.host_profile && (
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-[13px] ${isLight
                    ? "border-black/10 bg-black/5 text-black/75"
                    : "border-white/10 bg-[#0B1220]/60 text-[#F3F4F6]/85"
                    }`}
                  title={`Host: ${String(session.host_profile.full_name || "Host")}`}
                >
                  <span>👤</span>
                  <span className="font-inter">
                    <span className="font-light">Host:</span>{" "}
                    <span className="font-bold">{String(session.host_profile.full_name || "Host")}</span>
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* row 2 mobile */}
          <div className="min-[481px]:hidden flex items-center justify-start gap-2">
            <button
              onClick={() => setFxSettingsOpen(true)}
              className={`px-3 py-1.5 rounded-xl border text-[13px] ${chipBg} ${isLight ? "text-black/75" : "text-white/85"
                }`}
              title="Video FX settings"
            >
              🎛️
            </button>

            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className={`${switchTrack} ${switchTrackCls}`}
              title="Toggle theme"
              aria-label="Toggle theme"
            >
              <div className={switchThumb} style={{ transform: thumbTranslate }}>
                <span className="text-[12px]">{isLight ? "☀️" : "🌙"}</span>
              </div>
            </button>

            {session.host_profile && (
              <div
                className={`px-3 py-1.5 rounded-xl border text-[12px] ${isLight
                  ? "border-black/10 bg-black/5 text-black/70"
                  : "border-white/10 bg-[#0B1220]/60 text-white/85"
                  }`}
                title={`Host: ${String(session.host_profile.full_name || "Host")}`}
              >
                👤 {String(session.host_profile.full_name || "Host")}
              </div>
            )}
          </div>

          {/* row 3 stage bar */}
          <div className="mt-1 w-full overflow-hidden">
            <SessionStageBar
              stages={[]}
              startTime={String(session.start_time || session.created_at || new Date().toISOString())}
              onHoverStage={() => { }}
            />
          </div>

          {/* subtle meta */}
          <div className={`${isLight ? "text-black/40" : "text-white/40"} text-[11px] truncate`}>
            room: session-{session.id} • templates: {templatesCount}
            {!!videoFxMode && videoFxMode !== "off"
              ? ` • FX: ${videoFxMode}${videoFxMode === "blur" ? `(${blurStrength})` : ""}${fxApplying ? " applying..." : ""
              }`
              : ""}
          </div>
          {fxError ? (
            <div className="text-[11px] text-red-500 break-words">Video FX error: {fxError}</div>
          ) : null}
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

      <VideoFxSettingsModal
        open={fxSettingsOpen}
        theme={theme}
        mode={videoFxMode}
        blurStrength={blurStrength}
        onBlurStrengthChange={setBlurStrength}
        bgImageUrl={bgImageUrl}
        onSetBgImageUrl={(url) => setBgImageUrl(url)}
        onApplyMode={(m) => void applyVideoFx(m)}
        onClose={() => setFxSettingsOpen(false)}
        fxError={fxError}
        fxApplying={fxApplying}
        fxStatusText={fxStatusText}
        onUploadBg={(file) => {
          if (uploadedBgUrlRef.current) {
            try {
              URL.revokeObjectURL(uploadedBgUrlRef.current);
            } catch { }
            uploadedBgUrlRef.current = null;
          }
          const url = URL.createObjectURL(file);
          uploadedBgUrlRef.current = url;
          setBgImageUrl(url);
        }}
        onResetBg={() => setBgImageUrl(DEFAULT_BG_DATA_URL)}
      />

      <div className={`h-[100dvh] overflow-hidden ${pageBg}`}>
        <div className="h-full w-full px-2 sm:px-4 pt-3 pb-[calc(84px+env(safe-area-inset-bottom))] sm:pb-[calc(94px+env(safe-area-inset-bottom))] flex flex-col gap-3 sm:gap-4 min-h-0">
          {TopBar}

          <div
            className={
              "relative grid grid-rows-1 gap-3 sm:gap-4 flex-1 min-h-0 h-full " +
              (rightPanelOpen ? "lg:grid-cols-[minmax(0,1fr),380px] xl:grid-cols-[minmax(0,1fr),420px]" : "grid-cols-1")
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
              ) : !authReady ? (
                <div className="h-full w-full flex items-center justify-center opacity-70 text-sm">Preparing auth…</div>
              ) : tokenLoading ? (
                <div className="h-full w-full flex items-center justify-center opacity-70 text-sm">Getting token…</div>
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
                  <RemoteAudioRenderer room={roomState} audioOutputId={prejoin.audioOutputId || "default"} />

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
                            showBadge={t.isLocal && isHost ? "HOST" : null}
                            hostActions={
                              !t.isLocal && isHost && t.participantIdentity
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
                                : undefined
                            }
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* RIGHT PANEL desktop */}
            {rightPanelOpen && isLgUp && (
              <div className="min-h-0 h-full overflow-hidden">{RightPanelBody}</div>
            )}

            {/* RIGHT PANEL mobile overlay */}
            {rightPanelOpen && !isLgUp && (
              <div className="absolute inset-0 z-40 min-h-0">
                <div className="absolute inset-0 bg-black/40" onClick={() => openRightTab(null)} />
                <div className="absolute inset-x-0 top-0 bottom-0 p-1 sm:p-2 min-h-0">
                  {RightPanelBody}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* bottom controls (aligned with RoomPage style) */}
        <div className="fixed inset-x-0 bottom-0 z-50">
          <div className="w-full px-2 sm:px-4 pb-[calc(8px+env(safe-area-inset-bottom))]">
            <div
              className={`h-[64px] sm:h-[74px] rounded-2xl shadow-2xl backdrop-blur grid grid-cols-[auto,1fr,auto] items-center px-2 sm:px-4 ${bottomBarBg}`}
            >
              {/* left */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openRightTab("participants")}
                  className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                  title="Participants"
                >
                  <span className={isLight ? "text-black/70" : "text-white/85"}>👥</span>
                </button>

                <button
                  onClick={() => openRightTab("chat")}
                  className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                  title="Chat"
                >
                  <span className={isLight ? "text-black/70" : "text-white/85"}>💬</span>
                </button>

                <button
                  onClick={() => openRightTab("intentions")}
                  className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                  title="Intentions"
                >
                  <span className={isLight ? "text-black/70" : "text-white/85"}>📝</span>
                </button>
              </div>

              {/* center */}
              <div className="flex items-center justify-center gap-2 sm:gap-3">
                <button
                  onClick={toggleMic}
                  className={`h-10 sm:h-11 px-3 sm:px-4 rounded-2xl font-semibold transition ${micOn
                    ? isLight
                      ? "bg-black/5 hover:bg-black/10 text-black/80"
                      : "bg-[#111827] hover:bg-[#1f2937] text-white/85"
                    : "bg-red-600 hover:bg-red-700 text-white"
                    }`}
                  title={micOn ? "Mute microphone" : "Unmute microphone"}
                >
                  <span className="hidden sm:inline">{micOn ? "🎤 Mic on" : "🔇 Mic off"}</span>
                  <span className="sm:hidden">{micOn ? "🎤" : "🔇"}</span>
                </button>

                <button
                  onClick={toggleCam}
                  className={`h-10 sm:h-11 px-3 sm:px-4 rounded-2xl font-semibold transition ${camOn
                    ? isLight
                      ? "bg-black/5 hover:bg-black/10 text-black/80"
                      : "bg-[#111827] hover:bg-[#1f2937] text-white/85"
                    : "bg-red-600 hover:bg-red-700 text-white"
                    }`}
                  title={camOn ? "Turn camera off" : "Turn camera on"}
                >
                  <span className="hidden sm:inline">{camOn ? "📷 Cam on" : "🚫 Cam off"}</span>
                  <span className="sm:hidden">{camOn ? "📷" : "🚫"}</span>
                </button>

                <button
                  onClick={() => setFxSettingsOpen(true)}
                  className={`h-10 sm:h-11 px-3 sm:px-4 rounded-2xl font-semibold transition ${isLight
                    ? "bg-black/5 hover:bg-black/10 text-black/80"
                    : "bg-[#111827] hover:bg-[#1f2937] text-white/85"
                    }`}
                  title="Video FX settings"
                >
                  <span className="hidden sm:inline">🎛️ FX</span>
                  <span className="sm:hidden">🎛️</span>
                </button>
              </div>

              {/* right */}
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={leave}
                  className="h-10 sm:h-11 px-3 sm:px-4 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-semibold"
                  title="Leave room"
                >
                  <span className="hidden sm:inline">Leave</span>
                  <span className="sm:hidden">⎋</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default RoomPageLiveKit;