// src/lib/backgroundEffect.ts
// Canvas + (optional) MediaPipe SelfieSegmentation background effects.
// Used by jitsiEngine replaceTrack pipeline (can be async safely).
//
// ✅ This version adds:
// 1) Adaptive "degrader" (auto quality scaler) based on runtime metrics (tick/seg/fps)
// 2) Optional OffscreenCanvas + Worker renderer (reduces main-thread load)
//    - main thread: grabs frames (ImageBitmap) + runs MediaPipe (optional)
//    - worker: does all compositing/draw (foreground mask + blur/image bg) into OffscreenCanvas
//
// Notes / reality check:
// - You CANNOT truly “disable” browser tab-throttling. Browsers will throttle timers/RAF/video decode
//   in background tabs for battery/CPU. What we do here:
//     * hidden mode switches to low FPS keepalive
//     * segmentation is disabled while hidden
//     * worker keeps UI thread lighter when visible
//
// How to use:
// - createBackgroundEffect({ mode: "blur", fps: 30, maxWidth: 1280, ... })
// - startEffect(inputStream) -> returns processed MediaStream (video from canvas + passthrough audio)
// - stopEffect/dispose to stop.
//
// Debug:
// - debug defaults to true on localhost; otherwise false.
// - Logs are prefixed with [bgEffect] (and [bgEffect:worker] for worker logs).

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

    // Worker rendering:
    enableWorker?: boolean; // default true if supported
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
    // NOTE: bundler must be able to resolve this import.
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
            modelSelection: 1, // 0 general, 1 landscape
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

    // “Processing maxWidth” (NOT the output captureStream size).
    // We keep output size stable, but process internally at lower resolution to save CPU.
    procMaxWidth: number;

    // Segmentation fps (0 disables segmentation)
    segFps: number;

    // Blur strength
    blurPx: number;
};

const QUALITY_LADDER: QualityLevel[] = [
    { name: "Q0-ultra", procMaxWidth: 1280, segFps: 10, blurPx: 10 },
    { name: "Q1-high", procMaxWidth: 960, segFps: 8, blurPx: 8 },
    { name: "Q2-med", procMaxWidth: 640, segFps: 6, blurPx: 6 },
    { name: "Q3-low", procMaxWidth: 480, segFps: 3, blurPx: 4 },
    { name: "Q4-min", procMaxWidth: 360, segFps: 0, blurPx: 2 },
];

// Thresholds (tune if needed)
const THRESH = {
    tickMsBad: 22,
    segMsBad: 70,
    effFpsBad: 18,
    effFpsGood: 26,
};

// Cooldowns to avoid thrashing
const COOLDOWN = {
    changeQualityMs: 2500,
};

function supportsWorkerOffscreenPipeline() {
    try {
        const w: any = window as any;
        const hasWorker = typeof w.Worker === "function";
        const hasOffscreen = typeof w.OffscreenCanvas === "function";
        const canTransfer =
            typeof (HTMLCanvasElement.prototype as any).transferControlToOffscreen ===
            "function";
        const hasCreateImageBitmap = typeof w.createImageBitmap === "function";
        return hasWorker && hasOffscreen && canTransfer && hasCreateImageBitmap;
    } catch {
        return false;
    }
}

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

    const enableWorker =
        opts.enableWorker ?? (typeof window !== "undefined" && supportsWorkerOffscreenPipeline());

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

    // Output canvas must stay on main thread for captureStream()
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null; // used only if NOT using worker

    let outStream: MediaStream | null = null;
    let inputStream: MediaStream | null = null;

    let bgImage: HTMLImageElement | null = null;

    // MediaPipe
    let seg: any | null = null;
    let lastMask: CanvasImageSource | null = null;
    let segReady = false;
    let segBusy = false;
    let lastSegAt = 0;

    // Worker pipeline
    let worker: Worker | null = null;
    let workerReady = false;
    let workerUse = false;
    let workerLastRenderMs = 0;
    let workerLastRenderAt = 0;

    // Quality state
    let qIndex = 0;
    {
        // pick initial level based on baseMaxWidth
        let best = 0;
        for (let i = 0; i < QUALITY_LADDER.length; i++) {
            if (QUALITY_LADDER[i].procMaxWidth <= baseMaxWidth) best = i;
        }
        qIndex = best;
        // start blur from user preference (cap)
        QUALITY_LADDER[best] = {
            ...QUALITY_LADDER[best],
            blurPx: clamp(baseBlurPx, 0, 40),
        };
    }

    let activeProcMaxWidth = clamp(QUALITY_LADDER[qIndex].procMaxWidth, 240, 3840);
    let activeSegFps = clamp(QUALITY_LADDER[qIndex].segFps, 0, 30);
    let activeBlurPx = clamp(QUALITY_LADDER[qIndex].blurPx, 0, 40);

    // EMA metrics
    let tickMsEMA = 0;
    let segMsEMA = 0;
    let effFpsEMA = 0;
    let bitmapMsEMA = 0;

    let lastFrameAt = 0;
    let badSince = 0;
    let goodSince = 0;
    let lastQualityChangeAt = 0;

    const ema = (prev: number, next: number, alpha: number) =>
        prev === 0 ? next : prev * (1 - alpha) + next * alpha;

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

    const resetMetrics = () => {
        tickMsEMA = 0;
        segMsEMA = 0;
        effFpsEMA = 0;
        bitmapMsEMA = 0;
        workerLastRenderMs = 0;
        workerLastRenderAt = 0;
        lastFrameAt = 0;
        badSince = 0;
        goodSince = 0;
    };

    const applyQualityLevel = (idx: number) => {
        const q = QUALITY_LADDER[clamp(idx, 0, QUALITY_LADDER.length - 1)];
        activeProcMaxWidth = clamp(q.procMaxWidth, 240, 3840);
        activeSegFps = clamp(q.segFps, 0, 30);
        activeBlurPx = clamp(q.blurPx, 0, 40);

        // push updates to worker
        if (worker && workerReady) {
            try {
                worker.postMessage({
                    type: "config",
                    procMaxWidth: activeProcMaxWidth,
                    blurPx: activeBlurPx,
                    mode,
                });
            } catch { }
        }
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
            procMaxWidth: activeProcMaxWidth,
            segFps: activeSegFps,
            blurPx: activeBlurPx,
            ema: {
                tickMs: tickMsEMA,
                segMs: segMsEMA,
                effFps: effFpsEMA,
                bitmapMs: bitmapMsEMA,
                workerMs: workerLastRenderMs,
            },
        });
    };

    const evaluateDegrader = async () => {
        if (!enableDegrader || !running) return;
        if (!isVisible()) return; // don't “learn” from hidden throttling

        const now = performance.now();

        const bad =
            (tickMsEMA > THRESH.tickMsBad && tickMsEMA !== 0) ||
            (segMsEMA > THRESH.segMsBad && segMsEMA !== 0) ||
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

    // -------------------------
    // Worker implementation (inline via Blob)
    // -------------------------
    const makeWorker = () => {
        // IMPORTANT: keep worker code self-contained. No imports.
        const workerCode = `
      let debug = false;
      const log = (...a) => { if (!debug) return; try { console.debug("[bgEffect:worker]", ...a); } catch {} };

      /** @type {OffscreenCanvas|null} */
      let outCanvas = null;
      /** @type {OffscreenCanvasRenderingContext2D|null} */
      let outCtx = null;

      // internal processing canvas (smaller) to reduce work
      /** @type {OffscreenCanvas|null} */
      let procCanvas = null;
      /** @type {OffscreenCanvasRenderingContext2D|null} */
      let procCtx = null;

      /** @type {ImageBitmap|null} */
      let bgBitmap = null;
      /** @type {ImageBitmap|null} */
      let lastMaskBmp = null;

      let mode = "none";
      let blurPx = 10;
      let procMaxWidth = 1280;

      // output size
      let outW = 0, outH = 0;
      // processing size
      let procW = 0, procH = 0;

      function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }

      function pickScaled(w0,h0,maxW){
        const scale = (w0 > maxW) ? (maxW / w0) : 1;
        const w = Math.max(2, Math.round(w0 * scale));
        const h = Math.max(2, Math.round(h0 * scale));
        return { w, h };
      }

      function ensureProcCanvas(newW, newH){
        if (!procCanvas || !procCtx || procW !== newW || procH !== newH){
          procW = newW; procH = newH;
          procCanvas = new OffscreenCanvas(procW, procH);
          procCtx = procCanvas.getContext("2d", { alpha: true, desynchronized: true });
          log("procCanvas resize", procW, procH);
        }
      }

      function clearAll(){
        try { if (outCtx && outW && outH) outCtx.clearRect(0,0,outW,outH); } catch {}
        try { if (procCtx && procW && procH) procCtx.clearRect(0,0,procW,procH); } catch {}
      }

      function drawFallback(frameBmp){
        // draw to proc canvas at reduced res
        ensureProcCanvas(...Object.values(pickScaled(outW, outH, procMaxWidth)));
        if (!procCtx) return;

        procCtx.clearRect(0,0,procW,procH);

        if (mode === "blur"){
          procCtx.filter = "blur(" + blurPx + "px)";
          procCtx.drawImage(frameBmp, 0, 0, procW, procH);
          procCtx.filter = "none";
        } else {
          procCtx.drawImage(frameBmp, 0, 0, procW, procH);
        }

        // scale up to output
        if (outCtx){
          outCtx.clearRect(0,0,outW,outH);
          outCtx.drawImage(procCanvas, 0,0, procW,procH, 0,0, outW,outH);
        }
      }

      function drawWithMask(frameBmp){
        // compose in proc canvas, then scale to output
        ensureProcCanvas(...Object.values(pickScaled(outW, outH, procMaxWidth)));
        if (!procCtx || !outCtx) return;

        procCtx.clearRect(0,0,procW,procH);

        // 1) foreground
        procCtx.save();
        procCtx.drawImage(frameBmp, 0, 0, procW, procH);
        procCtx.globalCompositeOperation = "destination-in";
        if (lastMaskBmp) procCtx.drawImage(lastMaskBmp, 0, 0, procW, procH);
        procCtx.restore();

        // 2) background behind
        procCtx.save();
        procCtx.globalCompositeOperation = "destination-over";

        if (mode === "image" && bgBitmap){
          procCtx.drawImage(bgBitmap, 0, 0, procW, procH);
        } else if (mode === "blur"){
          procCtx.filter = "blur(" + blurPx + "px)";
          procCtx.drawImage(frameBmp, 0, 0, procW, procH);
          procCtx.filter = "none";
        } else {
          procCtx.drawImage(frameBmp, 0, 0, procW, procH);
        }

        procCtx.restore();
        procCtx.globalCompositeOperation = "source-over";

        // scale to output
        outCtx.clearRect(0,0,outW,outH);
        outCtx.drawImage(procCanvas, 0,0, procW,procH, 0,0, outW,outH);
      }

      self.onmessage = async (ev) => {
        const msg = ev.data || {};
        if (msg.type === "init"){
          debug = !!msg.debug;
          outCanvas = msg.canvas || null;
          outW = msg.w|0; outH = msg.h|0;
          outCtx = outCanvas ? outCanvas.getContext("2d", { alpha: true, desynchronized: true }) : null;

          mode = msg.mode || "none";
          blurPx = clamp((msg.blurPx ?? 10)|0, 0, 80);
          procMaxWidth = clamp((msg.procMaxWidth ?? 1280)|0, 240, 3840);

          log("init", { outW, outH, mode, blurPx, procMaxWidth });

          self.postMessage({ type: "ready" });
          return;
        }

        if (msg.type === "config"){
          if (typeof msg.mode === "string") mode = msg.mode;
          if (typeof msg.blurPx === "number") blurPx = clamp(msg.blurPx|0, 0, 80);
          if (typeof msg.procMaxWidth === "number") procMaxWidth = clamp(msg.procMaxWidth|0, 240, 3840);
          log("config", { mode, blurPx, procMaxWidth });
          return;
        }

        if (msg.type === "bg"){
          // replace background bitmap
          try { bgBitmap?.close?.(); } catch {}
          bgBitmap = msg.bmp || null;
          log("bg updated", !!bgBitmap);
          return;
        }

        if (msg.type === "mask"){
          // replace mask bitmap
          try { lastMaskBmp?.close?.(); } catch {}
          lastMaskBmp = msg.bmp || null;
          return;
        }

        if (msg.type === "frame"){
          const t0 = performance.now();
          const frameBmp = msg.bmp || null;
          const hasMask = !!msg.hasMask && !!lastMaskBmp;

          try{
            if (!outCtx || !outCanvas || !frameBmp){
              try { frameBmp?.close?.(); } catch {}
              return;
            }

            if (hasMask) drawWithMask(frameBmp);
            else drawFallback(frameBmp);
          } catch (e){
            // fail silently
          } finally {
            try { frameBmp?.close?.(); } catch {}
          }

          const dt = performance.now() - t0;
          // avoid spamming: send render time at most ~5Hz
          const now = performance.now();
          if (!self._lastAckAt || (now - self._lastAckAt) > 200){
            self._lastAckAt = now;
            self.postMessage({ type: "render", ms: dt });
          }
          return;
        }

        if (msg.type === "clear"){
          clearAll();
          return;
        }
      };
    `;

        const blob = new Blob([workerCode], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        const w = new Worker(url);
        // Revoke URL after worker loads a bit (safe)
        setTimeout(() => {
            try {
                URL.revokeObjectURL(url);
            } catch { }
        }, 3000);
        return w;
    };

    const initWorkerIfPossible = async (outW: number, outH: number) => {
        workerReady = false;
        workerUse = false;

        if (!enableWorker) return;

        if (!canvas) return;
        if (!supportsWorkerOffscreenPipeline()) {
            log("worker pipeline not supported, fallback to main-thread draw");
            return;
        }

        try {
            const off = (canvas as any).transferControlToOffscreen();
            worker = makeWorker();

            worker.onmessage = (ev: MessageEvent) => {
                const m: any = ev.data || {};
                if (m.type === "ready") {
                    workerReady = true;
                    workerUse = true;
                    log("worker ready");
                    // push initial background if already loaded
                    if (bgImage && typeof (window as any).createImageBitmap === "function") {
                        (window as any)
                            .createImageBitmap(bgImage)
                            .then((bmp: ImageBitmap) => {
                                try {
                                    worker?.postMessage({ type: "bg", bmp }, [bmp as any]);
                                } catch {
                                    try {
                                        bmp.close?.();
                                    } catch { }
                                }
                            })
                            .catch(() => { });
                    }
                    return;
                }
                if (m.type === "render") {
                    workerLastRenderMs = typeof m.ms === "number" ? m.ms : workerLastRenderMs;
                    workerLastRenderAt = performance.now();
                    return;
                }
            };

            worker.onerror = () => {
                log("worker error; disabling worker pipeline");
                workerReady = false;
                workerUse = false;
                try {
                    worker?.terminate();
                } catch { }
                worker = null;
            };

            worker.postMessage(
                {
                    type: "init",
                    canvas: off,
                    w: outW,
                    h: outH,
                    mode,
                    blurPx: activeBlurPx,
                    procMaxWidth: activeProcMaxWidth,
                    debug,
                },
                [off]
            );

            // Wait a bit for ready
            const t0 = Date.now();
            while (!workerReady && Date.now() - t0 < 800) {
                await sleep(10);
            }

            if (!workerReady) {
                log("worker did not become ready in time; fallback to main-thread draw");
                try {
                    worker?.terminate();
                } catch { }
                worker = null;
                workerUse = false;
            }
        } catch (e) {
            log("worker init failed:", e);
            try {
                worker?.terminate();
            } catch { }
            worker = null;
            workerUse = false;
        }
    };

    // -------------------------
    // Main-thread drawing (fallback if no worker)
    // -------------------------
    const drawFallbackMain = () => {
        if (!running || !videoEl || !canvas || !ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        if (mode === "blur") {
            ctx.filter = `blur(${activeBlurPx}px)`;
            ctx.drawImage(videoEl, 0, 0, w, h);
            ctx.filter = "none";
            return;
        }

        ctx.drawImage(videoEl, 0, 0, w, h);
    };

    const drawWithMaskMain = () => {
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
            ctx.filter = `blur(${activeBlurPx}px)`;
            ctx.drawImage(videoEl, 0, 0, w, h);
            ctx.filter = "none";
        } else {
            ctx.drawImage(videoEl, 0, 0, w, h);
        }

        ctx.restore();
        ctx.globalCompositeOperation = "source-over";
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
            // Effective FPS EMA (visible only)
            if (isVisible()) {
                const now = performance.now();
                if (lastFrameAt) {
                    const dt = now - lastFrameAt;
                    const instFps = dt > 0 ? 1000 / dt : 0;
                    effFpsEMA = ema(effFpsEMA, instFps, 0.08);
                }
                lastFrameAt = now;
            }

            // Hidden: keepalive draw but NO segmentation
            if (!isVisible()) {
                // Worker: still send a frame sometimes (keeps stream “alive”)
                if (workerUse && worker && workerReady && videoEl) {
                    try {
                        const tBmp0 = performance.now();
                        const bmp: ImageBitmap = await (window as any).createImageBitmap(videoEl);
                        const bmpDt = performance.now() - tBmp0;
                        bitmapMsEMA = ema(bitmapMsEMA, bmpDt, 0.12);

                        worker.postMessage({ type: "frame", bmp, hasMask: false }, [bmp as any]);
                    } catch {
                        // ignore
                    }
                } else {
                    // main-thread fallback
                    try {
                        drawFallbackMain();
                    } catch { }
                }
                return;
            }

            // Visible:
            const canUseMask = segReady && !!lastMask && activeSegFps > 0;

            // Worker path:
            if (workerUse && worker && workerReady && videoEl) {
                try {
                    const tBmp0 = performance.now();
                    const bmp: ImageBitmap = await (window as any).createImageBitmap(videoEl);
                    const bmpDt = performance.now() - tBmp0;
                    bitmapMsEMA = ema(bitmapMsEMA, bmpDt, 0.12);

                    worker.postMessage({ type: "frame", bmp, hasMask: canUseMask }, [bmp as any]);
                } catch {
                    // if createImageBitmap fails, fallback to main thread draw if possible
                    if (ctx) {
                        try {
                            if (canUseMask) drawWithMaskMain();
                            else drawFallbackMain();
                        } catch { }
                    }
                }
            } else {
                // Main-thread draw:
                try {
                    if (canUseMask) drawWithMaskMain();
                    else drawFallbackMain();
                } catch { }
            }

            // Segmentation (visible only) - throttle by activeSegFps
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

            // Evaluate degrader
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

        // When tab becomes visible: allow segmentation sooner
        if (isVisible()) lastSegAt = 0;

        scheduleNext();
    };

    // -------------------------
    // Start/Stop
    // -------------------------
    const internalStart = async (input: MediaStream): Promise<MediaStream> => {
        inputStream = input;

        log("startEffect()", {
            mode,
            targetFps,
            baseMaxWidth,
            baseBlurPx,
            q: QUALITY_LADDER[qIndex]?.name,
            worker: enableWorker,
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

        // Wait for video dimensions
        const t0 = Date.now();
        while (Date.now() - t0 < 1500) {
            const vw = videoEl.videoWidth || 0;
            const vh = videoEl.videoHeight || 0;
            if (vw > 0 && vh > 0) break;
            await sleep(50);
        }

        const vw0 = videoEl.videoWidth || 640;
        const vh0 = videoEl.videoHeight || 360;

        // Output canvas size is “baseMaxWidth scaled” and stays constant.
        const outScale = vw0 > baseMaxWidth ? baseMaxWidth / vw0 : 1;
        const outW = Math.max(2, Math.round(vw0 * outScale));
        const outH = Math.max(2, Math.round(vh0 * outScale));

        canvas = document.createElement("canvas");
        canvas.width = outW;
        canvas.height = outH;

        // If not using worker, we draw on main thread
        ctx = enableWorker ? null : canvas.getContext("2d", { alpha: true });
        if (!enableWorker && !ctx) throw new Error("Canvas 2D context not available");

        // Output stream
        outStream = canvas.captureStream(targetFps);

        // Background image for image mode
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

        // Init worker if possible (must happen AFTER canvas is created)
        worker = null;
        workerReady = false;
        workerUse = false;
        if (enableWorker) {
            await initWorkerIfPossible(outW, outH);
            // If worker active and we have bgImage, send it
            if (workerUse && worker && workerReady && bgImage) {
                try {
                    const bmp: ImageBitmap = await (window as any).createImageBitmap(bgImage);
                    worker.postMessage({ type: "bg", bmp }, [bmp as any]);
                } catch { }
            }
        }

        // MediaPipe init (optional) ONLY if seg enabled in current quality (and mode not none)
        seg = null;
        segReady = false;
        segBusy = false;
        lastMask = null;
        lastSegAt = 0;

        if (activeSegFps > 0) {
            seg = await tryCreateSelfieSegmentation();
            if (seg) {
                try {
                    seg.onResults(async (res: any) => {
                        if (!res?.segmentationMask) return;
                        lastMask = res.segmentationMask as any;

                        // If worker is active, push mask as ImageBitmap (to offload draw)
                        if (workerUse && worker && workerReady && typeof (window as any).createImageBitmap === "function") {
                            try {
                                const mbmp: ImageBitmap = await (window as any).createImageBitmap(
                                    res.segmentationMask as any
                                );
                                worker.postMessage({ type: "mask", bmp: mbmp }, [mbmp as any]);
                            } catch {
                                // ignore
                            }
                        }
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

        // Push initial worker config (quality)
        applyQualityLevel(qIndex);

        running = true;
        tickInFlight = false;

        resetMetrics();

        try {
            document.addEventListener("visibilitychange", onVisibility);
        } catch { }

        // Kick: draw once immediately
        try {
            if (workerUse && worker && workerReady && videoEl) {
                // send a single frame to initialize output quickly
                try {
                    const bmp: ImageBitmap = await (window as any).createImageBitmap(videoEl);
                    worker.postMessage({ type: "frame", bmp, hasMask: false }, [bmp as any]);
                } catch { }
            } else {
                drawFallbackMain();
            }
        } catch { }

        scheduleNext();

        // Output stream includes passthrough audio tracks
        // (Canvas captureStream has only video)
        const audios = (input.getAudioTracks?.() || []).slice();
        return new MediaStream([...audios, ...(outStream.getVideoTracks?.() || [])]);
    };

    const internalStop = async (full: boolean) => {
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

        // Stop worker
        try {
            worker?.postMessage({ type: "clear" });
        } catch { }
        try {
            worker?.terminate();
        } catch { }
        worker = null;
        workerReady = false;
        workerUse = false;

        // Stop output tracks
        stopTracks(outStream);
        outStream = null;

        bgImage = null;

        cleanupDom();
        resetMetrics();

        if (full) inputStream = null;
    };

    const startEffect = async (input: MediaStream): Promise<MediaStream> => {
        if (running) await internalStop(false);
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