// src/lib/jitsiEffects/virtualBackground/JitsiStreamBackgroundEffect.ts

export type BackgroundType = "blur" | "image";

export interface IBackgroundEffectOptions {
    backgroundType: BackgroundType;
    virtualSource?: string; // for "image" mode
}

/**
 * ✅ Safe NO-OP implementation:
 * - Compiles on Vercel
 * - Works with track.setEffect(effect)
 * - Does NOT actually apply blur/image yet (returns original stream)
 *
 * You can swap this file later with the real Jitsi implementation.
 */
export default class JitsiStreamBackgroundEffect {
    private opts: IBackgroundEffectOptions;
    private stopped = false;

    constructor(opts: IBackgroundEffectOptions) {
        this.opts = opts;
    }

    // Some builds call effect.isEnabled(track)
    isEnabled(_track?: any) {
        return true;
    }

    // lib-jitsi-meet calls startEffect(stream)
    async startEffect(stream: MediaStream, ..._rest: any[]): Promise<MediaStream> {
        this.stopped = false;
        return stream; // ✅ no-op
    }

    async stopEffect(..._rest: any[]): Promise<void> {
        this.stopped = true;
    }

    async dispose(): Promise<void> {
        await this.stopEffect();
    }
}
