// src/components/RoomMediaSettingsModal.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { X, RefreshCcw } from "lucide-react";

type BgMode = "none" | "blur" | "image";

export type RoomMediaSettings = {
    videoInputId: string;
    audioInputId: string;
    audioOutputId: string;
    bgMode: BgMode;
    bgImageUrl?: string; // objectURL для preview
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

function deviceLabel(d: MediaDeviceInfo, fallback: string) {
    return d.label?.trim() || `${fallback} (${(d.deviceId || "").slice(0, 6)}…)`;
}

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

    const prevObjectUrlRef = useRef<string | null>(null);

    useEffect(() => {
        if (open) {
            setDraft({
                videoInputId: value?.videoInputId || "",
                audioInputId: value?.audioInputId || "",
                audioOutputId: value?.audioOutputId || "default",
                bgMode: value?.bgMode || "none",
                bgImageUrl: value?.bgImageUrl,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // push changes to parent (optional)
    useEffect(() => {
        if (!open) return;
        onChange?.(draft);
    }, [draft, open, onChange]);

    // cleanup old objectURL (preview) when replaced/closed
    useEffect(() => {
        if (!open) return;

        const url = draft.bgImageUrl;
        const prev = prevObjectUrlRef.current;

        const isObjectUrl = (u?: string) => typeof u === "string" && u.startsWith("blob:");
        if (isObjectUrl(prev) && prev !== url) {
            try {
                URL.revokeObjectURL(prev);
            } catch { }
        }

        prevObjectUrlRef.current = isObjectUrl(url) ? url : null;
    }, [draft.bgImageUrl, open]);

    useEffect(() => {
        return () => {
            const prev = prevObjectUrlRef.current;
            if (prev && prev.startsWith("blob:")) {
                try {
                    URL.revokeObjectURL(prev);
                } catch { }
            }
            prevObjectUrlRef.current = null;
        };
    }, []);

    const videoInputs = devices?.videoInputs ?? [];
    const audioInputs = devices?.audioInputs ?? [];
    const audioOutputs = devices?.audioOutputs ?? [];

    // ensure defaults exist when device lists arrive
    useEffect(() => {
        if (!open) return;

        setDraft((p) => {
            let next = { ...p };

            if (!next.videoInputId && videoInputs[0]?.deviceId) next.videoInputId = videoInputs[0].deviceId;
            if (!next.audioInputId && audioInputs[0]?.deviceId) next.audioInputId = audioInputs[0].deviceId;
            if (!next.audioOutputId) next.audioOutputId = "default";

            return next;
        });
    }, [open, videoInputs, audioInputs]);

    const canApply = useMemo(() => {
        return !!draft.videoInputId && !!draft.audioInputId && !!draft.audioOutputId;
    }, [draft]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[60]">
            {/* overlay */}
            <div className="absolute inset-0 bg-black/60" onClick={onClose} />

            {/* modal */}
            <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#0B1220] shadow-xl">
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
                            onClick={onClose}
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
                            className="
                w-full h-11 rounded-xl
                bg-[#111827] border border-white/10
                px-3 text-[13px] text-white/85
                outline-none
                focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
              "
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
                            className="
                w-full h-11 rounded-xl
                bg-[#111827] border border-white/10
                px-3 text-[13px] text-white/85
                outline-none
                focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
              "
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
                            className="
                w-full h-11 rounded-xl
                bg-[#111827] border border-white/10
                px-3 text-[13px] text-white/85
                outline-none
                focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
              "
                        >
                            <option value="default">Default</option>
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

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setDraft((p) => ({ ...p, bgMode: "none", bgImageUrl: undefined }))}
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
                                onClick={() => setDraft((p) => ({ ...p, bgMode: "blur", bgImageUrl: undefined }))}
                                className={
                                    "h-10 px-3 rounded-xl border text-[13px] transition " +
                                    (draft.bgMode === "blur"
                                        ? "bg-emerald-500/15 border-emerald-400/30 text-white/90"
                                        : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10")
                                }
                            >
                                Blur
                            </button>

                            <label
                                className={
                                    "h-10 px-3 rounded-xl border text-[13px] transition cursor-pointer flex items-center " +
                                    (draft.bgMode === "image"
                                        ? "bg-emerald-500/15 border-emerald-400/30 text-white/90"
                                        : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10")
                                }
                                title="Choose background image"
                            >
                                Image
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        const url = URL.createObjectURL(file);
                                        setDraft((p) => ({ ...p, bgMode: "image", bgImageUrl: url }));
                                    }}
                                />
                            </label>
                        </div>

                        {draft.bgMode === "image" && draft.bgImageUrl && (
                            <div className="mt-3 rounded-xl overflow-hidden border border-white/10">
                                <img src={draft.bgImageUrl} className="w-full h-[140px] object-cover" alt="" />
                            </div>
                        )}

                        <div className="mt-2 text-[11px] text-white/35">
                            Сейчас это влияет на <b>превью в UI</b>. “Настоящий” virtual background (чтобы видели другие) добавим следующим шагом.
                        </div>
                    </div>
                </div>

                <div className="px-5 py-4 border-t border-white/10 flex items-center justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="h-11 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-white/80"
                        type="button"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onApply(draft)}
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
