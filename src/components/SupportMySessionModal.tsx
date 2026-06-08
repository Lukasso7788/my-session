import React from "react";
import { useNavigate } from "react-router-dom";

type Props = {
    open: boolean;
    onClose: () => void;
};

function CoinIcon() {
    return (
        <svg viewBox="0 0 64 64" className="h-12 w-12" fill="none" aria-hidden="true">
            <circle cx="32" cy="32" r="28" fill="#FDE68A" />
            <circle cx="32" cy="32" r="21" fill="#FBBF24" />
            <path d="M32 18v28M24 25.5c0-4 3.8-6.5 8.5-6.5 4 0 7 1.7 8.2 4.8M40.5 38.2c0 4.1-3.7 6.8-8.7 6.8-4.7 0-8.2-2.1-9.3-5.8" stroke="#2F2F2F" strokeWidth="4" strokeLinecap="round" />
        </svg>
    );
}

function StripeIcon() {
    return (
        <svg viewBox="0 0 64 64" className="h-5 w-5" fill="none" aria-hidden="true">
            <rect width="64" height="64" rx="18" fill="#635BFF" />
            <path d="M36.9 29.2c-4.3-1.6-6.2-2.8-6.2-4.7 0-1.6 1.4-2.7 4.1-2.7 3.1 0 6.3 1.2 8.4 2.2v-7.8c-1.9-.8-4.8-1.7-8.5-1.7-8.4 0-13.5 4.4-13.5 10.6 0 5.2 3.8 8.2 10.1 10.5 4 1.4 5.4 2.5 5.4 4.4 0 1.8-1.5 2.9-4.5 2.9-3.4 0-7.2-1.4-9.7-3v8c2.3 1.2 5.7 2.2 9.8 2.2 8.6 0 14-4.2 14-10.8 0-5-3-7.9-9.4-10.1Z" fill="white" />
        </svg>
    );
}

function UpiIcon() {
    return (
        <svg viewBox="0 0 64 64" className="h-5 w-5" fill="none" aria-hidden="true">
            <rect width="64" height="64" rx="18" fill="#ECFDF5" />
            <path d="M23 14l12 18-12 18h9l12-18-12-18h-9Z" fill="#22C55E" />
            <path d="M34 14l12 18-12 18h7l12-18-12-18h-7Z" fill="#F97316" />
        </svg>
    );
}

export default function SupportMySessionModal({ open, onClose }: Props) {
    const navigate = useNavigate();

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[220] flex items-center justify-center px-4">
            <div
                className="absolute inset-0 bg-black/45 backdrop-blur-sm"
                onClick={onClose}
            />

            <div className="relative w-full max-w-[500px] rounded-[30px] bg-white p-6 shadow-2xl">
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute right-5 top-5 text-gray-400 hover:text-gray-700"
                    aria-label="Close"
                >
                    ✕
                </button>

                <div className="flex items-start gap-4 pr-8">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-yellow-50">
                        <CoinIcon />
                    </div>

                    <div>
                        <h2 className="text-[24px] font-bold leading-tight text-gray-900">
                            Support MySession
                        </h2>

                        <p className="mt-2 text-[15px] leading-6 text-gray-600">
                            MySession is a small independent focus platform. Your support helps cover video infrastructure, hosting, maintenance, and continued development.
                        </p>
                    </div>
                </div>

                <div className="mt-6 rounded-3xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-[13px] font-bold uppercase tracking-[0.12em] text-gray-500">
                        Choose payment option
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <button
                            type="button"
                            onClick={() => {
                                onClose();
                                navigate("/pricing");
                            }}
                            className="flex items-center justify-center gap-2 rounded-2xl bg-[#2F2F2F] px-4 py-3 text-[15px] font-semibold text-white hover:bg-[#1f1f1f]"
                        >
                            <StripeIcon />
                            Card / Stripe
                        </button>

                        <button
                            type="button"
                            onClick={() => {
                                onClose();
                                navigate("/pricing?payment=india_upi");
                            }}
                            className="flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] font-semibold text-gray-800 hover:bg-gray-50"
                        >
                            <UpiIcon />
                            India / UPI
                        </button>
                    </div>
                </div>

                <p className="mt-4 text-[13px] leading-5 text-gray-500">
                    Payments are optional right now, but supporting helps MySession stay reliable while the community grows.
                </p>

                <div className="mt-5 flex justify-end">
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