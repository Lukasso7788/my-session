// src/lib/backgroundEffect.ts
// Canvas + (optional) MediaPipe SelfieSegmentation background effects.
// Used by jitsiEngine replaceTrack pipeline (can be async safely).
//
// ✅ This version adds:
// 1) Frame-advance gating (ONLY draw/seg when a NEW video frame actually arrived)
//    - uses videoEl.webkitDecodedFrameCount when available, else videoEl.currentTime
// 2) Background policy (stable + low CPU in hidden tab):
//    - visible: schedule at opts.fps, seg <= 10 fps
//    - hidden: schedule at ~8 fps (or lower), seg <= 2 fps
//    - keep-alive redraw in hidden if frames stall (prevents "stuck" stream behavior in some setups)
// 3) Debug logs (opt-in via opts.debug, defaults to true in dev-ish environments)
//    - you should finally SEE in console when it starts/stops + what mode it's in.

export type BgMode = "none" | "blur" | "image";

type CreateOpts = {
    mode: BgMode;
    imageUrl?: string;
    blurPx?: number; // default 10
    fps?: number; // default 30
    maxWidth?: number; // default 1280

    // New:
    debug?: boolean; // default: true (dev), false (prod)
    hiddenFps?: number; // default: min(8, fps)
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
            modelSelection: 1, // 0 = general, 1 = landscape (usually better)
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

    // Background policy
    const hiddenFps = clamp(opts.hiddenFps ?? Math.min(8, fps), 1, fps);
    const segFpsVisible = Math.min(10, fps);
    const segFpsHidden = Math.min(2, segFpsVisible);

    // Debug
    const debugDefault =
        (() => {
            try {
                // try to be loud in dev, quiet in prod. If unsure -> loud (you asked for console signs).
                const anyWin: any = window as any;
                const host = String(anyWin?.location?.hostname ?? "");
                const isLocal =
                    host === "localhost" ||
                    host === "127.0.0.1" ||
                    host.endsWith(".local") ||
                    host === "";
                return isLocal;
            } catch {
                return true;
            }
        })() ?? true;

    const debug = opts.debug ?? debugDefault;

    const log = (...args: any[]) => {
        if (!debug) return;
        try {
            // eslint-disable-next-line no-console
            console.debug("[bgEffect]", ...args);
        } catch { }
    };

    // IMPORTANT:
    // We intentionally do NOT rely purely on requestAnimationFrame.
    // When the tab is hidden, RAF can effectively stop. That can freeze the outgoing canvas stream.
    // Instead we use a hybrid scheduler:
    // - visible: prefer requestVideoFrameCallback (best), else RAF
    // - hidden: use setTimeout (timers get throttled, but they still tick -> stream stays alive)
    let running = false;

    let rafId: number | null = null;
    let timerId: number | null = null;
    let vfcId: number | null = null;

    let tickInFlight = false;

    let videoEl: HTMLVideoElement | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;

    let outStream: MediaStream | null = null;
    let inputStream: MediaStream | null = null;

    let bgImage: HTMLImageElement | null = null;

    // MediaPipe
    let seg: any | null = null;
    let lastMask: CanvasImageSource | null = null;
    let segReady = false;
    let segBusy = false;
    let lastSegAt = 0;

    // Frame-advance gating
    // We only draw/seg when a NEW frame has arrived from the <video>.
    // Token can be webkitDecodedFrameCount (best), else currentTime.
    let lastFrameToken: number | null = null;
    let lastPaintAt = 0;

    // Hidden keep-alive: even if frames stall, redraw occasionally so captureStream keeps producing.
    const HIDDEN_KEEPALIVE_MS = 450; // conservative
    const VISIBLE_KEEPALIVE_MS = 0; // visible doesn't need it

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

        // mode === "image" or "none" but no segmentation -> just draw the raw frame
        ctx.drawImage(videoEl, 0, 0, w, h);
    };

    const tickDrawWithMask = () => {
        if (!running || !videoEl || !canvas || !ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        // 1) Draw person (foreground) using mask
        ctx.save();
        ctx.drawImage(videoEl, 0, 0, w, h);
        ctx.globalCompositeOperation = "destination-in";
        if (lastMask) ctx.drawImage(lastMask, 0, 0, w, h);
        ctx.restore();

        // 2) Draw background behind person
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
        // Prefer requestVideoFrameCallback when visible (better pacing than RAF).
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

    const isVisibleNow = () => {
        try {
            return document.visibilityState === "visible";
        } catch {
            return true;
        }
    };

    const getFrameToken = () => {
        if (!videoEl) return null;
        try {
            const anyV: any = videoEl as any;

            // Best: decoded frame counter (Chromium)
            const dfc = Number(anyV.webkitDecodedFrameCount);
            if (Number.isFinite(dfc) && dfc > 0) return dfc;

            // Fallback: currentTime
            const ct = Number(videoEl.currentTime);
            if (Number.isFinite(ct)) return ct;

            return null;
        } catch {
            return null;
        }
    };

    const scheduleNext = () => {
        if (!running) return;

        clearScheduled();

        const visible = isVisibleNow();
        const target = visible ? fps : hiddenFps;
        const ms = Math.max(5, Math.round(1000 / Math.max(1, target)));

        // Hidden => timers (RAF can stop entirely)
        if (!visible) {
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
                // fall through to RAF
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
            const visible = isVisibleNow();
            const now = performance.now();

            const token = getFrameToken();
            const frameAdvanced = token != null && token !== lastFrameToken;

            // Keep-alive redraw policy:
            // - If frame didn't advance, we typically do nothing (big CPU win).
            // - But in hidden mode, if nothing was painted for a while, redraw anyway to keep captureStream alive.
            const keepAliveMs = visible ? VISIBLE_KEEPALIVE_MS : HIDDEN_KEEPALIVE_MS;
            const allowKeepAlive = keepAliveMs > 0 && now - lastPaintAt >= keepAliveMs;

            const shouldPaint = frameAdvanced || allowKeepAlive;

            if (frameAdvanced) lastFrameToken = token;

            if (shouldPaint) {
                try {
                    if (segReady && lastMask) tickDrawWithMask();
                    else tickDrawFallback();
                    lastPaintAt = now;
                } catch {
                    // ignore draw errors
                }
            }

            // Segmentation: run ONLY when a NEW frame arrived (strict gating),
            // and also throttle it with segFpsVisible/segFpsHidden.
            if (seg && segReady && !segBusy && videoEl && frameAdvanced) {
                const segFps = visible ? segFpsVisible : segFpsHidden;
                const interval = 1000 / Math.max(1, segFps);

                if (now - lastSegAt >= interval) {
                    lastSegAt = now;
                    segBusy = true;
                    try {
                        await seg.send({ image: videoEl });
                    } catch {
                        // ignore segmentation errors, keep fallback drawing
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
        log("visibilitychange =>", isVisibleNow() ? "visible" : "hidden");
        // reschedule immediately so we don't get stuck in paused RAF or throttled timer
        scheduleNext();
    };

    const startEffect = async (input: MediaStream): Promise<MediaStream> => {
        inputStream = input;

        log("startEffect()", {
            mode,
            fps,
            hiddenFps,
            blurPx,
            maxWidth,
            hasVideo: !!input?.getVideoTracks?.()?.[0],
        });

        // Prepare video element
        videoEl = document.createElement("video");
        videoEl.playsInline = true;
        videoEl.muted = true;
        videoEl.autoplay = true;
        (videoEl as any).srcObject = input;

        // Try to play (may be blocked in some contexts, but with muted+autoplay it usually works)
        try {
            await videoEl.play().catch((e) => {
                log("videoEl.play() blocked/fail:", e);
            });
        } catch (e) {
            log("videoEl.play() throw:", e);
        }

        // Wait for metadata so we know dimensions
        const t0 = Date.now();
        while (Date.now() - t0 < 1500) {
            const vw = videoEl.videoWidth || 0;
            const vh = videoEl.videoHeight || 0;
            if (vw > 0 && vh > 0) break;
            await sleep(50);
        }

        const vw0 = videoEl.videoWidth || 640;
        const vh0 = videoEl.videoHeight || 360;

        // scale down if huge
        const scale = vw0 > maxWidth ? maxWidth / vw0 : 1;
        const vw = Math.max(2, Math.round(vw0 * scale));
        const vh = Math.max(2, Math.round(vh0 * scale));

        canvas = document.createElement("canvas");
        canvas.width = vw;
        canvas.height = vh;
        ctx = canvas.getContext("2d", { alpha: true });

        if (!ctx) throw new Error("Canvas 2D context not available");

        // Output stream
        // Note: captureStream will attempt to push frames at fps; our gating reduces how often the canvas changes (CPU win).
        outStream = canvas.captureStream(fps);

        // Load background image if needed
        if (mode === "image" && opts.imageUrl) {
            try {
                bgImage = await loadImage(opts.imageUrl);
            } catch (e) {
                log("bg image load failed:", e);
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
                log("MediaPipe SelfieSegmentation: READY");
            } catch (e) {
                log("MediaPipe init failed:", e);
                seg = null;
                segReady = false;
            }
        } else {
            log("MediaPipe SelfieSegmentation: not available (fallback mode)");
        }

        running = true;
        tickInFlight = false;
        lastSegAt = 0;
        lastFrameToken = null;
        lastPaintAt = 0;

        // Listen to visibility so we can swap scheduler mode instantly.
        try {
            document.addEventListener("visibilitychange", onVisibility);
        } catch { }

        // Kick scheduler
        scheduleNext();

        return outStream;
    };

    const stopEffect = async () => {
        if (!running) return;
        log("stopEffect()");

        running = false;

        // Stop scheduler
        clearScheduled();

        // Remove visibility listener
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

        // Only stop output tracks (canvas stream)
        stopTracks(outStream);
        outStream = null;

        cleanupDom();
    };

    const dispose = async () => {
        log("dispose()");
        await stopEffect();
        bgImage = null;
        inputStream = null;
    };

    return { startEffect, stopEffect, dispose };
}