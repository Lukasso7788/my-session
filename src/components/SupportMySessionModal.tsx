import React from "react";
import { useNavigate } from "react-router-dom";

type Props = {
    open: boolean;
    onClose: () => void;
};

export default function SupportMySessionModal({ open, onClose }: Props) {
    const navigate = useNavigate();

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[220] flex items-center justify-center px-4">
            <div
                className="absolute inset-0 bg-black/45 backdrop-blur-sm"
                onClick={onClose}
            />

            <div className="relative w-full max-w-[460px] rounded-[28px] bg-white p-6 shadow-2xl">
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute right-5 top-5 text-gray-400 hover:text-gray-700"
                    aria-label="Close"
                >
                    ✕
                </button>

                <h2 className="pr-8 text-[24px] font-bold leading-tight text-gray-900">
                    Help keep MySession running
                </h2>

                <p className="mt-3 text-[15px] leading-6 text-gray-600">
                    MySession is maintained by Yaroslav and supported by people who use it regularly.
                </p>

                <p className="mt-3 text-[15px] leading-6 text-gray-600">
                    If this platform helps you focus, please consider subscribing. Your support helps cover hosting, video infrastructure, maintenance, and continued development.
                </p>

                <div className="mt-6 flex gap-3">
                    <button
                        type="button"
                        onClick={() => {
                            onClose();
                            navigate("/pricing");
                        }}
                        className="flex-1 rounded-2xl bg-[#2F2F2F] px-4 py-3 text-[15px] font-semibold text-white hover:bg-[#1f1f1f]"
                    >
                        Support MySession
                    </button>

                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-2xl border border-gray-200 px-4 py-3 text-[15px] font-semibold text-gray-700 hover:bg-gray-50"
                    >
                        Maybe later
                    </button>
                </div>
            </div>
        </div>
    );
}
