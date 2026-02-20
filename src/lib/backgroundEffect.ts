// src/lib/backgroundEffect.ts
// Canvas + (optional) MediaPipe SelfieSegmentation background effects.
// Used by jitsiEngine replaceTrack pipeline (can be async safely).
//
// Variant: "Freeze-frame keepalive" on hidden tab
// - When tab becomes hidden:
//   1) capture the LAST GOOD composited canvas frame into ImageBitmap
//   2) in hidden mode: DO NOT read videoEl, DO NOT run segmentation
//   3) just redraw the frozen ImageBitmap every 500–1000ms (keepalive)
// - When tab becomes visible again:
//   1) "warm-up" a few quick draws from video WITHOUT segmentation
//   2) then resume segmentation normally
//
// Goal: stop the blur/mask pipeline from freaking out on visibility switching.

export type BgMode = "none" | "blur" | "image";

type CreateOpts = {
    mode: BgMode;
    imageUrl?: string;
    blurPx?: number; // default 10
    fps?: number; // default 30
    maxWidth?: number; // default 1280

    // Optional knobs (safe defaults)
    debug?: boolean; // default: true on localhost
    hiddenFreezeMs?: number; // default 750 (500-1000ms zone)
    warmupFrames?: number; // default 8
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

    const hiddenFreezeMs = clamp(opts.hiddenFreezeMs ?? 750, 200, 5000);
    const warmupFramesInit = clamp(opts.warmupFrames ?? 8, 0, 30);

    const debugDefault = (() => {
        try {
            const host = String((window as any)?.location?.hostname ?? "");
            return host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
        } catch {
            return true;
        }
    })();
    const debug = opts.debug ?? debugDefault;
    const log = (...args: any[]) => {
        if (!debug) return;
        try {
            // eslint-disable-next-line no-console
            console.debug("[bgEffect]", ...args);
        } catch { }
    };

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

    // Freeze-frame keepalive
    let frozenBitmap: ImageBitmap | null = null;
    let isFrozen = false;
    let warmupFramesLeft = 0;

    // Frame gating (draw only when new frame arrives, unless frozen)
    let lastFrameToken: number | null = null;

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

    const isVisibleNow = () => {
        try {
            return document.visibilityState === "visible";
        } catch {
            return true;
        }
    };

    const shouldUseVFC = () => {
        try {
            return (
                isVisibleNow() &&
                !!videoEl &&
                typeof (videoEl as any).requestVideoFrameCallback === "function"
            );
        } catch {
            return false;
        }
    };

    const getFrameToken = () => {
        if (!videoEl) return null;
        try {
            const anyV: any = videoEl as any;
            const dfc = Number(anyV.webkitDecodedFrameCount);
            if (Number.isFinite(dfc) && dfc > 0) return dfc;

            const ct = Number(videoEl.currentTime);
            if (Number.isFinite(ct)) return ct;

            return null;
        } catch {
            return null;
        }
    };

    const drawFrozen = () => {
        if (!running || !canvas || !ctx || !frozenBitmap) return;
        const w = canvas.width;
        const h = canvas.height;
        try {
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(frozenBitmap, 0, 0, w, h);
        } catch {
            // ignore
        }
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

    const captureFreezeFrame = async () => {
        if (!canvas) return;
        // capture from CANVAS (already composited) — best for "freeze final output"
        try {
            // Close previous bitmap to avoid leaks
            try {
                frozenBitmap?.close?.();
            } catch { }
            frozenBitmap = null;

            // createImageBitmap(canvas) is async and fast
            frozenBitmap = await createImageBitmap(canvas);
            log("freeze captured", {
                w: canvas.width,
                h: canvas.height,
                hasBitmap: !!frozenBitmap,
            });
        } catch (e) {
            log("freeze capture failed", e);
            frozenBitmap = null;
        }
    };

    const enterFrozenMode = async () => {
        if (isFrozen) return;
        isFrozen = true;
        warmupFramesLeft = 0;

        // Ensure we have at least one composited frame on canvas before capturing
        try {
            if (segReady && lastMask) tickDrawWithMask();
            else tickDrawFallback();
        } catch { }

        await captureFreezeFrame();

        log("enter frozen (hidden) mode");
    };

    const exitFrozenMode = async () => {
        if (!isFrozen) return;
        isFrozen = false;

        // warm-up: draw N frames from video WITHOUT segmentation, then resume
        warmupFramesLeft = warmupFramesInit;

        // try to wake video playback just in case
        try {
            await videoEl?.play?.().catch(() => { });
        } catch { }

        log("exit frozen (visible) mode; warmupFrames =", warmupFramesLeft);
    };

    const scheduleNext = () => {
        if (!running) return;

        clearScheduled();

        const visible = isVisibleNow();

        // Frozen mode => fixed timer cadence (500–1000ms zone)
        if (!visible || isFrozen) {
            timerId = window.setTimeout(() => {
                timerId = null;
                void tickAndReschedule();
            }, hiddenFreezeMs) as any;
            return;
        }

        // Visible => prefer VFC, fallback RAF, else timer
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
            const visible = isVisibleNow();

            // Hidden or frozen => keepalive redraw ONLY (no video reads, no seg)
            if (!visible || isFrozen) {
                drawFrozen();
                return;
            }

            // Visible => only draw when a new frame arrived (big CPU win)
            const token = getFrameToken();
            const advanced = token != null && token !== lastFrameToken;

            if (advanced) lastFrameToken = token;

            if (!advanced && warmupFramesLeft <= 0) {
                // nothing new; skip
                return;
            }

            // Draw stage
            try {
                if (segReady && lastMask && warmupFramesLeft <= 0) tickDrawWithMask();
                else tickDrawFallback();
            } catch {
                // ignore draw errors
            }

            // Warmup counter
            if (warmupFramesLeft > 0) {
                warmupFramesLeft -= 1;
                // During warmup: do NOT run segmentation
                return;
            }

            // Segmentation step (async) — throttle to fps
            if (seg && segReady && !segBusy && videoEl && advanced) {
                const now = performance.now();
                const interval = 1000 / Math.max(1, fps);

                // You can also slow seg down separately; keep it simple here:
                // run seg at most ~10 fps
                const segInterval = Math.max(interval, 1000 / 10);

                if (now - lastSegAt >= segInterval) {
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

        const visible = isVisibleNow();
        log("visibilitychange =>", visible ? "visible" : "hidden");

        // Switch modes
        if (!visible) {
            void enterFrozenMode().finally(() => {
                scheduleNext();
            });
            return;
        }

        void exitFrozenMode().finally(() => {
            scheduleNext();
        });
    };

    const startEffect = async (input: MediaStream): Promise<MediaStream> => {
        inputStream = input;

        log("startEffect()", { mode, fps, blurPx, maxWidth });

        // Prepare video element
        videoEl = document.createElement("video");
        videoEl.playsInline = true;
        videoEl.muted = true;
        videoEl.autoplay = true;
        (videoEl as any).srcObject = input;

        // Try to play (muted+autoplay should be okay)
        try {
            await videoEl.play().catch((e) => log("videoEl.play() blocked/fail:", e));
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
                log("MediaPipe READY");
            } catch (e) {
                log("MediaPipe init failed:", e);
                seg = null;
                segReady = false;
            }
        } else {
            log("MediaPipe not available (fallback)");
        }

        running = true;
        tickInFlight = false;
        lastSegAt = 0;
        lastFrameToken = null;
        warmupFramesLeft = warmupFramesInit;

        // If we start already hidden, freeze immediately (prevents "never started" feel)
        if (!isVisibleNow()) {
            await enterFrozenMode();
        }

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

        // Release frozen bitmap
        try {
            frozenBitmap?.close?.();
        } catch { }
        frozenBitmap = null;
        isFrozen = false;
        warmupFramesLeft = 0;

        // Stop output tracks (canvas stream)
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