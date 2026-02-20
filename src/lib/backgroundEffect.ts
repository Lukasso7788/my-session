// src/lib/backgroundEffect.ts
// WebCodecs (MediaStreamTrackProcessor/Generator) + Canvas + (optional) MediaPipe SelfieSegmentation
// Used by jitsiEngine replaceTrack pipeline (can be async safely).
//
// ✅ Goal of this version:
// - Remove dependency on <video> / DOM playback throttling
// - Process frames directly from the input MediaStream video track
// - Output a new MediaStream with the processed video track + passthrough audio tracks
//
// Notes:
// - Uses WebCodecs when available. If not available, falls back to your previous <video>+canvas pipeline
//   (so you don't lose functionality on older browsers).
// - MediaPipe SelfieSegmentation is optional. If missing, fallback draws either blur-whole-frame or raw frame.

export type BgMode = "none" | "blur" | "image";

type CreateOpts = {
    mode: BgMode;
    imageUrl?: string;
    blurPx?: number; // default 10
    fps?: number; // default 30
    maxWidth?: number; // default 1280
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
    // The simplest path: install the package:
    //   npm i @mediapipe/selfie_segmentation
    try {
        const mod: any = await import("@mediapipe/selfie_segmentation");
        const SelfieSegmentation = mod?.SelfieSegmentation;
        if (!SelfieSegmentation) return null;

        const seg = new SelfieSegmentation({
            locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
        });

        seg.setOptions({
            modelSelection: 1, // 0 = general, 1 = landscape (usually better)
        });

        return seg;
    } catch {
        return null;
    }
}

function hasWebCodecsPipeline() {
    try {
        const w: any = window as any;
        return (
            typeof w.MediaStreamTrackProcessor === "function" &&
            typeof w.MediaStreamTrackGenerator === "function" &&
            typeof w.VideoFrame === "function"
        );
    } catch {
        return false;
    }
}

// -----------------------------------------------------------------------------
// Fallback: your previous DOM <video> pipeline (kept to preserve compatibility)
// -----------------------------------------------------------------------------
function createDomFallbackEffect(opts: CreateOpts): Processor {
    const mode: BgMode = opts.mode ?? "none";
    const fps = clamp(opts.fps ?? 30, 5, 60);
    const blurPx = clamp(opts.blurPx ?? 10, 0, 40);
    const maxWidth = clamp(opts.maxWidth ?? 1280, 320, 3840);

    let running = false;

    let rafId: number | null = null;
    let timerId: number | null = null;
    let vfcId: number | null = null;

    let tickInFlight = false;

    let videoEl: HTMLVideoElement | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;

    let outStream: MediaStream | null = null;

    let bgImage: HTMLImageElement | null = null;

    // MediaPipe
    let seg: any | null = null;
    let lastMask: CanvasImageSource | null = null;
    let segReady = false;
    let segBusy = false;
    let lastSegAt = 0;

    const stopTracks = (s: MediaStream | null) => {
        try {
            s?.getTracks?.()?.forEach((t) => {
                try {
                    t.stop();
                } catch { }
            });
        } catch { }
    };

    const cleanupDom = () => {
        try {
            if (videoEl) {
                videoEl.pause?.();
                (videoEl as any).srcObject = null;
            }
        } catch { }
        videoEl = null;
        canvas = null;
        ctx = null;
    };

    const clearScheduled = () => {
        try {
            if (rafId != null) cancelAnimationFrame(rafId);
        } catch { }
        rafId = null;

        try {
            if (timerId != null) clearTimeout(timerId);
        } catch { }
        timerId = null;

        try {
            if (vfcId != null && videoEl && typeof (videoEl as any).cancelVideoFrameCallback === "function") {
                (videoEl as any).cancelVideoFrameCallback(vfcId);
            }
        } catch { }
        vfcId = null;
    };

    const tickDrawFallback = () => {
        if (!running || !videoEl || !canvas || !ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        if (mode === "blur") {
            ctx.filter = `blur(${blurPx}px)`;
            ctx.drawImage(videoEl, 0, 0, w, h);
            ctx.filter = "none";
            return;
        }

        ctx.drawImage(videoEl, 0, 0, w, h);
    };

    const tickDrawWithMask = () => {
        if (!running || !videoEl || !canvas || !ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        // 1) foreground
        ctx.save();
        ctx.drawImage(videoEl, 0, 0, w, h);
        ctx.globalCompositeOperation = "destination-in";
        if (lastMask) ctx.drawImage(lastMask, 0, 0, w, h);
        ctx.restore();

        // 2) background
        ctx.save();
        ctx.globalCompositeOperation = "destination-over";

        if (mode === "image" && bgImage) {
            ctx.drawImage(bgImage, 0, 0, w, h);
        } else if (mode === "blur") {
            ctx.filter = `blur(${blurPx}px)`;
            ctx.drawImage(videoEl, 0, 0, w, h);
            ctx.filter = "none";
        } else {
            ctx.drawImage(videoEl, 0, 0, w, h);
        }

        ctx.restore();
        ctx.globalCompositeOperation = "source-over";
    };

    const shouldUseVFC = () => {
        try {
            return (
                document.visibilityState === "visible" &&
                !!videoEl &&
                typeof (videoEl as any).requestVideoFrameCallback === "function"
            );
        } catch {
            return false;
        }
    };

    const scheduleNext = () => {
        if (!running) return;

        clearScheduled();

        if (document.visibilityState !== "visible") {
            const ms = Math.max(33, Math.round(1000 / fps));
            timerId = window.setTimeout(() => {
                timerId = null;
                void tickAndReschedule();
            }, ms) as any;
            return;
        }

        if (shouldUseVFC()) {
            try {
                vfcId = (videoEl as any).requestVideoFrameCallback(() => {
                    vfcId = null;
                    void tickAndReschedule();
                });
                return;
            } catch {
                // fall through
            }
        }

        rafId = requestAnimationFrame(() => {
            rafId = null;
            void tickAndReschedule();
        });
    };

    const tickAndReschedule = async () => {
        if (!running) return;

        if (tickInFlight) {
            scheduleNext();
            return;
        }

        tickInFlight = true;
        try {
            try {
                if (segReady && lastMask) tickDrawWithMask();
                else tickDrawFallback();
            } catch { }

            if (seg && segReady && !segBusy && videoEl) {
                const now = performance.now();
                const interval = 1000 / fps;

                if (now - lastSegAt >= interval) {
                    lastSegAt = now;
                    segBusy = true;
                    try {
                        await seg.send({ image: videoEl });
                    } catch {
                        // ignore
                    } finally {
                        segBusy = false;
                    }
                }
            }
        } finally {
            tickInFlight = false;
            scheduleNext();
        }
    };

    const onVisibility = () => {
        if (!running) return;
        scheduleNext();
    };

    const startEffect = async (input: MediaStream): Promise<MediaStream> => {
        // Prepare video element
        videoEl = document.createElement("video");
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
        const vw = Math.round(vw0 * scale);
        const vh = Math.round(vh0 * scale);

        canvas = document.createElement("canvas");
        canvas.width = vw;
        canvas.height = vh;
        ctx = canvas.getContext("2d", { alpha: true });

        if (!ctx) throw new Error("Canvas 2D context not available");

        outStream = canvas.captureStream(fps);

        if (mode === "image" && opts.imageUrl) {
            try {
                bgImage = await loadImage(opts.imageUrl);
            } catch {
                bgImage = null;
            }
        }

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

        running = true;
        tickInFlight = false;
        lastSegAt = 0;

        try {
            document.addEventListener("visibilitychange", onVisibility);
        } catch { }

        scheduleNext();

        return outStream;
    };

    const stopEffect = async () => {
        running = false;
        clearScheduled();

        try {
            document.removeEventListener("visibilitychange", onVisibility);
        } catch { }

        try {
            await seg?.close?.();
        } catch { }
        seg = null;
        segReady = false;
        segBusy = false;
        lastMask = null;
        lastSegAt = 0;

        // Only stop output tracks (canvas stream)
        stopTracks(outStream);
        outStream = null;

        cleanupDom();
    };

    const dispose = async () => {
        await stopEffect();
        bgImage = null;
    };

    return { startEffect, stopEffect, dispose };
}

// -----------------------------------------------------------------------------
// WebCodecs pipeline (variant #7): TrackProcessor/Generator
// -----------------------------------------------------------------------------
export function createBackgroundEffect(opts: CreateOpts): Processor {
    // If WebCodecs pipeline isn't available, keep old behavior.
    if (typeof window === "undefined" || !hasWebCodecsPipeline()) {
        return createDomFallbackEffect(opts);
    }

    const mode: BgMode = opts.mode ?? "none";
    const targetFps = clamp(opts.fps ?? 30, 5, 60);
    const blurPx = clamp(opts.blurPx ?? 10, 0, 40);
    const maxWidth = clamp(opts.maxWidth ?? 1280, 320, 3840);

    // We intentionally keep segmentation slower than draw when possible.
    // This reduces CPU hard, especially on mobile.
    const segFpsVisible = Math.min(10, targetFps);
    const segFpsHidden = Math.min(2, segFpsVisible);

    let running = false;
    let inputStream: MediaStream | null = null;

    let bgImage: HTMLImageElement | null = null;

    // MediaPipe
    let seg: any | null = null;
    let segReady = false;
    let segBusy = false;
    let lastMask: CanvasImageSource | null = null;
    let lastSegAt = 0;

    // WebCodecs objects
    let processor: any | null = null;
    let generator: any | null = null;
    let reader: any | null = null;
    let writer: any | null = null;
    let abortCtl: AbortController | null = null;

    // Canvases
    let drawCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
    let drawCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

    // A dedicated canvas for segmentation input (so we can feed MediaPipe a CanvasImageSource reliably)
    // MediaPipe accepts HTMLCanvasElement / HTMLVideoElement / HTMLImageElement. OffscreenCanvas is not always accepted.
    let segCanvas: HTMLCanvasElement | null = null;
    let segCtx: CanvasRenderingContext2D | null = null;

    let outStream: MediaStream | null = null;

    const safe = (fn: () => void) => {
        try {
            fn();
        } catch { }
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

    const create2dCanvas = (w: number, h: number) => {
        // Prefer OffscreenCanvas if available for draw/composite.
        // But keep an HTMLCanvasElement for MediaPipe input (compat).
        let dc: any = null;
        let dctx: any = null;

        try {
            const wAny: any = window as any;
            if (typeof wAny.OffscreenCanvas === "function") {
                dc = new wAny.OffscreenCanvas(w, h);
                dctx = dc.getContext("2d", { alpha: true });
            }
        } catch {
            dc = null;
            dctx = null;
        }

        if (!dc || !dctx) {
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const cctx = c.getContext("2d", { alpha: true });
            if (!cctx) throw new Error("Canvas 2D context not available");
            return { dc: c, dctx: cctx };
        }

        return { dc, dctx };
    };

    const ensureSegCanvas = (w: number, h: number) => {
        if (segCanvas && segCtx) {
            if (segCanvas.width !== w) segCanvas.width = w;
            if (segCanvas.height !== h) segCanvas.height = h;
            return;
        }
        segCanvas = document.createElement("canvas");
        segCanvas.width = w;
        segCanvas.height = h;
        segCtx = segCanvas.getContext("2d", { alpha: false });
        if (!segCtx) throw new Error("Segmentation canvas 2D context not available");
    };

    const pickScaledSize = (srcW: number, srcH: number) => {
        if (srcW <= 0 || srcH <= 0) return { w: 640, h: 360 };
        const scale = srcW > maxWidth ? maxWidth / srcW : 1;
        return {
            w: Math.max(2, Math.round(srcW * scale)),
            h: Math.max(2, Math.round(srcH * scale)),
        };
    };

    const drawFallback = (frame: any, w: number, h: number) => {
        if (!drawCtx || !drawCanvas) return;

        (drawCtx as any).clearRect(0, 0, w, h);

        if (mode === "blur") {
            (drawCtx as any).filter = `blur(${blurPx}px)`;
            (drawCtx as any).drawImage(frame, 0, 0, w, h);
            (drawCtx as any).filter = "none";
            return;
        }

        (drawCtx as any).drawImage(frame, 0, 0, w, h);
    };

    const drawWithMask = (frame: any, w: number, h: number) => {
        if (!drawCtx || !drawCanvas) return;

        (drawCtx as any).clearRect(0, 0, w, h);

        // 1) foreground
        (drawCtx as any).save();
        (drawCtx as any).drawImage(frame, 0, 0, w, h);
        (drawCtx as any).globalCompositeOperation = "destination-in";
        if (lastMask) (drawCtx as any).drawImage(lastMask as any, 0, 0, w, h);
        (drawCtx as any).restore();

        // 2) background
        (drawCtx as any).save();
        (drawCtx as any).globalCompositeOperation = "destination-over";

        if (mode === "image" && bgImage) {
            (drawCtx as any).drawImage(bgImage, 0, 0, w, h);
        } else if (mode === "blur") {
            (drawCtx as any).filter = `blur(${blurPx}px)`;
            (drawCtx as any).drawImage(frame, 0, 0, w, h);
            (drawCtx as any).filter = "none";
        } else {
            (drawCtx as any).drawImage(frame, 0, 0, w, h);
        }

        (drawCtx as any).restore();
        (drawCtx as any).globalCompositeOperation = "source-over";
    };

    const maybeRunSegmentation = async (frame: any, w: number, h: number) => {
        if (!seg || !segReady || segBusy) return;

        const now = performance.now();
        const isHidden = typeof document !== "undefined" && document.visibilityState !== "visible";
        const segFps = isHidden ? segFpsHidden : segFpsVisible;
        const interval = 1000 / Math.max(1, segFps);

        if (now - lastSegAt < interval) return;
        lastSegAt = now;

        // MediaPipe wants HTMLVideoElement / HTMLImageElement / HTMLCanvasElement
        // We draw the current VideoFrame into segCanvas and send that canvas.
        ensureSegCanvas(w, h);
        if (!segCtx || !segCanvas) return;

        try {
            segBusy = true;
            segCtx.clearRect(0, 0, w, h);
            segCtx.drawImage(frame, 0, 0, w, h);
            await seg.send({ image: segCanvas });
        } catch {
            // ignore
        } finally {
            segBusy = false;
        }
    };

    const startWebCodecsLoop = async (videoTrack: MediaStreamTrack) => {
        const wAny: any = window as any;

        processor = new wAny.MediaStreamTrackProcessor({ track: videoTrack });
        generator = new wAny.MediaStreamTrackGenerator({ kind: "video" });

        reader = processor.readable.getReader();
        writer = generator.writable.getWriter();

        abortCtl = new AbortController();
        const { signal } = abortCtl;

        // We will build output stream once generator exists
        const audios = (inputStream?.getAudioTracks?.() || []).slice();
        outStream = new MediaStream([...audios, generator]);

        // Frame pacing (optional): we *allow* natural pacing, but we can also downsample if needed.
        // We'll do a lightweight gate so we don't output more than targetFps.
        const minFrameIntervalMs = 1000 / targetFps;
        let lastOutAt = 0;

        // Dimensions init once we see first frame
        let outW = 0;
        let outH = 0;

        while (!signal.aborted) {
            let res: any;
            try {
                res = await reader.read();
            } catch {
                break;
            }
            if (!res || res.done) break;

            const frame: any = res.value;
            if (!frame) continue;

            try {
                // Throttle output fps if source is higher
                const now = performance.now();
                if (now - lastOutAt < minFrameIntervalMs) {
                    // We still should run segmentation occasionally? It's optional.
                    // But to keep CPU sane, just drop this frame.
                    try {
                        frame.close?.();
                    } catch { }
                    continue;
                }
                lastOutAt = now;

                const srcW = frame.displayWidth || frame.codedWidth || 0;
                const srcH = frame.displayHeight || frame.codedHeight || 0;

                if (!outW || !outH) {
                    const s = pickScaledSize(srcW || 640, srcH || 360);
                    outW = s.w;
                    outH = s.h;

                    const made = create2dCanvas(outW, outH);
                    drawCanvas = made.dc;
                    drawCtx = made.dctx;

                    // Setup segmentation once
                    seg = await tryCreateSelfieSegmentation();
                    if (seg) {
                        try {
                            seg.onResults((r: any) => {
                                if (r?.segmentationMask) lastMask = r.segmentationMask as any;
                            });
                            segReady = true;
                        } catch {
                            seg = null;
                            segReady = false;
                        }
                    }

                    // Load background image if needed
                    if (mode === "image" && opts.imageUrl) {
                        try {
                            bgImage = await loadImage(opts.imageUrl);
                        } catch {
                            bgImage = null;
                        }
                    }
                }

                // Composite/draw
                try {
                    if (segReady && lastMask) drawWithMask(frame, outW, outH);
                    else drawFallback(frame, outW, outH);
                } catch {
                    // if draw fails, do nothing; we still try to pass through something
                }

                // Run segmentation asynchronously (paced)
                if (seg && segReady) {
                    // fire-and-await here to keep correctness and avoid runaway
                    await maybeRunSegmentation(frame, outW, outH);
                }

                // Emit a new VideoFrame from our canvas
                // - For OffscreenCanvas, VideoFrame accepts it in modern Chromium.
                // - For HTMLCanvasElement, also works.
                let outFrame: any = null;
                try {
                    const ts = typeof frame.timestamp === "number" ? frame.timestamp : Math.round(performance.now() * 1000);
                    outFrame = new wAny.VideoFrame(drawCanvas, { timestamp: ts });
                } catch {
                    // If VideoFrame(canvas) fails for some reason, skip output
                    outFrame = null;
                }

                // Backpressure
                try {
                    if (writer?.ready) await writer.ready;
                } catch { }

                if (outFrame) {
                    try {
                        await writer.write(outFrame);
                    } catch {
                        // ignore write failures
                    } finally {
                        try {
                            outFrame.close?.();
                        } catch { }
                    }
                }
            } finally {
                // Always close input frame to avoid leaks
                try {
                    frame.close?.();
                } catch { }
            }
        }
    };

    const stopWebCodecs = async () => {
        running = false;

        safe(() => abortCtl?.abort());
        abortCtl = null;

        // Close segmentation
        try {
            await seg?.close?.();
        } catch { }
        seg = null;
        segReady = false;
        segBusy = false;
        lastMask = null;
        lastSegAt = 0;

        // Close reader/writer
        try {
            await reader?.cancel?.();
        } catch { }
        try {
            await writer?.close?.();
        } catch { }

        safe(() => reader?.releaseLock?.());
        safe(() => writer?.releaseLock?.());

        reader = null;
        writer = null;

        // Stop tracks we created (generator track). Audio passthrough is owned by input stream.
        stopTracks(outStream);
        outStream = null;

        processor = null;
        generator = null;

        drawCanvas = null;
        drawCtx = null;

        segCanvas = null;
        segCtx = null;

        bgImage = null;
        inputStream = null;
    };

    const startEffect = async (input: MediaStream): Promise<MediaStream> => {
        inputStream = input;

        const videoTrack = input.getVideoTracks?.()?.[0] || null;
        if (!videoTrack) {
            // No video -> passthrough (audio only)
            return new MediaStream(input.getTracks?.() || []);
        }

        running = true;

        // Kick the loop (do not await forever)
        startWebCodecsLoop(videoTrack).catch(() => {
            // If WebCodecs path fails mid-flight, fall back to DOM pipeline best-effort
            // (but we must stop current objects first).
            void stopWebCodecs();
        });

        // outStream is created synchronously after generator, but loop creates it.
        // Wait a tiny bit for outStream to be ready.
        const t0 = Date.now();
        while (!outStream && Date.now() - t0 < 800) {
            await sleep(10);
        }

        if (outStream) return outStream;

        // Worst case: fallback to DOM effect
        const fb = createDomFallbackEffect(opts);
        return await Promise.resolve(fb.startEffect(input));
    };

    const stopEffect = async () => {
        await stopWebCodecs();
    };

    const dispose = async () => {
        await stopWebCodecs();
    };

    return { startEffect, stopEffect, dispose };
}