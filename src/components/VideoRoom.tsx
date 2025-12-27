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
    className = "w-4 h-4",
    alt = "",
}: {
    name:
    | "mic-on"
    | "mic-off"
    | "camera-on"
    | "camera-off"
    | "screen-share"
    | "reaction"
    | "leave";
    className?: string;
    alt?: string;
}) {
    return (
        <img
            src={`/icons/${name}.svg`}
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

function attachTrackToMedia(track: JitsiTrack | undefined, element: HTMLMediaElement | null) {
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

        const eventNames: string[] = Array.from(new Set([...(candidates as string[]), ...fallback]));
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

// ----------------------- Audio sink + audio level -----------------------
type LevelMap = Record<string, number>;

function AudioSinkItem({
    p,
    audioCtxRef,
    onLevel,
}: {
    p: JitsiParticipant;
    audioCtxRef: React.MutableRefObject<AudioContext | null>;
    onLevel: (id: string, level01: number) => void;
}) {
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

    useEffect(() => {
        if (!audioRef.current) return;
        if (!p.audioTrack) return;
        if (p.isLocal) return;

        if (!audioCtxRef.current) {
            try {
                audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            } catch {
                audioCtxRef.current = null;
            }
        }

        const ctx = audioCtxRef.current;
        if (!ctx) return;

        let raf = 0;
        let analyser: AnalyserNode | null = null;
        let source: MediaStreamAudioSourceNode | null = null;

        const setup = async () => {
            // wait for srcObject to appear
            const el = audioRef.current!;
            for (let i = 0; i < 20; i++) {
                const so = (el as any).srcObject;
                if (so && so instanceof MediaStream) break;
                await new Promise((r) => setTimeout(r, 50));
            }

            const stream = (audioRef.current as any)?.srcObject as MediaStream | null;
            if (!stream) return;

            try {
                source = ctx.createMediaStreamSource(stream);
                analyser = ctx.createAnalyser();
                analyser.fftSize = 512;
                analyser.smoothingTimeConstant = 0.85;
                source.connect(analyser);
            } catch {
                analyser = null;
                source = null;
                return;
            }

            const data = new Uint8Array(analyser.frequencyBinCount);
            let smooth = 0;

            const tick = () => {
                if (!analyser) return;
                analyser.getByteFrequencyData(data);

                // normalized RMS-ish
                let sum = 0;
                for (let i = 0; i < data.length; i++) sum += data[i];
                const avg = sum / Math.max(1, data.length); // 0..255
                const level = Math.min(1, Math.max(0, avg / 140)); // tune

                smooth = smooth * 0.7 + level * 0.3;
                onLevel(p.id, smooth);

                raf = requestAnimationFrame(tick);
            };

            raf = requestAnimationFrame(tick);
        };

        setup();

        return () => {
            try {
                if (raf) cancelAnimationFrame(raf);
            } catch { }
            try {
                onLevel(p.id, 0);
            } catch { }
            try {
                source?.disconnect();
            } catch { }
            try {
                analyser?.disconnect();
            } catch { }
        };
    }, [p.id, p.audioTrack, p.isLocal, audioCtxRef, onLevel]);

    return <audio ref={audioRef} autoPlay playsInline preload="auto" />;
}

function AudioSink({
    participants,
    onLevel,
}: {
    participants: JitsiParticipant[];
    onLevel: (id: string, level01: number) => void;
}) {
    const remotes = useMemo(() => participants.filter((p) => !p.isLocal), [participants]);
    const audioCtxRef = useRef<AudioContext | null>(null);

    useEffect(() => {
        return () => {
            try {
                audioCtxRef.current?.close?.();
            } catch { }
            audioCtxRef.current = null;
        };
    }, []);

    return (
        <div className="absolute w-0 h-0 overflow-hidden opacity-0 pointer-events-none">
            {remotes.map((p) => (
                <AudioSinkItem key={p.id} p={p} audioCtxRef={audioCtxRef} onLevel={onLevel} />
            ))}
        </div>
    );
}

// ----------------------- Speaking bars -----------------------
function SpeakingBars({
    level,
    theme,
}: {
    level: number; // 0..1
    theme: "dark" | "light";
}) {
    const h1 = 6 + Math.round(level * 10);
    const h2 = 4 + Math.round(level * 14);
    const h3 = 5 + Math.round(level * 9);

    const barBg = theme === "light" ? "bg-black/55" : "bg-white/70";

    return (
        <div className="flex items-end gap-[3px] h-4">
            <div className={`${barBg} w-[3px] rounded-full`} style={{ height: h1 }} />
            <div className={`${barBg} w-[3px] rounded-full`} style={{ height: h2 }} />
            <div className={`${barBg} w-[3px] rounded-full`} style={{ height: h3 }} />
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
    audioLevel01 = 0,
}: {
    theme: "dark" | "light";
    participant: JitsiParticipant;
    forceAspect?: boolean;
    fit?: "contain" | "cover";
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];
    audioLevel01?: number;
}) {
    const videoRef = useRef<HTMLVideoElement | null>(null);

    // Keep track attached; hide video via CSS when muted
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
    const speaking = !participant.audioMuted && audioLevel01 > 0.08;

    const tileBaseBg =
        theme === "light" ? "bg-[#EEF1F7]" : "bg-[#0B1220]";
    const placeholderBg =
        theme === "light" ? "bg-white" : "bg-[#111827]";
    const labelBg =
        theme === "light" ? "bg-white/85 border border-black/10 text-black/80" : "bg-black/45 border border-white/10 text-white/80";

    const ringClass = speaking
        ? theme === "light"
            ? "ring-2 ring-blue-500/70"
            : "ring-2 ring-emerald-400/70"
        : theme === "light"
            ? "ring-1 ring-black/10"
            : "ring-1 ring-white/10";

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
            {/* video always mounted */}
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

            {/* Placeholder overlay */}
            {showPlaceholder && (
                <div className={`absolute inset-0 flex flex-col items-center justify-center ${placeholderBg}`}>
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
                        <div className={`absolute inset-0 flex items-center justify-center text-2xl font-semibold ${theme === "light" ? "text-black/80" : "text-white/90"
                            }`}>
                            {name?.[0]?.toUpperCase() || "?"}
                        </div>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                        <span className={`text-[14px] font-semibold leading-none ${theme === "light" ? "text-black/80" : "text-white/85"
                            }`}>
                            {name}
                        </span>
                        <Icon name={participant.audioMuted ? "mic-off" : "mic-on"} className="w-4 h-4 opacity-80" />
                    </div>

                    {participant.videoMuted && (
                        <span className={`mt-2 text-[12px] leading-none ${theme === "light" ? "text-black/45" : "text-white/55"
                            }`}>
                            Camera off
                        </span>
                    )}
                </div>
            )}

            {/* Bottom label */}
            <div className={`absolute left-3 bottom-3 rounded-lg px-2 py-1 text-[11px] flex items-center gap-2 ${labelBg}`}>
                <span className="truncate max-w-[160px]">{name}</span>
                <Icon name={participant.audioMuted ? "mic-off" : "mic-on"} className="w-3.5 h-3.5 opacity-80" />
                <span
                    className={
                        "w-2 h-2 rounded-full " +
                        (participant.audioMuted ? "bg-red-500" : speaking ? "bg-emerald-500" : "bg-green-400")
                    }
                />
                {/* speaking bars */}
                <div className="ml-1">
                    <SpeakingBars level={participant.audioMuted ? 0 : audioLevel01} theme={theme} />
                </div>
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
    levels,
}: {
    theme: "dark" | "light";
    pageParticipants: JitsiParticipant[];
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];
    levels: LevelMap;
}) {
    const { cols, rows } = useMemo(() => computeGrid(pageParticipants.length), [pageParticipants.length]);

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
                    audioLevel01={levels[p.id] ?? 0}
                />
            ))}
        </div>
    );
}

function P2PLayout({
    theme,
    pageParticipants,
    onRegisterVideoElement,
    levels,
}: {
    theme: "dark" | "light";
    pageParticipants: JitsiParticipant[];
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];
    levels: LevelMap;
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
                    audioLevel01={levels[p.id] ?? 0}
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
    levels,
}: {
    theme: "dark" | "light";
    pageParticipants: JitsiParticipant[];
    paddingBottomPx?: number;
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];
    levels: LevelMap;
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
                    audioLevel01={levels[p.id] ?? 0}
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
    levels,
}: {
    theme: "dark" | "light";
    screenSharer: JitsiParticipant;
    others: JitsiParticipant[];
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];
    levels: LevelMap;
}) {
    const screenVideoRef = useRef<HTMLVideoElement | null>(null);
    const screenTrackId = useMemo(() => safeTrackId(screenSharer.screenTrack), [screenSharer.screenTrack]);
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
        theme === "light" ? "bg-white/85 border border-black/10 text-black/80" : "bg-black/45 border border-white/10 text-white/80";

    return (
        <div className="relative w-full h-full flex flex-row gap-3 p-3 min-h-0">
            <div className={`relative flex-1 overflow-hidden rounded-2xl ${theme === "light" ? "bg-white ring-1 ring-black/10" : "bg-[#0B1220] ring-1 ring-white/10"
                } min-h-0`}>
                <video
                    ref={screenVideoRef}
                    autoPlay
                    playsInline
                    muted={screenSharer.isLocal}
                    className="w-full h-full object-contain bg-black"
                />
                <div className={`absolute left-3 bottom-3 rounded-lg px-2 py-1 text-[11px] flex items-center gap-2 ${labelBg}`}>
                    <span className="truncate max-w-[220px]">
                        {screenSharer.isLocal ? "You (screen)" : `${screenSharer.displayName || "Guest"} (screen)`}
                    </span>
                    <Icon name={screenSharer.audioMuted ? "mic-off" : "mic-on"} className="w-3.5 h-3.5 opacity-80" />
                    <SpeakingBars level={screenSharer.audioMuted ? 0 : (levels[screenSharer.id] ?? 0)} theme={theme} />
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
                            audioLevel01={levels[p.id] ?? 0}
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
    levels,
}: {
    theme: "dark" | "light";
    screenSharer: JitsiParticipant;
    others: JitsiParticipant[];
    paddingBottomPx?: number;
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];
    levels: LevelMap;
}) {
    const screenVideoRef = useRef<HTMLVideoElement | null>(null);
    const screenTrackId = useMemo(() => safeTrackId(screenSharer.screenTrack), [screenSharer.screenTrack]);
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
        theme === "light" ? "bg-white/85 border border-black/10 text-black/80" : "bg-black/45 border border-white/10 text-white/80";

    return (
        <div
            className="w-full h-full overflow-y-auto p-3 flex flex-col gap-3"
            style={{ paddingBottom: paddingBottomPx }}
        >
            <div className={`w-full aspect-video overflow-hidden rounded-2xl ${theme === "light" ? "bg-white ring-1 ring-black/10" : "bg-[#0B1220] ring-1 ring-white/10"
                } relative`}>
                <video
                    ref={screenVideoRef}
                    autoPlay
                    playsInline
                    muted={screenSharer.isLocal}
                    className="absolute inset-0 w-full h-full object-contain bg-black"
                />
                <div className={`absolute left-3 bottom-3 rounded-lg px-2 py-1 text-[11px] flex items-center gap-2 ${labelBg}`}>
                    <span className="truncate max-w-[220px]">
                        {screenSharer.isLocal ? "You (screen)" : `${screenSharer.displayName || "Guest"} (screen)`}
                    </span>
                    <Icon name={screenSharer.audioMuted ? "mic-off" : "mic-on"} className="w-3.5 h-3.5 opacity-80" />
                    <SpeakingBars level={screenSharer.audioMuted ? 0 : (levels[screenSharer.id] ?? 0)} theme={theme} />
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
                    audioLevel01={levels[p.id] ?? 0}
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

    // audio sink output device
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

    // participants paging
    const PAGE_SIZE = 20;
    const SCROLL_STEP = 5;

    const [reactions, setReactions] = useState<Reaction[]>([]);
    const [showReactionsMenu, setShowReactionsMenu] = useState(false);
    const [reactionCounter, setReactionCounter] = useState(0);
    const menuRef = useRef<HTMLDivElement | null>(null);

    const [scrollIndex, setScrollIndex] = useState(0);

    const [levels, setLevels] = useState<LevelMap>({});

    const onLevel = (id: string, level01: number) => {
        setLevels((prev) => {
            const next = { ...prev, [id]: level01 };
            return next;
        });
    };

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

    const maxStartIndex = useMemo(() => Math.max(0, baseParticipants.length - PAGE_SIZE), [baseParticipants.length]);
    const canScroll = useMemo(() => baseParticipants.length > PAGE_SIZE, [baseParticipants.length]);

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

    // visible remote ids -> engine
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
        "w-10 h-10 rounded-2xl flex items-center justify-center transition";

    const goPrev = () => setScrollIndex((i) => Math.max(0, i - SCROLL_STEP));
    const goNext = () => setScrollIndex((i) => Math.min(maxStartIndex, i + SCROLL_STEP));

    const shownStart = canScroll ? scrollIndex + 1 : Math.min(1, baseParticipants.length);
    const shownEnd = Math.min(scrollIndex + PAGE_SIZE, baseParticipants.length);

    const overlayLocal = localReactions ?? reactions;

    const controlsBg =
        isLight ? "bg-white/90 border border-black/10" : "bg-[#020617]/90 border border-white/10";

    return (
        <div className="relative w-full h-full flex flex-col min-h-0">
            <AudioSink participants={participants} onLevel={onLevel} />

            {/* ✅ NO extra thick black frame here */}
            <div className="flex-1 relative min-h-0">
                {!screenSharer && (
                    <>
                        {isMobile ? (
                            <MobileStackLayout
                                theme={theme}
                                pageParticipants={pageParticipants}
                                onRegisterVideoElement={onRegisterVideoElement}
                                levels={levels}
                            />
                        ) : isP2P ? (
                            <P2PLayout
                                theme={theme}
                                pageParticipants={pageParticipants}
                                onRegisterVideoElement={onRegisterVideoElement}
                                levels={levels}
                            />
                        ) : (
                            <GridLayout
                                theme={theme}
                                pageParticipants={pageParticipants}
                                onRegisterVideoElement={onRegisterVideoElement}
                                levels={levels}
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
                                levels={levels}
                            />
                        ) : (
                            <ScreenShareLayoutDesktop
                                theme={theme}
                                screenSharer={screenSharer}
                                others={screenOthers}
                                onRegisterVideoElement={onRegisterVideoElement}
                                levels={levels}
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
                                (isLight ? "bg-white/85 border border-black/10 text-black/70" : "bg-black/45 border border-white/10 text-white/80") +
                                (scrollIndex === 0 ? " opacity-40 cursor-not-allowed" : " hover:opacity-90")
                            }
                            title="Scroll back"
                        >
                            ←
                        </button>

                        <div
                            className={
                                "px-3 h-9 rounded-xl text-xs flex items-center " +
                                (isLight ? "bg-white/85 border border-black/10 text-black/65" : "bg-black/45 border border-white/10 text-white/70")
                            }
                        >
                            Showing {shownStart}–{shownEnd} of {baseParticipants.length}
                        </div>

                        <button
                            onClick={goNext}
                            disabled={scrollIndex >= maxStartIndex}
                            className={
                                "px-3 h-9 rounded-xl text-sm " +
                                (isLight ? "bg-white/85 border border-black/10 text-black/70" : "bg-black/45 border border-white/10 text-white/80") +
                                (scrollIndex >= maxStartIndex ? " opacity-40 cursor-not-allowed" : " hover:opacity-90")
                            }
                            title="Scroll forward"
                        >
                            →
                        </button>
                    </div>
                )}
            </div>

            {/* Optional internal controls (kept, but usually you pass showControls=false from RoomPage) */}
            {showControls && (
                <div className="mt-3 flex items-center justify-center">
                    <div className={`inline-flex items-center gap-3 px-4 py-2 rounded-2xl shadow-lg ${controlsBg}`}>
                        <button
                            onClick={onToggleAudio}
                            className={
                                baseBtn +
                                " " +
                                (isAudioMuted ? "bg-red-600 hover:bg-red-700" : (isLight ? "bg-black/5 hover:bg-black/10" : "bg-[#111827] hover:bg-[#1f2937]"))
                            }
                            title="Toggle mic"
                        >
                            <Icon name={isAudioMuted ? "mic-off" : "mic-on"} className="w-5 h-5" />
                        </button>

                        <button
                            onClick={onToggleVideo}
                            className={
                                baseBtn +
                                " " +
                                (isVideoMuted ? "bg-red-600 hover:bg-red-700" : (isLight ? "bg-black/5 hover:bg-black/10" : "bg-[#111827] hover:bg-[#1f2937]"))
                            }
                            title="Toggle camera"
                        >
                            <Icon name={isVideoMuted ? "camera-off" : "camera-on"} className="w-5 h-5" />
                        </button>

                        <button
                            onClick={onToggleScreenShare}
                            className={
                                baseBtn +
                                " " +
                                (isScreenSharing ? "bg-blue-600 hover:bg-blue-700" : (isLight ? "bg-black/5 hover:bg-black/10" : "bg-[#111827] hover:bg-[#1f2937]"))
                            }
                            title="Share screen"
                        >
                            <Icon name="screen-share" className="w-5 h-5" />
                        </button>

                        <div className="relative" ref={menuRef}>
                            <button
                                onClick={() => setShowReactionsMenu((v) => !v)}
                                className={baseBtn + " " + (isLight ? "bg-black/5 hover:bg-black/10" : "bg-[#111827] hover:bg-[#1f2937]")}
                                title="Reactions"
                            >
                                <Icon name="reaction" className="w-5 h-5" />
                            </button>

                            {showReactionsMenu && (
                                <div className={`absolute bottom-12 left-1/2 -translate-x-1/2 rounded-2xl px-3 py-2 flex gap-2 text-xl shadow-xl ${isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10"
                                    }`}>
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
                                <Icon name="leave" className="w-5 h-5" />
                                <span>Leave</span>
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
