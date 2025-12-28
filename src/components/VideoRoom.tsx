// src/components/VideoRoom.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { JitsiParticipant, JitsiTrack } from "../lib/jitsiEngine";

export type ReactionType =
    | "fire"
    | "laugh"
    | "clap"
    | "heart"
    | "thumbsUp"
    | "thumbsDown";

export type Reaction = {
    id: number;
    type: ReactionType;
};

type VideoRoomProps = {
    theme?: "dark" | "light";

    participants: JitsiParticipant[];

    onToggleAudio: () => void;
    onToggleVideo: () => void;
    onToggleScreenShare: () => void;
    onLeave?: () => void;

    activeScreenSharer?: string | null;

    incomingReactions?: { id: number; type: ReactionType }[];
    localReactions?: { id: number; type: ReactionType }[];

    onVisibleVideoIdsChange?: (ids: string[]) => void;
    onSendReaction?: (type: ReactionType) => void;

    showControls?: boolean;
    audioOutputId?: string;

    onRegisterVideoElement?: (
        participantId: string,
        el: HTMLVideoElement | null,
        kind: "video" | "screen"
    ) => void;
};

const reactionEmoji: Record<ReactionType, string> = {
    fire: "🔥",
    laugh: "😂",
    clap: "👏",
    heart: "❤️",
    thumbsUp: "👍",
    thumbsDown: "👎",
};

function Icon({
    name,
    className = "w-5 h-5",
    alt = "",
    theme = "dark",
}: {
    name: "mic-on" | "mic-off" | "camera-on" | "camera-off" | "screen-share" | "reaction" | "leave";
    className?: string;
    alt?: string;
    theme?: "dark" | "light";
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

// optional: put placeholder image into /public/alatar.png
const PLACEHOLDER_AVATAR_URL = "/alatar.png";

function safeTrackId(track?: any): string {
    if (!track) return "none";
    try {
        if (typeof track.getId === "function") return String(track.getId());
    } catch { }
    return String((track as any)?._id ?? "track");
}

function attachTrackToMedia(
    track: JitsiTrack | undefined,
    element: HTMLMediaElement | null
) {
    if (!track || !element) return;

    try {
        track.attach(element);
    } catch (e) {
        console.error("attach error", e);
    }

    try {
        const pr = (element as any).play?.();
        (pr as any)?.catch?.(() => { });
    } catch { }

    return () => {
        try {
            track.detach(element);
        } catch { }
        try {
            (element as any).srcObject = null;
        } catch { }
        try {
            element.load?.();
        } catch { }
    };
}

function useTrackStreamVersion(track: any) {
    const [v, setV] = useState(0);

    useEffect(() => {
        if (!track || typeof track.addEventListener !== "function") return;

        const jitsiEvents = (window as any).JitsiMeetJS?.events?.track;

        const candidates = [
            jitsiEvents?.TRACK_STREAM_CHANGED,
            jitsiEvents?.TRACK_VIDEO_TYPE_CHANGED,
            jitsiEvents?.TRACK_VIDEOTYPE_CHANGED,
            jitsiEvents?.TRACK_MUTE_CHANGED,
            jitsiEvents?.LOCAL_TRACK_STOPPED,
        ].filter(Boolean);

        const fallback = [
            "TRACK_STREAM_CHANGED",
            "TRACK_VIDEO_TYPE_CHANGED",
            "TRACK_VIDEOTYPE_CHANGED",
            "TRACK_MUTE_CHANGED",
            "LOCAL_TRACK_STOPPED",
        ];

        const eventNames: string[] = Array.from(
            new Set([...(candidates as string[]), ...fallback])
        );

        const bump = () => setV((x) => x + 1);

        for (const ev of eventNames) {
            try {
                track.addEventListener(ev, bump);
            } catch { }
        }

        return () => {
            for (const ev of eventNames) {
                try {
                    track.removeEventListener(ev, bump);
                } catch { }
            }
        };
    }, [track]);

    return v;
}

/** small helper: responsive bool without extra deps */
function useMediaQuery(query: string) {
    const [matches, setMatches] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return;
        const mql = window.matchMedia(query);
        const onChange = () => setMatches(!!mql.matches);
        onChange();

        try {
            mql.addEventListener("change", onChange);
            return () => mql.removeEventListener("change", onChange);
        } catch {
            mql.addListener(onChange);
            return () => mql.removeListener(onChange);
        }
    }, [query]);

    return matches;
}

// ----------------------- Audio sink (playback only) -----------------------
function AudioSinkItem({ p }: { p: JitsiParticipant }) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const streamV = useTrackStreamVersion(p.audioTrack);

    useEffect(() => {
        if (!audioRef.current) return;
        if (!p.audioTrack) return;
        if (p.isLocal) return;

        try {
            p.audioTrack.attach(audioRef.current);
        } catch { }

        return () => {
            try {
                p.audioTrack.detach(audioRef.current!);
            } catch { }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [p.audioTrack, p.isLocal, streamV]);

    return <audio ref={audioRef} autoPlay playsInline preload="auto" />;
}

function AudioSink({ participants }: { participants: JitsiParticipant[] }) {
    const remotes = useMemo(
        () => participants.filter((p) => !p.isLocal),
        [participants]
    );

    return (
        <div className="absolute w-0 h-0 overflow-hidden opacity-0 pointer-events-none">
            {remotes.map((p) => (
                <AudioSinkItem key={p.id} p={p} />
            ))}
        </div>
    );
}

// ----------------------- Tiles -----------------------
function ParticipantTile({
    theme,
    participant,
    forceAspect = false,
    fit = "contain",
    onRegisterVideoElement,
}: {
    theme: "dark" | "light";
    participant: JitsiParticipant;
    forceAspect?: boolean;
    fit?: "contain" | "cover";
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];
}) {
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const hasVideoTrack = !!participant.videoTrack;
    const streamV = useTrackStreamVersion(participant.videoTrack);

    const handleVideoRef = (el: HTMLVideoElement | null) => {
        videoRef.current = el;
        onRegisterVideoElement?.(participant.id, el, "video");
    };

    useEffect(() => {
        const el = videoRef.current;
        if (!el) return;

        const track = participant.videoTrack;
        if (!track) return;

        try {
            track.detach?.(el);
        } catch { }

        try {
            track.attach(el);
        } catch (e) {
            console.error("attach error", e);
        }

        try {
            const pr = el.play?.();
            (pr as any)?.catch?.(() => { });
        } catch { }

        return () => {
            try {
                track.detach?.(el);
            } catch { }
            try {
                (el as any).srcObject = null;
            } catch { }
            try {
                el.load?.();
            } catch { }
        };
    }, [participant.videoTrack, participant.isLocal, streamV]);

    const objectClass = fit === "cover" ? "object-cover" : "object-contain";

    const showPlaceholder = !hasVideoTrack || participant.videoMuted;
    const hideVideo = !hasVideoTrack || participant.videoMuted;

    const name = participant.isLocal ? "You" : participant.displayName || "Guest";

    const tileBaseBg = theme === "light" ? "bg-[#EEF1F7]" : "bg-[#0B1220]";
    const placeholderBg = theme === "light" ? "bg-white" : "bg-[#111827]";
    const labelBg =
        theme === "light"
            ? "bg-white/90 border border-black/10 text-black/80"
            : "bg-black/45 border border-white/10 text-white/80";

    const ringClass =
        theme === "light" ? "ring-1 ring-black/10" : "ring-1 ring-white/10";

    return (
        <div
            className={
                "relative overflow-hidden flex items-center justify-center " +
                ringClass +
                " " +
                tileBaseBg +
                " " +
                (forceAspect ? "w-full aspect-video rounded-2xl" : "w-full h-full rounded-2xl")
            }
        >
            <video
                ref={handleVideoRef}
                autoPlay
                playsInline
                muted={participant.isLocal}
                className={
                    `absolute inset-0 w-full h-full ${objectClass} transition-opacity duration-150 ` +
                    (hideVideo ? "opacity-0" : "opacity-100")
                }
            />

            {/* ✅ Placeholder overlay: centered + NO "Camera off" */}
            {showPlaceholder && (
                <div className={`absolute inset-0 flex flex-col items-center justify-center text-center ${placeholderBg}`}>
                    <div className="relative w-16 h-16 rounded-full overflow-hidden border border-black/10">
                        <img
                            src={PLACEHOLDER_AVATAR_URL}
                            alt=""
                            className="w-full h-full object-cover"
                            onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                            draggable={false}
                        />
                        <div
                            className={`absolute inset-0 flex items-center justify-center text-2xl font-semibold ${theme === "light" ? "text-black/80" : "text-white/90"
                                }`}
                        >
                            {name?.[0]?.toUpperCase() || "?"}
                        </div>
                    </div>

                    <div className="mt-3 flex items-center justify-center gap-2">
                        <span
                            className={`text-[14px] font-semibold leading-none ${theme === "light" ? "text-black/80" : "text-white/85"
                                }`}
                        >
                            {name}
                        </span>
                        <Icon
                            name={participant.audioMuted ? "mic-off" : "mic-on"}
                            className="w-4 h-4 opacity-80"
                            theme={theme}
                        />
                    </div>

                    {/* ❌ убрали полностью "Camera off" */}
                </div>
            )}

            {/* Bottom label */}
            <div
                className={`absolute left-3 bottom-3 rounded-lg px-2 py-1 text-[11px] flex items-center gap-2 ${labelBg}`}
            >
                <span className="truncate max-w-[160px]">{name}</span>

                <Icon
                    name={participant.audioMuted ? "mic-off" : "mic-on"}
                    className="w-3.5 h-3.5 opacity-80"
                    theme={theme}
                />
            </div>
        </div>
    );
}

// ----------------------- Layout helpers -----------------------
function computeGrid(count: number) {
    if (count <= 1) return { cols: 1, rows: 1 };
    const cols = Math.min(4, Math.ceil(Math.sqrt(count)));
    const rows = Math.ceil(count / cols);
    return { cols, rows };
}

function GridLayout({
    theme,
    pageParticipants,
    onRegisterVideoElement,
}: {
    theme: "dark" | "light";
    pageParticipants: JitsiParticipant[];
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];
}) {
    const { cols, rows } = useMemo(
        () => computeGrid(pageParticipants.length),
        [pageParticipants.length]
    );

    return (
        <div
            className="w-full h-full grid gap-3 p-3 min-h-0"
            style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            }}
        >
            {pageParticipants.map((p) => (
                <ParticipantTile
                    key={p.id}
                    theme={theme}
                    participant={p}
                    forceAspect={false}
                    fit="contain"
                    onRegisterVideoElement={onRegisterVideoElement}
                />
            ))}
        </div>
    );
}

function P2PLayout({
    theme,
    pageParticipants,
    onRegisterVideoElement,
}: {
    theme: "dark" | "light";
    pageParticipants: JitsiParticipant[];
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];
}) {
    const count = pageParticipants.length;

    return (
        <div
            className="w-full h-full grid gap-3 p-3 min-h-0"
            style={{
                gridTemplateColumns: count <= 1 ? "1fr" : "1fr 1fr",
                gridTemplateRows: "1fr",
            }}
        >
            {pageParticipants.map((p) => (
                <ParticipantTile
                    key={p.id}
                    theme={theme}
                    participant={p}
                    forceAspect={false}
                    fit="contain"
                    onRegisterVideoElement={onRegisterVideoElement}
                />
            ))}
        </div>
    );
}

function MobileStackLayout({
    theme,
    pageParticipants,
    paddingBottomPx = 96,
    onRegisterVideoElement,
}: {
    theme: "dark" | "light";
    pageParticipants: JitsiParticipant[];
    paddingBottomPx?: number;
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];
}) {
    return (
        <div
            className="w-full h-full overflow-y-auto p-3 flex flex-col gap-3"
            style={{ paddingBottom: paddingBottomPx }}
        >
            {pageParticipants.map((p) => (
                <ParticipantTile
                    key={p.id}
                    theme={theme}
                    participant={p}
                    forceAspect={true}
                    fit="cover"
                    onRegisterVideoElement={onRegisterVideoElement}
                />
            ))}
        </div>
    );
}

function ScreenShareLayoutDesktop({
    theme,
    screenSharer,
    others,
    onRegisterVideoElement,
}: {
    theme: "dark" | "light";
    screenSharer: JitsiParticipant;
    others: JitsiParticipant[];
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];
}) {
    const screenVideoRef = useRef<HTMLVideoElement | null>(null);
    const screenTrackId = useMemo(
        () => safeTrackId(screenSharer.screenTrack),
        [screenSharer.screenTrack]
    );
    const screenStreamV = useTrackStreamVersion(screenSharer.screenTrack);

    useEffect(() => {
        const el = screenVideoRef.current;
        onRegisterVideoElement?.(screenSharer.id, el ?? null, "screen");
        return () => onRegisterVideoElement?.(screenSharer.id, null, "screen");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [screenSharer.id, screenTrackId]);

    useEffect(() => {
        if (!screenVideoRef.current) return;
        if (!screenSharer.screenTrack) return;
        return attachTrackToMedia(screenSharer.screenTrack, screenVideoRef.current);
    }, [screenTrackId, screenStreamV]);

    const labelBg =
        theme === "light"
            ? "bg-white/90 border border-black/10 text-black/80"
            : "bg-black/45 border border-white/10 text-white/80";

    return (
        <div className="relative w-full h-full flex flex-row gap-3 p-3 min-h-0">
            <div
                className={`relative flex-1 overflow-hidden rounded-2xl ${theme === "light"
                    ? "bg-white ring-1 ring-black/10"
                    : "bg-[#0B1220] ring-1 ring-white/10"
                    } min-h-0`}
            >
                <video
                    ref={screenVideoRef}
                    autoPlay
                    playsInline
                    muted={screenSharer.isLocal}
                    className="w-full h-full object-contain bg-black"
                />
                <div
                    className={`absolute left-3 bottom-3 rounded-lg px-2 py-1 text-[11px] flex items-center gap-2 ${labelBg}`}
                >
                    <span className="truncate max-w-[220px]">
                        {screenSharer.isLocal
                            ? "You (screen)"
                            : `${screenSharer.displayName || "Guest"} (screen)`}
                    </span>
                    <Icon
                        name={screenSharer.audioMuted ? "mic-off" : "mic-on"}
                        className="w-3.5 h-3.5 opacity-80"
                        theme={theme}
                    />
                </div>
            </div>

            <div className="flex flex-col gap-3 w-56 min-h-0">
                {others.map((p) => (
                    <div key={p.id} className="h-[140px] w-full">
                        <ParticipantTile
                            theme={theme}
                            participant={p}
                            forceAspect={false}
                            fit="cover"
                            onRegisterVideoElement={onRegisterVideoElement}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}

function ScreenShareLayoutMobile({
    theme,
    screenSharer,
    others,
    paddingBottomPx = 96,
    onRegisterVideoElement,
}: {
    theme: "dark" | "light";
    screenSharer: JitsiParticipant;
    others: JitsiParticipant[];
    paddingBottomPx?: number;
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];
}) {
    const screenVideoRef = useRef<HTMLVideoElement | null>(null);
    const screenTrackId = useMemo(
        () => safeTrackId(screenSharer.screenTrack),
        [screenSharer.screenTrack]
    );
    const screenStreamV = useTrackStreamVersion(screenSharer.screenTrack);

    useEffect(() => {
        const el = screenVideoRef.current;
        onRegisterVideoElement?.(screenSharer.id, el ?? null, "screen");
        return () => onRegisterVideoElement?.(screenSharer.id, null, "screen");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [screenSharer.id, screenTrackId]);

    useEffect(() => {
        if (!screenVideoRef.current) return;
        if (!screenSharer.screenTrack) return;
        return attachTrackToMedia(screenSharer.screenTrack, screenVideoRef.current);
    }, [screenTrackId, screenStreamV]);

    const labelBg =
        theme === "light"
            ? "bg-white/90 border border-black/10 text-black/80"
            : "bg-black/45 border border-white/10 text-white/80";

    return (
        <div
            className="w-full h-full overflow-y-auto p-3 flex flex-col gap-3"
            style={{ paddingBottom: paddingBottomPx }}
        >
            <div
                className={`w-full aspect-video overflow-hidden rounded-2xl ${theme === "light"
                    ? "bg-white ring-1 ring-black/10"
                    : "bg-[#0B1220] ring-1 ring-white/10"
                    } relative`}
            >
                <video
                    ref={screenVideoRef}
                    autoPlay
                    playsInline
                    muted={screenSharer.isLocal}
                    className="absolute inset-0 w-full h-full object-contain bg-black"
                />
                <div
                    className={`absolute left-3 bottom-3 rounded-lg px-2 py-1 text-[11px] flex items-center gap-2 ${labelBg}`}
                >
                    <span className="truncate max-w-[220px]">
                        {screenSharer.isLocal
                            ? "You (screen)"
                            : `${screenSharer.displayName || "Guest"} (screen)`}
                    </span>
                    <Icon
                        name={screenSharer.audioMuted ? "mic-off" : "mic-on"}
                        className="w-3.5 h-3.5 opacity-80"
                        theme={theme}
                    />
                </div>
            </div>

            {others.map((p) => (
                <ParticipantTile
                    key={p.id}
                    theme={theme}
                    participant={p}
                    forceAspect={true}
                    fit="cover"
                    onRegisterVideoElement={onRegisterVideoElement}
                />
            ))}
        </div>
    );
}

// ----------------------- Main -----------------------
export function VideoRoom(props: VideoRoomProps) {
    const {
        theme = "dark",
        participants,
        onToggleAudio,
        onToggleVideo,
        onToggleScreenShare,
        onLeave,
        onSendReaction,
        incomingReactions,
        localReactions,
        onVisibleVideoIdsChange,
        showControls = true,
        audioOutputId,
        onRegisterVideoElement,
    } = props;

    const isMobile = useMediaQuery("(max-width: 767px)");
    const isLight = theme === "light";

    useEffect(() => {
        const deviceId = audioOutputId;
        if (!deviceId || deviceId === "default") return;

        const audios = Array.from(document.querySelectorAll("audio")) as any[];
        audios.forEach((a) => {
            if (typeof a.setSinkId === "function") {
                a.setSinkId(deviceId).catch(() => { });
            }
        });
    }, [audioOutputId]);

    const PAGE_SIZE = 20;
    const SCROLL_STEP = 5;

    const [reactions, setReactions] = useState<Reaction[]>([]);
    const [showReactionsMenu, setShowReactionsMenu] = useState(false);
    const [reactionCounter, setReactionCounter] = useState(0);
    const menuRef = useRef<HTMLDivElement | null>(null);

    const [scrollIndex, setScrollIndex] = useState(0);

    const screenSharer = useMemo(
        () => participants.find((p) => p.isScreenSharing && p.screenTrack),
        [participants]
    );

    const isP2P = useMemo(() => participants.length <= 2, [participants.length]);

    const localParticipant = useMemo(
        () => participants.find((p) => p.isLocal) || null,
        [participants]
    );

    const baseParticipants = useMemo(() => {
        return screenSharer
            ? participants.filter((p) => p.id !== screenSharer.id)
            : participants;
    }, [participants, screenSharer]);

    const maxStartIndex = useMemo(
        () => Math.max(0, baseParticipants.length - PAGE_SIZE),
        [baseParticipants.length]
    );
    const canScroll = useMemo(
        () => baseParticipants.length > PAGE_SIZE,
        [baseParticipants.length]
    );

    useEffect(() => {
        setScrollIndex((i) => Math.min(Math.max(0, i), maxStartIndex));
    }, [maxStartIndex]);

    const pageParticipants = useMemo(() => {
        const start = scrollIndex;
        const end = start + PAGE_SIZE;
        return baseParticipants.slice(start, end);
    }, [baseParticipants, scrollIndex]);

    const screenOthers = useMemo(() => {
        if (!screenSharer) return [];
        const start = scrollIndex;
        const end = start + PAGE_SIZE;
        return baseParticipants.slice(start, end);
    }, [baseParticipants, screenSharer, scrollIndex]);

    const visibleRemoteIds = useMemo(() => {
        const visibleList = screenSharer
            ? [screenSharer, ...screenOthers]
            : pageParticipants;
        return visibleList
            .map((p) => p.id)
            .filter((id) => id && id !== localParticipant?.id);
    }, [screenSharer, screenOthers, pageParticipants, localParticipant?.id]);

    useEffect(() => {
        const t = setTimeout(() => onVisibleVideoIdsChange?.(visibleRemoteIds), 150);
        return () => clearTimeout(t);
    }, [onVisibleVideoIdsChange, visibleRemoteIds]);

    const isAudioMuted = !!localParticipant?.audioMuted;
    const isVideoMuted = !!localParticipant?.videoMuted;
    const isScreenSharing = !!localParticipant?.isScreenSharing;

    const handleReactionClick = (type: ReactionType) => {
        const id = reactionCounter + 1;
        setReactionCounter(id);
        setReactions((prev) => [...prev, { id, type }]);
        onSendReaction?.(type);

        setTimeout(() => {
            setReactions((prev) => prev.filter((r) => r.id !== id));
        }, 1500);
    };

    useEffect(() => {
        if (!showReactionsMenu) return;

        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node | null;
            if (!menuRef.current || !target) return;
            if (!menuRef.current.contains(target)) setShowReactionsMenu(false);
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [showReactionsMenu]);

    const baseBtn =
        "w-10 h-10 rounded-2xl flex items-center justify-center transition";

    const goPrev = () => setScrollIndex((i) => Math.max(0, i - SCROLL_STEP));
    const goNext = () => setScrollIndex((i) => Math.min(maxStartIndex, i + SCROLL_STEP));

    const shownStart = canScroll ? scrollIndex + 1 : Math.min(1, baseParticipants.length);
    const shownEnd = Math.min(scrollIndex + PAGE_SIZE, baseParticipants.length);

    const overlayLocal = localReactions ?? reactions;

    const controlsBg = isLight
        ? "bg-white/90 border border-black/10"
        : "bg-[#020617]/90 border border-white/10";

    return (
        <div className="relative w-full h-full flex flex-col min-h-0">
            <AudioSink participants={participants} />

            <div className="flex-1 relative min-h-0">
                {!screenSharer && (
                    <>
                        {isMobile ? (
                            <MobileStackLayout
                                theme={theme}
                                pageParticipants={pageParticipants}
                                onRegisterVideoElement={onRegisterVideoElement}
                            />
                        ) : isP2P ? (
                            <P2PLayout
                                theme={theme}
                                pageParticipants={pageParticipants}
                                onRegisterVideoElement={onRegisterVideoElement}
                            />
                        ) : (
                            <GridLayout
                                theme={theme}
                                pageParticipants={pageParticipants}
                                onRegisterVideoElement={onRegisterVideoElement}
                            />
                        )}
                    </>
                )}

                {screenSharer && (
                    <>
                        {isMobile ? (
                            <ScreenShareLayoutMobile
                                theme={theme}
                                screenSharer={screenSharer}
                                others={screenOthers}
                                onRegisterVideoElement={onRegisterVideoElement}
                            />
                        ) : (
                            <ScreenShareLayoutDesktop
                                theme={theme}
                                screenSharer={screenSharer}
                                others={screenOthers}
                                onRegisterVideoElement={onRegisterVideoElement}
                            />
                        )}
                    </>
                )}

                {((overlayLocal?.length || 0) + (incomingReactions?.length || 0) > 0) && (
                    <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-20 gap-2">
                        {(overlayLocal || []).map((r: any) => (
                            <div key={`local-${r.id}`} className="text-4xl drop-shadow-lg animate-bounce">
                                {reactionEmoji[r.type]}
                            </div>
                        ))}
                        {(incomingReactions || []).map((r) => (
                            <div key={`in-${r.id}`} className="text-4xl drop-shadow-lg animate-bounce">
                                {reactionEmoji[r.type]}
                            </div>
                        ))}
                    </div>
                )}

                {canScroll && !isMobile && (
                    <div className="absolute top-3 right-3 flex items-center gap-2">
                        <button
                            onClick={goPrev}
                            disabled={scrollIndex === 0}
                            className={
                                "px-3 h-9 rounded-xl text-sm " +
                                (isLight
                                    ? "bg-white/85 border border-black/10 text-black/70"
                                    : "bg-black/45 border border-white/10 text-white/80") +
                                (scrollIndex === 0 ? " opacity-40 cursor-not-allowed" : " hover:opacity-90")
                            }
                            title="Scroll back"
                        >
                            ←
                        </button>

                        <div
                            className={
                                "px-3 h-9 rounded-xl text-xs flex items-center " +
                                (isLight
                                    ? "bg-white/85 border border-black/10 text-black/65"
                                    : "bg-black/45 border border-white/10 text-white/70")
                            }
                        >
                            Showing {shownStart}–{shownEnd} of {baseParticipants.length}
                        </div>

                        <button
                            onClick={goNext}
                            disabled={scrollIndex >= maxStartIndex}
                            className={
                                "px-3 h-9 rounded-xl text-sm " +
                                (isLight
                                    ? "bg-white/85 border border-black/10 text-black/70"
                                    : "bg-black/45 border border-white/10 text-white/80") +
                                (scrollIndex >= maxStartIndex
                                    ? " opacity-40 cursor-not-allowed"
                                    : " hover:opacity-90")
                            }
                            title="Scroll forward"
                        >
                            →
                        </button>
                    </div>
                )}
            </div>

            {showControls && (
                <div className="mt-3 flex items-center justify-center">
                    <div className={`inline-flex items-center gap-3 px-4 py-2 rounded-2xl shadow-lg ${controlsBg}`}>
                        <button
                            onClick={onToggleAudio}
                            className={
                                baseBtn +
                                " " +
                                (isAudioMuted
                                    ? "bg-red-600 hover:bg-red-700"
                                    : isLight
                                        ? "bg-black/5 hover:bg-black/10"
                                        : "bg-[#111827] hover:bg-[#1f2937]")
                            }
                            title="Toggle mic"
                        >
                            <Icon name={isAudioMuted ? "mic-off" : "mic-on"} className="w-5 h-5" theme={theme} />
                        </button>

                        <button
                            onClick={onToggleVideo}
                            className={
                                baseBtn +
                                " " +
                                (isVideoMuted
                                    ? "bg-red-600 hover:bg-red-700"
                                    : isLight
                                        ? "bg-black/5 hover:bg-black/10"
                                        : "bg-[#111827] hover:bg-[#1f2937]")
                            }
                            title="Toggle camera"
                        >
                            <Icon name={isVideoMuted ? "camera-off" : "camera-on"} className="w-5 h-5" theme={theme} />
                        </button>

                        <button
                            onClick={onToggleScreenShare}
                            className={
                                baseBtn +
                                " " +
                                (isScreenSharing
                                    ? "bg-blue-600 hover:bg-blue-700"
                                    : isLight
                                        ? "bg-black/5 hover:bg-black/10"
                                        : "bg-[#111827] hover:bg-[#1f2937]")
                            }
                            title="Share screen"
                        >
                            <Icon name="screen-share" className="w-5 h-5" theme={theme} />
                        </button>

                        <div className="relative" ref={menuRef}>
                            <button
                                onClick={() => setShowReactionsMenu((v) => !v)}
                                className={
                                    baseBtn +
                                    " " +
                                    (isLight ? "bg-black/5 hover:bg-black/10" : "bg-[#111827] hover:bg-[#1f2937]")
                                }
                                title="Reactions"
                            >
                                <Icon name="reaction" className="w-5 h-5" theme={theme} />
                            </button>

                            {showReactionsMenu && (
                                <div
                                    className={`absolute bottom-12 left-1/2 -translate-x-1/2 rounded-2xl px-3 py-2 flex gap-2 text-xl shadow-xl ${isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10"
                                        }`}
                                >
                                    <button onClick={() => handleReactionClick("fire")}>🔥</button>
                                    <button onClick={() => handleReactionClick("laugh")}>😂</button>
                                    <button onClick={() => handleReactionClick("clap")}>👏</button>
                                    <button onClick={() => handleReactionClick("heart")}>❤️</button>
                                    <button onClick={() => handleReactionClick("thumbsUp")}>👍</button>
                                    <button onClick={() => handleReactionClick("thumbsDown")}>👎</button>
                                </div>
                            )}
                        </div>

                        {onLeave && (
                            <button
                                onClick={onLeave}
                                className="ml-2 px-3 h-10 rounded-2xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 inline-flex items-center gap-2"
                                title="Leave"
                            >
                                <Icon name="leave" className="w-5 h-5" theme={theme} />
                                <span>Leave</span>
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
