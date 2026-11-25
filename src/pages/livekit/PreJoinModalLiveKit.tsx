import React, { useEffect, useMemo, useRef, useState } from "react";
import type { LocalVideoTrack } from "livekit-client";
import { Check, ChevronUp, SlidersHorizontal, X } from "lucide-react";
import { PreJoinDeviceSelect, PreJoinDisclosure } from "./PreJoinMenus";
import "./prejoin-compact.css";
import { Icon } from "./LiveKitUI";

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
  connectionError?: string;
  hideBackgroundFx?: boolean;
};

function deviceLabel(d: MediaDeviceInfo, fallback: string) {
  return (d.label || "").trim() || fallback;
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
  theme: _roomTheme,
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
  connectionError = "",
  hideBackgroundFx = false,
}: PreJoinModalProps) {
  // Pre-join intentionally uses the light chat palette in every room theme.
  const theme: RoomTheme = "light";
  const isLight = true;
  const [compactMenu, setCompactMenu] = useState<"mic" | "camera" | "processing" | null>(null);
  const compactMenuRef = useRef(compactMenu);
  compactMenuRef.current = compactMenu;
  const compactControlsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !compactMenu) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!compactControlsRef.current?.contains(target) && !target.closest('.ms-prejoin-device-menu')) setCompactMenu(null);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, compactMenu]);
  const previewHostRef = useRef<HTMLDivElement | null>(null);
  const attachedPreviewElRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadSlotRef = useRef<string | null>(null);
  const joinFromKeyboardRef = useRef<() => void>(() => { });
  const testAudioRef = useRef<HTMLAudioElement | null>(null);
  const [blurDraft, setBlurDraft] = useState<number>(blurStrength);
  const [localFxMessage, setLocalFxMessage] = useState("");
  const [expandedBackgroundChoice, setExpandedBackgroundChoice] = useState<"image" | "custom" | null>(null);
  useEffect(() => {
    if (!open) setCompactMenu(null);
  }, [open]);

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
      if (e.key === "Escape" && !e.defaultPrevented) {
        if (compactMenuRef.current) { e.preventDefault(); setCompactMenu(null); return; }
        onCancel();
      }
      // Enter joins from the name field or anywhere outside a control;
      // buttons, menus and checkboxes keep their own Enter behaviour.
      if (e.key === "Enter" && !e.defaultPrevented && !e.isComposing && !e.repeat) {
        const target = e.target as HTMLElement | null;
        const textField = target instanceof HTMLInputElement && (target.type === "text" || target.type === "");
        const control = !!target?.closest?.('button, a, select, textarea, input, [role="combobox"], [role="listbox"], [role="option"]');
        if (textField || !control) {
          e.preventDefault();
          joinFromKeyboardRef.current();
        }
      }
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
    "fixed inset-0 z-[2147483647] flex items-center justify-center px-3 py-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]";

  const card = [
    "relative flex max-h-[92dvh] w-full max-w-[460px] flex-col overflow-hidden rounded-[24px] border shadow-[0_28px_90px_rgba(0,0,0,0.36)] sm:max-h-[92dvh] sm:max-w-[460px] sm:rounded-[28px]",
    isLight ? "border-[#D8D0D0] bg-[#F3F1F1] text-[#20242D]" : "border-[#2B2B2B] bg-[#1B1B1B] text-white",
  ].join(" ");

  const border = isLight ? "border-[#D8D0D0]" : "border-[#343434]";
  const labelCls = isLight ? "text-[#686868]" : "text-[#B8B8B8]";
  const inputWrap = isLight ? "border border-[#D8D0D0] bg-white shadow-sm" : "border border-[#343434] bg-[#242424]";
  const inputCls = isLight ? "text-[#20242D] placeholder:text-[#909090]" : "text-white placeholder:text-white/40";
  const btnGhost = isLight ? "border border-[#D8D0D0] bg-white text-[#2F2F2F] hover:border-[#A9C4FC] hover:bg-[#F3F1F1]" : "border border-[#343434] bg-[#242424] text-white/85 hover:border-[#5286F6]/45 hover:bg-[#2F2F2F]";
  const btnPrimary = "bg-[#5286F6] text-white shadow-[0_12px_30px_rgba(82,134,246,0.25)] hover:bg-[#3E75ED] hover:shadow-[0_14px_34px_rgba(82,134,246,0.34)]";
  const mediaToggleBase = "inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2.5 rounded-2xl border px-3 text-[13px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5286F6]";
  const mediaToggleOn = isLight ? "border-[#A9C4FC] bg-[#EAF1FF] text-[#2459BE] hover:bg-[#DDE9FF]" : "border-[#5286F6]/45 bg-[#5286F6]/18 text-[#C4D6FF] hover:bg-[#5286F6]/25";
  const mediaToggleOff = isLight ? "border-[#D8D0D0] bg-white text-[#5E5E5E] hover:bg-[#F3F1F1]" : "border-[#343434] bg-[#2F2F2F] text-[#C8C8C8] hover:bg-[#383838]";

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
  joinFromKeyboardRef.current = () => {
    if (!fxApplying) handleJoin();
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
  const [selectedEffect, setSelectedEffect] = useState<Exclude<BackgroundChoice, "off">>("blur");
  useEffect(() => {
    if (activeBackgroundChoice !== "off") setSelectedEffect(activeBackgroundChoice);
  }, [activeBackgroundChoice]);

  const applyBackgroundChoice = (choice: BackgroundChoice) => {
    setCompactMenu(null);
    setLocalFxMessage("");
    if (choice !== "off") setSelectedEffect(choice);
    if (choice === "off" || choice === "blur") {
      setExpandedBackgroundChoice(null);
      void Promise.resolve(onApplyVideoFx(choice));
      return;
    }
    setExpandedBackgroundChoice(choice);
    const imageUrl = choice === "image"
      ? selectedPreset?.url || fxBgPresets[0]?.url
      : savedBackground?.dataUrl || customBackgroundSlots.find((slot) => !!slot.dataUrl)?.dataUrl;
    if (imageUrl) {
      onSetBgImageUrl(imageUrl);
      void Promise.resolve(onApplyVideoFx("bg", imageUrl));
    }
  };
  const visibleBackgroundChoice = expandedBackgroundChoice || activeBackgroundChoice;
  const renderedBackgroundChoice = visibleBackgroundChoice === "off" ? selectedEffect : visibleBackgroundChoice;

  if (!open) return null;

  return (
    <div
      className={overlay}
      data-theme={theme}
      data-prejoin-compact
      data-prejoin-daily
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
        <div data-prejoin-header className="ms-prejoin-daily-header">
          <h2 id="prejoin-title">Ready to join?</h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onCancel} className={`ms-prejoin-daily-cancel ${btnGhost}`}>Cancel</button>
            <button type="button" onClick={handleJoin} disabled={fxApplying}
              className={`ms-prejoin-daily-join ${btnPrimary} disabled:opacity-60`}>
              {fxApplying ? "Applying…" : "Join room"}
            </button>
          </div>
        </div>

        <div className="custom-scrollbar ms-prejoin-daily-body min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="w-full overflow-hidden">
                <div className="relative aspect-video w-full overflow-hidden bg-[#1B1B1B]">
                  <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full border border-white/15 bg-[#1B1B1B]/75 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur-sm">
                    {value.videoEnabled ? <Icon name="camera-on" theme="dark" className="h-3.5 w-3.5" /> : <Icon name="camera-off" theme="dark" className="h-3.5 w-3.5" />}
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
                  <label className="ms-prejoin-daily-name">
                    <span className="sr-only">Display name</span>
                    <span className="ms-prejoin-name-sizer" aria-hidden="true">{value.displayName || "Your name"}</span>
                    <img className="ms-prejoin-name-edit" src="/icons/edit_profile_hover.svg" alt="" aria-hidden="true" />
                    <input id="prejoin-display-name" aria-label="Display name" value={value.displayName}
                      onChange={(e) => onChange({ ...value, displayName: e.target.value })} placeholder="Your name" />
                  </label>
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
                      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.07] text-white/70"><Icon name="camera-off" theme="dark" className="h-7 w-7" /></span>
                      <span className="text-[13px] font-medium">Your camera is off</span>
                    </div>
                  )}
                </div>
          </div>
          <div className="ms-prejoin-compact-controls" ref={compactControlsRef}>
            <div className="ms-prejoin-compact-split">
              <button type="button" aria-label={value.audioEnabled ? "Turn microphone off" : "Turn microphone on"} title={value.audioEnabled ? "Turn microphone off" : "Turn microphone on"} aria-pressed={value.audioEnabled} onClick={() => onChange({ ...value, audioEnabled: !value.audioEnabled })} className={`${mediaToggleBase} ${value.audioEnabled ? mediaToggleOn : mediaToggleOff}`}>
                <PreJoinMediaIcon source={value.audioEnabled ? "mic-on" : "mic-off"}/><span className="ms-prejoin-media-label">Mic {value.audioEnabled ? "on" : "off"}</span>
              </button>
              <button type="button" className="ms-prejoin-compact-chevron" aria-label="Microphone and audio settings" aria-expanded={compactMenu === 'mic'} onClick={() => { if(compactMenu !== 'mic') onRefreshDevices(); setCompactMenu(compactMenu === 'mic' ? null : 'mic'); }}><ChevronUp size={10} strokeWidth={2.4}/></button>
            </div>
            <div className="ms-prejoin-compact-split">
              <button type="button" aria-label={value.videoEnabled ? "Turn camera off" : "Turn camera on"} title={value.videoEnabled ? "Turn camera off" : "Turn camera on"} aria-pressed={value.videoEnabled} onClick={() => onChange({ ...value, videoEnabled: !value.videoEnabled })} className={`${mediaToggleBase} ${value.videoEnabled ? mediaToggleOn : mediaToggleOff}`}>
                {value.videoEnabled ? <PreJoinMediaIcon source="camera-on-dark"/> : <PreJoinMediaIcon source="camera-off"/>}<span className="ms-prejoin-media-label">Camera {value.videoEnabled ? "on" : "off"}</span>
              </button>
              <button type="button" className="ms-prejoin-compact-chevron" aria-label="Choose camera" aria-expanded={compactMenu === 'camera'} onClick={() => { if(compactMenu !== 'camera') onRefreshDevices(); setCompactMenu(compactMenu === 'camera' ? null : 'camera'); }}><ChevronUp size={10} strokeWidth={2.4}/></button>
            </div>
            <button type="button" className="ms-prejoin-processing-button" aria-label="Audio processing" aria-controls="prejoin-audio-processing" title="Audio processing" aria-expanded={compactMenu === 'processing'} onClick={() => setCompactMenu(compactMenu === 'processing' ? null : 'processing')}><SlidersHorizontal size={20}/></button>
            {compactMenu && <div className={`ms-prejoin-compact-menu ms-prejoin-compact-menu--${compactMenu}`} role="group" aria-label={compactMenu === "mic" ? "Audio settings" : compactMenu === "camera" ? "Camera settings" : "Audio processing"}>
              <div className="ms-prejoin-compact-menu-title"><strong>{compactMenu === "mic" ? "Audio settings" : compactMenu === "camera" ? "Camera settings" : "Audio processing"}</strong><button type="button" onClick={()=>setCompactMenu(null)} aria-label="Close settings menu"><X size={15}/></button></div>
              {compactMenu === 'mic' && <div className="ms-prejoin-compact-menu-fields">
                <label htmlFor="prejoin-microphone">Microphone</label>
                  <PreJoinDeviceSelect id="prejoin-microphone" label="Microphone" theme={theme} value={value.audioInputId}
                    onChange={(audioInputId) => onChange({ ...value, audioInputId })}
                    options={[{ value: "", label: "Default" }, ...devices.audioInputs.map((d, i) => ({ value: d.deviceId, label: deviceLabel(d, `Microphone ${i + 1}`) }))]} />
                <label htmlFor="prejoin-speaker">Speaker</label>
                  <PreJoinDeviceSelect id="prejoin-speaker" label="Speaker" theme={theme} value={value.audioOutputId}
                    onChange={(audioOutputId) => onChange({ ...value, audioOutputId })}
                    options={[{ value: "default", label: "Default" }, ...devices.audioOutputs.map((d, i) => ({ value: d.deviceId, label: deviceLabel(d, `Speaker ${i + 1}`) }))]} />
                <div className="flex gap-2"><button type="button" className={`rounded-xl px-3 py-2 text-xs ${btnGhost}`} onClick={handleTestSpeaker}>Test sound</button><button type="button" className={`rounded-xl px-3 py-2 text-xs ${btnGhost}`} onClick={onRefreshDevices}>Refresh devices</button></div>
              </div>}
              {compactMenu === 'camera' && <div className="ms-prejoin-compact-menu-fields"><label htmlFor="prejoin-camera">Camera</label>
                  <PreJoinDeviceSelect id="prejoin-camera" label="Camera" theme={theme} value={value.videoInputId}
                    onChange={(videoInputId) => onChange({ ...value, videoInputId })}
                    options={[{ value: "", label: "Default" }, ...devices.videoInputs.map((d, i) => ({ value: d.deviceId, label: deviceLabel(d, `Camera ${i + 1}`) }))]} />
                <button type="button" className={`rounded-xl px-3 py-2 text-xs ${btnGhost}`} onClick={onRefreshDevices}>Refresh devices</button>
                <p className={`text-[11px] leading-4 ${labelCls}`}>Device names appear after browser permission is granted.</p>
              </div>}
              {compactMenu === 'processing' && <>                <div id="prejoin-audio-processing">
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
                </div></>}
            </div>}
          </div>
              {!hideBackgroundFx && <div id="prejoin-background-panel" className="ms-prejoin-compact-background mt-4">
                <h3 className="mb-2 text-[12px] font-semibold">BG effects</h3>
                <div className="ms-prejoin-effect-switcher" role="group" aria-label="Background effect choices">
                  {(["off", "blur", "image", "custom"] as const).map((choice) => (
                    <button key={choice} type="button" aria-pressed={activeBackgroundChoice === choice}
                      disabled={!!fxBlockedReason || fxApplying} onClick={() => applyBackgroundChoice(choice)}>
                      <BackgroundChoiceIcon choice={choice} />
                      <span>{choice === "off" ? "None" : choice === "blur" ? "Blur" : choice === "image" ? "Image" : "Custom"}</span>
                    </button>
                  ))}
                </div>

              {!hideBackgroundFx ? (
                <div className={`rounded-[20px] ${inputWrap}`}>
                  <span className="sr-only" role="status">
                    {fxApplying ? "Applying…" : localFxMessage || fxStatusText || (videoFxMode === "off" ? "Off" : videoFxMode === "blur" ? "Blur" : "Image")}
                  </span>
                  <PreJoinDisclosure open={true}>
                  <div className={`border-t px-4 pb-4 ${border}`}>

                  {fxBlockedReason ? <div className={`mt-2 text-[11px] ${labelCls}`}>{fxBlockedReason}</div> : null}
                  {fxError ? <div className={`mt-3 text-[12px] ${isLight ? "text-[#C73535]" : "text-[#FCA5A5]"}`}>{fxError}</div> : null}

                  {renderedBackgroundChoice === "blur" ? (
                    <div className="ms-prejoin-background-content mt-4">
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

                  {renderedBackgroundChoice === "image" ? <div className="ms-prejoin-background-content mt-4">
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

                  {renderedBackgroundChoice === "custom" ? (
                    <div className="ms-prejoin-background-content mt-4">
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
                      <div className="ms-prejoin-custom-grid mt-2">
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
                              <div className="flex min-w-0 flex-col items-start gap-1.5 px-2 py-2">
                                <span className="truncate text-[11px] font-semibold">{slot.label}</span>
                                <div className="flex flex-wrap gap-1">
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
                  </div>
                  </PreJoinDisclosure>
                </div>
              ) : null}
              </div>}
          {(deviceError || connectionError) && <p role="alert" className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-400">{connectionError || deviceError}</p>}
        </div>

        <audio ref={testAudioRef} />
      </div>
    </div>
  );
}

export default PreJoinModal;
