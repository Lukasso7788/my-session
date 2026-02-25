import React from "react";

type RoomTheme = "dark" | "light";
type FxMode = "off" | "blur" | "bg";

function makeBgPresetDataUrl(a: string, b: string, c: string, d: string) {
    return (
        "data:image/svg+xml;utf8," +
        encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/>
      <stop offset="0.5" stop-color="${b}"/>
      <stop offset="1" stop-color="${c}"/>
    </linearGradient>
    <radialGradient id="r" cx="25%" cy="25%" r="80%">
      <stop offset="0" stop-color="${d}" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#g)"/>
  <rect width="1280" height="720" fill="url(#r)"/>
  <circle cx="1030" cy="170" r="230" fill="#ffffff" opacity="0.04"/>
  <circle cx="360" cy="520" r="310" fill="#ffffff" opacity="0.03"/>
</svg>
`)
    );
}

const FX_BG_PRESETS = [
    {
        id: "ocean",
        label: "Ocean",
        url: makeBgPresetDataUrl("#081226", "#123a76", "#031019", "#38bdf8"),
    },
    {
        id: "forest",
        label: "Forest",
        url: makeBgPresetDataUrl("#07160f", "#124b2c", "#040d08", "#22c55e"),
    },
    {
        id: "violet",
        label: "Violet",
        url: makeBgPresetDataUrl("#120a22", "#3b2378", "#090512", "#a78bfa"),
    },
    {
        id: "sunset",
        label: "Sunset",
        url: makeBgPresetDataUrl("#1c0d10", "#7c2d12", "#11070a", "#fb7185"),
    },
];

export function RoomSettingsModalLiveKit({
    open,
    theme,
    mode,
    blurStrength,
    onBlurStrengthChange,
    bgImageUrl,
    onSetBgImageUrl,
    onApplyMode,
    onClose,
    fxError,
    fxApplying,
    fxStatusText,
    onUploadBg,
    onResetBg,
}: {
    open: boolean;
    theme: RoomTheme;
    mode: FxMode;
    blurStrength: number;
    onBlurStrengthChange: (v: number) => void;
    bgImageUrl: string;
    onSetBgImageUrl: (url: string) => void;
    onApplyMode: (m: FxMode) => void | Promise<void>;
    onClose: () => void;
    fxError: string;
    fxApplying: boolean;
    fxStatusText: string;
    onUploadBg: (file: File) => void;
    onResetBg: () => void;
}) {
    if (!open) return null;

    const isLight = theme === "light";
    const overlay = "fixed inset-0 z-[1001] flex items-center justify-center px-3";
    const backdrop = "absolute inset-0 bg-black/60";
    const card = [
        "relative w-full max-w-[680px] rounded-3xl shadow-2xl overflow-hidden",
        isLight
            ? "bg-white text-black border border-black/10"
            : "bg-[#020617] text-white border border-white/10",
    ].join(" ");

    const inputWrap = isLight
        ? "bg-black/5 border border-black/10"
        : "bg-white/5 border border-white/10";
    const ghostBtn = isLight
        ? "bg-black/5 hover:bg-black/10 text-black/80"
        : "bg-white/5 hover:bg-white/10 text-white/85";
    const activeBtn = isLight ? "bg-blue-600 text-white" : "bg-emerald-500 text-[#03110a]";
    const subtleText = isLight ? "text-black/60" : "text-white/60";

    return (
        <div className={overlay} data-theme={theme} style={{ colorScheme: theme }}>
            <div className={backdrop} onClick={onClose} />
            <div className={card}>
                <div
                    className={`px-6 py-5 border-b ${isLight ? "border-black/10" : "border-white/10"}`}
                >
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <div className="font-semibold text-[16px]">Settings</div>
                            <div className={`text-[12px] mt-1 ${subtleText}`}>
                                Background blur / virtual background for your LiveKit camera.
                            </div>
                        </div>
                        <button onClick={onClose} className={`w-9 h-9 rounded-2xl ${ghostBtn}`}>
                            ✕
                        </button>
                    </div>
                </div>

                <div className="px-6 py-5 flex flex-col gap-5">
                    <div className={`rounded-2xl p-4 ${inputWrap}`}>
                        <div className="text-[13px] font-semibold mb-3">Effect mode</div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => onApplyMode("off")}
                                className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${mode === "off" ? activeBtn : ghostBtn
                                    }`}
                                disabled={fxApplying}
                            >
                                FX off
                            </button>
                            <button
                                onClick={() => onApplyMode("blur")}
                                className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${mode === "blur" ? activeBtn : ghostBtn
                                    }`}
                                disabled={fxApplying}
                            >
                                Blur
                            </button>
                            <button
                                onClick={() => onApplyMode("bg")}
                                className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${mode === "bg" ? activeBtn : ghostBtn
                                    }`}
                                disabled={fxApplying}
                            >
                                Background image
                            </button>
                        </div>

                        <div className={`mt-3 text-[12px] ${subtleText}`}>
                            {fxApplying ? "Applying effect…" : fxStatusText || "Ready"}
                        </div>
                        {fxError ? (
                            <div className="mt-2 text-[12px] text-red-500 break-words">{fxError}</div>
                        ) : null}
                    </div>

                    <div className={`rounded-2xl p-4 ${inputWrap}`}>
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-[13px] font-semibold">Blur strength</div>
                                <div className={`text-[12px] mt-1 ${subtleText}`}>
                                    Used when Blur mode is active.
                                </div>
                            </div>
                            <div className="text-[13px] font-semibold">{blurStrength}</div>
                        </div>

                        <input
                            type="range"
                            min={4}
                            max={30}
                            step={1}
                            value={blurStrength}
                            onChange={(e) => onBlurStrengthChange(Number(e.target.value))}
                            className="w-full mt-3"
                        />
                    </div>

                    <div className={`rounded-2xl p-4 ${inputWrap}`}>
                        <div className="flex items-center justify-between gap-3 mb-3">
                            <div>
                                <div className="text-[13px] font-semibold">Background presets</div>
                                <div className={`text-[12px] mt-1 ${subtleText}`}>
                                    Used when Background image mode is active.
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    onClick={onResetBg}
                                    className={`h-9 px-3 rounded-xl text-[12px] ${ghostBtn}`}
                                    disabled={fxApplying}
                                >
                                    Reset
                                </button>
                                <label
                                    className={`h-9 px-3 rounded-xl text-[12px] ${ghostBtn} cursor-pointer flex items-center`}
                                >
                                    Upload
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(e) => {
                                            const f = e.target.files?.[0];
                                            if (!f) return;
                                            onUploadBg(f);
                                            e.currentTarget.value = "";
                                        }}
                                    />
                                </label>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {FX_BG_PRESETS.map((p) => {
                                const selected = bgImageUrl === p.url;
                                return (
                                    <button
                                        key={p.id}
                                        onClick={() => onSetBgImageUrl(p.url)}
                                        className={
                                            "rounded-2xl overflow-hidden border text-left " +
                                            (selected
                                                ? isLight
                                                    ? "border-blue-500 ring-2 ring-blue-300"
                                                    : "border-emerald-400 ring-2 ring-emerald-300/25"
                                                : isLight
                                                    ? "border-black/10"
                                                    : "border-white/10")
                                        }
                                        title={p.label}
                                        disabled={fxApplying}
                                    >
                                        <div className="aspect-video w-full">
                                            <img src={p.url} alt={p.label} className="w-full h-full object-cover" />
                                        </div>
                                        <div className={`px-2 py-2 text-[12px] ${isLight ? "bg-white" : "bg-[#0b1220]"}`}>
                                            {p.label}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div
                    className={`px-6 py-4 border-t flex items-center justify-end gap-3 ${isLight ? "border-black/10" : "border-white/10"
                        }`}
                >
                    <button
                        onClick={onClose}
                        className={`h-10 px-4 rounded-xl text-[13px] font-semibold ${ghostBtn}`}
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

export default RoomSettingsModalLiveKit;