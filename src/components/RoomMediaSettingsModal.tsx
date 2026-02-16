// src/components/RoomMediaSettingsModal.tsx
// Unified modal: can act as BOTH
// - Pre-join modal (name + toggles) AND
// - In-room media settings modal (devices + background)
// Key ideas:
// - Do NOT revoke committed blob: (Apply race-safe)
// - Revoke temporary blob: on close without apply
// - Optional: revoke old committed blob: with delay after switching background
//
// ✅ FIX: modal scrolls correctly (header/footer fixed, body scrolls)
// ✅ FIX: lock body scroll while open
// ✅ NEW: optional Pre-join fields (display name + audio/video toggles + audio processing)
// ✅ NEW: live local camera preview in modal (best-effort), with background preview (blur/image)
// ✅ Backward-compatible: if you use only onApply -> works as before

import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, RefreshCcw } from "lucide-react";

type BgMode = "none" | "blur" | "image";

export type RoomMediaSettings = {
    videoInputId: string;
    audioInputId: string;
    audioOutputId: string;
    bgMode: BgMode;
    bgImageUrl?: string; // /public url | remote url | objectURL(blob:)
};

type DevicesLists = {
    videoInputs: MediaDeviceInfo[];
    audioInputs: MediaDeviceInfo[];
    audioOutputs: MediaDeviceInfo[];
};

export type RoomPrejoinExtras = {
    displayName: string;
    audioEnabled: boolean;
    videoEnabled: boolean;
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
};

type Props = {
    open: boolean;
    onClose: () => void;

    value: RoomMediaSettings;
    devices: DevicesLists;

    onRefreshDevices?: () => void | Promise<void>;
    onChange?: (next: RoomMediaSettings) => void;

    // ✅ Backward compatible: keep using onApply if you want
    onApply: (next: RoomMediaSettings) => void | Promise<void>;

    // ✅ Optional "prejoin" layer (extra fields + primary action label)
    prejoin?: {
        enabled: boolean; // if true => show prejoin fields
        value: RoomPrejoinExtras;
        onChange?: (next: RoomPrejoinExtras) => void;

        // primary action becomes "Join" (or custom) and calls this AFTER onApply succeeds
        onPrimary?: (payload: { media: RoomMediaSettings; prejoin: RoomPrejoinExtras }) => void | Promise<void>;
        primaryLabel?: string; // default "Join"
        title?: string; // default "Before you join"
        subtitle?: string; // optional
    };

    // Optional custom title/subtitle for "settings" mode
    title?: string; // default "Media settings"
    subtitle?: string;
};

const DEFAULT_BACKGROUNDS: { id: string; url: string; label: string }[] = [
    { id: "bg1", url: "/backgrounds/bg1.jpg", label: "Warm" },
    { id: "bg2", url: "/backgrounds/bg2.jpg", label: "Office" },
    { id: "bg3", url: "/backgrounds/bg3.jpg", label: "Soft" },
    { id: "bg4", url: "/backgrounds/bg4.jpg", label: "Mountains" },
    { id: "bg5", url: "/backgrounds/bg5.jpg", label: "Gradient" },
    { id: "bg6", url: "/backgrounds/bg6.jpg", label: "Night" },
];

function deviceLabel(d: MediaDeviceInfo, fallback: string) {
    return d.label?.trim() || `${fallback} (${(d.deviceId || "").slice(0, 6)}…)`;
}

const isObjectUrl = (u?: string) => typeof u === "string" && u.startsWith("blob:");

export function RoomMediaSettingsModal({
    open,
    onClose,
    value,
    devices,
    onRefreshDevices,
    onChange,
    onApply,

    prejoin,
    title,
    subtitle,
}: Props) {
    const isPrejoin = !!prejoin?.enabled;

    const [draft, setDraft] = useState<RoomMediaSettings>({
        videoInputId: value?.videoInputId || "",
        audioInputId: value?.audioInputId || "",
        audioOutputId: value?.audioOutputId || "default",
        bgMode: value?.bgMode || "none",
        bgImageUrl: value?.bgImageUrl,
    });

    const [pjDraft, setPjDraft] = useState<RoomPrejoinExtras>(() => {
        const v = prejoin?.value;
        return {
            displayName: v?.displayName || "",
            audioEnabled: v?.audioEnabled ?? true,
            videoEnabled: v?.videoEnabled ?? true,
            echoCancellation: v?.echoCancellation ?? true,
            noiseSuppression: v?.noiseSuppression ?? true,
            autoGainControl: v?.autoGainControl ?? true,
        };
    });

    const videoInputs = devices?.videoInputs ?? [];
    const audioInputs = devices?.audioInputs ?? [];
    const audioOutputs = devices?.audioOutputs ?? [];

    // ────────────────────────────────────────────────────────────────────────────
    // COMMIT TRACKING (защита от Apply→Close race)
    // ────────────────────────────────────────────────────────────────────────────

    // "закоммиченный" url (после Apply) — но мы также обновляем его СРАЗУ при клике Apply
    const committedBgUrlRef = useRef<string | undefined>(value?.bgImageUrl);

    // последний draft blob:url (временный)
    const prevDraftObjectUrlRef = useRef<string | null>(null);

    // чтобы не текли "committed blob:" навсегда — ревокаем старый committed blob с задержкой
    const prevCommittedObjectUrlRef = useRef<string | null>(
        isObjectUrl(value?.bgImageUrl) ? (value.bgImageUrl as string) : null
    );
    const revokeCommittedTimerRef = useRef<any>(null);

    // когда родитель реально обновил value.bgImageUrl — считаем это "committed"
    useEffect(() => {
        const next = value?.bgImageUrl;
        const prevCommitted = prevCommittedObjectUrlRef.current;

        committedBgUrlRef.current = next;

        // если у нас был committed blob и он сменился на другой url/undefined — ревокаем старый через задержку
        if (prevCommitted && isObjectUrl(prevCommitted) && prevCommitted !== next) {
            if (revokeCommittedTimerRef.current) clearTimeout(revokeCommittedTimerRef.current);
            revokeCommittedTimerRef.current = setTimeout(() => {
                try {
                    URL.revokeObjectURL(prevCommitted);
                } catch { }
            }, 10_000); // 10s — чтобы engine успел подхватить картинку
        }

        prevCommittedObjectUrlRef.current = isObjectUrl(next) ? (next as string) : null;
    }, [value?.bgImageUrl]);

    // cleanup таймера
    useEffect(() => {
        return () => {
            if (revokeCommittedTimerRef.current) clearTimeout(revokeCommittedTimerRef.current);
            revokeCommittedTimerRef.current = null;
        };
    }, []);

    // ────────────────────────────────────────────────────────────────────────────
    // ✅ LOCK BODY SCROLL WHILE MODAL OPEN
    // ────────────────────────────────────────────────────────────────────────────
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

    // ────────────────────────────────────────────────────────────────────────────
    // OPEN SYNC
    // ────────────────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!open) return;

        setDraft({
            videoInputId: value?.videoInputId || "",
            audioInputId: value?.audioInputId || "",
            audioOutputId: value?.audioOutputId || "default",
            bgMode: value?.bgMode || "none",
            bgImageUrl: value?.bgImageUrl,
        });

        if (isPrejoin) {
            const v = prejoin?.value;
            setPjDraft({
                displayName: v?.displayName || "",
                audioEnabled: v?.audioEnabled ?? true,
                videoEnabled: v?.videoEnabled ?? true,
                echoCancellation: v?.echoCancellation ?? true,
                noiseSuppression: v?.noiseSuppression ?? true,
                autoGainControl: v?.autoGainControl ?? true,
            });
        }

        onRefreshDevices?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // ensure defaults exist when device lists arrive
    useEffect(() => {
        if (!open) return;

        setDraft((p) => {
            const next = { ...p };
            if (!next.videoInputId && videoInputs[0]?.deviceId) next.videoInputId = videoInputs[0].deviceId;
            if (!next.audioInputId && audioInputs[0]?.deviceId) next.audioInputId = audioInputs[0].deviceId;
            if (!next.audioOutputId) next.audioOutputId = "default";
            return next;
        });
    }, [open, videoInputs, audioInputs]);

    // push media changes to parent (optional)
    useEffect(() => {
        if (!open) return;
        onChange?.(draft);
    }, [draft, open, onChange]);

    // push prejoin changes to parent (optional)
    useEffect(() => {
        if (!open) return;
        if (!isPrejoin) return;
        prejoin?.onChange?.(pjDraft);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pjDraft, open, isPrejoin]);

    // ────────────────────────────────────────────────────────────────────────────
    // DRAFT BLOB URL CLEANUP
    // Ревокаем старый draft blob:url только если он НЕ закоммичен.
    // ────────────────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!open) return;

        const next = draft.bgImageUrl;
        const prev = prevDraftObjectUrlRef.current;
        const committed = committedBgUrlRef.current;

        if (prev && isObjectUrl(prev) && prev !== next && prev !== committed) {
            try {
                URL.revokeObjectURL(prev);
            } catch { }
        }

        prevDraftObjectUrlRef.current = isObjectUrl(next) ? (next as string) : null;
    }, [draft.bgImageUrl, open]);

    const canApply = useMemo(() => {
        const baseOk = !!draft.videoInputId && !!draft.audioInputId && !!draft.audioOutputId;
        if (!baseOk) return false;

        if (isPrejoin) {
            const nm = (pjDraft.displayName || "").trim();
            // displayName required for prejoin
            return nm.length > 0;
        }
        return true;
    }, [draft, isPrejoin, pjDraft.displayName]);

    if (!open) return null;

    const setBgNone = () => setDraft((p) => ({ ...p, bgMode: "none", bgImageUrl: undefined }));
    const setBgBlur = () => setDraft((p) => ({ ...p, bgMode: "blur", bgImageUrl: undefined }));
    const setBgImage = (url: string) => setDraft((p) => ({ ...p, bgMode: "image", bgImageUrl: url }));

    const setCustomFile = (file: File) => {
        const url = URL.createObjectURL(file);
        setBgImage(url);
    };

    const handleClose = () => {
        // если есть временный blob:url, который не применён — ревокаем
        const committed = committedBgUrlRef.current;
        const cur = draft.bgImageUrl;

        if (cur && isObjectUrl(cur) && cur !== committed) {
            try {
                URL.revokeObjectURL(cur);
            } catch { }
        }

        onClose();
    };

    const handleApplyCore = async () => {
        // ✅ критично: считаем текущий draft.bgImageUrl "committed" СРАЗУ,
        // чтобы handleClose не ревокнул его до того, как родитель обновит value.
        committedBgUrlRef.current = draft.bgImageUrl;

        // также обновим prevCommittedObjectUrlRef, чтобы эффект с "revoke committed" не тронул свежий
        prevCommittedObjectUrlRef.current = isObjectUrl(draft.bgImageUrl) ? (draft.bgImageUrl as string) : null;

        await onApply(draft);
    };

    const handlePrimary = async () => {
        await handleApplyCore();
        if (isPrejoin && prejoin?.onPrimary) {
            await prejoin.onPrimary({ media: draft, prejoin: pjDraft });
        }
    };

    // ────────────────────────────────────────────────────────────────────────────
    // ✅ Local camera preview (best-effort)
    // ────────────────────────────────────────────────────────────────────────────
    const previewVideoRef = useRef<HTMLVideoElement | null>(null);
    const previewStreamRef = useRef<MediaStream | null>(null);
    const [previewErr, setPreviewErr] = useState<string>("");

    const stopPreview = () => {
        try {
            const s = previewStreamRef.current;
            if (s) s.getTracks().forEach((t) => t.stop());
        } catch { }
        previewStreamRef.current = null;

        try {
            if (previewVideoRef.current) {
                // @ts-ignore
                previewVideoRef.current.srcObject = null;
            }
        } catch { }
    };

    useEffect(() => {
        if (!open) return;

        const shouldPreview = isPrejoin ? pjDraft.videoEnabled : true;

        const start = async () => {
            stopPreview();
            setPreviewErr("");

            if (!shouldPreview) return;
            if (!navigator.mediaDevices?.getUserMedia) {
                setPreviewErr("Camera preview not supported in this browser.");
                return;
            }

            try {
                const constraints: MediaStreamConstraints = {
                    video: draft.videoInputId
                        ? { deviceId: { exact: draft.videoInputId }, width: { ideal: 1280 }, height: { ideal: 720 } }
                        : { width: { ideal: 1280 }, height: { ideal: 720 } },
                    audio: false,
                };

                const s = await navigator.mediaDevices.getUserMedia(constraints);
                previewStreamRef.current = s;

                if (previewVideoRef.current) {
                    // @ts-ignore
                    previewVideoRef.current.srcObject = s;
                    await previewVideoRef.current.play().catch(() => { });
                }
            } catch (e: any) {
                console.warn("media modal preview getUserMedia error:", e);
                setPreviewErr(e?.message ? String(e.message) : "Failed to start camera preview.");
            }
        };

        start();

        return () => stopPreview();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, draft.videoInputId, isPrejoin, pjDraft.videoEnabled]);

    // Preview styling for bg
    const previewWrapStyle: React.CSSProperties =
        draft.bgMode === "image" && draft.bgImageUrl
            ? {
                backgroundImage: `url(${draft.bgImageUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
            }
            : {};

    const previewVideoStyle: React.CSSProperties =
        draft.bgMode === "blur"
            ? { filter: "blur(8px) saturate(1.15) contrast(1.06)" }
            : {};

    const headerTitle = isPrejoin ? prejoin?.title || "Before you join" : title || "Media settings";
    const headerSubtitle = isPrejoin ? prejoin?.subtitle : subtitle;

    const primaryLabel = isPrejoin ? prejoin?.primaryLabel || "Join" : "Apply";

    return (
        <div className="fixed inset-0 z-[60]">
            {/* overlay */}
            <div className="absolute inset-0 bg-black/60" onClick={handleClose} />

            {/* wrapper */}
            <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-5">
                <div
                    className="
            w-[92vw] max-w-[720px]
            max-h-[calc(100vh-24px)]
            sm:max-h-[calc(100vh-40px)]
            rounded-2xl border border-white/10 bg-[#0B1220] shadow-xl
            flex flex-col overflow-hidden
          "
                    role="dialog"
                    aria-modal="true"
                >
                    {/* HEADER (fixed) */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
                        <div className="min-w-0">
                            <div className="text-white/90 font-semibold truncate">{headerTitle}</div>
                            {headerSubtitle ? (
                                <div className="mt-0.5 text-[12px] text-white/55 truncate">{headerSubtitle}</div>
                            ) : null}
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => onRefreshDevices?.()}
                                className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/80"
                                title="Refresh devices"
                                type="button"
                            >
                                <RefreshCcw size={16} />
                            </button>

                            <button
                                onClick={handleClose}
                                className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/80"
                                title="Close"
                                type="button"
                            >
                                <X size={18} />
                            </button>
                        </div>
                    </div>

                    {/* BODY (scrolls) */}
                    <div
                        className="px-5 py-4 space-y-4 overflow-y-auto overscroll-contain"
                        style={{ WebkitOverflowScrolling: "touch" }}
                    >
                        {/* PREVIEW */}
                        <div>
                            <div className="text-[12px] text-white/60 mb-2">Preview</div>

                            <div
                                className="relative w-full aspect-video rounded-2xl overflow-hidden border border-white/10 bg-white/5"
                                style={previewWrapStyle}
                            >
                                {/* subtle overlay so background image is visible */}
                                {draft.bgMode === "image" && draft.bgImageUrl ? (
                                    <div className="absolute inset-0 bg-black/20" />
                                ) : null}

                                <video
                                    ref={previewVideoRef}
                                    playsInline
                                    muted
                                    autoPlay
                                    className="absolute inset-0 w-full h-full object-cover"
                                    style={previewVideoStyle}
                                />

                                {/* for image mode: slight dark veil to make segmentation-like look */}
                                {draft.bgMode === "image" && draft.bgImageUrl ? (
                                    <div className="absolute inset-0 pointer-events-none bg-black/15" />
                                ) : null}

                                {isPrejoin && !pjDraft.videoEnabled ? (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="px-4 py-2 rounded-xl text-[12px] bg-black/40 text-white/80">
                                            Turn on “Video enabled” to preview.
                                        </div>
                                    </div>
                                ) : null}

                                {!!previewErr ? (
                                    <div className="absolute inset-x-0 bottom-0 p-3">
                                        <div className="text-[12px] bg-red-600 text-white px-3 py-2 rounded-xl shadow">
                                            {previewErr}
                                        </div>
                                    </div>
                                ) : null}
                            </div>

                            <div className="mt-2 text-[11px] text-white/35">
                                Preview is UI-only. On Apply/Join, background is applied to your <b>real camera stream</b> (blur / image).
                            </div>
                        </div>

                        {/* PREJOIN FIELDS */}
                        {isPrejoin ? (
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                                <div>
                                    <div className="text-[12px] text-white/60 mb-2">Display name</div>
                                    <input
                                        value={pjDraft.displayName}
                                        onChange={(e) => setPjDraft((p) => ({ ...p, displayName: e.target.value }))}
                                        placeholder="Your name…"
                                        className="w-full h-11 rounded-xl bg-[#111827] border border-white/10 px-3 text-[13px] text-white/85 outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                                    />
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <label className="flex items-center gap-2 text-[13px] text-white/80">
                                        <input
                                            type="checkbox"
                                            checked={pjDraft.audioEnabled}
                                            onChange={(e) => setPjDraft((p) => ({ ...p, audioEnabled: e.target.checked }))}
                                        />
                                        <span>Audio enabled</span>
                                    </label>

                                    <label className="flex items-center gap-2 text-[13px] text-white/80">
                                        <input
                                            type="checkbox"
                                            checked={pjDraft.videoEnabled}
                                            onChange={(e) => setPjDraft((p) => ({ ...p, videoEnabled: e.target.checked }))}
                                        />
                                        <span>Video enabled</span>
                                    </label>

                                    <label className="flex items-center gap-2 text-[13px] text-white/70">
                                        <input
                                            type="checkbox"
                                            checked={pjDraft.echoCancellation}
                                            onChange={(e) => setPjDraft((p) => ({ ...p, echoCancellation: e.target.checked }))}
                                        />
                                        <span>Echo cancellation</span>
                                    </label>

                                    <label className="flex items-center gap-2 text-[13px] text-white/70">
                                        <input
                                            type="checkbox"
                                            checked={pjDraft.noiseSuppression}
                                            onChange={(e) => setPjDraft((p) => ({ ...p, noiseSuppression: e.target.checked }))}
                                        />
                                        <span>Noise suppression</span>
                                    </label>

                                    <label className="flex items-center gap-2 text-[13px] text-white/70 sm:col-span-2">
                                        <input
                                            type="checkbox"
                                            checked={pjDraft.autoGainControl}
                                            onChange={(e) => setPjDraft((p) => ({ ...p, autoGainControl: e.target.checked }))}
                                        />
                                        <span>Auto gain control</span>
                                    </label>
                                </div>
                            </div>
                        ) : null}

                        {/* Camera */}
                        <div>
                            <div className="text-[12px] text-white/60 mb-2">Camera</div>
                            <select
                                value={draft.videoInputId}
                                onChange={(e) => setDraft((p) => ({ ...p, videoInputId: e.target.value }))}
                                className="w-full h-11 rounded-xl bg-[#111827] border border-white/10 px-3 text-[13px] text-white/85 outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                            >
                                {(videoInputs.length ? videoInputs : [{ deviceId: "", label: "" } as any]).map((d) => (
                                    <option key={d.deviceId || "none"} value={d.deviceId || ""}>
                                        {d.deviceId ? deviceLabel(d, "Camera") : "No camera devices"}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Microphone */}
                        <div>
                            <div className="text-[12px] text-white/60 mb-2">Microphone</div>
                            <select
                                value={draft.audioInputId}
                                onChange={(e) => setDraft((p) => ({ ...p, audioInputId: e.target.value }))}
                                className="w-full h-11 rounded-xl bg-[#111827] border border-white/10 px-3 text-[13px] text-white/85 outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                            >
                                {(audioInputs.length ? audioInputs : [{ deviceId: "", label: "" } as any]).map((d) => (
                                    <option key={d.deviceId || "none"} value={d.deviceId || ""}>
                                        {d.deviceId ? deviceLabel(d, "Mic") : "No microphone devices"}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Speakers */}
                        <div>
                            <div className="text-[12px] text-white/60 mb-2">Speakers</div>
                            <select
                                value={draft.audioOutputId}
                                onChange={(e) => setDraft((p) => ({ ...p, audioOutputId: e.target.value }))}
                                className="w-full h-11 rounded-xl bg-[#111827] border border-white/10 px-3 text-[13px] text-white/85 outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                            >
                                <option value="default">System default</option>
                                {audioOutputs
                                    .filter((d) => d.deviceId && d.deviceId !== "default")
                                    .map((d) => (
                                        <option key={d.deviceId} value={d.deviceId}>
                                            {deviceLabel(d, "Speakers")}
                                        </option>
                                    ))}
                            </select>
                        </div>

                        {/* Background */}
                        <div>
                            <div className="text-[12px] text-white/60 mb-2">Background</div>

                            <div className="flex items-center gap-2 flex-wrap">
                                <button
                                    type="button"
                                    onClick={setBgNone}
                                    className={
                                        "h-10 px-3 rounded-xl border text-[13px] transition " +
                                        (draft.bgMode === "none"
                                            ? "bg-emerald-500/15 border-emerald-400/30 text-white/90"
                                            : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10")
                                    }
                                >
                                    None
                                </button>

                                <button
                                    type="button"
                                    onClick={setBgBlur}
                                    className={
                                        "h-10 px-3 rounded-xl border text-[13px] transition " +
                                        (draft.bgMode === "blur"
                                            ? "bg-emerald-500/15 border-emerald-400/30 text-white/90"
                                            : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10")
                                    }
                                >
                                    Blur
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        const url = draft.bgImageUrl || DEFAULT_BACKGROUNDS[0]?.url;
                                        if (url) setBgImage(url);
                                    }}
                                    className={
                                        "h-10 px-3 rounded-xl border text-[13px] transition " +
                                        (draft.bgMode === "image"
                                            ? "bg-emerald-500/15 border-emerald-400/30 text-white/90"
                                            : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10")
                                    }
                                >
                                    Image
                                </button>

                                <label
                                    className="h-10 px-3 rounded-xl border text-[13px] transition cursor-pointer flex items-center bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                                    title="Upload custom background"
                                >
                                    Upload
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            setCustomFile(file);
                                            e.currentTarget.value = "";
                                        }}
                                    />
                                </label>
                            </div>

                            {draft.bgMode === "image" && (
                                <div className="mt-3">
                                    <div className="text-[11px] text-white/45 mb-2">Choose a default</div>

                                    <div className="grid grid-cols-3 gap-2">
                                        {DEFAULT_BACKGROUNDS.map((bg) => {
                                            const active = draft.bgImageUrl === bg.url;
                                            return (
                                                <button
                                                    key={bg.id}
                                                    type="button"
                                                    onClick={() => setBgImage(bg.url)}
                                                    className={
                                                        "rounded-xl overflow-hidden border transition text-left " +
                                                        (active ? "border-emerald-400/40" : "border-white/10 hover:border-white/25")
                                                    }
                                                    title={bg.label}
                                                >
                                                    <div className="w-full h-[78px] bg-black/20">
                                                        <img src={bg.url} alt={bg.label} className="w-full h-full object-cover" />
                                                    </div>
                                                    <div className="px-2 py-1 text-[11px] text-white/70 truncate">{bg.label}</div>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {draft.bgImageUrl && (
                                        <div className="mt-3 rounded-xl overflow-hidden border border-white/10">
                                            <img src={draft.bgImageUrl} className="w-full h-[150px] object-cover" alt="" />
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="mt-2 text-[11px] text-white/35">
                                Background is applied to your <b>real camera stream</b> (blur / image).
                            </div>
                        </div>
                    </div>

                    {/* FOOTER (fixed) */}
                    <div className="px-5 py-4 border-t border-white/10 flex items-center justify-end gap-2 shrink-0">
                        <button
                            onClick={handleClose}
                            className="h-11 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-white/80"
                            type="button"
                        >
                            Cancel
                        </button>

                        <button
                            onClick={isPrejoin ? handlePrimary : handleApplyCore}
                            disabled={!canApply}
                            className={
                                "h-11 px-5 rounded-xl font-semibold text-[13px] transition " +
                                (canApply
                                    ? "bg-emerald-500 hover:bg-emerald-600 text-[#02140B]"
                                    : "bg-[#111827] text-white/35 cursor-not-allowed")
                            }
                            type="button"
                        >
                            {primaryLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
