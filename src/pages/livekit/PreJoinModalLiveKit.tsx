import React, { useEffect, useMemo, useRef, useState } from "react";
import type { LocalVideoTrack } from "livekit-client";

type RoomTheme = "dark" | "light";
type FxMode = "off" | "blur" | "bg";

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

type BgPreset = { id: string; label: string; url: string };

function deviceLabel(d: MediaDeviceInfo, fallback: string) {
  const l = (d.label || "").trim();
  return l || fallback;
}

type PreJoinModalProps = {
  open: boolean;
  theme: RoomTheme;
  devices: MediaDevicesResult;
  value: PreJoinSettings;
  onChange: (next: PreJoinSettings) => void;
  onJoin: () => void;
  onCancel: () => void;
  onRefreshDevices: () => void;

  onPrepareAudioGesture?: () => void;
  onTestSpeaker?: () => void;

  previewVideoTrack?: LocalVideoTrack | null;
  previewVersion?: number;

  videoFxMode: FxMode;
  blurStrength: number;
  bgImageUrl: string;

  fxApplying: boolean;
  fxError: string;
  fxStatusText: string;

  fxBgPresets: BgPreset[];

  onApplyVideoFx: (mode: FxMode) => Promise<void> | void;
  onBlurStrengthChange: (next: number) => void;
  onSetBgImageUrl: (url: string) => void;
  onUploadBg: (file: File) => void;
  onResetBg: () => void;

  hideBackgroundFx?: boolean;
};

function IconMic({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 17v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.5 21h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconMicOff({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 8.52 4.62" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 17v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.5 21h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconCamera({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3" y="7" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15 10l5-3v10l-5-3" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function IconCameraOff({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3" y="7" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15 10l5-3v10l-5-3" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconSparkles({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M5 14l.9 2.1L8 17l-2.1.9L5 20l-.9-2.1L2 17l2.1-.9L5 14z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function IconVolume({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M4 10h4l5-4v12l-5-4H4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M17 9a4 4 0 0 1 0 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M19 6.5a7.5 7.5 0 0 1 0 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconRefresh({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M20 6v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 11a8 8 0 1 0 2 5.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCheck({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PreJoinModal({
  open,
  theme,
  devices,
  value,
  onChange,
  onJoin,
  onCancel,
  onRefreshDevices,
  onPrepareAudioGesture,
  onTestSpeaker,

  previewVideoTrack,
  previewVersion,

  videoFxMode,
  blurStrength,
  bgImageUrl,

  fxApplying,
  fxError,
  fxStatusText,

  fxBgPresets,

  onApplyVideoFx,
  onBlurStrengthChange,
  onSetBgImageUrl,
  onUploadBg,
  onResetBg,

  hideBackgroundFx = false,
}: PreJoinModalProps) {
  const isLight = theme === "light";

  const overlay =
    "fixed inset-0 z-[999] flex items-stretch sm:items-center justify-center " +
    "px-0 sm:px-4 py-0 sm:py-6 " +
    "pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]";

  const backdrop = "absolute inset-0 bg-black/55";

  const card = [
    "relative w-full sm:max-w-[640px] rounded-none sm:rounded-[28px] shadow-2xl overflow-hidden",
    "max-h-[100dvh] sm:max-h-[92dvh]",
    "flex flex-col",
    isLight ? "bg-[#fafafa] text-black" : "bg-[#0a1020] text-white",
    "border",
    isLight ? "border-black/10" : "border-white/10",
  ].join(" ");

  const headerCls = `px-4 sm:px-5 py-3 sm:py-4 border-b ${isLight ? "border-black/10" : "border-white/10"
    }`;

  const bodyCls =
    "flex-1 min-h-0 overflow-y-auto overscroll-contain " +
    "px-4 sm:px-5 py-4 custom-scrollbar";

  const footerCls = `px-4 sm:px-5 py-3 sm:py-4 border-t flex items-center justify-between gap-3 ${isLight ? "border-black/10" : "border-white/10"
    }`;

  const surface = isLight
    ? "bg-white border border-black/10"
    : "bg-white/5 border border-white/10";

  const mutedSurface = isLight
    ? "bg-black/[0.03] border border-black/10"
    : "bg-[#0f172a]/70 border border-white/10";

  const labelCls = isLight ? "text-black/65" : "text-white/65";
  const subtleCls = isLight ? "text-black/50" : "text-white/50";
  const inputCls = isLight
    ? "text-black placeholder:text-black/35"
    : "text-white placeholder:text-white/35";

  const btnGhost = isLight
    ? "bg-black/5 hover:bg-black/10 text-black/75"
    : "bg-white/7 hover:bg-white/12 text-white/85";

  const btnPrimary = isLight
    ? "bg-blue-600 hover:bg-blue-700 text-white"
    : "bg-emerald-500 hover:bg-emerald-600 text-[#04170d]";

  const selectedPill = isLight
    ? "bg-black text-white border-black"
    : "bg-white text-black border-white";

  const idlePill = isLight
    ? "bg-white text-black/80 border-black/10 hover:bg-black/[0.03]"
    : "bg-white/5 text-white/80 border-white/10 hover:bg-white/10";

  const dangerPill = isLight
    ? "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
    : "bg-red-500/15 text-red-200 border-red-400/30 hover:bg-red-500/25";

  const iconToggleBase =
    "h-10 px-3 rounded-2xl border inline-flex items-center justify-center gap-2 text-[13px] font-semibold transition";
  const tinyButton =
    "h-10 px-3 rounded-2xl border inline-flex items-center justify-center gap-2 text-[13px] font-semibold transition";

  const selectCls = [
    "w-full outline-none text-[13px] rounded-2xl px-3 py-2.5",
    isLight
      ? "bg-white text-black border border-black/10"
      : "bg-[#0B1220]/70 text-white border border-white/10",
  ].join(" ");

  const selectStyle: React.CSSProperties = isLight
    ? { color: "#0b1220", backgroundColor: "#ffffff" }
    : { color: "#ffffff", backgroundColor: "#0b1220" };

  const optionStyle: React.CSSProperties = isLight
    ? { color: "#0b1220", backgroundColor: "#ffffff" }
    : { color: "#ffffff", backgroundColor: "#0b1220" };

  const previewHostRef = useRef<HTMLDivElement | null>(null);
  const attachedPreviewElRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);

  const [blurDraft, setBlurDraft] = useState<number>(blurStrength);
  const lastAutoBlurKeyRef = useRef<string>("");
  const lastAutoBgKeyRef = useRef<string>("");

  useEffect(() => {
    setBlurDraft(blurStrength);
  }, [blurStrength]);

  useEffect(() => {
    const host = previewHostRef.current;
    if (!host) return;

    const cleanup = () => {
      try {
        if (
          previewVideoTrack &&
          attachedPreviewElRef.current &&
          typeof (previewVideoTrack as any)?.detach === "function"
        ) {
          (previewVideoTrack as any).detach(attachedPreviewElRef.current);
        }
      } catch {
        // ignore
      }

      try {
        attachedPreviewElRef.current?.remove();
      } catch {
        // ignore
      }

      attachedPreviewElRef.current = null;

      try {
        while (host.firstChild) host.removeChild(host.firstChild);
      } catch {
        // ignore
      }
    };

    cleanup();

    if (!open || !value.videoEnabled || !previewVideoTrack) return cleanup;

    let el: any = null;

    try {
      el = (previewVideoTrack as any).attach?.();
    } catch (e: unknown) {
      console.warn("preview attach failed", e);
      return cleanup;
    }

    if (!el) return cleanup;

    try {
      el.style.width = "100%";
      el.style.height = "100%";
      el.style.objectFit = "cover";
      el.style.backgroundColor = "#000";
      el.style.display = "block";
      el.style.transform = "translateZ(0)";
      el.style.willChange = "transform";
      el.style.backfaceVisibility = "hidden";
    } catch {
      // ignore
    }

    if (el instanceof HTMLVideoElement) {
      try {
        el.muted = true;
        el.defaultMuted = true;
        el.playsInline = true;
        el.autoplay = true;
        el.controls = false;
        el.disablePictureInPicture = true;
        el.setAttribute("muted", "true");
        el.setAttribute("playsinline", "true");
        el.setAttribute("autoplay", "true");
      } catch {
        // ignore
      }

      Promise.resolve()
        .then(() => el.play())
        .catch(() => { });
    }

    try {
      host.appendChild(el);
      attachedPreviewElRef.current = el as HTMLElement;
    } catch (e: unknown) {
      console.warn("preview append failed", e);
      return cleanup;
    }

    return cleanup;
  }, [open, value.videoEnabled, previewVideoTrack, previewVersion]);

  useEffect(() => {
    if (!open || !value.videoEnabled || hideBackgroundFx) {
      lastAutoBlurKeyRef.current = "";
      return;
    }

    if (videoFxMode !== "blur") {
      lastAutoBlurKeyRef.current = "";
      return;
    }

    const key = `blur:${blurStrength}`;
    if (lastAutoBlurKeyRef.current === key) return;
    lastAutoBlurKeyRef.current = key;

    const t = window.setTimeout(() => {
      Promise.resolve(onApplyVideoFx("blur")).catch(() => { });
    }, 280);

    return () => window.clearTimeout(t);
  }, [
    blurStrength,
    open,
    value.videoEnabled,
    videoFxMode,
    hideBackgroundFx,
    onApplyVideoFx,
  ]);

  useEffect(() => {
    if (!open || !value.videoEnabled || hideBackgroundFx) {
      lastAutoBgKeyRef.current = "";
      return;
    }

    if (videoFxMode !== "bg") {
      lastAutoBgKeyRef.current = "";
      return;
    }

    const key = `bg:${bgImageUrl}`;
    if (lastAutoBgKeyRef.current === key) return;
    lastAutoBgKeyRef.current = key;

    const t = window.setTimeout(() => {
      Promise.resolve(onApplyVideoFx("bg")).catch(() => { });
    }, 220);

    return () => window.clearTimeout(t);
  }, [
    bgImageUrl,
    open,
    value.videoEnabled,
    videoFxMode,
    hideBackgroundFx,
    onApplyVideoFx,
  ]);

  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };

    document.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onCancel]);

  const cardRef = useRef<HTMLDivElement | null>(null);

  const onFocusAny = (e: React.FocusEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    window.setTimeout(() => {
      try {
        target.scrollIntoView({
          block: "nearest",
          inline: "nearest",
          behavior: "smooth",
        });
      } catch {
        // ignore
      }
    }, 50);
  };

  const previewHint = useMemo(() => {
    if (!value.videoEnabled) return "Video is off";
    if (!previewVideoTrack) return "Preparing preview…";
    return "Preview";
  }, [value.videoEnabled, previewVideoTrack]);

  const fxBlockedReason = hideBackgroundFx
    ? "Background effects are not available on this device"
    : !value.videoEnabled
      ? "Turn video on to use FX"
      : "";

  const fxModeLabel =
    !value.videoEnabled
      ? "Off"
      : hideBackgroundFx
        ? "Clean"
        : videoFxMode === "blur"
          ? "Blur"
          : videoFxMode === "bg"
            ? "Background"
            : "Clean";

  const playFallbackTestSound = async () => {
    try {
      const Ctx =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!Ctx) return;

      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      gain.gain.value = 0.08;
      osc.frequency.value = 880;
      osc.type = "sine";

      osc.connect(gain);

      const dest = ctx.createMediaStreamDestination();
      gain.connect(dest);

      const audioEl = testAudioRef.current;
      if (!audioEl) return;

      audioEl.srcObject = dest.stream;
      await audioEl.play().catch(() => { });
      osc.start();

      window.setTimeout(() => {
        try {
          osc.stop();
        } catch {
          // ignore
        }
        try {
          void ctx.close();
        } catch {
          // ignore
        }
        try {
          audioEl.srcObject = null;
        } catch {
          // ignore
        }
      }, 350);
    } catch {
      // ignore
    }
  };

  const handleJoin = () => {
    onPrepareAudioGesture?.();
    onJoin();
  };

  const handleTestSpeaker = () => {
    onPrepareAudioGesture?.();

    if (onTestSpeaker) {
      void Promise.resolve(onTestSpeaker());
      return;
    }

    void playFallbackTestSound();
  };

  const renderTogglePill = (
    active: boolean,
    label: string,
    onClick: () => void
  ) => (
    <button
      type="button"
      onClick={onClick}
      className={`${tinyButton} ${active ? selectedPill : idlePill}`}
    >
      {active && <IconCheck className="w-3.5 h-3.5" />}
      <span>{label}</span>
    </button>
  );

  if (!open) return null;

  return (
    <div className={overlay} data-theme={theme} style={{ colorScheme: theme }}>
      <div className={backdrop} onClick={onCancel} />

      <div
        ref={cardRef}
        className={card}
        onClick={(e) => e.stopPropagation()}
        onFocusCapture={onFocusAny}
      >
        <div className={headerCls}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-inter font-semibold text-[16px]">Before you join</div>
              <div className={`mt-1 text-[12px] ${labelCls}`}>
                Quick preview, devices, and effects.
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onChange({ ...value, audioEnabled: !value.audioEnabled })}
                className={`${iconToggleBase} ${value.audioEnabled ? selectedPill : dangerPill
                  }`}
                title={value.audioEnabled ? "Mute microphone" : "Enable microphone"}
              >
                {value.audioEnabled ? (
                  <IconMic className="w-4 h-4" />
                ) : (
                  <IconMicOff className="w-4 h-4" />
                )}
                <span>{value.audioEnabled ? "Mic on" : "Mic off"}</span>
              </button>

              <button
                type="button"
                onClick={() => onChange({ ...value, videoEnabled: !value.videoEnabled })}
                className={`${iconToggleBase} ${value.videoEnabled ? selectedPill : dangerPill
                  }`}
                title={value.videoEnabled ? "Turn off camera" : "Turn on camera"}
              >
                {value.videoEnabled ? (
                  <IconCamera className="w-4 h-4" />
                ) : (
                  <IconCameraOff className="w-4 h-4" />
                )}
                <span>{value.videoEnabled ? "Cam on" : "Cam off"}</span>
              </button>

              <button
                onClick={onCancel}
                className={`w-10 h-10 rounded-2xl flex items-center justify-center ${btnGhost}`}
                title="Close"
                type="button"
              >
                ✕
              </button>
            </div>
          </div>
        </div>

        <div className={bodyCls}>
          <div className="flex flex-col gap-4">
            <div className={`rounded-[26px] overflow-hidden ${surface}`}>
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold">{previewHint}</div>
                  <div className={`text-[11px] ${subtleCls}`}>{fxModeLabel}</div>
                </div>

                <button
                  type="button"
                  onClick={handleJoin}
                  disabled={fxApplying}
                  className={`h-10 px-4 rounded-2xl text-[13px] font-semibold ${btnPrimary} disabled:opacity-70`}
                >
                  Join
                </button>
              </div>

              <div className="px-3 pb-3">
                <div className="relative overflow-hidden rounded-[22px] bg-black aspect-[16/10]">
                  {value.videoEnabled ? (
                    <>
                      <div ref={previewHostRef} className="absolute inset-0 w-full h-full" />
                      {!previewVideoTrack && (
                        <div
                          className={`absolute inset-0 flex items-center justify-center text-[12px] ${labelCls}`}
                        >
                          Allow camera permissions to see preview
                        </div>
                      )}

                      <div className="absolute left-3 bottom-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onChange({ ...value, audioEnabled: !value.audioEnabled })}
                          className={`h-9 px-3 rounded-2xl backdrop-blur border text-[12px] font-semibold ${value.audioEnabled
                              ? "bg-black/55 text-white border-white/15"
                              : "bg-red-500/80 text-white border-red-300/20"
                            }`}
                          title={value.audioEnabled ? "Mute microphone" : "Enable microphone"}
                        >
                          <span className="inline-flex items-center gap-2">
                            {value.audioEnabled ? (
                              <IconMic className="w-4 h-4" />
                            ) : (
                              <IconMicOff className="w-4 h-4" />
                            )}
                            {value.audioEnabled ? "Mic" : "Muted"}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onChange({ ...value, videoEnabled: !value.videoEnabled })}
                          className={`h-9 px-3 rounded-2xl backdrop-blur border text-[12px] font-semibold ${value.videoEnabled
                              ? "bg-black/55 text-white border-white/15"
                              : "bg-red-500/80 text-white border-red-300/20"
                            }`}
                          title={value.videoEnabled ? "Turn camera off" : "Turn camera on"}
                        >
                          <span className="inline-flex items-center gap-2">
                            {value.videoEnabled ? (
                              <IconCamera className="w-4 h-4" />
                            ) : (
                              <IconCameraOff className="w-4 h-4" />
                            )}
                            Camera
                          </span>
                        </button>

                        {!hideBackgroundFx && (
                          <button
                            type="button"
                            onClick={() =>
                              onApplyVideoFx(
                                videoFxMode === "off" ? "blur" : "off"
                              )
                            }
                            className="h-9 px-3 rounded-2xl backdrop-blur border text-[12px] font-semibold bg-black/55 text-white border-white/15"
                            title="Toggle effects"
                          >
                            <span className="inline-flex items-center gap-2">
                              <IconSparkles className="w-4 h-4" />
                              Effects
                            </span>
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className={`absolute inset-0 flex items-center justify-center text-[12px] ${labelCls}`}>
                      Camera is turned off
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className={`rounded-[24px] p-4 ${mutedSurface}`}>
              <div className="flex flex-col gap-2">
                <div className={`text-[12px] font-semibold ${labelCls}`}>Display name</div>
                <div className={`rounded-2xl px-4 py-3 ${surface}`}>
                  <input
                    value={value.displayName}
                    onChange={(e) => onChange({ ...value, displayName: e.target.value })}
                    placeholder="Your name…"
                    className={`w-full bg-transparent outline-none text-[14px] ${inputCls}`}
                  />
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <div className={`text-[12px] ${labelCls}`}>Camera</div>
                  <select
                    value={value.videoInputId}
                    onChange={(e) => onChange({ ...value, videoInputId: e.target.value })}
                    className={selectCls}
                    style={selectStyle}
                  >
                    <option value="" style={optionStyle}>
                      Default
                    </option>
                    {devices.videoInputs.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId} style={optionStyle}>
                        {deviceLabel(d, `Camera ${i + 1}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <div className={`text-[12px] ${labelCls}`}>Microphone</div>
                  <select
                    value={value.audioInputId}
                    onChange={(e) => onChange({ ...value, audioInputId: e.target.value })}
                    className={selectCls}
                    style={selectStyle}
                  >
                    <option value="" style={optionStyle}>
                      Default
                    </option>
                    {devices.audioInputs.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId} style={optionStyle}>
                        {deviceLabel(d, `Microphone ${i + 1}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2 flex flex-col gap-2">
                  <div className={`text-[12px] ${labelCls}`}>Speakers</div>
                  <select
                    value={value.audioOutputId}
                    onChange={(e) => onChange({ ...value, audioOutputId: e.target.value })}
                    className={selectCls}
                    style={selectStyle}
                  >
                    <option value="default" style={optionStyle}>
                      Default
                    </option>
                    {devices.audioOutputs.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId} style={optionStyle}>
                        {deviceLabel(d, `Speaker ${i + 1}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {renderTogglePill(value.echoCancellation, "Echo cancellation", () =>
                  onChange({ ...value, echoCancellation: !value.echoCancellation })
                )}

                {renderTogglePill(value.noiseSuppression, "Noise suppression", () =>
                  onChange({ ...value, noiseSuppression: !value.noiseSuppression })
                )}

                {renderTogglePill(value.autoGainControl, "Auto gain control", () =>
                  onChange({ ...value, autoGainControl: !value.autoGainControl })
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  onClick={onRefreshDevices}
                  className={`${tinyButton} ${idlePill}`}
                  type="button"
                >
                  <IconRefresh className="w-4 h-4" />
                  <span>Refresh devices</span>
                </button>

                <button
                  onClick={handleTestSpeaker}
                  className={`${tinyButton} ${idlePill}`}
                  type="button"
                >
                  <IconVolume className="w-4 h-4" />
                  <span>Test sound</span>
                </button>
              </div>

              <div className={`mt-3 text-[11px] ${subtleCls}`}>
                Tip: allow mic and camera permissions to see proper device names.
              </div>
            </div>

            {!hideBackgroundFx && (
              <div className={`rounded-[24px] p-4 ${mutedSurface}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className={`text-[12px] font-semibold ${labelCls}`}>Background effects</div>
                    <div className={`text-[11px] ${subtleCls}`}>
                      {fxApplying ? "Applying…" : fxStatusText || "Visible by default"}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <IconSparkles className="w-4 h-4" />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!!fxBlockedReason || fxApplying}
                    onClick={() => onApplyVideoFx("off")}
                    className={`${tinyButton} ${videoFxMode === "off" ? selectedPill : idlePill
                      } disabled:opacity-60 disabled:cursor-not-allowed`}
                    title={fxBlockedReason || "Disable FX"}
                  >
                    Off
                  </button>

                  <button
                    type="button"
                    disabled={!!fxBlockedReason || fxApplying}
                    onClick={() => onApplyVideoFx("blur")}
                    className={`${tinyButton} ${videoFxMode === "blur" ? selectedPill : idlePill
                      } disabled:opacity-60 disabled:cursor-not-allowed`}
                    title={fxBlockedReason || "Apply blur"}
                  >
                    Blur
                  </button>

                  <button
                    type="button"
                    disabled={!!fxBlockedReason || fxApplying}
                    onClick={() => onApplyVideoFx("bg")}
                    className={`${tinyButton} ${videoFxMode === "bg" ? selectedPill : idlePill
                      } disabled:opacity-60 disabled:cursor-not-allowed`}
                    title={fxBlockedReason || "Apply background"}
                  >
                    Background
                  </button>
                </div>

                {!!fxBlockedReason && (
                  <div className={`mt-2 text-[11px] ${labelCls}`}>{fxBlockedReason}</div>
                )}

                {fxError ? (
                  <div className={`mt-3 text-[12px] ${isLight ? "text-red-700" : "text-red-300"}`}>
                    {fxError}
                  </div>
                ) : null}

                {videoFxMode === "blur" && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className={`text-[12px] ${labelCls}`}>Blur strength</div>
                      <div className={`text-[12px] ${labelCls}`}>{blurDraft}</div>
                    </div>

                    <input
                      type="range"
                      min={2}
                      max={22}
                      step={1}
                      value={blurDraft}
                      onChange={(e) => {
                        const v = Number(e.target.value) || 0;
                        setBlurDraft(v);
                        onBlurStrengthChange(v);
                      }}
                      className="mt-2 w-full"
                      disabled={!value.videoEnabled}
                    />

                    <div className={`mt-2 text-[11px] ${subtleCls}`}>
                      Tip: if blur stutters, lower the strength.
                    </div>
                  </div>
                )}

                {videoFxMode === "bg" && (
                  <div className="mt-4">
                    <div className={`text-[12px] ${labelCls}`}>Presets</div>

                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {fxBgPresets?.map((p) => {
                        const selected = String(bgImageUrl || "") === String(p.url || "");
                        return (
                          <button
                            key={p.id}
                            type="button"
                            disabled={!value.videoEnabled || fxApplying}
                            onClick={() => onSetBgImageUrl(p.url)}
                            className={`rounded-2xl overflow-hidden border text-left transition ${selected
                                ? isLight
                                  ? "border-black"
                                  : "border-white"
                                : isLight
                                  ? "border-black/10 hover:border-black/20"
                                  : "border-white/10 hover:border-white/20"
                              }`}
                            title={p.label}
                          >
                            <div
                              className="h-[64px] w-full"
                              style={{
                                backgroundImage: `url(${p.url})`,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                              }}
                            />
                            <div className={`px-2 py-2 text-[11px] ${labelCls}`}>{p.label}</div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          onUploadBg(f);
                          try {
                            e.currentTarget.value = "";
                          } catch {
                            // ignore
                          }
                        }}
                      />

                      <button
                        type="button"
                        disabled={!value.videoEnabled || fxApplying}
                        onClick={() => fileInputRef.current?.click()}
                        className={`${tinyButton} ${idlePill}`}
                      >
                        Upload image
                      </button>

                      <button
                        type="button"
                        disabled={!value.videoEnabled || fxApplying}
                        onClick={onResetBg}
                        className={`${tinyButton} ${idlePill}`}
                      >
                        Reset
                      </button>

                      <button
                        type="button"
                        disabled={!value.videoEnabled || fxApplying}
                        onClick={() => onApplyVideoFx("bg")}
                        className={`${tinyButton} ${idlePill}`}
                        title="Re-apply background now"
                      >
                        Re-apply
                      </button>
                    </div>

                    <div className={`mt-2 text-[11px] ${subtleCls}`}>
                      Presets are usually lighter than large custom images.
                    </div>
                  </div>
                )}
              </div>
            )}

            <div
              className={`rounded-[20px] px-4 py-3 ${isLight
                  ? "bg-blue-50 border border-blue-100"
                  : "bg-white/5 border border-white/10"
                }`}
            >
              <div className={`text-[12px] font-semibold ${isLight ? "text-blue-900/85" : "text-white/85"}`}>
                Quick sanity check
              </div>
              <div className={`mt-1 text-[12px] ${isLight ? "text-blue-900/70" : "text-white/65"}`}>
                If preview is blank or broken, refresh devices or switch camera once before joining.
              </div>
            </div>
          </div>
        </div>

        <div className={footerCls}>
          <div className={`text-[11px] ${subtleCls}`}>
            Compact pre-join, Daily-style.
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className={`h-11 px-4 rounded-2xl text-[13px] font-semibold ${btnGhost}`}
              type="button"
            >
              Cancel
            </button>

            <button
              onClick={handleJoin}
              disabled={fxApplying}
              className={`h-11 px-5 rounded-2xl text-[13px] font-semibold ${btnPrimary} disabled:opacity-70`}
              type="button"
            >
              Join room
            </button>
          </div>
        </div>

        <audio ref={testAudioRef} />
      </div>
    </div>
  );
}

export default PreJoinModal;