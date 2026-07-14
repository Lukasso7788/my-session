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
  onApplyVideoFx: (mode: FxMode, backgroundUrl?: string) => Promise<void> | void;
  onBlurStrengthChange: (next: number) => void;
  onSetBgImageUrl: (url: string) => void;
  onUploadBg: (file: File) => string | void;
  onResetBg: () => void;
  deviceError?: string;
  hideBackgroundFx?: boolean;
};

function deviceLabel(d: MediaDeviceInfo, fallback: string) {
  return (d.label || "").trim() || fallback;
}

function PreJoinModalIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <span
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{
        WebkitMask: "url('/icons/prejoin-room-check.svg') center / contain no-repeat",
        mask: "url('/icons/prejoin-room-check.svg') center / contain no-repeat",
      }}
      aria-hidden="true"
    />
  );
}

function PreJoinMediaIcon({
  source,
  className = "h-[18px] w-[18px]",
}: {
  source: "mic-on" | "mic-off" | "camera-on-dark" | "camera-off";
  className?: string;
}) {
  return (
    <span
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{
        WebkitMask: `url('/icons/${source}.svg') center / contain no-repeat`,
        mask: `url('/icons/${source}.svg') center / contain no-repeat`,
      }}
      aria-hidden="true"
    />
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
  deviceError = "",
  hideBackgroundFx = false,
}: PreJoinModalProps) {
  const isLight = theme === "light";
  const previewHostRef = useRef<HTMLDivElement | null>(null);
  const attachedPreviewElRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);
  const [blurDraft, setBlurDraft] = useState<number>(blurStrength);
  const [localFxMessage, setLocalFxMessage] = useState("");

  useEffect(() => {
    setBlurDraft(blurStrength);
  }, [blurStrength]);

  useEffect(() => {
    if (!fxApplying && (fxStatusText || fxError)) {
      setLocalFxMessage("");
    }
  }, [fxApplying, fxStatusText, fxError]);

  useEffect(() => {
    const host = previewHostRef.current;
    if (!host) return;

    const cleanup = () => {
      const current = attachedPreviewElRef.current;
      try {
        if (previewVideoTrack && current && typeof (previewVideoTrack as any)?.detach === "function") {
          (previewVideoTrack as any).detach(current);
        }
      } catch { }
      if (current instanceof HTMLMediaElement) {
        try {
          current.pause();
          current.srcObject = null;
          current.removeAttribute("src");
        } catch { }
      }
      try {
        current?.remove();
      } catch { }
      attachedPreviewElRef.current = null;
      try {
        while (host.firstChild) host.removeChild(host.firstChild);
      } catch { }
    };

    cleanup();

    if (!open || !value.videoEnabled || !previewVideoTrack) return cleanup;

    let el: HTMLElement | null = null;
    try {
      el = (previewVideoTrack as any).attach?.() as HTMLElement;
    } catch (e) {
      console.warn("preview attach failed", e);
      return cleanup;
    }

    if (!el) return cleanup;

    try {
      el.style.width = "100%";
      el.style.height = "100%";
      (el.style as any).objectFit = "cover";
      el.style.display = "block";
    } catch { }

    if (el instanceof HTMLVideoElement) {
      try {
        el.muted = true;
        el.playsInline = true;
        el.autoplay = true;
      } catch { }

      Promise.resolve()
        .then(() => el.play())
        .catch(() => { });
    }

    try {
      host.appendChild(el);
      attachedPreviewElRef.current = el;
    } catch (e) {
      console.warn("preview append failed", e);
      return cleanup;
    }

    return cleanup;
  }, [open, value.videoEnabled, previewVideoTrack, previewVersion]);

  useEffect(() => {
    const el = attachedPreviewElRef.current;
    if (!el) return;
    el.style.backgroundColor = isLight ? "#F3F1F1" : "#1B1B1B";
  }, [open, value.videoEnabled, isLight, previewVideoTrack, previewVersion]);

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

  const previewHint = useMemo(() => {
    if (!value.videoEnabled) return "Video is disabled";
    if (!previewVideoTrack) return "Preparing camera preview…";
    return "Preview";
  }, [value.videoEnabled, previewVideoTrack]);

  const fxBlockedReason = hideBackgroundFx
    ? "Background effects are disabled on mobile/tablet devices"
    : !value.videoEnabled
      ? "Turn video on to use FX"
      : "";

  const overlay =
    "fixed inset-0 z-[2147483647] flex items-stretch justify-center px-0 py-0 sm:items-center sm:px-3 sm:py-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]";

  const card = [
    "relative flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-none border shadow-[0_18px_48px_rgba(0,0,0,0.26)] sm:max-h-[92dvh] sm:max-w-[1040px] sm:rounded-[30px]",
    isLight ? "border-white/80 bg-[#F6F4F4] text-black" : "border-white/[0.09] bg-[#181818] text-white",
  ].join(" ");

  const border = isLight ? "border-[#DDD7D7]" : "border-white/[0.08]";
  const labelCls = isLight ? "text-black/60" : "text-white/65";
  const inputWrap = isLight ? "border border-[#DED8D8] bg-white/75 shadow-sm" : "border border-white/[0.08] bg-white/[0.045] shadow-sm";
  const inputCls = isLight ? "text-black placeholder:text-black/35" : "text-white placeholder:text-white/40";
  const btnGhost = isLight ? "border border-[#D8D1D1] bg-white/80 text-black/75 hover:border-[#BEB6B6] hover:bg-white" : "border border-white/[0.09] bg-white/[0.055] text-white/80 hover:border-white/20 hover:bg-white/[0.09]";
  const btnPrimary = "bg-[#81DB86] text-[#102012] shadow-[0_10px_30px_rgba(129,219,134,0.22)] hover:bg-[#91E496] hover:shadow-[0_12px_34px_rgba(129,219,134,0.30)]";
  const fxBtnBase = "h-10 rounded-2xl px-4 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";
  const fxBtnSelected = isLight ? "bg-[#252525] text-white hover:bg-[#303030]" : "bg-[#F3F1F1] text-[#252525] hover:bg-[#ECEAEA]";
  const fxBtnIdle = btnGhost;
  const selectCls = [
    "h-11 w-full rounded-2xl px-3 text-[13px] outline-none transition focus:ring-2 focus:ring-[#81DB86]/30",
    isLight ? "border border-[#D8D1D1] bg-white text-black" : "border border-white/[0.09] bg-[#222222] text-white",
  ].join(" ");
  const optionStyle: React.CSSProperties = isLight
    ? { color: "#111111", backgroundColor: "#F7F5F5" }
    : { color: "#ffffff", backgroundColor: "#252525" };
  const mediaToggleBase = "inline-flex h-11 items-center justify-center gap-2 rounded-2xl border px-4 text-[13px] font-semibold transition";
  const mediaToggleOn = isLight ? "border-[#9DE4A1] bg-[#E9F9EA] text-[#205B25] hover:bg-[#DFF5E1]" : "border-[#81DB86]/35 bg-[#81DB86]/12 text-[#B8F2BC] hover:bg-[#81DB86]/18";
  const mediaToggleOff = isLight ? "border-[#F65252]/35 bg-[#F65252]/10 text-[#C73535] hover:bg-[#F65252]/15" : "border-[#F65252]/40 bg-[#F65252]/15 text-[#FCA5A5] hover:bg-[#F65252]/22";

  const playFallbackTestSound = async () => {
    try {
      const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;

      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const dest = ctx.createMediaStreamDestination();
      const audioEl = testAudioRef.current;

      if (!audioEl) return;

      gain.gain.value = 0.08;
      osc.frequency.value = 880;
      osc.type = "sine";
      osc.connect(gain);
      gain.connect(dest);
      audioEl.srcObject = dest.stream;
      await audioEl.play().catch(() => { });
      osc.start();

      window.setTimeout(() => {
        try {
          osc.stop();
        } catch { }
        try {
          void ctx.close();
        } catch { }
        try {
          audioEl.srcObject = null;
        } catch { }
      }, 350);
    } catch { }
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

  const handleUploadClick = () => {
    if (!value.videoEnabled || fxApplying) return;
    fileInputRef.current?.click();
  };

  if (!open) return null;

  return (
    <div
      className={overlay}
      data-theme={theme}
      style={{
        colorScheme: theme,
        zIndex: 2147483647,
      }}
    >
      <div
        className="absolute inset-0 z-0 bg-black/70 backdrop-blur-md"
        onClick={onCancel}
      />

      <div
        className={`${card} z-10`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`relative overflow-hidden border-b px-5 py-4 sm:px-7 sm:py-5 ${border}`}>
          <div className="pointer-events-none absolute -right-20 -top-28 h-56 w-56 rounded-full bg-[#81DB86]/10 blur-3xl" />
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3.5">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${isLight ? "border-[#BEEFC1] bg-[#E8F9E9] text-[#25722B]" : "border-[#81DB86]/20 bg-[#81DB86]/10 text-[#81DB86]"}`}>
                <PreJoinModalIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="font-inter text-[18px] font-semibold tracking-[-0.02em]">Ready to focus?</div>
                  <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] ${isLight ? "border-[#BEEFC1] bg-[#E8F9E9] text-[#3E8C43]" : "border-[#81DB86]/20 bg-[#81DB86]/10 text-[#81DB86]"}`}>Room check</span>
                </div>
                <div className={`mt-0.5 text-[12px] ${labelCls}`}>
                  Check your look and sound before entering the room.
                </div>
              </div>
            </div>

            <button
              onClick={onCancel}
              className={`flex h-10 w-10 items-center justify-center rounded-2xl transition ${btnGhost}`}
              title="Close"
              type="button"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7 sm:py-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[400px,1fr]">
            <div className="flex flex-col gap-4">
              <div className={`overflow-hidden rounded-[26px] border ${inputWrap}`}>
                <div className="flex items-center justify-between px-4 py-3">
                  <div className={`text-[12px] font-semibold ${labelCls}`}>{previewHint}</div>
                  <div className={`text-[11px] ${labelCls}`}>
                    {value.videoEnabled
                      ? hideBackgroundFx
                        ? "Clean"
                        : videoFxMode === "blur"
                          ? "Blur"
                          : videoFxMode === "bg"
                            ? "Background"
                            : "Clean"
                      : "Off"}
                  </div>
                </div>
                <div className="relative aspect-video overflow-hidden bg-black">
                  {value.videoEnabled ? (
                    <>
                      <div ref={previewHostRef} className="absolute inset-0 h-full w-full" />
                      {!previewVideoTrack ? (
                        <div className={`absolute inset-0 flex items-center justify-center text-[12px] ${labelCls}`}>
                          Allow camera permissions to see preview
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className={`absolute inset-0 flex items-center justify-center text-[12px] ${labelCls}`}>
                      Video disabled
                    </div>
                  )}
                </div>
              </div>

              {deviceError ? (
                <div className={`rounded-2xl px-4 py-3 text-[12px] ${isLight
                  ? "border border-[#F65252]/30 bg-[#F65252]/10 text-[#A82020]"
                  : "border border-[#F65252]/25 bg-[#F65252]/10 text-[#FCA5A5]"
                  }`}>
                  <div className="font-semibold">Camera or microphone needs attention</div>
                  <div className="mt-1 break-words">{deviceError}</div>
                  <div className="mt-2">
                    Browser tip: click the lock icon near the address bar, allow Camera/Microphone, then click Refresh devices.
                  </div>
                </div>
              ) : null}

              {!hideBackgroundFx ? (
                <div className={`rounded-3xl p-4 ${inputWrap}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className={`text-[12px] font-semibold ${labelCls}`}>Background effects</div>
                    <div className={`text-[11px] ${labelCls}`}>
                      {fxApplying ? "Applying…" : localFxMessage || fxStatusText || ""}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {(["off", "blur", "bg"] as FxMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        disabled={!!fxBlockedReason || fxApplying}
                        onClick={() => {
                          setLocalFxMessage("");
                          void Promise.resolve(onApplyVideoFx(mode));
                        }}
                        className={`${fxBtnBase} ${videoFxMode === mode ? fxBtnSelected : fxBtnIdle}`}
                        title={fxBlockedReason || `Apply ${mode}`}
                      >
                        {mode === "off" ? "Off" : mode === "blur" ? "Blur" : "Background"}
                      </button>
                    ))}
                  </div>

                  {fxBlockedReason ? <div className={`mt-2 text-[11px] ${labelCls}`}>{fxBlockedReason}</div> : null}
                  {fxError ? <div className={`mt-3 text-[12px] ${isLight ? "text-[#C73535]" : "text-[#FCA5A5]"}`}>{fxError}</div> : null}

                  {videoFxMode === "blur" ? (
                    <div className="mt-4">
                      <div className="flex items-center justify-between">
                        <div className={`text-[12px] ${labelCls}`}>Blur strength</div>
                        <div className={`text-[12px] ${labelCls}`}>{blurDraft}</div>
                      </div>
                      <input
                        type="range"
                        min={4}
                        max={30}
                        step={2}
                        value={blurDraft}
                        onChange={(e) => {
                          const v = Number(e.target.value) || 0;
                          setBlurDraft(v);
                          onBlurStrengthChange(v);
                        }}
                        className="mt-2 w-full"
                        disabled={!value.videoEnabled}
                      />
                    </div>
                  ) : null}

                  <div className="mt-4">
                    <div className={`text-[12px] ${labelCls}`}>Background image</div>

                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {fxBgPresets?.map((p) => {
                        const selected = bgImageUrl === p.url;

                        return (
                          <button
                            key={p.id}
                            type="button"
                            disabled={!value.videoEnabled || fxApplying}
                            onClick={() => {
                              onSetBgImageUrl(p.url);
                              setLocalFxMessage("Preset selected");
                              void Promise.resolve(onApplyVideoFx("bg", p.url));
                            }}
                            className={`group overflow-hidden rounded-2xl border text-left transition duration-200 ${selected
                              ? isLight
                                ? "border-[#5286F6] ring-2 ring-[#5286F6]/20"
                                : "border-[#81DB86] ring-2 ring-[#81DB86]/20"
                              : isLight
                                ? "border-[#CFC6C6] hover:border-[#AFA6A6]"
                                : "border-[#2B2B2B] hover:border-[#4A4A4A]"
                              }`}
                            title={`Use ${p.label} background`}
                            aria-pressed={selected}
                          >
                            <div className={`relative h-[72px] w-full overflow-hidden sm:h-[64px] ${isLight ? "bg-[#ECE8E8]" : "bg-[#171717]"}`}>
                              <img
                                src={p.url}
                                alt={`${p.label} background preview`}
                                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                                draggable={false}
                              />
                              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-white/[0.04]" />
                              {selected ? (
                                <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#81DB86] text-[11px] font-bold text-[#102012] shadow-sm">
                                  ✓
                                </span>
                              ) : null}
                            </div>
                            <div className={`flex items-center justify-between px-3 py-2 text-[12px] ${labelCls}`}>
                              <span>{p.label}</span>
                              {selected ? <span className="text-[10px] opacity-65">Selected</span> : null}
                            </div>
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

                          const selectedUrl = onUploadBg(f);
                          setLocalFxMessage("Image selected. Applying background…");
                          void Promise.resolve(onApplyVideoFx("bg", selectedUrl || undefined));

                          try {
                            e.currentTarget.value = "";
                          } catch { }
                        }}
                      />

                      <button
                        type="button"
                        disabled={!value.videoEnabled || fxApplying}
                        onClick={handleUploadClick}
                        className={`h-10 rounded-2xl px-4 text-[13px] font-semibold ${btnGhost}`}
                      >
                        Upload image
                      </button>

                      <button
                        type="button"
                        disabled={!value.videoEnabled || fxApplying}
                        onClick={onResetBg}
                        className={`h-10 rounded-2xl px-4 text-[13px] font-semibold ${btnGhost}`}
                      >
                        Reset
                      </button>

                      <button
                        type="button"
                        disabled={!value.videoEnabled || fxApplying}
                        onClick={() => onApplyVideoFx("bg")}
                        className={`h-10 rounded-2xl px-4 text-[13px] font-semibold ${btnGhost}`}
                        title="Re-apply background now"
                      >
                        Re-apply
                      </button>
                    </div>

                    {bgImageUrl && !fxBgPresets.some((preset) => preset.url === bgImageUrl) ? (
                      <div className={`mt-2 truncate text-[10px] ${labelCls}`}>Custom image selected</div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <div className={`text-[12px] ${labelCls}`}>Display name</div>
                <div className={`rounded-2xl px-4 py-3 ${inputWrap}`}>
                  <input
                    value={value.displayName}
                    onChange={(e) => onChange({ ...value, displayName: e.target.value })}
                    placeholder="Your name…"
                    className={`w-full bg-transparent text-[14px] outline-none ${inputCls}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <div className={`text-[12px] ${labelCls}`}>Microphone</div>
                  <select value={value.audioInputId} onChange={(e) => onChange({ ...value, audioInputId: e.target.value })} className={selectCls}>
                    <option value="" style={optionStyle}>Default</option>
                    {devices.audioInputs.map((d, i) => (
                      <option key={d.deviceId || `mic-${i}`} value={d.deviceId} style={optionStyle}>
                        {deviceLabel(d, `Microphone ${i + 1}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <div className={`text-[12px] ${labelCls}`}>Camera</div>
                  <select value={value.videoInputId} onChange={(e) => onChange({ ...value, videoInputId: e.target.value })} className={selectCls}>
                    <option value="" style={optionStyle}>Default</option>
                    {devices.videoInputs.map((d, i) => (
                      <option key={d.deviceId || `cam-${i}`} value={d.deviceId} style={optionStyle}>
                        {deviceLabel(d, `Camera ${i + 1}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-2 sm:col-span-2">
                  <div className={`text-[12px] ${labelCls}`}>Speaker</div>
                  <select value={value.audioOutputId} onChange={(e) => onChange({ ...value, audioOutputId: e.target.value })} className={selectCls}>
                    <option value="default" style={optionStyle}>Default</option>
                    {devices.audioOutputs.map((d, i) => (
                      <option key={d.deviceId || `speaker-${i}`} value={d.deviceId} style={optionStyle}>
                        {deviceLabel(d, `Speaker ${i + 1}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={`rounded-2xl p-4 ${inputWrap}`}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => onChange({ ...value, audioEnabled: !value.audioEnabled })}
                    className={`${mediaToggleBase} ${value.audioEnabled ? mediaToggleOn : mediaToggleOff}`}
                  >
                    <PreJoinMediaIcon source={value.audioEnabled ? "mic-on" : "mic-off"} />
                    <span>{value.audioEnabled ? "Microphone on" : "Microphone off"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onChange({ ...value, videoEnabled: !value.videoEnabled })}
                    className={`${mediaToggleBase} ${value.videoEnabled ? mediaToggleOn : mediaToggleOff}`}
                  >
                    <PreJoinMediaIcon source={value.videoEnabled ? "camera-on-dark" : "camera-off"} />
                    <span>{value.videoEnabled ? "Camera on" : "Camera off"}</span>
                  </button>

                  <label className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={value.echoCancellation} onChange={(e) => onChange({ ...value, echoCancellation: e.target.checked })} />
                    <span className={labelCls}>Echo cancellation</span>
                  </label>

                  <label className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={value.noiseSuppression} onChange={(e) => onChange({ ...value, noiseSuppression: e.target.checked })} />
                    <span className={labelCls}>Noise suppression</span>
                  </label>

                  <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
                    <input type="checkbox" checked={value.autoGainControl} onChange={(e) => onChange({ ...value, autoGainControl: e.target.checked })} />
                    <span className={labelCls}>Auto gain control</span>
                  </label>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={onRefreshDevices} className={`h-10 rounded-2xl px-4 text-[13px] font-semibold ${btnGhost}`} type="button">
                      Refresh devices
                    </button>

                    <button onClick={handleTestSpeaker} className={`h-10 rounded-2xl px-4 text-[13px] font-semibold ${btnGhost}`} type="button">
                      Test sound
                    </button>
                  </div>

                  <div className={`text-[12px] ${labelCls}`}>Tip: allow mic/camera to see device names</div>
                </div>
              </div>

              <div className={`rounded-2xl p-4 ${isLight ? "border border-[#5286F6]/20 bg-[#5286F6]/8" : "border border-[#2B2B2B] bg-[#252525]"}`}>
                <div className={`text-[12px] font-semibold ${isLight ? "text-[#2459B8]" : "text-white/80"}`}>
                  Quick sanity check
                </div>
                <div className={`mt-1 text-[12px] ${isLight ? "text-[#2459B8]/75" : "text-white/65"}`}>
                  If preview is blank — allow camera permissions in the browser.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={`flex items-center justify-between gap-3 border-t px-5 py-4 sm:px-7 sm:py-5 ${border} ${isLight ? "bg-white/55" : "bg-black/10"}`}>
          <div className={`hidden items-center gap-2 text-[12px] sm:flex ${labelCls}`}>
            <span className={`h-2 w-2 rounded-full ${value.videoEnabled || value.audioEnabled ? "bg-[#81DB86] shadow-[0_0_0_4px_rgba(129,219,134,0.12)]" : "bg-white/25"}`} />
            Your setup is saved for the next room
          </div>

          <div className="ml-auto flex items-center gap-3">
          <button onClick={onCancel} className={`h-11 rounded-2xl px-5 text-[13px] font-semibold transition ${btnGhost}`} type="button">
            Cancel
          </button>

          <button onClick={handleJoin} disabled={fxApplying} className={`inline-flex h-11 items-center gap-2 rounded-2xl px-6 text-[13px] font-semibold transition duration-200 ${btnPrimary} disabled:opacity-70`} type="button">
            <span>{fxApplying ? "Applying background…" : "Join room"}</span>
            {!fxApplying ? <span aria-hidden="true">→</span> : null}
          </button>
          </div>
        </div>

        <audio ref={testAudioRef} />
      </div>
    </div>
  );
}

export default PreJoinModal;
