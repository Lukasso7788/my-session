// src/lib/backgroundEffect.ts
// Canvas + (optional) MediaPipe SelfieSegmentation background effects.
// Used by jitsiEngine replaceTrack pipeline (can be async safely).
//
// Variant: WebCodecs output (NO canvas.captureStream):
// - produce MediaStreamTrack via MediaStreamTrackGenerator
// - push VideoFrame вручную (полный контроль cadence)
// - scheduler не “паузается” на hidden: используем таймеры
//
// Notes:
// - Если WebCodecs/TrackGenerator не поддерживаются (часто Safari) — есть аккуратный fallback на captureStream,
//   иначе эффект вообще не будет работать. Если хочешь “жёстко без fallback” — скажи, вырежу.

export type BgMode = "none" | "blur" | "image";

type CreateOpts = {
    mode: BgMode;
    imageUrl?: string;
    blurPx?: number; // default 10
    fps?: number; // default 30
    maxWidth?: number; // default 1280

    // optional knobs (safe defaults)
    maskFps?: number; // default min(fps, 12)
    blurCacheFps?: number; // default min(fps, 12)
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
    // NOTE: For this to truly be "optional" at runtime, your bundler must be able to resolve this import.
    // The simplest path: install the package:
    //   npm i @mediapipe/selfie_segmentation
    try {
        const mod: any = await import("@mediapipe/selfie_segmentation");
        const SelfieSegmentation = mod?.SelfieSegmentation;
        if (!SelfieSegmentation) return null;

        const seg = new SelfieSegmentation({
            locateFile: (file: string) =>
                `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
        });

        seg.setOptions({
            modelSelection: 1,
        });

        return seg;
    } catch {
        return null;
    }
}

export function createBackgroundEffect(opts: CreateOpts): Processor {
    const mode: BgMode = opts.mode ?? "none";
    const fps = clamp(opts.fps ?? 30, 5, 60);
    const blurPx = clamp(opts.blurPx ?? 10, 0, 40);
    const maxWidth = clamp(opts.maxWidth ?? 1280, 320, 3840);

    const maskFps = clamp(opts.maskFps ?? Math.min(fps, 12), 1, 30);
    const blurCacheFps = clamp(opts.blurCacheFps ?? Math.min(fps, 12), 1, 30);

    let running = false;

    let rafId: number | null = null;
    let timerId: number | null = null;
    let vfcId: number | null = null;

    let tickInFlight = false;

    let videoEl: HTMLVideoElement | null = null;

    // render target (CPU/GPU drawing)
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;

    // pre-blur cache
    let blurCanvas: HTMLCanvasElement | null = null;
    let blurCtx: CanvasRenderingContext2D | null = null;
    let lastBlurAt = 0;
    let lastBlurVideoTime = -1;

    // Output
    let outStream: MediaStream | null = null;

    // WebCodecs generator path
    let genTrack: MediaStreamTrack | null = null;
    let genWriter: WritableStreamDefaultWriter<any> | null = null;

    // Fallback path (only if generator not supported)
    let fallbackCaptureStream: MediaStream | null = null;

    let inputStream: MediaStream | null = null;
    let bgImage: HTMLImageElement | null = null;

    // MediaPipe
    let seg: any | null = null;
    let lastMask: CanvasImageSource | null = null;
    let segReady = false;
    let segBusy = false;
    let lastSegAt = 0;

    const safeNowMs = () => {
        try {
            return typeof performance !== "undefined" ? performance.now() : Date.now();
        } catch {
            return Date.now();
        }
    };

    const nowUs = () => {
        // VideoFrame timestamp expects microseconds
        return Math.max(0, Math.round(safeNowMs() * 1000));
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

        blurCanvas = null;
        blurCtx = null;
        lastBlurAt = 0;
        lastBlurVideoTime = -1;
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

        // avoid duplicates on flips
        clearScheduled();

        // Hidden => timers (RAF may stop entirely). We DO NOT pause on hidden.
        if (document.visibilityState !== "visible") {
            const ms = Math.max(33, Math.round(1000 / fps));
            timerId = window.setTimeout(() => {
                timerId = null;
                void tickAndReschedule();
            }, ms) as any;
            return;
        }

        // Visible => prefer VFC, fallback RAF
        if (shouldUseVFC()) {
            try {
                vfcId = (videoEl as any).requestVideoFrameCallback(() => {
                    vfcId = null;
                    void tickAndReschedule();
                });
                return;
            } catch {
                // fallthrough
            }
        }

        rafId = requestAnimationFrame(() => {
            rafId = null;
            void tickAndReschedule();
        });
    };

    const maybeUpdateBlurCache = () => {
        if (!running) return;
        if (mode !== "blur") return;
        if (!videoEl || !blurCanvas || !blurCtx) return;

        const now = safeNowMs();
        const interval = 1000 / blurCacheFps;

        const vt = Number(videoEl.currentTime || 0);
        if (now - lastBlurAt < interval && vt === lastBlurVideoTime) return;

        lastBlurAt = now;
        lastBlurVideoTime = vt;

        const w = blurCanvas.width;
        const h = blurCanvas.height;

        try {
            blurCtx.clearRect(0, 0, w, h);
            blurCtx.filter = `blur(${blurPx}px)`;
            blurCtx.drawImage(videoEl, 0, 0, w, h);
        } catch {
            // ignore
        } finally {
            try {
                blurCtx.filter = "none";
            } catch { }
        }
    };

    const drawRawVideo = () => {
        if (!videoEl || !canvas || !ctx) return;
        try {
            ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        } catch {
            // ignore
        }
    };

    const drawBlurredBackground = () => {
        if (!canvas || !ctx) return;

        // keep cache warm
        maybeUpdateBlurCache();

        try {
            if (blurCanvas) {
                ctx.drawImage(blurCanvas, 0, 0, canvas.width, canvas.height);
                return;
            }
        } catch {
            // fallthrough
        }

        // absolute fallback: blur directly
        if (videoEl) {
            try {
                ctx.filter = `blur(${blurPx}px)`;
                ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
            } catch {
                // ignore
            } finally {
                try {
                    ctx.filter = "none";
                } catch { }
            }
        }
    };

    const tickDrawFallback = () => {
        if (!running || !videoEl || !canvas || !ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        try {
            ctx.clearRect(0, 0, w, h);
        } catch { }

        if (mode === "blur") {
            drawBlurredBackground();
            return;
        }

        // image/none w/o mask -> raw
        drawRawVideo();
    };

    const tickDrawWithMask = () => {
        if (!running || !videoEl || !canvas || !ctx) return;
        const w = canvas.width;
        const h = canvas.height;

        try {
            ctx.clearRect(0, 0, w, h);
        } catch { }

        // 1) Foreground (person)
        try {
            ctx.save();
            drawRawVideo();
            ctx.globalCompositeOperation = "destination-in";
            if (lastMask) ctx.drawImage(lastMask, 0, 0, w, h);
            ctx.restore();
        } catch {
            try {
                ctx.globalCompositeOperation = "source-over";
            } catch { }
        }

        // 2) Background behind person
        try {
            ctx.save();
            ctx.globalCompositeOperation = "destination-over";

            if (mode === "image" && bgImage) {
                ctx.drawImage(bgImage, 0, 0, w, h);
            } else if (mode === "blur") {
                drawBlurredBackground();
            } else {
                drawRawVideo();
            }

            ctx.restore();
            ctx.globalCompositeOperation = "source-over";
        } catch {
            try {
                ctx.globalCompositeOperation = "source-over";
            } catch { }
        }
    };

    const pushFrameToGenerator = async () => {
        if (!canvas || !genWriter) return;

        const VF: any = (window as any).VideoFrame;
        if (!VF) return;

        // Backpressure: if stream queue is full, лучше дропнуть кадр, чем копить лаг.
        const desired = (genWriter as any).desiredSize;
        if (typeof desired === "number" && desired <= 0) return;

        let frame: any | null = null;
        try {
            frame = new VF(canvas, { timestamp: nowUs() });
            // write can be async; keep it awaited so we don't balloon the queue
            await genWriter.write(frame);
        } catch {
            // ignore
        } finally {
            try {
                frame?.close?.();
            } catch { }
        }
    };

    const tickAndReschedule = async () => {
        if (!running) return;

        if (tickInFlight) {
            scheduleNext();
            return;
        }

        tickInFlight = true;
        try {
            // warm blur cache
            if (mode === "blur") {
                try {
                    maybeUpdateBlurCache();
                } catch { }
            }

            // draw
            try {
                if (segReady && lastMask) tickDrawWithMask();
                else tickDrawFallback();
            } catch {
                // ignore
            }

            // push frame out (generator preferred; fallback captureStream does it automatically)
            if (genWriter) {
                await pushFrameToGenerator();
            }

            // segmentation step (async) — throttle to maskFps
            if (seg && segReady && !segBusy && videoEl) {
                const now = safeNowMs();
                const interval = 1000 / maskFps;

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
        // We reschedule immediately on visibility flips.
        scheduleNext();
    };

    const startEffect = async (input: MediaStream): Promise<MediaStream> => {
        inputStream = input;

        // Prepare video element
        videoEl = document.createElement("video");
        videoEl.playsInline = true;
        videoEl.muted = true;
        videoEl.autoplay = true;
        (videoEl as any).srcObject = input;

        try {
            await videoEl.play().catch(() => { });
        } catch { }

        // wait metadata so we know dimensions
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

        canvas = document.createElement("canvas");
        canvas.width = vw;
        canvas.height = vh;
        ctx = canvas.getContext("2d", { alpha: true });

        if (!ctx) throw new Error("Canvas 2D context not available");

        // Pre-blur cache setup (only blur mode)
        if (mode === "blur") {
            blurCanvas = document.createElement("canvas");
            blurCanvas.width = vw;
            blurCanvas.height = vh;
            blurCtx = blurCanvas.getContext("2d", { alpha: false });
            lastBlurAt = 0;
            lastBlurVideoTime = -1;
        } else {
            blurCanvas = null;
            blurCtx = null;
        }

        // Load background image if needed
        if (mode === "image" && opts.imageUrl) {
            try {
                bgImage = await loadImage(opts.imageUrl);
            } catch {
                bgImage = null;
            }
        }

        // Try init MediaPipe segmentation
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

        // Output: WebCodecs generator if possible
        const TG: any = (window as any).MediaStreamTrackGenerator;
        const VF: any = (window as any).VideoFrame;

        if (TG && VF) {
            try {
                const gen: any = new TG({ kind: "video" });
                genTrack = gen as MediaStreamTrack;
                genWriter = gen.writable.getWriter();

                outStream = new MediaStream([genTrack]);
            } catch {
                genTrack = null;
                genWriter = null;
                outStream = null;
            }
        }

        // Fallback if generator is not available / failed
        if (!outStream) {
            // If you truly want ZERO captureStream usage ever, replace this with:
            // throw new Error("WebCodecs MediaStreamTrackGenerator/VideoFrame not supported in this browser");
            fallbackCaptureStream = canvas.captureStream(fps);
            outStream = fallbackCaptureStream;
        }

        running = true;
        tickInFlight = false;
        lastSegAt = 0;

        // warm blur cache immediately
        if (mode === "blur") {
            try {
                maybeUpdateBlurCache();
            } catch { }
        }

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

        // Stop segmentation
        try {
            await seg?.close?.();
        } catch { }
        seg = null;
        segReady = false;
        segBusy = false;
        lastMask = null;
        lastSegAt = 0;

        // Stop WebCodecs output
        try {
            if (genWriter) {
                try {
                    await genWriter.close();
                } catch { }
                try {
                    genWriter.releaseLock();
                } catch { }
            }
        } catch { }
        genWriter = null;

        try {
            genTrack?.stop?.();
        } catch { }
        genTrack = null;

        // Stop fallback captureStream tracks (ONLY output, not input camera)
        if (fallbackCaptureStream) {
            stopTracks(fallbackCaptureStream);
            fallbackCaptureStream = null;
        }

        outStream = null;
        cleanupDom();
    };

    const dispose = async () => {
        await stopEffect();
        bgImage = null;
        inputStream = null;
    };

    return { startEffect, stopEffect, dispose };
}