import React, { useEffect, useMemo, useRef, useState } from "react";
import { Track, LocalAudioTrack, RemoteAudioTrack } from "livekit-client";
import { BarVisualizer } from "@livekit/components-react";
import { Pencil } from "lucide-react";

type RoomTheme = "dark" | "light";
export type CameraFramingMode = "full" | "fill";

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
        if (v === "" || v === "1" || v === "true" || v === "yes" || v === "on")
            return true;
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


function getStatusLabel(status: unknown): string {
    const key = String(status || "")
        .trim()
        .toLowerCase();

    if (key === "afk") return "AFK";
    if (key === "break") return "Break";
    if (key === "skip" || key === "skip_deafened") return "Skip me";
    if (key === "call") return "On a call";
    if (key === "eating") return "Eating";
    if (key === "private") return "Private";

    return "";
}

function getStatusClass(status: unknown, isLight: boolean): string {
    const key = String(status || "")
        .trim()
        .toLowerCase();

    if (key === "afk") {
        return isLight
            ? "bg-neutral-200 text-neutral-700 border-[#D8D0D0]"
            : "bg-white/10 text-white/80 border-[#2B2B2B]";
    }

    if (key === "break") {
        return isLight
            ? "bg-yellow-100 text-yellow-800 border-yellow-300/60"
            : "bg-yellow-400/15 text-yellow-200 border-yellow-300/25";
    }

    if (key === "skip" || key === "skip_deafened") {
        return isLight
            ? "bg-purple-100 text-purple-800 border-purple-300/60"
            : "bg-purple-400/15 text-purple-200 border-purple-300/25";
    }

    if (key === "call") {
        return isLight
            ? "bg-neutral-200 text-neutral-800 border-neutral-300/70"
            : "bg-white/10 text-white/80 border-[#2B2B2B]";
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
        ? "bg-neutral-100 text-neutral-700 border-[#D8D0D0]"
        : "bg-white/10 text-white/80 border-[#2B2B2B]";
}

export function SkipMeMutedStatusIcon({
    theme,
    className = "h-3 w-3",
}: {
    theme: RoomTheme;
    className?: string;
}) {
    const customSrc = `/icons/status-skip-muted-${theme}.svg`;
    const fallbackSrc = `/icons/mic-off-${theme}.svg`;
    const [src, setSrc] = useState(customSrc);

    useEffect(() => {
        setSrc(customSrc);
    }, [customSrc]);

    return (
        <img
            src={src}
            className={className}
            alt=""
            aria-hidden="true"
            draggable={false}
            onError={(event) => {
                if (src !== fallbackSrc) {
                    setSrc(fallbackSrc);
                    return;
                }
                event.currentTarget.style.display = "none";
            }}
        />
    );
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
    | "tasks"
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
    isSpeaking?: boolean;
    showMenuButton?: boolean;
    onToggleMenu?: (tileId: string, anchorEl: HTMLElement | null) => void;
    onOpenProfile?: (tileId: string) => void;
    onOpenContextMenu?: (
        tileId: string,
        tileEl: HTMLElement,
        point: { x: number; y: number },
    ) => void;
    onEditName?: () => void;
    density?: "normal" | "compact";
    currentIntention?: string | null;
    taskList?: string[];
    showAllTasks?: boolean;
    participantTimeZone?: string | null;
    cameraFramingMode?: CameraFramingMode;
};

function formatParticipantTime(timeZone: string, at = new Date()) {
    const safeTimeZone = String(timeZone || "").trim();
    if (!safeTimeZone) return "";

    try {
        const city = safeTimeZone.split("/").pop()?.replace(/_/g, " ") || safeTimeZone;
        const time = new Intl.DateTimeFormat(undefined, {
            timeZone: safeTimeZone,
            hour: "numeric",
            minute: "2-digit",
        }).format(at);
        return `${city} · ${time}`;
    } catch {
        return "";
    }
}

function useHeldSpeaking(active: boolean, holdMs = 650) {
    const [held, setHeld] = useState(active);
    const releaseTimerRef = useRef<number | null>(null);

    useEffect(() => {
        if (active) {
            if (releaseTimerRef.current !== null) {
                window.clearTimeout(releaseTimerRef.current);
                releaseTimerRef.current = null;
            }
            setHeld(true);
            return;
        }

        if (releaseTimerRef.current === null) {
            releaseTimerRef.current = window.setTimeout(() => {
                releaseTimerRef.current = null;
                setHeld(false);
            }, holdMs);
        }
    }, [active, holdMs]);

    useEffect(() => () => {
        if (releaseTimerRef.current !== null) {
            window.clearTimeout(releaseTimerRef.current);
        }
    }, []);

    return held;
}

function MicBadgeWithBarVisualizer({
    theme,
    micMuted,
    audioTrack,
    isSpeaking = false,
    isLocal,
    hasCameraOn,
}: {
    theme: RoomTheme;
    micMuted?: boolean;
    audioTrack?: LocalAudioTrack | RemoteAudioTrack;
    isSpeaking?: boolean;
    isLocal: boolean;
    hasCameraOn: boolean;
}) {
    const isLight = theme === "light";
    const isSelfMutedBadge = !!isLocal && !!micMuted;

    const badgeBaseClass = isSelfMutedBadge
        ? "bg-[#F65252] border-red-700/70 text-white shadow-sm"
        : hasCameraOn
            ? "bg-[#1B1B1B] border-[#2B2B2B] text-white shadow-sm"
            : isLight
                ? "bg-[#F5F5F5] border-[#D8D0D0] text-neutral-800 shadow-sm"
                : "bg-[#1B1B1B] border-[#2B2B2B] text-white shadow-sm";

    const micIconTheme: RoomTheme =
        isSelfMutedBadge || hasCameraOn ? "dark" : isLight ? "light" : "dark";

    const speaking = !micMuted && isSpeaking;
    const showVisualizer = !micMuted && !!audioTrack;


    return (
        <div
            className={`pointer-events-auto relative flex h-6 min-w-6 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border p-1 backdrop-blur-md ${badgeBaseClass}`}
            title={
                micMuted ? "Microphone off" : speaking ? "Speaking" : "Microphone on"
            }
            aria-label={
                micMuted ? "Microphone off" : speaking ? "Speaking" : "Microphone on"
            }
        >
            {showVisualizer ? (
                <>
                    <div
                        className={`absolute inset-0 ${
                            hasCameraOn || !isLight
                                ? "bg-white/[0.07]"
                                : "bg-black/[0.05]"
                        }`}
                    />

                    <div className="absolute inset-0 overflow-hidden rounded-[9px]">
                        <BarVisualizer
                            track={audioTrack}
                            barCount={1}
                            options={{ minHeight: 16, maxHeight: 100 }}
                            className="absolute inset-0 flex items-end justify-stretch"
                            style={
                                {
                                    "--lk-va-bar-width": "100%",
                                    "--lk-va-bar-border-radius": "0px",
                                    "--lk-va-bar-bg": hasCameraOn || !isLight
                                        ? "rgba(82, 134, 246, 0.18)"
                                        : "rgba(82, 134, 246, 0.16)",
                                    "--lk-fg": hasCameraOn || !isLight
                                        ? "rgba(82, 134, 246, 0.95)"
                                        : "rgba(82, 134, 246, 0.90)",
                                    background: "transparent",
                                } as React.CSSProperties
                            }
                        >
                            <span
                                className="lk-audio-bar block h-full w-full rounded-none bg-[#5286F6]/90 transition-[height] duration-150 ease-out"
                                style={{ width: "100%" }}
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
    isSpeaking = false,
    showMenuButton = false,
    density = "normal",
    currentIntention,
    taskList = [],
    showAllTasks = false,
    participantTimeZone,
    cameraFramingMode = "full",
    onToggleMenu,
    onOpenProfile,
    onOpenContextMenu,
    onEditName,
}: VideoTileProps) {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const mediaHostRef = useRef<HTMLDivElement | null>(null);
    const attachedElRef = useRef<HTMLElement | null>(null);
    const cameraFramingModeRef = useRef(cameraFramingMode);
    cameraFramingModeRef.current = cameraFramingMode;

    // Keep the outgoing LiveKit element mounted just long enough to crossfade
    // into the avatar instead of cutting to the camera-off state in one frame.
    const cameraFadeDurationMs = 360;
    const [renderedVideoTrack, setRenderedVideoTrack] = useState<Track | undefined>(videoTrack);
    const [cameraLayerVisible, setCameraLayerVisible] = useState(!!videoTrack);
    const renderedVideoTrackRef = useRef<Track | undefined>(videoTrack);
    const cameraFadeTimerRef = useRef<number | null>(null);

    useEffect(() => {
        if (cameraFadeTimerRef.current !== null) {
            window.clearTimeout(cameraFadeTimerRef.current);
            cameraFadeTimerRef.current = null;
        }

        if (videoTrack) {
            const isEntering = !renderedVideoTrackRef.current;
            renderedVideoTrackRef.current = videoTrack;
            setRenderedVideoTrack(videoTrack);

            if (isEntering) {
                setCameraLayerVisible(false);
                cameraFadeTimerRef.current = window.setTimeout(() => {
                    setCameraLayerVisible(true);
                    cameraFadeTimerRef.current = null;
                }, 24);
                return () => {
                    if (cameraFadeTimerRef.current !== null) {
                        window.clearTimeout(cameraFadeTimerRef.current);
                        cameraFadeTimerRef.current = null;
                    }
                };
            }

            setCameraLayerVisible(true);
            return;
        }

        setCameraLayerVisible(false);
        cameraFadeTimerRef.current = window.setTimeout(() => {
            renderedVideoTrackRef.current = undefined;
            setRenderedVideoTrack(undefined);
            cameraFadeTimerRef.current = null;
        }, cameraFadeDurationMs);

        return () => {
            if (cameraFadeTimerRef.current !== null) {
                window.clearTimeout(cameraFadeTimerRef.current);
                cameraFadeTimerRef.current = null;
            }
        };
    }, [videoTrack]);

    const isLight = theme === "light";
    const isCompact = density === "compact";

    const tileBgClass = isLight ? "bg-[#F8F8F8]" : "bg-[#1B1B1B]";
    const mediaBgColor = isLight ? "#F8F8F8" : "#1E1E1E";
    const offStateClass = isLight
        ? "text-black/60 bg-[#F3F1F1]"
        : "text-white/70 bg-[#1B1B1B]";
    const initialsBgClass = isLight
        ? "bg-neutral-200 text-neutral-800 border-[#D8D0D0]"
        : "bg-[#81DB86]/80 text-[#F3F3F3] border-[#2B2B2B]";

    const hasCameraOn = !!videoTrack;
    const heldSpeaking = useHeldSpeaking(!micMuted && isSpeaking);
    const speakingFrameClass = heldSpeaking
        ? isLight
            ? "border-[#5286F6] shadow-[0_0_0_2px_rgba(82,134,246,0.28),0_0_1.1rem_rgba(82,134,246,0.18)]"
            : "border-[#5286F6] shadow-[0_0_0_2px_rgba(82,134,246,0.34),0_0_1.1rem_rgba(82,134,246,0.22)]"
        : isLight
            ? "border-[#D8D0D0] shadow-none"
            : "border-[#2B2B2B] shadow-none";

    const menuBtnClass = isLight
        ? "bg-[#F5F5F5] border-[#D8D0D0] text-black/85 hover:bg-[#F2F3F5]"
        : "bg-[#1B1B1B] border-[#2B2B2B] text-white hover:bg-[#1B1B1B]";

    const editNameBtnClass = isLight
        ? "!bg-[#F5F5F5] !border-[#D8D0D0] !text-black/85 hover:!bg-[#F2F3F5]"
        : "!bg-[#1B1B1B]/95 !border-[#2B2B2B] !text-white/90 hover:!bg-[#242424]";

    const debugSizing = useMemo(() => getQueryBool("devTileDebug", false), []);
    const safeCurrentIntention = String(currentIntention || "").trim();
    const safeTaskList = useMemo(() => {
        const seen = new Set<string>();
        return [safeCurrentIntention, ...(Array.isArray(taskList) ? taskList : [])]
            .map((value) => String(value || "").replace(/\s+/g, " ").trim())
            .filter((value) => {
                const key = value.toLowerCase();
                if (!value || seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .slice(0, 12);
    }, [safeCurrentIntention, taskList]);
    const [participantClock, setParticipantClock] = useState(() => Date.now());
    const participantTime = formatParticipantTime(
        String(participantTimeZone || ""),
        new Date(participantClock),
    );
    const [sizeText, setSizeText] = useState<string>("");

    useEffect(() => {
        if (!participantTimeZone) return;
        const timer = window.setInterval(() => setParticipantClock(Date.now()), 30_000);
        return () => window.clearInterval(timer);
    }, [participantTimeZone]);

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
        let mountedVideo: HTMLVideoElement | null = null;
        const playbackTimers: number[] = [];

        const tryPlay = () => {
            if (!mountedVideo || !mountedVideo.isConnected) return;
            mountedVideo.play().catch(() => { });
        };

        const cleanup = () => {
            playbackTimers.forEach((timer) => window.clearTimeout(timer));
            if (mountedVideo) {
                mountedVideo.removeEventListener("loadedmetadata", tryPlay);
                mountedVideo.removeEventListener("canplay", tryPlay);
            }
            const current = attachedElRef.current;

            try {
                if (
                    renderedVideoTrack &&
                    current &&
                    typeof (renderedVideoTrack as any)?.detach === "function"
                ) {
                    (renderedVideoTrack as any).detach(current as any);
                }
            } catch { }

            // Explicitly release the browser's decoded frame/audio buffers.
            // Removing the node alone can leave its MediaStream retained until
            // a later GC cycle, which is especially visible with several tiles.
            if (current instanceof HTMLMediaElement) {
                try {
                    current.pause();
                    current.srcObject = null;
                    current.removeAttribute("src");
                } catch { }
            }

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

        if (!renderedVideoTrack) return cleanup;

        let el: HTMLElement | null = null;

        try {
            if (typeof (renderedVideoTrack as any)?.attach === "function") {
                el = (renderedVideoTrack as any).attach() as HTMLElement;
            } else {
                console.warn("videoTrack.attach is not a function", renderedVideoTrack);
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
            (el.style as any).objectFit = cameraFramingModeRef.current === "fill" ? "cover" : "contain";
            (el.style as any).objectPosition = "center center";
            el.style.display = "block";
            (el.style as any).backfaceVisibility = "hidden";
            // Avoid retaining a dedicated compositor surface for every tile.
            // The local mirror transform works without permanently promoting
            // all participant videos to their own GPU layers.
            el.style.removeProperty("will-change");
        } catch { }

        if (el instanceof HTMLVideoElement) {
            try {
                // Camera video never carries the participant's audio in this UI;
                // audio has its own LiveKit attachment. Muting video before play
                // keeps Safari autoplay-compliant for local and remote tiles.
                el.muted = true;
                el.defaultMuted = true;
                el.playsInline = true;
                el.autoplay = true;
                el.setAttribute("muted", "");
                el.setAttribute("playsinline", "");
                el.setAttribute("webkit-playsinline", "");
            } catch { }
            mountedVideo = el;
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

        // WebKit needs the media element connected before play(), and can expose
        // the stream only after loadedmetadata/canplay. Retrying these idempotent
        // calls avoids a permanently black tile after permission was granted.
        if (mountedVideo) {
            mountedVideo.addEventListener("loadedmetadata", tryPlay);
            mountedVideo.addEventListener("canplay", tryPlay);
            tryPlay();
            playbackTimers.push(window.setTimeout(tryPlay, 120));
            playbackTimers.push(window.setTimeout(tryPlay, 500));
        }
        return cleanup;
    }, [renderedVideoTrack]);

    // Change framing without detaching and recreating the LiveKit media element.
    // `contain` preserves the complete portrait feed from phones; `cover` keeps
    // the previous edge-to-edge crop for people who prefer a filled tile.
    useEffect(() => {
        const el = attachedElRef.current;
        if (!el) return;

        try {
            (el.style as any).objectFit = cameraFramingMode === "fill" ? "cover" : "contain";
            (el.style as any).objectPosition = "center center";
        } catch { }
    }, [cameraFramingMode, videoTrack]);

    // Theme, mirroring, and local/remote presentation are UI concerns. Update
    // the existing media element in place so a theme switch never detaches the
    // LiveKit track, creates a new <video>, or calls play() again.
    useEffect(() => {
        const el = attachedElRef.current;
        if (!el) return;

        try {
            el.style.backgroundColor = mediaBgColor;
            el.style.transform = isLocal
                ? mirrorVideo
                    ? "translateZ(0) scaleX(-1)"
                    : "translateZ(0) scaleX(1)"
                : "translateZ(0)";

            if (el instanceof HTMLVideoElement) {
                el.muted = !!isLocal;
            }
        } catch { }
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
            data-mobile-pip-tile="true"
            data-mobile-pip-label={label || "Participant"}
            data-mobile-pip-avatar-url={normalizedAvatarUrl || undefined}
            onContextMenu={(event) => {
                if (!onOpenContextMenu) return;
                event.preventDefault();
                event.stopPropagation();
                onOpenContextMenu(tileId, event.currentTarget, {
                    x: event.clientX,
                    y: event.clientY,
                });
            }}
            className={
                "group relative h-full w-full min-h-0 min-w-0 overflow-hidden border transition-[border-color,box-shadow] duration-300 ease-out " +
                (isCompact ? "rounded-xl " : "rounded-2xl ") +
                speakingFrameClass +
                " " +
                tileBgClass
            }
        >
            <div className="absolute inset-0">
                <div
                    className={`absolute inset-0 flex flex-col items-center justify-center motion-reduce:!transition-none ${offStateClass}`}
                    aria-hidden={cameraLayerVisible}
                    style={{
                        opacity: cameraLayerVisible ? 0 : 1,
                        transform: cameraLayerVisible ? "scale(0.985)" : "scale(1)",
                        transition: `opacity ${cameraFadeDurationMs}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${cameraFadeDurationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`,
                    }}
                >
                    {shouldShowAvatar ? (
                        <img
                            src={normalizedAvatarUrl}
                            alt={label || "User"}
                            data-mobile-pip-avatar="true"
                            className={`${isCompact ? "h-[clamp(2.3rem,16vmin,3.4rem)] w-[clamp(2.3rem,16vmin,3.4rem)]" : "h-[clamp(4.4rem,12vw,5.8rem)] w-[clamp(4.4rem,12vw,5.8rem)]"} rounded-full object-cover border shadow-2xl ${isLight ? "border-[#D8D0D0]" : "border-[#2B2B2B]"
                                }`}
                            referrerPolicy="no-referrer"
                            onError={() => setAvatarBroken(true)}
                            draggable={false}
                        />
                    ) : (
                        <div
                            data-mobile-pip-initials="true"
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

                {renderedVideoTrack ? (
                    <div
                        ref={mediaHostRef}
                        className="absolute inset-0 w-full h-full motion-reduce:!transition-none"
                        aria-hidden={!cameraLayerVisible}
                        style={{
                            backgroundColor: mediaBgColor,
                            opacity: cameraLayerVisible ? 1 : 0,
                            transform: cameraLayerVisible ? "scale(1)" : "scale(1.012)",
                            filter: cameraLayerVisible ? "blur(0px)" : "blur(1.5px)",
                            transition: `opacity ${cameraFadeDurationMs}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${cameraFadeDurationMs}ms cubic-bezier(0.22, 1, 0.36, 1), filter ${cameraFadeDurationMs}ms ease-out`,
                        }}
                    />
                ) : null}

                {debugSizing && videoTrack && sizeText ? (
                    <div
                        className={
                            "absolute left-2 top-2 px-2 py-1 rounded-lg text-[10px] border " +
                            (isLight
                                ? "bg-[#F5F5F5] text-black border-[#D8D0D0]"
                                : "bg-[#1B1B1B] text-white border-[#2B2B2B]")
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

                {onEditName ? (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onEditName();
                        }}
                        className={`absolute left-[0.55rem] top-[0.55rem] z-20 flex h-[2.1rem] w-[2.1rem] items-center justify-center rounded-full border shadow-sm backdrop-blur-md transition ${editNameBtnClass}`}
                        aria-label="Edit name"
                        title="Edit name"
                    >
                        <Pencil size={15} strokeWidth={2.2} />
                    </button>
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
                                        ? "bg-[#F5F5F5] text-black border-[#D8D0D0] disabled:opacity-50"
                                        : "bg-[#1B1B1B] text-white border-[#2B2B2B] disabled:opacity-50")
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
                                        ? "bg-[#F5F5F5] text-black border-[#D8D0D0] disabled:opacity-50"
                                        : "bg-[#1B1B1B] text-white border-[#2B2B2B] disabled:opacity-50")
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
                                className="px-2 py-1 rounded-lg text-[11px] bg-[#F65252]/90 hover:bg-[#E64545] text-white disabled:opacity-50"
                                title="Remove participant from room"
                            >
                                Kick
                            </button>
                        ) : null}
                    </div>
                ) : null}

                <button
                    type="button"
                    onClick={() => onOpenProfile?.(tileId)}
                    className="absolute inset-0 z-[1]"
                    aria-label={`Open ${label || "participant"} profile`}
                    title={label || "Participant"}
                />
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[11] h-[36%] bg-gradient-to-t from-black/80 via-black/35 to-transparent" />

            {safeTaskList.length ? (
                <div
                    className={[
                        "pointer-events-none absolute inset-0 z-[13] flex min-h-0 w-full flex-col justify-end overflow-hidden px-3",
                        isCompact ? "pb-[2rem]" : "pb-[2.5rem]",
                    ].join(" ")}
                    title={safeTaskList.join("\n")}
                >
                    <div
                        className={[
                            "-mx-2 min-h-0 w-[calc(100%_+_1rem)] overflow-hidden rounded-xl px-2 py-1.5 font-inter text-white transition-all duration-300 ease-out",
                            showAllTasks
                                ? "max-h-full bg-black/60 shadow-[0_10px_30px_rgba(0,0,0,0.34)] backdrop-blur-[2px]"
                                : "max-h-[2rem] group-hover:max-h-full group-hover:bg-black/60 group-hover:shadow-[0_10px_30px_rgba(0,0,0,0.34)] group-hover:backdrop-blur-[2px]",
                        ].join(" ")}
                    >
                        <div className={`flex min-w-0 items-start gap-2 ${isCompact ? "text-[11px] leading-4" : "text-[12px] leading-[1.15rem]"}`}>
                            <span className="mt-[0.42rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[#81DB86] shadow-[0_0_0_2px_rgba(129,219,134,0.16)]" />
                            <span className={`min-w-0 font-medium ${showAllTasks ? "whitespace-normal" : "truncate group-hover:whitespace-normal group-hover:overflow-visible"}`}>
                                {safeTaskList[0]}
                            </span>
                        </div>

                        {safeTaskList.length > 1 ? (
                            <div
                                className={[
                                    "mt-2 space-y-1.5 border-t border-white/20 pt-2 text-white/90 transition-all duration-300 ease-out",
                                    isCompact ? "text-[10px] leading-4" : "text-[11px] leading-4",
                                    showAllTasks
                                        ? "opacity-100"
                                        : "translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100",
                                ].join(" ")}
                            >
                                {safeTaskList.slice(1).map((task, index) => (
                                    <div key={`${task}-${index}`} className="flex gap-2">
                                        <span className="mt-[0.34rem] h-1.5 w-1.5 shrink-0 rounded-full bg-white/55" />
                                        <span className="min-w-0 break-words font-normal">{task}</span>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}

            <div
                className={`pointer-events-none absolute z-[14] flex min-w-0 items-end justify-between gap-[0.5rem] text-white ${isCompact ? "inset-x-[0.55rem] bottom-[0.45rem]" : "inset-x-[0.75rem] bottom-[0.65rem]"}`}
            >
                <div className="min-w-0 max-w-[calc(100%_-_2.5rem)]">
                    <div className="flex min-w-0 items-center gap-[0.4rem]">
                        <span
                            className={`min-w-0 truncate font-inter ${isCompact ? "text-[10px]" : "text-[12px]"} font-semibold leading-none text-white drop-shadow-md`}
                        >
                            {label || "User"}
                        </span>

                        {participantTime ? (
                            <span
                                className={`max-w-[55%] shrink-0 truncate font-inter ${isCompact ? "text-[9px]" : "text-[10px]"} font-normal leading-none text-white/70 drop-shadow-md`}
                                title={String(participantTimeZone || "")}
                            >
                                {participantTime}
                            </span>
                        ) : null}

                        {status ? (
                            <span
                                className={`pointer-events-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-[1px] text-[10px] leading-none ${getStatusClass(status, false)}`}
                                title={isLocal && status === "skip_deafened" ? "Skip me (room audio muted for you)" : getStatusLabel(status)}
                            >
                                <span>{getStatusLabel(status)}</span>
                                {isLocal && status === "skip_deafened" ? (
                                    <SkipMeMutedStatusIcon theme={theme} className="h-2.5 w-2.5" />
                                ) : null}
                            </span>
                        ) : null}
                    </div>
                </div>

                <MicBadgeWithBarVisualizer
                    theme={theme}
                    micMuted={micMuted}
                    audioTrack={audioTrack}
                    isSpeaking={heldSpeaking}
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
        prev.isSpeaking === next.isSpeaking &&
        prev.showMenuButton === next.showMenuButton &&
        prev.density === next.density &&
        prev.currentIntention === next.currentIntention &&
        prev.taskList === next.taskList &&
        prev.showAllTasks === next.showAllTasks &&
        prev.participantTimeZone === next.participantTimeZone &&
        prev.cameraFramingMode === next.cameraFramingMode &&
        prev.onToggleMenu === next.onToggleMenu &&
        prev.onOpenProfile === next.onOpenProfile &&
        prev.onOpenContextMenu === next.onOpenContextMenu &&
        prev.onEditName === next.onEditName &&
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
