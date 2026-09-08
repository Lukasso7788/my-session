import React, {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import { ChevronUp, Settings2, Video, X } from "lucide-react";
import {
    createLocalVideoTrack,
    type LocalVideoTrack,
} from "livekit-client";

import { LiveKitBottomBar as LegacyLiveKitBottomBar } from "./LiveKitBottomBarLegacy";
import { createPersonColorBackgroundProcessor } from "./PersonColorCorrectionProcessor";

type LegacyProps = React.ComponentProps<typeof LegacyLiveKitBottomBar>;
type FxMode = "off" | "blur" | "bg";

type PendingFx = {
    mode: FxMode;
    backgroundUrl?: string;
    blurStrength: number;
};

const PREVIEW_COLOR_CORRECTION = {
    brightness: 100,
    contrast: 100,
    saturation: 100,
    warmth: 0,
};

function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("preview_file_read_failed"));
        reader.readAsDataURL(file);
    });
}

/**
 * Keeps the existing bottom bar intact while adding a private camera-preview
 * flow for people who keep their room camera off. The preview uses its own
 * unpublished LocalVideoTrack, so opening it never exposes video to the room.
 */
export function LiveKitBottomBar(props: LegacyProps) {
    const initialBlur = Number(props.blurStrength || 12);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState("");
    const [previewTrack, setPreviewTrack] = useState<LocalVideoTrack | null>(null);
    const previewTrackRef = useRef<LocalVideoTrack | null>(null);
    const previewVideoRef = useRef<HTMLVideoElement | null>(null);
    const previewPanelRef = useRef<HTMLDivElement | null>(null);

    const [draftFxMode, setDraftFxMode] = useState<FxMode>(props.videoFxMode || "off");
    const [draftBackgroundUrl, setDraftBackgroundUrl] = useState(
        String(props.selectedBackgroundUrl || ""),
    );
    const [draftBlurStrength, setDraftBlurStrength] = useState(initialBlur);

    const draftFxModeRef = useRef<FxMode>(props.videoFxMode || "off");
    const draftBackgroundUrlRef = useRef(String(props.selectedBackgroundUrl || ""));
    const draftBlurStrengthRef = useRef(initialBlur);
    const pendingFxRef = useRef<PendingFx | null>(null);

    const stopPrivatePreview = useCallback(async () => {
        const track = previewTrackRef.current;
        previewTrackRef.current = null;
        setPreviewTrack(null);

        if (!track) return;

        try {
            await (track as any).stopProcessor?.(true);
        } catch { }
        try {
            track.detach();
        } catch { }
        try {
            track.stop();
        } catch { }
    }, []);

    const applyPreviewFxToTrack = useCallback(
        async (
            track: LocalVideoTrack,
            mode: FxMode,
            backgroundUrl?: string,
            blurStrength = 12,
        ) => {
            setPreviewError("");

            try {
                if (mode === "off") {
                    await (track as any).stopProcessor?.(true);
                    return;
                }

                if (props.backgroundFxDisabled) return;

                const processor = createPersonColorBackgroundProcessor({
                    mode:
                        mode === "blur"
                            ? {
                                mode: "background-blur" as const,
                                blurRadius: Math.max(4, Math.min(30, Math.round(blurStrength))),
                            }
                            : {
                                mode: "virtual-background" as const,
                                imagePath: String(backgroundUrl || ""),
                            },
                    correction: PREVIEW_COLOR_CORRECTION,
                });

                if (mode === "bg" && !String(backgroundUrl || "").trim()) {
                    throw new Error("Choose a background first.");
                }

                await (track as any).setProcessor(processor, true);
            } catch (error) {
                console.warn("[camera-private-preview] FX preview failed", error);
                setPreviewError(
                    error instanceof Error
                        ? error.message
                        : "This browser could not preview the selected video effect.",
                );
            }
        },
        [props.backgroundFxDisabled],
    );

    useEffect(() => {
        if (!props.camOn) return;

        const nextMode = props.videoFxMode || "off";
        const nextBackground = String(props.selectedBackgroundUrl || "");
        const nextBlur = Number(props.blurStrength || 12);

        draftFxModeRef.current = nextMode;
        draftBackgroundUrlRef.current = nextBackground;
        draftBlurStrengthRef.current = nextBlur;
        setDraftFxMode(nextMode);
        setDraftBackgroundUrl(nextBackground);
        setDraftBlurStrength(nextBlur);
    }, [
        props.blurStrength,
        props.camOn,
        props.selectedBackgroundUrl,
        props.videoFxMode,
    ]);

    useEffect(() => {
        if (!previewOpen || props.camOn || !props.connected) {
            void stopPrivatePreview();
            return;
        }

        let cancelled = false;

        void (async () => {
            setPreviewLoading(true);
            setPreviewError("");
            await stopPrivatePreview();

            try {
                const track = await createLocalVideoTrack({
                    deviceId: String(props.selectedVideoInputId || "").trim() || undefined,
                    resolution: { width: 640, height: 360 },
                    frameRate: 15,
                } as any);

                if (cancelled) {
                    try {
                        track.stop();
                    } catch { }
                    return;
                }

                previewTrackRef.current = track;
                setPreviewTrack(track);

                await applyPreviewFxToTrack(
                    track,
                    draftFxModeRef.current,
                    draftBackgroundUrlRef.current || undefined,
                    draftBlurStrengthRef.current,
                );
            } catch (error) {
                if (!cancelled) {
                    console.warn("[camera-private-preview] camera preview failed", error);
                    setPreviewError(
                        error instanceof Error
                            ? error.message
                            : "Camera preview could not be started.",
                    );
                }
            } finally {
                if (!cancelled) setPreviewLoading(false);
            }
        })();

        return () => {
            cancelled = true;
            void stopPrivatePreview();
        };
    }, [
        applyPreviewFxToTrack,
        previewOpen,
        props.camOn,
        props.connected,
        props.selectedVideoInputId,
        stopPrivatePreview,
    ]);

    useEffect(() => {
        const video = previewVideoRef.current;
        if (!video || !previewTrack) return;

        video.muted = true;
        video.defaultMuted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.setAttribute("muted", "");
        video.setAttribute("playsinline", "");

        try {
            previewTrack.attach(video);
            void video.play().catch(() => { });
        } catch (error) {
            console.warn("[camera-private-preview] attach failed", error);
        }

        return () => {
            try {
                previewTrack.detach(video);
            } catch { }
        };
    }, [previewTrack]);

    useEffect(() => {
        if (!previewOpen) return;

        const onPointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!target || previewPanelRef.current?.contains(target)) return;

            const cameraControl = (target as HTMLElement)?.closest?.(
                'button[aria-label="Choose camera and background"]',
            );
            if (cameraControl) return;

            setPreviewOpen(false);
        };

        document.addEventListener("mousedown", onPointerDown);
        return () => document.removeEventListener("mousedown", onPointerDown);
    }, [previewOpen]);

    useEffect(() => {
        if (!props.camOn) return;
        const pending = pendingFxRef.current;
        if (!pending) return;
        pendingFxRef.current = null;

        void props.onApplyVideoFx?.(
            pending.mode,
            pending.backgroundUrl,
            pending.blurStrength,
        );
    }, [props.camOn, props.onApplyVideoFx]);

    useEffect(() => {
        return () => {
            void stopPrivatePreview();
        };
    }, [stopPrivatePreview]);

    const setDraftFx = useCallback(
        async (
            mode: FxMode,
            backgroundUrl?: string,
            blurOverride?: number,
        ) => {
            const nextBlur = Number(blurOverride ?? draftBlurStrengthRef.current ?? 12);
            const nextBackground =
                mode === "bg"
                    ? String(backgroundUrl || draftBackgroundUrlRef.current || "")
                    : String(backgroundUrl || draftBackgroundUrlRef.current || "");

            draftFxModeRef.current = mode;
            draftBlurStrengthRef.current = nextBlur;
            if (backgroundUrl !== undefined) {
                draftBackgroundUrlRef.current = String(backgroundUrl || "");
            }

            setDraftFxMode(mode);
            setDraftBlurStrength(nextBlur);
            if (backgroundUrl !== undefined) {
                setDraftBackgroundUrl(String(backgroundUrl || ""));
            }

            if (props.camOn) {
                await props.onApplyVideoFx?.(
                    mode,
                    mode === "bg" ? nextBackground || undefined : backgroundUrl,
                    nextBlur,
                );
                return;
            }

            if (!previewOpen) setPreviewOpen(true);
            const track = previewTrackRef.current;
            if (track) {
                await applyPreviewFxToTrack(
                    track,
                    mode,
                    mode === "bg" ? nextBackground || undefined : backgroundUrl,
                    nextBlur,
                );
            }
        },
        [applyPreviewFxToTrack, previewOpen, props.camOn, props.onApplyVideoFx],
    );

    const handleToggleCamera = useCallback(async () => {
        if (props.camOn) {
            pendingFxRef.current = null;
            setPreviewOpen(false);
            await stopPrivatePreview();
            props.onToggleCam();
            return;
        }

        pendingFxRef.current = {
            mode: draftFxModeRef.current,
            backgroundUrl:
                draftFxModeRef.current === "bg"
                    ? draftBackgroundUrlRef.current || undefined
                    : undefined,
            blurStrength: draftBlurStrengthRef.current,
        };

        setPreviewOpen(false);
        await stopPrivatePreview();
        props.onToggleCam();
    }, [props.camOn, props.onToggleCam, stopPrivatePreview]);

    const handleArrowCapture = (event: React.MouseEvent<HTMLDivElement>) => {
        if (props.camOn || !props.connected) return;

        const target = event.target as HTMLElement | null;
        const arrowButton = target?.closest?.(
            'button[aria-label="Choose camera and background"]',
        );
        if (!arrowButton) return;

        event.preventDefault();
        event.stopPropagation();
        setPreviewOpen((current) => !current);
    };

    const handleCustomBackgroundUpload = useCallback(
        async (slotId: string, file: File) => {
            if (props.camOn) {
                await props.onUploadCustomBackground?.(slotId, file);
                return;
            }

            try {
                const dataUrl = await fileToDataUrl(file);
                await setDraftFx("bg", dataUrl);
                await props.onUploadCustomBackground?.(slotId, file);
            } catch (error) {
                setPreviewError(
                    error instanceof Error
                        ? error.message
                        : "Custom background could not be previewed.",
                );
            }
        },
        [props.camOn, props.onUploadCustomBackground, setDraftFx],
    );

    const effectiveFxMode = props.camOn ? props.videoFxMode || "off" : draftFxMode;
    const effectiveBackgroundUrl = props.camOn
        ? String(props.selectedBackgroundUrl || "")
        : draftBackgroundUrl;
    const effectiveBlurStrength = props.camOn
        ? Number(props.blurStrength || 12)
        : draftBlurStrength;

    const previewSurface = props.isLight
        ? "border-[#D8D0D0] bg-[#F7F7F7] text-[#2F2F2F]"
        : "border-white/10 bg-[#222222] text-white";
    const previewSubtle = props.isLight ? "text-black/55" : "text-white/55";
    const previewChoice = (selected: boolean) =>
        selected
            ? "bg-[#2F2F2F] text-white ring-2 ring-[#5286F6]"
            : props.isLight
                ? "bg-black/[0.035] text-[#2F2F2F] hover:bg-black/[0.07]"
                : "bg-white/[0.055] text-white hover:bg-white/[0.09]";

    return (
        <div onClickCapture={handleArrowCapture}>
            <LegacyLiveKitBottomBar
                {...props}
                onToggleCam={() => {
                    void handleToggleCamera();
                }}
                videoFxMode={effectiveFxMode}
                selectedBackgroundUrl={effectiveBackgroundUrl}
                blurStrength={effectiveBlurStrength}
                onBlurStrengthChange={(strength) => {
                    const value = Number(strength || 12);
                    draftBlurStrengthRef.current = value;
                    setDraftBlurStrength(value);
                    if (props.camOn) props.onBlurStrengthChange?.(value);
                    else if (draftFxModeRef.current === "blur") {
                        void setDraftFx("blur", undefined, value);
                    }
                }}
                onApplyVideoFx={(mode, backgroundUrl, blurOverride) =>
                    setDraftFx(mode, backgroundUrl, blurOverride)
                }
                onSelectCustomBackground={async (slotId) => {
                    if (props.camOn) {
                        await props.onSelectCustomBackground?.(slotId);
                        return;
                    }
                    const slot = (props.customBackgroundSlots || []).find(
                        (item) => item.id === slotId,
                    );
                    if (slot?.dataUrl) await setDraftFx("bg", slot.dataUrl);
                }}
                onUploadCustomBackground={handleCustomBackgroundUpload}
                onClearCustomBackground={async (slotId) => {
                    const slot = (props.customBackgroundSlots || []).find(
                        (item) => item.id === slotId,
                    );
                    await props.onClearCustomBackground?.(slotId);
                    if (
                        !props.camOn &&
                        slot?.dataUrl &&
                        slot.dataUrl === draftBackgroundUrlRef.current
                    ) {
                        draftBackgroundUrlRef.current = "";
                        setDraftBackgroundUrl("");
                        await setDraftFx("off");
                    }
                }}
                onChangeVideoInput={async (deviceId) => {
                    if (!props.camOn) {
                        setPreviewError(
                            "Camera switching is locked during private preview so it cannot accidentally publish video. Turn the camera on first, or choose the device in prejoin.",
                        );
                        return;
                    }
                    await props.onChangeVideoInput?.(deviceId);
                }}
            />

            {previewOpen && !props.camOn ? (
                <div
                    ref={previewPanelRef}
                    className={`fixed bottom-[86px] left-1/2 z-[100] w-[min(94vw,430px)] -translate-x-1/2 rounded-2xl border p-3 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl ${previewSurface}`}
                    role="dialog"
                    aria-label="Private camera preview"
                >
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <div className="flex items-center gap-2 text-[13px] font-semibold">
                                <Video className="h-4 w-4" strokeWidth={2.1} />
                                <span>Camera preview</span>
                                <span className="rounded-full bg-[#65D46C]/15 px-2 py-0.5 text-[9px] font-semibold text-[#43A94B]">
                                    ONLY YOU
                                </span>
                            </div>
                            <p className={`mt-1 text-[10px] leading-4 ${previewSubtle}`}>
                                This camera track is local and unpublished. Nobody in the room can see it until you turn your camera on.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setPreviewOpen(false)}
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition ${props.isLight ? "hover:bg-black/[0.06]" : "hover:bg-white/[0.08]"}`}
                            aria-label="Close camera preview"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <div className={`relative mt-3 aspect-video overflow-hidden rounded-xl ${props.isLight ? "bg-[#EAEAEA]" : "bg-black"}`}>
                        <video
                            ref={previewVideoRef}
                            muted
                            autoPlay
                            playsInline
                            className="h-full w-full scale-x-[-1] object-cover"
                        />
                        {previewLoading ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/35 text-[11px] font-medium text-white">
                                Starting private preview…
                            </div>
                        ) : null}
                        {!previewLoading && !previewTrack && previewError ? (
                            <div className="absolute inset-0 flex items-center justify-center px-5 text-center text-[11px] leading-4 text-white bg-black/65">
                                {previewError}
                            </div>
                        ) : null}
                        <div className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/55 px-2 py-1 text-[9px] font-semibold text-white backdrop-blur">
                            NOT SHARED
                        </div>
                    </div>

                    {!props.backgroundFxDisabled && props.onApplyVideoFx ? (
                        <div className="mt-3">
                            <div className="grid grid-cols-2 gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => void setDraftFx("off")}
                                    className={`rounded-xl px-3 py-2 text-[11px] font-semibold transition ${previewChoice(draftFxMode === "off")}`}
                                >
                                    No effect
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void setDraftFx("blur", undefined, draftBlurStrength)}
                                    className={`rounded-xl px-3 py-2 text-[11px] font-semibold transition ${previewChoice(draftFxMode === "blur")}`}
                                >
                                    Blur
                                </button>
                            </div>

                            {draftFxMode === "blur" ? (
                                <div className={`mt-2 rounded-xl px-3 py-2 ${props.isLight ? "bg-black/[0.035]" : "bg-white/[0.055]"}`}>
                                    <div className="flex items-center justify-between text-[10px]">
                                        <span className={previewSubtle}>Blur strength</span>
                                        <span className="font-semibold">{draftBlurStrength}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min={4}
                                        max={30}
                                        step={1}
                                        value={draftBlurStrength}
                                        onChange={(event) => {
                                            const value = Number(event.currentTarget.value);
                                            draftBlurStrengthRef.current = value;
                                            setDraftBlurStrength(value);
                                            void setDraftFx("blur", undefined, value);
                                        }}
                                        className="mt-2 w-full accent-[#5286F6]"
                                        aria-label="Preview blur strength"
                                    />
                                </div>
                            ) : null}

                            {(props.backgroundPresets || []).length ? (
                                <div className="mt-2 grid grid-cols-3 gap-1.5">
                                    {(props.backgroundPresets || []).slice(0, 6).map((preset) => {
                                        const selected = draftFxMode === "bg" && draftBackgroundUrl === preset.url;
                                        return (
                                            <button
                                                key={preset.id}
                                                type="button"
                                                onClick={() => void setDraftFx("bg", preset.url)}
                                                className={`overflow-hidden rounded-xl text-left transition ${selected ? "ring-2 ring-[#5286F6]" : "ring-1 ring-black/10"}`}
                                                title={preset.label}
                                            >
                                                <img src={preset.url} alt="" className="aspect-[16/9] w-full object-cover" />
                                                <span className="block truncate px-2 py-1 text-[9px] font-semibold">
                                                    {preset.label}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : null}

                            {(props.customBackgroundSlots || []).some((slot) => slot.dataUrl) ? (
                                <div className="mt-2 grid grid-cols-3 gap-1.5">
                                    {(props.customBackgroundSlots || [])
                                        .filter((slot) => slot.dataUrl)
                                        .map((slot) => {
                                            const selected = draftFxMode === "bg" && draftBackgroundUrl === slot.dataUrl;
                                            return (
                                                <button
                                                    key={slot.id}
                                                    type="button"
                                                    onClick={() => void setDraftFx("bg", slot.dataUrl)}
                                                    className={`overflow-hidden rounded-xl transition ${selected ? "ring-2 ring-[#5286F6]" : "ring-1 ring-black/10"}`}
                                                    title={slot.label}
                                                >
                                                    <img src={slot.dataUrl} alt="" className="aspect-[16/9] w-full object-cover" />
                                                    <span className="block truncate px-2 py-1 text-[9px] font-semibold">
                                                        {slot.label}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {previewError && previewTrack ? (
                        <div className="mt-2 rounded-xl bg-[#F65252]/10 px-3 py-2 text-[10px] leading-4 text-[#D94444]">
                            {previewError}
                        </div>
                    ) : null}

                    <div className="mt-3 flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                setPreviewOpen(false);
                                props.onOpenSettings();
                            }}
                            className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border text-[11px] font-semibold transition ${props.isLight ? "border-[#D8D0D0] bg-white hover:bg-[#F5F5F5]" : "border-white/10 bg-white/[0.06] hover:bg-white/[0.1]"}`}
                        >
                            <Settings2 className="h-3.5 w-3.5" />
                            Full settings
                        </button>
                        <button
                            type="button"
                            disabled={!props.connected || previewLoading}
                            onClick={() => void handleToggleCamera()}
                            className="flex h-9 flex-[1.25] items-center justify-center gap-1.5 rounded-xl bg-[#2F2F2F] px-3 text-[11px] font-semibold text-white transition hover:bg-[#383838] disabled:opacity-50"
                        >
                            <Video className="h-3.5 w-3.5" />
                            Turn camera on
                        </button>
                    </div>

                    <div className={`mt-2 flex items-center justify-center gap-1 text-[9px] ${previewSubtle}`}>
                        <ChevronUp className="h-3 w-3" />
                        <span>Open this preview anytime from the arrow above the camera button.</span>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
