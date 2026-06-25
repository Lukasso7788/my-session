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

function getStatusLabel(status: unknown): string {
    const key = String(status || "").trim().toLowerCase();

    if (key === "afk") return "AFK";
    if (key === "break") return "Break";
    if (key === "skip") return "Skip me";
    if (key === "call") return "On a call";
    if (key === "eating") return "Eating";
    if (key === "private") return "Private";

    return "";
}

function getStatusClass(status: unknown, isLight: boolean): string {
    const key = String(status || "").trim().toLowerCase();

    if (key === "afk") {
        return isLight
            ? "bg-neutral-200 text-neutral-700 border-[#D4D7DC]"
            : "bg-white/10 text-white/80 border-[#3A3A3A]";
    }

    if (key === "break") {
        return isLight
            ? "bg-yellow-100 text-yellow-800 border-yellow-300/60"
            : "bg-yellow-400/15 text-yellow-200 border-yellow-300/25";
    }

    if (key === "skip") {
        return isLight
            ? "bg-purple-100 text-purple-800 border-purple-300/60"
            : "bg-purple-400/15 text-purple-200 border-purple-300/25";
    }

    if (key === "call") {
        return isLight
            ? "bg-neutral-200 text-neutral-800 border-neutral-300/70"
            : "bg-white/10 text-white/80 border-[#3A3A3A]";
    }

    if (key === "eating") {
        return isLight
            ? "bg-orange-100 text-orange-800 border-orange-300/60"
            : "bg-orange-400/15 text-orange-200 border-orange-300/25";
    }

    if (key === "private") {
        return isLight
            ? "bg-neutral-100 text-neutral-700 border-neutral-300/60"
            : "bg-neutral-400/15 text-neutral-200 border-neutral-300/25";
    }

    return isLight
        ? "bg-neutral-100 text-neutral-700 border-[#D4D7DC]"
        : "bg-white/10 text-white/80 border-[#3A3A3A]";
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
    status?: string | null;
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
    density?: "normal" | "compact";
};

function MicBadgeWithBarVisualizer({
    theme,
    micMuted,
    audioTrack,
    audioLevel = 0,
    isLocal,
    hasCameraOn,
}: {
    theme: RoomTheme;
    micMuted?: boolean;
    audioTrack?: LocalAudioTrack | RemoteAudioTrack;
    audioLevel?: number;
    isLocal: boolean;
    hasCameraOn: boolean;
}) {
    const isLight = theme === "light";
    const isSelfMutedBadge = !!isLocal && !!micMuted;

    const badgeBaseClass = isSelfMutedBadge
        ? "bg-red-600 border-red-700/70 text-white shadow-sm"
        : hasCameraOn
            ? "bg-[#333333] border-[#3A3A3A] text-white shadow-sm"
            : isLight
                ? "bg-[#F4F5F6] border-[#D4D7DC] text-neutral-800 shadow-sm"
                : "bg-[#333333] border-[#3A3A3A] text-white shadow-sm";

    const micIconTheme: RoomTheme = isSelfMutedBadge || hasCameraOn ? "dark" : isLight ? "light" : "dark";

    const safeAudioLevel = clamp(Number(audioLevel || 0), 0, 1);
    const speaking = !micMuted && safeAudioLevel > 0.04;
    const showVisualizer = !micMuted && !!audioTrack;

    const micGlowClass = speaking
        ? isLight
            ? "shadow-[0_0_0.8rem_rgba(76,160,255,0.28)]"
            : "shadow-[0_0_0.8rem_rgba(52,211,153,0.28)]"
        : "";

    return (
        <div
            className={`pointer-events-auto relative flex h-6 min-w-6 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border p-1 backdrop-blur-md ${badgeBaseClass} ${micGlowClass}`}
            title={micMuted ? "Microphone off" : speaking ? "Speaking" : "Microphone on"}
            aria-label={micMuted ? "Microphone off" : speaking ? "Speaking" : "Microphone on"}
        >
            {showVisualizer ? (
                <>
                    <div
                        className={`absolute inset-0 ${hasCameraOn || !isLight ? "bg-white/[0.07]" : "bg-black/[0.05]"
                            }`}
                    />

                    <div className="absolute inset-0 overflow-hidden rounded-[9px]">
                        <BarVisualizer
                            track={audioTrack}
                            barCount={1}
                            options={{ minHeight: 16, maxHeight: 100 }}
                            className="absolute inset-0 flex items-end justify-stretch"
                        >
                            <span
                                className={
                                    "lk-audio-bar block h-full w-full rounded-none transition-all duration-75 " +
                                    (hasCameraOn || !isLight
                                        ? "bg-[#34D399]/18 data-[lk-highlighted=true]:bg-[#34D399]/95"
                                        : "bg-[#6B7280]/18 data-[lk-highlighted=true]:bg-[#6B7280]/95")
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
                    className="h-4 w-4"
                />
            </div>
        </div>
    );
}

function VideoTileInner({
    tileId,
    label,
    status,
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
    density = "normal",
    onToggleMenu,
    onOpenProfile,
}: VideoTileProps) {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const mediaHostRef = useRef<HTMLDivElement | null>(null);
    const attachedElRef = useRef<HTMLElement | null>(null);

    const isLight = theme === "light";
    const isCompact = density === "compact";

    const tileBgClass = isLight ? "bg-[#F4F5F6]" : "bg-[#2F2F2F]";
    const mediaBgColor = isLight ? "#F4F5F6" : "#2F2F2F";
    const offStateClass = isLight ? "text-black/60 bg-[#ECEEF0]" : "text-white/70 bg-[#2F2F2F]";
    const initialsBgClass = isLight
        ? "bg-neutral-200 text-neutral-800 border-[#D4D7DC]"
        : "bg-emerald-500/80 text-[#F6F7F8] border-[#3A3A3A]";

    const hasCameraOn = !!videoTrack;

    const namePillClass = hasCameraOn
        ? "bg-[#2F2F2F]/70 border-[#3A3A3A] text-white shadow-sm"
        : isLight
            ? "bg-[#F4F5F6] border-[#D4D7DC] text-neutral-900 shadow-sm"
            : "bg-[#2F2F2F]/70 border-[#3A3A3A] text-white shadow-sm";

    const nameTextClass = hasCameraOn ? "!text-white" : isLight ? "text-neutral-900" : "text-white";

    const menuBtnClass = isLight
        ? "bg-[#F4F5F6] border-[#D4D7DC] text-black/85 hover:bg-[#F2F3F5]"
        : "bg-[#333333] border-[#3A3A3A] text-white hover:bg-[#333333]";

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

    return (
        <div
            ref={wrapRef}
            className={
                "group relative h-full w-full min-h-0 min-w-0 overflow-hidden border " +
                (isCompact ? "rounded-xl " : "rounded-2xl ") +
                (isLight ? "border-[#D4D7DC]" : "border-[#3A3A3A]") +
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
                    <div
                        className={`absolute inset-0 flex flex-col items-center justify-center ${offStateClass}`}
                    >
                        {shouldShowAvatar ? (
                            <img
                                src={normalizedAvatarUrl}
                                alt={label || "User"}
                                className={`${isCompact ? "h-[clamp(2.3rem,16vmin,3.4rem)] w-[clamp(2.3rem,16vmin,3.4rem)]" : "h-[clamp(4.4rem,12vw,5.8rem)] w-[clamp(4.4rem,12vw,5.8rem)]"} rounded-full object-cover border shadow-2xl ${isLight ? "border-[#D4D7DC]" : "border-[#3A3A3A]"
                                    }`}
                                referrerPolicy="no-referrer"
                                onError={() => setAvatarBroken(true)}
                                draggable={false}
                            />
                        ) : (
                            <div
                                className={`${isCompact ? "h-[clamp(2.3rem,16vmin,3.4rem)] w-[clamp(2.3rem,16vmin,3.4rem)] text-[clamp(0.8rem,5vmin,1.05rem)]" : "h-[clamp(4.4rem,12vw,5.8rem)] w-[clamp(4.4rem,12vw,5.8rem)] text-[clamp(1.1rem,3vw,1.45rem)]"} rounded-full border flex items-center justify-center font-bold shadow-2xl ${initialsBgClass}`}
                            >
                                {initials}
                            </div>
                        )}

                        <div className="mt-2 text-[11px] opacity-75">Camera off</div>

                        {debugSizing && sizeText ? (
                            <div className="text-[10px] opacity-70 mt-1">{sizeText}</div>
                        ) : null}
                    </div>
                )}

                {debugSizing && videoTrack && sizeText ? (
                    <div
                        className={
                            "absolute left-2 top-2 px-2 py-1 rounded-lg text-[10px] border " +
                            (isLight
                                ? "bg-[#F4F5F6] text-black border-[#D4D7DC]"
                                : "bg-[#333333] text-white border-[#3A3A3A]")
                        }
                        title="Tile size (debug)"
                    >
                        {sizeText}
                    </div>
                ) : null}

                {showBadge ? (
                    <div
                        className={
                            "absolute right-2 top-2 px-2 py-1 rounded-lg text-[10px] font-semibold " +
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
                        className={`absolute right-[0.55rem] top-[0.55rem] z-20 flex h-[2.1rem] w-[2.1rem] items-center justify-center rounded-full border backdrop-blur-md transition ${menuBtnClass} opacity-0 group-hover:opacity-100 focus:opacity-100 pointer-events-none group-hover:pointer-events-auto focus:pointer-events-auto`}
                        aria-label="Open participant actions"
                        title="Open participant actions"
                    >
                        <span className="text-[1rem] leading-none">⋯</span>
                    </button>
                ) : null}

                {showActions ? (
                    <div className="absolute right-2 bottom-10 z-10 flex max-w-[92%] flex-wrap justify-end gap-1">
                        {hostActions?.canMuteMic && hostActions?.onToggleMuteMic ? (
                            <button
                                onClick={hostActions.onToggleMuteMic}
                                disabled={hostActions.busy}
                                className={
                                    "px-2 py-1 rounded-lg text-[11px] border flex items-center gap-1 " +
                                    (isLight
                                        ? "bg-[#F4F5F6] text-black border-[#D4D7DC] disabled:opacity-50"
                                        : "bg-[#2F2F2F]/80 text-white border-[#3A3A3A] disabled:opacity-50")
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
                                        ? "bg-[#F4F5F6] text-black border-[#D4D7DC] disabled:opacity-50"
                                        : "bg-[#2F2F2F]/80 text-white border-[#3A3A3A] disabled:opacity-50")
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

                <button
                    type="button"
                    onClick={() => onOpenProfile?.()}
                    className="absolute inset-0 z-[1]"
                    aria-label={`Open ${label || "participant"} profile`}
                    title={label || "Participant"}
                />
            </div>

            <div className={`pointer-events-none absolute z-[12] flex min-w-0 items-end justify-between gap-[0.35rem] ${isCompact ? "inset-x-[0.28rem] bottom-[0.28rem]" : "inset-x-[0.4rem] bottom-[0.4rem]"}`}>
                <div
                    className={`pointer-events-auto min-w-0 max-w-full rounded-[12px] border backdrop-blur-md ${isCompact ? "px-1.5 py-0.5" : "px-2 py-1"} ${namePillClass}`}
                >
                    <div className="flex min-w-0 items-center gap-[0.35rem]">
                        <>
                            <span
                                className={`min-w-0 truncate ${isCompact ? "text-[10px]" : "text-[12px]"} font-medium leading-none ${nameTextClass}`}
                            >
                                {label || "User"}
                            </span>

                            {status ? (
                                <span
                                    className={`shrink-0 rounded-full border px-1.5 py-[1px] text-[10px] leading-none ${getStatusClass(status, isLight)}`}
                                    title={getStatusLabel(status)}
                                >
                                    {getStatusLabel(status)}
                                </span>
                            ) : null}
                        </>
                    </div>
                </div>

                <MicBadgeWithBarVisualizer
                    theme={theme}
                    micMuted={micMuted}
                    audioTrack={audioTrack}
                    audioLevel={audioLevel}
                    isLocal={isLocal}
                    hasCameraOn={hasCameraOn}
                />
            </div>
        </div>
    );
}

const areVideoTilePropsEqual = (prev: VideoTileProps, next: VideoTileProps) => {
    return (
        prev.tileId === next.tileId &&
        prev.label === next.label &&
        prev.status === next.status &&
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
        prev.density === next.density &&
        prev.onToggleMenu === next.onToggleMenu &&
        prev.onOpenProfile === next.onOpenProfile &&
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