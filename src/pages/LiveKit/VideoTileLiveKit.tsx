import React, { useEffect, useMemo, useRef, useState } from "react";
import { Track } from "livekit-client";

type RoomTheme = "dark" | "light";

type HostTileActions = {
    canMuteMic: boolean;
    canMuteCam: boolean;
    micMuted?: boolean;
    camMuted?: boolean;
    onToggleMuteMic?: () => void;
    onToggleMuteCam?: () => void;
    onKick?: () => void;
    busy?: boolean;
};

function getQueryBool(name: string, def = false) {
    try {
        const u = new URL(window.location.href);
        const raw = u.searchParams.get(name);
        if (raw === null) return def;
        const v = raw.trim().toLowerCase();
        if (v === "" || v === "1" || v === "true" || v === "yes" || v === "on") return true;
        if (v === "0" || v === "false" || v === "no" || v === "off") return false;
        return def;
    } catch {
        return def;
    }
}

function Icon({
    name,
    theme,
    className = "w-5 h-5",
    alt = "",
}: {
    name:
    | "mic-on"
    | "mic-off"
    | "camera-on"
    | "camera-off"
    | "screen-share"
    | "reaction"
    | "leave"
    | "participants"
    | "chat"
    | "intentions"
    | "settings"
    | "theme-sun"
    | "theme-moon"
    | "timer";
    theme: RoomTheme;
    className?: string;
    alt?: string;
}) {
    const themedSrc = `/icons/${name}-${theme}.svg`;
    const fallbackSrc = `/icons/${name}.svg`;
    const [src, setSrc] = useState(themedSrc);

    useEffect(() => {
        setSrc(themedSrc);
    }, [themedSrc]);

    return (
        <img
            src={src}
            onError={() => {
                if (src !== fallbackSrc) setSrc(fallbackSrc);
            }}
            className={className}
            alt={alt}
            draggable={false}
        />
    );
}

export function VideoTile({
    label,
    videoTrack,
    isLocal,
    theme,
    showBadge,
    hostActions,
}: {
    label: string;
    videoTrack?: Track;
    isLocal: boolean;
    theme: RoomTheme;
    showBadge?: string | null;
    hostActions?: HostTileActions;
}) {
    const ref = useRef<HTMLVideoElement | null>(null);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const isLight = theme === "light";

    // Debug sizing overlay for solo grid testing:
    // add ?devTileDebug=1 in URL
    const debugSizing = useMemo(() => getQueryBool("devTileDebug", false), []);
    const [sizeText, setSizeText] = useState<string>("");

    useEffect(() => {
        if (!debugSizing) return;
        const el = wrapRef.current;
        if (!el || typeof ResizeObserver === "undefined") return;

        let raf = 0;
        const ro = new ResizeObserver((entries) => {
            const r = entries?.[0]?.contentRect;
            if (!r) return;
            window.cancelAnimationFrame(raf);
            raf = window.requestAnimationFrame(() => {
                setSizeText(`${Math.round(r.width)}×${Math.round(r.height)}`);
            });
        });

        ro.observe(el);

        return () => {
            window.cancelAnimationFrame(raf);
            ro.disconnect();
        };
    }, [debugSizing]);

    // keep <video muted> synced to isLocal
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.muted = !!isLocal;
    }, [isLocal]);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        let didAttach = false;

        // hard reset element (prevents stale streams / flicker when track changes)
        try {
            if (videoTrack && typeof (videoTrack as any)?.detach === "function") {
                (videoTrack as any).detach(el);
            }
        } catch { }
        try {
            el.pause();
        } catch { }
        try {
            (el as any).srcObject = null;
        } catch { }

        if (!videoTrack) return;

        try {
            if (typeof (videoTrack as any)?.attach === "function") {
                (videoTrack as any).attach(el);
                didAttach = true;

                // Some browsers (esp. Safari) may require an explicit play() attempt after attach
                Promise.resolve()
                    .then(() => el.play())
                    .catch(() => { });
            } else {
                console.warn("videoTrack.attach is not a function", videoTrack);
            }
        } catch (e) {
            console.error("attach video failed:", e);
        }

        return () => {
            try {
                if (didAttach && typeof (videoTrack as any)?.detach === "function") {
                    (videoTrack as any).detach(el);
                }
            } catch { }
            try {
                el.pause();
            } catch { }
            try {
                (el as any).srcObject = null;
            } catch { }
        };
    }, [videoTrack]);

    const showActions =
        !isLocal &&
        !!hostActions &&
        (!!hostActions.onKick ||
            (!!hostActions.canMuteMic && !!hostActions.onToggleMuteMic) ||
            (!!hostActions.canMuteCam && !!hostActions.onToggleMuteCam));

    return (
        <div
            ref={wrapRef}
            className={
                "relative rounded-2xl overflow-hidden border " +
                (isLight ? "border-black/10 bg-white/70" : "border-white/10 bg-black/20")
            }
        >
            <div className="w-full aspect-video relative">
                {videoTrack ? (
                    <video
                        ref={ref}
                        autoPlay
                        playsInline
                        muted={isLocal}
                        // Extra hints for smoother rendering during resize / compositor changes
                        className="w-full h-full object-cover"
                        style={{
                            backgroundColor: "#000",
                            transform: "translateZ(0)",
                            backfaceVisibility: "hidden",
                            willChange: "transform",
                        }}
                    />
                ) : (
                    <div
                        className={
                            "w-full h-full flex flex-col items-center justify-center text-sm " +
                            (isLight ? "text-black/60 bg-black/5" : "text-white/60 bg-white/5")
                        }
                    >
                        <div className="font-medium">Camera off</div>
                        {debugSizing && sizeText ? <div className="text-[11px] opacity-70 mt-1">{sizeText}</div> : null}
                    </div>
                )}

                {debugSizing && videoTrack && sizeText ? (
                    <div
                        className={
                            "absolute left-2 top-2 px-2 py-1 rounded-lg text-[11px] border " +
                            (isLight ? "bg-white/80 text-black border-black/10" : "bg-black/50 text-white border-white/10")
                        }
                        title="Tile size (debug)"
                    >
                        {sizeText}
                    </div>
                ) : null}
            </div>

            <div
                className={
                    "absolute left-2 bottom-2 px-2 py-1 rounded-lg text-[11px] " +
                    (isLight ? "bg-white/80 text-black" : "bg-black/50 text-white")
                }
            >
                {label}
                {isLocal ? " (you)" : ""}
            </div>

            {showBadge ? (
                <div
                    className={
                        "absolute right-2 top-2 px-2 py-1 rounded-lg text-[11px] font-semibold " +
                        (isLight ? "bg-amber-200/80 text-amber-900" : "bg-amber-400/20 text-amber-200 border border-amber-300/20")
                    }
                >
                    {showBadge}
                </div>
            ) : null}

            {showActions ? (
                <div className="absolute right-2 bottom-2 flex flex-wrap justify-end gap-1 max-w-[92%]">
                    {hostActions?.canMuteMic && hostActions?.onToggleMuteMic ? (
                        <button
                            onClick={hostActions.onToggleMuteMic}
                            disabled={hostActions.busy}
                            className={
                                "px-2 py-1 rounded-lg text-[11px] border flex items-center gap-1 " +
                                (isLight ? "bg-white/85 text-black border-black/10 disabled:opacity-50" : "bg-black/60 text-white border-white/10 disabled:opacity-50")
                            }
                            title="Mute / unmute remote microphone (host action)"
                        >
                            <Icon name={hostActions.micMuted ? "mic-off" : "mic-on"} theme={theme} className="w-4 h-4 opacity-80" />
                            <span>{hostActions.micMuted ? "Unmute mic" : "Mute mic"}</span>
                        </button>
                    ) : null}

                    {hostActions?.canMuteCam && hostActions?.onToggleMuteCam ? (
                        <button
                            onClick={hostActions.onToggleMuteCam}
                            disabled={hostActions.busy}
                            className={
                                "px-2 py-1 rounded-lg text-[11px] border flex items-center gap-1 " +
                                (isLight ? "bg-white/85 text-black border-black/10 disabled:opacity-50" : "bg-black/60 text-white border-white/10 disabled:opacity-50")
                            }
                            title="Mute / unmute remote camera (host action)"
                        >
                            <Icon name={hostActions.camMuted ? "camera-off" : "camera-on"} theme={theme} className="w-4 h-4 opacity-80" />
                            <span>{hostActions.camMuted ? "Unmute cam" : "Mute cam"}</span>
                        </button>
                    ) : null}

                    {hostActions?.onKick ? (
                        <button
                            onClick={hostActions.onKick}
                            disabled={hostActions.busy}
                            className="px-2 py-1 rounded-lg text-[11px] bg-red-600/90 hover:bg-red-700 text-white disabled:opacity-50"
                            title="Remove participant from room"
                        >
                            Kick
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

export default VideoTile;