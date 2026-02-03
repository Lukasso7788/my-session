import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, RefreshCcw } from "lucide-react";

type BgMode = "none" | "blur" | "image";

export type PreJoinSettings = {
    displayName: string;

    audioEnabled: boolean;
    videoEnabled: boolean;

    videoInputId: string;
    audioInputId: string;
    audioOutputId: string;

    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;

    bgMode: BgMode;
    bgImageUrl?: string;
};

type Props = {
    open: boolean;
    initial?: Partial<PreJoinSettings>;
    onCancel?: () => void;
    onJoin: (s: PreJoinSettings) => void;
};

const DEFAULTS: PreJoinSettings = {
    displayName: "",

    audioEnabled: true,
    videoEnabled: true,

    videoInputId: "default",
    audioInputId: "default",
    audioOutputId: "default",

    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,

    bgMode: "none",
    bgImageUrl: undefined,
};

const DEFAULT_BACKGROUNDS: { id: string; url: string; label: string }[] = [
    { id: "bg1", url: "/backgrounds/bg1.jpg", label: "Warm" },
    { id: "bg2", url: "/backgrounds/bg2.jpg", label: "Office" },
    { id: "bg3", url: "/backgrounds/bg3.jpg", label: "Soft" },
    { id: "bg4", url: "/backgrounds/bg4.jpg", label: "Mountains" },
    { id: "bg5", url: "/backgrounds/bg5.jpg", label: "Gradient" },
    { id: "bg6", url: "/backgrounds/bg6.jpg", label: "Night" },
];

function supportsSetSinkId() {
    return typeof (HTMLMediaElement.prototype as any).setSinkId === "function";
}

function deviceLabel(d: MediaDeviceInfo, fallback: string) {
    return d.label?.trim() || `${fallback} (${(d.deviceId || "").slice(0, 6)}…)`;
}

export default function PreJoinModal({ open, initial, onCancel, onJoin }: Props) {
    const [s, setS] = useState<PreJoinSettings>({ ...DEFAULTS, ...(initial || {}) });
    const sRef = useRef(s);
    useEffect(() => { sRef.current = s; }, [s]);

    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [permissionError, setPermissionError] = useState<string | null>(null);
    const [videoReady, setVideoReady] = useState(false);

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const testAudioRef = useRef<HTMLAudioElement | null>(null);

    const cameras = useMemo(() => devices.filter((d) => d.kind === "videoinput"), [devices]);
    const mics = useMemo(() => devices.filter((d) => d.kind === "audioinput"), [devices]);
    const speakers = useMemo(() => devices.filter((d) => d.kind === "audiooutput"), [devices]);

    const ensureDevices = async () => {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        const list = await navigator.mediaDevices.enumerateDevices();
        setDevices(list);
    };

    const stopStream = () => {
        try {
            streamRef.current?.getTracks().forEach((t) => t.stop());
        } catch { }
        streamRef.current = null;
        setVideoReady(false);
    };

    const getConstraints = (override?: Partial<PreJoinSettings>) => {
        const cur = { ...sRef.current, ...(override || {}) };

        const video: MediaTrackConstraints | boolean =
            cur.videoEnabled
                ? {
                    deviceId: cur.videoInputId === "default" ? undefined : { exact: cur.videoInputId },
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                }
                : false;

        const audio: MediaTrackConstraints | boolean =
            cur.audioEnabled
                ? {
                    deviceId: cur.audioInputId === "default" ? undefined : { exact: cur.audioInputId },
                    echoCancellation: cur.echoCancellation,
                    noiseSuppression: cur.noiseSuppression,
                    autoGainControl: cur.autoGainControl,
                }
                : false;

        return { video, audio };
    };

    const attachPreview = (stream: MediaStream) => {
        const v = videoRef.current;
        if (!v) return;

        setVideoReady(false);
        v.muted = true;
        (v as any).playsInline = true;

        v.onloadedmetadata = () => {
            setVideoReady(true);
            const pr = (v as any).play?.();
            pr?.catch?.(() => { });
        };

        v.srcObject = stream;

        const pr = (v as any).play?.();
        pr?.catch?.(() => { });
    };

    const startPreview = async () => {
        setPermissionError(null);
        stopStream();

        try {
            const stream = await navigator.mediaDevices.getUserMedia(getConstraints());
            streamRef.current = stream;
            attachPreview(stream);
            await ensureDevices();

            const cur = sRef.current;
            if (supportsSetSinkId() && testAudioRef.current && cur.audioOutputId && cur.audioOutputId !== "default") {
                try {
                    await (testAudioRef.current as any).setSinkId(cur.audioOutputId);
                } catch { }
            }
        } catch (e: any) {
            setPermissionError(e?.message || e?.name || "getUserMedia failed");
            stopStream();
        }
    };

    // open lifecycle
    useEffect(() => {
        if (!open) return;

        // restore saved settings if you have them
        try {
            const raw = localStorage.getItem("mysession_prejoin");
            if (raw) {
                const parsed = JSON.parse(raw);
                setS((prev) => ({ ...prev, ...parsed, ...(initial || {}) }));
            } else if (initial) {
                setS((prev) => ({ ...prev, ...(initial || {}) }));
            }
        } catch {
            if (initial) setS((prev) => ({ ...prev, ...(initial || {}) }));
        }

        ensureDevices().catch(() => { });
        startPreview().catch(() => { });

        return () => stopStream();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // restart when toggles/devices change
    useEffect(() => {
        if (!open) return;
        startPreview().catch(() => { });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        open,
        s.videoEnabled,
        s.audioEnabled,
        s.videoInputId,
        s.audioInputId,
        s.echoCancellation,
        s.noiseSuppression,
        s.autoGainControl,
    ]);

    // lock body scroll
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

    const onClickJoin = () => {
        try {
            localStorage.setItem("mysession_prejoin", JSON.stringify(s));
        } catch { }
        onJoin(s);
    };

    const playTestSound = async () => {
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = 0.08;

            osc.frequency.value = 880;
            osc.type = "sine";
            osc.connect(gain);

            const dest = ctx.createMediaStreamDestination();
            gain.connect(dest);

            const audioEl = testAudioRef.current;
            if (!audioEl) return;

            audioEl.srcObject = dest.stream;
            await audioEl.play().catch(() => { });
            osc.start();

            setTimeout(() => {
                try { osc.stop(); } catch { }
                try { ctx.close(); } catch { }
                try { (audioEl as any).srcObject = null; } catch { }
            }, 350);
        } catch { }
    };

    const refreshDevices = async () => {
        await ensureDevices();
    };

    const pillActive = "bg-emerald-500/15 border-emerald-400/30 text-white/90";
    const pillIdle = "bg-white/5 border-white/10 text-white/70 hover:bg-white/10";

    const bgUrl = s.bgImageUrl || DEFAULT_BACKGROUNDS[0]?.url;
    const blurClass = s.bgMode === "blur" ? "blur-[10px] scale-[1.03]" : "";

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[9999]">
            <div className="absolute inset-0 bg-black/60" onClick={onCancel} />

            <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-5">
                <div
                    className="w-[92vw] max-w-[640px] max-h-[calc(100vh-24px)] sm:max-h-[calc(100vh-40px)]
                     rounded-2xl border border-white/10 bg-[#0B1220] shadow-xl
                     flex flex-col overflow-hidden"
                    role="dialog"
                    aria-modal="true"
                >
                    {/* header */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
                        <div>
                            <div className="text-white/90 font-semibold">Before you join</div>
                            <div className="text-xs text-white/50">Pick devices + name. Then join.</div>
                        </div>

                        <button
                            onClick={onCancel}
                            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/80"
                            title="Close"
                            type="button"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {/* body scroll */}
                    <div className="px-5 py-4 space-y-4 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
                        {/* ✅ PREVIEW BLOCK (вот чего у тебя нет на скрине) */}
                        <div
                            className="relative rounded-2xl overflow-hidden border border-white/10 bg-black"
                            style={{
                                aspectRatio: "16 / 9",
                                backgroundImage: s.bgMode === "image" ? `url(${bgUrl})` : undefined,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                            }}
                        >
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                className={
                                    "absolute inset-0 w-full h-full object-cover transition-opacity duration-150 " +
                                    (s.videoEnabled ? "opacity-100 " : "opacity-0 ") +
                                    (blurClass ? blurClass : "")
                                }
                            />

                            {s.videoEnabled && !videoReady && (
                                <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm">
                                    Starting camera…
                                </div>
                            )}

                            {!s.videoEnabled && (
                                <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm">
                                    Camera is off
                                </div>
                            )}

                            {/* effect pills */}
                            <div className="absolute left-3 top-3 flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setS((p) => ({ ...p, bgMode: "none", bgImageUrl: undefined }))}
                                    className={`h-8 px-3 rounded-xl border text-[12px] transition ${s.bgMode === "none" ? pillActive : pillIdle}`}
                                >
                                    None
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setS((p) => ({ ...p, bgMode: "blur", bgImageUrl: undefined }))}
                                    className={`h-8 px-3 rounded-xl border text-[12px] transition ${s.bgMode === "blur" ? pillActive : pillIdle}`}
                                >
                                    Blur
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setS((p) => ({ ...p, bgMode: "image", bgImageUrl: bgUrl }))}
                                    className={`h-8 px-3 rounded-xl border text-[12px] transition ${s.bgMode === "image" ? pillActive : pillIdle}`}
                                >
                                    Image
                                </button>
                            </div>

                            {/* toggles */}
                            <div className="absolute left-3 bottom-3 flex items-center gap-2">
                                <button
                                    className="px-3 h-9 rounded-xl text-sm bg-white/10 hover:bg-white/15 border border-white/10 text-white/85"
                                    onClick={() => setS((p) => ({ ...p, videoEnabled: !p.videoEnabled }))}
                                    type="button"
                                >
                                    {s.videoEnabled ? "Turn off camera" : "Turn on camera"}
                                </button>

                                <button
                                    className="px-3 h-9 rounded-xl text-sm bg-white/10 hover:bg-white/15 border border-white/10 text-white/85"
                                    onClick={() => setS((p) => ({ ...p, audioEnabled: !p.audioEnabled }))}
                                    type="button"
                                >
                                    {s.audioEnabled ? "Mute mic" : "Unmute mic"}
                                </button>
                            </div>
                        </div>

                        {/* image picker */}
                        {s.bgMode === "image" && (
                            <div className="space-y-2">
                                <div className="text-[12px] text-white/60">Choose a default</div>
                                <div className="grid grid-cols-3 gap-2">
                                    {DEFAULT_BACKGROUNDS.map((bg) => {
                                        const active = s.bgImageUrl === bg.url;
                                        return (
                                            <button
                                                key={bg.id}
                                                type="button"
                                                onClick={() => setS((p) => ({ ...p, bgImageUrl: bg.url }))}
                                                className={
                                                    "rounded-xl overflow-hidden border transition text-left " +
                                                    (active ? "border-emerald-400/40" : "border-white/10 hover:border-white/25")
                                                }
                                            >
                                                <div className="w-full h-[70px] bg-black/20">
                                                    <img src={bg.url} alt={bg.label} className="w-full h-full object-cover" />
                                                </div>
                                                <div className="px-2 py-1 text-[11px] text-white/70 truncate">{bg.label}</div>
                                            </button>
                                        );
                                    })}
                                </div>

                                <label className="inline-flex items-center gap-2 text-sm text-white/70 cursor-pointer">
                                    <span className="px-3 h-9 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 inline-flex items-center">
                                        Upload
                                    </span>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            const url = URL.createObjectURL(file);
                                            setS((p) => ({ ...p, bgImageUrl: url }));
                                            e.currentTarget.value = "";
                                        }}
                                    />
                                </label>
                            </div>
                        )}

                        {permissionError && (
                            <div className="text-xs text-red-400">{permissionError}</div>
                        )}

                        {/* form like on your screenshot */}
                        <div className="text-[12px] text-white/60">Display name</div>
                        <input
                            value={s.displayName}
                            onChange={(e) => setS((p) => ({ ...p, displayName: e.target.value }))}
                            className="w-full h-11 rounded-xl bg-[#111827] border border-white/10 px-3 text-[13px] text-white/85 outline-none"
                        />

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <div className="text-[12px] text-white/60 mb-2">Microphone</div>
                                <select
                                    value={s.audioInputId}
                                    onChange={(e) => setS((p) => ({ ...p, audioInputId: e.target.value }))}
                                    className="w-full h-11 rounded-xl bg-[#111827] border border-white/10 px-3 text-[13px] text-white/85 outline-none"
                                >
                                    <option value="default">Default</option>
                                    {mics.map((d) => (
                                        <option key={d.deviceId} value={d.deviceId}>
                                            {deviceLabel(d, "Mic")}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <div className="text-[12px] text-white/60 mb-2">Camera</div>
                                <select
                                    value={s.videoInputId}
                                    onChange={(e) => setS((p) => ({ ...p, videoInputId: e.target.value }))}
                                    className="w-full h-11 rounded-xl bg-[#111827] border border-white/10 px-3 text-[13px] text-white/85 outline-none"
                                >
                                    <option value="default">Default</option>
                                    {cameras.map((d) => (
                                        <option key={d.deviceId} value={d.deviceId}>
                                            {deviceLabel(d, "Camera")}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div>
                            <div className="text-[12px] text-white/60 mb-2">Speaker</div>
                            <select
                                value={s.audioOutputId}
                                onChange={(e) => setS((p) => ({ ...p, audioOutputId: e.target.value }))}
                                disabled={!supportsSetSinkId()}
                                className="w-full h-11 rounded-xl bg-[#111827] border border-white/10 px-3 text-[13px] text-white/85 outline-none disabled:opacity-60"
                            >
                                <option value="default">Default</option>
                                {speakers
                                    .filter((d) => d.deviceId && d.deviceId !== "default")
                                    .map((d) => (
                                        <option key={d.deviceId} value={d.deviceId}>
                                            {deviceLabel(d, "Speakers")}
                                        </option>
                                    ))}
                            </select>

                            <div className="mt-2 flex items-center justify-between">
                                <button
                                    onClick={playTestSound}
                                    className="text-xs underline text-white/50"
                                    type="button"
                                >
                                    Test sound
                                </button>

                                <button
                                    onClick={refreshDevices}
                                    className="h-9 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 text-sm"
                                    type="button"
                                >
                                    Refresh devices
                                </button>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-white/70">
                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={s.audioEnabled} onChange={(e) => setS((p) => ({ ...p, audioEnabled: e.target.checked }))} />
                                Audio enabled
                            </label>
                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={s.videoEnabled} onChange={(e) => setS((p) => ({ ...p, videoEnabled: e.target.checked }))} />
                                Video enabled
                            </label>
                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={s.echoCancellation} onChange={(e) => setS((p) => ({ ...p, echoCancellation: e.target.checked }))} />
                                Echo cancellation
                            </label>
                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={s.noiseSuppression} onChange={(e) => setS((p) => ({ ...p, noiseSuppression: e.target.checked }))} />
                                Noise suppression
                            </label>
                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={s.autoGainControl} onChange={(e) => setS((p) => ({ ...p, autoGainControl: e.target.checked }))} />
                                Auto gain control
                            </label>
                        </div>

                        <div className="text-[11px] text-white/35">
                            Tip: allow mic/camera to see device names
                        </div>
                    </div>

                    {/* footer */}
                    <div className="px-5 py-4 border-t border-white/10 flex items-center justify-end gap-2 shrink-0">
                        <button
                            onClick={onCancel}
                            className="h-11 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-white/80"
                            type="button"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={onClickJoin}
                            className="h-11 px-5 rounded-xl font-semibold text-[13px] bg-emerald-500 hover:bg-emerald-600 text-[#02140B]"
                            type="button"
                        >
                            Join room
                        </button>
                    </div>

                    <audio ref={testAudioRef} />
                </div>
            </div>
        </div>
    );
}
