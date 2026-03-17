// src/pages/LiveKit/ReportParticipantModalLiveKit.tsx
import React from "react";

type RoomTheme = "dark" | "light";

export function ReportParticipantModalLiveKit(props: {
    open: boolean;
    theme: RoomTheme;
    participantName: string;
    value: string;
    busy: boolean;
    error: string;
    onChange: (v: string) => void;
    onClose: () => void;
    onSubmit: () => void;
}) {
    const { open, theme, participantName, value, busy, error, onChange, onClose, onSubmit } = props;
    const isLight = theme === "light";

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[95] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />

            <div
                className={`relative w-[92%] max-w-[560px] rounded-2xl border shadow-2xl p-5 ${isLight ? "bg-white border-black/10 text-black/85" : "bg-[#020617] border-white/10 text-white/90"
                    }`}
            >
                <div className="text-[18px] font-semibold">Report participant</div>
                <div className={`mt-1 text-[13px] ${isLight ? "text-black/60" : "text-white/65"}`}>
                    Report: <span className="font-semibold">{participantName}</span>
                </div>

                <textarea
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder="Describe what happened..."
                    rows={6}
                    className={`mt-4 w-full rounded-xl px-3 py-3 outline-none border resize-none ${isLight ? "bg-white border-black/10 text-black/85" : "bg-black/20 border-white/10 text-white/90"
                        }`}
                />

                {error ? (
                    <div className={`mt-2 text-[12px] ${isLight ? "text-red-600" : "text-red-300"}`}>
                        {error}
                    </div>
                ) : null}

                <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className={`px-4 h-10 rounded-xl font-semibold ${isLight ? "bg-black/5 hover:bg-black/10 text-black/75" : "bg-white/5 hover:bg-white/10 text-white/85"
                            }`}
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        onClick={onSubmit}
                        disabled={busy}
                        className={`px-4 h-10 rounded-xl font-semibold ${isLight ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-emerald-500 hover:bg-emerald-600 text-[#02140B]"
                            }`}
                    >
                        {busy ? "Sending..." : "Send report"}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ReportParticipantModalLiveKit;