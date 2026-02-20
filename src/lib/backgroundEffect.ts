// src/lib/backgroundEffect.ts
// Canvas + (optional) MediaPipe SelfieSegmentation background effects.
// Used by jitsiEngine replaceTrack pipeline (can be async safely).
//
// ✅ This version adds an adaptive "degrader" (auto quality scaler) based on real runtime metrics:
//
// We continuously measure:
// - tick time (draw + overhead)
// - segmentation time (seg.send duration)
// - effective FPS / frame jitter
//
// If things get heavy for a sustained window -> degrade step by step:
// 1) lower segmentation FPS (10 -> 6 -> 3 -> 0)
// 2) lower maxWidth (1280 -> 960 -> 640 -> 480 -> 360)
// 3) lower blurPx (10 -> 8 -> 6 -> 4 -> 2)
// 4) disable segmentation mask usage (fallback-only) (optional baked into segFps=0)
//
// If performance recovers for long enough -> upgrade back carefully.
//
// Also:
// - Hidden tab mode: keepalive at 1–2 FPS, NO segmentation.
// - Debug logs (opt-in, default true on localhost).
//
// Notes:
// - We cannot "change canvas captureStream resolution" without rebuilding the canvas.
//   So for width changes we rebuild the pipeline (stop+recreate canvas/video element).
//   We do this rarely and with cooldowns to avoid flicker.
// - If you want *zero* restarts, remove width degradation and only degrade segFps/blurPx.
//
// You can tune thresholds below.

export type BgMode = "none" | "blur" | "image";

type CreateOpts = {
    mode: BgMode;
    imageUrl?: string;
    blurPx?: number; // default 10
    fps?: number; // default 30
    maxWidth?: number; // default 1280

    // Optional knobs:
    debug?: boolean; // default true on localhost
    hiddenFps?: number; // default 1.5 (keepalive while hidden)

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

// -------------------------
// Degrader configuration
// -------------------------
type QualityLevel = {
    name: string;
    maxWidth: number;
    segFps: number; // 0 disables segmentation
    blurPx: number;
};

const QUALITY_LADDER: QualityLevel[] = [
    { name: "Q0-ultra", maxWidth: 1280, segFps: 10, blurPx: 10 },
    { name: "Q1-high", maxWidth: 960, segFps: 8, blurPx: 8 },
    { name: "Q2-med", maxWidth: 640, segFps: 6, blurPx: 6 },
    { name: "Q3-low", maxWidth: 480, segFps: 3, blurPx: 4 },
    { name: "Q4-min", maxWidth: 360, segFps: 0, blurPx: 2 }, // fallback-only
];

// Thresholds (tune if needed)
const THRESH = {
    // If avg tick > 22ms at 30fps, you're struggling (especially if seg is on).
    // If avg seg > 70ms, MediaPipe is heavy -> drop segFps or disable.
    tickMsBad: 22,
    segMsBad: 70,
    // Effective fps check (visible only)
    effFpsBad: 18, // if < 18fps, degrade
    effFpsGood: 26, // if > 26fps stable, can upgrade
};

// Cooldowns to avoid thrashing
const COOLDOWN = {
    changeQualityMs: 2500, // don't change quality too frequently
    restartMs: 6000, // don't rebuild canvas too frequently
};

export function createBackgroundEffect(opts: CreateOpts): Processor {
    const mode: BgMode = opts.mode ?? "none";
    const targetFps = clamp(opts.fps ?? 30, 5, 60);
    const baseBlurPx = clamp(opts.blurPx ?? 10, 0, 40);
    const baseMaxWidth = clamp(opts.maxWidth ?? 1280, 320, 3840);

    const hiddenFps = clamp(opts.hiddenFps ?? 1.5, 0.2, 5);
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

    // -------------------------
    // Runtime mutable state
    // -------------------------
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

    // Degrader quality state
    // pick initial level closest to baseMaxWidth/baseBlurPx (and if mode none, seg won't matter)
    let qIndex = 0;
    {
        // choose a level <= baseMaxWidth if possible
        let best = 0;
        for (let i = 0; i < QUALITY_LADDER.length; i++) {
            if (QUALITY_LADDER[i].maxWidth <= baseMaxWidth) best = i;
        }
        qIndex = best;
        // override blur to user's preferred starting blur if bigger
        QUALITY_LADDER[best] = {
            ...QUALITY_LADDER[best],
            blurPx: clamp(baseBlurPx, 0, 40),
        };
    }

    let activeMaxWidth = clamp(QUALITY_LADDER[qIndex].maxWidth, 320, 3840);
    let activeSegFps = clamp(QUALITY_LADDER[qIndex].segFps, 0, 30);
    let activeBlurPx = clamp(QUALITY_LADDER[qIndex].blurPx, 0, 40);

    // metric buffers
    type Stats = {
        tickMsAvg: number;
        segMsAvg: number;
        effFpsAvg: number;
    };

    let tickMsEMA = 0;
    let segMsEMA = 0;
    let effFpsEMA = 0;

    let lastFrameAt = 0;

    let badSince = 0;
    let goodSince = 0;

    let lastQualityChangeAt = 0;
    let lastRestartAt = 0;

    // -------------------------
    // Helpers
    // -------------------------
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

    const isVisible = () => {
        try {
            return document.visibilityState === "visible";
        } catch {
            return true;
        }
    };

    const shouldUseVFC = () => {
        try {
            return (
                isVisible() &&
                !!videoEl &&
                typeof (videoEl as any).requestVideoFrameCallback === "function"
            );
        } catch {
            return false;
        }
    };

    const pickScaled = (vw0: number, vh0: number, maxW: number) => {
        const scale = vw0 > maxW ? maxW / vw0 : 1;
        return {
            w: Math.max(2, Math.round(vw0 * scale)),
            h: Math.max(2, Math.round(vh0 * scale)),
        };
    };

    const resetMetrics = () => {
        tickMsEMA = 0;
        segMsEMA = 0;
        effFpsEMA = 0;
        lastFrameAt = 0;
        badSince = 0;
        goodSince = 0;
    };

    const ema = (prev: number, next: number, alpha: number) =>
        prev === 0 ? next : prev * (1 - alpha) + next * alpha;

    const getStats = (): Stats => ({
        tickMsAvg: tickMsEMA,
        segMsAvg: segMsEMA,
        effFpsAvg: effFpsEMA,
    });

    const applyQualityLevel = (idx: number) => {
        const q = QUALITY_LADDER[clamp(idx, 0, QUALITY_LADDER.length - 1)];
        activeMaxWidth = clamp(q.maxWidth, 320, 3840);
        activeSegFps = clamp(q.segFps, 0, 30);
        activeBlurPx = clamp(q.blurPx, 0, 40);
    };

    const maybeChangeQuality = async (dir: "down" | "up") => {
        if (!enableDegrader) return;
        const now = performance.now();
        if (now - lastQualityChangeAt < COOLDOWN.changeQualityMs) return;

        const nextIndex =
            dir === "down" ? Math.min(qIndex + 1, QUALITY_LADDER.length - 1) : Math.max(qIndex - 1, 0);

        if (nextIndex === qIndex) return;

        lastQualityChangeAt = now;

        const prev = QUALITY_LADDER[qIndex];
        qIndex = nextIndex;
        applyQualityLevel(qIndex);
        const next = QUALITY_LADDER[qIndex];

        log("QUALITY", dir.toUpperCase(), `${prev.name} -> ${next.name}`, {
            activeMaxWidth,
            activeSegFps,
            activeBlurPx,
            stats: getStats(),
        });

        // If maxWidth changed, we need a controlled restart to rebuild canvas size.
        if (prev.maxWidth !== next.maxWidth) {
            if (now - lastRestartAt < COOLDOWN.restartMs) {
                // Too soon to restart: still apply segFps/blur changes without rebuild.
                // We'll rebuild later if we keep being bad.
                log("restart skipped (cooldown)");
                return;
            }
            lastRestartAt = now;

            // Hard restart pipeline but keep same input stream (camera track)
            // NOTE: This will stop the old outStream tracks, and create new ones.
            // Your caller MUST replaceTrack with the new stream track (jitsiEngine should).
            if (inputStream) {
                log("restarting pipeline to apply new maxWidth:", activeMaxWidth);
                const oldRunning = running;
                // Stop current rendering objects but keep inputStream reference.
                await internalStop(false /*keepInput*/);

                // Restart immediately if we were running
                if (oldRunning && inputStream) {
                    await internalStart(inputStream);
                }
            }
        }
    };

    // Determines whether system is "bad" or "good"
    const evaluateDegrader = async () => {
        if (!enableDegrader) return;
        if (!running) return;

        // Only consider visible-mode perf for degrade/upgrade.
        if (!isVisible()) return;

        const s = getStats();
        const now = performance.now();

        const bad =
            (s.tickMsAvg > THRESH.tickMsBad && s.tickMsAvg !== 0) ||
            (s.segMsAvg > THRESH.segMsBad && s.segMsAvg !== 0) ||
            (s.effFpsAvg > 0 && s.effFpsAvg < THRESH.effFpsBad);

        const good =
            (s.tickMsAvg > 0 && s.tickMsAvg < THRESH.tickMsBad * 0.75) &&
            (s.segMsAvg === 0 || s.segMsAvg < THRESH.segMsBad * 0.75) &&
            (s.effFpsAvg > THRESH.effFpsGood);

        if (bad) {
            if (!badSince) badSince = now;
            goodSince = 0;
            if (now - badSince >= degradeWindowMs) {
                badSince = now; // reset window to prevent multiple steps instantly
                await maybeChangeQuality("down");
            }
        } else if (good) {
            if (!goodSince) goodSince = now;
            badSince = 0;
            if (now - goodSince >= upgradeWindowMs) {
                goodSince = now;
                await maybeChangeQuality("up");
            }
        } else {
            // neither clearly bad nor good
            badSince = 0;
            goodSince = 0;
        }
    };

    // -------------------------
    // Drawing
    // -------------------------
    const tickDrawFallback = () => {
        if (!running || !videoEl || !canvas || !ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        try {
            ctx.clearRect(0, 0, w, h);

            if (mode === "blur") {
                ctx.filter = `blur(${activeBlurPx}px)`;
                ctx.drawImage(videoEl, 0, 0, w, h);
                ctx.filter = "none";
                return;
            }

            // image mode without segmentation -> draw raw
            ctx.drawImage(videoEl, 0, 0, w, h);
        } catch {
            // ignore
        }
    };

    const tickDrawWithMask = () => {
        if (!running || !videoEl || !canvas || !ctx) return;
        const w = canvas.width;
        const h = canvas.height;

        try {
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
                ctx.filter = `blur(${activeBlurPx}px)`;
                ctx.drawImage(videoEl, 0, 0, w, h);
                ctx.filter = "none";
            } else {
                ctx.drawImage(videoEl, 0, 0, w, h);
            }

            ctx.restore();
            ctx.globalCompositeOperation = "source-over";
        } catch {
            // ignore
        }
    };

    // -------------------------
    // Scheduler
    // -------------------------
    const scheduleNext = () => {
        if (!running) return;

        clearScheduled();

        if (!isVisible()) {
            const ms = Math.max(200, Math.round(1000 / hiddenFps));
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
        const tStart = performance.now();
        try {
            // Effective FPS / jitter estimate (visible only)
            if (isVisible()) {
                const now = performance.now();
                if (lastFrameAt) {
                    const dt = now - lastFrameAt;
                    const instFps = dt > 0 ? 1000 / dt : 0;
                    effFpsEMA = ema(effFpsEMA, instFps, 0.08);
                }
                lastFrameAt = now;
            }

            // Hidden => do fallback only, no segmentation
            if (!isVisible()) {
                tickDrawFallback();
                return;
            }

            // Visible: draw
            const canUseMask = segReady && !!lastMask && activeSegFps > 0;
            if (canUseMask) tickDrawWithMask();
            else tickDrawFallback();

            // Visible: segmentation (optional) - throttle by activeSegFps
            if (seg && segReady && !segBusy && videoEl && activeSegFps > 0) {
                const now = performance.now();
                const interval = 1000 / Math.max(1, activeSegFps);

                if (now - lastSegAt >= interval) {
                    lastSegAt = now;
                    segBusy = true;
                    const segStart = performance.now();
                    try {
                        await seg.send({ image: videoEl });
                    } catch {
                        // ignore
                    } finally {
                        const segDt = performance.now() - segStart;
                        segMsEMA = ema(segMsEMA, segDt, 0.12);
                        segBusy = false;
                    }
                }
            }

            // Evaluate degrader occasionally
            await evaluateDegrader();
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
        // When becoming visible, allow immediate segmentation
        if (isVisible()) lastSegAt = 0;
        scheduleNext();
    };

    // -------------------------
    // Start/Stop internals (support restarts)
    // -------------------------
    const internalStart = async (input: MediaStream): Promise<MediaStream> => {
        inputStream = input;

        log("startEffect()", {
            mode,
            targetFps,
            baseMaxWidth,
            baseBlurPx,
            activeMaxWidth,
            activeSegFps,
            activeBlurPx,
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

        const { w: vw, h: vh } = pickScaled(vw0, vh0, activeMaxWidth);

        canvas = document.createElement("canvas");
        canvas.width = vw;
        canvas.height = vh;
        ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) throw new Error("Canvas 2D context not available");

        // Output stream (fixed at targetFps)
        outStream = canvas.captureStream(targetFps);

        // Background image
        if (mode === "image" && opts.imageUrl) {
            try {
                bgImage = await loadImage(opts.imageUrl);
            } catch (e) {
                log("bgImage load fail:", e);
                bgImage = null;
            }
        } else {
            bgImage = null;
        }

        // MediaPipe init (optional) ONLY if seg is enabled in current quality
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
                    log("MediaPipe onResults fail:", e);
                    seg = null;
                    segReady = false;
                }
            } else {
                log("MediaPipe not available (fallback only)");
            }
        } else {
            log("Segmentation disabled by quality level");
        }

        running = true;
        tickInFlight = false;

        resetMetrics();

        try {
            document.addEventListener("visibilitychange", onVisibility);
        } catch { }

        // Kick: draw once immediately
        try {
            tickDrawFallback();
        } catch { }

        scheduleNext();

        return outStream!;
    };

    const internalStop = async (full: boolean) => {
        // full=true => remove input refs too
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

        if (full) {
            inputStream = null;
        }
    };

    // -------------------------
    // Public API
    // -------------------------
    const startEffect = async (input: MediaStream): Promise<MediaStream> => {
        // If user starts multiple times, stop previous
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