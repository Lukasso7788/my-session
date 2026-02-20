// src/lib/backgroundEffect.ts
// Canvas + (optional) MediaPipe SelfieSegmentation background effects.
// Used by jitsiEngine replaceTrack pipeline (can be async safely).
//
// ✅ Adaptive degrader (auto quality scaler) based on runtime metrics.
//
// Key behavior:
// - Measures: tick time, seg.send time, effective FPS
// - Degrades: segFps -> maxWidth (requires restart) -> blurPx -> seg off (fallback-only)
// - Upgrades carefully when stable
// - Hidden tab: keepalive low FPS + NO segmentation
// - Debug logs (default true on localhost)
//
// IMPORTANT integration note:
// - When we restart due to width change, we create a NEW outStream + track.
// - If your caller (jitsiEngine) does NOT re-replaceTrack when stream changes, you won't see the new quality.
// - To avoid reliance on replaceTrack, set enableDegrader=true but remove width ladder (not done here).
//
// This file is self-contained.

export type BgMode = "none" | "blur" | "image";

type CreateOpts = {
    mode: BgMode;
    imageUrl?: string;
    blurPx?: number; // default 10
    fps?: number; // default 30
    maxWidth?: number; // default 1280

    debug?: boolean; // default true on localhost
    hiddenFps?: number; // default 1.5 (keepalive while hidden)

    enableDegrader?: boolean; // default true
    degradeWindowMs?: number; // default 2500
    upgradeWindowMs?: number; // default 8000

    // Advanced:
    restartOnWidthChange?: boolean; // default true (if false, width ladder changes won't apply until next start)
};

type Processor = {
    startEffect: (input: MediaStream) => Promise<MediaStream> | MediaStream;
    stopEffect: () => Promise<void> | void;
    dispose: () => Promise<void> | void;

    // Optional: lets caller observe restarts / new stream creation if they want to auto replaceTrack
    // (safe to ignore)
    onStream?: (cb: (stream: MediaStream) => void) => void;
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

        seg.setOptions({ modelSelection: 1 });
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

const THRESH = {
    tickMsBad: 22,
    segMsBad: 70,
    effFpsBad: 18,
    effFpsGood: 26,
};

const COOLDOWN = {
    changeQualityMs: 2500,
    restartMs: 6000,
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

    const restartOnWidthChange = opts.restartOnWidthChange ?? true;

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
    // Runtime state
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

    // Stream listeners
    const streamListeners = new Set<(s: MediaStream) => void>();
    const emitStream = (s: MediaStream) => {
        streamListeners.forEach((cb) => {
            try {
                cb(s);
            } catch { }
        });
    };

    // Initial quality selection
    let qIndex = 0;
    {
        let best = 0;
        for (let i = 0; i < QUALITY_LADDER.length; i++) {
            if (QUALITY_LADDER[i].maxWidth <= baseMaxWidth) best = i;
        }
        qIndex = best;

        // Don't mutate global ladder object across instances: copy blur override locally via active vars.
    }

    let activeMaxWidth = clamp(QUALITY_LADDER[qIndex].maxWidth, 320, 3840);
    let activeSegFps = clamp(QUALITY_LADDER[qIndex].segFps, 0, 30);
    let activeBlurPx = clamp(
        // start with user's blur but keep within current level's idea
        baseBlurPx,
        0,
        40
    );

    type Stats = { tickMsAvg: number; segMsAvg: number; effFpsAvg: number };
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

        // blur: follow ladder but never exceed user starting blur by too much? keep simple:
        activeBlurPx = clamp(q.blurPx, 0, 40);

        // If user wanted bigger blur, keep it on best tiers only:
        if (idx <= 1) activeBlurPx = clamp(baseBlurPx, 0, 40);
    };

    // Forward declarations
    const internalStart = async (input: MediaStream): Promise<MediaStream> => {
        return input; // overwritten below
    };
    const internalStop = async (_full: boolean) => {
        // overwritten below
    };

    const maybeChangeQuality = async (dir: "down" | "up") => {
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
            activeMaxWidth,
            activeSegFps,
            activeBlurPx,
            stats: getStats(),
        });

        // Width change requires rebuild to actually apply
        const widthChanged = prev.maxWidth !== next.maxWidth;

        if (widthChanged && restartOnWidthChange) {
            if (now - lastRestartAt < COOLDOWN.restartMs) {
                log("restart skipped (cooldown)");
                return;
            }
            lastRestartAt = now;

            if (inputStream) {
                log("restarting pipeline to apply new maxWidth:", activeMaxWidth);
                const wasRunning = running;
                await internalStop(false);
                if (wasRunning && inputStream) {
                    const newStream = await internalStart(inputStream);
                    // Notify listener (so jitsiEngine can re-replaceTrack if it wants)
                    emitStream(newStream);
                }
            }
        } else if (widthChanged && !restartOnWidthChange) {
            log("width changed but restartOnWidthChange=false; will apply next start()");
        }
    };

    const evaluateDegrader = async () => {
        if (!enableDegrader) return;
        if (!running) return;
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
            s.effFpsAvg > THRESH.effFpsGood;

        if (bad) {
            if (!badSince) badSince = now;
            goodSince = 0;
            if (now - badSince >= degradeWindowMs) {
                badSince = now;
                await maybeChangeQuality("down");
            }
            return;
        }

        if (good) {
            if (!goodSince) goodSince = now;
            badSince = 0;
            if (now - goodSince >= upgradeWindowMs) {
                goodSince = now;
                await maybeChangeQuality("up");
            }
            return;
        }

        badSince = 0;
        goodSince = 0;
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

            ctx.drawImage(videoEl, 0, 0, w, h);
        } catch { }
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
        } catch { }
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
            // FPS estimate (visible only)
            if (isVisible()) {
                const now = performance.now();
                if (lastFrameAt) {
                    const dt = now - lastFrameAt;
                    const instFps = dt > 0 ? 1000 / dt : 0;
                    effFpsEMA = ema(effFpsEMA, instFps, 0.08);
                }
                lastFrameAt = now;
            }

            // Hidden: fallback only, segmentation OFF hard
            if (!isVisible()) {
                tickDrawFallback();
                return;
            }

            // Draw
            const canUseMask = segReady && !!lastMask && activeSegFps > 0;
            if (canUseMask) tickDrawWithMask();
            else tickDrawFallback();

            // Segmentation step (optional)
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

        // When becoming visible: allow immediate seg
        if (isVisible()) lastSegAt = 0;

        // When going hidden: drop seg EMA quickly so degrader doesn't misread on return
        if (!isVisible()) {
            segMsEMA = 0;
            effFpsEMA = 0;
            badSince = 0;
            goodSince = 0;
        }

        scheduleNext();
    };

    // -------------------------
    // Start/Stop internals
    // -------------------------
    const _internalStart = async (input: MediaStream): Promise<MediaStream> => {
        inputStream = input;

        log("startEffect()", {
            mode,
            targetFps,
            baseMaxWidth,
            baseBlurPx,
            q: QUALITY_LADDER[qIndex]?.name,
            activeMaxWidth,
            activeSegFps,
            activeBlurPx,
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

        outStream = canvas.captureStream(targetFps);

        // Notify listeners (useful for restarts)
        emitStream(outStream);

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

        // MediaPipe init only if seg enabled
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

        // Draw once
        try {
            tickDrawFallback();
        } catch { }

        scheduleNext();

        return outStream!;
    };

    const _internalStop = async (full: boolean) => {
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

    // Bind forward declarations
    (internalStart as any) = _internalStart;
    (internalStop as any) = _internalStop;

    // -------------------------
    // Public API
    // -------------------------
    const startEffect = async (input: MediaStream): Promise<MediaStream> => {
        // reset quality to best-fit on each start (optional but safer)
        {
            let best = 0;
            for (let i = 0; i < QUALITY_LADDER.length; i++) {
                if (QUALITY_LADDER[i].maxWidth <= baseMaxWidth) best = i;
            }
            qIndex = best;
            applyQualityLevel(qIndex);
        }

        if (running) await _internalStop(false);
        return await _internalStart(input);
    };

    const stopEffect = async () => {
        await _internalStop(true);
    };

    const dispose = async () => {
        await _internalStop(true);
        streamListeners.clear();
    };

    const onStream = (cb: (stream: MediaStream) => void) => {
        streamListeners.add(cb);
    };

    return { startEffect, stopEffect, dispose, onStream };
}