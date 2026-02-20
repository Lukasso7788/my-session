// src/lib/backgroundEffect.ts
// Canvas + (optional) MediaPipe SelfieSegmentation background effects.
// Used by jitsiEngine replaceTrack pipeline (can be async safely).
//
// ✅ This version adds an adaptive "degrader" (auto quality scaler) based on runtime metrics,
// WITHOUT restarting captureStream or replacing tracks (no flicker).
//
// Key idea:
// - outCanvas (fixed size) -> captureStream(fps) from this canvas
// - workCanvas (adaptive size) -> all heavy work (blur + segmentation compositing) happens here
// - then we upscale workCanvas onto outCanvas each tick
//
// Degrader steps (down/up):
// 1) lower segmentation FPS
// 2) lower work resolution (workMaxWidth) (keeps out resolution unchanged)
// 3) lower blurPx
// 4) disable segmentation (segFps=0 -> fallback only)
//
// Hidden tab behavior:
// - by default we keep drawing, but switch to low hiddenFps and disable segmentation
// - you can opt to ignore visibility throttling via opts.ignoreVisibility=true (not recommended for CPU)
//
// Debug:
// - logs enabled by default on localhost (or opts.debug=true)

export type BgMode = "none" | "blur" | "image";

type CreateOpts = {
    mode: BgMode;
    imageUrl?: string;
    blurPx?: number; // default 10
    fps?: number; // default 30
    maxWidth?: number; // default 1280

    // Optional knobs:
    debug?: boolean; // default true on localhost
    hiddenFps?: number; // default 1.5 keepalive while hidden
    ignoreVisibility?: boolean; // default false

    // Degrader tuning:
    enableDegrader?: boolean; // default true
    degradeWindowMs?: number; // default 2500
    upgradeWindowMs?: number; // default 8000
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
    // NOTE: bundler must be able to resolve this import. If not installed, keep try/catch.
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

// -------------------------
// Degrader configuration
// -------------------------
type QualityLevel = {
    name: string;
    workMaxWidth: number; // heavy-work resolution cap (NOT the output resolution)
    segFps: number; // 0 disables segmentation
    blurPx: number;
};

const QUALITY_LADDER: QualityLevel[] = [
    { name: "Q0-ultra", workMaxWidth: 1280, segFps: 10, blurPx: 10 },
    { name: "Q1-high", workMaxWidth: 960, segFps: 8, blurPx: 8 },
    { name: "Q2-med", workMaxWidth: 640, segFps: 6, blurPx: 6 },
    { name: "Q3-low", workMaxWidth: 480, segFps: 3, blurPx: 4 },
    { name: "Q4-min", workMaxWidth: 360, segFps: 0, blurPx: 2 }, // fallback-only
];

// Thresholds (tune if needed)
const THRESH = {
    tickMsBad: 24, // avg tick budget (ms)
    segMsBad: 75, // avg seg.send budget (ms)
    effFpsBad: 18,
    effFpsGood: 26,
};

// Cooldowns
const COOLDOWN = {
    changeQualityMs: 2500,
};

export function createBackgroundEffect(opts: CreateOpts): Processor {
    const mode: BgMode = opts.mode ?? "none";
    const targetFps = clamp(opts.fps ?? 30, 5, 60);
    const baseBlurPx = clamp(opts.blurPx ?? 10, 0, 40);
    const baseMaxWidth = clamp(opts.maxWidth ?? 1280, 320, 3840);

    const hiddenFps = clamp(opts.hiddenFps ?? 1.5, 0.2, 5);
    const ignoreVisibility = opts.ignoreVisibility ?? false;

    const enableDegrader = opts.enableDegrader ?? true;
    const degradeWindowMs = clamp(opts.degradeWindowMs ?? 2500, 800, 20000);
    const upgradeWindowMs = clamp(opts.upgradeWindowMs ?? 8000, 2000, 30000);

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
    const warn = (...args: any[]) => {
        if (!debug) return;
        try {
            // eslint-disable-next-line no-console
            console.warn("[bgEffect]", ...args);
        } catch { }
    };

    // -------------------------
    // Runtime mutable state
    // -------------------------
    let running = false;

    let timerId: number | null = null;
    let tickInFlight = false;

    let videoEl: HTMLVideoElement | null = null;

    // Output (fixed)
    let outCanvas: HTMLCanvasElement | null = null;
    let outCtx: CanvasRenderingContext2D | null = null;

    // Work (adaptive)
    let workCanvas: HTMLCanvasElement | null = null;
    let workCtx: CanvasRenderingContext2D | null = null;

    let outStream: MediaStream | null = null;
    let inputStream: MediaStream | null = null;

    let bgImage: HTMLImageElement | null = null;

    // MediaPipe
    let seg: any | null = null;
    let lastMask: CanvasImageSource | null = null;
    let segReady = false;
    let segBusy = false;
    let lastSegAt = 0;

    // Quality state
    let qIndex = 0;
    {
        // pick initial ladder level not exceeding baseMaxWidth
        let best = 0;
        for (let i = 0; i < QUALITY_LADDER.length; i++) {
            if (QUALITY_LADDER[i].workMaxWidth <= baseMaxWidth) best = i;
        }
        qIndex = best;

        // start blur from user preference at the top level only (then degrade can reduce)
        QUALITY_LADDER[0] = { ...QUALITY_LADDER[0], blurPx: baseBlurPx };
    }

    let activeWorkMaxWidth = clamp(QUALITY_LADDER[qIndex].workMaxWidth, 160, 3840);
    let activeSegFps = clamp(QUALITY_LADDER[qIndex].segFps, 0, 30);
    let activeBlurPx = clamp(QUALITY_LADDER[qIndex].blurPx, 0, 40);

    // Metrics (EMA)
    const ema = (prev: number, next: number, alpha: number) =>
        prev === 0 ? next : prev * (1 - alpha) + next * alpha;

    let tickMsEMA = 0;
    let segMsEMA = 0;
    let effFpsEMA = 0;

    let lastFrameAt = 0;

    let badSince = 0;
    let goodSince = 0;

    let lastQualityChangeAt = 0;

    const isVisible = () => {
        if (ignoreVisibility) return true;
        try {
            return document.visibilityState === "visible";
        } catch {
            return true;
        }
    };

    const resetMetrics = () => {
        tickMsEMA = 0;
        segMsEMA = 0;
        effFpsEMA = 0;
        lastFrameAt = 0;
        badSince = 0;
        goodSince = 0;
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

    const clearScheduled = () => {
        try {
            if (timerId != null) clearTimeout(timerId);
        } catch { }
        timerId = null;
    };

    const cleanupDom = () => {
        try {
            if (videoEl) {
                videoEl.pause?.();
                (videoEl as any).srcObject = null;
            }
        } catch { }
        videoEl = null;

        outCanvas = null;
        outCtx = null;
        workCanvas = null;
        workCtx = null;
    };

    const applyQualityLevel = (idx: number) => {
        const q = QUALITY_LADDER[clamp(idx, 0, QUALITY_LADDER.length - 1)];
        activeWorkMaxWidth = clamp(q.workMaxWidth, 160, 3840);
        activeSegFps = clamp(q.segFps, 0, 30);
        activeBlurPx = clamp(q.blurPx, 0, 40);
    };

    const ensureWorkCanvas = (outW: number, outH: number) => {
        // keep aspect ratio of output but cap by activeWorkMaxWidth
        const scale = outW > activeWorkMaxWidth ? activeWorkMaxWidth / outW : 1;
        const w = Math.max(2, Math.round(outW * scale));
        const h = Math.max(2, Math.round(outH * scale));

        if (!workCanvas) {
            workCanvas = document.createElement("canvas");
            workCanvas.width = w;
            workCanvas.height = h;
            workCtx = workCanvas.getContext("2d", { alpha: true });
            if (!workCtx) throw new Error("Work canvas 2D context not available");
            log("workCanvas created:", w, "x", h, "quality:", QUALITY_LADDER[qIndex]?.name);
            return;
        }

        if (workCanvas.width !== w || workCanvas.height !== h) {
            workCanvas.width = w;
            workCanvas.height = h;
            if (!workCtx) workCtx = workCanvas.getContext("2d", { alpha: true });
            if (!workCtx) throw new Error("Work canvas 2D context not available");
            log("workCanvas resized:", w, "x", h, "quality:", QUALITY_LADDER[qIndex]?.name);
        }
    };

    const drawFallbackToWork = () => {
        if (!running || !videoEl || !workCanvas || !workCtx) return;

        const w = workCanvas.width;
        const h = workCanvas.height;

        workCtx.clearRect(0, 0, w, h);

        if (mode === "blur") {
            workCtx.filter = `blur(${activeBlurPx}px)`;
            workCtx.drawImage(videoEl, 0, 0, w, h);
            workCtx.filter = "none";
            return;
        }

        workCtx.drawImage(videoEl, 0, 0, w, h);
    };

    const drawWithMaskToWork = () => {
        if (!running || !videoEl || !workCanvas || !workCtx) return;

        const w = workCanvas.width;
        const h = workCanvas.height;

        workCtx.clearRect(0, 0, w, h);

        // 1) foreground
        workCtx.save();
        workCtx.drawImage(videoEl, 0, 0, w, h);
        workCtx.globalCompositeOperation = "destination-in";
        if (lastMask) workCtx.drawImage(lastMask, 0, 0, w, h);
        workCtx.restore();

        // 2) background
        workCtx.save();
        workCtx.globalCompositeOperation = "destination-over";

        if (mode === "image" && bgImage) {
            workCtx.drawImage(bgImage, 0, 0, w, h);
        } else if (mode === "blur") {
            workCtx.filter = `blur(${activeBlurPx}px)`;
            workCtx.drawImage(videoEl, 0, 0, w, h);
            workCtx.filter = "none";
        } else {
            workCtx.drawImage(videoEl, 0, 0, w, h);
        }

        workCtx.restore();
        workCtx.globalCompositeOperation = "source-over";
    };

    const blitWorkToOut = () => {
        if (!running || !outCanvas || !outCtx || !workCanvas) return;
        outCtx.clearRect(0, 0, outCanvas.width, outCanvas.height);
        outCtx.drawImage(workCanvas, 0, 0, outCanvas.width, outCanvas.height);
    };

    const maybeChangeQuality = (dir: "down" | "up") => {
        if (!enableDegrader) return;

        const now = performance.now();
        if (now - lastQualityChangeAt < COOLDOWN.changeQualityMs) return;

        const nextIndex =
            dir === "down"
                ? Math.min(qIndex + 1, QUALITY_LADDER.length - 1)
                : Math.max(qIndex - 1, 0);

        if (nextIndex === qIndex) return;

        lastQualityChangeAt = now;

        const prev = QUALITY_LADDER[qIndex];
        qIndex = nextIndex;
        applyQualityLevel(qIndex);
        const next = QUALITY_LADDER[qIndex];

        log("QUALITY", dir.toUpperCase(), `${prev.name} -> ${next.name}`, {
            activeWorkMaxWidth,
            activeSegFps,
            activeBlurPx,
            tickMsEMA,
            segMsEMA,
            effFpsEMA,
        });

        // If segmentation disabled at new level, close it to free CPU ASAP
        if (activeSegFps <= 0) {
            if (seg) {
                Promise.resolve()
                    .then(async () => {
                        try {
                            await seg?.close?.();
                        } catch { }
                        seg = null;
                        segReady = false;
                        segBusy = false;
                        lastMask = null;
                        lastSegAt = 0;
                    })
                    .catch(() => { });
            }
        }
    };

    const evaluateDegrader = () => {
        if (!enableDegrader) return;
        if (!running) return;
        if (!isVisible()) return; // only react to visible performance

        const now = performance.now();

        const bad =
            (tickMsEMA > 0 && tickMsEMA > THRESH.tickMsBad) ||
            (segMsEMA > 0 && segMsEMA > THRESH.segMsBad) ||
            (effFpsEMA > 0 && effFpsEMA < THRESH.effFpsBad);

        const good =
            (tickMsEMA > 0 && tickMsEMA < THRESH.tickMsBad * 0.75) &&
            (segMsEMA === 0 || segMsEMA < THRESH.segMsBad * 0.75) &&
            (effFpsEMA > THRESH.effFpsGood);

        if (bad) {
            if (!badSince) badSince = now;
            goodSince = 0;

            if (now - badSince >= degradeWindowMs) {
                badSince = now;
                maybeChangeQuality("down");
            }
            return;
        }

        if (good) {
            if (!goodSince) goodSince = now;
            badSince = 0;

            if (now - goodSince >= upgradeWindowMs) {
                goodSince = now;
                maybeChangeQuality("up");
            }
            return;
        }

        badSince = 0;
        goodSince = 0;
    };

    const scheduleNext = () => {
        if (!running) return;

        clearScheduled();

        // When hidden: keepalive at hiddenFps and NO segmentation
        const fpsNow = isVisible() ? targetFps : hiddenFps;
        const ms = Math.max(16, Math.round(1000 / fpsNow));

        timerId = window.setTimeout(() => {
            timerId = null;
            void tickAndReschedule();
        }, ms) as any;
    };

    const tickAndReschedule = async () => {
        if (!running) return;

        if (tickInFlight) {
            scheduleNext();
            return;
        }

        tickInFlight = true;
        const tStart = performance.now();

        try {
            // Effective FPS (only meaningful when visible)
            if (isVisible()) {
                const now = performance.now();
                if (lastFrameAt) {
                    const dt = now - lastFrameAt;
                    const instFps = dt > 0 ? 1000 / dt : 0;
                    effFpsEMA = ema(effFpsEMA, instFps, 0.08);
                }
                lastFrameAt = now;
            }

            // Ensure canvases exist
            if (!outCanvas || !outCtx || !workCanvas || !workCtx || !videoEl) return;

            // Adaptive work resolution
            ensureWorkCanvas(outCanvas.width, outCanvas.height);

            // Hidden: draw fallback only + force disable seg
            const visible = isVisible();
            const segAllowedNow = visible && activeSegFps > 0;

            // Draw to work canvas
            const canUseMask = segAllowedNow && segReady && !!lastMask;
            if (canUseMask) drawWithMaskToWork();
            else drawFallbackToWork();

            // Blit to output canvas
            blitWorkToOut();

            // Segmentation (throttled)
            if (segAllowedNow && seg && segReady && !segBusy && workCanvas) {
                const now = performance.now();
                const interval = 1000 / Math.max(1, activeSegFps);

                if (now - lastSegAt >= interval) {
                    lastSegAt = now;
                    segBusy = true;

                    const segStart = performance.now();
                    try {
                        // IMPORTANT: send workCanvas (lower res) instead of videoEl for speed
                        await seg.send({ image: workCanvas });
                    } catch {
                        // ignore
                    } finally {
                        const segDt = performance.now() - segStart;
                        segMsEMA = ema(segMsEMA, segDt, 0.12);
                        segBusy = false;
                    }
                }
            }

            // Evaluate degrader
            if (visible) evaluateDegrader();
        } finally {
            const tickDt = performance.now() - tStart;
            tickMsEMA = ema(tickMsEMA, tickDt, 0.12);
            tickInFlight = false;
            scheduleNext();
        }
    };

    const onVisibility = () => {
        if (!running) return;
        log("visibilitychange ->", isVisible() ? "visible" : "hidden");
        if (isVisible()) lastSegAt = 0;
        scheduleNext();
    };

    const internalStart = async (input: MediaStream): Promise<MediaStream> => {
        inputStream = input;

        log("startEffect()", {
            mode,
            targetFps,
            baseMaxWidth,
            baseBlurPx,
            q: QUALITY_LADDER[qIndex]?.name,
        });

        // Prepare video element
        videoEl = document.createElement("video");
        videoEl.playsInline = true;
        videoEl.muted = true;
        videoEl.autoplay = true;
        (videoEl as any).srcObject = input;

        try {
            await videoEl.play().catch((e) => log("videoEl.play fail:", e));
        } catch (e) {
            log("videoEl.play throw:", e);
        }

        // Wait for dimensions
        const t0 = Date.now();
        while (Date.now() - t0 < 1500) {
            const vw = videoEl.videoWidth || 0;
            const vh = videoEl.videoHeight || 0;
            if (vw > 0 && vh > 0) break;
            await sleep(50);
        }

        const vw0 = videoEl.videoWidth || 640;
        const vh0 = videoEl.videoHeight || 360;

        // Output size (fixed): based on baseMaxWidth (NOT degraded)
        const scaleOut = vw0 > baseMaxWidth ? baseMaxWidth / vw0 : 1;
        const outW = Math.max(2, Math.round(vw0 * scaleOut));
        const outH = Math.max(2, Math.round(vh0 * scaleOut));

        outCanvas = document.createElement("canvas");
        outCanvas.width = outW;
        outCanvas.height = outH;

        outCtx = outCanvas.getContext("2d", { alpha: true });
        if (!outCtx) throw new Error("Output canvas 2D context not available");

        // Work canvas created by ensureWorkCanvas()
        workCanvas = null;
        workCtx = null;
        ensureWorkCanvas(outW, outH);

        // Output stream (fixed fps)
        outStream = outCanvas.captureStream(targetFps);

        // Load background image if needed
        if (mode === "image" && opts.imageUrl) {
            try {
                bgImage = await loadImage(opts.imageUrl);
            } catch (e) {
                warn("bgImage load fail:", e);
                bgImage = null;
            }
        } else {
            bgImage = null;
        }

        // MediaPipe init (optional)
        seg = null;
        segReady = false;
        segBusy = false;
        lastMask = null;
        lastSegAt = 0;

        if (activeSegFps > 0) {
            seg = await tryCreateSelfieSegmentation();
            if (seg) {
                try {
                    seg.onResults((res: any) => {
                        if (res?.segmentationMask) lastMask = res.segmentationMask as any;
                    });
                    segReady = true;
                    log("MediaPipe ready");
                } catch (e) {
                    warn("MediaPipe onResults fail:", e);
                    seg = null;
                    segReady = false;
                }
            } else {
                log("MediaPipe not available (fallback only)");
            }
        } else {
            log("Segmentation disabled by quality");
        }

        running = true;
        tickInFlight = false;
        resetMetrics();

        try {
            document.addEventListener("visibilitychange", onVisibility);
        } catch { }

        // Draw once immediately to ensure captureStream has a first frame
        try {
            drawFallbackToWork();
            blitWorkToOut();
        } catch { }

        scheduleNext();

        // Watchdog: if nothing ticks (rare), you’ll see it
        if (debug) {
            setTimeout(() => {
                if (!running) return;
                log("watchdog:", {
                    tickMsEMA,
                    segMsEMA,
                    effFpsEMA,
                    q: QUALITY_LADDER[qIndex]?.name,
                    out: outCanvas ? `${outCanvas.width}x${outCanvas.height}` : null,
                    work: workCanvas ? `${workCanvas.width}x${workCanvas.height}` : null,
                    segReady,
                    segEnabled: activeSegFps > 0,
                });
            }, 1200);
        }

        return outStream!;
    };

    const internalStop = async (full: boolean) => {
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

        stopTracks(outStream);
        outStream = null;

        bgImage = null;

        cleanupDom();
        resetMetrics();

        if (full) inputStream = null;
    };

    const startEffect = async (input: MediaStream): Promise<MediaStream> => {
        if (running) {
            await internalStop(false);
        }
        return await internalStart(input);
    };

    const stopEffect = async () => {
        await internalStop(true);
    };

    const dispose = async () => {
        await internalStop(true);
    };

    return { startEffect, stopEffect, dispose };
}