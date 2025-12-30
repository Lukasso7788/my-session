// ============================================================================
// src/lib/jitsiEngine/bgManager.ts
// Background Effects Manager for JitsiEngine
// - Strategy: auto -> setEffect first, fallback to replaceTrack pipeline
// - Serialized bg ops + per-track serialized setEffect ops
// ============================================================================

import { createVirtualBackgroundEffect as createVendoredVirtualBackgroundEffect } from "../jitsiEffects/virtualBackground";

export type BgMode = "none" | "blur" | "image";

type BgStrategy = "auto" | "setEffect" | "replaceTrack";
type BgImplMode = "none" | "setEffect" | "replaceTrack";

export type BgManagerDeps = {
    // session state
    getConference: () => any | null;
    getJitsiMeetJS: () => any | null;

    getLocalUserId: () => string | null;

    // local outgoing video track (what conference currently uses)
    getLocalVideoTrack: () => any | null;
    setLocalVideoTrack: (t: any | null) => void;

    // local device settings mirror (engine.mediaSettings)
    setMediaBg: (mode: BgMode, imageUrl?: string) => void;

    // participant mapping update helpers (engine-owned)
    upsertLocalVideoMapping: (t: any | null) => void; // entry.video set/delete + rebuild+emit
    rebuildParticipantsFromTracks: () => void;
    emitParticipants: () => void;

    // core helpers
    isDesktopTrack: (t: any) => boolean;
    safeDisposeTrack: (t: any, reason: string) => Promise<void>;

    // ensure camera track exists (IMPORTANT: should NOT call bg.apply internally if called with reapplyBg=false)
    ensureLocalVideoTrack: (opts?: { reapplyBg?: boolean }) => Promise<void>;

    // conference local video helpers (to avoid "Cannot add second video track")
    replaceOrAddLocalVideoTrack: (t: any, reason: string) => Promise<void>;
};

function makeOpQueue(prefix: string) {
    let seq = 0;
    let q: Promise<void> = Promise.resolve();

    const enqueue = (label: string, fn: () => Promise<void>) => {
        const id = ++seq;
        q = q
            .catch(() => { })
            .then(async () => {
                try {
                    console.debug(`[${prefix}#${id}] BEGIN ${label}`);
                } catch { }
                await fn();
                try {
                    console.debug(`[${prefix}#${id}] END ${label}`);
                } catch { }
            })
            .catch((e) => {
                try {
                    console.warn(`[${prefix}#${id}] FAIL ${label}:`, e);
                } catch { }
            });

        return q;
    };

    const waitIdle = async () => {
        try {
            await q;
        } catch { }
    };

    return { enqueue, waitIdle, get promise() { return q; } };
}

export class BgManager {
    private deps: BgManagerDeps;

    private prefs: { mode: BgMode; imageUrl?: string } = { mode: "none" };
    private strategy: BgStrategy = "auto";
    private implMode: BgImplMode = "none";

    private applying = false;
    private q = makeOpQueue("bgQ");

    // setEffect path
    private videoEffect: any | undefined = undefined;
    private effectsSupported = false;
    private effectsCompatibility: "unknown" | "ok" | "incompatible" = "unknown";
    private effectsIncompatReason: string | null = null;

    // replaceTrack path
    private baseVideoTrack: any | null = null; // raw camera feeding processor
    private processedTrack: any | null = null; // outgoing track in conference when bg enabled
    private processor: any | null = null;
    private processedStream: MediaStream | null = null;
    private replaceRetryCount = 0;

    // lazy load backgroundEffect.ts factory
    private factoryLoaded = false;
    private factoryFn: ((opts: any) => any) | null = null;

    // per-track effect op serializer
    private effectOpSeq = 0;
    private effectQueueByTrack = new WeakMap<any, Promise<void>>();

    private readonly PASSTHROUGH_EFFECT = {
        startEffect: (stream: MediaStream) => stream,
        stopEffect: () => { },
        dispose: () => { },
        isEnabled: (_track?: any) => true,
        isSupported: (_track?: any) => true,
    };

    constructor(deps: BgManagerDeps) {
        this.deps = deps;
    }

    // -------- public API --------

    public getPrefs() {
        return { ...this.prefs };
    }

    public getImplMode(): BgImplMode {
        return this.implMode;
    }

    public getBaseVideoTrack(): any | null {
        return this.baseVideoTrack;
    }

    public isApplying(): boolean {
        return this.applying;
    }

    public async waitIdle() {
        await this.q.waitIdle();
    }

    public setStrategy(strategy: BgStrategy) {
        this.strategy = strategy;
        try {
            console.log("[bg] strategy set to:", strategy);
        } catch { }

        if (this.prefs.mode !== "none") {
            void this.enqueue("setStrategy", () => this.applyNow("setStrategy"));
        }
    }

    public async setBackgroundEffect(opts: { mode: BgMode; imageUrl?: string }) {
        this.prefs = { mode: opts.mode, imageUrl: opts.imageUrl };
        this.deps.setMediaBg(opts.mode, opts.imageUrl);
        await this.enqueue("setBackgroundEffect", () => this.applyNow("setBackgroundEffect"));

        // refresh local participant muted in dto if needed
        try {
            const uid = this.deps.getLocalUserId();
            const t = this.deps.getLocalVideoTrack();
            if (uid && t) {
                // engine will emit participants already; this is just defensive
                this.deps.emitParticipants();
            }
        } catch { }
    }

    /** clear bg (keepPrefs=false wipes internal base/processed pointers) */
    public async clearAnyBg(keepPrefs: boolean, reason: string) {
        await this.enqueue(`clearAnyBg:${reason}`, async () => {
            await this.clearAnyBgNow(keepPrefs, reason);
        });
    }

    /** called by engine when camera stopped; keeps user prefs but resets track pointers */
    public resetForCameraStopped() {
        this.baseVideoTrack = null;
        this.processedTrack = null;
        this.processedStream = null;
        this.processor = null;
        this.implMode = "none";
        this.videoEffect = undefined;
    }

    /** called by engine after fresh camera created */
    public resetForNewCamera() {
        // prefs stay
        this.baseVideoTrack = null;
        this.processedTrack = null;
        this.processedStream = null;
        this.processor = null;
        this.implMode = "none";
        this.videoEffect = undefined;
    }

    /** Engine helper: make sure old video’s setEffect ops drained before dispose */
    public async waitEffectIdle(track: any) {
        const p = this.effectQueueByTrack.get(track);
        if (p) {
            try {
                await p;
            } catch { }
        }
    }

    /** Engine helper: clear setEffect mode on a specific track (safe no-op) */
    public async clearSetEffectOnTrack(track: any, reason: string) {
        await this.enqueue(`clearSetEffectOnTrack:${reason}`, async () => {
            await this.clearBgEffectOnTrack_setEffect(track);
            if (this.implMode === "setEffect") this.implMode = "none";
        });
    }

    /** Engine helper: request reapply if prefs enabled */
    public reapplyIfNeeded(reason: string) {
        if (this.prefs.mode === "none") return;
        void this.enqueue(`reapplyIfNeeded:${reason}`, () => this.applyNow(`reapplyIfNeeded:${reason}`));
    }

    // -------- queue wrapper --------

    private enqueue(label: string, fn: () => Promise<void>) {
        return this.q.enqueue(label, fn);
    }

    // -------- debug helpers --------

    private getTrackDbg(track: any) {
        try {
            const msAny = track?.getOriginalStream?.();
            const isPromise = !!msAny && typeof msAny.then === "function";
            return {
                type: track?.getType?.(),
                videoType: track?.getVideoType?.(),
                local: !!track?.isLocal?.(),
                muted: !!track?.isMuted?.(),
                trackId: track?.getTrackId?.() || track?.getId?.() || undefined,
                hasSetEffect: typeof track?.setEffect === "function",
                origStreamPromise: isPromise,
            };
        } catch {
            return { hasSetEffect: typeof track?.setEffect === "function" };
        }
    }

    private markEffectsIncompatible(reason: string) {
        if (this.effectsCompatibility !== "incompatible") {
            this.effectsCompatibility = "incompatible";
            this.effectsIncompatReason = reason;
            try {
                console.warn("[bg] setEffect path marked INCOMPATIBLE:", reason);
            } catch { }
        }
    }

    private markEffectsOk() {
        if (this.effectsCompatibility !== "ok") {
            this.effectsCompatibility = "ok";
            this.effectsIncompatReason = null;
            try {
                console.log("[bg] setEffect path marked OK");
            } catch { }
        }
    }

    private refreshEffectsSupport(track?: any) {
        const t = track ?? this.deps.getLocalVideoTrack();
        const hasSetEffect = typeof (t as any)?.setEffect === "function";
        this.effectsSupported = !!hasSetEffect;

        try {
            console.log("[Jitsi][effects] track.setEffect:", typeof (t as any)?.setEffect, "=> supported:", this.effectsSupported);
        } catch { }
        return this.effectsSupported;
    }

    private isAsyncFunction(fn: any) {
        try {
            return typeof fn === "function" && fn.constructor && fn.constructor.name === "AsyncFunction";
        } catch {
            return false;
        }
    }

    // -------- per-track setEffect serializer --------

    private logEffect(opId: number, phase: string, extra?: any) {
        try {
            console.debug(`[bg][op#${opId}] ${phase}`, extra ?? "");
        } catch { }
    }

    private async runEffectOpOnTrack(track: any, label: string, fn: () => Promise<void>) {
        if (!track) return;

        const prev = this.effectQueueByTrack.get(track) || Promise.resolve();
        const opId = ++this.effectOpSeq;

        const next = prev
            .catch(() => { })
            .then(async () => {
                this.logEffect(opId, `BEGIN ${label}`, this.getTrackDbg(track));
                const t0 = performance.now();
                try {
                    await fn();
                    this.logEffect(opId, `OK ${label} +${Math.round(performance.now() - t0)}ms`, this.getTrackDbg(track));
                } catch (e) {
                    this.logEffect(opId, `FAIL ${label} +${Math.round(performance.now() - t0)}ms`, e);
                    throw e;
                }
            });

        this.effectQueueByTrack.set(track, next);
        return next;
    }

    private async safeSetEffect(track: any, effect: any, reason: string) {
        if (!track || typeof track.setEffect !== "function") return;

        await this.runEffectOpOnTrack(track, `setEffect(${reason})`, async () => {
            const attempt = async () => track.setEffect(effect);
            try {
                await attempt();
            } catch (e: any) {
                const msg = String(e?.message || e || "");
                if (msg.includes("setEffect already in progress")) {
                    this.logEffect(++this.effectOpSeq, `RETRY setEffect(${reason}) after in-progress`);
                    await new Promise((r) => setTimeout(r, 120));
                    await attempt();
                } else {
                    throw e;
                }
            }
        });
    }

    // -------- setEffect path (A) --------

    private wrapEffectToForceMediaStream(effect: any) {
        if (!effect || typeof effect.startEffect !== "function") return effect;
        if ((effect as any).__msWrapped) return effect;

        const makeAdapter = (target: any, callOriginal: (s: MediaStream) => any) => {
            target.startEffect = (streamLike: any) => {
                let s: any = streamLike;

                if (s && typeof s.getTracks !== "function") {
                    if (typeof MediaStreamTrack !== "undefined" && s instanceof MediaStreamTrack) {
                        s = new MediaStream([s]);
                    } else if (s?.track && typeof MediaStreamTrack !== "undefined" && s.track instanceof MediaStreamTrack) {
                        s = new MediaStream([s.track]);
                    } else if (typeof s?.getOriginalStream === "function") {
                        const maybe = s.getOriginalStream();
                        if (maybe && typeof maybe.then === "function") {
                            throw new Error("[bg] startEffect received async getOriginalStream; build expects sync MediaStream");
                        }
                        s = maybe;
                    }
                }

                if (!s || typeof s.getTracks !== "function") {
                    throw new Error("[bg] startEffect received non-MediaStream");
                }

                const out = callOriginal(s);
                if (out && typeof out.then === "function") {
                    throw new Error("[bg] startEffect returned Promise; this build expects sync MediaStream");
                }

                return out;
            };

            if (typeof target.isEnabled !== "function") target.isEnabled = (_track?: any) => true;
            return target;
        };

        try {
            const original = effect.startEffect.bind(effect);
            (effect as any).__msWrapped = true;
            return makeAdapter(effect, original);
        } catch {
            const wrapped = Object.create(effect);
            const original = effect.startEffect.bind(effect);
            (wrapped as any).__msWrapped = true;
            return makeAdapter(wrapped, original);
        }
    }

    private buildVirtualBackgroundOptions() {
        if (this.prefs.mode === "blur") return { backgroundType: "blur" };
        if (this.prefs.mode === "image") {
            if (!this.prefs.imageUrl) return null;
            return { backgroundType: "image", virtualSource: this.prefs.imageUrl };
        }
        return null;
    }

    private getEffectFactory() {
        const anyJitsi = (window as any).JitsiMeetJS;
        const nativeFactory = anyJitsi?.effects?.createVirtualBackgroundEffect;
        if (typeof nativeFactory === "function") return { kind: "native" as const, factory: nativeFactory };
        return { kind: "vendored" as const, factory: createVendoredVirtualBackgroundEffect };
    }

    private async createEffectObject(vb: any) {
        const pick = this.getEffectFactory();
        if (!pick?.factory) {
            this.markEffectsIncompatible("No effect factory available");
            return null;
        }

        const created = pick.factory(vb);
        const effect = await Promise.resolve(created);

        if (!effect) {
            this.markEffectsIncompatible(`${pick.kind} factory returned empty effect`);
            return null;
        }

        if (this.isAsyncFunction(effect.startEffect)) {
            this.markEffectsIncompatible(`${pick.kind} effect.startEffect is async (incompatible with this build)`);
            return null;
        }

        if (typeof effect.isEnabled !== "function") effect.isEnabled = (_track?: any) => true;

        this.markEffectsOk();
        return effect;
    }

    private async clearBgEffectOnTrack_setEffect(track: any) {
        if (!track) return;

        if (typeof track.setEffect === "function") {
            try {
                await this.safeSetEffect(track, this.PASSTHROUGH_EFFECT, "clear:setEffect");
            } catch (e) {
                console.warn("[bg] clear setEffect(passthrough) failed:", e);
            }
        }

        try { await this.videoEffect?.dispose?.(); } catch { }
        try { await (this.videoEffect as any)?.stopEffect?.(); } catch { }
        this.videoEffect = undefined;
    }

    private async applyBgEffectToTrack_setEffect(track: any) {
        if (!track) return;

        this.refreshEffectsSupport(track);

        if (!this.effectsSupported) throw new Error("setEffect not supported");

        const wasMuted = (() => {
            try { return track.isMuted?.() === true; } catch { return false; }
        })();
        if (wasMuted) return;

        if (this.effectsCompatibility === "incompatible") {
            throw new Error(`setEffect incompatible: ${this.effectsIncompatReason || "unknown"}`);
        }

        try {
            const msAny = track.getOriginalStream?.();
            const ms = await Promise.resolve(msAny);
            if (!ms || typeof ms.getTracks !== "function") return;
        } catch { }

        if (this.prefs.mode === "none") {
            await this.clearBgEffectOnTrack_setEffect(track);
            return;
        }

        await this.clearBgEffectOnTrack_setEffect(track);

        const vb = this.buildVirtualBackgroundOptions();
        if (!vb) return;

        this.applying = true;
        try {
            console.debug("[bg] setEffect apply request:", this.prefs, "track:", this.getTrackDbg(track));

            let effect = await this.createEffectObject(vb);
            if (!effect) throw new Error(`setEffect unavailable: ${this.effectsIncompatReason || "no effect"}`);

            effect = this.wrapEffectToForceMediaStream(effect);

            try {
                if (typeof effect.isSupported === "function") {
                    const ok = effect.isSupported(track);
                    if (!ok) throw new Error("setEffect isSupported=false");
                }
            } catch { }

            try {
                if (typeof effect.isEnabled === "function") {
                    const ok = effect.isEnabled(track);
                    if (!ok) throw new Error("setEffect isEnabled=false");
                }
            } catch { }

            await this.safeSetEffect(track, effect, `apply:setEffect:${this.prefs.mode}`);
            this.videoEffect = effect;

            try {
                const nowMuted = track.isMuted?.() === true;
                if (!wasMuted && nowMuted && typeof track.unmute === "function") await track.unmute();
            } catch { }
        } catch (e) {
            console.warn("[bg] setEffect apply failed:", e);

            try { await this.safeSetEffect(track, this.PASSTHROUGH_EFFECT, "apply:setEffect:fail-clear"); } catch { }
            try { await this.videoEffect?.dispose?.(); } catch { }
            try { await (this.videoEffect as any)?.stopEffect?.(); } catch { }
            this.videoEffect = undefined;

            this.markEffectsIncompatible(`setEffect apply failed: ${String((e as any)?.message || e || "")}`);
            throw e;
        } finally {
            setTimeout(() => { this.applying = false; }, 250);
        }
    }

    private canTrySetEffect(track: any) {
        if (!track) return false;
        if (this.strategy === "replaceTrack") return false;
        if (this.effectsCompatibility === "incompatible") return false;
        return typeof track.setEffect === "function";
    }

    // -------- replaceTrack path (B) --------

    private async loadCanvasBgFactory(): Promise<((opts: any) => any) | null> {
        if (this.factoryLoaded) return this.factoryFn;
        this.factoryLoaded = true;

        try {
            const mod: any = await import("../backgroundEffect");
            const fn = mod?.createBackgroundEffect || mod?.createCanvasVirtualBgEffect || mod?.default || null;
            if (typeof fn !== "function") {
                console.warn("[bg] backgroundEffect module loaded but no factory function export found");
                this.factoryFn = null;
                return null;
            }
            this.factoryFn = fn;
            return fn;
        } catch (e) {
            console.warn("[bg] Failed to load ../backgroundEffect:", e);
            this.factoryFn = null;
            return null;
        }
    }

    public prewarmReplaceTrackFactory() {
        void this.loadCanvasBgFactory();
    }

    private async waitBaseStream(track: any, timeoutMs = 2000): Promise<MediaStream | null> {
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
            try {
                const msAny = track?.getOriginalStream?.();
                const ms = await Promise.resolve(msAny);
                const vt = ms?.getVideoTracks?.()?.[0];
                if (ms && vt && vt.readyState !== "ended") return ms as MediaStream;
            } catch { }
            await new Promise((r) => setTimeout(r, 60));
        }
        return null;
    }

    private async createJitsiVideoTrackFromStream(stream: MediaStream): Promise<any> {
        const J = this.deps.getJitsiMeetJS();
        if (!J) throw new Error("JitsiMeetJS not ready");

        const vt = stream.getVideoTracks?.()?.[0];
        if (!vt) throw new Error("processed stream has no video track");

        if (typeof J.createLocalTracksFromMediaStreams === "function") {
            const infos = [
                { mediaType: "video", sourceType: "external", stream, track: vt, videoType: "camera" },
            ];
            const created = await J.createLocalTracksFromMediaStreams(infos);
            const t = (created || []).find((x: any) => x?.getType?.() === "video") || (created || [])[0];
            if (!t) throw new Error("createLocalTracksFromMediaStreams returned empty");
            return t;
        }

        throw new Error("createLocalTracksFromMediaStreams not available in this build");
    }

    private async stopReplaceTrackProcessor(reason: string) {
        try { await this.processor?.stopEffect?.(); } catch { }
        try { await this.processor?.dispose?.(); } catch { }
        this.processor = null;
        this.processedStream = null;

        try { console.debug("[bg] replaceTrack processor stopped:", reason); } catch { }
    }

    private async disableBg_replaceTrack(reason: string, keepPrefs: boolean) {
        const conf = this.deps.getConference();
        if (!conf) return;

        const base = this.baseVideoTrack;
        const processed = this.processedTrack;

        if (processed && base && typeof conf.replaceTrack === "function") {
            try { await conf.replaceTrack(processed, base); } catch (e) {
                console.warn("[bg] replaceTrack disable replaceTrack(processed->base) failed:", e);
            }
        } else if (processed && base) {
            try { await conf.removeTrack?.(processed); } catch { }
            try { await conf.addTrack?.(base); } catch { }
        }

        if (base) {
            this.deps.setLocalVideoTrack(base);
            this.deps.upsertLocalVideoMapping(base);
        }

        if (processed) {
            try { await this.deps.safeDisposeTrack(processed, `bg:disable:processed:${reason}`); } catch { }
        }
        this.processedTrack = null;

        await this.stopReplaceTrackProcessor(`disable:${reason}`);

        if (!keepPrefs) this.baseVideoTrack = null;

        this.implMode = "none";
    }

    private async enableBg_replaceTrack(reason: string) {
        const conf = this.deps.getConference();
        if (!conf) return;

        if (this.prefs.mode === "none") return;

        const outgoing = this.deps.getLocalVideoTrack();
        if (!outgoing) return;

        // stale base check
        if (this.baseVideoTrack) {
            try {
                const msAny = this.baseVideoTrack?.getOriginalStream?.();
                const ms = await Promise.resolve(msAny);
                const vt = ms?.getVideoTracks?.()?.[0];
                if (!vt || vt.readyState === "ended") this.baseVideoTrack = null;
            } catch {
                this.baseVideoTrack = null;
            }
        }
        if (!this.baseVideoTrack) this.baseVideoTrack = outgoing;

        try {
            if (this.baseVideoTrack?.isMuted?.() === true) return;
        } catch { }

        const factory = await this.loadCanvasBgFactory();
        if (!factory) return;

        const baseTrack = this.baseVideoTrack || outgoing;
        const baseStream = await this.waitBaseStream(baseTrack, 2000);
        if (!baseStream) {
            setTimeout(() => {
                void this.enqueue("retry:base-stream-not-ready", () => this.applyNow("retry:base-stream-not-ready"));
            }, 200);
            return;
        }

        if (this.processedTrack) {
            await this.disableBg_replaceTrack("reconfigure", true);
        }

        this.applying = true;
        try {
            const opts = {
                mode: this.prefs.mode,
                imageUrl: this.prefs.imageUrl,
                backgroundType: this.prefs.mode === "blur" ? "blur" : this.prefs.mode === "image" ? "image" : "none",
                virtualSource: this.prefs.imageUrl,
            };

            const processor = factory(opts);
            this.processor = processor;

            if (!processor || typeof processor.startEffect !== "function") {
                await this.stopReplaceTrackProcessor("invalid-processor");
                return;
            }

            const processedStreamAny = processor.startEffect(baseStream);
            const processedStream = await Promise.resolve(processedStreamAny);

            if (!processedStream || typeof processedStream.getTracks !== "function") {
                await this.stopReplaceTrackProcessor("invalid-processed-stream");
                return;
            }

            this.processedStream = processedStream;

            const processedJitsiTrack = await this.createJitsiVideoTrackFromStream(processedStream);
            this.processedTrack = processedJitsiTrack;

            const oldOutgoing = this.deps.getLocalVideoTrack();

            // update refs before replace to prevent TRACK_REMOVED races
            this.deps.setLocalVideoTrack(processedJitsiTrack);
            this.deps.upsertLocalVideoMapping(processedJitsiTrack);

            if (oldOutgoing && typeof conf.replaceTrack === "function") {
                await conf.replaceTrack(oldOutgoing, processedJitsiTrack);
            } else if (oldOutgoing) {
                try { await conf.removeTrack?.(oldOutgoing); } catch { }
                await conf.addTrack(processedJitsiTrack);
            } else {
                await conf.addTrack(processedJitsiTrack);
            }

            this.implMode = "replaceTrack";
            this.replaceRetryCount = 0;

            try {
                console.log("[bg] replaceTrack enabled:", reason, {
                    base: this.getTrackDbg(this.baseVideoTrack),
                    outgoing: this.getTrackDbg(this.deps.getLocalVideoTrack()),
                });
            } catch { }
        } catch (e) {
            console.warn("[bg] replaceTrack enable failed:", e);

            try { await this.disableBg_replaceTrack("enable-failed", false); } catch { }
            try { await this.deps.ensureLocalVideoTrack({ reapplyBg: false }); } catch { }

            this.replaceRetryCount = this.replaceRetryCount + 1;
            if (this.replaceRetryCount <= 3 && this.prefs.mode !== "none") {
                const delay = 250 * this.replaceRetryCount;
                setTimeout(() => {
                    void this.enqueue(`replaceTrack-retry#${this.replaceRetryCount}`, () =>
                        this.applyNow(`replaceTrack-retry#${this.replaceRetryCount}`)
                    );
                }, delay);
            }
        } finally {
            setTimeout(() => { this.applying = false; }, 250);
        }
    }

    // -------- unified apply/clear --------

    private async clearAnyBgNow(keepPrefs: boolean, reason: string) {
        // replaceTrack mode first
        if (this.implMode === "replaceTrack") {
            await this.disableBg_replaceTrack(reason, keepPrefs);
            if (!keepPrefs) {
                this.baseVideoTrack = null;
                this.processedTrack = null;
                this.processor = null;
                this.processedStream = null;
            }
            return;
        }

        // setEffect mode
        const t = this.deps.getLocalVideoTrack();
        if (t) {
            try { await this.clearBgEffectOnTrack_setEffect(t); } catch { }
        }

        this.implMode = "none";

        if (!keepPrefs) {
            this.baseVideoTrack = null;
            this.processedTrack = null;
            this.processor = null;
            this.processedStream = null;
        }
    }

    /** main entry: apply current prefs using strategy */
    public async applyNow(reason: string) {
        const conf = this.deps.getConference();
        if (!conf) return;

        // make sure we have a camera track (but do not recursively reapply bg inside ensure)
        await this.deps.ensureLocalVideoTrack({ reapplyBg: false });

        const track = this.deps.getLocalVideoTrack();
        if (!track) return;

        if (this.prefs.mode === "none") {
            await this.clearAnyBgNow(false, `applyNow:none:${reason}`);
            return;
        }

        if (this.implMode === "replaceTrack") {
            await this.enableBg_replaceTrack(`reapply:${reason}`);
            return;
        }

        if (this.strategy !== "replaceTrack" && this.canTrySetEffect(track)) {
            try {
                await this.applyBgEffectToTrack_setEffect(track);
                if (this.prefs.mode !== "none" && !this.videoEffect) throw new Error("setEffect produced no effect instance");
                this.implMode = "setEffect";
                return;
            } catch {
                // fallthrough to replaceTrack
            }
        }

        if (this.implMode === "setEffect") {
            try { await this.clearBgEffectOnTrack_setEffect(track); } catch { }
        }

        // ensure base points to the raw camera at moment of enable
        this.baseVideoTrack = this.baseVideoTrack || this.deps.getLocalVideoTrack();
        this.implMode = "none";

        await this.enableBg_replaceTrack(`fallback:${reason}`);
    }

    /** called by engine when it replaced/added a new camera track (base) */
    public onNewCameraTrack(newCamera: any) {
        // reset base binding to this camera so next enable uses correct base
        this.baseVideoTrack = newCamera;
    }
}
