// src/components/RoomMediaSettingsModal.tsx
// Ключевая идея:
// - НЕ ревокать blob:, который уже "commit/applied" (даже если value ещё не успел обновиться)
// - ревокать временные blob: при закрытии без Apply
// - опционально: ревокать старый committed blob: с задержкой после смены на другой фон

import { useEffect, useMemo, useRef, useState } from "react";
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

type Props = {
    open: boolean;
    onClose: () => void;

    value: RoomMediaSettings;
    devices: DevicesLists;

    onRefreshDevices?: () => void | Promise<void>;
    onChange?: (next: RoomMediaSettings) => void;

    onApply: (next: RoomMediaSettings) => void | Promise<void>;
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
}: Props) {
    const [draft, setDraft] = useState<RoomMediaSettings>({
        videoInputId: value?.videoInputId || "",
        audioInputId: value?.audioInputId || "",
        audioOutputId: value?.audioOutputId || "default",
        bgMode: value?.bgMode || "none",
        bgImageUrl: value?.bgImageUrl,
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
    const prevCommittedObjectUrlRef = useRef<string | null>(isObjectUrl(value?.bgImageUrl) ? value.bgImageUrl! : null);
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

    // push changes to parent (optional)
    useEffect(() => {
        if (!open) return;
        onChange?.(draft);
    }, [draft, open, onChange]);

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
        return !!draft.videoInputId && !!draft.audioInputId && !!draft.audioOutputId;
    }, [draft]);

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

    const handleApply = async () => {
        // ✅ критично: считаем текущий draft.bgImageUrl "committed" СРАЗУ,
        // чтобы handleClose не ревокнул его до того, как родитель обновит value.
        committedBgUrlRef.current = draft.bgImageUrl;

        // также обновим prevCommittedObjectUrlRef, чтобы эффект с "revoke committed" не тронул свежий
        prevCommittedObjectUrlRef.current = isObjectUrl(draft.bgImageUrl) ? (draft.bgImageUrl as string) : null;

        await onApply(draft);
    };

    return (
        <div className="fixed inset-0 z-[60]">
            <div className="absolute inset-0 bg-black/60" onClick={handleClose} />

            <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#0B1220] shadow-xl">
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                    <div className="text-white/90 font-semibold">Media settings</div>

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

                <div className="px-5 py-4 space-y-4">
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
                                        // чтобы второй раз тот же файл можно было выбрать:
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

                <div className="px-5 py-4 border-t border-white/10 flex items-center justify-end gap-2">
                    <button
                        onClick={handleClose}
                        className="h-11 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-white/80"
                        type="button"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleApply}
                        disabled={!canApply}
                        className={
                            "h-11 px-5 rounded-xl font-semibold text-[13px] transition " +
                            (canApply
                                ? "bg-emerald-500 hover:bg-emerald-600 text-[#02140B]"
                                : "bg-[#111827] text-white/35 cursor-not-allowed")
                        }
                        type="button"
                    >
                        Apply
                    </button>
                </div>
            </div>
        </div>
    );
}
