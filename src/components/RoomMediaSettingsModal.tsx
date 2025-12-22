import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

type BgMode = "none" | "blur" | "image";

export type RoomMediaSettings = {
    videoInputId: string;
    audioInputId: string;
    audioOutputId: string;
    bgMode: BgMode;
    bgImageUrl?: string; // objectURL для preview
};

type Props = {
    open: boolean;
    onClose: () => void;

    value: RoomMediaSettings;

    videoInputs: MediaDeviceInfo[];
    audioInputs: MediaDeviceInfo[];
    audioOutputs: MediaDeviceInfo[];

    onApply: (next: RoomMediaSettings) => void;
};

function deviceLabel(d: MediaDeviceInfo, fallback: string) {
    return d.label?.trim() || `${fallback} (${d.deviceId.slice(0, 6)}…)`;
}

export function RoomMediaSettingsModal({
    open,
    onClose,
    value,
    videoInputs,
    audioInputs,
    audioOutputs,
    onApply,
}: Props) {
    const [draft, setDraft] = useState<RoomMediaSettings>(value);

    // track current objectURL to revoke later
    const lastObjectUrlRef = useRef<string | null>(null);

    useEffect(() => {
        if (open) setDraft(value);
    }, [open, value]);

    // revoke objectURL on unmount
    useEffect(() => {
        return () => {
            if (lastObjectUrlRef.current) {
                URL.revokeObjectURL(lastObjectUrlRef.current);
                lastObjectUrlRef.current = null;
            }
        };
    }, []);

    const canApply = useMemo(() => {
        return !!draft.videoInputId && !!draft.audioInputId && !!draft.audioOutputId;
    }, [draft]);

    if (!open) return null;

    const setBgNone = () => {
        // if we previously created an objectURL, release it
        if (lastObjectUrlRef.current) {
            URL.revokeObjectURL(lastObjectUrlRef.current);
            lastObjectUrlRef.current = null;
        }
        setDraft((p) => ({ ...p, bgMode: "none", bgImageUrl: undefined }));
    };

    const setBgBlur = () => {
        if (lastObjectUrlRef.current) {
            URL.revokeObjectURL(lastObjectUrlRef.current);
            lastObjectUrlRef.current = null;
        }
        setDraft((p) => ({ ...p, bgMode: "blur", bgImageUrl: undefined }));
    };

    return (
        <div className="fixed inset-0 z-[60]">
            {/* overlay */}
            <div className="absolute inset-0 bg-black/60" onClick={onClose} />

            {/* modal */}
            <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#0B1220] shadow-xl">
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                    <div className="text-white/90 font-semibold">Media settings</div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/80"
                        title="Close"
                        type="button"
                    >
                        <X size={18} />
                    </button>
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
                            {videoInputs.map((d) => (
                                <option key={d.deviceId} value={d.deviceId}>
                                    {deviceLabel(d, "Camera")}
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
                            {audioInputs.map((d) => (
                                <option key={d.deviceId} value={d.deviceId}>
                                    {deviceLabel(d, "Mic")}
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
                            {audioOutputs.map((d) => (
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

                                        // revoke previous url
                                        if (lastObjectUrlRef.current) {
                                            URL.revokeObjectURL(lastObjectUrlRef.current);
                                            lastObjectUrlRef.current = null;
                                        }

                                        const url = URL.createObjectURL(file);
                                        lastObjectUrlRef.current = url;

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
                            Сейчас это влияет на <b>превью в UI</b>. “Настоящий” virtual background (чтобы видели другие)
                            добавим следующим шагом.
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
                        onClick={() => {
                            onApply(draft);
                            // если хочешь, чтобы Apply всегда закрывал модалку — оставь строку:
                            onClose();
                        }}
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
