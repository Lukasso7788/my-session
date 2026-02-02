import React, { useEffect, useMemo, useRef, useState } from "react";

export type PreJoinSettings = {
    displayName: string;

    audioEnabled: boolean;
    videoEnabled: boolean;

    videoInputId: string; // "default" or deviceId
    audioInputId: string; // "default" or deviceId
    audioOutputId: string; // "default" or deviceId

    // "Reduce" toggles (real constraints)
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;

    // Effects MVP (preview toggle; later можно сделать real outgoing processing)
    effect: "none" | "blur";
};

type Props = {
    open: boolean;
    initial?: Partial<PreJoinSettings>;
    onCancel?: () => void;
    onJoin: (s: PreJoinSettings) => void;
    theme?: "dark" | "light";
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

    effect: "none",
};

function supportsSetSinkId() {
    return typeof (HTMLMediaElement.prototype as any).setSinkId === "function";
}

export default function PreJoinModal({ open, initial, onCancel, onJoin, theme = "dark" }: Props) {
    const isLight = theme === "light";

    const [s, setS] = useState<PreJoinSettings>({ ...DEFAULTS, ...(initial || {}) });

    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [permissionError, setPermissionError] = useState<string | null>(null);

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const testAudioRef = useRef<HTMLAudioElement | null>(null);

    // mic meter
    const [micLevel, setMicLevel] = useState(0);
    const rafRef = useRef<number | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

    const cameras = useMemo(() => devices.filter((d) => d.kind === "videoinput"), [devices]);
    const mics = useMemo(() => devices.filter((d) => d.kind === "audioinput"), [devices]);
    const speakers = useMemo(() => devices.filter((d) => d.kind === "audiooutput"), [devices]);

    const modalBg = isLight ? "bg-white text-black" : "bg-[#0B1220] text-white";
    const panel = isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10";
    const subtle = isLight ? "text-black/60" : "text-white/60";
    const btn = isLight
        ? "bg-black/5 hover:bg-black/10 border border-black/10"
        : "bg-white/10 hover:bg-white/15 border border-white/10";

    // ---------- helpers ----------
    const stopStream = () => {
        try {
            streamRef.current?.getTracks().forEach((t) => t.stop());
        } catch { }
        streamRef.current = null;

        // mic meter cleanup
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;

        try { sourceRef.current?.disconnect(); } catch { }
        try { analyserRef.current?.disconnect(); } catch { }
        sourceRef.current = null;
        analyserRef.current = null;

        try { audioCtxRef.current?.close(); } catch { }
        audioCtxRef.current = null;
    };

    const attachPreview = (stream: MediaStream) => {
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        const pr = (videoRef.current as any).play?.();
        pr?.catch?.(() => { });
    };

    const setupMicMeter = (stream: MediaStream) => {
        // если audio выключен — meter не нужен
        if (!s.audioEnabled) {
            setMicLevel(0);
            return;
        }

        const audioTrack = stream.getAudioTracks()[0];
        if (!audioTrack) {
            setMicLevel(0);
            return;
        }

        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioCtxRef.current = ctx;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyserRef.current = analyser;

        const src = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
        sourceRef.current = src;

        src.connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
            analyser.getByteFrequencyData(data);
            // simple average
            let sum = 0;
            for (let i = 0; i < data.length; i++) sum += data[i];
            const avg = sum / data.length;
            setMicLevel(Math.min(1, avg / 80)); // tweak
            rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
    };

    const ensureDevices = async () => {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        const list = await navigator.mediaDevices.enumerateDevices();
        setDevices(list);
    };

    const getConstraints = () => {
        const video: MediaTrackConstraints | boolean =
            s.videoEnabled
                ? {
                    deviceId: s.videoInputId === "default" ? undefined : { exact: s.videoInputId },
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                }
                : false;

        const audio: MediaTrackConstraints | boolean =
            s.audioEnabled
                ? {
                    deviceId: s.audioInputId === "default" ? undefined : { exact: s.audioInputId },
                    echoCancellation: s.echoCancellation,
                    noiseSuppression: s.noiseSuppression,
                    autoGainControl: s.autoGainControl,
                }
                : false;

        return { video, audio };
    };

    const startPreview = async () => {
        setPermissionError(null);
        stopStream();

        try {
            const constraints = getConstraints();
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            streamRef.current = stream;

            attachPreview(stream);
            setupMicMeter(stream);

            // после выдачи разрешений появляются device labels
            await ensureDevices();

            // sink for test audio (optional)
            if (supportsSetSinkId() && testAudioRef.current && s.audioOutputId && s.audioOutputId !== "default") {
                try {
                    await (testAudioRef.current as any).setSinkId(s.audioOutputId);
                } catch { }
            }
        } catch (e: any) {
            setPermissionError(e?.message || "Permission error");
            stopStream();
        }
    };

    // ---------- lifecycle ----------
    useEffect(() => {
        if (!open) return;
        // load last settings quickly (optional pattern)
        try {
            const raw = localStorage.getItem("mysession_prejoin");
            if (raw) {
                const parsed = JSON.parse(raw);
                setS((prev) => ({ ...prev, ...parsed, ...(initial || {}) }));
            } else if (initial) {
                setS((prev) => ({ ...prev, ...(initial || {}) }));
            }
        } catch { }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    useEffect(() => {
        if (!open) return;

        // initial list (labels may be empty pre-permission)
        ensureDevices().catch(() => { });
        startPreview().catch(() => { });

        return () => stopStream();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // restart preview when device selection / toggles change
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

    // apply sinkId to test audio when output changes
    useEffect(() => {
        if (!open) return;
        if (!supportsSetSinkId()) return;
        if (!testAudioRef.current) return;

        if (!s.audioOutputId || s.audioOutputId === "default") return;

        (testAudioRef.current as any).setSinkId(s.audioOutputId).catch(() => { });
    }, [open, s.audioOutputId]);

    const onClickJoin = () => {
        // persist
        try {
            localStorage.setItem("mysession_prejoin", JSON.stringify(s));
        } catch { }

        onJoin(s);
    };

    const playTestSound = async () => {
        // quick beep using WebAudio; route through <audio> element to enable sink selection
        // We'll generate a short wav-ish via oscillator and connect to MediaStream -> <audio>.
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

    if (!open) return null;

    const effectClass = s.effect === "blur" ? "blur-[6px] scale-[1.03]" : "";

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60" onClick={onCancel} />

            <div className={`relative w-full max-w-[920px] rounded-2xl shadow-2xl ${modalBg} overflow-hidden`}>
                {/* header */}
                <div className={`flex items-center justify-between px-5 py-4 ${panel}`}>
                    <div className="flex items-center gap-3">
                        <div className="text-base font-semibold">Ready to join?</div>
                        <div className={`text-xs ${subtle}`}>Pre-join settings</div>
                    </div>

                    <button
                        onClick={onClickJoin}
                        className="px-4 h-9 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
                    >
                        Join
                    </button>
                </div>

                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* left: preview */}
                    <div className="space-y-3">
                        <div className="relative rounded-2xl overflow-hidden bg-black">
                            <video
                                ref={videoRef}
                                playsInline
                                muted
                                className={`w-full h-auto ${effectClass}`}
                                style={{ aspectRatio: "16 / 9", objectFit: "cover" }}
                            />
                            {!s.videoEnabled && (
                                <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm">
                                    Camera is off
                                </div>
                            )}

                            <div className="absolute left-3 bottom-3 flex items-center gap-2">
                                <button
                                    className={`px-3 h-9 rounded-xl text-sm ${btn}`}
                                    onClick={() => setS((p) => ({ ...p, videoEnabled: !p.videoEnabled }))}
                                >
                                    {s.videoEnabled ? "Turn off camera" : "Turn on camera"}
                                </button>
                                <button
                                    className={`px-3 h-9 rounded-xl text-sm ${btn}`}
                                    onClick={() => setS((p) => ({ ...p, audioEnabled: !p.audioEnabled }))}
                                >
                                    {s.audioEnabled ? "Mute mic" : "Unmute mic"}
                                </button>
                            </div>
                        </div>

                        {/* quick controls row */}
                        <div className={`rounded-2xl p-4 ${panel} space-y-3`}>
                            <div className="flex items-center justify-between">
                                <div className="text-sm font-semibold">Effects</div>
                                <div className="flex gap-2">
                                    <button
                                        className={`px-3 h-9 rounded-xl text-sm ${btn} ${s.effect === "none" ? "opacity-100" : "opacity-70"}`}
                                        onClick={() => setS((p) => ({ ...p, effect: "none" }))}
                                    >
                                        None
                                    </button>
                                    <button
                                        className={`px-3 h-9 rounded-xl text-sm ${btn} ${s.effect === "blur" ? "opacity-100" : "opacity-70"}`}
                                        onClick={() => setS((p) => ({ ...p, effect: "blur" }))}
                                    >
                                        Blur (MVP)
                                    </button>
                                </div>
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="text-sm font-semibold">Reduce</div>
                                <div className="flex items-center gap-3">
                                    <label className="text-xs flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={s.noiseSuppression}
                                            onChange={(e) => setS((p) => ({ ...p, noiseSuppression: e.target.checked }))}
                                        />
                                        Noise
                                    </label>
                                    <label className="text-xs flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={s.echoCancellation}
                                            onChange={(e) => setS((p) => ({ ...p, echoCancellation: e.target.checked }))}
                                        />
                                        Echo
                                    </label>
                                    <label className="text-xs flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={s.autoGainControl}
                                            onChange={(e) => setS((p) => ({ ...p, autoGainControl: e.target.checked }))}
                                        />
                                        AGC
                                    </label>
                                </div>
                            </div>

                            {/* mic meter */}
                            <div className="flex items-center justify-between gap-3">
                                <div className={`text-xs ${subtle}`}>Mic level</div>
                                <div className="flex-1 h-2 rounded-full bg-black/10 overflow-hidden">
                                    <div
                                        className="h-full bg-green-500"
                                        style={{ width: `${Math.round(micLevel * 100)}%` }}
                                    />
                                </div>
                            </div>

                            {permissionError && (
                                <div className="text-xs text-red-400">
                                    {permissionError}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* right: device selectors */}
                    <div className={`rounded-2xl p-4 ${panel} space-y-4`}>
                        <div className="space-y-2">
                            <div className="text-sm font-semibold">Name</div>
                            <input
                                value={s.displayName}
                                onChange={(e) => setS((p) => ({ ...p, displayName: e.target.value }))}
                                placeholder="Your name"
                                className={`w-full h-10 rounded-xl px-3 outline-none ${isLight ? "bg-white border border-black/10" : "bg-white/5 border border-white/10"}`}
                            />
                        </div>

                        <div className="space-y-2">
                            <div className="text-sm font-semibold">Camera</div>
                            <select
                                value={s.videoInputId}
                                onChange={(e) => setS((p) => ({ ...p, videoInputId: e.target.value }))}
                                className={`w-full h-10 rounded-xl px-3 outline-none ${isLight ? "bg-white border border-black/10" : "bg-white/5 border border-white/10"}`}
                            >
                                <option value="default">Default</option>
                                {cameras.map((d) => (
                                    <option key={d.deviceId} value={d.deviceId}>
                                        {d.label || `Camera (${d.deviceId.slice(0, 6)})`}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <div className="text-sm font-semibold">Microphone</div>
                            <select
                                value={s.audioInputId}
                                onChange={(e) => setS((p) => ({ ...p, audioInputId: e.target.value }))}
                                className={`w-full h-10 rounded-xl px-3 outline-none ${isLight ? "bg-white border border-black/10" : "bg-white/5 border border-white/10"}`}
                            >
                                <option value="default">Default</option>
                                {mics.map((d) => (
                                    <option key={d.deviceId} value={d.deviceId}>
                                        {d.label || `Mic (${d.deviceId.slice(0, 6)})`}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="text-sm font-semibold">Speakers (Output)</div>
                                <button onClick={playTestSound} className={`text-xs underline ${subtle}`}>
                                    Test sound
                                </button>
                            </div>

                            <select
                                value={s.audioOutputId}
                                onChange={(e) => setS((p) => ({ ...p, audioOutputId: e.target.value }))}
                                disabled={!supportsSetSinkId()}
                                className={`w-full h-10 rounded-xl px-3 outline-none ${isLight ? "bg-white border border-black/10" : "bg-white/5 border border-white/10"} ${!supportsSetSinkId() ? "opacity-60 cursor-not-allowed" : ""}`}
                            >
                                <option value="default">Default</option>
                                {speakers.map((d) => (
                                    <option key={d.deviceId} value={d.deviceId}>
                                        {d.label || `Speaker (${d.deviceId.slice(0, 6)})`}
                                    </option>
                                ))}
                            </select>

                            {!supportsSetSinkId() && (
                                <div className={`text-xs ${subtle}`}>
                                    Output selection not supported in this browser.
                                </div>
                            )}
                        </div>

                        <div className="pt-2 flex items-center justify-between">
                            <button onClick={onCancel} className={`px-4 h-10 rounded-xl ${btn}`}>
                                Cancel
                            </button>

                            <button
                                onClick={onClickJoin}
                                className="px-5 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                            >
                                Join
                            </button>
                        </div>

                        {/* hidden audio element used for sink routing */}
                        <audio ref={testAudioRef} />
                    </div>
                </div>
            </div>
        </div>
    );
}
