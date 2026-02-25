import React, { useEffect, useRef, useState } from "react";
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
    const isLight = theme === "light";

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        let cleanupAttached = false;

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
                cleanupAttached = true;
            } else {
                console.warn("videoTrack.attach is not a function", videoTrack);
            }
        } catch (e) {
            console.error("attach video failed:", e);
        }

        return () => {
            try {
                if (cleanupAttached && typeof (videoTrack as any)?.detach === "function") {
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

    return (
        <div
            className={
                "relative rounded-2xl overflow-hidden border " +
                (isLight ? "border-black/10 bg-white/70" : "border-white/10 bg-black/20")
            }
        >
            <div className="w-full aspect-video">
                {videoTrack ? (
                    <video ref={ref} autoPlay playsInline muted={isLocal} className="w-full h-full object-cover" />
                ) : (
                    <div
                        className={
                            "w-full h-full flex items-center justify-center text-sm " +
                            (isLight ? "text-black/60 bg-black/5" : "text-white/60 bg-white/5")
                        }
                    >
                        Camera off
                    </div>
                )}
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
                        (isLight
                            ? "bg-amber-200/80 text-amber-900"
                            : "bg-amber-400/20 text-amber-200 border border-amber-300/20")
                    }
                >
                    {showBadge}
                </div>
            ) : null}

            {!isLocal && hostActions && (hostActions.canMuteMic || hostActions.canMuteCam) ? (
                <div className="absolute right-2 bottom-2 flex flex-wrap justify-end gap-1 max-w-[90%]">
                    {hostActions.canMuteMic ? (
                        <button
                            onClick={hostActions.onToggleMuteMic}
                            disabled={hostActions.busy}
                            className={
                                "px-2 py-1 rounded-lg text-[11px] border " +
                                (isLight
                                    ? "bg-white/85 text-black border-black/10 disabled:opacity-50"
                                    : "bg-black/60 text-white border-white/10 disabled:opacity-50")
                            }
                            title="Mute / unmute remote microphone (host action)"
                        >
                            {hostActions.micMuted ? "Unmute mic" : "Mute mic"}
                        </button>
                    ) : null}

                    {hostActions.canMuteCam ? (
                        <button
                            onClick={hostActions.onToggleMuteCam}
                            disabled={hostActions.busy}
                            className={
                                "px-2 py-1 rounded-lg text-[11px] border " +
                                (isLight
                                    ? "bg-white/85 text-black border-black/10 disabled:opacity-50"
                                    : "bg-black/60 text-white border-white/10 disabled:opacity-50")
                            }
                            title="Mute / unmute remote camera (host action)"
                        >
                            {hostActions.camMuted ? "Unmute cam" : "Mute cam"}
                        </button>
                    ) : null}

                    <button
                        onClick={hostActions.onKick}
                        disabled={hostActions.busy}
                        className="px-2 py-1 rounded-lg text-[11px] bg-red-600/90 hover:bg-red-700 text-white disabled:opacity-50"
                        title="Remove participant from room"
                    >
                        Kick
                    </button>
                </div>
            ) : null}
        </div>
    );
}

export default VideoTile;