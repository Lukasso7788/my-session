// src/lib/backgroundEffect.ts
// Uses the same Virtual Background effect API as Jitsi Meet UI.

declare global {
    interface Window {
        JitsiMeetJS?: any;
    }
}

export type BgMode = "none" | "blur" | "image";
export type JitsiStreamEffect = any;

type CreateOpts = {
    mode: BgMode;
    imageUrl?: string;
    blurValue?: number; // 0..100-ish (Jitsi uses numbers like 8 / 25)
};

export async function createBackgroundEffect(opts: CreateOpts): Promise<JitsiStreamEffect | undefined> {
    const { mode, imageUrl, blurValue = 25 } = opts;

    const JitsiMeetJS = (window as any).JitsiMeetJS;
    const effects = JitsiMeetJS?.effects;

    if (!effects?.createVirtualBackgroundEffect) {
        console.warn("[bg] JitsiMeetJS.effects.createVirtualBackgroundEffect is missing");
        return undefined;
    }

    if (mode === "none") return undefined;

    if (mode === "blur") {
        return await effects.createVirtualBackgroundEffect({
            backgroundEffectEnabled: true,
            backgroundType: "blur",
            blurValue,
        });
    }

    // mode === "image"
    if (!imageUrl) {
        console.warn("[bg] mode=image but imageUrl is empty");
        return undefined;
    }

    return await effects.createVirtualBackgroundEffect({
        backgroundEffectEnabled: true,
        backgroundType: "image",
        // Jitsi/Sariska naming: virtualSource = image URL
        virtualSource: imageUrl,
    });
}
