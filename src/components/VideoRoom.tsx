// src/components/VideoRoom.tsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
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

    /**
     * ✅ NEW: edit your own display name in-room
     * - if provided, call this to persist into Jitsi/conference + backend if needed
     * - if not provided, we still update locally for UI
     */
    onEditLocalDisplayName?: (newName: string) => void | Promise<void>;
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

function attachTrackToMedia(track: JitsiTrack | undefined, element: HTMLMediaElement | null) {
    if (!track || !element) return;

    // ✅ safety: detach before attach (avoid double attachments / stale streams)
    try {
        track.detach?.(element);
    } catch { }

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

/** Measure an element (width/height) via ResizeObserver (fallback to window resize). */
function useElementSize<T extends HTMLElement>() {
    const [node, setNode] = useState<T | null>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    const ref = useCallback((el: T | null) => {
        setNode(el);
    }, []);

    useEffect(() => {
        if (!node) return;

        const update = () => {
            const r = node.getBoundingClientRect();
            setSize({
                width: Math.round(r.width),
                height: Math.round(r.height),
            });
        };

        update();

        const RO: any = (window as any).ResizeObserver;
        if (RO) {
            const ro = new RO(() => update());
            ro.observe(node);
            return () => ro.disconnect();
        }

        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, [node]);

    return { ref, width: size.width, height: size.height };
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
    const remotes = useMemo(() => participants.filter((p) => !p.isLocal), [participants]);

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
    editable,
    displayNameOverride,
    onOpenEditName,
}: {
    theme: "dark" | "light";
    participant: JitsiParticipant;
    forceAspect?: boolean;
    fit?: "contain" | "cover";
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];

    // ✅ NEW: local edit UX
    editable?: boolean; // only local participant
    displayNameOverride?: string | null; // local override shown in UI
    onOpenEditName?: () => void;
}) {
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const hasVideoTrack = !!participant.videoTrack;
    const streamV = useTrackStreamVersion(participant.videoTrack);

    // hover/options state
    const [hovered, setHovered] = useState(false);
    const [optionsOpen, setOptionsOpen] = useState(false);
    const optionsRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!optionsOpen) return;

        const onDoc = (e: MouseEvent) => {
            const t = e.target as Node | null;
            if (!t) return;
            if (!optionsRef.current) return;
            if (!optionsRef.current.contains(t)) setOptionsOpen(false);
        };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [optionsOpen]);

    // ✅ IMPORTANT: register <video> element so engine can "black video recovery" reattach correctly
    const handleVideoRef = useCallback(
        (el: HTMLVideoElement | null) => {
            videoRef.current = el;
            onRegisterVideoElement?.(participant.id, el, "video");
        },
        [onRegisterVideoElement, participant.id]
    );

    useEffect(() => {
        return () => {
            onRegisterVideoElement?.(participant.id, null, "video");
        };
    }, [onRegisterVideoElement, participant.id]);

    // ✅ attach/detach via helper
    useEffect(() => {
        const el = videoRef.current;
        if (!el) return;
        if (!participant.videoTrack) return;

        return attachTrackToMedia(participant.videoTrack, el);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [participant.videoTrack, participant.isLocal, streamV]);

    // NOTE: "aspect-video" tailwind class may be missing in your build → we enforce aspectRatio via inline style.
    const aspectStyle: React.CSSProperties | undefined = forceAspect ? { aspectRatio: "16 / 9" } : undefined;

    // camera tiles look better with slight "headroom" bias (more top than bottom)
    const objectClass = fit === "cover" ? "object-cover object-[50%_35%]" : "object-contain object-center";

    const showPlaceholder = !hasVideoTrack || participant.videoMuted;
    const hideVideo = !hasVideoTrack || participant.videoMuted;

    const rawName = participant.isLocal ? "You" : participant.displayName || "Guest";
    const name = participant.isLocal && displayNameOverride ? displayNameOverride : rawName;

    const tileBaseBg = theme === "light" ? "bg-[#EEF1F7]" : "bg-[#0B1220]";
    const placeholderBg = theme === "light" ? "bg-white" : "bg-[#111827]";
    const labelBg =
        theme === "light"
            ? "bg-white/90 border border-black/10 text-black/80"
            : "bg-black/45 border border-white/10 text-white/80";

    const ringClass = theme === "light" ? "ring-1 ring-black/10" : "ring-1 ring-white/10";

    const optionsBtnBg =
        theme === "light"
            ? "bg-white/90 border border-black/10 text-black/70 hover:bg-white"
            : "bg-black/45 border border-white/10 text-white/80 hover:bg-black/55";

    const menuBg =
        theme === "light"
            ? "bg-white border border-black/10 text-black/80"
            : "bg-[#020617] border border-white/10 text-white/85";

    const menuItemHover =
        theme === "light" ? "hover:bg-black/5" : "hover:bg-white/10";

    return (
        <div
            style={aspectStyle}
            className={
                "relative overflow-hidden flex items-center justify-center rounded-2xl " +
                ringClass +
                " " +
                tileBaseBg +
                " " +
                (forceAspect ? "w-full" : "w-full h-full")
            }
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => {
                setHovered(false);
                setOptionsOpen(false);
            }}
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
                </div>
            )}

            {/* ✅ Hover Options (⋯) — only for editable(local) to start; can be enabled for all later */}
            {editable && hovered && (
                <div className="absolute top-3 right-3" ref={optionsRef}>
                    <button
                        type="button"
                        className={`h-9 w-9 rounded-xl flex items-center justify-center shadow-lg ${optionsBtnBg}`}
                        title="Options"
                        onClick={(e) => {
                            e.stopPropagation();
                            setOptionsOpen((v) => !v);
                        }}
                    >
                        <span className="text-lg leading-none">⋯</span>
                    </button>

                    {optionsOpen && (
                        <div
                            className={`absolute right-0 mt-2 min-w-[170px] rounded-xl shadow-xl overflow-hidden ${menuBg}`}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button
                                type="button"
                                className={`w-full text-left px-3 py-2 text-sm ${menuItemHover}`}
                                onClick={() => {
                                    setOptionsOpen(false);
                                    onOpenEditName?.();
                                }}
                            >
                                ✎ Edit name
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Bottom label */}
            <div className={`absolute left-3 bottom-3 rounded-lg px-2 py-1 text-[11px] flex items-center gap-2 ${labelBg}`}>
                <span className="truncate max-w-[160px]">{name}</span>

                <Icon
                    name={participant.audioMuted ? "mic-off" : "mic-on"}
                    className="w-3.5 h-3.5 opacity-80"
                    theme={theme}
                />

                {/* ✅ Inline edit button near name on hover */}
                {editable && hovered && (
                    <button
                        type="button"
                        className={`ml-1 h-6 w-6 rounded-md flex items-center justify-center ${theme === "light" ? "hover:bg-black/5" : "hover:bg-white/10"
                            }`}
                        title="Edit name"
                        onClick={(e) => {
                            e.stopPropagation();
                            onOpenEditName?.();
                        }}
                    >
                        <span className="text-[12px] leading-none">✎</span>
                    </button>
                )}
            </div>
        </div>
    );
}

// ----------------------- Layout helpers -----------------------
function computeCols(count: number, containerWidth: number) {
    // hard guarantees
    if (count <= 1) return 1;
    if (count === 2) return 2;
    if (count === 4) return 2; // ✅ always 2x2

    if (count === 3) return containerWidth >= 900 ? 3 : 2;
    if (count === 5) return containerWidth >= 900 ? 3 : 2;
    if (count === 6) return containerWidth >= 780 ? 3 : 2;

    return containerWidth >= 1400 ? 4 : 3;
}

function calcMaxGridWidthPx(params: {
    containerWidth: number;
    containerHeight: number;
    cols: number;
    rows: number;
    gapPx: number;
    paddingPx: number;
    aspectHOverW: number; // height / width, for 16:9 it's 9/16
}) {
    const { containerWidth, containerHeight, cols, rows, gapPx, paddingPx, aspectHOverW } = params;

    if (!containerWidth || !containerHeight) return null;

    const availW = Math.max(0, containerWidth - paddingPx * 2);
    const availH = Math.max(0, containerHeight - paddingPx * 2);

    const byWidth = (availW - (cols - 1) * gapPx) / cols;
    const byHeight = (availH - (rows - 1) * gapPx) / (rows * aspectHOverW);

    const tileW = Math.max(0, Math.min(byWidth, byHeight));
    const gridW = cols * tileW + (cols - 1) * gapPx;

    return Math.min(availW, gridW);
}

function GridLayout({
    theme,
    pageParticipants,
    containerWidth,
    containerHeight,
    onRegisterVideoElement,
    localId,
    localDisplayNameOverride,
    onOpenEditName,
}: {
    theme: "dark" | "light";
    pageParticipants: JitsiParticipant[];
    containerWidth: number;
    containerHeight: number;
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];

    // edit name wiring
    localId: string | null;
    localDisplayNameOverride: string | null;
    onOpenEditName: () => void;
}) {
    const paddingPx = containerWidth && containerWidth < 520 ? 8 : 12;
    const gapPx = containerWidth && containerWidth < 520 ? 8 : 12;

    const cols = useMemo(() => computeCols(pageParticipants.length, containerWidth || 1200), [
        pageParticipants.length,
        containerWidth,
    ]);
    const rows = useMemo(() => Math.ceil(pageParticipants.length / cols), [pageParticipants.length, cols]);

    const maxGridWidth = useMemo(() => {
        const w = calcMaxGridWidthPx({
            containerWidth: containerWidth || 0,
            containerHeight: containerHeight || 0,
            cols,
            rows,
            gapPx,
            paddingPx,
            aspectHOverW: 9 / 16,
        });
        return w;
    }, [containerWidth, containerHeight, cols, rows, gapPx, paddingPx]);

    const shouldCenterY = useMemo(() => {
        if (!containerWidth || !containerHeight) return false;

        const availW = Math.max(0, containerWidth - paddingPx * 2);
        const availH = Math.max(0, containerHeight - paddingPx * 2);

        if (availW <= 0 || availH <= 0) return false;

        const byWidth = (availW - (cols - 1) * gapPx) / cols;
        const byHeight = (availH - (rows - 1) * gapPx) / (rows * (9 / 16));

        const tileW = Math.max(0, Math.min(byWidth, byHeight));
        const tileH = tileW * (9 / 16);
        const gridH = rows * tileH + (rows - 1) * gapPx;

        return gridH > 0 && gridH <= availH - 4;
    }, [containerWidth, containerHeight, paddingPx, gapPx, cols, rows]);

    const count = pageParticipants.length;
    const remainder = cols > 0 ? count % cols : 0;
    const fullCount = remainder === 0 ? count : count - remainder;

    const oneColWidth = `calc((100% - ${(cols - 1) * gapPx}px) / ${cols})`;

    const fullRows = pageParticipants.slice(0, fullCount);
    const lastRow = pageParticipants.slice(fullCount);

    return (
        <div
            className={
                "w-full h-full min-h-0 overflow-y-auto flex justify-center " +
                (shouldCenterY ? "items-center" : "items-start")
            }
            style={{ padding: paddingPx }}
        >
            <div
                className="w-full grid"
                style={{
                    gap: gapPx,
                    maxWidth: maxGridWidth ? `${maxGridWidth}px` : undefined,
                    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                    alignContent: shouldCenterY ? "center" : "start",
                }}
            >
                {fullRows.map((p) => (
                    <ParticipantTile
                        key={p.id}
                        theme={theme}
                        participant={p}
                        forceAspect={true}
                        fit="cover"
                        onRegisterVideoElement={onRegisterVideoElement}
                        editable={!!localId && p.id === localId}
                        displayNameOverride={p.id === localId ? localDisplayNameOverride : null}
                        onOpenEditName={onOpenEditName}
                    />
                ))}

                {lastRow.length > 0 && (
                    <div
                        className="col-span-full w-full flex justify-center"
                        style={{
                            gap: gapPx,
                            alignItems: shouldCenterY ? "center" : "flex-start",
                        }}
                    >
                        {lastRow.map((p) => (
                            <div key={p.id} className="shrink-0" style={{ width: oneColWidth }}>
                                <ParticipantTile
                                    theme={theme}
                                    participant={p}
                                    forceAspect={true}
                                    fit="cover"
                                    onRegisterVideoElement={onRegisterVideoElement}
                                    editable={!!localId && p.id === localId}
                                    displayNameOverride={p.id === localId ? localDisplayNameOverride : null}
                                    onOpenEditName={onOpenEditName}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function P2PLayout({
    theme,
    pageParticipants,
    containerWidth,
    containerHeight,
    stack = false,
    onRegisterVideoElement,
    localId,
    localDisplayNameOverride,
    onOpenEditName,
}: {
    theme: "dark" | "light";
    pageParticipants: JitsiParticipant[];
    containerWidth: number;
    containerHeight: number;
    stack?: boolean;
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];

    localId: string | null;
    localDisplayNameOverride: string | null;
    onOpenEditName: () => void;
}) {
    const paddingPx = containerWidth && containerWidth < 520 ? 8 : 12;
    const gapPx = containerWidth && containerWidth < 520 ? 8 : 12;

    const count = pageParticipants.length;

    const cols = stack ? 1 : count <= 1 ? 1 : 2;
    const rows = count <= 1 ? 1 : stack ? 2 : 1;

    const maxGridWidth = useMemo(() => {
        const w = calcMaxGridWidthPx({
            containerWidth: containerWidth || 0,
            containerHeight: containerHeight || 0,
            cols,
            rows,
            gapPx,
            paddingPx,
            aspectHOverW: 9 / 16,
        });

        if (!w) return null;

        // ✅ FIX (from previous): remove hard cap so 2 tiles expand fully when chat is closed
        return w;
    }, [containerWidth, containerHeight, cols, rows, gapPx, paddingPx]);

    return (
        <div
            className="w-full h-full min-h-0 overflow-hidden flex justify-center items-center"
            style={{ padding: paddingPx }}
        >
            <div
                className="w-full grid"
                style={{
                    gap: gapPx,
                    maxWidth: maxGridWidth ? `${maxGridWidth}px` : undefined,
                    gridTemplateColumns: cols === 1 ? "1fr" : "1fr 1fr",
                    alignContent: "center",
                }}
            >
                {pageParticipants.map((p) => (
                    <ParticipantTile
                        key={p.id}
                        theme={theme}
                        participant={p}
                        forceAspect={true}
                        fit="cover"
                        onRegisterVideoElement={onRegisterVideoElement}
                        editable={!!localId && p.id === localId}
                        displayNameOverride={p.id === localId ? localDisplayNameOverride : null}
                        onOpenEditName={onOpenEditName}
                    />
                ))}
            </div>
        </div>
    );
}

/**
 * ✅ Phones with 1–2 participants:
 * Keep TRUE 16:9 (no squish/stretch) and center tiles in the frame.
 */
function MobileFillLayout({
    theme,
    pageParticipants,
    containerWidth,
    containerHeight,
    paddingBottomPx = 12,
    onRegisterVideoElement,
    localId,
    localDisplayNameOverride,
    onOpenEditName,
}: {
    theme: "dark" | "light";
    pageParticipants: JitsiParticipant[];
    containerWidth: number;
    containerHeight: number;
    paddingBottomPx?: number;
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];

    localId: string | null;
    localDisplayNameOverride: string | null;
    onOpenEditName: () => void;
}) {
    const count = pageParticipants.length || 1;

    const paddingPx = containerWidth && containerWidth < 520 ? 8 : 12;
    const gapPx = containerWidth && containerWidth < 520 ? 8 : 12;

    const availW = Math.max(0, (containerWidth || 0) - paddingPx * 2);
    const availH = Math.max(0, (containerHeight || 0) - paddingPx * 2 - paddingBottomPx - (count - 1) * gapPx);

    const tileH = availH > 0 ? availH / count : 0;
    const tileWByH = tileH > 0 ? tileH * (16 / 9) : 0;

    const maxTileW = Math.max(0, Math.min(availW || 0, tileWByH || availW || 0));

    return (
        <div
            className="w-full h-full min-h-0 flex flex-col justify-center"
            style={{
                padding: paddingPx,
                paddingBottom: paddingBottomPx,
                gap: gapPx,
            }}
        >
            {pageParticipants.map((p) => (
                <div key={p.id} className="w-full flex justify-center">
                    <div className="w-full" style={{ maxWidth: maxTileW ? `${maxTileW}px` : undefined }}>
                        <ParticipantTile
                            theme={theme}
                            participant={p}
                            forceAspect={true}
                            fit="cover"
                            onRegisterVideoElement={onRegisterVideoElement}
                            editable={!!localId && p.id === localId}
                            displayNameOverride={p.id === localId ? localDisplayNameOverride : null}
                            onOpenEditName={onOpenEditName}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}

/** For narrow phones with 3+ participants: scroll list, but with REAL aspect ratio. */
function MobileStackLayout({
    theme,
    pageParticipants,
    paddingBottomPx = 12,
    onRegisterVideoElement,
    localId,
    localDisplayNameOverride,
    onOpenEditName,
}: {
    theme: "dark" | "light";
    pageParticipants: JitsiParticipant[];
    paddingBottomPx?: number;
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];

    localId: string | null;
    localDisplayNameOverride: string | null;
    onOpenEditName: () => void;
}) {
    return (
        <div
            className="w-full h-full min-h-0 overflow-y-auto p-2 flex flex-col gap-2"
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
                    editable={!!localId && p.id === localId}
                    displayNameOverride={p.id === localId ? localDisplayNameOverride : null}
                    onOpenEditName={onOpenEditName}
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
    localId,
    localDisplayNameOverride,
    onOpenEditName,
}: {
    theme: "dark" | "light";
    screenSharer: JitsiParticipant;
    others: JitsiParticipant[];
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];

    localId: string | null;
    localDisplayNameOverride: string | null;
    onOpenEditName: () => void;
}) {
    const screenVideoRef = useRef<HTMLVideoElement | null>(null);
    const screenTrackId = useMemo(() => safeTrackId(screenSharer.screenTrack), [screenSharer.screenTrack]);
    const screenStreamV = useTrackStreamVersion(screenSharer.screenTrack);

    const handleScreenRef = useCallback(
        (el: HTMLVideoElement | null) => {
            screenVideoRef.current = el;
            onRegisterVideoElement?.(screenSharer.id, el, "screen");
        },
        [onRegisterVideoElement, screenSharer.id]
    );

    useEffect(() => {
        return () => onRegisterVideoElement?.(screenSharer.id, null, "screen");
    }, [onRegisterVideoElement, screenSharer.id]);

    useEffect(() => {
        const el = screenVideoRef.current;
        if (!el) return;
        if (!screenSharer.screenTrack) return;

        return attachTrackToMedia(screenSharer.screenTrack, el);
    }, [screenTrackId, screenStreamV, screenSharer.screenTrack]);

    const labelBg =
        theme === "light"
            ? "bg-white/90 border border-black/10 text-black/80"
            : "bg-black/45 border border-white/10 text-white/80";

    return (
        <div className="relative w-full h-full min-h-0 flex flex-row gap-3 p-3 overflow-hidden">
            <div
                className={`relative flex-1 overflow-hidden rounded-2xl ${theme === "light"
                    ? "bg-white ring-1 ring-black/10"
                    : "bg-[#0B1220] ring-1 ring-white/10"
                    } min-h-0`}
            >
                <video
                    ref={handleScreenRef}
                    autoPlay
                    playsInline
                    muted={screenSharer.isLocal}
                    className="w-full h-full object-contain bg-black"
                />
                <div className={`absolute left-3 bottom-3 rounded-lg px-2 py-1 text-[11px] flex items-center gap-2 ${labelBg}`}>
                    <span className="truncate max-w-[220px]">
                        {screenSharer.isLocal ? "You (screen)" : `${screenSharer.displayName || "Guest"} (screen)`}
                    </span>
                    <Icon
                        name={screenSharer.audioMuted ? "mic-off" : "mic-on"}
                        className="w-3.5 h-3.5 opacity-80"
                        theme={theme}
                    />
                </div>
            </div>

            <div className="flex flex-col gap-3 w-56 min-h-0 overflow-y-auto">
                {others.map((p) => (
                    <div key={p.id} className="w-full">
                        <ParticipantTile
                            theme={theme}
                            participant={p}
                            forceAspect={true}
                            fit="cover"
                            onRegisterVideoElement={onRegisterVideoElement}
                            editable={!!localId && p.id === localId}
                            displayNameOverride={p.id === localId ? localDisplayNameOverride : null}
                            onOpenEditName={onOpenEditName}
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
    paddingBottomPx = 12,
    onRegisterVideoElement,
    localId,
    localDisplayNameOverride,
    onOpenEditName,
}: {
    theme: "dark" | "light";
    screenSharer: JitsiParticipant;
    others: JitsiParticipant[];
    paddingBottomPx?: number;
    onRegisterVideoElement?: VideoRoomProps["onRegisterVideoElement"];

    localId: string | null;
    localDisplayNameOverride: string | null;
    onOpenEditName: () => void;
}) {
    const screenVideoRef = useRef<HTMLVideoElement | null>(null);
    const screenTrackId = useMemo(() => safeTrackId(screenSharer.screenTrack), [screenSharer.screenTrack]);
    const screenStreamV = useTrackStreamVersion(screenSharer.screenTrack);

    const handleScreenRef = useCallback(
        (el: HTMLVideoElement | null) => {
            screenVideoRef.current = el;
            onRegisterVideoElement?.(screenSharer.id, el, "screen");
        },
        [onRegisterVideoElement, screenSharer.id]
    );

    useEffect(() => {
        return () => onRegisterVideoElement?.(screenSharer.id, null, "screen");
    }, [onRegisterVideoElement, screenSharer.id]);

    useEffect(() => {
        const el = screenVideoRef.current;
        if (!el) return;
        if (!screenSharer.screenTrack) return;

        return attachTrackToMedia(screenSharer.screenTrack, el);
    }, [screenTrackId, screenStreamV, screenSharer.screenTrack]);

    const labelBg =
        theme === "light"
            ? "bg-white/90 border border-black/10 text-black/80"
            : "bg-black/45 border border-white/10 text-white/80";

    return (
        <div
            className="w-full h-full min-h-0 overflow-y-auto p-2 flex flex-col gap-2"
            style={{ paddingBottom: paddingBottomPx }}
        >
            <div
                className={`w-full overflow-hidden rounded-2xl ${theme === "light"
                    ? "bg-white ring-1 ring-black/10"
                    : "bg-[#0B1220] ring-1 ring-white/10"
                    } relative`}
                style={{ aspectRatio: "16 / 9" }}
            >
                <video
                    ref={handleScreenRef}
                    autoPlay
                    playsInline
                    muted={screenSharer.isLocal}
                    className="absolute inset-0 w-full h-full object-contain bg-black"
                />
                <div className={`absolute left-3 bottom-3 rounded-lg px-2 py-1 text-[11px] flex items-center gap-2 ${labelBg}`}>
                    <span className="truncate max-w-[220px]">
                        {screenSharer.isLocal ? "You (screen)" : `${screenSharer.displayName || "Guest"} (screen)`}
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
                    editable={!!localId && p.id === localId}
                    displayNameOverride={p.id === localId ? localDisplayNameOverride : null}
                    onOpenEditName={onOpenEditName}
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
        onEditLocalDisplayName,
    } = props;

    const isLight = theme === "light";

    // ✅ NEW: local display name override state (UI-level)
    const [localNameOverride, setLocalNameOverride] = useState<string | null>(null);

    // edit modal state
    const [editOpen, setEditOpen] = useState(false);
    const [editValue, setEditValue] = useState("");
    const [editSaving, setEditSaving] = useState(false);
    const editInputRef = useRef<HTMLInputElement | null>(null);

    // measure the real viewport available for tiles
    const { ref: roomRef, width: roomW, height: roomH } = useElementSize<HTMLDivElement>();

    // fallback for first render (SSR / zero-size initial)
    const fallbackW = typeof window !== "undefined" ? window.innerWidth : 1200;
    const fallbackH = typeof window !== "undefined" ? window.innerHeight : 800;

    const effectiveW = roomW || fallbackW;
    const effectiveH = roomH || fallbackH;

    const isVeryNarrow = effectiveW < 430;
    const isNarrowForColumns = effectiveW < 520;
    const isCompact = effectiveW < 900;

    const isMobileQuery = useMediaQuery("(max-width: 767px)");
    const isTabletQuery = useMediaQuery("(min-width: 768px) and (max-width: 1023px)");

    const paddingBottomPx = showControls ? 96 : 12;

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

    const screenSharer = useMemo(() => participants.find((p) => p.isScreenSharing && p.screenTrack), [participants]);
    const localParticipant = useMemo(() => participants.find((p) => p.isLocal) || null, [participants]);
    const localId = localParticipant?.id ?? null;

    // keep override synced with initial name (only if override not set yet)
    useEffect(() => {
        if (!localParticipant) return;
        if (localNameOverride !== null) return;
        const initial = localParticipant.displayName?.trim();
        if (initial) setLocalNameOverride(initial);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [localParticipant?.displayName]);

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

    const baseBtn = "w-10 h-10 rounded-2xl flex items-center justify-center transition";

    const goPrev = () => setScrollIndex((i) => Math.max(0, i - SCROLL_STEP));
    const goNext = () => setScrollIndex((i) => Math.min(maxStartIndex, i + SCROLL_STEP));

    const shownStart = canScroll ? scrollIndex + 1 : Math.min(1, baseParticipants.length);
    const shownEnd = Math.min(scrollIndex + PAGE_SIZE, baseParticipants.length);

    const overlayLocal = localReactions ?? reactions;

    const controlsBg = isLight ? "bg-white/90 border border-black/10" : "bg-[#020617]/90 border border-white/10";

    // ---------------- layout decision ----------------
    const count = pageParticipants.length;

    const useVeryNarrowMode = isVeryNarrow || (isMobileQuery && isNarrowForColumns);

    const stackTwoOnThisViewport =
        count === 2 && !useVeryNarrowMode && (isTabletQuery || (isMobileQuery && effectiveW < 640) || isCompact);

    const useColumnsMode = !useVeryNarrowMode;

    // ---------------- Edit name handlers ----------------
    const openEditName = useCallback(() => {
        const current =
            (localNameOverride ?? localParticipant?.displayName ?? "").trim() || "Yaroslav";
        setEditValue(current);
        setEditOpen(true);
        setTimeout(() => editInputRef.current?.focus(), 0);
    }, [localNameOverride, localParticipant?.displayName]);

    const closeEditName = useCallback(() => {
        setEditOpen(false);
        setEditSaving(false);
    }, []);

    const commitEditName = useCallback(async () => {
        if (editSaving) return;
        const next = editValue.trim();

        // minimal validation: 1..30 chars
        if (!next || next.length < 1) return;
        if (next.length > 30) return;

        setEditSaving(true);

        // optimistic UI
        setLocalNameOverride(next);

        try {
            await onEditLocalDisplayName?.(next);
        } catch (e) {
            console.error("onEditLocalDisplayName failed:", e);
            // keep UI value anyway; you can decide later if you want rollback
        } finally {
            setEditSaving(false);
            setEditOpen(false);
        }
    }, [editSaving, editValue, onEditLocalDisplayName]);

    useEffect(() => {
        if (!editOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") closeEditName();
            if (e.key === "Enter") commitEditName();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [editOpen, closeEditName, commitEditName]);

    return (
        <div className="relative w-full h-full flex flex-col min-h-0">
            <AudioSink participants={participants} />

            <div ref={roomRef} className="flex-1 relative min-h-0 overflow-hidden">
                {!screenSharer && (
                    <>
                        {useVeryNarrowMode ? (
                            count <= 2 ? (
                                <MobileFillLayout
                                    theme={theme}
                                    pageParticipants={pageParticipants}
                                    containerWidth={effectiveW}
                                    containerHeight={effectiveH}
                                    paddingBottomPx={paddingBottomPx}
                                    onRegisterVideoElement={onRegisterVideoElement}
                                    localId={localId}
                                    localDisplayNameOverride={localNameOverride}
                                    onOpenEditName={openEditName}
                                />
                            ) : (
                                <MobileStackLayout
                                    theme={theme}
                                    pageParticipants={pageParticipants}
                                    paddingBottomPx={paddingBottomPx}
                                    onRegisterVideoElement={onRegisterVideoElement}
                                    localId={localId}
                                    localDisplayNameOverride={localNameOverride}
                                    onOpenEditName={openEditName}
                                />
                            )
                        ) : (
                            <>
                                {count <= 2 ? (
                                    <P2PLayout
                                        theme={theme}
                                        pageParticipants={pageParticipants}
                                        containerWidth={effectiveW}
                                        containerHeight={effectiveH}
                                        stack={stackTwoOnThisViewport}
                                        onRegisterVideoElement={onRegisterVideoElement}
                                        localId={localId}
                                        localDisplayNameOverride={localNameOverride}
                                        onOpenEditName={openEditName}
                                    />
                                ) : (
                                    <GridLayout
                                        theme={theme}
                                        pageParticipants={pageParticipants}
                                        containerWidth={effectiveW}
                                        containerHeight={effectiveH}
                                        onRegisterVideoElement={onRegisterVideoElement}
                                        localId={localId}
                                        localDisplayNameOverride={localNameOverride}
                                        onOpenEditName={openEditName}
                                    />
                                )}
                            </>
                        )}
                    </>
                )}

                {screenSharer && (
                    <>
                        {isCompact || isMobileQuery ? (
                            <ScreenShareLayoutMobile
                                theme={theme}
                                screenSharer={screenSharer}
                                others={screenOthers}
                                paddingBottomPx={paddingBottomPx}
                                onRegisterVideoElement={onRegisterVideoElement}
                                localId={localId}
                                localDisplayNameOverride={localNameOverride}
                                onOpenEditName={openEditName}
                            />
                        ) : (
                            <ScreenShareLayoutDesktop
                                theme={theme}
                                screenSharer={screenSharer}
                                others={screenOthers}
                                onRegisterVideoElement={onRegisterVideoElement}
                                localId={localId}
                                localDisplayNameOverride={localNameOverride}
                                onOpenEditName={openEditName}
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

                {canScroll && useColumnsMode && !useVeryNarrowMode && (
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
                                (scrollIndex >= maxStartIndex ? " opacity-40 cursor-not-allowed" : " hover:opacity-90")
                            }
                            title="Scroll forward"
                        >
                            →
                        </button>
                    </div>
                )}

                {/* ✅ Edit Name Modal */}
                {editOpen && (
                    <div
                        className="absolute inset-0 z-50 flex items-center justify-center"
                        onMouseDown={(e) => {
                            // click backdrop closes (but not when clicking inside modal)
                            if (e.target === e.currentTarget) closeEditName();
                        }}
                        style={{
                            background: isLight ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.55)",
                        }}
                    >
                        <div
                            className={`w-[92%] max-w-[420px] rounded-2xl shadow-2xl p-4 ${isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10"
                                }`}
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between">
                                <div className={`text-sm font-semibold ${isLight ? "text-black/80" : "text-white/90"}`}>
                                    Edit your name
                                </div>
                                <button
                                    className={`h-8 w-8 rounded-xl flex items-center justify-center ${isLight ? "hover:bg-black/5" : "hover:bg-white/10"
                                        }`}
                                    onClick={closeEditName}
                                    title="Close"
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="mt-3">
                                <input
                                    ref={editInputRef}
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    maxLength={30}
                                    placeholder="Your name"
                                    className={`w-full h-11 rounded-xl px-3 text-sm outline-none ${isLight
                                        ? "bg-white border border-black/10 text-black"
                                        : "bg-[#0B1220] border border-white/10 text-white"
                                        }`}
                                />
                                <div className={`mt-2 text-[11px] ${isLight ? "text-black/50" : "text-white/50"}`}>
                                    1–30 characters. Press Enter to save, Esc to cancel.
                                </div>
                            </div>

                            <div className="mt-4 flex items-center justify-end gap-2">
                                <button
                                    className={`h-10 px-3 rounded-xl text-sm ${isLight
                                        ? "bg-black/5 hover:bg-black/10 text-black/80"
                                        : "bg-white/10 hover:bg-white/15 text-white/85"
                                        }`}
                                    onClick={closeEditName}
                                    disabled={editSaving}
                                >
                                    Cancel
                                </button>
                                <button
                                    className={`h-10 px-3 rounded-xl text-sm font-semibold ${isLight
                                        ? "bg-black text-white hover:opacity-90"
                                        : "bg-blue-600 text-white hover:bg-blue-700"
                                        } ${editSaving ? "opacity-60 cursor-not-allowed" : ""}`}
                                    onClick={commitEditName}
                                    disabled={editSaving}
                                >
                                    {editSaving ? "Saving..." : "Save"}
                                </button>
                            </div>
                        </div>
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
                            <Icon
                                name={isAudioMuted ? "mic-off" : "mic-on"}
                                className="w-5 h-5"
                                theme={isAudioMuted ? "dark" : theme}
                            />
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
                                className={baseBtn + " " + (isLight ? "bg-black/5 hover:bg-black/10" : "bg-[#111827] hover:bg-[#1f2937]")}
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
