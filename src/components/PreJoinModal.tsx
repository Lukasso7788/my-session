import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, RefreshCcw } from "lucide-react";

type BgMode = "none" | "blur" | "image";

export type PreJoinSettings = {
    displayName: string;

    audioEnabled: boolean;
    videoEnabled: boolean;

    videoInputId: string; // "default" or deviceId
    audioInputId: string; // "default" or deviceId
    audioOutputId: string; // "default" or deviceId

    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;

    bgMode: BgMode;
    bgImageUrl?: string; // /public url | remote url | objectURL(blob:)
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

const isObjectUrl = (u?: string) => typeof u === "string" && u.startsWith("blob:");

function supportsSetSinkId() {
    return typeof (HTMLMediaElement.prototype as any).setSinkId === "function";
}

function deviceLabel(d: MediaDeviceInfo, fallback: string) {
    return d.label?.trim() || `${fallback} (${(d.deviceId || "").slice(0, 6)}…)`;
}

function isConstraintDeviceError(e: any) {
    const name = e?.name || "";
    return (
        name === "OverconstrainedError" ||
        name === "NotFoundError" ||
        name === "DevicesNotFoundError"
    );
}

export default function PreJoinModal({ open, initial, onCancel, onJoin, theme = "dark" }: Props) {
    const isLight = theme === "light";

    const [s, setS] = useState<PreJoinSettings>({ ...DEFAULTS, ...(initial || {}) });
    const sRef = useRef(s);
    useEffect(() => { sRef.current = s; }, [s]);

    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [permissionError, setPermissionError] = useState<string | null>(null);
    const [videoReady, setVideoReady] = useState(false);

    const videoRef = useRef<HTMLVideoElement | null>(null);   // raw camera
    const canvasRef = useRef<HTMLCanvasElement | null>(null); // processed overlay
    const streamRef = useRef<MediaStream | null>(null);

    const testAudioRef = useRef<HTMLAudioElement | null>(null);

    // mic meter
    const [micLevel, setMicLevel] = useState(0);
    const rafMeterRef = useRef<number | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

    // objectURL cleanup
    const committedBgUrlRef = useRef<string | undefined>(undefined);
    const prevDraftObjectUrlRef = useRef<string | null>(null);

    // segmentation pipeline
    const segRef = useRef<any>(null);
    const segReadyRef = useRef(false);
    const segFailRef = useRef(false);
    const segLoopRafRef = useRef<number | null>(null);
    const segInFlightRef = useRef(false);

    const personCanvasRef = useRef<HTMLCanvasElement | null>(null); // offscreen person
    const bgImgRef = useRef<HTMLImageElement | null>(null);
    const [segStatus, setSegStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");

    const cameras = useMemo(() => devices.filter((d) => d.kind === "videoinput"), [devices]);
    const mics = useMemo(() => devices.filter((d) => d.kind === "audioinput"), [devices]);
    const speakers = useMemo(() => devices.filter((d) => d.kind === "audiooutput"), [devices]);

    const modalBg = isLight ? "bg-white text-black" : "bg-[#0B1220] text-white";
    const panel = isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10";
    const subtle = isLight ? "text-black/60" : "text-white/60";
    const btn = isLight
        ? "bg-black/5 hover:bg-black/10 border border-black/10"
        : "bg-white/10 hover:bg-white/15 border border-white/10";

    // -------------------- media helpers --------------------
    const stopStream = () => {
        try {
            streamRef.current?.getTracks().forEach((t) => t.stop());
        } catch { }
        streamRef.current = null;

        if (rafMeterRef.current) cancelAnimationFrame(rafMeterRef.current);
        rafMeterRef.current = null;

        try { sourceRef.current?.disconnect(); } catch { }
        try { analyserRef.current?.disconnect(); } catch { }
        sourceRef.current = null;
        analyserRef.current = null;

        try { audioCtxRef.current?.close(); } catch { }
        audioCtxRef.current = null;

        setMicLevel(0);
        setVideoReady(false);
    };

    const attachPreview = (stream: MediaStream) => {
        const v = videoRef.current;
        if (!v) return;

        v.muted = true;
        (v as any).playsInline = true;

        setVideoReady(false);

        v.onloadedmetadata = () => {
            setVideoReady(true);
            const pr = (v as any).play?.();
            pr?.catch?.(() => { });
        };

        v.srcObject = stream;

        // на некоторых браузерах onloadedmetadata не стреляет быстро — пытаемся play сразу тоже
        const pr = (v as any).play?.();
        pr?.catch?.(() => { });
    };

    const setupMicMeter = (stream: MediaStream) => {
        const cur = sRef.current;
        if (!cur.audioEnabled) {
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
            let sum = 0;
            for (let i = 0; i < data.length; i++) sum += data[i];
            const avg = sum / data.length;
            setMicLevel(Math.min(1, avg / 80));
            rafMeterRef.current = requestAnimationFrame(tick);
        };

        rafMeterRef.current = requestAnimationFrame(tick);
    };

    const ensureDevices = async () => {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        const list = await navigator.mediaDevices.enumerateDevices();
        setDevices(list);
    };

    const buildConstraints = (override?: Partial<PreJoinSettings>) => {
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

    const startPreview = async () => {
        setPermissionError(null);
        stopStream();

        // 1) пробуем как выбрано
        try {
            const stream = await navigator.mediaDevices.getUserMedia(buildConstraints());
            streamRef.current = stream;

            attachPreview(stream);
            setupMicMeter(stream);
            await ensureDevices();

            // sink for test sound
            const cur = sRef.current;
            if (supportsSetSinkId() && testAudioRef.current && cur.audioOutputId && cur.audioOutputId !== "default") {
                try {
                    await (testAudioRef.current as any).setSinkId(cur.audioOutputId);
                } catch { }
            }

            return;
        } catch (e: any) {
            // 2) если deviceId битый — откатываемся на default и пробуем ещё раз
            if (isConstraintDeviceError(e)) {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia(buildConstraints({
                        videoInputId: "default",
                        audioInputId: "default",
                    }));
                    streamRef.current = stream;

                    // обновим UI чтобы соответствовал факту
                    setS((p) => ({ ...p, videoInputId: "default", audioInputId: "default" }));

                    attachPreview(stream);
                    setupMicMeter(stream);
                    await ensureDevices();
                    return;
                } catch (e2: any) {
                    setPermissionError(e2?.message || e2?.name || "getUserMedia failed");
                    stopStream();
                    return;
                }
            }

            setPermissionError(e?.message || e?.name || "getUserMedia failed");
            stopStream();
        }
    };

    // -------------------- blob url cleanup --------------------
    useEffect(() => {
        if (!open) return;

        const next = s.bgImageUrl;
        const prev = prevDraftObjectUrlRef.current;
        const committed = committedBgUrlRef.current;

        if (prev && isObjectUrl(prev) && prev !== next && prev !== committed) {
            try { URL.revokeObjectURL(prev); } catch { }
        }

        prevDraftObjectUrlRef.current = isObjectUrl(next) ? (next as string) : null;
    }, [open, s.bgImageUrl]);

    const revokeCurrentBgIfNotCommitted = () => {
        const committed = committedBgUrlRef.current;
        const cur = s.bgImageUrl;

        if (cur && isObjectUrl(cur) && cur !== committed) {
            try { URL.revokeObjectURL(cur); } catch { }
        }
    };

    // -------------------- segmentation (virtual background) --------------------
    const ensureOffscreenCanvases = (w: number, h: number) => {
        if (!personCanvasRef.current) personCanvasRef.current = document.createElement("canvas");
        const pc = personCanvasRef.current!;
        if (pc.width !== w) pc.width = w;
        if (pc.height !== h) pc.height = h;

        const out = canvasRef.current;
        if (out && (out.width !== w || out.height !== h)) {
            out.width = w;
            out.height = h;
        }
    };

    const ensureBgImage = (url?: string) => {
        if (!url) {
            bgImgRef.current = null;
            return;
        }
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = url;
        bgImgRef.current = img;
    };

    const initSegmentationIfNeeded = async () => {
        if (segReadyRef.current || segFailRef.current) return;

        setSegStatus("loading");
        try {
            const mod: any = await import("@mediapipe/selfie_segmentation");
            const SelfieSegmentation = mod.SelfieSegmentation;

            const seg = new SelfieSegmentation({
                locateFile: (file: string) =>
                    `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
            });

            seg.setOptions({ modelSelection: 1 });

            seg.onResults((results: any) => {
                const cur = sRef.current;

                const v = videoRef.current;
                const out = canvasRef.current;
                if (!v || !out) return;

                const w = v.videoWidth || 1280;
                const h = v.videoHeight || 720;

                ensureOffscreenCanvases(w, h);

                const ctx = out.getContext("2d");
                if (!ctx) return;

                const mask = results.segmentationMask;

                // если эффекты отключены — чистим overlay
                if (cur.bgMode === "none") {
                    ctx.clearRect(0, 0, w, h);
                    return;
                }

                const pc = personCanvasRef.current!;
                const pctx = pc.getContext("2d");
                if (!pctx) return;

                // person layer
                pctx.clearRect(0, 0, w, h);
                pctx.globalCompositeOperation = "source-over";
                pctx.filter = "none";
                pctx.drawImage(results.image, 0, 0, w, h);
                pctx.globalCompositeOperation = "destination-in";
                pctx.drawImage(mask, 0, 0, w, h);
                pctx.globalCompositeOperation = "source-over";

                // compose output
                ctx.clearRect(0, 0, w, h);

                if (cur.bgMode === "blur") {
                    ctx.save();
                    ctx.filter = "blur(12px)";
                    ctx.drawImage(results.image, 0, 0, w, h);
                    ctx.restore();

                    ctx.save();
                    ctx.globalCompositeOperation = "destination-out";
                    ctx.drawImage(mask, 0, 0, w, h);
                    ctx.restore();

                    ctx.drawImage(pc, 0, 0, w, h);
                    return;
                }

                if (cur.bgMode === "image") {
                    const bg = bgImgRef.current;

                    if (bg && bg.complete && bg.naturalWidth > 0) {
                        const iw = bg.naturalWidth;
                        const ih = bg.naturalHeight;
                        const scale = Math.max(w / iw, h / ih);
                        const dw = iw * scale;
                        const dh = ih * scale;
                        const dx = (w - dw) / 2;
                        const dy = (h - dh) / 2;
                        ctx.drawImage(bg, dx, dy, dw, dh);
                    } else {
                        ctx.fillStyle = "#0B1220";
                        ctx.fillRect(0, 0, w, h);
                    }

                    ctx.drawImage(pc, 0, 0, w, h);
                    return;
                }
            });

            segRef.current = seg;
            segReadyRef.current = true;
            setSegStatus("ready");
        } catch (e) {
            console.warn("SelfieSegmentation init failed", e);
            segFailRef.current = true;
            setSegStatus("failed");
        }
    };

    const startSegLoop = () => {
        if (segLoopRafRef.current) cancelAnimationFrame(segLoopRafRef.current);
        segLoopRafRef.current = null;

        const tick = async () => {
            if (!open) return;

            const cur = sRef.current;

            const v = videoRef.current;
            const seg = segRef.current;

            if (!v || !seg || !segReadyRef.current) {
                segLoopRafRef.current = requestAnimationFrame(tick);
                return;
            }

            if (!cur.videoEnabled) {
                segLoopRafRef.current = requestAnimationFrame(tick);
                return;
            }

            if (v.readyState < 2) {
                segLoopRafRef.current = requestAnimationFrame(tick);
                return;
            }

            if (!segInFlightRef.current && (cur.bgMode === "blur" || cur.bgMode === "image")) {
                segInFlightRef.current = true;
                try {
                    await seg.send({ image: v });
                } catch { }
                segInFlightRef.current = false;
            }

            segLoopRafRef.current = requestAnimationFrame(tick);
        };

        segLoopRafRef.current = requestAnimationFrame(tick);
    };

    const stopSegLoop = () => {
        if (segLoopRafRef.current) cancelAnimationFrame(segLoopRafRef.current);
        segLoopRafRef.current = null;
        segInFlightRef.current = false;
    };

    // update bg image when url changes
    useEffect(() => {
        if (!open) return;
        if (s.bgMode !== "image") return;

        const url = s.bgImageUrl || DEFAULT_BACKGROUNDS[0]?.url;
        ensureBgImage(url);
    }, [open, s.bgMode, s.bgImageUrl]);

    // init segmentation only when needed
    useEffect(() => {
        if (!open) return;

        if (s.bgMode === "blur" || s.bgMode === "image") {
            initSegmentationIfNeeded().then(() => startSegLoop());
            return () => stopSegLoop();
        }

        // none mode => stop loop + clear overlay
        stopSegLoop();
        const c = canvasRef.current;
        const v = videoRef.current;
        if (c && v) {
            const w = v.videoWidth || c.width;
            const h = v.videoHeight || c.height;
            const ctx = c.getContext("2d");
            ctx?.clearRect(0, 0, w, h);
        }
    }, [open, s.bgMode, s.videoEnabled]);

    // -------------------- lifecycle --------------------
    useEffect(() => {
        if (!open) return;

        // restore saved
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

        committedBgUrlRef.current = undefined;
        prevDraftObjectUrlRef.current = null;

        // reset effects engine per open (чтобы можно было повторно пробовать)
        segRef.current = null;
        segReadyRef.current = false;
        segFailRef.current = false;
        setSegStatus("idle");

        ensureDevices().catch(() => { });
        startPreview().catch(() => { });

        return () => {
            stopStream();
            stopSegLoop();
            revokeCurrentBgIfNotCommitted();
        };
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

    // sinkId for test audio when output changes
    useEffect(() => {
        if (!open) return;
        if (!supportsSetSinkId()) return;
        if (!testAudioRef.current) return;
        if (!s.audioOutputId || s.audioOutputId === "default") return;

        (testAudioRef.current as any).setSinkId(s.audioOutputId).catch(() => { });
    }, [open, s.audioOutputId]);

    // lock body scroll while modal open
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

    // -------------------- actions --------------------
    const onClickJoin = () => {
        committedBgUrlRef.current = s.bgImageUrl;

        try { localStorage.setItem("mysession_prejoin", JSON.stringify(s)); } catch { }
        onJoin(s);
    };

    const onClickCancel = () => {
        revokeCurrentBgIfNotCommitted();
        onCancel?.();
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

    // background setters
    const setBgNone = () => setS((p) => ({ ...p, bgMode: "none", bgImageUrl: undefined }));
    const setBgBlur = () => setS((p) => ({ ...p, bgMode: "blur", bgImageUrl: undefined }));
    const setBgImage = (url: string) => setS((p) => ({ ...p, bgMode: "image", bgImageUrl: url }));

    const setCustomFile = (file: File) => {
        const url = URL.createObjectURL(file);
        setBgImage(url);
    };

    if (!open) return null;

    const wantProcessed = s.bgMode === "blur" || s.bgMode === "image";
    const canProcessed = wantProcessed && segStatus === "ready" && !segFailRef.current;

    // fallback if effects not ready/failed
    const fallbackBlurAll = wantProcessed && !canProcessed && s.bgMode === "blur";
    const fallbackBgBehind = wantProcessed && !canProcessed && s.bgMode === "image";
    const fallbackBgUrl = s.bgImageUrl || DEFAULT_BACKGROUNDS[0]?.url;

    const pillActive =
        isLight
            ? "bg-emerald-500/20 border-emerald-500/30 text-black"
            : "bg-emerald-500/15 border-emerald-400/30 text-white/90";

    const pillIdle =
        isLight
            ? "bg-black/5 border-black/10 text-black/70 hover:bg-black/10"
            : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10";

    return (
        <div className="fixed inset-0 z-[9999]">
            <div className="absolute inset-0 bg-black/60" onClick={onClickCancel} />

            <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-5">
                <div
                    className={`relative w-[92vw] max-w-[980px] rounded-2xl shadow-2xl overflow-hidden ${modalBg}`}
                    role="dialog"
                    aria-modal="true"
                >
                    {/* header */}
                    <div className={`flex items-center justify-between px-5 py-4 ${panel}`}>
                        <div>
                            <div className="text-base font-semibold">Before you join</div>
                            <div className={`text-xs ${subtle}`}>Pick devices + name. Then join.</div>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={refreshDevices}
                                className={`w-9 h-9 rounded-xl flex items-center justify-center ${btn}`}
                                title="Refresh devices"
                                type="button"
                            >
                                <RefreshCcw size={16} />
                            </button>

                            <button
                                onClick={onClickCancel}
                                className={`w-9 h-9 rounded-xl flex items-center justify-center ${btn}`}
                                title="Close"
                                type="button"
                            >
                                <X size={18} />
                            </button>
                        </div>
                    </div>

                    {/* body */}
                    <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
                        {/* left: preview */}
                        <div className="space-y-3">
                            <div
                                className={`relative rounded-2xl overflow-hidden ring-1 ${isLight ? "ring-black/10 bg-black" : "ring-white/10 bg-black"
                                    }`}
                                style={{
                                    aspectRatio: "16 / 9",
                                    backgroundImage: fallbackBgBehind ? `url(${fallbackBgUrl})` : undefined,
                                    backgroundSize: "cover",
                                    backgroundPosition: "center",
                                }}
                            >
                                {/* ✅ RAW VIDEO ALWAYS VISIBLE (we NEVER hide it now) */}
                                <video
                                    ref={videoRef}
                                    autoPlay
                                    playsInline
                                    muted
                                    className={
                                        "absolute inset-0 w-full h-full object-cover transition-opacity duration-150 " +
                                        (s.videoEnabled ? "opacity-100" : "opacity-0") +
                                        (fallbackBlurAll ? " blur-[10px] scale-[1.03]" : "")
                                    }
                                />

                                {/* ✅ processed overlay (drawn on top, but raw video stays behind as fallback) */}
                                {wantProcessed && (
                                    <canvas
                                        ref={canvasRef}
                                        className={
                                            "absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-150 " +
                                            (canProcessed ? "opacity-100" : "opacity-0")
                                        }
                                    />
                                )}

                                {/* loading placeholder */}
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

                                <div className="absolute left-3 top-3 flex items-center gap-2">
                                    <div
                                        className={`px-2.5 py-1 rounded-full text-[11px] border ${isLight
                                                ? "bg-white/90 border-black/10 text-black/70"
                                                : "bg-black/45 border-white/10 text-white/75"
                                            }`}
                                    >
                                        {s.bgMode === "none"
                                            ? "Background: none"
                                            : s.bgMode === "blur"
                                                ? "Background: blur"
                                                : "Background: image"}
                                    </div>

                                    {wantProcessed && segStatus === "loading" && (
                                        <div
                                            className={`px-2.5 py-1 rounded-full text-[11px] border ${isLight
                                                    ? "bg-white/90 border-black/10 text-black/70"
                                                    : "bg-black/45 border-white/10 text-white/75"
                                                }`}
                                        >
                                            Loading effects…
                                        </div>
                                    )}

                                    {wantProcessed && segStatus === "failed" && (
                                        <div
                                            className={`px-2.5 py-1 rounded-full text-[11px] border ${isLight
                                                    ? "bg-white/90 border-black/10 text-black/70"
                                                    : "bg-black/45 border-white/10 text-white/75"
                                                }`}
                                        >
                                            Effects fallback
                                        </div>
                                    )}
                                </div>

                                <div className="absolute left-3 bottom-3 flex items-center gap-2">
                                    <button
                                        className={`px-3 h-9 rounded-xl text-sm ${btn}`}
                                        onClick={() => setS((p) => ({ ...p, videoEnabled: !p.videoEnabled }))}
                                        type="button"
                                    >
                                        {s.videoEnabled ? "Turn off camera" : "Turn on camera"}
                                    </button>

                                    <button
                                        className={`px-3 h-9 rounded-xl text-sm ${btn}`}
                                        onClick={() => setS((p) => ({ ...p, audioEnabled: !p.audioEnabled }))}
                                        type="button"
                                    >
                                        {s.audioEnabled ? "Mute mic" : "Unmute mic"}
                                    </button>
                                </div>
                            </div>

                            {/* mic meter + errors */}
                            <div className={`rounded-2xl p-4 ${panel} space-y-3`}>
                                <div className="flex items-center justify-between gap-3">
                                    <div className={`text-xs ${subtle}`}>Mic level</div>
                                    <div className={`flex-1 h-2 rounded-full ${isLight ? "bg-black/10" : "bg-white/10"} overflow-hidden`}>
                                        <div className="h-full bg-emerald-500" style={{ width: `${Math.round(micLevel * 100)}%` }} />
                                    </div>
                                </div>

                                {permissionError && <div className="text-xs text-red-400">{permissionError}</div>}
                            </div>
                        </div>

                        {/* right: settings */}
                        <div className={`rounded-2xl p-4 ${panel} space-y-4`}>
                            {/* name */}
                            <div className="space-y-2">
                                <div className="text-sm font-semibold">Display name</div>
                                <input
                                    value={s.displayName}
                                    onChange={(e) => setS((p) => ({ ...p, displayName: e.target.value }))}
                                    placeholder="Your name"
                                    className={`w-full h-10 rounded-xl px-3 outline-none ${isLight ? "bg-white border border-black/10" : "bg-[#111827] border border-white/10 text-white/85"
                                        }`}
                                />
                            </div>

                            {/* camera + mic */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <div className="text-sm font-semibold">Camera</div>
                                    <select
                                        value={s.videoInputId}
                                        onChange={(e) => setS((p) => ({ ...p, videoInputId: e.target.value }))}
                                        className={`w-full h-10 rounded-xl px-3 outline-none ${isLight ? "bg-white border border-black/10" : "bg-[#111827] border border-white/10 text-white/85"
                                            }`}
                                    >
                                        <option value="default">Default</option>
                                        {cameras.map((d) => (
                                            <option key={d.deviceId} value={d.deviceId}>
                                                {deviceLabel(d, "Camera")}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="space-y-2">
                                    <div className="text-sm font-semibold">Microphone</div>
                                    <select
                                        value={s.audioInputId}
                                        onChange={(e) => setS((p) => ({ ...p, audioInputId: e.target.value }))}
                                        className={`w-full h-10 rounded-xl px-3 outline-none ${isLight ? "bg-white border border-black/10" : "bg-[#111827] border border-white/10 text-white/85"
                                            }`}
                                    >
                                        <option value="default">Default</option>
                                        {mics.map((d) => (
                                            <option key={d.deviceId} value={d.deviceId}>
                                                {deviceLabel(d, "Mic")}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* speakers */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="text-sm font-semibold">Speaker (Output)</div>
                                    <button onClick={playTestSound} className={`text-xs underline ${subtle}`} type="button">
                                        Test sound
                                    </button>
                                </div>

                                <select
                                    value={s.audioOutputId}
                                    onChange={(e) => setS((p) => ({ ...p, audioOutputId: e.target.value }))}
                                    disabled={!supportsSetSinkId()}
                                    className={`w-full h-10 rounded-xl px-3 outline-none ${isLight ? "bg-white border border-black/10" : "bg-[#111827] border border-white/10 text-white/85"
                                        } ${!supportsSetSinkId() ? "opacity-60 cursor-not-allowed" : ""}`}
                                >
                                    <option value="default">System default</option>
                                    {speakers
                                        .filter((d) => d.deviceId && d.deviceId !== "default")
                                        .map((d) => (
                                            <option key={d.deviceId} value={d.deviceId}>
                                                {deviceLabel(d, "Speakers")}
                                            </option>
                                        ))}
                                </select>

                                {!supportsSetSinkId() && <div className={`text-xs ${subtle}`}>Output selection not supported in this browser.</div>}
                            </div>

                            {/* reduce toggles */}
                            <div className={`rounded-2xl p-3 ${isLight ? "bg-black/5" : "bg-white/5"} space-y-2`}>
                                <label className="flex items-center gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={s.audioEnabled}
                                        onChange={(e) => setS((p) => ({ ...p, audioEnabled: e.target.checked }))}
                                    />
                                    Audio enabled
                                </label>

                                <label className="flex items-center gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={s.videoEnabled}
                                        onChange={(e) => setS((p) => ({ ...p, videoEnabled: e.target.checked }))}
                                    />
                                    Video enabled
                                </label>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                                    <label className="flex items-center gap-2 text-sm">
                                        <input
                                            type="checkbox"
                                            checked={s.echoCancellation}
                                            onChange={(e) => setS((p) => ({ ...p, echoCancellation: e.target.checked }))}
                                        />
                                        Echo cancellation
                                    </label>

                                    <label className="flex items-center gap-2 text-sm">
                                        <input
                                            type="checkbox"
                                            checked={s.noiseSuppression}
                                            onChange={(e) => setS((p) => ({ ...p, noiseSuppression: e.target.checked }))}
                                        />
                                        Noise suppression
                                    </label>

                                    <label className="flex items-center gap-2 text-sm">
                                        <input
                                            type="checkbox"
                                            checked={s.autoGainControl}
                                            onChange={(e) => setS((p) => ({ ...p, autoGainControl: e.target.checked }))}
                                        />
                                        Auto gain control
                                    </label>
                                </div>
                            </div>

                            {/* background */}
                            <div>
                                <div className="text-sm font-semibold mb-2">Background</div>

                                <div className="flex items-center gap-2 flex-wrap">
                                    <button
                                        type="button"
                                        onClick={setBgNone}
                                        className={`h-10 px-3 rounded-xl border text-[13px] transition ${s.bgMode === "none" ? pillActive : pillIdle}`}
                                    >
                                        None
                                    </button>

                                    <button
                                        type="button"
                                        onClick={setBgBlur}
                                        className={`h-10 px-3 rounded-xl border text-[13px] transition ${s.bgMode === "blur" ? pillActive : pillIdle}`}
                                    >
                                        Blur
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            const url = s.bgImageUrl || DEFAULT_BACKGROUNDS[0]?.url;
                                            if (url) setBgImage(url);
                                        }}
                                        className={`h-10 px-3 rounded-xl border text-[13px] transition ${s.bgMode === "image" ? pillActive : pillIdle}`}
                                    >
                                        Image
                                    </button>

                                    <label
                                        className={`h-10 px-3 rounded-xl border text-[13px] transition cursor-pointer flex items-center ${pillIdle}`}
                                        title="Upload custom background"
                                    >
                                        Upload
                                        <input
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                setCustomFile(file);
                                                e.currentTarget.value = "";
                                            }}
                                        />
                                    </label>
                                </div>

                                {s.bgMode === "image" && (
                                    <div className="mt-3">
                                        <div className={`text-[11px] ${subtle} mb-2`}>Choose a default</div>

                                        <div className="grid grid-cols-3 gap-2">
                                            {DEFAULT_BACKGROUNDS.map((bg) => {
                                                const active = s.bgImageUrl === bg.url;
                                                return (
                                                    <button
                                                        key={bg.id}
                                                        type="button"
                                                        onClick={() => setBgImage(bg.url)}
                                                        className={`rounded-xl overflow-hidden border transition text-left ${active
                                                                ? (isLight ? "border-emerald-500/40" : "border-emerald-400/40")
                                                                : (isLight ? "border-black/10 hover:border-black/25" : "border-white/10 hover:border-white/25")
                                                            }`}
                                                        title={bg.label}
                                                    >
                                                        <div className="w-full h-[78px] bg-black/20">
                                                            <img src={bg.url} alt={bg.label} className="w-full h-full object-cover" />
                                                        </div>
                                                        <div className={`px-2 py-1 text-[11px] ${subtle} truncate`}>{bg.label}</div>
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        {!!s.bgImageUrl && (
                                            <div className={`mt-3 rounded-xl overflow-hidden border ${isLight ? "border-black/10" : "border-white/10"}`}>
                                                <img src={s.bgImageUrl} className="w-full h-[140px] object-cover" alt="" />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* footer */}
                            <div className="pt-2 flex items-center justify-between">
                                <button onClick={onClickCancel} className={`px-4 h-10 rounded-xl ${btn}`} type="button">
                                    Cancel
                                </button>

                                <button
                                    onClick={onClickJoin}
                                    className="px-5 h-10 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-[#02140B] font-semibold"
                                    type="button"
                                >
                                    Join room
                                </button>
                            </div>

                            <audio ref={testAudioRef} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
