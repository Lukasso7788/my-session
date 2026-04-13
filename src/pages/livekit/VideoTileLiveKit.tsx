import React, { useEffect, useMemo, useRef, useState } from "react";
import { Track, LocalAudioTrack, RemoteAudioTrack } from "livekit-client";
import { BarVisualizer } from "@livekit/components-react";

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

function clamp(n: number, a: number, b: number) {
    return Math.max(a, Math.min(b, n));
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
    | "timer"
    | "more";
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
    tileId: string;
    label: string;
    videoTrack?: Track;
    audioTrack?: LocalAudioTrack | RemoteAudioTrack;
    isLocal: boolean;
    theme: RoomTheme;
    showBadge?: string | null;
    hostActions?: HostTileActions;
    avatarUrl?: string;
    micMuted?: boolean;
    mirrorVideo?: boolean;
    audioLevel?: number;
    showMenuButton?: boolean;
    onToggleMenu?: (tileId: string, anchorEl: HTMLElement | null) => void;
    onOpenProfile?: () => void;

    onEditName?: () => void;
    forceEditButtonVisible?: boolean;
};

function MicBadgeWithBarVisualizer({
    theme,
    micMuted,
    audioTrack,
    audioLevel = 0,
    isLocal,
}: {
    theme: RoomTheme;
    micMuted?: boolean;
    audioTrack?: LocalAudioTrack | RemoteAudioTrack;
    audioLevel?: number;
    isLocal: boolean;
}) {
    const isLight = theme === "light";
    const isSelfMutedBadge = !!isLocal && !!micMuted;

    const badgeBaseClass = isSelfMutedBadge
        ? "bg-red-600 border-red-700/70 text-white shadow-sm"
        : isLight
            ? "bg-white/92 border-black/10 text-neutral-800 shadow-sm"
            : "bg-black/58 border-white/10 text-white shadow-sm";

    const micIconTheme: RoomTheme = isSelfMutedBadge ? "dark" : isLight ? "light" : "dark";

    const safeAudioLevel = clamp(Number(audioLevel || 0), 0, 1);
    const speaking = !micMuted && safeAudioLevel > 0.04;
    const showVisualizer = !micMuted && !!audioTrack;

    const micGlowClass = speaking
        ? isLight
            ? "shadow-[0_0_1rem_rgba(76,160,255,0.35)]"
            : "shadow-[0_0_1rem_rgba(52,211,153,0.35)]"
        : "";

    return (
        <div
            className={`pointer-events-auto relative flex h-[2rem] min-w-[2.45rem] shrink-0 items-center justify-center overflow-hidden rounded-[0.8rem] border px-[0.35rem] backdrop-blur-md ${badgeBaseClass} ${micGlowClass}`}
            title={micMuted ? "Microphone off" : speaking ? "Speaking" : "Microphone on"}
            aria-label={micMuted ? "Microphone off" : speaking ? "Speaking" : "Microphone on"}
        >
            {showVisualizer ? (
                <>
                    <div
                        className={`absolute inset-0 ${isLight ? "bg-black/[0.05]" : "bg-white/[0.07]"}`}
                    />

                    <div className="absolute inset-0 overflow-hidden rounded-[0.75rem]">
                        <BarVisualizer
                            track={audioTrack}
                            barCount={1}
                            options={{ minHeight: 16, maxHeight: 100 }}
                            className="absolute inset-0 flex items-end justify-stretch"
                        >
                            <span
                                className={
                                    "lk-audio-bar block h-full w-full rounded-none transition-all duration-75 " +
                                    (isLight
                                        ? "bg-[#4CA0FF]/18 data-[lk-highlighted=true]:bg-[#4CA0FF]/95"
                                        : "bg-[#34D399]/18 data-[lk-highlighted=true]:bg-[#34D399]/95")
                                }
                            />
                        </BarVisualizer>
                    </div>
                </>
            ) : null}

            <div className="relative z-[1] flex items-center justify-center">
                <Icon
                    name={micMuted ? "mic-off" : "mic-on"}
                    theme={micIconTheme}
                    className="h-[1rem] w-[1rem]"
                />
            </div>
        </div>
    );
}

function VideoTileInner({
    tileId,
    label,
    videoTrack,
    audioTrack,
    isLocal,
    theme,
    showBadge,
    hostActions,
    avatarUrl,
    micMuted,
    mirrorVideo = true,
    audioLevel = 0,
    showMenuButton = false,
    onToggleMenu,
    onOpenProfile,
    onEditName,
    forceEditButtonVisible = false,
}: VideoTileProps) {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const mediaHostRef = useRef<HTMLDivElement | null>(null);
    const attachedElRef = useRef<HTMLElement | null>(null);

    const isLight = theme === "light";

    const tileBgClass = isLight ? "bg-white/80" : "bg-[#071427]";
    const mediaBgColor = isLight ? "#FFFFFF" : "#071427";
    const offStateClass = isLight ? "text-black/60 bg-[#F6F7FB]" : "text-white/70 bg-[#071427]";
    const initialsBgClass = isLight
        ? "bg-blue-500/15 text-blue-700 border-black/10"
        : "bg-emerald-500/80 text-[#02140B] border-white/10";

    const namePillClass = isLight
        ? "bg-white/70 border-black/10 text-black/85"
        : "bg-black/30 border-white/10 text-white/90";

    const nameTextClass = "truncate max-w-[220px] font-inter text-[14px] font-medium";
    const editBtnClass = isLight
        ? "bg-white/90 border-black/10 text-black/75 hover:bg-white"
        : "bg-black/55 border-white/10 text-white/90 hover:bg-black/70";

    const menuBtnClass = isLight
        ? "bg-white/92 border-black/10 text-black/85 hover:bg-white"
        : "bg-black/58 border-white/10 text-white hover:bg-black/70";

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
            el.style.transform = isLocal
                ? mirrorVideo
                    ? "translateZ(0) scaleX(-1)"
                    : "translateZ(0) scaleX(1)"
                : "translateZ(0)";
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
    }, [videoTrack, isLocal, mediaBgColor, mirrorVideo]);

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
    const showEditName = isLocal && typeof onEditName === "function";

    return (
        <div
            ref={wrapRef}
            className={
                "group relative h-full w-full min-h-0 min-w-0 rounded-2xl overflow-hidden border " +
                (isLight ? "border-black/10" : "border-white/10") +
                " " +
                tileBgClass
            }
        >
            <div className="absolute inset-0">
                {videoTrack ? (
                    <div
                        ref={mediaHostRef}
                        className="absolute inset-0 w-full h-full"
                        style={{ backgroundColor: mediaBgColor }}
                    />
                ) : (
                    <div className={`absolute inset-0 flex flex-col items-center justify-center ${offStateClass}`}>
                        {shouldShowAvatar ? (
                            <img
                                src={normalizedAvatarUrl}
                                alt={label || "User"}
                                className={`h-[clamp(4.4rem,12vw,5.8rem)] w-[clamp(4.4rem,12vw,5.8rem)] rounded-full object-cover border shadow-2xl ${isLight ? "border-black/10" : "border-white/10"
                                    }`}
                                referrerPolicy="no-referrer"
                                onError={() => setAvatarBroken(true)}
                                draggable={false}
                            />
                        ) : (
                            <div
                                className={`h-[clamp(4.4rem,12vw,5.8rem)] w-[clamp(4.4rem,12vw,5.8rem)] rounded-full border flex items-center justify-center font-bold text-[clamp(1.1rem,3vw,1.45rem)] shadow-2xl ${initialsBgClass}`}
                            >
                                {initials}
                            </div>
                        )}

                        <div className="mt-[0.7rem] text-[0.76rem] opacity-75">Camera off</div>

                        {debugSizing && sizeText ? (
                            <div className="text-[0.7rem] opacity-70 mt-[0.35rem]">{sizeText}</div>
                        ) : null}
                    </div>
                )}

                {debugSizing && videoTrack && sizeText ? (
                    <div
                        className={
                            "absolute left-2 top-2 px-2 py-1 rounded-lg text-[0.7rem] border " +
                            (isLight
                                ? "bg-white/80 text-black border-black/10"
                                : "bg-black/50 text-white border-white/10")
                        }
                        title="Tile size (debug)"
                    >
                        {sizeText}
                    </div>
                ) : null}

                {showBadge ? (
                    <div
                        className={
                            "absolute right-2 top-2 px-2 py-1 rounded-lg text-[0.7rem] font-semibold " +
                            (isLight
                                ? "bg-amber-200/80 text-amber-900"
                                : "bg-amber-400/20 text-amber-200 border border-amber-300/20")
                        }
                    >
                        {showBadge}
                    </div>
                ) : null}

                {showMenuButton ? (
                    <button
                        type="button"
                        data-lk-admin-menu-anchor="true"
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleMenu?.(tileId, e.currentTarget);
                        }}
                        className={`absolute right-[0.55rem] top-[0.55rem] z-20 flex h-[2.1rem] w-[2.1rem] items-center justify-center rounded-full border backdrop-blur-md transition ${menuBtnClass} ${forceEditButtonVisible
                            ? "opacity-100 pointer-events-auto"
                            : "opacity-0 group-hover:opacity-100 focus:opacity-100 pointer-events-none group-hover:pointer-events-auto focus:pointer-events-auto"
                            }`}
                        aria-label="Open participant actions"
                        title="Open participant actions"
                    >
                        <span className="text-[1rem] leading-none">⋯</span>
                    </button>
                ) : null}

                {showActions ? (
                    <div className="absolute right-2 bottom-[3.35rem] z-10 flex max-w-[92%] flex-wrap justify-end gap-1">
                        {hostActions?.canMuteMic && hostActions?.onToggleMuteMic ? (
                            <button
                                onClick={hostActions.onToggleMuteMic}
                                disabled={hostActions.busy}
                                className={
                                    "px-2 py-1 rounded-lg text-[0.7rem] border flex items-center gap-1 " +
                                    (isLight
                                        ? "bg-white/90 text-black border-black/10 disabled:opacity-50"
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
                                    "px-2 py-1 rounded-lg text-[0.7rem] border flex items-center gap-1 " +
                                    (isLight
                                        ? "bg-white/90 text-black border-black/10 disabled:opacity-50"
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
                                className="px-2 py-1 rounded-lg text-[0.7rem] bg-red-600/90 hover:bg-red-700 text-white disabled:opacity-50"
                                title="Remove participant from room"
                            >
                                Kick
                            </button>
                        ) : null}
                    </div>
                ) : null}

                <button
                    type="button"
                    onClick={() => onOpenProfile?.()}
                    className="absolute inset-0 z-[1]"
                    aria-label={`Open ${label || "participant"} profile`}
                    title={label || "Participant"}
                />
            </div>

            <div className="pointer-events-none absolute left-[0.55rem] right-[0.55rem] bottom-[0.55rem] z-[12] flex min-w-0 items-end justify-between gap-[0.45rem]">
                <div className="pointer-events-none flex min-w-0 items-end gap-[0.45rem]">
                    <div
                        className={`pointer-events-auto inline-flex min-w-0 max-w-full items-center rounded-2xl border backdrop-blur shadow-sm px-3 py-2 transition ${namePillClass}`}
                    >
                        <span className={nameTextClass}>
                            {label || "User"}
                        </span>
                    </div>

                    {showEditName && (
                        <button
                            type="button"
                            title="Edit name"
                            aria-label="Edit name"
                            onClick={(e) => {
                                e.stopPropagation();
                                onEditName?.();
                            }}
                            className={[
                                "pointer-events-auto h-9 rounded-2xl border shadow-sm backdrop-blur overflow-hidden transition-all duration-200 flex items-center justify-center",
                                forceEditButtonVisible
                                    ? "max-w-[132px] px-3 opacity-100 translate-x-0"
                                    : "max-w-0 px-0 opacity-0 -translate-x-1 group-hover:max-w-[132px] group-hover:px-3 group-hover:opacity-100 group-hover:translate-x-0 focus:max-w-[132px] focus:px-3 focus:opacity-100 focus:translate-x-0",
                                editBtnClass,
                            ].join(" ")}
                        >
                            <span className="flex min-w-max items-center gap-2">
                                <span className="text-[15px] leading-none">✎</span>
                                <span className="text-[12px] font-medium leading-none whitespace-nowrap">
                                    Edit name
                                </span>
                            </span>
                        </button>
                    )}
                </div>

                <MicBadgeWithBarVisualizer
                    theme={theme}
                    micMuted={micMuted}
                    audioTrack={audioTrack}
                    audioLevel={audioLevel}
                    isLocal={isLocal}
                />
            </div>
        </div>
    );
}

const areVideoTilePropsEqual = (prev: VideoTileProps, next: VideoTileProps) => {
    return (
        prev.tileId === next.tileId &&
        prev.label === next.label &&
        prev.videoTrack === next.videoTrack &&
        prev.audioTrack === next.audioTrack &&
        prev.isLocal === next.isLocal &&
        prev.theme === next.theme &&
        prev.showBadge === next.showBadge &&
        prev.avatarUrl === next.avatarUrl &&
        prev.micMuted === next.micMuted &&
        prev.mirrorVideo === next.mirrorVideo &&
        prev.audioLevel === next.audioLevel &&
        prev.showMenuButton === next.showMenuButton &&
        prev.onToggleMenu === next.onToggleMenu &&
        prev.onOpenProfile === next.onOpenProfile &&
        prev.onEditName === next.onEditName &&
        prev.forceEditButtonVisible === next.forceEditButtonVisible &&
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