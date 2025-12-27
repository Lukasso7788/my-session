// src/components/VideoRoom.tsx
import { useEffect, useMemo, useRef, useState } from "react";
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

    /**
     * ✅ Optional: allow engine to monitor/recover "black video"
     * Register actual <video> elements per participant.
     */
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

// optional: put your placeholder image into /public/alatar.png
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

    // ✅ make sure playback starts (helps after reattach)
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

        // safari old/new compat
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

// ----------------------- Icons -----------------------
function MicIcon() {
    return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
            <path
                d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"
                fill="currentColor"
            />
            <path
                d="M6 11a1 1 0 0 0-2 0 8 8 0 0 0 7 7.93V21H9a1 1 0 0 0 0 2h6a1 1 0 1 0 0-2h-2v-2.07A8 8 0 0 0 20 11a1 1 0 0 0-2 0 6 6 0 0 1-12 0z"
                fill="currentColor"
            />
        </svg>
    );
}

function CameraIcon() {
    return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
            <rect x="4" y="6" width="11" height="12" rx="2" fill="currentColor" />
            <path d="M17 9.5 21 7v10l-4-2.5z" fill="currentColor" />
        </svg>
    );
}

function ScreenIcon() {
    return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
            <rect x="3" y="4" width="18" height="12" rx="2" fill="currentColor" />
            <rect x="9" y="18" width="6" height="2" rx="1" fill="currentColor" />
        </svg>
    );
}

function SmileIcon() {
    return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
            <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
            />
            <circle cx="9" cy="10" r="0.8" fill="currentColor" />
            <circle cx="15" cy="10" r="0.8" fill="currentColor" />
            <path
                d="M9 15c.7.8 1.6 1.2 3 1.2s2.3-.4 3-1.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
            />
        </svg>
    );
}

function LeaveIcon() {
    return (
        <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
            <path
                d="M5 5h6a1 1 0 0 1 0 2H7v10h4a1 1 0 0 1 0 2H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"
                fill="currentColor"
            />
            <path
                d="M13.7 8.3a1 1 0 0 1 1.4 0L19 12l-3.9 3.7a1 1 0 0 1-1.4-1.4L15.6 13H11a1 1 0 0 1 0-2h4.6l-1.3-1.3a1 1 0 0 1 0-1.4z"
                fill="currentColor"
            />
        </svg>
    );
}

// ----------------------- Audio sink -----------------------
function AudioSinkItem({ p }: { p: JitsiParticipant }) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const streamV = useTrackStreamVersion(p.audioTrack);

    useEffect(() => {
        if (!audioRef.current) return;
        if (!p.audioTrack) return;
        if (p.isLocal) return;

        p.audioTrack.attach(audioRef.current);

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
            {remotes.map((p) => {
                const key = `${p.id}:${safeTrackId(p.audioTrack)}`;
                return <AudioSinkItem key={key} p={p} />;
            })}
        </div>
    );
}

// ----------------------- Tiles -----------------------
function ParticipantTile({
    participant,
    tileKey,
    forceAspect = false,
    fit = "contain",
    onRegisterVideoElement,
}: {
    participant: JitsiParticipant;
    tileKey: string;
    forceAspect?: boolean; // mobile stack uses aspect-video
    fit?: "contain" | "cover"; // "layout-ish" control
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];
}) {
    const videoRef = useRef<HTMLVideoElement | null>(null);

    // ✅ IMPORTANT:
    // We keep the track attached even when participant.videoMuted === true.
    // We only hide the <video> via CSS and show an overlay placeholder.
    const hasVideoTrack = !!participant.videoTrack;
    const streamV = useTrackStreamVersion(participant.videoTrack);

    // ✅ Provide real <video> element to engine (optional)
    const handleVideoRef = (el: HTMLVideoElement | null) => {
        videoRef.current = el;
        onRegisterVideoElement?.(participant.id, el, "video");
    };

    useEffect(() => {
        const el = videoRef.current;
        if (!el) return;

        const track = participant.videoTrack;
        if (!track) return;

        // attach (do NOT early-return on videoMuted)
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
        // ✅ note: NOT depending on participant.videoMuted
    }, [participant.videoTrack, participant.isLocal, streamV]);

    const objectClass = fit === "cover" ? "object-cover" : "object-contain";

    const showPlaceholder = !hasVideoTrack || participant.videoMuted;
    const hideVideo = !hasVideoTrack || participant.videoMuted;

    return (
        <div
            className={
                "relative bg-black rounded-2xl overflow-hidden flex items-center justify-center border border-white/5 " +
                (forceAspect ? "w-full aspect-video" : "w-full h-full")
            }
            data-tile-key={tileKey}
        >
            {/* ✅ Always keep <video> mounted + attached (if track exists). Just hide on mute. */}
            <video
                ref={handleVideoRef}
                autoPlay
                playsInline
                muted={participant.isLocal}
                className={
                    `absolute inset-0 w-full h-full ${objectClass} bg-black transition-opacity duration-150 ` +
                    (hideVideo ? "opacity-0" : "opacity-100")
                }
            />

            {/* ✅ Placeholder overlay (Alatar image if exists, else initials) */}
            {showPlaceholder && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#111827]">
                    <div className="w-16 h-16 rounded-full bg-[#0b1220] border border-white/10 overflow-hidden flex items-center justify-center">
                        {/* try show alatar.png if it exists */}
                        <img
                            src={PLACEHOLDER_AVATAR_URL}
                            alt=""
                            className="w-full h-full object-cover"
                            onError={(e) => {
                                // hide broken image
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                        />
                        {/* initials fallback (will show if image fails/hides) */}
                        <div className="absolute inset-0 flex items-center justify-center text-2xl font-semibold text-white/90">
                            {participant.displayName?.[0]?.toUpperCase() || "?"}
                        </div>
                    </div>

                    <span className="mt-2 text-sm text-white/80">
                        {participant.isLocal ? "You" : participant.displayName || "Guest"}
                    </span>

                    {participant.videoMuted && (
                        <span className="mt-1 text-[11px] text-white/50">Camera off</span>
                    )}
                </div>
            )}

            <div className="absolute left-3 bottom-3 rounded-md bg-black/55 px-2 py-1 text-[11px] flex items-center gap-2">
                <span className="text-white/80">
                    {participant.isLocal ? "You" : participant.displayName || "Guest"}
                </span>
                <span
                    className={
                        "w-2 h-2 rounded-full " +
                        (participant.audioMuted ? "bg-red-500" : "bg-green-400")
                    }
                />
            </div>
        </div>
    );
}

// ----------------------- Layouts -----------------------
function computeGrid(count: number) {
    if (count <= 1) return { cols: 1, rows: 1 };
    const cols = Math.min(4, Math.ceil(Math.sqrt(count)));
    const rows = Math.ceil(count / cols);
    return { cols, rows };
}

function GridLayout({
    pageParticipants,
    layoutVersion,
    onRegisterVideoElement,
}: {
    pageParticipants: JitsiParticipant[];
    layoutVersion: number;
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];
}) {
    const { cols, rows } = useMemo(
        () => computeGrid(pageParticipants.length),
        [pageParticipants.length]
    );

    return (
        <div
            key={`grid:${layoutVersion}:${pageParticipants.length}:${cols}x${rows}`}
            className="w-full h-full grid gap-2 p-2 min-h-0"
            style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            }}
        >
            {pageParticipants.map((p) => {
                const tileKey = `${p.id}:${safeTrackId(p.videoTrack)}:${safeTrackId(
                    p.screenTrack
                )}`;
                return (
                    <ParticipantTile
                        key={tileKey}
                        participant={p}
                        tileKey={tileKey}
                        forceAspect={false}
                        fit="contain"
                        onRegisterVideoElement={onRegisterVideoElement}
                    />
                );
            })}
        </div>
    );
}

function P2PLayout({
    pageParticipants,
    layoutVersion,
    onRegisterVideoElement,
}: {
    pageParticipants: JitsiParticipant[];
    layoutVersion: number;
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];
}) {
    const count = pageParticipants.length;

    return (
        <div
            key={`p2p:${layoutVersion}:${count}`}
            className="w-full h-full grid gap-2 p-2 min-h-0"
            style={{
                gridTemplateColumns: count <= 1 ? "1fr" : "1fr 1fr",
                gridTemplateRows: "1fr",
            }}
        >
            {pageParticipants.map((p) => {
                const tileKey = `${p.id}:${safeTrackId(p.videoTrack)}`;
                return (
                    <ParticipantTile
                        key={tileKey}
                        participant={p}
                        tileKey={tileKey}
                        forceAspect={false}
                        fit="contain"
                        onRegisterVideoElement={onRegisterVideoElement}
                    />
                );
            })}
        </div>
    );
}

function MobileStackLayout({
    pageParticipants,
    layoutVersion,
    paddingBottomPx = 96,
    onRegisterVideoElement,
}: {
    pageParticipants: JitsiParticipant[];
    layoutVersion: number;
    paddingBottomPx?: number;
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];
}) {
    return (
        <div
            key={`mstack:${layoutVersion}:${pageParticipants.length}`}
            className="w-full h-full overflow-y-auto p-2 flex flex-col gap-2"
            style={{ paddingBottom: paddingBottomPx }}
        >
            {pageParticipants.map((p) => {
                const tileKey = `${p.id}:${safeTrackId(p.videoTrack)}:${safeTrackId(
                    p.screenTrack
                )}`;
                return (
                    <ParticipantTile
                        key={tileKey}
                        participant={p}
                        tileKey={tileKey}
                        forceAspect={true}
                        fit="cover"
                        onRegisterVideoElement={onRegisterVideoElement}
                    />
                );
            })}
        </div>
    );
}

function ScreenShareLayoutDesktop({
    screenSharer,
    others,
    layoutVersion,
    onRegisterVideoElement,
}: {
    screenSharer: JitsiParticipant;
    others: JitsiParticipant[];
    layoutVersion: number;
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

    const cameraParticipant =
        screenSharer.videoTrack && !screenSharer.videoMuted ? screenSharer : undefined;

    return (
        <div
            key={`screen:desk:${layoutVersion}:${screenSharer.id}:${screenTrackId}`}
            className="relative w-full h-full flex flex-row gap-2 p-2 min-h-0"
        >
            <div className="relative flex-1 bg-black rounded-2xl overflow-hidden border border-white/5 min-h-0">
                <video
                    ref={screenVideoRef}
                    autoPlay
                    playsInline
                    muted={screenSharer.isLocal}
                    className="w-full h-full object-contain bg-black"
                />
                <div className="absolute left-3 bottom-3 rounded-md bg-black/60 px-2 py-1 text-[11px]">
                    <span className="text-white/80">
                        {screenSharer.isLocal
                            ? "You (screen)"
                            : `${screenSharer.displayName || "Guest"} (screen)`}
                    </span>
                </div>

                {cameraParticipant && (
                    <div className="absolute top-3 right-3 w-44 aspect-video rounded-xl overflow-hidden border border-white/20 shadow-lg bg-black">
                        <ParticipantTile
                            participant={cameraParticipant}
                            tileKey={`${cameraParticipant.id}:${safeTrackId(
                                cameraParticipant.videoTrack
                            )}`}
                            forceAspect={true}
                            fit="cover"
                            onRegisterVideoElement={onRegisterVideoElement}
                        />
                    </div>
                )}
            </div>

            <div className="flex flex-col gap-2 w-56 min-h-0">
                {others.map((p) => {
                    const tileKey = `${p.id}:${safeTrackId(p.videoTrack)}`;
                    return (
                        <div key={tileKey} className="h-[140px] w-full">
                            <ParticipantTile
                                participant={p}
                                tileKey={tileKey}
                                forceAspect={false}
                                fit="cover"
                                onRegisterVideoElement={onRegisterVideoElement}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function ScreenShareLayoutMobile({
    screenSharer,
    others,
    layoutVersion,
    paddingBottomPx = 96,
    onRegisterVideoElement,
}: {
    screenSharer: JitsiParticipant;
    others: JitsiParticipant[];
    layoutVersion: number;
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

    return (
        <div
            key={`screen:mob:${layoutVersion}:${screenSharer.id}:${screenTrackId}`}
            className="w-full h-full overflow-y-auto p-2 flex flex-col gap-2"
            style={{ paddingBottom: paddingBottomPx }}
        >
            <div className="w-full aspect-video bg-black rounded-2xl overflow-hidden border border-white/5 relative">
                <video
                    ref={screenVideoRef}
                    autoPlay
                    playsInline
                    muted={screenSharer.isLocal}
                    className="absolute inset-0 w-full h-full object-contain bg-black"
                />
                <div className="absolute left-3 bottom-3 rounded-md bg-black/60 px-2 py-1 text-[11px]">
                    <span className="text-white/80">
                        {screenSharer.isLocal
                            ? "You (screen)"
                            : `${screenSharer.displayName || "Guest"} (screen)`}
                    </span>
                </div>
            </div>

            {others.map((p) => {
                const tileKey = `${p.id}:${safeTrackId(p.videoTrack)}`;
                return (
                    <ParticipantTile
                        key={tileKey}
                        participant={p}
                        tileKey={tileKey}
                        forceAspect={true}
                        fit="cover"
                        onRegisterVideoElement={onRegisterVideoElement}
                    />
                );
            })}
        </div>
    );
}

// ----------------------- Main -----------------------
export function VideoRoom(props: VideoRoomProps) {
    const {
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
    const [layoutVersion, setLayoutVersion] = useState(0);

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
        return screenSharer ? participants.filter((p) => p.id !== screenSharer.id) : participants;
    }, [participants, screenSharer]);

    const maxStartIndex = useMemo(() => {
        return Math.max(0, baseParticipants.length - PAGE_SIZE);
    }, [baseParticipants.length]);

    const canScroll = useMemo(() => baseParticipants.length > PAGE_SIZE, [baseParticipants.length]);

    useEffect(() => {
        setScrollIndex((i) => Math.min(Math.max(0, i), maxStartIndex));
    }, [maxStartIndex]);

    const tracksSignature = useMemo(() => {
        return participants
            .flatMap((p) => [safeTrackId(p.videoTrack), safeTrackId(p.screenTrack)])
            .join("|");
    }, [participants]);

    useEffect(() => {
        setLayoutVersion((v) => v + 1);
    }, [tracksSignature]);

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
        const visibleList = screenSharer ? [screenSharer, ...screenOthers] : pageParticipants;
        return visibleList.map((p) => p.id).filter((id) => id && id !== localParticipant?.id);
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
        "w-10 h-10 rounded-full flex items-center justify-center text-white text-sm transition";

    const goPrev = () => setScrollIndex((i) => Math.max(0, i - SCROLL_STEP));
    const goNext = () => setScrollIndex((i) => Math.min(maxStartIndex, i + SCROLL_STEP));

    const shownStart = canScroll ? scrollIndex + 1 : Math.min(1, baseParticipants.length);
    const shownEnd = Math.min(scrollIndex + PAGE_SIZE, baseParticipants.length);

    const overlayLocal = localReactions ?? reactions;

    return (
        <div className="relative w-full h-full flex flex-col min-h-0">
            <AudioSink participants={participants} />

            <div className="flex-1 relative overflow-hidden rounded-2xl bg-black/80 min-h-0">
                {!screenSharer && (
                    <>
                        {isMobile ? (
                            <MobileStackLayout
                                pageParticipants={pageParticipants}
                                layoutVersion={layoutVersion}
                                onRegisterVideoElement={onRegisterVideoElement}
                            />
                        ) : isP2P ? (
                            <P2PLayout
                                pageParticipants={pageParticipants}
                                layoutVersion={layoutVersion}
                                onRegisterVideoElement={onRegisterVideoElement}
                            />
                        ) : (
                            <GridLayout
                                pageParticipants={pageParticipants}
                                layoutVersion={layoutVersion}
                                onRegisterVideoElement={onRegisterVideoElement}
                            />
                        )}
                    </>
                )}

                {screenSharer && (
                    <>
                        {isMobile ? (
                            <ScreenShareLayoutMobile
                                screenSharer={screenSharer}
                                others={screenOthers}
                                layoutVersion={layoutVersion}
                                onRegisterVideoElement={onRegisterVideoElement}
                            />
                        ) : (
                            <ScreenShareLayoutDesktop
                                screenSharer={screenSharer}
                                others={screenOthers}
                                layoutVersion={layoutVersion}
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
                                "px-3 h-9 rounded-full bg-black/55 border border-white/10 text-white text-sm " +
                                (scrollIndex === 0 ? "opacity-40 cursor-not-allowed" : "hover:bg-black/70")
                            }
                            title="Scroll back"
                        >
                            ←
                        </button>

                        <div className="px-3 h-9 rounded-full bg-black/55 border border-white/10 text-white text-xs flex items-center">
                            Showing {shownStart}–{shownEnd} of {baseParticipants.length}
                        </div>

                        <button
                            onClick={goNext}
                            disabled={scrollIndex >= maxStartIndex}
                            className={
                                "px-3 h-9 rounded-full bg-black/55 border border-white/10 text-white text-sm " +
                                (scrollIndex >= maxStartIndex ? "opacity-40 cursor-not-allowed" : "hover:bg-black/70")
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
                    <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-[#020617]/90 border border-white/10 shadow-lg">
                        <button
                            onClick={onToggleAudio}
                            className={
                                baseBtn +
                                " " +
                                (isAudioMuted ? "bg-red-600 hover:bg-red-700" : "bg-[#111827] hover:bg-[#1f2937]")
                            }
                        >
                            <MicIcon />
                        </button>

                        <button
                            onClick={onToggleVideo}
                            className={
                                baseBtn +
                                " " +
                                (isVideoMuted ? "bg-red-600 hover:bg-red-700" : "bg-[#111827] hover:bg-[#1f2937]")
                            }
                        >
                            <CameraIcon />
                        </button>

                        <button
                            onClick={onToggleScreenShare}
                            className={
                                baseBtn +
                                " " +
                                (isScreenSharing ? "bg-blue-600 hover:bg-blue-700" : "bg-[#111827] hover:bg-[#1f2937]")
                            }
                        >
                            <ScreenIcon />
                        </button>

                        <div className="relative" ref={menuRef}>
                            <button
                                onClick={() => setShowReactionsMenu((v) => !v)}
                                className={baseBtn + " bg-[#111827] hover:bg-[#1f2937]"}
                            >
                                <SmileIcon />
                            </button>

                            {showReactionsMenu && (
                                <div className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-[#020617] border border-white/10 rounded-2xl px-3 py-2 flex gap-2 text-xl">
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
                                className="ml-2 px-3 h-9 rounded-full bg-red-600 text-white text-xs font-medium hover:bg-red-700 inline-flex items-center gap-1"
                            >
                                <LeaveIcon />
                                <span>Leave</span>
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
