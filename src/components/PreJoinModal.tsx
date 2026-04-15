import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, RefreshCcw } from "lucide-react";
import type { LocalVideoTrack } from "livekit-client";

type BgMode = "none" | "blur" | "image";
type FxMode = "off" | "blur" | "bg";
type RoomTheme = "light" | "dark";

type MediaDevicesResult = {
    videoInputs: MediaDeviceInfo[];
    audioInputs: MediaDeviceInfo[];
    audioOutputs: MediaDeviceInfo[];
};

export type PreJoinSettings = {
    displayName: string;

    audioEnabled: boolean;
    videoEnabled: boolean;

    videoInputId: string;
    audioInputId: string;
    audioOutputId: string;

    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;

    bgMode?: BgMode;
    bgImageUrl?: string;
};

type Props = {
    open: boolean;

    theme?: RoomTheme;
    devices?: MediaDevicesResult;

    value?: PreJoinSettings;
    initial?: Partial<PreJoinSettings>;

    onChange?: React.Dispatch<React.SetStateAction<PreJoinSettings>>;
    onCancel?: () => void;
    onJoin?: ((s: PreJoinSettings) => void) | (() => void);

    onRefreshDevices?: () => void | Promise<void>;
    onTestSpeaker?: () => void;
    onPrepareAudioGesture?: () => void;

    hideBackgroundFx?: boolean;

    previewVideoTrack?: LocalVideoTrack | null;
    previewVersion?: number;

    videoFxMode?: FxMode;
    blurStrength?: number;
    bgImageUrl?: string;
    fxApplying?: boolean;
    fxError?: string;
    fxStatusText?: string;

    onApplyVideoFx?: (mode: FxMode) => void | Promise<void>;
    onBlurStrengthChange?: (value: number) => void;
    onUploadBg?: (file: File) => void | Promise<void>;
    onResetBg?: () => void;
};

const DEFAULTS: PreJoinSettings = {
    displayName: "",

    audioEnabled: true,
    videoEnabled: true,

    videoInputId: "default",
    audioInputId: "default",
    audioOutputId: "default",

    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,

    bgMode: "none",
    bgImageUrl: undefined,
};

const DEFAULT_BACKGROUNDS: { id: string; url: string; label: string }[] = [
    { id: "bg1", url: "/backgrounds/bg1.jpg", label: "Warm" },
    { id: "bg2", url: "/backgrounds/bg2.jpg", label: "Office" },
    { id: "bg3", url: "/backgrounds/bg3.jpg", label: "Soft" },
    { id: "bg4", url: "/backgrounds/bg4.jpg", label: "Mountains" },
    { id: "bg5", url: "/backgrounds/bg5.jpg", label: "Gradient" },
    { id: "bg6", url: "/backgrounds/bg6.jpg", label: "Night" },
];

function supportsSetSinkId() {
    return (
        typeof HTMLMediaElement !== "undefined" &&
        typeof (HTMLMediaElement.prototype as HTMLMediaElement & {
            setSinkId?: (id: string) => Promise<void>;
        }).setSinkId === "function"
    );
}

function deviceLabel(d: MediaDeviceInfo, fallback: string) {
    return d.label?.trim() || `${fallback} (${(d.deviceId || "").slice(0, 6)}…)`;
}

function attachPreviewTrack(
    videoEl: HTMLVideoElement | null,
    track: LocalVideoTrack | null | undefined
) {
    if (!videoEl || !track) return () => { };

    let attached: HTMLMediaElement | null = null;

    try {
        const el = track.attach();
        if (el instanceof HTMLVideoElement) {
            attached = el;
            videoEl.srcObject = el.srcObject;
            videoEl.muted = true;
            (videoEl as HTMLVideoElement & { playsInline?: boolean }).playsInline = true;
            void videoEl.play().catch(() => { });
        }
    } catch {
        // ignore
    }

    return () => {
        try {
            if (attached) track.detach(attached);
        } catch {
            // ignore
        }
        try {
            videoEl.srcObject = null;
        } catch {
            // ignore
        }
    };
}

export default function PreJoinModal({
    open,
    theme = "dark",
    devices,
    value,
    initial,
    onChange,
    onCancel,
    onJoin,
    onRefreshDevices,
    onTestSpeaker,
    onPrepareAudioGesture,
    hideBackgroundFx,
    previewVideoTrack,
    previewVersion,
    videoFxMode = "off",
    blurStrength = 10,
    bgImageUrl,
    fxApplying,
    fxError,
    fxStatusText,
    onApplyVideoFx,
    onBlurStrengthChange,
    onUploadBg,
    onResetBg,
}: Props) {
    const isControlled = !!value && !!onChange;

    const [localSettings, setLocalSettings] = useState<PreJoinSettings>({
        ...DEFAULTS,
        ...(initial || {}),
    });

    const settings = isControlled ? (value as PreJoinSettings) : localSettings;
    const settingsRef = useRef(settings);

    useEffect(() => {
        settingsRef.current = settings;
    }, [settings]);

    useEffect(() => {
        if (!open) return;

        if (!isControlled) {
            try {
                const raw = localStorage.getItem("mysession_prejoin");
                if (raw) {
                    const parsed = JSON.parse(raw) as Partial<PreJoinSettings>;
                    setLocalSettings((prev) => ({ ...prev, ...parsed, ...(initial || {}) }));
                } else if (initial) {
                    setLocalSettings((prev) => ({ ...prev, ...(initial || {}) }));
                }
            } catch {
                if (initial) {
                    setLocalSettings((prev) => ({ ...prev, ...(initial || {}) }));
                }
            }
        }
    }, [open, initial, isControlled]);

    const setSettings = (
        updater: PreJoinSettings | ((prev: PreJoinSettings) => PreJoinSettings)
    ) => {
        if (isControlled) {
            onChange?.(updater as React.SetStateAction<PreJoinSettings>);
            return;
        }

        setLocalSettings((prev) =>
            typeof updater === "function"
                ? (updater as (prev: PreJoinSettings) => PreJoinSettings)(prev)
                : updater
        );
    };

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const testAudioRef = useRef<HTMLAudioElement | null>(null);
    const [videoReady, setVideoReady] = useState(false);

    const videoInputs = devices?.videoInputs || [];
    const audioInputs = devices?.audioInputs || [];
    const audioOutputs = devices?.audioOutputs || [];

    const cameras = useMemo(() => videoInputs, [videoInputs]);
    const mics = useMemo(() => audioInputs, [audioInputs]);
    const speakers = useMemo(() => audioOutputs, [audioOutputs]);

    useEffect(() => {
        if (!open) return;
        const videoEl = videoRef.current;
        if (!videoEl) return;

        setVideoReady(false);

        const cleanup = attachPreviewTrack(videoEl, previewVideoTrack);

        const onLoaded = () => {
            setVideoReady(true);
            void videoEl.play().catch(() => { });
        };

        videoEl.addEventListener("loadedmetadata", onLoaded);
        videoEl.addEventListener("canplay", onLoaded);

        return () => {
            videoEl.removeEventListener("loadedmetadata", onLoaded);
            videoEl.removeEventListener("canplay", onLoaded);
            cleanup();
        };
    }, [open, previewVideoTrack, previewVersion]);

    useEffect(() => {
        if (!open) return;

        const audioEl = testAudioRef.current;
        if (!audioEl) return;
        if (!supportsSetSinkId()) return;

        const sinkId = String(settings.audioOutputId || "").trim();
        if (!sinkId || sinkId === "default") return;

        void (audioEl as HTMLAudioElement & {
            setSinkId?: (id: string) => Promise<void>;
        })
            .setSinkId?.(sinkId)
            .catch(() => { });
    }, [open, settings.audioOutputId]);

    useEffect(() => {
        if (!open) return;

        const body = document.body;
        const prevOverflow = body.style.overflow;
        const prevPaddingRight = body.style.paddingRight;

        const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
        body.style.overflow = "hidden";
        if (scrollbarW > 0) body.style.paddingRight = `${scrollbarW}px`;

        return () => {
            body.style.overflow = prevOverflow;
            body.style.paddingRight = prevPaddingRight;
        };
    }, [open]);

    const playTestSoundFallback = async () => {
        try {
            const ctx = new (window.AudioContext ||
                (window as Window & { webkitAudioContext?: typeof AudioContext })
                    .webkitAudioContext)();

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

    const onClickJoin = () => {
        try {
            localStorage.setItem("mysession_prejoin", JSON.stringify(settingsRef.current));
        } catch {
            // ignore
        }

        onPrepareAudioGesture?.();

        if (typeof onJoin === "function") {
            (onJoin as (s: PreJoinSettings) => void)(settingsRef.current);
        }
    };

    const pillActive = "bg-emerald-500/15 border-emerald-400/30 text-white/90";
    const pillIdle = "bg-white/5 border-white/10 text-white/70 hover:bg-white/10";

    const effectiveBgUrl =
        bgImageUrl || settings.bgImageUrl || DEFAULT_BACKGROUNDS[0]?.url || "";
    const blurClass = videoFxMode === "blur" ? "blur-[10px] scale-[1.03]" : "";

    const isLight = theme === "light";

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[9999]">
            <div
                className={isLight ? "absolute inset-0 bg-black/40" : "absolute inset-0 bg-black/60"}
                onClick={onCancel}
            />

            <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-5">
                <div
                    className={`w-[92vw] max-w-[720px] max-h-[calc(100vh-24px)] sm:max-h-[calc(100vh-40px)]
            rounded-2xl border shadow-xl flex flex-col overflow-hidden ${isLight
                            ? "border-black/10 bg-white"
                            : "border-white/10 bg-[#0B1220]"
                        }`}
                    role="dialog"
                    aria-modal="true"
                >
                    <div
                        className={`flex items-center justify-between px-5 py-4 shrink-0 ${isLight ? "border-b border-black/10" : "border-b border-white/10"
                            }`}
                    >
                        <div>
                            <div className={isLight ? "font-semibold text-black/90" : "font-semibold text-white/90"}>
                                Before you join
                            </div>
                            <div className={isLight ? "text-xs text-black/50" : "text-xs text-white/50"}>
                                Pick devices + name. Then join.
                            </div>
                        </div>

                        <button
                            onClick={onCancel}
                            className={`w-9 h-9 rounded-xl flex items-center justify-center ${isLight
                                    ? "bg-black/5 hover:bg-black/10 text-black/80"
                                    : "bg-white/5 hover:bg-white/10 text-white/80"
                                }`}
                            title="Close"
                            type="button"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    <div
                        className="px-5 py-4 space-y-4 overflow-y-auto overscroll-contain"
                        style={{ WebkitOverflowScrolling: "touch" }}
                    >
                        <div
                            className={`relative rounded-2xl overflow-hidden border ${isLight ? "border-black/10 bg-black" : "border-white/10 bg-black"
                                }`}
                            style={{
                                aspectRatio: "16 / 9",
                                backgroundImage:
                                    videoFxMode === "bg" && effectiveBgUrl ? `url(${effectiveBgUrl})` : undefined,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                            }}
                        >
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                className={
                                    "absolute inset-0 w-full h-full object-cover transition-opacity duration-150 " +
                                    (settings.videoEnabled ? "opacity-100 " : "opacity-0 ") +
                                    (blurClass ? blurClass : "")
                                }
                            />

                            {settings.videoEnabled && !videoReady && (
                                <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm">
                                    Starting camera…
                                </div>
                            )}

                            {!settings.videoEnabled && (
                                <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm">
                                    Camera is off
                                </div>
                            )}

                            {!hideBackgroundFx && (
                                <div className="absolute left-3 top-3 flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void onApplyVideoFx?.("off");
                                            setSettings((prev) => ({
                                                ...prev,
                                                bgMode: "none",
                                                bgImageUrl: undefined,
                                            }));
                                        }}
                                        disabled={!!fxApplying}
                                        className={`h-8 px-3 rounded-xl border text-[12px] transition disabled:opacity-50 ${videoFxMode === "off" ? pillActive : pillIdle
                                            }`}
                                    >
                                        None
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            void onApplyVideoFx?.("blur");
                                            setSettings((prev) => ({
                                                ...prev,
                                                bgMode: "blur",
                                                bgImageUrl: undefined,
                                            }));
                                        }}
                                        disabled={!!fxApplying}
                                        className={`h-8 px-3 rounded-xl border text-[12px] transition disabled:opacity-50 ${videoFxMode === "blur" ? pillActive : pillIdle
                                            }`}
                                    >
                                        Blur
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            void onApplyVideoFx?.("bg");
                                            setSettings((prev) => ({
                                                ...prev,
                                                bgMode: "image",
                                                bgImageUrl: effectiveBgUrl,
                                            }));
                                        }}
                                        disabled={!!fxApplying}
                                        className={`h-8 px-3 rounded-xl border text-[12px] transition disabled:opacity-50 ${videoFxMode === "bg" ? pillActive : pillIdle
                                            }`}
                                    >
                                        Image
                                    </button>
                                </div>
                            )}

                            <div className="absolute left-3 bottom-3 flex items-center gap-2">
                                <button
                                    className="px-3 h-9 rounded-xl text-sm border text-white/85 bg-white/10 hover:bg-white/15 border-white/10"
                                    onClick={() =>
                                        setSettings((prev) => ({ ...prev, videoEnabled: !prev.videoEnabled }))
                                    }
                                    type="button"
                                >
                                    {settings.videoEnabled ? "Turn off camera" : "Turn on camera"}
                                </button>

                                <button
                                    className="px-3 h-9 rounded-xl text-sm border text-white/85 bg-white/10 hover:bg-white/15 border-white/10"
                                    onClick={() =>
                                        setSettings((prev) => ({ ...prev, audioEnabled: !prev.audioEnabled }))
                                    }
                                    type="button"
                                >
                                    {settings.audioEnabled ? "Mute mic" : "Unmute mic"}
                                </button>
                            </div>
                        </div>

                        {!hideBackgroundFx && videoFxMode === "bg" && (
                            <div className="space-y-2">
                                <div className={isLight ? "text-[12px] text-black/60" : "text-[12px] text-white/60"}>
                                    Choose a default
                                </div>

                                <div className="grid grid-cols-3 gap-2">
                                    {DEFAULT_BACKGROUNDS.map((bg) => {
                                        const active = effectiveBgUrl === bg.url;

                                        return (
                                            <button
                                                key={bg.id}
                                                type="button"
                                                onClick={() => {
                                                    setSettings((prev) => ({ ...prev, bgImageUrl: bg.url }));
                                                    void onApplyVideoFx?.("bg");
                                                }}
                                                className={
                                                    "rounded-xl overflow-hidden border transition text-left " +
                                                    (active
                                                        ? "border-emerald-400/40"
                                                        : isLight
                                                            ? "border-black/10 hover:border-black/25"
                                                            : "border-white/10 hover:border-white/25")
                                                }
                                            >
                                                <div className="w-full h-[70px] bg-black/20">
                                                    <img src={bg.url} alt={bg.label} className="w-full h-full object-cover" />
                                                </div>
                                                <div className={isLight ? "px-2 py-1 text-[11px] text-black/70 truncate" : "px-2 py-1 text-[11px] text-white/70 truncate"}>
                                                    {bg.label}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    <label className={`inline-flex items-center gap-2 text-sm cursor-pointer ${isLight ? "text-black/70" : "text-white/70"}`}>
                                        <span
                                            className={`px-3 h-9 rounded-xl inline-flex items-center border ${isLight
                                                    ? "bg-black/5 hover:bg-black/10 border-black/10"
                                                    : "bg-white/5 hover:bg-white/10 border-white/10"
                                                }`}
                                        >
                                            Upload
                                        </span>
                                        <input
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;

                                                if (onUploadBg) {
                                                    void onUploadBg(file);
                                                } else {
                                                    const url = URL.createObjectURL(file);
                                                    setSettings((prev) => ({ ...prev, bgImageUrl: url }));
                                                }

                                                void onApplyVideoFx?.("bg");
                                                e.currentTarget.value = "";
                                            }}
                                        />
                                    </label>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            onResetBg?.();
                                            setSettings((prev) => ({ ...prev, bgImageUrl: undefined }));
                                            void onApplyVideoFx?.("off");
                                        }}
                                        className={`h-9 px-3 rounded-xl border text-sm ${isLight
                                                ? "bg-black/5 hover:bg-black/10 border-black/10 text-black/70"
                                                : "bg-white/5 hover:bg-white/10 border-white/10 text-white/70"
                                            }`}
                                    >
                                        Reset background
                                    </button>
                                </div>
                            </div>
                        )}

                        {!hideBackgroundFx && videoFxMode === "blur" && (
                            <div className="space-y-2">
                                <div className={isLight ? "text-[12px] text-black/60" : "text-[12px] text-white/60"}>
                                    Blur strength
                                </div>
                                <input
                                    type="range"
                                    min={0}
                                    max={20}
                                    step={1}
                                    value={blurStrength}
                                    onChange={(e) => onBlurStrengthChange?.(Number(e.target.value))}
                                    className="w-full"
                                />
                            </div>
                        )}

                        {(fxError || fxStatusText) && (
                            <div className={fxError ? "text-xs text-red-400" : isLight ? "text-xs text-black/50" : "text-xs text-white/50"}>
                                {fxError || fxStatusText}
                            </div>
                        )}

                        <div className={isLight ? "text-[12px] text-black/60" : "text-[12px] text-white/60"}>
                            Display name
                        </div>
                        <input
                            value={settings.displayName}
                            onChange={(e) =>
                                setSettings((prev) => ({ ...prev, displayName: e.target.value }))
                            }
                            className={`w-full h-11 rounded-xl border px-3 text-[13px] outline-none ${isLight
                                    ? "bg-[#F8FAFC] border-black/10 text-black/85"
                                    : "bg-[#111827] border-white/10 text-white/85"
                                }`}
                        />

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <div className={isLight ? "text-[12px] text-black/60 mb-2" : "text-[12px] text-white/60 mb-2"}>
                                    Microphone
                                </div>
                                <select
                                    value={settings.audioInputId}
                                    onChange={(e) =>
                                        setSettings((prev) => ({ ...prev, audioInputId: e.target.value }))
                                    }
                                    className={`w-full h-11 rounded-xl border px-3 text-[13px] outline-none ${isLight
                                            ? "bg-[#F8FAFC] border-black/10 text-black/85"
                                            : "bg-[#111827] border-white/10 text-white/85"
                                        }`}
                                >
                                    <option value="default">Default</option>
                                    {mics.map((d) => (
                                        <option key={d.deviceId} value={d.deviceId}>
                                            {deviceLabel(d, "Mic")}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <div className={isLight ? "text-[12px] text-black/60 mb-2" : "text-[12px] text-white/60 mb-2"}>
                                    Camera
                                </div>
                                <select
                                    value={settings.videoInputId}
                                    onChange={(e) =>
                                        setSettings((prev) => ({ ...prev, videoInputId: e.target.value }))
                                    }
                                    className={`w-full h-11 rounded-xl border px-3 text-[13px] outline-none ${isLight
                                            ? "bg-[#F8FAFC] border-black/10 text-black/85"
                                            : "bg-[#111827] border-white/10 text-white/85"
                                        }`}
                                >
                                    <option value="default">Default</option>
                                    {cameras.map((d) => (
                                        <option key={d.deviceId} value={d.deviceId}>
                                            {deviceLabel(d, "Camera")}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div>
                            <div className={isLight ? "text-[12px] text-black/60 mb-2" : "text-[12px] text-white/60 mb-2"}>
                                Speaker
                            </div>
                            <select
                                value={settings.audioOutputId}
                                onChange={(e) =>
                                    setSettings((prev) => ({ ...prev, audioOutputId: e.target.value }))
                                }
                                disabled={!supportsSetSinkId()}
                                className={`w-full h-11 rounded-xl border px-3 text-[13px] outline-none disabled:opacity-60 ${isLight
                                        ? "bg-[#F8FAFC] border-black/10 text-black/85"
                                        : "bg-[#111827] border-white/10 text-white/85"
                                    }`}
                            >
                                <option value="default">Default</option>
                                {speakers
                                    .filter((d) => d.deviceId && d.deviceId !== "default")
                                    .map((d) => (
                                        <option key={d.deviceId} value={d.deviceId}>
                                            {deviceLabel(d, "Speakers")}
                                        </option>
                                    ))}
                            </select>

                            <div className="mt-2 flex items-center justify-between">
                                <button
                                    onClick={() => {
                                        onPrepareAudioGesture?.();
                                        if (onTestSpeaker) {
                                            void onTestSpeaker();
                                        } else {
                                            void playTestSoundFallback();
                                        }
                                    }}
                                    className={isLight ? "text-xs underline text-black/50" : "text-xs underline text-white/50"}
                                    type="button"
                                >
                                    Test sound
                                </button>

                                <button
                                    onClick={() => {
                                        if (onRefreshDevices) {
                                            void onRefreshDevices();
                                        }
                                    }}
                                    className={`h-9 px-3 rounded-xl border text-sm inline-flex items-center gap-2 ${isLight
                                            ? "bg-black/5 hover:bg-black/10 border-black/10 text-black/70"
                                            : "bg-white/5 hover:bg-white/10 border-white/10 text-white/70"
                                        }`}
                                    type="button"
                                >
                                    <RefreshCcw size={14} />
                                    Refresh devices
                                </button>
                            </div>
                        </div>

                        <div
                            className={`rounded-2xl border p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm ${isLight
                                    ? "border-black/10 bg-black/[0.03] text-black/70"
                                    : "border-white/10 bg-white/5 text-white/70"
                                }`}
                        >
                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={settings.audioEnabled}
                                    onChange={(e) =>
                                        setSettings((prev) => ({ ...prev, audioEnabled: e.target.checked }))
                                    }
                                />
                                Audio enabled
                            </label>

                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={settings.videoEnabled}
                                    onChange={(e) =>
                                        setSettings((prev) => ({ ...prev, videoEnabled: e.target.checked }))
                                    }
                                />
                                Video enabled
                            </label>

                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={settings.echoCancellation}
                                    onChange={(e) =>
                                        setSettings((prev) => ({
                                            ...prev,
                                            echoCancellation: e.target.checked,
                                        }))
                                    }
                                />
                                Echo cancellation
                            </label>

                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={settings.noiseSuppression}
                                    onChange={(e) =>
                                        setSettings((prev) => ({
                                            ...prev,
                                            noiseSuppression: e.target.checked,
                                        }))
                                    }
                                />
                                Noise suppression
                            </label>

                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={settings.autoGainControl}
                                    onChange={(e) =>
                                        setSettings((prev) => ({
                                            ...prev,
                                            autoGainControl: e.target.checked,
                                        }))
                                    }
                                />
                                Auto gain control
                            </label>
                        </div>

                        <div className={isLight ? "text-[11px] text-black/35" : "text-[11px] text-white/35"}>
                            Tip: allow mic/camera to see device names
                        </div>
                    </div>

                    <div
                        className={`px-5 py-4 flex items-center justify-end gap-2 shrink-0 ${isLight ? "border-t border-black/10" : "border-t border-white/10"
                            }`}
                    >
                        <button
                            onClick={onCancel}
                            className={`h-11 px-4 rounded-xl ${isLight
                                    ? "bg-black/5 hover:bg-black/10 text-black/80"
                                    : "bg-white/5 hover:bg-white/10 text-white/80"
                                }`}
                            type="button"
                        >
                            Cancel
                        </button>

                        <button
                            onClick={onClickJoin}
                            className="h-11 px-5 rounded-xl font-semibold text-[13px] bg-emerald-500 hover:bg-emerald-600 text-[#02140B]"
                            type="button"
                        >
                            Join room
                        </button>
                    </div>

                    <audio ref={testAudioRef} />
                </div>
            </div>
        </div>
    );
}

export { PreJoinModal };