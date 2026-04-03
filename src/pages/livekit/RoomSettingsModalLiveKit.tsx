import React from "react";

type RoomTheme = "dark" | "light";
type FxMode = "off" | "blur" | "bg";

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

function ToggleRow(props: {
    label: string;
    description?: string;
    checked: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
    isLight: boolean;
}) {
    const { label, description, checked, onChange, disabled, isLight } = props;

    return (
        <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
                <div className={`text-[13px] font-semibold ${isLight ? "text-black/85" : "text-white/90"}`}>{label}</div>
                {description ? (
                    <div className={`mt-1 text-[12px] ${isLight ? "text-black/55" : "text-white/55"}`}>{description}</div>
                ) : null}
            </div>

            <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(!checked)}
                className={[
                    "relative shrink-0 w-[50px] h-[30px] rounded-full transition border disabled:opacity-50",
                    checked
                        ? isLight
                            ? "bg-blue-600 border-blue-600"
                            : "bg-emerald-500 border-emerald-500"
                        : isLight
                            ? "bg-black/5 border-black/10"
                            : "bg-white/5 border-white/10",
                ].join(" ")}
                aria-pressed={checked}
                title={label}
            >
                <span
                    className="absolute top-[2px] left-[2px] w-[24px] h-[24px] rounded-full bg-white shadow-md transition-transform"
                    style={{
                        transform: checked ? "translateX(20px)" : "translateX(0px)",
                    }}
                />
            </button>
        </div>
    );
}

function SelectField(props: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
    isLight: boolean;
}) {
    const { label, value, onChange, options, isLight } = props;

    return (
        <div>
            <div className={`text-[13px] font-semibold mb-2 ${isLight ? "text-black/85" : "text-white/90"}`}>{label}</div>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className={[
                    "w-full h-11 rounded-xl px-3 outline-none border text-[13px]",
                    isLight ? "bg-white border-black/10 text-black/85" : "bg-[#0b1220] border-white/10 text-white/90",
                ].join(" ")}
            >
                {options.map((opt) => (
                    <option key={`${label}-${opt.value}`} value={opt.value}>
                        {opt.label}
                    </option>
                ))}
            </select>
        </div>
    );
}

function SliderField(props: {
    label: string;
    description?: string;
    min: number;
    max: number;
    step?: number;
    value: number;
    onChange: (v: number) => void;
    disabled?: boolean;
    isLight: boolean;
}) {
    const { label, description, min, max, step = 1, value, onChange, disabled, isLight } = props;

    return (
        <div>
            <div className="flex items-center justify-between gap-3">
                <div>
                    <div className={`text-[13px] font-semibold ${isLight ? "text-black/85" : "text-white/90"}`}>{label}</div>
                    {description ? (
                        <div className={`mt-1 text-[12px] ${isLight ? "text-black/55" : "text-white/55"}`}>{description}</div>
                    ) : null}
                </div>
                <div className={`text-[13px] font-semibold ${isLight ? "text-black/70" : "text-white/80"}`}>{value}</div>
            </div>

            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                disabled={disabled}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-full mt-3"
            />
        </div>
    );
}

function VideoPreviewBox(props: {
    track?: {
        attach?: () => HTMLMediaElement;
        detach?: (element?: HTMLMediaElement) => void;
    } | null;
    filterCss?: string;
    isLight: boolean;
    label?: string;
}) {
    const { track, filterCss, isLight, label = "Camera preview" } = props;
    const hostRef = React.useRef<HTMLDivElement | null>(null);
    const mediaElRef = React.useRef<HTMLMediaElement | null>(null);

    React.useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        host.innerHTML = "";

        if (!track || typeof track.attach !== "function") return;

        const attached = track.attach();
        if (!attached) return;

        const media = attached as HTMLMediaElement & {
            playsInline?: boolean;
        };

        media.muted = true;
        media.autoplay = true;
        media.playsInline = true;
        media.style.width = "100%";
        media.style.height = "100%";
        media.style.objectFit = "cover";
        media.style.transform = "scaleX(-1)";
        media.style.filter = filterCss || "";

        host.appendChild(media);
        mediaElRef.current = media;

        return () => {
            try {
                if (track && typeof track.detach === "function" && mediaElRef.current) {
                    track.detach(mediaElRef.current);
                }
            } catch { }

            try {
                if (mediaElRef.current && mediaElRef.current.parentNode) {
                    mediaElRef.current.parentNode.removeChild(mediaElRef.current);
                }
            } catch { }

            mediaElRef.current = null;
        };
    }, [track, filterCss]);

    return (
        <div>
            <div className={`text-[13px] font-semibold mb-3 ${isLight ? "text-black/85" : "text-white/90"}`}>
                {label}
            </div>

            <div
                className={[
                    "rounded-2xl overflow-hidden border aspect-video w-full",
                    isLight ? "border-black/10 bg-black/5" : "border-white/10 bg-[#0b1220]",
                ].join(" ")}
            >
                {track ? (
                    <div ref={hostRef} className="w-full h-full" />
                ) : (
                    <div
                        className={`w-full h-full flex items-center justify-center text-[12px] ${isLight ? "text-black/55" : "text-white/55"
                            }`}
                    >
                        Camera preview is not available
                    </div>
                )}
            </div>
        </div>
    );
}

export function RoomSettingsModalLiveKit({
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
    previewTrack,
    previewVideoFilterCss,
    onUploadBg,
    onResetBg,

    devices,
    selectedAudioInputId,
    selectedVideoInputId,
    selectedAudioOutputId,
    onChangeAudioInput,
    onChangeVideoInput,
    onChangeAudioOutput,

    echoCancellationEnabled,
    noiseSuppressionEnabled,
    autoGainControlEnabled,
    onChangeEchoCancellation,
    onChangeNoiseSuppression,
    onChangeAutoGainControl,

    roomSoundsEnabled,
    onToggleRoomSounds,

    colorCorrectionEnabled,
    brightness,
    contrast,
    saturate,
    onToggleColorCorrection,
    onChangeBrightness,
    onChangeContrast,
    onChangeSaturate,

    hideBackgroundFx = false,
}: {
    open: boolean;
    theme: RoomTheme;
    mode: FxMode;
    blurStrength: number;
    onBlurStrengthChange: (v: number) => void;
    bgImageUrl: string;
    onSetBgImageUrl: (url: string) => void;
    onApplyMode: (m: FxMode) => void | Promise<void>;
    onClose: () => void;
    fxError: string;
    fxApplying: boolean;
    fxStatusText: string;
    previewTrack?: {
        attach?: () => HTMLMediaElement;
        detach?: (element?: HTMLMediaElement) => void;
    } | null;
    previewVideoFilterCss?: string;
    onUploadBg: (file: File) => void;
    onResetBg: () => void;

    devices: {
        videoInputs: MediaDeviceInfo[];
        audioInputs: MediaDeviceInfo[];
        audioOutputs: MediaDeviceInfo[];
    };
    selectedAudioInputId: string;
    selectedVideoInputId: string;
    selectedAudioOutputId: string;
    onChangeAudioInput: (v: string) => void | Promise<void>;
    onChangeVideoInput: (v: string) => void | Promise<void>;
    onChangeAudioOutput: (v: string) => void;

    echoCancellationEnabled: boolean;
    noiseSuppressionEnabled: boolean;
    autoGainControlEnabled: boolean;
    onChangeEchoCancellation: (v: boolean) => void | Promise<void>;
    onChangeNoiseSuppression: (v: boolean) => void | Promise<void>;
    onChangeAutoGainControl: (v: boolean) => void | Promise<void>;

    roomSoundsEnabled: boolean;
    onToggleRoomSounds: () => void;

    colorCorrectionEnabled: boolean;
    brightness: number;
    contrast: number;
    saturate: number;
    onToggleColorCorrection: (v: boolean) => void;
    onChangeBrightness: (v: number) => void;
    onChangeContrast: (v: number) => void;
    onChangeSaturate: (v: number) => void;

    hideBackgroundFx?: boolean;
}) {
    if (!open) return null;

    const isLight = theme === "light";
    const isCustomBackground = !!bgImageUrl && !FX_BG_PRESETS.some((p) => p.url === bgImageUrl);

    const overlay =
        "fixed inset-0 z-[1001] flex items-stretch sm:items-center justify-center " +
        "px-0 sm:px-3 py-0 sm:py-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]";

    const backdrop = "absolute inset-0 bg-black/60";

    const card = [
        "relative w-full sm:max-w-[760px] rounded-none sm:rounded-3xl shadow-2xl overflow-hidden",
        "max-h-[100dvh] sm:max-h-[92vh] flex flex-col",
        isLight ? "bg-white text-black border border-black/10" : "bg-[#020617] text-white border border-white/10",
    ].join(" ");

    const sectionCls = isLight ? "bg-black/5 border border-black/10" : "bg-white/5 border border-white/10";

    const ghostBtn = isLight ? "bg-black/5 hover:bg-black/10 text-black/80" : "bg-white/5 hover:bg-white/10 text-white/85";

    const activeBtn = isLight ? "bg-blue-600 text-white" : "bg-emerald-500 text-[#03110a]";
    const subtleText = isLight ? "text-black/60" : "text-white/60";

    const audioInputOptions = [
        { value: "", label: devices.audioInputs?.length ? "Default microphone" : "No microphones found" },
        ...(devices.audioInputs || []).map((d, idx) => ({
            value: d.deviceId,
            label: d.label || `Microphone ${idx + 1}`,
        })),
    ];

    const videoInputOptions = [
        { value: "", label: devices.videoInputs?.length ? "Default camera" : "No cameras found" },
        ...(devices.videoInputs || []).map((d, idx) => ({
            value: d.deviceId,
            label: d.label || `Camera ${idx + 1}`,
        })),
    ];

    const audioOutputOptions = [
        { value: "default", label: "Default speakers" },
        ...(devices.audioOutputs || []).map((d, idx) => ({
            value: d.deviceId,
            label: d.label || `Output ${idx + 1}`,
        })),
    ];

    return (
        <div className={overlay} data-theme={theme} style={{ colorScheme: theme }}>
            <div className={backdrop} onClick={onClose} />

            <div className={card}>
                <div className={`px-5 sm:px-6 py-4 sm:py-5 border-b ${isLight ? "border-black/10" : "border-white/10"}`}>
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <div className="font-semibold text-[16px]">Settings</div>
                            <div className={`text-[12px] mt-1 ${subtleText}`}>
                                Camera, mic, speakers, FX, room sounds and color tuning.
                            </div>
                        </div>

                        <button
                            onClick={onClose}
                            className={`w-9 h-9 rounded-2xl ${ghostBtn}`}
                            type="button"
                            title="Close"
                        >
                            ✕
                        </button>
                    </div>
                </div>

                <div className="px-5 sm:px-6 py-4 sm:py-5 flex-1 overflow-y-auto overscroll-contain flex flex-col gap-5">
                    <div className={`rounded-2xl p-4 ${sectionCls}`}>
                        <VideoPreviewBox
                            track={previewTrack}
                            filterCss={previewVideoFilterCss}
                            isLight={isLight}
                            label="Live preview"
                        />
                    </div>

                    <div className={`rounded-2xl p-4 ${sectionCls}`}>
                        <div className="text-[13px] font-semibold mb-4">Devices</div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <SelectField
                                label="Microphone"
                                value={selectedAudioInputId}
                                onChange={(v) => {
                                    void onChangeAudioInput(v);
                                }}
                                options={audioInputOptions}
                                isLight={isLight}
                            />

                            <SelectField
                                label="Camera"
                                value={selectedVideoInputId}
                                onChange={(v) => {
                                    void onChangeVideoInput(v);
                                }}
                                options={videoInputOptions}
                                isLight={isLight}
                            />

                            <div className="md:col-span-2">
                                <SelectField
                                    label="Speakers / output"
                                    value={selectedAudioOutputId}
                                    onChange={onChangeAudioOutput}
                                    options={audioOutputOptions}
                                    isLight={isLight}
                                />
                            </div>
                        </div>
                    </div>

                    <div className={`rounded-2xl p-4 ${sectionCls}`}>
                        <div className="text-[13px] font-semibold mb-4">Microphone processing</div>

                        <div className="flex flex-col gap-4">
                            <ToggleRow
                                label="Echo cancellation"
                                description="Reduce echo from speakers going back into the mic."
                                checked={echoCancellationEnabled}
                                onChange={(v) => {
                                    void onChangeEchoCancellation(v);
                                }}
                                isLight={isLight}
                            />

                            <ToggleRow
                                label="Noise suppression"
                                description="Reduce keyboard noise, fan noise and room hum."
                                checked={noiseSuppressionEnabled}
                                onChange={(v) => {
                                    void onChangeNoiseSuppression(v);
                                }}
                                isLight={isLight}
                            />

                            <ToggleRow
                                label="Auto gain control"
                                description="Automatically normalize mic loudness."
                                checked={autoGainControlEnabled}
                                onChange={(v) => {
                                    void onChangeAutoGainControl(v);
                                }}
                                isLight={isLight}
                            />
                        </div>
                    </div>

                    {!hideBackgroundFx && (
                        <>
                            <div className={`ms-desktop-only-fx rounded-2xl p-4 ${sectionCls}`}>
                                <div className="text-[13px] font-semibold mb-3">Video effect mode</div>

                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={() => void onApplyMode("off")}
                                        className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${mode === "off" ? activeBtn : ghostBtn}`}
                                        disabled={fxApplying}
                                        type="button"
                                    >
                                        FX off
                                    </button>

                                    <button
                                        onClick={() => void onApplyMode("blur")}
                                        className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${mode === "blur" ? activeBtn : ghostBtn}`}
                                        disabled={fxApplying}
                                        type="button"
                                    >
                                        Blur
                                    </button>

                                    <button
                                        onClick={() => void onApplyMode("bg")}
                                        className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${mode === "bg" ? activeBtn : ghostBtn}`}
                                        disabled={fxApplying}
                                        type="button"
                                    >
                                        Background image
                                    </button>
                                </div>

                                <div className={`mt-3 text-[12px] ${subtleText}`}>
                                    {fxApplying ? "Applying effect…" : fxStatusText || "Ready"}
                                </div>

                                {fxError ? <div className="mt-2 text-[12px] text-red-500 break-words">{fxError}</div> : null}
                            </div>

                            <div className={`ms-desktop-only-fx rounded-2xl p-4 ${sectionCls}`}>
                                <SliderField
                                    label="Blur strength"
                                    description="Used when Blur mode is active."
                                    min={4}
                                    max={30}
                                    step={1}
                                    value={blurStrength}
                                    onChange={onBlurStrengthChange}
                                    isLight={isLight}
                                />
                            </div>

                            <div className={`ms-desktop-only-fx rounded-2xl p-4 ${sectionCls}`}>
                                <div className="flex items-center justify-between gap-3 mb-3">
                                    <div>
                                        <div className="text-[13px] font-semibold">Custom background</div>
                                        <div className={`text-[12px] mt-1 ${subtleText}`}>
                                            Upload your own image and use it in Background image mode.
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <label className={`h-9 px-3 rounded-xl text-[12px] ${ghostBtn} cursor-pointer flex items-center`}>
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

                                        <button
                                            onClick={onResetBg}
                                            className={`h-9 px-3 rounded-xl text-[12px] ${ghostBtn}`}
                                            disabled={fxApplying || !bgImageUrl}
                                            type="button"
                                        >
                                            Clear
                                        </button>
                                    </div>
                                </div>

                                <div
                                    className={[
                                        "rounded-2xl overflow-hidden border",
                                        isLight ? "border-black/10 bg-white" : "border-white/10 bg-[#0b1220]",
                                    ].join(" ")}
                                >
                                    <div className="aspect-video w-full">
                                        {bgImageUrl ? (
                                            <img src={bgImageUrl} alt="Custom background preview" className="w-full h-full object-cover" />
                                        ) : (
                                            <div className={`w-full h-full flex items-center justify-center text-[12px] ${subtleText}`}>
                                                No custom background selected
                                            </div>
                                        )}
                                    </div>

                                    <div className={`px-3 py-2 text-[12px] ${subtleText}`}>
                                        {bgImageUrl
                                            ? isCustomBackground
                                                ? "Custom uploaded background selected"
                                                : "Preset background selected"
                                            : "Upload an image to use your own background"}
                                    </div>
                                </div>

                                <div className={`mt-3 text-[12px] ${subtleText}`}>
                                    Tip: after upload, switch to <span className="font-semibold">Background image</span> mode if it is not active already.
                                </div>
                            </div>

                            <div className={`ms-desktop-only-fx rounded-2xl p-4 ${sectionCls}`}>
                                <div className="flex items-center justify-between gap-3 mb-3">
                                    <div>
                                        <div className="text-[13px] font-semibold">Background presets</div>
                                        <div className={`text-[12px] mt-1 ${subtleText}`}>
                                            Quick built-in backgrounds for Background image mode.
                                        </div>
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
                                                type="button"
                                            >
                                                <div className="aspect-video w-full">
                                                    <img src={p.url} alt={p.label} className="w-full h-full object-cover" />
                                                </div>
                                                <div className={`px-2 py-2 text-[12px] ${isLight ? "bg-white" : "bg-[#0b1220]"}`}>{p.label}</div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </>
                    )}

                    <div className={`rounded-2xl p-4 ${sectionCls}`}>
                        <div className="text-[13px] font-semibold mb-4">Color correction</div>

                        <div className="flex flex-col gap-4">
                            <ToggleRow
                                label="Enable color correction"
                                description="Applies CSS video correction in the room UI. This is visual and local."
                                checked={colorCorrectionEnabled}
                                onChange={onToggleColorCorrection}
                                isLight={isLight}
                            />

                            <SliderField
                                label="Brightness"
                                min={50}
                                max={150}
                                step={1}
                                value={brightness}
                                onChange={onChangeBrightness}
                                disabled={!colorCorrectionEnabled}
                                isLight={isLight}
                            />

                            <SliderField
                                label="Contrast"
                                min={50}
                                max={150}
                                step={1}
                                value={contrast}
                                onChange={onChangeContrast}
                                disabled={!colorCorrectionEnabled}
                                isLight={isLight}
                            />

                            <SliderField
                                label="Saturation"
                                min={50}
                                max={180}
                                step={1}
                                value={saturate}
                                onChange={onChangeSaturate}
                                disabled={!colorCorrectionEnabled}
                                isLight={isLight}
                            />
                        </div>
                    </div>

                    <div className={`rounded-2xl p-4 ${sectionCls}`}>
                        <div className="text-[13px] font-semibold mb-4">Room tools</div>

                        <div className="flex flex-col gap-4">
                            <ToggleRow
                                label="Room sounds"
                                description="Enable join / leave and other room UI sounds."
                                checked={roomSoundsEnabled}
                                onChange={() => onToggleRoomSounds()}
                                isLight={isLight}
                            />
                        </div>
                    </div>
                </div>

                <div className={`px-5 sm:px-6 py-4 border-t flex items-center justify-end gap-3 ${isLight ? "border-black/10" : "border-white/10"}`}>
                    <button
                        onClick={onClose}
                        className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${ghostBtn}`}
                        type="button"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

export default RoomSettingsModalLiveKit;