import React from "react";
import { useNavigate } from "react-router-dom";

type PaywallModalProps = {
    open: boolean;
    onClose: () => void;
    title?: string;
    description?: string;
};

export default function PaywallModal({
    open,
    onClose,
    title = "Upgrade to continue",
    description = "You’ve used your 15 free sessions. Upgrade to Pro for unlimited sessions and hosting.",
}: PaywallModalProps) {
    const navigate = useNavigate();

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 px-4">
            <div className="w-full max-w-[480px] rounded-[28px] border border-black/10 bg-white p-6 shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
                <div className="text-[22px] font-semibold tracking-[-0.02em] text-[#2F2F2F]">
                    {title}
                </div>

                <p className="mt-3 text-[15px] leading-7 text-black/65">{description}</p>

                <div className="mt-6 rounded-2xl border border-black/10 bg-black/[0.03] p-4 text-sm text-black/65">
                    Free includes your first 15 sessions. Pro unlocks unlimited joining and hosting.
                </div>

                <div className="mt-6 flex flex-wrap gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-2xl border border-black/10 bg-white px-5 py-3 text-sm font-medium text-[#2F2F2F] transition hover:bg-black/[0.03]"
                    >
                        Not now
                    </button>

                    <button
                        type="button"
                        onClick={() => navigate("/pricing")}
                        className="rounded-2xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
                    >
                        Upgrade plan
                    </button>
                </div>
            </div>
        </div>
    );
}
