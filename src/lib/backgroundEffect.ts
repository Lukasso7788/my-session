// src/lib/backgroundEffect.ts
// Canvas + (optional) MediaPipe SelfieSegmentation background effects.
// Used by jitsiEngine replaceTrack pipeline (can be async safely).
//
// ✅ This revision implements: "separate rates: draw vs segmentation + mask smoothing"
// - drawFps: higher (keeps stream alive / smooth)
// - segFps: lower (saves CPU)
// - between seg runs: reuse lastMask
// - temporal smoothing: exponential moving average on mask alpha using an extra mask canvas
//
// Debug (optional):
//   (window as any).__BGFX_DEBUG__ = true;

export type BgMode = "none" | "blur" | "image";

type CreateOpts = {
    mode: BgMode;
    imageUrl?: string;
    blurPx?: number; // default 10
    fps?: number; // default 30 (draw fps)
    maxWidth?: number; // default 1280
    // Optional tuning knobs (safe defaults if omitted)
    segFps?: number; // default min(10, fps)
    maskSmoothing?: number; // 0..0.95, default 0.75 (higher = smoother but more lag)
    maskBlurPx?: number; // default 2 (soften edges)
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

export function createBackgroundEffect(opts: CreateOpts): Processor {
    const mode: BgMode = opts.mode ?? "none";

    // Draw FPS (output stream pacing)
    const drawFps = clamp(opts.fps ?? 30, 5, 60);

    // Seg FPS (expensive step)
    const segFps = clamp(opts.segFps ?? Math.min(10, drawFps), 1, 30);

    const blurPx = clamp(opts.blurPx ?? 10, 0, 40);
    const maxWidth = clamp(opts.maxWidth ?? 1280, 320, 3840);

    // Mask smoothing parameters
    const maskSmoothing = clamp(opts.maskSmoothing ?? 0.75, 0, 0.95);
    const maskBlurPx = clamp(opts.maskBlurPx ?? 2, 0, 12);

    const DBG = !!(globalThis as any).__BGFX_DEBUG__;
    const log = (...a: any[]) => {
        if (DBG) console.log("[bgEffect]", ...a);
    };

    // Scheduler:
    // - draw loop drives canvas frames (keeps captureStream alive)
    // - segmentation loop runs inside draw tick but gated by segFps and segBusy (so it never overlaps)
    let running = false;

    let rafId: number | null = null;
    let timerId: number | null = null;
    let vfcId: number | null = null;

    let drawTickInFlight = false;

    let videoEl: HTMLVideoElement | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;

    let outStream: MediaStream | null = null;

    let bgImage: HTMLImageElement | null = null;

    // MediaPipe
    let seg: any | null = null;
    let segReady = false;
    let segBusy = false;

    // Raw mask from MediaPipe
    let lastRawMask: CanvasImageSource | null = null;

    // Smoothed mask state
    let maskCanvas: HTMLCanvasElement | null = null;
    let maskCtx: CanvasRenderingContext2D | null = null;
    let smoothedMaskValid = false;

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

        maskCanvas = null;
        maskCtx = null;
        smoothedMaskValid = false;
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
            if (
                vfcId != null &&
                videoEl &&
                typeof (videoEl as any).cancelVideoFrameCallback === "function"
            ) {
                (videoEl as any).cancelVideoFrameCallback(vfcId);
            }
        } catch { }
        vfcId = null;
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

    const ensureMaskCanvas = (w: number, h: number) => {
        if (maskCanvas && maskCtx) {
            if (maskCanvas.width !== w) maskCanvas.width = w;
            if (maskCanvas.height !== h) maskCanvas.height = h;
            return;
        }
        maskCanvas = document.createElement("canvas");
        maskCanvas.width = w;
        maskCanvas.height = h;
        maskCtx = maskCanvas.getContext("2d", { alpha: true });
        if (!maskCtx) throw new Error("Mask canvas 2D context not available");
        smoothedMaskValid = false;
    };

    // Blend raw mask into smoothed mask:
    // smoothed = alpha*prev + (1-alpha)*raw
    // Implemented with canvas compositing:
    // - draw prev with globalAlpha=alpha
    // - draw raw on top with globalAlpha=(1-alpha)
    // Optionally blur the result slightly to soften edges.
    const updateSmoothedMask = (rawMask: CanvasImageSource, w: number, h: number) => {
        if (!maskCtx || !maskCanvas) return;

        maskCtx.save();
        maskCtx.globalCompositeOperation = "source-over";
        maskCtx.clearRect(0, 0, w, h);

        if (smoothedMaskValid) {
            // prev * alpha
            maskCtx.globalAlpha = maskSmoothing;
            maskCtx.drawImage(maskCanvas, 0, 0, w, h);
        }

        // raw * (1-alpha)
        maskCtx.globalAlpha = smoothedMaskValid ? 1 - maskSmoothing : 1;
        maskCtx.drawImage(rawMask, 0, 0, w, h);

        maskCtx.restore();
        smoothedMaskValid = true;

        if (maskBlurPx > 0) {
            // Soft blur pass for edges. (Cheap-ish, but still ok because segFps is low)
            const tmp = document.createElement("canvas");
            tmp.width = w;
            tmp.height = h;
            const tctx = tmp.getContext("2d", { alpha: true });
            if (tctx) {
                tctx.filter = `blur(${maskBlurPx}px)`;
                tctx.drawImage(maskCanvas, 0, 0, w, h);
                tctx.filter = "none";
                maskCtx.clearRect(0, 0, w, h);
                maskCtx.drawImage(tmp, 0, 0, w, h);
            }
        }
    };

    const drawNoSegFallback = () => {
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

    const drawWithMask = (maskSource: CanvasImageSource) => {
        if (!running || !videoEl || !canvas || !ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        // 1) Foreground (person)
        ctx.save();
        ctx.drawImage(videoEl, 0, 0, w, h);
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(maskSource, 0, 0, w, h);
        ctx.restore();

        // 2) Background behind person
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

    const maybeRunSegmentation = async () => {
        if (!running || !seg || !segReady || segBusy || !videoEl || !canvas) return;

        const now = performance.now();
        const interval = 1000 / segFps;
        if (now - lastSegAt < interval) return;
        lastSegAt = now;

        segBusy = true;
        try {
            // MediaPipe expects an HTMLVideoElement / HTMLImageElement / Canvas
            await seg.send({ image: videoEl });
        } catch {
            // ignore
        } finally {
            segBusy = false;
        }

        // If we got a new raw mask, update smoothed mask
        const raw = lastRawMask;
        if (raw) {
            try {
                ensureMaskCanvas(canvas.width, canvas.height);
                updateSmoothedMask(raw, canvas.width, canvas.height);
            } catch {
                // ignore
            }
        }
    };

    const scheduleNextDraw = () => {
        if (!running) return;

        clearScheduled();

        // Hidden => timers (RAF can stop entirely)
        if (document.visibilityState !== "visible") {
            const ms = Math.max(33, Math.round(1000 / drawFps));
            timerId = window.setTimeout(() => {
                timerId = null;
                void drawTick();
            }, ms) as any;
            return;
        }

        // Visible => prefer VFC, fallback RAF
        if (shouldUseVFC()) {
            try {
                vfcId = (videoEl as any).requestVideoFrameCallback(() => {
                    vfcId = null;
                    void drawTick();
                });
                return;
            } catch {
                // fall through
            }
        }

        rafId = requestAnimationFrame(() => {
            rafId = null;
            void drawTick();
        });
    };

    const drawTick = async () => {
        if (!running) return;

        if (drawTickInFlight) {
            scheduleNextDraw();
            return;
        }

        drawTickInFlight = true;
        try {
            // 1) Draw current frame using *last smoothed mask* if available
            if (segReady && smoothedMaskValid && maskCanvas && (mode === "blur" || mode === "image")) {
                drawWithMask(maskCanvas);
            } else if (segReady && lastRawMask && (mode === "blur" || mode === "image")) {
                // If smoothing not ready yet, but we have a raw mask, use it
                drawWithMask(lastRawMask);
            } else {
                // No mask available or mode none
                drawNoSegFallback();
            }

            // 2) Run segmentation at lower fps (async, non-overlapping)
            if (mode !== "none") {
                await maybeRunSegmentation();
            }
        } finally {
            drawTickInFlight = false;
            scheduleNextDraw();
        }
    };

    const onVisibility = () => {
        if (!running) return;
        scheduleNextDraw();
    };

    const startEffect = async (input: MediaStream): Promise<MediaStream> => {
        log("startEffect", { mode, drawFps, segFps, maskSmoothing, maskBlurPx });

        // Prepare video element
        videoEl = document.createElement("video");
        videoEl.playsInline = true;
        videoEl.muted = true;
        videoEl.autoplay = true;
        (videoEl as any).srcObject = input;

        // Try play (some browsers may still allow because stream is from getUserMedia)
        try {
            await videoEl.play().catch(() => { });
        } catch { }

        // Wait for metadata
        const t0 = Date.now();
        while (Date.now() - t0 < 1200) {
            const vw = videoEl.videoWidth || 0;
            const vh = videoEl.videoHeight || 0;
            if (vw > 0 && vh > 0) break;
            await sleep(50);
        }

        const vw0 = videoEl.videoWidth || 640;
        const vh0 = videoEl.videoHeight || 360;

        // scale down if huge
        const scale = vw0 > maxWidth ? maxWidth / vw0 : 1;
        const vw = Math.round(vw0 * scale);
        const vh = Math.round(vh0 * scale);

        canvas = document.createElement("canvas");
        canvas.width = vw;
        canvas.height = vh;
        ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) throw new Error("Canvas 2D context not available");

        // Output stream
        outStream = canvas.captureStream(drawFps);

        // Load background image if needed
        if (mode === "image" && opts.imageUrl) {
            try {
                bgImage = await loadImage(opts.imageUrl);
            } catch {
                bgImage = null;
            }
        }

        // Try init MediaPipe segmentation (only if effect needs it)
        seg = null;
        segReady = false;
        segBusy = false;
        lastRawMask = null;
        lastSegAt = 0;
        smoothedMaskValid = false;

        if (mode !== "none") {
            seg = await tryCreateSelfieSegmentation();
            if (seg) {
                try {
                    seg.onResults((res: any) => {
                        if (res?.segmentationMask) {
                            lastRawMask = res.segmentationMask as any;
                        }
                    });
                    segReady = true;
                    log("MediaPipe segmentation enabled");
                } catch {
                    seg = null;
                    segReady = false;
                }
            } else {
                log("MediaPipe segmentation NOT available (fallback blur-whole-frame or raw)");
            }
        }

        running = true;
        drawTickInFlight = false;

        try {
            document.addEventListener("visibilitychange", onVisibility);
        } catch { }

        scheduleNextDraw();
        return outStream;
    };

    const stopEffect = async () => {
        log("stopEffect");
        running = false;

        clearScheduled();

        try {
            document.removeEventListener("visibilitychange", onVisibility);
        } catch { }

        // Stop segmentation
        try {
            await seg?.close?.();
        } catch { }
        seg = null;
        segReady = false;
        segBusy = false;
        lastRawMask = null;
        lastSegAt = 0;

        smoothedMaskValid = false;
        maskCanvas = null;
        maskCtx = null;

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