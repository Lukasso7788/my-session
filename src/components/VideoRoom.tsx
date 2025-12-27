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

/**
 * ✅ Track stream version bump hook
 * Used to re-attach track when underlying stream changes without hard-remounting <video>.
 */
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
            jitsiEvents?.LOCAL_TRACK_STARTED,
            jitsiEvents?.TRACK_ADDED,
            jitsiEvents?.TRACK_REMOVED,
        ].filter(Boolean);

        const fallback = [
            "TRACK_STREAM_CHANGED",
            "TRACK_VIDEO_TYPE_CHANGED",
            "TRACK_VIDEOTYPE_CHANGED",
            "TRACK_MUTE_CHANGED",
            "LOCAL_TRACK_STOPPED",
            "LOCAL_TRACK_STARTED",
            "TRACK_ADDED",
            "TRACK_REMOVED",
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

// ----------------------- Icons (✅ FILLED / "Field" style) -----------------------
function MicIcon({ off }: { off?: boolean }) {
    return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
            {!off ? (
                <>
                    <path
                        d="M12 3a3.25 3.25 0 0 1 3.25 3.25v5.5A3.25 3.25 0 0 1 12 15a3.25 3.25 0 0 1-3.25-3.25v-5.5A3.25 3.25 0 0 1 12 3Z"
                        fill="currentColor"
                    />
                    <path
                        d="M6.25 11a.95.95 0 0 0-1.9 0 7.65 7.65 0 0 0 6.7 7.6V20H9.25a.95.95 0 0 0 0 1.9h5.5a.95.95 0 0 0 0-1.9H13v-1.4a7.65 7.65 0 0 0 6.7-7.6.95.95 0 0 0-1.9 0 5.8 5.8 0 0 1-11.6 0Z"
                        fill="currentColor"
                        opacity="0.92"
                    />
                </>
            ) : (
                <>
                    <path
                        d="M12 3a3.25 3.25 0 0 1 3.25 3.25v4.1c0 .42-.04.82-.13 1.2L8.87 5.3A3.25 3.25 0 0 1 12 3Z"
                        fill="currentColor"
                    />
                    <path
                        d="M7.4 6.2 6.06 4.86a.95.95 0 0 0-1.35 1.35l1.38 1.38v4.16A3.25 3.25 0 0 0 9.34 15c.4.05.8.06 1.2.04l1.92 1.92c-.15.01-.31.02-.46.02a5.8 5.8 0 0 1-5.8-5.8.95.95 0 0 0-1.9 0 7.65 7.65 0 0 0 6.7 7.6V20H9.25a.95.95 0 0 0 0 1.9h5.5a.95.95 0 0 0 0-1.9H13v-1.44c.46-.07.9-.18 1.32-.32l2.62 2.62a.95.95 0 1 0 1.35-1.35L7.4 6.2Z"
                        fill="currentColor"
                        opacity="0.92"
                    />
                </>
            )}
        </svg>
    );
}

function CameraIcon({ off }: { off?: boolean }) {
    return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
            {!off ? (
                <>
                    <path
                        d="M8 6.25h5.6c.35 0 .68.14.93.39l1.02 1.02H18.3c1.1 0 2 .9 2 2v6.2c0 1.1-.9 2-2 2H8c-1.1 0-2-.9-2-2V8.25c0-1.1.9-2 2-2Z"
                        fill="currentColor"
                    />
                    <path
                        d="M15.85 12.2 21 9.3v5.4l-5.15-2.9a.8.8 0 0 1 0-1.6Z"
                        fill="currentColor"
                        opacity="0.9"
                    />
                </>
            ) : (
                <>
                    <path
                        d="M6.12 4.86a.95.95 0 1 0-1.35 1.35l1.28 1.28A1.98 1.98 0 0 0 6 8.25v7.6c0 1.1.9 2 2 2h10.3c.3 0 .59-.07.85-.19l1.08 1.08a.95.95 0 1 0 1.35-1.35L6.12 4.86Zm1.89 1.89h5.19c.35 0 .68.14.93.39l1.02 1.02H18.3c1.1 0 2 .9 2 2v5.08l-5.23-5.23-.7.4a.8.8 0 0 0-.39.7.8.8 0 0 0 .39.7l2.18 2.18H8c-1.1 0-2-.9-2-2V8.01l2.01-1.26Z"
                        fill="currentColor"
                    />
                    <path
                        d="M21 9.3v5.4l-2.46-1.39-3.65-3.65L21 9.3Z"
                        fill="currentColor"
                        opacity="0.9"
                    />
                </>
            )}
        </svg>
    );
}

function ScreenIcon({ active }: { active?: boolean }) {
    return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
            <path
                d="M4.2 4.8h15.6c1.1 0 2 .9 2 2v8.6c0 1.1-.9 2-2 2H4.2c-1.1 0-2-.9-2-2V6.8c0-1.1.9-2 2-2Z"
                fill="currentColor"
                opacity={active ? 1 : 0.95}
            />
            <path
                d="M9 20.2h6a.95.95 0 0 0 0-1.9H9a.95.95 0 0 0 0 1.9Z"
                fill="currentColor"
                opacity="0.9"
            />
            <path
                d="M12.2 9.2a.9.9 0 0 1 1.27 0l2.2 2.2a.9.9 0 0 1-1.27 1.27l-.65-.65v2.35a.9.9 0 1 1-1.8 0v-2.35l-.65.65A.9.9 0 1 1 10.05 11l2.15-2.2Z"
                fill="currentColor"
            />
        </svg>
    );
}

function SmileIcon() {
    return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
            <path
                d="M12 2.75c-5.1 0-9.25 4.15-9.25 9.25S6.9 21.25 12 21.25 21.25 17.1 21.25 12 17.1 2.75 12 2.75Z"
                fill="currentColor"
                opacity="0.95"
            />
            <path
                d="M8.7 11.05a1.05 1.05 0 1 0 0-2.1 1.05 1.05 0 0 0 0 2.1Zm6.6 0a1.05 1.05 0 1 0 0-2.1 1.05 1.05 0 0 0 0 2.1Z"
                fill="#050F1A"
                opacity="0.95"
            />
            <path
                d="M8.75 13.45a.95.95 0 0 1 1.32.18c.45.58 1.07.92 1.93.92.86 0 1.48-.34 1.93-.92a.95.95 0 0 1 1.5 1.14c-.8 1.05-1.95 1.68-3.43 1.68s-2.63-.63-3.43-1.68a.95.95 0 0 1 .18-1.32Z"
                fill="#050F1A"
                opacity="0.95"
            />
        </svg>
    );
}

function LeaveIcon() {
    return (
        <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
            <path
                d="M5.2 5.2h7.2a1 1 0 1 1 0 2H7.2v9.6h5.2a1 1 0 1 1 0 2H5.2a1.2 1.2 0 0 1-1.2-1.2V6.4a1.2 1.2 0 0 1 1.2-1.2Z"
                fill="currentColor"
                opacity="0.95"
            />
            <path
                d="M13.65 8.35a1 1 0 0 1 1.4 0L19.2 12l-4.15 3.65a1 1 0 0 1-1.4-1.4L15.3 13H11a1 1 0 1 1 0-2h4.3l-1.65-1.25a1 1 0 0 1 0-1.4Z"
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
        const el = audioRef.current;
        if (!el) return;
        if (!p.audioTrack) return;
        if (p.isLocal) return;

        try {
            p.audioTrack.attach(el);
        } catch { }

        return () => {
            try {
                p.audioTrack.detach(el);
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

    // ✅ attach/detach ONLY based on track changes (NOT based on videoMuted)
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

        // ✅ make sure playback starts (helps after reattach)
        try {
            const pr = (el as any).play?.();
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

    // ✅ show placeholder on "camera off" but keep video mounted to avoid hard reset
    const showPlaceholder = !hasVideoTrack || !!participant.videoMuted;
    const hideVideo = !hasVideoTrack || !!participant.videoMuted;

    // ✅ FIX: placeholder typography/spacing so text never "falls out"
    const name = participant.isLocal ? "You" : participant.displayName || "Guest";
    const initial =
        (participant.displayName?.trim()?.[0] || (participant.isLocal ? "Y" : "G")).toUpperCase();

    return (
        <div
            className={
                // ✅ REMOVE TILE BORDER/FRAME
                "relative bg-black rounded-2xl overflow-hidden flex items-center justify-center " +
                (forceAspect ? "w-full aspect-video" : "w-full h-full")
            }
            data-tile-key={tileKey}
        >
            {/* ✅ Always keep <video> mounted */}
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

            {/* ✅ Placeholder overlay */}
            {showPlaceholder && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#0B1220]">
                    <div className="flex flex-col items-center text-center px-3">
                        <div className="relative w-16 h-16 rounded-full bg-[#0b1220] border border-white/10 overflow-hidden flex items-center justify-center">
                            <img
                                src={PLACEHOLDER_AVATAR_URL}
                                alt=""
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                    (e.currentTarget as HTMLImageElement).style.display = "none";
                                }}
                            />
                            <div className="absolute inset-0 flex items-center justify-center text-[20px] font-semibold text-white/90">
                                {initial}
                            </div>
                        </div>

                        <div className="mt-2 text-[13px] text-white/90 font-medium leading-tight max-w-[220px] truncate">
                            {name}
                        </div>

                        {participant.videoMuted && (
                            <div className="mt-1 text-[11px] text-white/55 leading-tight">
                                Camera off
                            </div>
                        )}
                    </div>
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
                // ✅ IMPORTANT: key must NOT include track ids to avoid remount/reset on mute/unmute
                // Using ONLY participant.id keeps DOM stable; attach effect handles track changes.
                const tileKey = `${p.id}`;
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
                const tileKey = `${p.id}`;
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
                const tileKey = `${p.id}`;
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
            {/* ✅ REMOVE border/frame */}
            <div className="relative flex-1 bg-black rounded-2xl overflow-hidden min-h-0">
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
                            tileKey={`${cameraParticipant.id}`}
                            forceAspect={true}
                            fit="cover"
                            onRegisterVideoElement={onRegisterVideoElement}
                        />
                    </div>
                )}
            </div>

            <div className="flex flex-col gap-2 w-56 min-h-0">
                {others.map((p) => {
                    const tileKey = `${p.id}`;
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
            {/* ✅ REMOVE border/frame */}
            <div className="w-full aspect-video bg-black rounded-2xl overflow-hidden relative">
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
                const tileKey = `${p.id}`;
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

    /**
     * ✅ Layout version bumps ONLY when a participant list changes structurally
     * or when screen share appears/disappears, NOT on track id churn.
     *
     * The "hard reset" you described is usually because keys include trackId,
     * so React remounts tiles. We remove trackId from keys and also stop
     * bumping layoutVersion on track signatures.
     */
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

    // ✅ bump layout only on participants ids count/order and screen share toggles
    const layoutSignature = useMemo(() => {
        const ids = participants.map((p) => p.id).join("|");
        const ss = screenSharer ? `ss:${screenSharer.id}` : "ss:none";
        return `${ids}::${ss}`;
    }, [participants, screenSharer]);

    useEffect(() => {
        setLayoutVersion((v) => v + 1);
    }, [layoutSignature]);

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

            {/* ✅ remove video-room frame/border here too */}
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
                            title="Toggle mic"
                        >
                            <MicIcon off={isAudioMuted} />
                        </button>

                        <button
                            onClick={onToggleVideo}
                            className={
                                baseBtn +
                                " " +
                                (isVideoMuted ? "bg-red-600 hover:bg-red-700" : "bg-[#111827] hover:bg-[#1f2937]")
                            }
                            title="Toggle camera"
                        >
                            <CameraIcon off={isVideoMuted} />
                        </button>

                        <button
                            onClick={onToggleScreenShare}
                            className={
                                baseBtn +
                                " " +
                                (isScreenSharing ? "bg-blue-600 hover:bg-blue-700" : "bg-[#111827] hover:bg-[#1f2937]")
                            }
                            title="Share screen"
                        >
                            <ScreenIcon active={isScreenSharing} />
                        </button>

                        <div className="relative" ref={menuRef}>
                            <button
                                onClick={() => setShowReactionsMenu((v) => !v)}
                                className={baseBtn + " bg-[#111827] hover:bg-[#1f2937]"}
                                title="Reactions"
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
                                title="Leave"
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
