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

  // preview + FX
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
    "px-0 sm:px-3 py-0 sm:py-6 " +
    "pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]";

  const backdrop = "absolute inset-0 bg-black/55";

  const card = [
    "relative w-full sm:max-w-[980px] rounded-none sm:rounded-3xl shadow-2xl overflow-hidden",
    "max-h-[100dvh] sm:max-h-[92dvh]",
    "flex flex-col",
    isLight ? "bg-white text-black" : "bg-[#020617] text-white",
    "border",
    isLight ? "border-black/10" : "border-white/10",
  ].join(" ");

  const headerCls = `px-5 sm:px-6 py-4 sm:py-5 border-b ${isLight ? "border-black/10" : "border-white/10"
    }`;

  const bodyCls =
    "flex-1 min-h-0 overflow-y-auto overscroll-contain " +
    "px-5 sm:px-6 py-4 sm:py-5 " +
    "custom-scrollbar";

  const footerCls = `px-5 sm:px-6 py-4 sm:py-5 border-t flex items-center justify-end gap-3 ${isLight ? "border-black/10" : "border-white/10"
    }`;

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

  const fxBtnBase =
    "h-10 px-4 rounded-2xl text-[13px] font-semibold transition disabled:opacity-60 disabled:cursor-not-allowed";

  const fxBtnSelected = isLight
    ? "bg-black/80 text-white hover:bg-black"
    : "bg-white text-black hover:bg-white";

  const fxBtnIdle = btnGhost;

  const selectCls = [
    "w-full outline-none text-[13px] rounded-xl px-3 py-2",
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
    } catch {
      // ignore
    }

    if (el instanceof HTMLVideoElement) {
      try {
        el.muted = true;
        el.playsInline = true;
        el.autoplay = true;
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
    if (!value.videoEnabled) return "Video is disabled";
    if (!previewVideoTrack) return "Preparing camera preview…";
    return "Preview";
  }, [value.videoEnabled, previewVideoTrack]);

  const fxBlockedReason = hideBackgroundFx
    ? "Background effects are not available on this device"
    : !value.videoEnabled
      ? "Turn video on to use FX"
      : "";

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
                Preview + devices + background effects — then join.
              </div>
            </div>

            <button
              onClick={onCancel}
              className={`w-9 h-9 rounded-2xl flex items-center justify-center ${btnGhost}`}
              title="Close"
              type="button"
            >
              ✕
            </button>
          </div>
        </div>

        <div className={bodyCls}>
          <div className="grid grid-cols-1 lg:grid-cols-[380px,1fr] gap-5">
            <div className="flex flex-col gap-4">
              <div
                className={`rounded-3xl overflow-hidden border ${isLight ? "border-black/10 bg-black/5" : "border-white/10 bg-white/5"
                  }`}
              >
                <div className="px-4 py-3 flex items-center justify-between">
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

                <div className="relative aspect-video sm:aspect-video">
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
                    </>
                  ) : (
                    <div
                      className={`absolute inset-0 flex items-center justify-center text-[12px] ${labelCls}`}
                    >
                      Video disabled
                    </div>
                  )}
                </div>
              </div>

              {!hideBackgroundFx && (
                <div className={`ms-desktop-only-fx rounded-3xl p-4 ${inputWrap}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className={`text-[12px] font-semibold ${labelCls}`}>
                      Background effects
                    </div>
                    {fxApplying ? (
                      <div className={`text-[11px] ${labelCls}`}>Applying…</div>
                    ) : fxStatusText ? (
                      <div className={`text-[11px] ${labelCls}`}>{fxStatusText}</div>
                    ) : (
                      <div className={`text-[11px] ${labelCls}`}></div>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!!fxBlockedReason || fxApplying}
                      onClick={() => onApplyVideoFx("off")}
                      className={`${fxBtnBase} ${videoFxMode === "off" ? fxBtnSelected : fxBtnIdle}`}
                      title={fxBlockedReason || "Disable FX"}
                    >
                      Off
                    </button>

                    <button
                      type="button"
                      disabled={!!fxBlockedReason || fxApplying}
                      onClick={() => onApplyVideoFx("blur")}
                      className={`${fxBtnBase} ${videoFxMode === "blur" ? fxBtnSelected : fxBtnIdle}`}
                      title={fxBlockedReason || "Apply blur"}
                    >
                      Blur
                    </button>

                    <button
                      type="button"
                      disabled={!!fxBlockedReason || fxApplying}
                      onClick={() => onApplyVideoFx("bg")}
                      className={`${fxBtnBase} ${videoFxMode === "bg" ? fxBtnSelected : fxBtnIdle}`}
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
                      <div className="flex items-center justify-between">
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

                      <div className={`mt-2 text-[11px] ${labelCls}`}>
                        Tip: Blur is CPU-heavy. If it stutters, lower strength.
                      </div>
                    </div>
                  )}

                  {videoFxMode === "bg" && (
                    <div className="mt-4">
                      <div className={`text-[12px] ${labelCls}`}>Presets</div>

                      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {fxBgPresets?.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            disabled={!value.videoEnabled || fxApplying}
                            onClick={() => onSetBgImageUrl(p.url)}
                            className={`rounded-2xl overflow-hidden border text-left transition ${isLight
                                ? "border-black/10 hover:border-black/20"
                                : "border-white/10 hover:border-white/20"
                              }`}
                            title={p.label}
                          >
                            <div
                              className="h-[72px] sm:h-[56px] w-full"
                              style={{
                                backgroundImage: `url(${p.url})`,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                              }}
                            />
                            <div className={`px-3 py-2 text-[12px] ${labelCls}`}>{p.label}</div>
                          </button>
                        ))}
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
                          className={`h-10 px-4 rounded-2xl text-[13px] font-semibold ${btnGhost}`}
                        >
                          Upload image
                        </button>

                        <button
                          type="button"
                          disabled={!value.videoEnabled || fxApplying}
                          onClick={onResetBg}
                          className={`h-10 px-4 rounded-2xl text-[13px] font-semibold ${btnGhost}`}
                        >
                          Reset
                        </button>

                        <button
                          type="button"
                          disabled={!value.videoEnabled || fxApplying}
                          onClick={() => onApplyVideoFx("bg")}
                          className={`h-10 px-4 rounded-2xl text-[13px] font-semibold ${btnGhost}`}
                          title="Re-apply background now"
                        >
                          Re-apply
                        </button>
                      </div>

                      <div className={`mt-2 text-[11px] ${labelCls}`}>
                        Use presets for best performance. Large images can be heavier.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-4">
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

                <div className="sm:col-span-2 flex flex-col gap-2">
                  <div className={`text-[12px] ${labelCls}`}>Speaker</div>
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

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={onRefreshDevices}
                      className={`h-10 px-4 rounded-2xl text-[13px] font-semibold ${btnGhost}`}
                      type="button"
                    >
                      Refresh devices
                    </button>

                    <button
                      onClick={handleTestSpeaker}
                      className={`h-10 px-4 rounded-2xl text-[13px] font-semibold ${btnGhost}`}
                      type="button"
                    >
                      Test sound
                    </button>
                  </div>

                  <div className={`text-[12px] ${labelCls}`}>
                    Tip: allow mic/camera to see device names
                  </div>
                </div>
              </div>

              <div
                className={`rounded-2xl p-4 ${isLight
                    ? "bg-blue-50 border border-blue-100"
                    : "bg-white/5 border border-white/10"
                  }`}
              >
                <div
                  className={`text-[12px] font-semibold ${isLight ? "text-blue-900/80" : "text-white/80"
                    }`}
                >
                  Quick sanity check
                </div>
                <div
                  className={`mt-1 text-[12px] ${isLight ? "text-blue-900/70" : "text-white/65"
                    }`}
                >
                  If preview is blank — allow camera permissions in the browser.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={footerCls}>
          <button
            onClick={onCancel}
            className={`h-11 px-5 rounded-2xl text-[13px] font-semibold ${btnGhost}`}
            type="button"
          >
            Cancel
          </button>

          <button
            onClick={handleJoin}
            disabled={fxApplying}
            className={`h-11 px-6 rounded-2xl text-[13px] font-semibold ${btnPrimary} disabled:opacity-70`}
            type="button"
          >
            Join room
          </button>
        </div>

        <audio ref={testAudioRef} />
      </div>
    </div>
  );
}

export default PreJoinModal;