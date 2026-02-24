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
  LocalTrackPublication,
  RemoteTrackPublication,
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
function getSessionHostUserId(session: SessionRow | null): string {
  if (!session) return "";
  return str((session as any)?.host_profile?.id || (session as any)?.host_id);
}
function getSessionHostLiveKitIdentity(session: SessionRow | null): string {
  const hostId = getSessionHostUserId(session);
  return hostId ? safeIdentity(hostId) : "";
}
function isRemoteAudioTrackInstance(track: unknown): track is RemoteAudioTrack {
  return !!track && typeof track === "object" && (track as any).kind === Track.Kind.Audio;
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
  const activeBtn = isLight ? "bg-blue-600 text-white" : "bg-emerald-500 text-[#03110a]";
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
  localProcessedPreviewTrack,
}: {
  label: string;
  videoTrack?: Track;
  isLocal: boolean;
  theme: RoomTheme;
  showBadge?: string | null;
  hostActions?: HostTileActions;
  localProcessedPreviewTrack?: MediaStreamTrack | null;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const isLight = theme === "light";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let cleanupAttached = false;

    // Always clear previous source first
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

    // If local processed preview track exists, use raw MediaStreamTrack preview
    if (isLocal && localProcessedPreviewTrack) {
      try {
        const ms = new MediaStream([localProcessedPreviewTrack]);
        (el as any).srcObject = ms;
        el.muted = true;
        void el.play().catch(() => { });
      } catch (e) {
        console.error("attach local processed preview failed:", e);
      }

      return () => {
        try {
          el.pause();
        } catch { }
        try {
          (el as any).srcObject = null;
        } catch { }
      };
    }

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
  }, [videoTrack, isLocal, localProcessedPreviewTrack]);

  return (
    <div
      className={
        "relative rounded-2xl overflow-hidden border " +
        (isLight ? "border-black/10 bg-white/70" : "border-white/10 bg-black/20")
      }
    >
      <div className="w-full aspect-video">
        {videoTrack || (isLocal && localProcessedPreviewTrack) ? (
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
      p.audioTrackPublications.forEach((pub: RemoteTrackPublication) => {
        if ((pub as any).source !== Track.Source.Microphone) return;
        const t = pub.track;
        if (!isRemoteAudioTrackInstance(t)) return;
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
      try {
        el.pause();
      } catch { }
      try {
        (el as any).srcObject = null;
      } catch { }
    };
  }, [track, audioOutputId, debugLabel]);

  return <audio ref={ref} autoPlay playsInline />;
}

// ---- Video FX helpers ----
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
      throw new Error("Modern background processors are not supported in this browser/device");
    }
    return;
  }

  if (typeof mod?.supportsBackgroundProcessors === "function") {
    const ok = await Promise.resolve(mod.supportsBackgroundProcessors());
    if (!ok) {
      throw new Error("Background processors are not supported in this browser/device");
    }
  }
}

async function createBlurProcessor(blurRadius: number): Promise<any> {
  const mod = await resolveTrackProcessorsModule();
  await ensureBackgroundProcessorsSupported(mod);

  if (mod?.BackgroundBlur?.create) {
    try {
      return await mod.BackgroundBlur.create({ blurRadius });
    } catch (e) {
      try {
        return await mod.BackgroundBlur.create({ strength: blurRadius });
      } catch {
        throw e;
      }
    }
  }

  if (typeof mod?.createBackgroundBlurProcessor === "function") {
    try {
      return await mod.createBackgroundBlurProcessor({ blurRadius });
    } catch (e) {
      try {
        return await mod.createBackgroundBlurProcessor({ strength: blurRadius });
      } catch {
        throw e;
      }
    }
  }

  if (typeof mod?.BackgroundBlur === "function") {
    try {
      return mod.BackgroundBlur({ blurRadius });
    } catch {
      try {
        return new mod.BackgroundBlur({ blurRadius });
      } catch {
        try {
          return mod.BackgroundBlur({ strength: blurRadius });
        } catch {
          try {
            return new mod.BackgroundBlur({ strength: blurRadius });
          } catch { }
        }
      }
    }
  }

  if (typeof mod?.backgroundBlur === "function") {
    try {
      return mod.backgroundBlur({ blurRadius });
    } catch {
      return mod.backgroundBlur({ strength: blurRadius });
    }
  }

  throw new Error(
    "BackgroundBlur processor is unavailable (unsupported export API in current @livekit/track-processors version)"
  );
}

function preloadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    try {
      if (/^https?:/i.test(url)) img.crossOrigin = "anonymous";
    } catch { }

    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e || new Error("image_load_failed"));
    img.src = url;
  });
}

async function createVirtualBackgroundProcessor(imageUrl: string): Promise<any> {
  const mod = await resolveTrackProcessorsModule();
  await ensureBackgroundProcessorsSupported(mod);

  let preloadedImg: HTMLImageElement | null = null;
  try {
    preloadedImg = await preloadImage(imageUrl);
  } catch (e) {
    console.warn("[LK FX] preloadImage failed, will still try URL-based virtual background:", e);
  }

  const attempts: Array<() => Promise<any> | any> = [];

  if (mod?.VirtualBackground?.create) {
    attempts.push(() => mod.VirtualBackground.create({ imageUrl }));
    attempts.push(() => mod.VirtualBackground.create({ imagePath: imageUrl }));
    if (preloadedImg) attempts.push(() => mod.VirtualBackground.create({ backgroundImage: preloadedImg }));
    if (preloadedImg) attempts.push(() => mod.VirtualBackground.create({ image: preloadedImg }));
  }

  if (typeof mod?.createVirtualBackgroundProcessor === "function") {
    attempts.push(() => mod.createVirtualBackgroundProcessor({ imageUrl }));
    attempts.push(() => mod.createVirtualBackgroundProcessor({ imagePath: imageUrl }));
    if (preloadedImg) attempts.push(() => mod.createVirtualBackgroundProcessor({ backgroundImage: preloadedImg }));
    if (preloadedImg) attempts.push(() => mod.createVirtualBackgroundProcessor({ image: preloadedImg }));
  }

  if (typeof mod?.VirtualBackground === "function") {
    attempts.push(() => mod.VirtualBackground({ imageUrl }));
    attempts.push(() => mod.VirtualBackground({ imagePath: imageUrl }));
    if (preloadedImg) attempts.push(() => mod.VirtualBackground({ backgroundImage: preloadedImg }));
    if (preloadedImg) attempts.push(() => mod.VirtualBackground({ image: preloadedImg }));

    attempts.push(() => new mod.VirtualBackground({ imageUrl }));
    attempts.push(() => new mod.VirtualBackground({ imagePath: imageUrl }));
    if (preloadedImg) attempts.push(() => new mod.VirtualBackground({ backgroundImage: preloadedImg }));
    if (preloadedImg) attempts.push(() => new mod.VirtualBackground({ image: preloadedImg }));
  }

  if (typeof mod?.virtualBackground === "function") {
    attempts.push(() => mod.virtualBackground({ imageUrl }));
    attempts.push(() => mod.virtualBackground({ imagePath: imageUrl }));
    if (preloadedImg) attempts.push(() => mod.virtualBackground({ backgroundImage: preloadedImg }));
    if (preloadedImg) attempts.push(() => mod.virtualBackground({ image: preloadedImg }));
  }

  const errors: any[] = [];

  for (const run of attempts) {
    try {
      const res = await run();
      if (res) return res;
    } catch (e) {
      errors.push(e);
    }
  }

  const msg =
    errors.length > 0
      ? String(errors[errors.length - 1]?.message || errors[errors.length - 1] || "virtual_bg_failed")
      : "VirtualBackground processor is unavailable";

  throw new Error(`VirtualBackground processor failed: ${msg}`);
}

async function setLocalVideoTrackProcessor(track: any, processor: any) {
  if (!track || typeof track.setProcessor !== "function") {
    throw new Error("LocalVideoTrack.setProcessor is unavailable in your livekit-client version");
  }

  // Try boolean signature first (most common)
  try {
    const res = await track.setProcessor(processor, true);
    return res;
  } catch { }

  // Try options object signature
  try {
    const res = await track.setProcessor(processor, { showProcessedStreamLocally: true });
    return res;
  } catch { }

  // Last resort
  return track.setProcessor(processor);
}

async function clearLocalVideoTrackProcessor(track: any) {
  if (!track) return;

  // Some versions expose stopProcessor()
  if (typeof track.stopProcessor === "function") {
    try {
      await track.stopProcessor();
      await delay(120);
      return;
    } catch { }
  }

  if (typeof track.setProcessor === "function") {
    try {
      await track.setProcessor(null);
      await delay(120);
      return;
    } catch { }
  }

  await delay(80);
}

function isMediaStreamTrackLike(v: any): v is MediaStreamTrack {
  return !!v && typeof v === "object" && v.kind === "video" && typeof v.stop === "function";
}

function findVideoTrackDeep(root: any, original?: MediaStreamTrack | null): MediaStreamTrack | null {
  const visited = new Set<any>();

  const preferredKeys = [
    "processedTrack",
    "outputTrack",
    "track",
    "mediaStreamTrack",
    "processedMediaStreamTrack",
    "videoTrack",
    "processedStream",
    "outputStream",
    "stream",
    "_processedTrack",
    "_outputTrack",
    "_track",
  ];

  const isStreamLike = (v: any): v is MediaStream =>
    !!v && typeof v === "object" && typeof v.getVideoTracks === "function";

  const walk = (node: any, depth: number): MediaStreamTrack | null => {
    if (!node || depth < 0) return null;
    if (typeof node !== "object" && typeof node !== "function") return null;
    if (visited.has(node)) return null;
    visited.add(node);

    if (isMediaStreamTrackLike(node)) {
      if (!original || node !== original) return node;
    }

    if (isStreamLike(node)) {
      const t = node.getVideoTracks?.()[0];
      if (t && (!original || t !== original)) return t;
    }

    for (const k of preferredKeys) {
      try {
        if (k in node) {
          const hit = walk((node as any)[k], depth - 1);
          if (hit) return hit;
        }
      } catch { }
    }

    try {
      const keys = Object.keys(node).slice(0, 80);
      for (const k of keys) {
        const hit = walk((node as any)[k], depth - 1);
        if (hit) return hit;
      }
    } catch { }

    return null;
  };

  return walk(root, 7);
}

function getOriginalLocalMediaStreamTrack(localTrack: any): MediaStreamTrack | null {
  const candidates = [
    localTrack?.mediaStreamTrack,
    localTrack?._mediaStreamTrack,
    localTrack?.track,
    localTrack?._track,
  ];

  for (const c of candidates) {
    if (isMediaStreamTrackLike(c)) return c;
  }

  return null;
}

function extractProcessedPreviewTrack(localTrack: any, extraRoots: any[] = []): MediaStreamTrack | null {
  if (!localTrack) return null;
  const original = getOriginalLocalMediaStreamTrack(localTrack);

  const processorCandidates = [
    localTrack?.processor,
    localTrack?._processor,
    localTrack?.processorWrapper,
    localTrack?._processorWrapper,
  ];

  for (const r of extraRoots) {
    const found = findVideoTrackDeep(r, original);
    if (found) return found;
  }

  for (const p of processorCandidates) {
    const found = findVideoTrackDeep(p, original);
    if (found) return found;
  }

  return findVideoTrackDeep(localTrack, original);
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

  isHostTile?: boolean;
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
  const pageBg = isLight ? "bg-[#F6F7FB] text-[#0B1220]" : "bg-[#050F1A] text-white";
  const panelBg = isLight
    ? "bg-white/85 border border-black/10"
    : "bg-[#0B1220]/55 border border-white/5";

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
    const hostId = getSessionHostUserId(session);
    return !!hostId && String(hostId) === String(authUserId);
  }, [authUserId, session]);

  const hostIdentityFromSession = useMemo(() => getSessionHostLiveKitIdentity(session), [session]);

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
        setPrejoin((prev) => ({
          ...prev,
          displayName: prev.displayName || name || "Guest",
        }));
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

  // Apply runner queue (single-flight)
  const fxQueuedRef = useRef<FxMode | null>(null);
  const fxRunningRef = useRef(false);
  const fxCallIdRef = useRef(0);

  // Dedup: remember last applied *effective* config
  const lastAppliedRef = useRef<{ mode: FxMode; blur: number; bg: string } | null>(null);

  // Processed preview fallback (if SDK does not preview processed stream)
  const [localProcessedPreviewTrack, setLocalProcessedPreviewTrack] = useState<MediaStreamTrack | null>(null);

  const uploadedBgUrlRef = useRef<string | null>(null);

  const roomNameForApi = useMemo(() => {
    if (!session) return "";
    return safeRoomName(`session-${session.id}`);
  }, [session]);

  const rebuildTiles = () => {
    const room = roomRef.current;
    if (!room) return;

    const next: TileModel[] = [];
    const hostIdentity = hostIdentityFromSession;

    // local
    const lp = room.localParticipant;
    const localCamPub = Array.from(lp.videoTrackPublications.values()).find(
      (p) => p.source === Track.Source.Camera
    );
    const localMicPub = Array.from(lp.audioTrackPublications.values()).find(
      (p) => p.source === Track.Source.Microphone
    );
    const localTrack = (localCamPub?.track as any) || undefined;

    const localIdentity = str((lp as any)?.identity);
    const localIsHostTile = !!hostIdentity && localIdentity === hostIdentity;

    next.push({
      id: "local",
      label: (displayName || userName || "You").trim() || "You",
      isLocal: true,
      videoTrack: localTrack,
      participantIdentity: localIdentity || undefined,
      micTrackSid: (localMicPub as any)?.trackSid,
      camTrackSid: (localCamPub as any)?.trackSid,
      micMuted: !micOn,
      camMuted: !camOn,
      isHostTile: localIsHostTile || isHost,
    });

    // remote
    room.remoteParticipants.forEach((rp: RemoteParticipant) => {
      const allVideoPubs = Array.from(rp.videoTrackPublications.values()) as RemoteTrackPublication[];
      const allAudioPubs = Array.from(rp.audioTrackPublications.values()) as RemoteTrackPublication[];

      const camPub = allVideoPubs.find((p: any) => p.source === Track.Source.Camera);
      const micPub = allAudioPubs.find((p: any) => p.source === Track.Source.Microphone);

      const vt = (camPub?.track as any) || undefined;
      const nm = (rp.name || rp.identity || "Guest").trim() || "Guest";
      const rpIdentity = str(rp.identity);

      next.push({
        id: rp.sid,
        label: nm,
        isLocal: false,
        videoTrack: vt,
        participantIdentity: rpIdentity,
        micTrackSid: micPub?.trackSid,
        camTrackSid: camPub?.trackSid,
        micMuted: !!(micPub as any)?.isMuted,
        camMuted: !!(camPub as any)?.isMuted,
        isHostTile: !!hostIdentity && rpIdentity === hostIdentity,
      });
    });

    // Host first for everyone, then local, then others
    next.sort((a, b) => {
      const rank = (t: TileModel) => (t.isHostTile ? 0 : t.isLocal ? 1 : 2);
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;

      if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;

      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
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
      setLocalProcessedPreviewTrack(null);
      setFxStatusText("");
      setFxError("");
      setFxApplying(false);
      fxQueuedRef.current = null;
      fxRunningRef.current = false;
      lastAppliedRef.current = null;
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
        setLocalProcessedPreviewTrack(null);
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
      window.setTimeout(() => rebuildTiles(), 60);
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
        setLocalProcessedPreviewTrack(null);
        fxQueuedRef.current = null;
        lastAppliedRef.current = null;
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

  // ---- Apply Blur / Virtual Background ----
  const getLocalCameraTrack = (): LocalVideoTrack | null => {
    const r = roomRef.current;
    if (!r) return null;
    const lp = r.localParticipant;
    const camPub = Array.from(lp.videoTrackPublications.values()).find(
      (p: LocalTrackPublication) => p.source === Track.Source.Camera
    );
    const tr = camPub?.track;
    return (tr as any) || null;
  };

  const syncLocalProcessedPreviewTrack = async (track: any, extraRoots: any[] = []) => {
    for (let i = 0; i < 16; i++) {
      const found = extractProcessedPreviewTrack(track, extraRoots);
      if (found) {
        setLocalProcessedPreviewTrack(found);
        setFxStatusText("Processed preview attached locally");
        return true;
      }
      await delay(120);
    }

    setLocalProcessedPreviewTrack(null);
    setFxStatusText("Effect applied (published stream). Local preview fallback");
    return false;
  };

  const scheduleApply = (mode: FxMode) => {
    // push latest
    fxQueuedRef.current = mode;
    void runApplyLoop();
  };

  const runApplyLoop = async () => {
    if (fxRunningRef.current) return;
    fxRunningRef.current = true;

    try {
      while (fxQueuedRef.current) {
        const nextMode = fxQueuedRef.current;
        fxQueuedRef.current = null;

        const callId = ++fxCallIdRef.current;

        setFxError("");
        setFxApplying(true);
        setFxStatusText("");
        setVideoFxMode(nextMode);

        const track = getLocalCameraTrack();
        if (!track) {
          setFxError("No local camera track to apply effects (turn camera on).");
          setFxApplying(false);
          continue;
        }

        // Dedup by effective config
        const effective = { mode: nextMode, blur: blurStrength, bg: bgImageUrl };
        const last = lastAppliedRef.current;
        const sameAsLast =
          last &&
          last.mode === effective.mode &&
          last.blur === effective.blur &&
          last.bg === effective.bg;

        if (sameAsLast) {
          setFxStatusText("Already applied (dedup)");
          setFxApplying(false);
          continue;
        }

        try {
          setLocalProcessedPreviewTrack(null);

          // Clear old processor first
          await clearLocalVideoTrackProcessor(track as any);

          // allow teardown to settle
          await delay(90);

          if (callId !== fxCallIdRef.current) {
            setFxApplying(false);
            continue;
          }

          if (nextMode === "off") {
            lastAppliedRef.current = { mode: "off", blur: blurStrength, bg: bgImageUrl };
            setFxStatusText("Effects disabled");
            setFxApplying(false);
            continue;
          }

          if (nextMode === "blur") {
            const proc = await createBlurProcessor(blurStrength);
            if (!proc) throw new Error("BackgroundBlur processor is unavailable.");

            const setRes = await setLocalVideoTrackProcessor(track as any, proc);

            try {
              console.log("[LK FX] setProcessor blur result:", setRes);
              console.log("[LK FX] track.processor?", (track as any)?.processor || (track as any)?._processor);
            } catch { }

            await syncLocalProcessedPreviewTrack(track as any, [proc, setRes]);
            lastAppliedRef.current = { mode: "blur", blur: blurStrength, bg: bgImageUrl };
            setFxStatusText((prev) => prev || `Blur applied (strength ${blurStrength})`);
            setFxApplying(false);
            continue;
          }

          if (nextMode === "bg") {
            const proc = await createVirtualBackgroundProcessor(bgImageUrl);
            if (!proc) throw new Error("VirtualBackground processor is unavailable.");

            const setRes = await setLocalVideoTrackProcessor(track as any, proc);

            try {
              console.log("[LK FX] setProcessor bg result:", setRes);
              console.log("[LK FX] track.processor?", (track as any)?.processor || (track as any)?._processor);
            } catch { }

            await syncLocalProcessedPreviewTrack(track as any, [proc, setRes]);
            lastAppliedRef.current = { mode: "bg", blur: blurStrength, bg: bgImageUrl };
            setFxStatusText((prev) => prev || "Virtual background applied");
            setFxApplying(false);
            continue;
          }
        } catch (e: any) {
          console.error("applyVideoFx error:", e);
          setFxError(String(e?.message || e || "video_fx_failed"));
          setFxApplying(false);
        }
      }
    } finally {
      fxRunningRef.current = false;
    }
  };

  // Re-apply BG when image changes (dedup inside runner)
  useEffect(() => {
    if (videoFxMode !== "bg") return;
    if (!connected || !camOn) return;
    if (fxApplying) return;

    const t = window.setTimeout(() => scheduleApply("bg"), 260);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgImageUrl]);

  // Re-apply blur when strength changes (dedup inside runner)
  useEffect(() => {
    if (videoFxMode !== "blur") return;
    if (!connected || !camOn) return;
    if (fxApplying) return;

    const t = window.setTimeout(() => scheduleApply("blur"), 260);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blurStrength]);

  // Re-apply current effect after camera on/reconnect (once)
  useEffect(() => {
    if (!connected) return;
    if (!camOn) return;
    if (videoFxMode === "off") return;
    if (fxApplying) return;

    const t = window.setTimeout(() => scheduleApply(videoFxMode), 420);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, camOn]);

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
  const participantsCount = tiles.length;

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
        onSetBgImageUrl={(url) => {
          setBgImageUrl(url);
          // NO direct apply here — avoids double apply thrash
        }}
        onApplyMode={(m) => {
          scheduleApply(m);
        }}
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
          // NO direct apply here — useEffect(bgImageUrl) will schedule apply if mode=bg
        }}
        onResetBg={() => {
          setBgImageUrl(DEFAULT_BG_DATA_URL);
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
                  {isHost ? " • HOST" : ""} • participants: {participantsCount}
                </div>

                <div className={isLight ? "text-black/40 text-[11px]" : "text-white/40 text-[11px]"}>
                  LK_URL: {lkServerUrl || "(missing)"} • token: {tokenEndpoint} • admin: {adminEndpoint} • templates:{" "}
                  {templatesCount}
                </div>

                {!!videoFxMode && videoFxMode !== "off" ? (
                  <div className={isLight ? "text-black/40 text-[11px]" : "text-white/40 text-[11px]"}>
                    FX mode: {videoFxMode} {videoFxMode === "blur" ? `(strength ${blurStrength})` : ""}
                    {localProcessedPreviewTrack ? " • local processed preview: ON" : " • local processed preview: fallback"}
                    {fxApplying ? " • applying..." : ""}
                  </div>
                ) : null}

                {fxError ? (
                  <div className="mt-1 text-[11px] text-red-500 break-words">
                    Video FX error: {fxError}
                  </div>
                ) : null}
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
                  onClick={() => setFxSettingsOpen(true)}
                  className={isLight ? "px-3 py-2 rounded-xl bg-black/5" : "px-3 py-2 rounded-xl bg-white/5"}
                  title="Video FX settings"
                >
                  🎛️ Video
                </button>

                <button
                  onClick={() => openRightTab("participants")}
                  className={isLight ? "px-3 py-2 rounded-xl bg-black/5" : "px-3 py-2 rounded-xl bg-white/5"}
                >
                  People
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
              ) : !authReady ? (
                <div className="h-full w-full flex items-center justify-center opacity-70 text-sm">
                  Preparing auth…
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
                            showBadge={t.isHostTile ? "HOST" : null}
                            localProcessedPreviewTrack={t.isLocal ? localProcessedPreviewTrack : null}
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

                    {/* controls */}
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
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
                          onClick={() => setFxSettingsOpen(true)}
                          className={
                            isLight
                              ? "px-3 py-2 rounded-xl bg-black/5 hover:bg-black/10 text-black/80"
                              : "px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/85"
                          }
                          title="Open video FX settings"
                        >
                          🎛️ FX Settings
                        </button>

                        {videoFxMode !== "off" ? (
                          <button
                            onClick={() => scheduleApply("off")}
                            className={
                              isLight
                                ? "px-3 py-2 rounded-xl bg-black/5 hover:bg-black/10 text-black/80"
                                : "px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/85"
                            }
                            title="Disable FX quickly"
                          >
                            FX off
                          </button>
                        ) : null}

                        <button
                          onClick={leave}
                          className="px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold"
                        >
                          Leave
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openRightTab("participants")}
                          className={
                            isLight
                              ? "px-3 py-2 rounded-xl bg-black/5 hover:bg-black/10"
                              : "px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10"
                          }
                          title="Toggle participants panel"
                        >
                          👥
                        </button>
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
                      {rightTab === "chat"
                        ? "Chat"
                        : rightTab === "intentions"
                          ? "Intentions"
                          : rightTab === "participants"
                            ? "Participants"
                            : "Panel"}
                    </div>
                    <button
                      onClick={() => openRightTab(null)}
                      className={isLight ? "w-9 h-9 rounded-xl bg-black/5" : "w-9 h-9 rounded-xl bg-white/5"}
                    >
                      ✕
                    </button>
                  </div>

                  <div className="flex-1 min-h-0 overflow-hidden p-3">
                    {rightTab === "participants" && (
                      <div className="h-full min-h-0 overflow-y-auto rounded-xl">
                        <div className="flex flex-col gap-2">
                          {tiles.map((p) => {
                            const micMuted = p.isLocal ? !micOn : !!p.micMuted;
                            const camMuted = p.isLocal ? !camOn : !!p.camMuted;

                            return (
                              <div
                                key={`participant-${p.id}`}
                                className={
                                  "rounded-xl px-3 py-2 border flex items-center justify-between gap-3 " +
                                  (isLight ? "border-black/10 bg-white" : "border-white/10 bg-white/5")
                                }
                              >
                                <div className="min-w-0">
                                  <div className="text-sm font-medium truncate">
                                    {p.label}
                                    {p.isLocal ? " (you)" : ""}
                                  </div>
                                  <div className={isLight ? "text-[11px] text-black/50" : "text-[11px] text-white/50"}>
                                    {p.isHostTile ? "HOST" : "participant"}
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 text-sm">
                                  <span title={micMuted ? "Mic off" : "Mic on"}>{micMuted ? "🔇" : "🎤"}</span>
                                  <span title={camMuted ? "Cam off" : "Cam on"}>{camMuted ? "🚫" : "📷"}</span>
                                </div>
                              </div>
                            );
                          })}

                          {tiles.length === 0 && (
                            <div className={isLight ? "text-sm text-black/60" : "text-sm text-white/60"}>
                              No participants yet.
                            </div>
                          )}
                        </div>
                      </div>
                    )}

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

        {/* leave floating */}
        <div className="fixed bottom-3 right-3 z-50">
          <button onClick={leave} className="px-4 py-3 rounded-2xl bg-red-600 text-white font-semibold">
            Leave
          </button>
        </div>
      </div>
    </>
  );
}

export default RoomPageLiveKit;