import React, { useEffect, useMemo, useRef, useState } from "react";
import type { LocalVideoTrack } from "livekit-client";
import { ArrowRight, Check, ChevronDown, X } from "lucide-react";

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
type CustomBackgroundSlot = { id: string; label: string; dataUrl: string };
type BackgroundChoice = "off" | "blur" | "image" | "custom";

const backgroundChoiceIcons: Record<BackgroundChoice, string> = {
  off: "/icons/prejoin-background-none.svg",
  blur: "/icons/prejoin-background-blur.svg",
  image: "/icons/prejoin-background-image.svg",
  custom: "/icons/prejoin-background-custom.svg",
};

function BackgroundChoiceIcon({ choice }: { choice: BackgroundChoice }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-6 w-6 shrink-0 bg-current"
      style={{
        WebkitMask: `url('${backgroundChoiceIcons[choice]}') center / contain no-repeat`,
        mask: `url('${backgroundChoiceIcons[choice]}') center / contain no-repeat`,
      }}
    />
  );
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
  customBackgroundSlots?: CustomBackgroundSlot[];
  onApplyVideoFx: (mode: FxMode, backgroundUrl?: string) => Promise<void> | void;
  onUploadCustomBackground?: (slotId: string, file: File) => Promise<void> | void;
  onClearCustomBackground?: (slotId: string) => Promise<void> | void;
  onBlurStrengthChange: (next: number) => void;
  onSetBgImageUrl: (url: string) => void;
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
  customBackgroundSlots = [],
  onApplyVideoFx,
  onUploadCustomBackground,
  onClearCustomBackground,
  onBlurStrengthChange,
  onSetBgImageUrl,
  onResetBg,
  deviceError = "",
  hideBackgroundFx = false,
}: PreJoinModalProps) {
  const isLight = theme === "light";
  const previewHostRef = useRef<HTMLDivElement | null>(null);
  const attachedPreviewElRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadSlotRef = useRef<string | null>(null);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);
  const [blurDraft, setBlurDraft] = useState<number>(blurStrength);
  const [localFxMessage, setLocalFxMessage] = useState("");
  const [expandedBackgroundChoice, setExpandedBackgroundChoice] = useState<"image" | "custom" | null>(null);

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

    const playbackTimers: number[] = [];
    let attachedVideo: HTMLVideoElement | null = null;

    const tryPlay = () => {
      if (!attachedVideo || !attachedVideo.isConnected) return;
      attachedVideo.play().catch(() => { });
    };

    const cleanup = () => {
      playbackTimers.forEach((timer) => window.clearTimeout(timer));
      if (attachedVideo) {
        attachedVideo.removeEventListener("loadedmetadata", tryPlay);
        attachedVideo.removeEventListener("canplay", tryPlay);
      }
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
        el.defaultMuted = true;
        el.playsInline = true;
        el.autoplay = true;
        el.setAttribute("muted", "");
        el.setAttribute("playsinline", "");
        el.setAttribute("webkit-playsinline", "");
      } catch { }
      attachedVideo = el;
    }

    try {
      host.appendChild(el);
      attachedPreviewElRef.current = el;
    } catch (e) {
      console.warn("preview append failed", e);
      return cleanup;
    }

    // WebKit may ignore play() while the element is detached or before camera
    // metadata arrives. Start only after insertion and retry on its media-ready
    // events so a granted camera permission cannot leave a black preview.
    if (attachedVideo) {
      attachedVideo.addEventListener("loadedmetadata", tryPlay);
      attachedVideo.addEventListener("canplay", tryPlay);
      tryPlay();
      playbackTimers.push(window.setTimeout(tryPlay, 120));
      playbackTimers.push(window.setTimeout(tryPlay, 500));
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
    "ms-room-prejoin fixed inset-0 z-[2147483647] flex items-stretch justify-center px-0 py-0 sm:items-center sm:px-3 sm:py-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]";

  const card = [
    "relative flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-none border shadow-[0_28px_90px_rgba(0,0,0,0.36)] sm:max-h-[92dvh] sm:max-w-[1080px] sm:rounded-[28px]",
    isLight ? "border-[#A5ABD2] bg-[#FAFAFA] text-[#091454]" : "border-[#2B2B2B] bg-[#1B1B1B] text-white",
  ].join(" ");

  const border = isLight ? "border-[#A5ABD2]" : "border-[#343434]";
  const labelCls = isLight ? "text-[#404B86]" : "text-[#B8B8B8]";
  const inputWrap = isLight ? "border border-[#A5ABD2] bg-white shadow-sm" : "border border-[#343434] bg-[#242424]";
  const inputCls = isLight ? "text-[#091454] placeholder:text-[#515EA8]" : "text-white placeholder:text-white/40";
  const btnGhost = isLight ? "border border-[#A5ABD2] bg-white text-[#091454] hover:border-[#2844E8] hover:bg-[#EAF3FF]" : "border border-[#343434] bg-[#242424] text-white/85 hover:border-[#5286F6]/45 hover:bg-[#2F2F2F]";
  const btnPrimary = isLight
    ? "bg-[#2844E8] text-white shadow-[0_12px_30px_rgba(40,68,232,0.22)] hover:bg-[#152FC7]"
    : "bg-[#5286F6] text-white shadow-[0_12px_30px_rgba(82,134,246,0.25)] hover:bg-[#3E75ED] hover:shadow-[0_14px_34px_rgba(82,134,246,0.34)]";
  const fxBtnBase = "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:h-11 sm:w-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5286F6] disabled:cursor-not-allowed disabled:opacity-60";
  const fxBtnSelected = isLight
    ? "border border-[#2844E8]/50 bg-[#2844E8]/10 text-[#152FC7] hover:bg-[#2844E8]/15"
    : "border border-[#5286F6]/50 bg-[#5286F6]/20 text-[#C4D6FF] hover:bg-[#5286F6]/25";
  const fxBtnIdle = isLight
    ? "border border-[#A5ABD2] bg-white text-[#091454] hover:border-[#2844E8]/50 hover:bg-[#2844E8]/10 hover:text-[#152FC7]"
    : "border border-[#343434] bg-[#2F2F2F] text-white/85 hover:border-[#5286F6]/50 hover:bg-[#5286F6]/15 hover:text-[#C4D6FF]";
  const selectCls = [
    "h-11 w-full rounded-2xl px-3 text-[13px] outline-none transition focus:ring-2 focus:ring-[#5286F6]/30",
    isLight ? "border border-[#A5ABD2] bg-white text-[#091454]" : "border border-[#343434] bg-[#242424] text-white",
  ].join(" ");
  const optionStyle: React.CSSProperties = isLight
    ? { color: "#091454", backgroundColor: "#FAFAFA" }
    : { color: "#ffffff", backgroundColor: "#242424" };
  const mediaToggleBase = "inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2.5 rounded-2xl border px-3 text-[13px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5286F6]";
  const mediaToggleOn = isLight ? "border-[#2844E8] bg-[#EAF3FF] text-[#152FC7] hover:bg-[#D7E0EB]" : "border-[#5286F6]/45 bg-[#5286F6]/18 text-[#C4D6FF] hover:bg-[#5286F6]/25";
  const mediaToggleOff = isLight ? "border-[#A5ABD2] bg-white text-[#404B86] hover:bg-[#EAF3FF]" : "border-[#343434] bg-[#2F2F2F] text-[#C8C8C8] hover:bg-[#383838]";

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
    if (!value.videoEnabled || fxApplying || !uploadSlotRef.current) return;
    fileInputRef.current?.click();
  };

  const savedBackground = customBackgroundSlots.find((slot) => !!slot.dataUrl && slot.dataUrl === bgImageUrl);
  const selectedPreset = fxBgPresets.find((preset) => preset.url === bgImageUrl);
  const activeBackgroundChoice: BackgroundChoice = videoFxMode === "off"
    ? "off"
    : videoFxMode === "blur"
      ? "blur"
      : savedBackground ? "custom" : "image";
  const visibleBackgroundChoice = expandedBackgroundChoice || activeBackgroundChoice;

  if (!open) return null;

  return (
    <div
      className={overlay}
      data-theme={theme}
      role="dialog"
      aria-modal="true"
      aria-labelledby="prejoin-title"
      style={{
        colorScheme: theme,
        zIndex: 2147483647,
      }}
    >
      <div
        className="absolute inset-0 z-0 bg-black/70 backdrop-blur-[10px]"
        onClick={onCancel}
      />

      <div
        className={`${card} z-10`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`relative shrink-0 overflow-hidden border-b px-5 py-4 sm:px-7 sm:py-5 ${border}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3.5">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${isLight ? "border-[#C9D9FB] bg-[#EAF1FF] text-[#336BD8]" : "border-[#5286F6]/25 bg-[#5286F6]/15 text-[#9AB9FF]"}`}>
                <PreJoinModalIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 id="prejoin-title" className="font-inter text-[18px] font-semibold tracking-[-0.025em] sm:text-[20px]">Before you join</h2>
                <p className={`mt-0.5 text-[12px] ${labelCls}`}>Check your camera and sound before entering.</p>
              </div>
            </div>

            <button
              onClick={onCancel}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg transition ${btnGhost}`}
              aria-label="Close pre-join"
              type="button"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7 sm:py-6">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.12fr)_minmax(340px,0.88fr)] lg:gap-7">
            <div className="flex min-w-0 flex-col gap-4">
              <div className={`overflow-hidden rounded-[24px] border ${isLight ? "border-[#D8D0D0] bg-white" : "border-[#343434] bg-[#242424]"}`}>
                <div className="relative aspect-video overflow-hidden bg-[#1B1B1B]">
                  <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full border border-white/15 bg-[#1B1B1B]/75 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur-sm">
                    <span className={`h-1.5 w-1.5 rounded-full ${value.videoEnabled && previewVideoTrack ? "bg-[#5286F6]" : "bg-white/45"}`} />
                    {previewHint}
                  </div>
                  <div className="pointer-events-none absolute right-4 top-4 z-10 rounded-full border border-white/15 bg-[#1B1B1B]/75 px-3 py-1.5 text-[11px] text-white/80 backdrop-blur-sm">
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
                  {value.videoEnabled ? (
                    <>
                      <div ref={previewHostRef} className="absolute inset-0 h-full w-full" />
                      {!previewVideoTrack ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white/80">
                          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.07] text-[#AFC6FF]"><PreJoinMediaIcon source="camera-on-dark" className="h-7 w-7" /></span>
                          <span className="text-[13px] font-medium">Allow camera access to see your preview</span>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white/75">
                      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.07] text-white/70"><PreJoinMediaIcon source="camera-off" className="h-7 w-7" /></span>
                      <span className="text-[13px] font-medium">Your camera is off</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2.5 p-3 sm:gap-3 sm:p-4">
                  <button
                    type="button"
                    aria-pressed={value.audioEnabled}
                    onClick={() => onChange({ ...value, audioEnabled: !value.audioEnabled })}
                    className={`${mediaToggleBase} ${value.audioEnabled ? mediaToggleOn : mediaToggleOff}`}
                  >
                    <PreJoinMediaIcon source={value.audioEnabled ? "mic-on" : "mic-off"} />
                    <span className="truncate">Microphone {value.audioEnabled ? "on" : "off"}</span>
                  </button>

                  <button
                    type="button"
                    aria-pressed={value.videoEnabled}
                    onClick={() => onChange({ ...value, videoEnabled: !value.videoEnabled })}
                    className={`${mediaToggleBase} ${value.videoEnabled ? mediaToggleOn : mediaToggleOff}`}
                  >
                    <PreJoinMediaIcon source={value.videoEnabled ? "camera-on-dark" : "camera-off"} />
                    <span className="truncate">Camera {value.videoEnabled ? "on" : "off"}</span>
                  </button>
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
                <div className={`rounded-[20px] ${inputWrap}`}>
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0">
                      <span className="text-[12px] font-semibold leading-tight">Background effects</span>
                      <span className="sr-only" role="status">
                        {fxApplying ? "Applying…" : localFxMessage || fxStatusText || (videoFxMode === "off" ? "Off" : videoFxMode === "blur" ? "Blur" : "Image")}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5" role="group" aria-label="Background effect choices">
                      {(["off", "blur", "image", "custom"] as BackgroundChoice[]).map((choice) => {
                        const label = choice === "off" ? "No backgrounds" : choice === "blur" ? "Blur" : choice === "image" ? "Image" : "Custom image";
                        return (
                          <div key={choice} className="relative">
                            <button
                              type="button"
                              disabled={!!fxBlockedReason || fxApplying}
                              onClick={() => {
                                setLocalFxMessage("");
                                if (choice === "off" || choice === "blur") {
                                  setExpandedBackgroundChoice(null);
                                  void Promise.resolve(onApplyVideoFx(choice));
                                } else {
                                  setExpandedBackgroundChoice(choice);
                                  // Apply an existing image immediately; never request "bg" without a valid URL.
                                  const imageUrl = choice === "image"
                                    ? selectedPreset?.url || fxBgPresets[0]?.url
                                    : savedBackground?.dataUrl || customBackgroundSlots.find((slot) => !!slot.dataUrl)?.dataUrl;
                                  if (imageUrl) {
                                    onSetBgImageUrl(imageUrl);
                                    void Promise.resolve(onApplyVideoFx("bg", imageUrl));
                                  }
                                }
                              }}
                              className={`peer ${fxBtnBase} ${visibleBackgroundChoice === choice ? fxBtnSelected : fxBtnIdle}`}
                              aria-label={label}
                              aria-pressed={activeBackgroundChoice === choice}
                              aria-expanded={choice === "image" || choice === "custom" ? visibleBackgroundChoice === choice : undefined}
                            >
                              <BackgroundChoiceIcon choice={choice} />
                            </button>
                            <span
                              aria-hidden="true"
                              className={`pointer-events-none invisible absolute bottom-full left-1/2 z-[70] mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold opacity-0 shadow-lg peer-hover:visible peer-hover:opacity-100 peer-focus-visible:visible peer-focus-visible:opacity-100 ${isLight ? "border-[#D8D0D0] bg-white text-[#20242D] shadow-black/10" : "border-[#343434] bg-[#242424] text-white shadow-black/50"}`}
                            >
                              {fxBlockedReason || label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {(visibleBackgroundChoice !== "off" || fxBlockedReason || fxError) ? <div className={`border-t px-4 pb-4 ${border}`}>

                  {fxBlockedReason ? <div className={`mt-2 text-[11px] ${labelCls}`}>{fxBlockedReason}</div> : null}
                  {fxError ? <div className={`mt-3 text-[12px] ${isLight ? "text-[#C73535]" : "text-[#FCA5A5]"}`}>{fxError}</div> : null}

                  {visibleBackgroundChoice === "blur" ? (
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

                  {visibleBackgroundChoice === "image" ? <div className="mt-4">
                    <div className={`text-[12px] ${labelCls}`}>Choose a background image</div>

                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {fxBgPresets?.map((p) => {
                        const selected = videoFxMode === "bg" && bgImageUrl === p.url;

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
                                : "border-[#5286F6] ring-2 ring-[#5286F6]/20"
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
                                <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#5286F6] text-[11px] font-bold text-white shadow-sm">
                                  <Check size={12} aria-hidden="true" />
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
                      <button
                        type="button"
                        disabled={!value.videoEnabled || fxApplying}
                        onClick={onResetBg}
                        className={`h-10 rounded-2xl px-4 text-[13px] font-semibold ${btnGhost}`}
                      >
                        Reset image
                      </button>

                      <button
                        type="button"
                        disabled={!value.videoEnabled || fxApplying || !selectedPreset}
                        onClick={() => void Promise.resolve(onApplyVideoFx("bg", selectedPreset?.url))}
                        className={`h-10 rounded-2xl px-4 text-[13px] font-semibold ${btnGhost}`}
                        title="Re-apply background now"
                      >
                        Re-apply
                      </button>
                    </div>

                  </div> : null}

                  {visibleBackgroundChoice === "custom" ? (
                    <div className="mt-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[12px] ${labelCls}`}>Saved on this device</span>
                        <span className={`text-[11px] ${labelCls}`}>Up to 8 MB per image</span>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        tabIndex={-1}
                        aria-label="Upload a custom background image"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          const slotId = uploadSlotRef.current;
                          if (file && slotId) void Promise.resolve(onUploadCustomBackground?.(slotId, file));
                          event.currentTarget.value = "";
                        }}
                      />
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {customBackgroundSlots.map((slot) => {
                          const selected = videoFxMode === "bg" && !!slot.dataUrl && bgImageUrl === slot.dataUrl;
                          return (
                            <div key={slot.id} className={`overflow-hidden rounded-2xl border ${selected ? "border-[#5286F6] ring-2 ring-[#5286F6]/20" : isLight ? "border-[#DEE4EE] bg-white" : "border-white/[0.10] bg-white/[0.04]"}`}>
                              <button
                                type="button"
                                disabled={!slot.dataUrl || fxApplying || !!fxBlockedReason}
                                onClick={() => {
                                  if (!slot.dataUrl) return;
                                  onSetBgImageUrl(slot.dataUrl);
                                  void Promise.resolve(onApplyVideoFx("bg", slot.dataUrl));
                                }}
                                className={`relative block h-[72px] w-full overflow-hidden text-left disabled:cursor-default ${isLight ? "bg-[#F3F1F1]" : "bg-[#242424]"}`}
                                aria-label={`Use ${slot.label} background`}
                                aria-pressed={selected}
                              >
                                {slot.dataUrl ? <img src={slot.dataUrl} alt="" className="h-full w-full object-cover" /> : <span className={`flex h-full items-center justify-center text-[11px] ${labelCls}`}>Empty slot</span>}
                                {selected ? <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#5286F6] text-white"><Check size={12} aria-hidden="true" /></span> : null}
                              </button>
                              <div className="flex items-center justify-between gap-1.5 px-2 py-2">
                                <span className="truncate text-[11px] font-semibold">{slot.label}</span>
                                <div className="flex shrink-0 gap-1">
                                  <button
                                    type="button"
                                    disabled={!value.videoEnabled || fxApplying || !onUploadCustomBackground}
                                    onClick={() => { uploadSlotRef.current = slot.id; handleUploadClick(); }}
                                    className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${btnGhost}`}
                                    aria-label={`${slot.dataUrl ? "Replace" : "Upload"} ${slot.label}`}
                                  >{slot.dataUrl ? "Replace" : "Upload"}</button>
                                  {slot.dataUrl ? <button type="button" disabled={fxApplying || !onClearCustomBackground} onClick={() => void Promise.resolve(onClearCustomBackground?.(slot.id))} className={`rounded-lg px-2 py-1 text-[10px] ${btnGhost}`} aria-label={`Clear ${slot.label}`}>Clear</button> : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  </div> : null}
                </div>
              ) : null}
            </div>

            <div className="flex min-w-0 flex-col gap-5">
              <div>
                <div className="text-[15px] font-semibold tracking-[-0.01em]">Your setup</div>
                <p className={`mt-1 text-[12px] ${labelCls}`}>Choose how you'll enter the room.</p>
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="prejoin-display-name" className="text-[12px] font-semibold">Display name</label>
                <div className={`rounded-2xl px-4 py-3 ${inputWrap}`}>
                  <input
                    id="prejoin-display-name"
                    value={value.displayName}
                    onChange={(e) => onChange({ ...value, displayName: e.target.value })}
                    placeholder="Your name…"
                    className={`w-full bg-transparent text-[14px] outline-none ${inputCls}`}
                  />
                </div>
              </div>

              <div className={`border-t pt-5 ${border}`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-[13px] font-semibold">Devices</div>
                  <span className={`text-[11px] ${labelCls}`}>Choose your preferred input & output</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label htmlFor="prejoin-microphone" className="text-[12px] font-medium">Microphone</label>
                  <select id="prejoin-microphone" value={value.audioInputId} onChange={(e) => onChange({ ...value, audioInputId: e.target.value })} className={selectCls}>
                    <option value="" style={optionStyle}>Default</option>
                    {devices.audioInputs.map((d, i) => (
                      <option key={d.deviceId || `mic-${i}`} value={d.deviceId} style={optionStyle}>
                        {deviceLabel(d, `Microphone ${i + 1}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="prejoin-camera" className="text-[12px] font-medium">Camera</label>
                  <select id="prejoin-camera" value={value.videoInputId} onChange={(e) => onChange({ ...value, videoInputId: e.target.value })} className={selectCls}>
                    <option value="" style={optionStyle}>Default</option>
                    {devices.videoInputs.map((d, i) => (
                      <option key={d.deviceId || `cam-${i}`} value={d.deviceId} style={optionStyle}>
                        {deviceLabel(d, `Camera ${i + 1}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-2 sm:col-span-2">
                  <label htmlFor="prejoin-speaker" className="text-[12px] font-medium">Speaker</label>
                  <select id="prejoin-speaker" value={value.audioOutputId} onChange={(e) => onChange({ ...value, audioOutputId: e.target.value })} className={selectCls}>
                    <option value="default" style={optionStyle}>Default</option>
                    {devices.audioOutputs.map((d, i) => (
                      <option key={d.deviceId || `speaker-${i}`} value={d.deviceId} style={optionStyle}>
                        {deviceLabel(d, `Speaker ${i + 1}`)}
                      </option>
                    ))}
                  </select>
                </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button onClick={handleTestSpeaker} className={`h-10 rounded-xl px-3.5 text-[12px] font-semibold transition ${btnGhost}`} type="button">
                    Test sound
                  </button>
                  <button onClick={onRefreshDevices} className={`h-10 rounded-xl px-3.5 text-[12px] font-semibold transition ${btnGhost}`} type="button">
                    Refresh devices
                  </button>
                </div>
              </div>

              <details className={`group border-t pt-4 ${border}`}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5286F6] [&::-webkit-details-marker]:hidden">
                  Audio processing
                  <ChevronDown size={16} aria-hidden="true" className={`transition-transform group-open:rotate-180 ${labelCls}`} />
                </summary>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-[12px]">
                    <input className="accent-[#5286F6]" type="checkbox" checked={value.echoCancellation} onChange={(e) => onChange({ ...value, echoCancellation: e.target.checked })} />
                    <span>Echo cancellation</span>
                  </label>
                  <label className="flex items-center gap-2 text-[12px]">
                    <input className="accent-[#5286F6]" type="checkbox" checked={value.noiseSuppression} onChange={(e) => onChange({ ...value, noiseSuppression: e.target.checked })} />
                    <span>Noise suppression</span>
                  </label>
                  <label className="flex items-center gap-2 text-[12px] sm:col-span-2">
                    <input className="accent-[#5286F6]" type="checkbox" checked={value.autoGainControl} onChange={(e) => onChange({ ...value, autoGainControl: e.target.checked })} />
                    <span>Auto gain control</span>
                  </label>
                </div>
                <p className={`mt-3 text-[11px] leading-4 ${labelCls}`}>Voice quiet or clipped? Try turning noise suppression off.</p>
              </details>
              <p className={`text-[11px] leading-4 ${labelCls}`}>Allow camera and microphone access in your browser to see device names and preview.</p>
            </div>
          </div>
        </div>

        <div className={`flex shrink-0 items-center justify-between gap-3 border-t px-5 py-4 sm:px-7 sm:py-5 ${border} ${isLight ? "bg-[#FAFAFA]" : "bg-[#202020]"}`}>
          <div className={`hidden items-center gap-2 text-[12px] sm:flex ${labelCls}`}>
            <span className="h-2 w-2 rounded-full bg-[#5286F6] shadow-[0_0_0_4px_rgba(82,134,246,0.14)]" />
            Your choices are saved for next time
          </div>

          <div className="ml-auto flex w-full items-center gap-2.5 sm:w-auto sm:gap-3">
            <button onClick={onCancel} className={`h-11 rounded-xl px-4 text-[13px] font-semibold transition sm:px-5 ${btnGhost}`} type="button">
              Cancel
            </button>

            <button onClick={handleJoin} disabled={fxApplying} className={`inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl px-6 text-[13px] font-semibold transition duration-200 sm:flex-none ${btnPrimary} disabled:opacity-70`} type="button">
              <span>{fxApplying ? "Applying background…" : "Join room"}</span>
              {!fxApplying ? <ArrowRight size={16} aria-hidden="true" /> : null}
            </button>
          </div>
        </div>

        <audio ref={testAudioRef} />
      </div>
    </div>
  );
}

export default PreJoinModal;
