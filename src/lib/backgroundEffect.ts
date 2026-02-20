// src/lib/backgroundEffect.ts
// Canvas + (optional) MediaPipe SelfieSegmentation background effects.
// Used by jitsiEngine replaceTrack pipeline (can be async safely).
//
// ✅ Variant: Insertable Streams (TransformStream)
// originalTrack -> MediaStreamTrackProcessor -> TransformStream(process frames) -> MediaStreamTrackGenerator
//
// Goals:
// - avoid captureStream + RAF scheduler issues
// - avoid recreating camera tracks
// - keep realtime (drop frames under backpressure instead of building latency)
// - optional MediaPipe segmentation when available (throttled)

export type BgMode = "none" | "blur" | "image";

type CreateOpts = {
    mode: BgMode;
    imageUrl?: string;
    blurPx?: number; // default 10
    fps?: number; // default 30
    maxWidth?: number; // default 1280

    // optional knobs (safe defaults)
    segFps?: number; // default min(fps, 12)
    segMaxWidth?: number; // default 320 (smaller = cheaper)
};

type Processor = {
    startEffect: (input: MediaStream) => Promise<MediaStream> | MediaStream;
    stopEffect: () => Promise<void> | void;
    dispose: () => Promise<void> | void;
};

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

function clamp(n: number, a: number, b: number) {
    return Math.max(a, Math.min(b, n));
}

async function loadImage(url: string): Promise<HTMLImageElement> {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.src = url;
    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load image: " + url));
    });
    return img;
}

async function tryCreateSelfieSegmentation() {
    // Optional dependency. If missing — return null, we will fallback.
    // npm i @mediapipe/selfie_segmentation
    try {
        const mod: any = await import("@mediapipe/selfie_segmentation");
        const SelfieSegmentation = mod?.SelfieSegmentation;
        if (!SelfieSegmentation) return null;

        const seg = new SelfieSegmentation({
            locateFile: (file: string) =>
                `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
        });

        seg.setOptions({
            modelSelection: 1, // 0 = general, 1 = landscape
        });

        return seg;
    } catch {
        return null;
    }
}

function supportsInsertableStreams() {
    const w = window as any;
    return !!(w.MediaStreamTrackProcessor && w.MediaStreamTrackGenerator && w.VideoFrame);
}

export function createBackgroundEffect(opts: CreateOpts): Processor {
    const mode: BgMode = opts.mode ?? "none";
    const fps = clamp(opts.fps ?? 30, 5, 60);
    const blurPx = clamp(opts.blurPx ?? 10, 0, 40);
    const maxWidth = clamp(opts.maxWidth ?? 1280, 320, 3840);

    const segFps = clamp(opts.segFps ?? Math.min(fps, 12), 1, 30);
    const segMaxWidth = clamp(opts.segMaxWidth ?? 320, 160, 1024);

    let running = false;

    // output
    let outStream: MediaStream | null = null;
    let genTrack: MediaStreamTrack | null = null;

    // insertable streams objects
    let processor: any | null = null; // MediaStreamTrackProcessor
    let generator: any | null = null; // MediaStreamTrackGenerator
    let genWriter: any | null = null; // WritableStreamDefaultWriter<VideoFrame>

    let pipeAbort: AbortController | null = null;
    let pipePromise: Promise<void> | null = null;

    // drawing
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;

    // background image
    let bgImage: HTMLImageElement | null = null;

    // segmentation
    let seg: any | null = null;
    let segReady = false;
    let segBusy = false;
    let lastMask: CanvasImageSource | null = null;
    let lastSegAt = 0;

    let segCanvas: HTMLCanvasElement | null = null;
    let segCtx: CanvasRenderingContext2D | null = null;

    const nowMs = () => {
        try {
            return typeof performance !== "undefined" ? performance.now() : Date.now();
        } catch {
            return Date.now();
        }
    };

    const stopTracks = (s: MediaStream | null) => {
        try {
            s?.getTracks?.()?.forEach((t) => {
                try {
                    t.stop();
                } catch { }
            });
        } catch { }
    };

    const cleanup = () => {
        canvas = null;
        ctx = null;

        segCanvas = null;
        segCtx = null;

        bgImage = null;

        seg = null;
        segReady = false;
        segBusy = false;
        lastMask = null;
        lastSegAt = 0;

        processor = null;
        generator = null;
        genWriter = null;

        pipeAbort = null;
        pipePromise = null;

        genTrack = null;
        outStream = null;
    };

    const ensureCanvases = (srcW: number, srcH: number) => {
        // scale down if huge
        const scale = srcW > maxWidth ? maxWidth / srcW : 1;
        const w = Math.max(2, Math.round(srcW * scale));
        const h = Math.max(2, Math.round(srcH * scale));

        if (!canvas) canvas = document.createElement("canvas");
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }

        if (!ctx) ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) throw new Error("Canvas 2D context not available");

        // seg canvas (smaller for cheaper inference)
        const segScale = srcW > segMaxWidth ? segMaxWidth / srcW : 1;
        const sw = Math.max(2, Math.round(srcW * segScale));
        const sh = Math.max(2, Math.round(srcH * segScale));

        if (!segCanvas) segCanvas = document.createElement("canvas");
        if (segCanvas.width !== sw || segCanvas.height !== sh) {
            segCanvas.width = sw;
            segCanvas.height = sh;
        }
        if (!segCtx) segCtx = segCanvas.getContext("2d", { alpha: false });
    };

    const drawFallback = (frame: any) => {
        if (!canvas || !ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        try {
            ctx.clearRect(0, 0, w, h);
        } catch { }

        if (mode === "blur") {
            try {
                ctx.filter = `blur(${blurPx}px)`;
                ctx.drawImage(frame, 0, 0, w, h);
            } catch {
                // ignore
            } finally {
                try {
                    ctx.filter = "none";
                } catch { }
            }
            return;
        }

        // image/none without mask => raw
        try {
            ctx.drawImage(frame, 0, 0, w, h);
        } catch {
            // ignore
        }
    };

    const drawWithMask = (frame: any) => {
        if (!canvas || !ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        try {
            ctx.clearRect(0, 0, w, h);
        } catch { }

        // 1) foreground (person)
        try {
            ctx.save();
            ctx.drawImage(frame, 0, 0, w, h);
            ctx.globalCompositeOperation = "destination-in";
            if (lastMask) ctx.drawImage(lastMask, 0, 0, w, h);
            ctx.restore();
        } catch {
            try {
                ctx.globalCompositeOperation = "source-over";
            } catch { }
        }

        // 2) background behind person
        try {
            ctx.save();
            ctx.globalCompositeOperation = "destination-over";

            if (mode === "image" && bgImage) {
                ctx.drawImage(bgImage, 0, 0, w, h);
            } else if (mode === "blur") {
                try {
                    ctx.filter = `blur(${blurPx}px)`;
                    ctx.drawImage(frame, 0, 0, w, h);
                } catch {
                    // ignore
                } finally {
                    try {
                        ctx.filter = "none";
                    } catch { }
                }
            } else {
                ctx.drawImage(frame, 0, 0, w, h);
            }

            ctx.restore();
            ctx.globalCompositeOperation = "source-over";
        } catch {
            try {
                ctx.globalCompositeOperation = "source-over";
            } catch { }
        }
    };

    const maybeRunSegmentation = (frame: any) => {
        if (!seg || !segReady || segBusy || !segCanvas || !segCtx) return;

        const now = nowMs();
        const interval = 1000 / segFps;
        if (now - lastSegAt < interval) return;

        lastSegAt = now;

        // IMPORTANT: we cannot pass VideoFrame async if we plan to close it.
        // So we copy the current frame into segCanvas synchronously, then seg reads segCanvas.
        try {
            segCtx.clearRect(0, 0, segCanvas.width, segCanvas.height);
            segCtx.drawImage(frame, 0, 0, segCanvas.width, segCanvas.height);
        } catch {
            return;
        }

        segBusy = true;
        Promise.resolve()
            .then(() => seg.send({ image: segCanvas }))
            .catch(() => { })
            .finally(() => {
                segBusy = false;
            });
    };

    const buildInsertablePipeline = async (input: MediaStream): Promise<MediaStream> => {
        const w = window as any;
        const MSP = w.MediaStreamTrackProcessor;
        const MSG = w.MediaStreamTrackGenerator;
        const VF = w.VideoFrame;

        const inTrack = input.getVideoTracks?.()?.[0];
        if (!inTrack) throw new Error("No input video track for background effect");

        // create generator early
        generator = new MSG({ kind: "video" });
        genTrack = generator as MediaStreamTrack;
        outStream = new MediaStream([genTrack]);

        // background image if needed
        if (mode === "image" && opts.imageUrl) {
            try {
                bgImage = await loadImage(opts.imageUrl);
            } catch {
                bgImage = null;
            }
        }

        // segmentation init (optional)
        seg = await tryCreateSelfieSegmentation();
        if (seg) {
            try {
                seg.onResults((res: any) => {
                    if (res?.segmentationMask) lastMask = res.segmentationMask as any;
                });
                segReady = true;
            } catch {
                seg = null;
                segReady = false;
            }
        }

        processor = new MSP({ track: inTrack });

        // writable sink that writes to generator AND closes frames (to avoid leaks)
        genWriter = generator.writable.getWriter();

        const sink = new WritableStream<any>({
            write: async (frame: any) => {
                // generator needs a VideoFrame
                try {
                    await genWriter.write(frame);
                } catch {
                    // ignore
                } finally {
                    try {
                        frame?.close?.();
                    } catch { }
                }
            },
            close: async () => {
                try {
                    await genWriter.close();
                } catch { }
            },
            abort: async () => {
                try {
                    await genWriter.abort();
                } catch { }
            },
        });

        // transform stream: input VideoFrame -> processed VideoFrame
        const transform = new TransformStream<any, any>({
            transform: (frame: any, controller: any) => {
                if (!running) {
                    try {
                        frame?.close?.();
                    } catch { }
                    return;
                }

                // realtime: if downstream is congested, drop this frame (avoid latency build-up)
                try {
                    const desired = controller?.desiredSize;
                    if (typeof desired === "number" && desired <= 0) {
                        try {
                            frame?.close?.();
                        } catch { }
                        return;
                    }
                } catch { }

                const srcW = Number(frame?.displayWidth ?? frame?.codedWidth ?? 0) || 640;
                const srcH = Number(frame?.displayHeight ?? frame?.codedHeight ?? 0) || 360;

                try {
                    ensureCanvases(srcW, srcH);
                } catch {
                    try {
                        frame?.close?.();
                    } catch { }
                    return;
                }

                // kick segmentation (throttled, async; uses segCanvas copy)
                if (seg && segReady) {
                    try {
                        maybeRunSegmentation(frame);
                    } catch { }
                }

                // draw
                try {
                    if (mode !== "none" && segReady && lastMask) drawWithMask(frame);
                    else drawFallback(frame);
                } catch {
                    // ignore draw errors
                }

                // produce output frame
                if (canvas && VF) {
                    let outFrame: any = null;
                    try {
                        const ts = typeof frame?.timestamp === "number" ? frame.timestamp : undefined;
                        const dur = typeof frame?.duration === "number" ? frame.duration : undefined;

                        outFrame = new VF(canvas, {
                            timestamp: ts,
                            duration: dur,
                        });

                        controller.enqueue(outFrame);
                    } catch {
                        try {
                            outFrame?.close?.();
                        } catch { }
                    }
                }

                // always close input frame
                try {
                    frame?.close?.();
                } catch { }
            },
        });

        pipeAbort = new AbortController();
        pipePromise = processor.readable
            .pipeThrough(transform)
            .pipeTo(sink, { signal: pipeAbort.signal })
            .then(() => { })
            .catch(() => { });

        return outStream!;
    };

    // Fallback (if insertable streams unsupported): return the original canvas.captureStream version
    // (kept minimal; still works, but the whole point is to use insertable streams when possible)
    const buildFallbackCanvas = async (input: MediaStream): Promise<MediaStream> => {
        // Minimal fallback: draw frames with a hidden <video> + canvas + captureStream
        // (uses timers on hidden tabs, no “pause on hidden”)
        let localRunning = true;

        const videoEl = document.createElement("video");
        videoEl.playsInline = true;
        videoEl.muted = true;
        videoEl.autoplay = true;
        (videoEl as any).srcObject = input;

        try {
            await videoEl.play().catch(() => { });
        } catch { }

        const t0 = Date.now();
        while (Date.now() - t0 < 1200) {
            const vw = videoEl.videoWidth || 0;
            const vh = videoEl.videoHeight || 0;
            if (vw > 0 && vh > 0) break;
            await sleep(50);
        }

        const vw0 = videoEl.videoWidth || 640;
        const vh0 = videoEl.videoHeight || 360;
        const scale = vw0 > maxWidth ? maxWidth / vw0 : 1;
        const vw = Math.max(2, Math.round(vw0 * scale));
        const vh = Math.max(2, Math.round(vh0 * scale));

        const c = document.createElement("canvas");
        c.width = vw;
        c.height = vh;
        const cctx = c.getContext("2d", { alpha: true });
        if (!cctx) throw new Error("Canvas 2D context not available");

        // bg image
        if (mode === "image" && opts.imageUrl) {
            try {
                bgImage = await loadImage(opts.imageUrl);
            } catch {
                bgImage = null;
            }
        }

        // seg
        seg = await tryCreateSelfieSegmentation();
        if (seg) {
            try {
                seg.onResults((res: any) => {
                    if (res?.segmentationMask) lastMask = res.segmentationMask as any;
                });
                segReady = true;
            } catch {
                seg = null;
                segReady = false;
            }
        }

        const stream = c.captureStream(fps);

        let lastSeg = 0;
        let segBusyLocal = false;

        const drawTick = () => {
            if (!localRunning) return;

            try {
                cctx.clearRect(0, 0, vw, vh);

                const haveMask = mode !== "none" && segReady && lastMask;

                if (haveMask) {
                    // foreground
                    cctx.save();
                    cctx.drawImage(videoEl, 0, 0, vw, vh);
                    cctx.globalCompositeOperation = "destination-in";
                    cctx.drawImage(lastMask!, 0, 0, vw, vh);
                    cctx.restore();

                    // background
                    cctx.save();
                    cctx.globalCompositeOperation = "destination-over";

                    if (mode === "image" && bgImage) {
                        cctx.drawImage(bgImage, 0, 0, vw, vh);
                    } else if (mode === "blur") {
                        cctx.filter = `blur(${blurPx}px)`;
                        cctx.drawImage(videoEl, 0, 0, vw, vh);
                        cctx.filter = "none";
                    } else {
                        cctx.drawImage(videoEl, 0, 0, vw, vh);
                    }

                    cctx.restore();
                    cctx.globalCompositeOperation = "source-over";
                } else {
                    if (mode === "blur") {
                        cctx.filter = `blur(${blurPx}px)`;
                        cctx.drawImage(videoEl, 0, 0, vw, vh);
                        cctx.filter = "none";
                    } else {
                        cctx.drawImage(videoEl, 0, 0, vw, vh);
                    }
                }
            } catch { }

            // segmentation (throttle)
            if (seg && segReady && !segBusyLocal) {
                const now = nowMs();
                const interval = 1000 / segFps;
                if (now - lastSeg >= interval) {
                    lastSeg = now;
                    segBusyLocal = true;
                    Promise.resolve()
                        .then(() => seg.send({ image: videoEl }))
                        .catch(() => { })
                        .finally(() => {
                            segBusyLocal = false;
                        });
                }
            }

            // No “pause on hidden”: timers always
            window.setTimeout(drawTick, Math.max(33, Math.round(1000 / fps)));
        };

        drawTick();

        // tie fallback to stopEffect via outer vars
        outStream = stream;
        genTrack = null;
        processor = null;
        generator = null;
        genWriter = null;
        pipeAbort = new AbortController(); // just a marker to stop fallback
        pipePromise = (async () => {
            while (localRunning && running) {
                await sleep(250);
            }
        })();

        // patch stopEffect cleanup for fallback
        const prevStop = stopEffectImpl;
        stopEffectImpl = async () => {
            localRunning = false;
            try {
                videoEl.pause?.();
                (videoEl as any).srcObject = null;
            } catch { }
            stopTracks(stream);
            await prevStop();
        };

        return stream;
    };

    // We override stopEffectImpl for fallback patching safely
    let stopEffectImpl = async () => {
        running = false;

        // stop pipeline
        try {
            pipeAbort?.abort();
        } catch { }
        pipeAbort = null;

        try {
            await pipePromise;
        } catch { }
        pipePromise = null;

        // stop segmentation
        try {
            await seg?.close?.();
        } catch { }
        seg = null;
        segReady = false;
        segBusy = false;
        lastMask = null;
        lastSegAt = 0;

        // stop generator track only (do NOT stop input camera track)
        try {
            genTrack?.stop?.();
        } catch { }

        // stop output stream tracks (if any remain)
        stopTracks(outStream);

        cleanup();
    };

    const startEffect = async (input: MediaStream): Promise<MediaStream> => {
        // mode none => passthrough
        if (mode === "none" || (mode === "blur" && blurPx <= 0)) {
            outStream = input;
            running = true;
            return input;
        }

        running = true;

        // Prefer insertable streams
        if (supportsInsertableStreams()) {
            try {
                return await buildInsertablePipeline(input);
            } catch {
                // fall back
            }
        }

        // Fallback path
        return await buildFallbackCanvas(input);
    };

    const stopEffect = async () => {
        await stopEffectImpl();
    };

    const dispose = async () => {
        await stopEffectImpl();
    };

    return { startEffect, stopEffect, dispose };
}