// src/pages/LiveKit/ReportParticipantModalLiveKit.tsx
import React from "react";
import { Flag, X } from "lucide-react";

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
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />

            <div
                className={`relative w-full max-w-[540px] overflow-hidden rounded-[24px] shadow-[0_20px_60px_rgba(0,0,0,0.42)] ${isLight ? "bg-[#F7F6F6] text-[#2F2F2F]" : "bg-[#1B1B1B] text-white"
                    }`}
            >
                <div className="flex items-start justify-between gap-4 px-5 py-4 sm:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${isLight ? "bg-[#E9E7E7]" : "bg-[#2F2F2F]"}`}>
                            <Flag className="h-4 w-4" strokeWidth={1.8} />
                        </div>
                        <div className="min-w-0">
                            <div className="text-[18px] font-semibold">Report participant</div>
                            <div className={`mt-0.5 truncate text-[12px] ${isLight ? "text-black/55" : "text-white/55"}`}>
                                Report <span className="font-semibold">{participantName}</span>
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition ${isLight ? "bg-[#E9E7E7] hover:bg-[#DFDDDD]" : "bg-[#292929] hover:bg-[#333333]"}`}
                        aria-label="Close report modal"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                    <textarea
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="Describe what happened..."
                        rows={6}
                        className={`w-full resize-none rounded-xl border-0 px-4 py-3 text-[14px] outline-none transition placeholder:opacity-45 focus:ring-2 ${isLight ? "bg-[#E9E7E7] text-[#2F2F2F] focus:ring-[#2F2F2F]/15" : "bg-[#292929] text-white focus:ring-white/15"
                            }`}
                    />

                    {error ? (
                        <div className="mt-2 rounded-xl bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
                            {error}
                        </div>
                    ) : null}

                    <div className="mt-4 flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={busy}
                            className={`h-10 rounded-xl px-4 text-[14px] font-semibold transition disabled:opacity-50 ${isLight ? "bg-[#E9E7E7] text-[#2F2F2F] hover:bg-[#DFDDDD]" : "bg-[#292929] text-white/85 hover:bg-[#333333]"
                                }`}
                        >
                            Cancel
                        </button>

                        <button
                            type="button"
                            onClick={onSubmit}
                            disabled={busy}
                            className="h-10 rounded-xl bg-[#2F2F2F] px-4 text-[14px] font-semibold text-white transition hover:bg-black disabled:opacity-50"
                        >
                            {busy ? "Sending..." : "Send report"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ReportParticipantModalLiveKit;