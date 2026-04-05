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

function getInitials(name: string) {
    const s = String(name || "").trim();
    if (!s) return "U";
    const parts = s.split(/\s+/).filter(Boolean).slice(0, 2);
    const out = parts.map((p) => p[0]?.toUpperCase()).join("");
    return out || "U";
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

type VideoTileProps = {
    label: string;
    videoTrack?: Track;
    isLocal: boolean;
    theme: RoomTheme;
    showBadge?: string | null;
    hostActions?: HostTileActions;
    avatarUrl?: string;
    micMuted?: boolean;
};

function VideoTileInner({
    label,
    videoTrack,
    isLocal,
    theme,
    showBadge,
    hostActions,
    avatarUrl,
    micMuted,
}: VideoTileProps) {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const mediaHostRef = useRef<HTMLDivElement | null>(null);
    const attachedElRef = useRef<HTMLElement | null>(null);

    const isLight = theme === "light";

    const tileBgClass = isLight ? "bg-white/80" : "bg-[#071427]";
    const mediaBgColor = isLight ? "#FFFFFF" : "#071427";
    const offStateClass = isLight ? "text-black/60 bg-[#F6F7FB]" : "text-white/70 bg-[#071427]";
    const offPlateClass = isLight
        ? "bg-white/80 border-black/10 text-black/80"
        : "bg-black/35 border-white/10 text-white/90";
    const initialsBgClass = isLight
        ? "bg-blue-500/15 text-blue-700 border-black/10"
        : "bg-emerald-500/80 text-[#02140B] border-white/10";

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

    useEffect(() => {
        const host = mediaHostRef.current;
        if (!host) return;

        let mountedEl: HTMLElement | null = null;

        const cleanup = () => {
            const current = attachedElRef.current;

            try {
                if (videoTrack && current && typeof (videoTrack as any)?.detach === "function") {
                    (videoTrack as any).detach(current as any);
                }
            } catch { }

            try {
                if (current && host.contains(current)) {
                    host.removeChild(current);
                }
            } catch { }

            if (attachedElRef.current === current) {
                attachedElRef.current = null;
            }

            try {
                if (mountedEl && mountedEl !== current && host.contains(mountedEl)) {
                    host.removeChild(mountedEl);
                }
            } catch { }
        };

        cleanup();

        if (!videoTrack) return cleanup;

        let el: HTMLElement | null = null;

        try {
            if (typeof (videoTrack as any)?.attach === "function") {
                el = (videoTrack as any).attach() as HTMLElement;
            } else {
                console.warn("videoTrack.attach is not a function", videoTrack);
                return cleanup;
            }
        } catch (e) {
            console.error("attach video failed:", e);
            return cleanup;
        }

        if (!el) return cleanup;

        mountedEl = el;

        try {
            el.style.width = "100%";
            el.style.height = "100%";
            (el.style as any).objectFit = "cover";
            el.style.backgroundColor = mediaBgColor;
            el.style.display = "block";
            el.style.transform = "translateZ(0)";
            (el.style as any).backfaceVisibility = "hidden";
            el.style.willChange = "transform";
        } catch { }

        if (el instanceof HTMLVideoElement) {
            try {
                el.muted = !!isLocal;
                el.playsInline = true;
                el.autoplay = true;
            } catch { }

            Promise.resolve()
                .then(() => el.play())
                .catch(() => { });
        }

        try {
            if (!host.contains(el)) {
                host.appendChild(el);
            }
        } catch (e) {
            console.error("append child failed", e);
            return cleanup;
        }

        attachedElRef.current = el;
        return cleanup;
    }, [videoTrack, isLocal, mediaBgColor]);

    const showActions =
        !isLocal &&
        !!hostActions &&
        (!!hostActions.onKick ||
            (!!hostActions.canMuteMic && !!hostActions.onToggleMuteMic) ||
            (!!hostActions.canMuteCam && !!hostActions.onToggleMuteCam));

    const normalizedAvatarUrl = String(avatarUrl || "").trim();
    const initials = getInitials(label || "User");
    const [avatarBroken, setAvatarBroken] = useState(false);

    useEffect(() => {
        setAvatarBroken(false);
    }, [normalizedAvatarUrl]);

    const shouldShowAvatar = !!normalizedAvatarUrl && !avatarBroken;

    const effectiveMicMuted =
        typeof micMuted === "boolean"
            ? micMuted
            : typeof hostActions?.micMuted === "boolean"
                ? hostActions.micMuted
                : false;

    const bottomMetaCls = isLight
        ? "bg-white/85 text-black border-black/10"
        : "bg-black/55 text-white border-white/10";

    const micIconWrapCls = isLight
        ? effectiveMicMuted
            ? "bg-black/8"
            : "bg-emerald-500/12"
        : effectiveMicMuted
            ? "bg-white/8"
            : "bg-emerald-400/18";

    return (
        <div
            ref={wrapRef}
            className={
                "relative rounded-2xl overflow-hidden border " +
                (isLight ? "border-black/10" : "border-white/10") +
                " " +
                tileBgClass
            }
        >
            <div className="w-full aspect-video relative">
                {videoTrack ? (
                    <div
                        ref={mediaHostRef}
                        className="absolute inset-0 w-full h-full"
                        style={{ backgroundColor: mediaBgColor }}
                    />
                ) : (
                    <div className={`absolute inset-0 w-full h-full flex flex-col items-center justify-center text-sm ${offStateClass}`}>
                        {shouldShowAvatar ? (
                            <img
                                src={normalizedAvatarUrl}
                                alt={label || "User"}
                                className={`w-[78px] h-[78px] rounded-full object-cover border shadow-2xl ${isLight ? "border-black/10" : "border-white/10"
                                    }`}
                                referrerPolicy="no-referrer"
                                onError={() => setAvatarBroken(true)}
                                draggable={false}
                            />
                        ) : (
                            <div
                                className={`w-[78px] h-[78px] rounded-full border flex items-center justify-center font-bold text-xl shadow-2xl ${initialsBgClass}`}
                            >
                                {initials}
                            </div>
                        )}

                        <div className={`mt-3 px-3 py-1.5 rounded-xl border backdrop-blur ${offPlateClass}`}>
                            <div className="text-[13px] font-semibold max-w-[260px] truncate text-center">
                                {label || "User"}
                            </div>
                        </div>

                        <div className="mt-2 text-[12px] opacity-75">Camera off</div>

                        {debugSizing && sizeText ? (
                            <div className="text-[11px] opacity-70 mt-1">{sizeText}</div>
                        ) : null}
                    </div>
                )}

                {debugSizing && videoTrack && sizeText ? (
                    <div
                        className={
                            "absolute left-2 top-2 px-2 py-1 rounded-lg text-[11px] border " +
                            (isLight
                                ? "bg-white/80 text-black border-black/10"
                                : "bg-black/50 text-white border-white/10")
                        }
                        title="Tile size (debug)"
                    >
                        {sizeText}
                    </div>
                ) : null}

                <div
                    className={
                        "absolute left-2 bottom-2 max-w-[calc(100%-16px)] px-2 py-1 rounded-lg text-[11px] border " +
                        bottomMetaCls
                    }
                >
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate">
                            {label}
                            {isLocal ? " (you)" : ""}
                        </span>

                        <span
                            className={`shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-md ${micIconWrapCls}`}
                            title={effectiveMicMuted ? "Microphone muted" : "Microphone on"}
                        >
                            <Icon
                                name={effectiveMicMuted ? "mic-off" : "mic-on"}
                                theme={theme}
                                className="w-3.5 h-3.5 opacity-90"
                            />
                        </span>
                    </div>
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
            </div>

            {showActions ? (
                <div className="absolute right-2 bottom-2 flex flex-wrap justify-end gap-1 max-w-[92%]">
                    {hostActions?.canMuteMic && hostActions?.onToggleMuteMic ? (
                        <button
                            onClick={hostActions.onToggleMuteMic}
                            disabled={hostActions.busy}
                            className={
                                "px-2 py-1 rounded-lg text-[11px] border flex items-center gap-1 " +
                                (isLight
                                    ? "bg-white/85 text-black border-black/10 disabled:opacity-50"
                                    : "bg-black/60 text-white border-white/10 disabled:opacity-50")
                            }
                            title="Mute / unmute remote microphone (host action)"
                        >
                            <Icon
                                name={hostActions.micMuted ? "mic-off" : "mic-on"}
                                theme={theme}
                                className="w-4 h-4 opacity-80"
                            />
                            <span>{hostActions.micMuted ? "Unmute mic" : "Mute mic"}</span>
                        </button>
                    ) : null}

                    {hostActions?.canMuteCam && hostActions?.onToggleMuteCam ? (
                        <button
                            onClick={hostActions.onToggleMuteCam}
                            disabled={hostActions.busy}
                            className={
                                "px-2 py-1 rounded-lg text-[11px] border flex items-center gap-1 " +
                                (isLight
                                    ? "bg-white/85 text-black border-black/10 disabled:opacity-50"
                                    : "bg-black/60 text-white border-white/10 disabled:opacity-50")
                            }
                            title="Mute / unmute remote camera (host action)"
                        >
                            <Icon
                                name={hostActions.camMuted ? "camera-off" : "camera-on"}
                                theme={theme}
                                className="w-4 h-4 opacity-80"
                            />
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

const areVideoTilePropsEqual = (prev: VideoTileProps, next: VideoTileProps) => {
    return (
        prev.label === next.label &&
        prev.videoTrack === next.videoTrack &&
        prev.isLocal === next.isLocal &&
        prev.theme === next.theme &&
        prev.showBadge === next.showBadge &&
        prev.avatarUrl === next.avatarUrl &&
        prev.micMuted === next.micMuted &&
        prev.hostActions?.canMuteMic === next.hostActions?.canMuteMic &&
        prev.hostActions?.canMuteCam === next.hostActions?.canMuteCam &&
        prev.hostActions?.micMuted === next.hostActions?.micMuted &&
        prev.hostActions?.camMuted === next.hostActions?.camMuted &&
        prev.hostActions?.busy === next.hostActions?.busy &&
        prev.hostActions?.onToggleMuteMic === next.hostActions?.onToggleMuteMic &&
        prev.hostActions?.onToggleMuteCam === next.hostActions?.onToggleMuteCam &&
        prev.hostActions?.onKick === next.hostActions?.onKick
    );
};

export const VideoTile = React.memo(VideoTileInner, areVideoTilePropsEqual);
export default VideoTile;