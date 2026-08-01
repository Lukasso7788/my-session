import React, {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { createPortal } from "react-dom";
import Picker from "@emoji-mart/react";
import emojiData from "@emoji-mart/data";
import { supabase } from "../lib/supabase";
import {
    Check,
    CheckCheck,
    CornerUpLeft,
    Pencil,
    SendHorizontal,
    Smile,
    Trash2,
    X,
} from "lucide-react";

type RoomTheme = "dark" | "light";

type ChatMode = "general" | "direct";

type Profile = {
    id: string;
    full_name?: string | null;
    avatar_url?: string | null;
};

type SessionHostRow = {
    host_id: string | null;
};

type MsgRow = {
    id: string;
    session_id: string;
    user_id: string;
    body: string;
    created_at: string;
    scope?: ChatMode | null;
    dm_peer_user_id?: string | null;
};

type Msg = MsgRow & { profile?: Profile | null };

type ReadReceiptReader = {
    userId: string;
    fullName: string;
    avatarUrl?: string | null;
    readAt?: number;
};

type ReadReceiptMap = Record<string, ReadReceiptReader[]>;

type ReactionRow = {
    id: string;
    session_id: string;
    message_id: string;
    user_id: string;
    emoji: string;
    created_at: string;
};

const MSG_TABLE = "session_chat_messages";
const REACTIONS_TABLE = "session_chat_message_reactions";
const CHAT_READ_RECEIPT_EVENT = "message-read";
const CHAT_READ_RECEIPT_CHANNEL_PREFIX = "chat-read-receipts";
const CHAT_READ_RECEIPT_STORAGE_PREFIX = "mysession_chat_read_receipts_v1";

const MESSAGE_BOOTSTRAP_LIMIT = 150;
const REACTIONS_BOOTSTRAP_LIMIT = 120;
const REACTIONS_MESSAGE_ID_LIMIT = 60;
const REACTIONS_REFETCH_DEDUPE_MS = 30_000;
const VISIBLE_MESSAGE_LIMIT = 150;
const REACTION_EMOJIS = [
    "🔥",
    "😂",
    "👏",
    "❤️",
    "👍",
    "👎",
    "👌",
    "👋",
    "🙌",
    "🎉",
] as const;

const BRAND_GREEN = "#81DB86";
const BRAND_GREEN_HOVER = "#72CF78";
const BRAND_GREEN_SOFT = "rgba(129,219,134,0.14)";
const BRAND_GREEN_BORDER = "rgba(129,219,134,0.48)";

function avatarFromProfile(profile?: Profile | null) {
    return (
        profile?.avatar_url ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.full_name || "User")}`
    );
}

function formatTime(iso?: string) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type ParsedReplyBody = {
    quote: string | null;
    quoteMessageId: string | null;
    main: string;
};

function parseReplyBody(body: string): ParsedReplyBody {
    if (!body) return { quote: null, quoteMessageId: null, main: "" };

    const trimmed = body.trimStart();
    if (!trimmed.startsWith("↪")) {
        return { quote: null, quoteMessageId: null, main: body };
    }

    const parts = trimmed.split(/\n\s*\n/);
    const header = parts[0] || "";
    const main =
        parts.length > 1
            ? parts.slice(1).join("\n\n")
            : trimmed.replace(header, "").trim();

    let rest = header.replace(/^↪\s*/, "").trim();
    let quoteMessageId: string | null = null;

    const idMatch = rest.match(/^\[msg:([^[\]\s]+)\]\s*/i);
    if (idMatch?.[1]) {
        quoteMessageId = String(idMatch[1]).trim();
        rest = rest.slice(idMatch[0].length).trim();
    }

    rest = rest
        .replace(/^Reply:\s*/i, "")
        .replace(/^Reply to:\s*/i, "")
        .trim();

    return {
        quote: rest || null,
        quoteMessageId,
        main,
    };
}

function collapseWs(s: string) {
    return String(s || "")
        .replace(/\s+/g, " ")
        .trim();
}

function quotePreviewForReply(body: string, maxLen = 220) {
    const { main } = parseReplyBody(body || "");
    const oneLine = collapseWs(main);
    if (!oneLine) return "";
    if (oneLine.length <= maxLen) return oneLine;
    return oneLine.slice(0, Math.max(0, maxLen - 1)) + "…";
}

function withTimeout<T>(
    p: Promise<T>,
    ms: number,
    label = "timeout",
): Promise<T> {
    let t: any;
    const timeout = new Promise<T>((_, reject) => {
        t = setTimeout(() => reject(new Error(label)), ms);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

function normalizeMessageIds(ids: string[]) {
    const seen = new Set<string>();
    const out: string[] = [];

    for (const id of ids) {
        if (!id) continue;
        if (id.startsWith("optimistic-")) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }

    return out.length > MESSAGE_BOOTSTRAP_LIMIT
        ? out.slice(out.length - MESSAGE_BOOTSTRAP_LIMIT)
        : out;
}

function normalizeReactionMessageIds(ids: string[]) {
    const normalized = normalizeMessageIds(ids);
    return normalized.length > REACTIONS_MESSAGE_ID_LIMIT
        ? normalized.slice(normalized.length - REACTIONS_MESSAGE_ID_LIMIT)
        : normalized;
}

type ChatCacheEntry = {
    ts: number;
    messages: Msg[];
    reactions: Record<string, Record<string, number>>;
    myReactions: Record<string, Record<string, boolean>>;
    profilesById: Record<string, Profile>;
    meProfile: Profile | null;
    hostUserId: string | null;
    directPeerIds: string[];
};

const CHAT_CACHE = new Map<string, ChatCacheEntry>();
const CACHE_MAX = 8;

function setChatCache(sessionId: string, entry: ChatCacheEntry) {
    CHAT_CACHE.set(sessionId, entry);

    if (CHAT_CACHE.size > CACHE_MAX) {
        let oldestKey: string | null = null;
        let oldestTs = Infinity;
        for (const [k, v] of CHAT_CACHE.entries()) {
            if (v.ts < oldestTs) {
                oldestTs = v.ts;
                oldestKey = k;
            }
        }
        if (oldestKey) CHAT_CACHE.delete(oldestKey);
    }
}

type ReactionDetailsState = {
    open: boolean;
    messageId: string;
    emoji: string;
    loading: boolean;
    userIds: string[];
    error?: string | null;
};

function normalizeHref(raw: string) {
    const s = String(raw || "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    if (/^www\./i.test(s)) return `https://${s}`;
    return s;
}

function renderTextWithLinks(text: string, isLight: boolean) {
    const input = String(text || "");
    if (!input) return null;

    const regex = /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,:;"')\]\}])/gi;
    const parts = input.split(regex);

    return parts.map((part, idx) => {
        if (!part) return null;

        if (regex.test(part)) {
            const href = normalizeHref(part);
            return (
                <a
                    key={`link-${idx}`}
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={
                        "underline break-all transition " +
                        (isLight
                            ? "text-[#2563eb] hover:text-[#1d4ed8]"
                            : "text-[#7dd3fc] hover:text-[#bae6fd]")
                    }
                    onClick={(e) => e.stopPropagation()}
                >
                    {part}
                </a>
            );
        }

        return <React.Fragment key={`txt-${idx}`}>{part}</React.Fragment>;
    });
}

function messageBelongsToView(
    row: MsgRow,
    mode: ChatMode,
    currentUserId: string | null,
    hostUserId: string | null,
    selectedDirectPeerId: string | null,
) {
    const scope = row.scope === "direct" ? "direct" : "general";

    if (mode === "general") {
        return scope === "general";
    }

    if (!currentUserId || !hostUserId) return false;
    if (scope !== "direct") return false;

    if (currentUserId === hostUserId) {
        if (!selectedDirectPeerId) return false;
        return (
            (row.user_id === hostUserId &&
                row.dm_peer_user_id === selectedDirectPeerId) ||
            (row.user_id === selectedDirectPeerId &&
                row.dm_peer_user_id === hostUserId)
        );
    }

    return (
        (row.user_id === currentUserId && row.dm_peer_user_id === hostUserId) ||
        (row.user_id === hostUserId && row.dm_peer_user_id === currentUserId)
    );
}

function buildMessageQuery(
    sessionId: string,
    mode: ChatMode,
    currentUserId: string | null,
    hostUserId: string | null,
    selectedDirectPeerId: string | null,
) {
    let q = supabase
        .from(MSG_TABLE)
        .select("id, session_id, user_id, body, created_at, scope, dm_peer_user_id")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(MESSAGE_BOOTSTRAP_LIMIT);

    if (mode === "general") {
        q = q.or("scope.is.null,scope.eq.general");
        return q;
    }

    if (!currentUserId || !hostUserId) {
        return q.eq("id", "__never__");
    }

    if (currentUserId === hostUserId) {
        if (!selectedDirectPeerId) {
            return q.eq("id", "__never__");
        }

        return q
            .eq("scope", "direct")
            .or(
                `and(user_id.eq.${hostUserId},dm_peer_user_id.eq.${selectedDirectPeerId}),and(user_id.eq.${selectedDirectPeerId},dm_peer_user_id.eq.${hostUserId})`,
            );
    }

    return q
        .eq("scope", "direct")
        .or(
            `and(user_id.eq.${currentUserId},dm_peer_user_id.eq.${hostUserId}),and(user_id.eq.${hostUserId},dm_peer_user_id.eq.${currentUserId})`,
        );
}

type MessageCardProps = {
    msg: Msg;
    mine: boolean;
    onReply: (m: Msg) => void;
    reactionsCounts: Record<string, number> | undefined;
    myReactions: Record<string, boolean> | undefined;
    onToggleReaction: (messageId: string, emoji: string) => void;
    onOpenReactionDetails: (messageId: string, emoji: string) => void;
    isLight: boolean;
    canEdit: boolean;
    onUpdateMessage: (messageId: string, newBody: string) => Promise<void>;
    onDeleteMessage: (messageId: string) => Promise<void>;
    onJumpToMessage: (messageId: string) => void;
    highlighted: boolean;
    readers: ReadReceiptReader[];
    renderDocument: Document;
    renderWindow: Window;
};

type DisplayedReaction = {
    count: number;
    exiting: boolean;
};

function MessageCardInner({
    msg,
    mine,
    onReply,
    reactionsCounts,
    myReactions,
    onToggleReaction,
    onOpenReactionDetails,
    isLight,
    canEdit,
    onUpdateMessage,
    onDeleteMessage,
    onJumpToMessage,
    highlighted,
    readers,
    renderDocument,
    renderWindow,
}: MessageCardProps) {
    const name = mine ? "You" : msg.profile?.full_name || "Participant";
    const time = formatTime(msg.created_at);

    const [openReactions, setOpenReactions] = useState(false);
    const reactionButtonRef = useRef<HTMLButtonElement | null>(null);
    const reactionMenuRef = useRef<HTMLDivElement | null>(null);
    const reactionExitTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
        new Map(),
    );
    const [displayedReactions, setDisplayedReactions] = useState<
        Record<string, DisplayedReaction>
    >(() =>
        Object.fromEntries(
            Object.entries(reactionsCounts || {}).map(([emoji, count]) => [
                emoji,
                { count, exiting: false },
            ]),
        ),
    );
    const [reactionMenuPos, setReactionMenuPos] = useState<{
        top: number;
        left: number;
    } | null>(null);

    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState(msg.body);
    const [savingEdit, setSavingEdit] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [readersOpen, setReadersOpen] = useState(false);
    const readReceiptButtonRef = useRef<HTMLButtonElement | null>(null);

    const updateReactionMenuPos = useCallback(() => {
        if (!reactionButtonRef.current) return;

        const rect = reactionButtonRef.current.getBoundingClientRect();
        const vw = renderWindow.innerWidth || 360;
        const vh = renderWindow.innerHeight || 640;
        const margin = 8;
        const menuWidth = Math.max(280, Math.min(352, vw - margin * 2));
        const menuHeight = Math.min(460, Math.max(320, vh - margin * 2));

        let left = rect.right - menuWidth;
        left = Math.max(margin, Math.min(left, vw - menuWidth - margin));

        let top = rect.bottom + 8;
        if (top + menuHeight > vh - margin) {
            top = Math.max(margin, rect.top - menuHeight - 8);
        }

        setReactionMenuPos({ top, left });
    }, [renderWindow]);

    useEffect(() => {
        if (!isEditing) setDraft(msg.body);
    }, [msg.body, isEditing]);

    useEffect(() => {
        const currentReactions = reactionsCounts || {};

        setDisplayedReactions((previous) => {
            const next = { ...previous };

            for (const [emoji, count] of Object.entries(currentReactions)) {
                next[emoji] = { count, exiting: false };
            }

            for (const emoji of Object.keys(previous)) {
                if (!(emoji in currentReactions)) {
                    next[emoji] = { ...previous[emoji], exiting: true };
                }
            }

            return next;
        });
    }, [reactionsCounts]);

    useEffect(() => {
        for (const [emoji, reaction] of Object.entries(displayedReactions)) {
            const existingTimer = reactionExitTimersRef.current.get(emoji);

            if (!reaction.exiting) {
                if (existingTimer) {
                    clearTimeout(existingTimer);
                    reactionExitTimersRef.current.delete(emoji);
                }
                continue;
            }

            if (!existingTimer) {
                const timer = setTimeout(() => {
                    reactionExitTimersRef.current.delete(emoji);
                    setDisplayedReactions((previous) => {
                        if (!previous[emoji]?.exiting) return previous;
                        const next = { ...previous };
                        delete next[emoji];
                        return next;
                    });
                }, 180);
                reactionExitTimersRef.current.set(emoji, timer);
            }
        }
    }, [displayedReactions]);

    useEffect(
        () => () => {
            for (const timer of reactionExitTimersRef.current.values()) {
                clearTimeout(timer);
            }
            reactionExitTimersRef.current.clear();
        },
        [],
    );

    useEffect(() => {
        if (!openReactions) return;

        updateReactionMenuPos();

        const onDown = (e: MouseEvent) => {
            const t = e.target as Node | null;
            if (!t) return;

            const clickedButton = reactionButtonRef.current?.contains(t);
            const clickedMenu = reactionMenuRef.current?.contains(t);

            if (!clickedButton && !clickedMenu) {
                setOpenReactions(false);
            }
        };

        const onRelayout = () => updateReactionMenuPos();

        renderDocument.addEventListener("mousedown", onDown);
        renderWindow.addEventListener("resize", onRelayout);
        renderWindow.addEventListener("scroll", onRelayout, true);

        return () => {
            renderDocument.removeEventListener("mousedown", onDown);
            renderWindow.removeEventListener("resize", onRelayout);
            renderWindow.removeEventListener("scroll", onRelayout, true);
        };
    }, [openReactions, renderDocument, renderWindow, updateReactionMenuPos]);

    const hasReactions = Object.keys(displayedReactions).length > 0;
    const orderedReactionEntries = useMemo(() => {
        const entries = Object.entries(displayedReactions);
        entries.sort((a, b) => {
            const aMine = !!myReactions?.[a[0]];
            const bMine = !!myReactions?.[b[0]];

            if (aMine !== bMine) return aMine ? -1 : 1;
            return b[1].count - a[1].count;
        });

        return entries;
    }, [displayedReactions, myReactions]);

    const metaNameCls = "text-black/55";
    const metaTimeCls = "text-black/35";
    const actionBtnCls = "text-black/45 hover:text-[#2FA84F]";
    const dangerBtnCls = "text-black/40 hover:text-red-700";
    const menuCls = "bg-[#F3F1F1] border border-[#D8D0D0]";

    const bubbleCls =
        "rounded-2xl px-3 py-2 text-[13px] leading-snug border whitespace-pre-wrap break-words transition " +
        (mine
            ? isLight
                ? "bg-[#81DB86]/15 border-[#81DB86]/50 text-black/85"
                : "bg-[#81DB86]/15 border-[#81DB86]/45 text-black/90"
            : isLight
                ? "bg-[#ECEAEA] border-[#D8D0D0] text-black/80"
                : "bg-[#F7F5F5] border-[#D8D0D0] text-black/85") +
        (highlighted
            ? isLight
                ? " ring-2 ring-[#6B7280]/55"
                : " ring-2 ring-[#81DB86]/70"
            : "");

    const quoteBoxCls = isLight
        ? "bg-[#F7F5F5] border border-[#D8D0D0] text-black/70 hover:bg-[#F1F1F1]/90"
        : "bg-black/25 border border-[#D8D0D0] text-black/70 hover:bg-[#F7F5F5]";

    const reactionPillBase = isLight
        ? "px-2 py-1 rounded-xl bg-[#ECEAEA] border border-[#D8D0D0] text-[12px] text-black/70 flex items-center gap-1.5 cursor-pointer will-change-transform transition-[opacity,transform,background-color,border-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:scale-105 hover:bg-[#E3E1E1] hover:border-[#BEB7B7] hover:shadow-sm active:translate-y-0 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81DB86]/75"
        : "px-2 py-1 rounded-xl bg-[#F7F5F5] border border-[#D8D0D0] text-[12px] text-black/80 flex items-center gap-1.5 cursor-pointer will-change-transform transition-[opacity,transform,background-color,border-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:scale-105 hover:bg-white hover:border-[#BEB7B7] hover:shadow-sm active:translate-y-0 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81DB86]/75";

    const reactionPillMine = isLight
        ? "bg-[#81DB86]/18 ring-2 ring-[#81DB86]/70 border-[#81DB86]/70 text-[#246B2A]"
        : "bg-[#81DB86]/18 ring-2 ring-[#81DB86]/70 border-[#81DB86]/55 text-black/85";

    const reactionCountCls = "text-black/50";

    const inputCls = isLight
        ? "w-full min-h-[42px] max-h-[180px] rounded-xl resize-none px-3 py-2 text-[13px] outline-none bg-[#F3F1F1] border border-[#D8D0D0] text-black/85 placeholder:text-black/35 focus:ring-1 focus:ring-[#81DB86] focus:border-[#81DB86]"
        : "w-full min-h-[42px] max-h-[180px] rounded-xl resize-none px-3 py-2 text-[13px] outline-none bg-[#F7F5F5] border border-[#D8D0D0] text-black/85 placeholder:text-black/35 focus:ring-1 focus:ring-[#81DB86] focus:border-[#81DB86]";

    const { quote, quoteMessageId, main } = useMemo(
        () => parseReplyBody(msg.body),
        [msg.body],
    );

    const saveEdit = async () => {
        const next = draft.trim();
        if (!next) return;

        setSavingEdit(true);
        try {
            await onUpdateMessage(msg.id, next);
            setIsEditing(false);
        } finally {
            setSavingEdit(false);
        }
    };

    const doDelete = async () => {
        if (deleting) return;
        const ok = renderWindow.confirm("Delete this message?");
        if (!ok) return;

        setDeleting(true);
        try {
            await onDeleteMessage(msg.id);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div
            className={
                "flex items-start gap-3 " + (mine ? "justify-end" : "justify-start")
            }
        >
            {!mine && (
                <img
                    src={avatarFromProfile(msg.profile)}
                    className="w-9 h-9 rounded-full object-cover"
                    alt=""
                />
            )}

            <div className="max-w-[82%] min-w-0">
                <div
                    className={
                        "flex items-center gap-2 mb-1 " +
                        (mine ? "justify-end" : "justify-start")
                    }
                >
                    <div className={"text-[11px] truncate " + metaNameCls}>{name}</div>
                    <div className={"text-[11px] " + metaTimeCls}>{time}</div>

                    {mine && readers.length > 0 ? (
                        <div className="relative">
                            <button
                                ref={readReceiptButtonRef}
                                type="button"
                                className="inline-flex items-center gap-1 text-[#81DB86] transition hover:opacity-80"
                                title={
                                    readers.length === 1
                                        ? `Read by ${readers[0]?.fullName || "Participant"}`
                                        : `Read by ${readers.length} people`
                                }
                                aria-label={
                                    readers.length === 1
                                        ? `Read by ${readers[0]?.fullName || "Participant"}`
                                        : `Read by ${readers.length} people`
                                }
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setReadersOpen((v) => !v);
                                }}
                            >
                                <CheckCheck size={14} strokeWidth={2.2} />
                                {readers.length > 1 ? (
                                    <span className="text-[10px] font-semibold leading-none">
                                        {readers.length}
                                    </span>
                                ) : null}
                            </button>

                            {readersOpen
                                ? createPortal(
                                    <div
                                        className="fixed inset-0 z-[220] flex items-center justify-center p-4"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setReadersOpen(false);
                                        }}
                                    >
                                        <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />

                                        <div
                                            className="relative z-[1] w-full max-w-[360px] rounded-[24px] border border-[#D8D0D0] bg-[#F3F1F1] p-4 shadow-[0_28px_90px_rgba(0,0,0,0.28)]"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <div className="mb-3 flex items-center justify-between gap-3">
                                                <div>
                                                    <div className="text-[16px] font-semibold text-black/90">
                                                        Read by
                                                    </div>
                                                    <div className="mt-0.5 text-[12px] text-black/45">
                                                        {readers.length === 1
                                                            ? "1 participant"
                                                            : `${readers.length} participants`}
                                                    </div>
                                                </div>

                                                <button
                                                    type="button"
                                                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E6E6E6] text-black/55 transition hover:bg-[#DCDCDC] hover:text-black/80"
                                                    onClick={() => setReadersOpen(false)}
                                                    aria-label="Close"
                                                    title="Close"
                                                >
                                                    <X size={16} strokeWidth={2.2} />
                                                </button>
                                            </div>

                                            <div className="max-h-[55vh] overflow-y-auto">
                                                {readers.map((reader) => (
                                                    <div
                                                        key={reader.userId}
                                                        className="flex items-center gap-3 rounded-2xl px-2 py-2.5 hover:bg-[#ECEAEA]"
                                                    >
                                                        <img
                                                            src={
                                                                reader.avatarUrl ||
                                                                `https://ui-avatars.com/api/?name=${encodeURIComponent(reader.fullName || "Participant")}`
                                                            }
                                                            className="h-10 w-10 rounded-full object-cover"
                                                            alt=""
                                                        />

                                                        <div className="min-w-0 flex-1">
                                                            <div className="truncate text-[13px] font-medium text-black/85">
                                                                {reader.fullName || "Participant"}
                                                            </div>

                                                            {reader.readAt ? (
                                                                <div className="mt-0.5 text-[11px] text-black/40">
                                                                    Read at{" "}
                                                                    {new Date(reader.readAt).toLocaleTimeString([], {
                                                                        hour: "2-digit",
                                                                        minute: "2-digit",
                                                                    })}
                                                                </div>
                                                            ) : null}
                                                        </div>

                                                        <CheckCheck
                                                            size={17}
                                                            strokeWidth={2.2}
                                                            className="shrink-0 text-[#81DB86]"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>,
                                    renderDocument.body,
                                )
                                : null}
                        </div>
                    ) : null}

                    {!isEditing && (
                        <div className="ml-1 flex h-5 shrink-0 items-center gap-3 leading-none">
                            <button
                                type="button"
                                onClick={() => onReply(msg)}
                                className={
                                    "grid h-5 grid-cols-[14px_auto] items-center gap-1 whitespace-nowrap text-[11px] leading-none transition " +
                                    actionBtnCls
                                }
                                title="Reply"
                            >
                                <CornerUpLeft
                                    size={14}
                                    className="block shrink-0 self-center"
                                />
                                <span className="flex h-4 items-center leading-4">Reply</span>
                            </button>

                            <div className="relative flex h-5 items-center leading-none">
                                <button
                                    ref={reactionButtonRef}
                                    type="button"
                                    onClick={() => {
                                        if (!openReactions) updateReactionMenuPos();
                                        setOpenReactions((v) => !v);
                                    }}
                                    className={
                                        "grid h-5 grid-cols-[14px_auto] items-center gap-1 whitespace-nowrap text-[11px] leading-none transition " +
                                        actionBtnCls
                                    }
                                    title="React"
                                >
                                    <Smile
                                        size={14}
                                        className="block shrink-0 self-center"
                                    />
                                    <span className="flex h-4 items-center leading-4">React</span>
                                </button>

                                {openReactions &&
                                    reactionMenuPos &&
                                    createPortal(
                                        <div
                                            ref={reactionMenuRef}
                                            className={
                                                "fixed z-[99999] rounded-2xl shadow-xl overflow-hidden " +
                                                menuCls
                                            }
                                            style={{
                                                top: reactionMenuPos.top,
                                                left: reactionMenuPos.left,
                                                width: Math.max(
                                                    280,
                                                    Math.min(352, renderWindow.innerWidth - 16),
                                                ),
                                                maxHeight: Math.min(460, renderWindow.innerHeight - 16),
                                            }}
                                            onMouseDown={(e) => e.stopPropagation()}
                                        >
                                            <div className="px-2.5 pt-2 pb-2 border-b border-[#D8D0D0]">
                                                <div className="mb-1.5 text-[11px] font-semibold text-black/55">
                                                    Quick reactions
                                                </div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {REACTION_EMOJIS.map((e) => {
                                                        const isMine = !!myReactions?.[e];
                                                        return (
                                                            <button
                                                                key={e}
                                                                onClick={() => {
                                                                    onToggleReaction(msg.id, e);
                                                                    setOpenReactions(false);
                                                                }}
                                                                className={
                                                                    "h-8 w-8 rounded-xl hover:scale-[1.05] transition leading-none flex items-center justify-center " +
                                                                    (isMine
                                                                        ? "bg-[#81DB86]/18 ring-1 ring-[#81DB86]/65"
                                                                        : "hover:bg-[#E8E8E8]")
                                                                }
                                                                title={isMine ? `Remove ${e}` : e}
                                                                type="button"
                                                            >
                                                                <span className="inline-block align-middle text-[16px] leading-none">
                                                                    {e}
                                                                </span>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                            <div className="max-h-[360px] overflow-hidden">
                                                <Picker
                                                    data={emojiData}
                                                    theme="light"
                                                    set="native"
                                                    previewPosition="none"
                                                    searchPosition="sticky"
                                                    navPosition="bottom"
                                                    skinTonePosition="preview"
                                                    onEmojiSelect={(emojiEvent: any) => {
                                                        const native =
                                                            emojiEvent?.native || emojiEvent?.emoji || "";
                                                        if (!native) return;
                                                        onToggleReaction(msg.id, String(native));
                                                        setOpenReactions(false);
                                                    }}
                                                />
                                            </div>
                                        </div>,
                                        renderDocument.body,
                                    )}
                            </div>

                            {canEdit && (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => setIsEditing(true)}
                                        className={
                                            "inline-flex h-5 w-5 items-center justify-center leading-none transition " +
                                            actionBtnCls
                                        }
                                        title="Edit"
                                    >
                                        <Pencil size={14} className="block shrink-0" />
                                    </button>

                                    <button
                                        type="button"
                                        onClick={doDelete}
                                        className={
                                            "inline-flex h-5 w-5 items-center justify-center leading-none transition " +
                                            dangerBtnCls
                                        }
                                        title="Delete"
                                    >
                                        <Trash2 size={14} className="block shrink-0" />
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {!isEditing ? (
                    <div className={bubbleCls}>
                        {quote && (
                            <button
                                type="button"
                                onClick={() => {
                                    if (quoteMessageId) onJumpToMessage(quoteMessageId);
                                }}
                                disabled={!quoteMessageId}
                                className={
                                    "mb-2 w-full rounded-xl px-3 py-2 text-left text-[12px] leading-snug transition " +
                                    quoteBoxCls +
                                    (quoteMessageId ? " cursor-pointer" : " cursor-default")
                                }
                                title={
                                    quoteMessageId ? "Jump to quoted message" : "Quoted message"
                                }
                            >
                                <div className="text-[10px] opacity-75 mb-1">Reply</div>
                                <div className="whitespace-pre-wrap break-words">
                                    {renderTextWithLinks(quote, isLight)}
                                </div>
                            </button>
                        )}

                        <div className="whitespace-pre-wrap break-words">
                            {renderTextWithLinks(main, isLight)}
                        </div>
                    </div>
                ) : (
                    <div className={bubbleCls}>
                        <textarea
                            className={inputCls}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    void saveEdit();
                                }
                                if (e.key === "Escape") {
                                    setIsEditing(false);
                                    setDraft(msg.body);
                                }
                            }}
                            autoFocus
                        />
                        <div className="mt-2 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setIsEditing(false);
                                    setDraft(msg.body);
                                }}
                                className={
                                    isLight
                                        ? "px-3 h-9 rounded-xl bg-[#ECEAEA] hover:bg-[#DCDCDC] border border-[#D8D0D0] text-black/70 text-sm"
                                        : "px-3 h-9 rounded-xl bg-[#F7F5F5] hover:bg-[#303030] border border-[#D8D0D0] text-black/75 text-sm"
                                }
                                disabled={savingEdit}
                                title="Cancel"
                            >
                                <X size={16} />
                            </button>

                            <button
                                type="button"
                                onClick={() => void saveEdit()}
                                className={
                                    "px-3 h-9 rounded-xl text-sm font-semibold inline-flex items-center gap-2 " +
                                    (savingEdit ? "opacity-70 cursor-not-allowed " : "") +
                                    "bg-[#81DB86] hover:bg-[#72CF78] text-black"
                                }
                                disabled={savingEdit || !draft.trim()}
                                title="Save"
                            >
                                <Check size={16} />
                                Save
                            </button>
                        </div>
                        <div
                            className={
                                "mt-1 text-[11px] " +
                                (isLight ? "text-black/40" : "text-black/35")
                            }
                        >
                            Enter — save • Shift+Enter — new line • Esc — cancel
                        </div>
                    </div>
                )}

                {hasReactions && !isEditing && (
                    <div
                        className={
                            "mt-2 flex flex-wrap gap-2 " +
                            (mine ? "justify-end" : "justify-start")
                        }
                    >
                        {orderedReactionEntries.map(([emoji, reaction]) => {
                            const isMine = !!myReactions?.[emoji];
                            return (
                                <button
                                    key={emoji}
                                    type="button"
                                    className={
                                        reactionPillBase +
                                        " animate-[fadeIn_180ms_ease-out] " +
                                        (isMine ? reactionPillMine : "") +
                                        (reaction.exiting
                                            ? " pointer-events-none opacity-0 scale-90 translate-y-0.5"
                                            : " opacity-100")
                                    }
                                    onClick={() => onToggleReaction(msg.id, emoji)}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        onOpenReactionDetails(msg.id, emoji);
                                    }}
                                    aria-pressed={isMine}
                                    title={
                                        isMine
                                            ? "Click to remove your reaction · Right-click to see who reacted"
                                            : "Click to react · Right-click to see who reacted"
                                    }
                                >
                                    <span className="text-[16px] leading-none">{emoji}</span>
                                    <span className={reactionCountCls}>{reaction.count}</span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {mine && (
                <img
                    src={avatarFromProfile(msg.profile)}
                    className="w-9 h-9 rounded-full object-cover"
                    alt=""
                />
            )}
        </div>
    );
}

const areMessageCardPropsEqual = (
    prev: MessageCardProps,
    next: MessageCardProps,
) => {
    return (
        prev.msg === next.msg &&
        prev.mine === next.mine &&
        prev.reactionsCounts === next.reactionsCounts &&
        prev.myReactions === next.myReactions &&
        prev.isLight === next.isLight &&
        prev.canEdit === next.canEdit &&
        prev.onReply === next.onReply &&
        prev.onToggleReaction === next.onToggleReaction &&
        prev.onOpenReactionDetails === next.onOpenReactionDetails &&
        prev.onUpdateMessage === next.onUpdateMessage &&
        prev.onDeleteMessage === next.onDeleteMessage &&
        prev.onJumpToMessage === next.onJumpToMessage &&
        prev.highlighted === next.highlighted &&
        prev.readers === next.readers &&
        prev.renderDocument === next.renderDocument &&
        prev.renderWindow === next.renderWindow
    );
};

const MessageCard = React.memo(MessageCardInner, areMessageCardPropsEqual);

export function ChatPanel({
    sessionId,
    theme = "dark",
    showHeader = true,
    title = "Chat",
    subtitle = "All messages for this session",
    onClose,
    onBecameVisible,
    hostUserIdOverride = null,
    hostProfileOverride = null,
    externalMode = "general",
    externalDirectPeerUserId = null,
    onDirectPeerIdsChange,
    renderDocument,
    renderWindow,
}: {
    sessionId: string;
    theme?: RoomTheme;
    showHeader?: boolean;
    title?: string;
    subtitle?: string;
    onClose?: () => void;
    onBecameVisible?: () => void;
    hostUserIdOverride?: string | null;
    hostProfileOverride?: Profile | null;
    externalMode?: "general" | "host";
    externalDirectPeerUserId?: string | null;
    onDirectPeerIdsChange?: (peerIds: string[]) => void;
    renderDocument?: Document | null;
    renderWindow?: Window | null;
}) {
    const isLight = true;
    const chatDocument = renderDocument || document;
    const chatWindow = renderWindow || window;

    const [userId, setUserId] = useState<string | null>(null);
    const [hostUserId, setHostUserId] = useState<string | null>(null);
    useEffect(() => {
        const nextHostId = String(hostUserIdOverride || "").trim();
        if (!nextHostId) return;

        setHostUserId(nextHostId);

        if (hostProfileOverride?.id) {
            const normalizedId = String(hostProfileOverride.id).toLowerCase();

            setProfilesById((prev) => ({
                ...prev,
                [normalizedId]: {
                    id: normalizedId,
                    full_name: hostProfileOverride.full_name || "Host",
                    avatar_url: hostProfileOverride.avatar_url || null,
                },
            }));
        }

        console.log("[chat][host-override]", {
            sessionId,
            nextHostId,
            hostProfileOverride,
        });
    }, [sessionId, hostUserIdOverride, hostProfileOverride]);

    const [directPeerIds, setDirectPeerIds] = useState<string[]>([]);

    const [profilesById, setProfilesById] = useState<Record<string, Profile>>({});
    const profilesByIdRef = useRef<Record<string, Profile>>({});
    useEffect(() => {
        profilesByIdRef.current = profilesById;
    }, [profilesById]);

    const [meProfile, setMeProfile] = useState<Profile | null>(null);
    const meProfileRef = useRef<Profile | null>(null);
    useEffect(() => {
        meProfileRef.current = meProfile;
    }, [meProfile]);

    const [messages, setMessages] = useState<Msg[]>([]);
    const messagesRef = useRef<Msg[]>([]);
    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    const [readersByMessage, setReadersByMessage] = useState<ReadReceiptMap>({});
    const readReceiptChannelRef = useRef<any>(null);
    const readReceiptReadyRef = useRef(false);
    const reportedReadIdsRef = useRef<Set<string>>(new Set());

    const readReceiptStorageKey = useMemo(() => {
        const sid = String(sessionId || "").trim();
        const uid = String(userId || "").trim().toLowerCase();
        if (!sid || !uid) return "";
        return `${CHAT_READ_RECEIPT_STORAGE_PREFIX}:${sid}:${uid}`;
    }, [sessionId, userId]);

    useEffect(() => {
        if (!readReceiptStorageKey) {
            setReadersByMessage({});
            return;
        }

        try {
            const raw = chatWindow.sessionStorage.getItem(readReceiptStorageKey);
            const parsed = raw ? JSON.parse(raw) : {};

            // Backward compatibility with the previous format, which stored only message ids.
            if (Array.isArray(parsed)) {
                const legacyMap: ReadReceiptMap = {};
                parsed.map(String).filter(Boolean).forEach((messageId) => {
                    legacyMap[messageId] = [
                        {
                            userId: "legacy-reader",
                            fullName: "Participant",
                        },
                    ];
                });
                setReadersByMessage(legacyMap);
                return;
            }

            const next: ReadReceiptMap = {};
            if (parsed && typeof parsed === "object") {
                Object.entries(parsed as Record<string, unknown>).forEach(
                    ([messageId, rawReaders]) => {
                        if (!messageId || !Array.isArray(rawReaders)) return;

                        const readers = rawReaders
                            .map((reader: any) => ({
                                userId: String(reader?.userId || "").trim(),
                                fullName: String(reader?.fullName || "Participant").trim() || "Participant",
                                avatarUrl: reader?.avatarUrl ? String(reader.avatarUrl) : null,
                                readAt: Number(reader?.readAt || 0) || undefined,
                            }))
                            .filter((reader) => !!reader.userId);

                        if (readers.length) next[messageId] = readers;
                    },
                );
            }

            setReadersByMessage(next);
        } catch {
            setReadersByMessage({});
        }
    }, [chatWindow, readReceiptStorageKey]);

    const rememberMessageReaders = useCallback(
        (messageIds: string[], reader: ReadReceiptReader) => {
            const normalizedIds = messageIds.map(String).filter(Boolean);
            const readerUserId = String(reader?.userId || "").trim();

            if (!normalizedIds.length || !readerUserId) return;

            setReadersByMessage((prev) => {
                const next: ReadReceiptMap = { ...prev };

                normalizedIds.forEach((messageId) => {
                    const existing = Array.isArray(next[messageId])
                        ? [...next[messageId]]
                        : [];

                    const index = existing.findIndex(
                        (item) => item.userId === readerUserId,
                    );

                    if (index >= 0) {
                        existing[index] = {
                            ...existing[index],
                            ...reader,
                            userId: readerUserId,
                        };
                    } else {
                        existing.push({
                            ...reader,
                            userId: readerUserId,
                        });
                    }

                    next[messageId] = existing
                        .filter((item) => !!item.userId)
                        .slice(-100);
                });

                if (readReceiptStorageKey) {
                    try {
                        const entries = Object.entries(next).slice(-500);
                        chatWindow.sessionStorage.setItem(
                            readReceiptStorageKey,
                            JSON.stringify(Object.fromEntries(entries)),
                        );
                    } catch { }
                }

                return next;
            });
        },
        [chatWindow, readReceiptStorageKey],
    );

    const [reactions, setReactions] = useState<
        Record<string, Record<string, number>>
    >({});
    const [myReactions, setMyReactions] = useState<
        Record<string, Record<string, boolean>>
    >({});
    const [reactionDetails, setReactionDetails] = useState<ReactionDetailsState>({
        open: false,
        messageId: "",
        emoji: "",
        loading: false,
        userIds: [],
        error: null,
    });

    const [text, setText] = useState("");
    const [voiceMessagePreview, setVoiceMessagePreview] = useState(false);

    const [loading, setLoading] = useState(true);
    const [replyTo, setReplyTo] = useState<Msg | null>(null);
    const [highlightedMessageId, setHighlightedMessageId] = useState<
        string | null
    >(null);

    const bottomRef = useRef<HTMLDivElement | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const pollingRef = useRef<number | null>(null);
    const messageElementRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const highlightTimerRef = useRef<number | null>(null);

    const aliveRef = useRef(true);
    useEffect(() => {
        aliveRef.current = true;
        return () => {
            aliveRef.current = false;
        };
    }, []);

    const messagesReqIdRef = useRef(0);
    const reactionsReqIdRef = useRef(0);
    const loadingMessagesRef = useRef(false);
    const loadingReactionsRef = useRef(false);
    const queuedMessagesReloadRef = useRef(false);
    const queuedReactionsReloadRef = useRef(false);

    const lastReactionsLoadKeyRef = useRef("");
    const lastReactionsLoadAtRef = useRef(0);
    const myReactionsRefreshKeyRef = useRef("");

    const atBottomRef = useRef<boolean>(true);
    const initialBottomScrollPendingRef = useRef(true);
    const activeViewKeyRef = useRef("");
    const [unseenNew, setUnseenNew] = useState<number>(0);

    const composerRef = useRef<HTMLTextAreaElement | null>(null);
    const voiceSendRef = useRef<() => Promise<void>>(async () => { });

    useEffect(() => {
        const applyVoiceMessageText = (incoming?: string, preview?: boolean) => {
            let pending = "";
            let pendingPreview = false;
            try {
                pending = chatWindow.sessionStorage.getItem("mysession:voice-message-draft") || "";
                chatWindow.sessionStorage.removeItem("mysession:voice-message-draft");
                pendingPreview =
                    chatWindow.sessionStorage.getItem("mysession:voice-message-preview") === "true";
                chatWindow.sessionStorage.removeItem("mysession:voice-message-preview");
            } catch { }
            const dictated = String(incoming || pending).trim();
            if (!dictated) return;
            setText(dictated);
            setVoiceMessagePreview(preview ?? pendingPreview);
            chatWindow.setTimeout(() => composerRef.current?.focus(), 0);
        };
        const onVoiceMessageText = (event: Event) => {
            const detail = (event as CustomEvent<{
                text?: string;
                preview?: boolean;
            }>).detail;
            applyVoiceMessageText(detail?.text, detail?.preview);
        };
        applyVoiceMessageText();
        chatWindow.addEventListener("mysession:voice-message-text", onVoiceMessageText);
        return () => chatWindow.removeEventListener("mysession:voice-message-text", onVoiceMessageText);
    }, [chatWindow]);
    const composerEmojiWrapRef = useRef<HTMLDivElement | null>(null);
    const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
    const emojiPortalRef = useRef<HTMLDivElement | null>(null);
    const [composerEmojiOpen, setComposerEmojiOpen] = useState(false);
    const [emojiPos, setEmojiPos] = useState<{
        left: number;
        top: number;
        width: number;
        maxHeight: number;
    } | null>(null);

    const bootTsRef = useRef<number>(0);
    const pendingReactionOpsRef = useRef<Map<string, number>>(new Map());
    const reactionKey = (
        ev: string,
        messageId: string,
        emoji: string,
        uid: string,
    ) => `${ev}|${messageId}|${emoji}|${uid}`;

    const isHost = !!userId && !!hostUserId && userId === hostUserId;
    const canUseDirect =
        !!hostUserId && (!!isHost || (!!userId && userId !== hostUserId));
    const activeMode: ChatMode = externalMode === "host" ? "direct" : "general";

    const activeDirectPeerId = useMemo(() => {
        if (!hostUserId || !userId) return null;
        if (isHost) {
            const peerId = String(externalDirectPeerUserId || "").trim();
            return peerId || null;
        }
        return hostUserId;
    }, [hostUserId, userId, isHost, externalDirectPeerUserId]);

    const activeDirectPeerProfile = useMemo(() => {
        if (!activeDirectPeerId) return null;
        return profilesById[activeDirectPeerId] || null;
    }, [activeDirectPeerId, profilesById]);

    const activeViewKey = `${sessionId}|${activeMode}|${activeDirectPeerId || ""}`;
    const newestMessageId = messages[messages.length - 1]?.id || "";

    useEffect(() => {
        if (!sessionId || !userId) return;

        reportedReadIdsRef.current = new Set();

        readReceiptReadyRef.current = false;

        const channel = supabase
            .channel(`${CHAT_READ_RECEIPT_CHANNEL_PREFIX}:${sessionId}`)
            .on(
                "broadcast",
                { event: CHAT_READ_RECEIPT_EVENT },
                (payload: any) => {
                    const data = payload?.payload || payload || {};
                    const readerUserId = String(data?.readerUserId || "").trim();
                    if (!readerUserId || readerUserId === userId) return;

                    const ids = Array.isArray(data?.messageIds)
                        ? data.messageIds.map(String).filter(Boolean)
                        : [];

                    if (!ids.length) return;

                    const myMessageIds = new Set(
                        messagesRef.current
                            .filter((message) => message.user_id === userId)
                            .map((message) => message.id),
                    );

                    const matchingIds = ids.filter((id) => myMessageIds.has(id));
                    if (!matchingIds.length) return;

                    const profile =
                        profilesByIdRef.current[readerUserId] ||
                        null;

                    rememberMessageReaders(matchingIds, {
                        userId: readerUserId,
                        fullName:
                            String(data?.readerName || "").trim() ||
                            String(profile?.full_name || "").trim() ||
                            "Participant",
                        avatarUrl:
                            String(data?.readerAvatarUrl || "").trim() ||
                            profile?.avatar_url ||
                            null,
                        readAt: Number(data?.at || Date.now()),
                    });
                },
            )
            .subscribe((status: string) => {
                readReceiptReadyRef.current = status === "SUBSCRIBED";
            });

        readReceiptChannelRef.current = channel;

        return () => {
            readReceiptReadyRef.current = false;
            readReceiptChannelRef.current = null;
            try {
                void channel.unsubscribe?.();
            } catch { }
            try {
                void (supabase as any).removeChannel?.(channel);
            } catch { }
        };
    }, [sessionId, userId, rememberMessageReaders]);

    const activeSubtitle = useMemo(() => {
        if (activeMode === "general") return subtitle;
        if (!canUseDirect) return subtitle;

        if (!activeDirectPeerId) {
            return isHost
                ? "Pick a participant in the header to open host chat"
                : "Direct messages with the host";
        }

        if (isHost) {
            return `Direct messages with ${activeDirectPeerProfile?.full_name || "participant"}`;
        }

        return `Direct messages with ${activeDirectPeerProfile?.full_name || "host"}`;
    }, [
        activeMode,
        subtitle,
        canUseDirect,
        activeDirectPeerId,
        isHost,
        activeDirectPeerProfile,
    ]);

    const isReplyCompatibleWithActiveComposer = useCallback(
        (message: Msg | null) => {
            if (!message) return false;

            const messageScope: ChatMode =
                message.scope === "direct" ? "direct" : "general";

            // A quote from DMs must never be carried into All chat.
            if (activeMode === "general") {
                return messageScope === "general";
            }

            // A quote from All chat must never be carried into DMs.
            if (messageScope !== "direct") return false;

            if (!userId || !hostUserId || !activeDirectPeerId) return false;

            const messageUserId = String(message.user_id || "").trim();
            const messagePeerId = String(message.dm_peer_user_id || "").trim();

            if (isHost) {
                return (
                    (messageUserId === hostUserId &&
                        messagePeerId === activeDirectPeerId) ||
                    (messageUserId === activeDirectPeerId && messagePeerId === hostUserId)
                );
            }

            return (
                (messageUserId === userId && messagePeerId === hostUserId) ||
                (messageUserId === hostUserId && messagePeerId === userId)
            );
        },
        [activeMode, userId, hostUserId, activeDirectPeerId, isHost],
    );

    useEffect(() => {
        if (!replyTo) return;

        if (!isReplyCompatibleWithActiveComposer(replyTo)) {
            setReplyTo(null);
        }
    }, [replyTo, isReplyCompatibleWithActiveComposer]);

    const isAtBottom = () => {
        const el = listRef.current;
        if (!el) return true;
        const threshold = 140;
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        return distance <= threshold;
    };

    const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
        const list = listRef.current;
        if (list) {
            list.scrollTo({ top: list.scrollHeight, behavior });
            return;
        }

        bottomRef.current?.scrollIntoView({ behavior });
    };

    const jumpToMessage = useCallback((messageId: string) => {
        const el = messageElementRefs.current[messageId];
        if (!el) return;

        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightedMessageId(messageId);

        if (highlightTimerRef.current) {
            chatWindow.clearTimeout(highlightTimerRef.current);
        }

        highlightTimerRef.current = chatWindow.setTimeout(() => {
            setHighlightedMessageId((prev) => (prev === messageId ? null : prev));
        }, 1800);
    }, [chatWindow]);

    useEffect(() => {
        return () => {
            if (highlightTimerRef.current) {
                chatWindow.clearTimeout(highlightTimerRef.current);
            }
        };
    }, [chatWindow]);

    useEffect(() => {
        if (!sessionId) return;

        const cached = CHAT_CACHE.get(sessionId);
        if (cached) {
            messagesRef.current = cached.messages || [];
            profilesByIdRef.current = cached.profilesById || {};
            meProfileRef.current = cached.meProfile || null;

            setMessages(cached.messages || []);
            setReactions(cached.reactions || {});
            setMyReactions(cached.myReactions || {});
            setProfilesById(cached.profilesById || {});
            setMeProfile(cached.meProfile || null);
            setHostUserId(cached.hostUserId || null);
            setDirectPeerIds(cached.directPeerIds || []);
            setLoading(false);
        } else {
            messagesRef.current = [];
            setMessages([]);
            setReactions({});
            setMyReactions({});
            setReplyTo(null);
            setText("");
            setUnseenNew(0);
            setDirectPeerIds([]);
            setLoading(true);
        }
    }, [sessionId]);

    useEffect(() => {
        if (!sessionId) return;
        setChatCache(sessionId, {
            ts: Date.now(),
            messages: messagesRef.current,
            reactions,
            myReactions,
            profilesById: profilesByIdRef.current,
            meProfile: meProfileRef.current,
            hostUserId,
            directPeerIds,
        });
    }, [
        sessionId,
        messages,
        reactions,
        myReactions,
        profilesById,
        meProfile,
        hostUserId,
        directPeerIds,
    ]);

    useEffect(() => {
        onBecameVisible?.();
        setUnseenNew(0);
    }, [onBecameVisible, sessionId, activeMode, activeDirectPeerId]);

    useEffect(() => {
        console.log("[chat][dm-debug]", {
            sessionId,
            userId,
            hostUserId,
            hostUserIdOverride,
            isHost,
            canUseDirect,
            activeMode,
            externalMode,
            activeDirectPeerId,
            directPeerIds,
            externalDirectPeerUserId,
        });
    }, [
        sessionId,
        userId,
        hostUserId,
        hostUserIdOverride,
        isHost,
        canUseDirect,
        activeMode,
        externalMode,
        activeDirectPeerId,
        directPeerIds,
        externalDirectPeerUserId,
    ]);

    const headerBorder = "border-[#D8D0D0]";
    const titleText = "text-black/85";
    const subText = "text-black/50";
    const headerCloseBtnCls = "bg-[#ECEAEA] hover:bg-[#DCDCDC] text-black/60";
    const replyBoxCls = "bg-[#ECEAEA] border-[#D8D0D0]";
    const replyingLabel = "text-[11px] text-[#81DB86]/90 font-medium";
    const replyingText = "text-black/55";
    const cancelBtnCls = "bg-[#ECEAEA] hover:bg-[#DCDCDC] text-black/60";
    const hintText = "text-black/40";
    const sendBtnActive = "bg-[#81DB86] hover:bg-[#72CF78] text-black";
    const sendBtnDisabled = "bg-[#DCDCDC] text-black/35";
    const composerInputCls =
        "flex-1 min-h-[44px] max-h-[140px] rounded-xl resize-none px-3 py-3 text-[13px] outline-none bg-[#F3F1F1] border border-[#D8D0D0] text-black/85 placeholder:text-black/35 focus:ring-1 focus:ring-[#81DB86] focus:border-[#81DB86]";
    const composerEmojiBtnCls =
        "w-11 h-11 rounded-xl flex items-center justify-center transition border bg-[#F3F1F1] border-[#D8D0D0] text-black/60 hover:bg-[#E8E8E8] hover:text-black/80";
    const portalBoxCls =
        "rounded-2xl border border-[#D8D0D0] bg-[#F3F1F1] shadow-2xl overflow-hidden";

    useEffect(() => {
        (async () => {
            const { data } = await supabase.auth.getUser();
            const uid = data.user?.id ?? null;
            if (!aliveRef.current) return;
            setUserId(uid);

            if (uid) {
                const { data: p } = await supabase
                    .from("profiles")
                    .select("id, full_name, avatar_url")
                    .eq("id", uid)
                    .single();

                if (!aliveRef.current) return;

                if (p) {
                    meProfileRef.current = p as any;
                    setMeProfile(p as any);
                    profilesByIdRef.current = {
                        ...profilesByIdRef.current,
                        [uid]: p as any,
                    };
                    setProfilesById((prev) => ({ ...prev, [uid]: p as any }));
                }
            }
        })();
    }, []);

    useEffect(() => {
        if (!sessionId) return;
        let cancelled = false;

        const loadHost = async () => {
            try {
                const { data, error } = await supabase
                    .from("sessions")
                    .select("host_id")
                    .eq("id", sessionId)
                    .single();

                if (cancelled) return;
                if (error) {
                    console.warn("chat session host load error:", error);
                    setHostUserId(null);
                    return;
                }

                const hostId =
                    String((data as SessionHostRow | null)?.host_id || "").trim() || null;
                setHostUserId(hostId);
                if (hostId) {
                    void ensureProfiles([hostId]);
                }
            } catch (e) {
                if (!cancelled) {
                    console.warn("chat session host load failed:", e);
                    setHostUserId(null);
                }
            }
        };

        loadHost();
        return () => {
            cancelled = true;
        };
    }, [sessionId]);

    const ensureProfiles = useCallback(async (userIds: string[]) => {
        const unique = Array.from(new Set(userIds)).filter(Boolean);
        const missing = unique.filter((id) => !profilesByIdRef.current[id]);
        if (missing.length === 0) return;

        const { data: profs, error } = await supabase
            .from("profiles")
            .select("id, full_name, avatar_url")
            .in("id", missing);

        if (error) {
            console.error("profiles load error:", error);
            return;
        }

        const map: Record<string, Profile> = {};
        (profs || []).forEach((p: any) => {
            map[p.id] = p;
        });

        if (!aliveRef.current) return;

        profilesByIdRef.current = { ...profilesByIdRef.current, ...map };
        setProfilesById((prev) => ({ ...prev, ...map }));
    }, []);

    useEffect(() => {
        if (!messagesRef.current.length) return;

        setMessages((prev) => {
            let changed = false;
            const next = prev.map((m) => {
                const nextProfile =
                    profilesByIdRef.current[m.user_id] ||
                    (m.user_id === userId ? meProfileRef.current : null) ||
                    null;
                const prevName = m.profile?.full_name || null;
                const nextName = nextProfile?.full_name || null;
                const prevAvatar = m.profile?.avatar_url || null;
                const nextAvatar = nextProfile?.avatar_url || null;
                if (prevName === nextName && prevAvatar === nextAvatar) return m;
                changed = true;
                return { ...m, profile: nextProfile };
            });
            if (changed) {
                messagesRef.current = next;
                return next;
            }
            return prev;
        });
    }, [profilesById, userId, meProfile]);

    const attachProfile = useCallback(
        (row: MsgRow): Msg => {
            const map = profilesByIdRef.current;
            const mp = meProfileRef.current;
            return {
                ...row,
                profile:
                    (map[row.user_id] || (row.user_id === userId ? mp : null)) ?? null,
            };
        },
        [userId],
    );

    const getRecentMessageIdsForReactions = () =>
        normalizeReactionMessageIds(messagesRef.current.map((m) => m.id));

    const closeReactionDetails = () => {
        setReactionDetails({
            open: false,
            messageId: "",
            emoji: "",
            loading: false,
            userIds: [],
            error: null,
        });
    };

    const loadReactionDetails = async (messageId: string, emoji: string) => {
        if (!sessionId) return;

        setReactionDetails((prev) => ({
            ...prev,
            open: true,
            messageId,
            emoji,
            loading: true,
            error: null,
            userIds: [],
        }));

        try {
            const q = supabase
                .from(REACTIONS_TABLE)
                .select("id, session_id, message_id, user_id, emoji, created_at")
                .eq("session_id", sessionId)
                .eq("message_id", messageId)
                .eq("emoji", emoji)
                .order("created_at", { ascending: true })
                .limit(5000);

            const reactionDetailsResult = (await withTimeout<any>(
                q as any,
                12000,
                "loadReactionDetails timeout",
            )) as any;
            const { data, error } = reactionDetailsResult;
            if (!aliveRef.current) return;

            if (error) {
                console.error("reaction details load error:", error);
                setReactionDetails((prev) => ({
                    ...prev,
                    open: true,
                    loading: false,
                    error: "Failed to load reactions",
                    userIds: [],
                }));
                return;
            }

            const rows = ((data as any) || []) as ReactionRow[];
            const ids = rows.map((r) => r.user_id).filter(Boolean);
            await ensureProfiles(ids);
            if (!aliveRef.current) return;

            setReactionDetails((prev) => ({
                ...prev,
                open: true,
                loading: false,
                error: null,
                userIds: ids,
            }));
        } catch (e) {
            console.warn("loadReactionDetails failed:", e);
            if (!aliveRef.current) return;
            setReactionDetails((prev) => ({
                ...prev,
                open: true,
                loading: false,
                error: "Failed to load reactions",
                userIds: [],
            }));
        }
    };

    useEffect(() => {
        if (!reactionDetails.open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") closeReactionDetails();
        };
        chatDocument.addEventListener("keydown", onKey);
        return () => chatDocument.removeEventListener("keydown", onKey);
    }, [chatDocument, reactionDetails.open]);

    const loadDirectPeers = useCallback(async () => {
        if (!sessionId || !hostUserId) {
            console.log(
                "[chat][direct-peers] skipped: missing sessionId or hostUserId",
                { sessionId, hostUserId },
            );
            setDirectPeerIds([]);
            return [] as string[];
        }

        try {
            const { data, error } = await supabase
                .from(MSG_TABLE)
                .select("user_id, dm_peer_user_id, scope")
                .eq("session_id", sessionId)
                .limit(2000);

            if (error) {
                console.warn("direct peers load error:", error);
                setDirectPeerIds([]);
                return [] as string[];
            }

            const peerIds = Array.from(
                new Set(
                    ((data as any[]) || [])
                        .flatMap((row) => [
                            String(row?.user_id || "").trim(),
                            String(row?.dm_peer_user_id || "").trim(),
                        ])
                        .filter((id) => id && id !== hostUserId),
                ),
            );

            console.log("[chat][direct-peers] loaded", {
                sessionId,
                hostUserId,
                peerIds,
                rowCount: Array.isArray(data) ? data.length : 0,
            });

            setDirectPeerIds(peerIds);
            if (peerIds.length) void ensureProfiles(peerIds);
            return peerIds;
        } catch (e) {
            console.warn("direct peers load failed:", e);
            setDirectPeerIds([]);
            return [] as string[];
        }
    }, [sessionId, hostUserId, ensureProfiles]);

    useEffect(() => {
        if (!hostUserId) return;
        if (!isHost) return;
        void loadDirectPeers();
    }, [hostUserId, isHost, loadDirectPeers]);

    useEffect(() => {
        onDirectPeerIdsChange?.(directPeerIds);
    }, [directPeerIds, onDirectPeerIdsChange]);

    const loadMessages = useCallback(
        async (opts?: { silent?: boolean }): Promise<Msg[] | null> => {
            if (!sessionId) return null;

            if (loadingMessagesRef.current) {
                queuedMessagesReloadRef.current = true;
                return null;
            }

            loadingMessagesRef.current = true;
            const reqId = ++messagesReqIdRef.current;

            if (!opts?.silent) setLoading(true);

            try {
                const q = buildMessageQuery(
                    sessionId,
                    activeMode,
                    userId,
                    hostUserId,
                    activeDirectPeerId,
                );
                const loadMessagesResult = (await withTimeout<any>(
                    q as any,
                    12000,
                    "loadMessages timeout",
                )) as any;
                const { data: rows, error } = loadMessagesResult;

                if (!aliveRef.current || reqId !== messagesReqIdRef.current)
                    return null;
                if (error) {
                    console.error("chat load error:", error);
                    return null;
                }

                const safeRows = ((rows as any as MsgRow[]) || []).slice().reverse();
                await ensureProfiles(
                    safeRows
                        .map((r) => r.user_id)
                        .concat(
                            safeRows
                                .map((r) => String(r.dm_peer_user_id || ""))
                                .filter(Boolean),
                        ),
                );
                if (!aliveRef.current || reqId !== messagesReqIdRef.current)
                    return null;

                const attached = safeRows.map((r) => attachProfile(r));
                messagesRef.current = attached;
                setMessages(attached);
                return attached;
            } catch (e) {
                console.warn("loadMessages failed:", e);
                if (!aliveRef.current || reqId !== messagesReqIdRef.current)
                    return null;
                return null;
            } finally {
                if (
                    aliveRef.current &&
                    reqId === messagesReqIdRef.current &&
                    !opts?.silent
                )
                    setLoading(false);
                loadingMessagesRef.current = false;
                if (queuedMessagesReloadRef.current) {
                    queuedMessagesReloadRef.current = false;
                    void loadMessages({ silent: true });
                }
            }
        },
        [
            sessionId,
            activeMode,
            userId,
            hostUserId,
            activeDirectPeerId,
            ensureProfiles,
            attachProfile,
        ],
    );

    const loadReactions = useCallback(
        async (opts?: {
            silent?: boolean;
            messageIds?: string[];
            force?: boolean;
        }) => {
            if (!sessionId) return;

            if (loadingReactionsRef.current) {
                queuedReactionsReloadRef.current = true;
                return;
            }

            const msgIdsRaw =
                opts?.messageIds && opts.messageIds.length > 0
                    ? opts.messageIds
                    : getRecentMessageIdsForReactions();
            const msgIds = normalizeReactionMessageIds(msgIdsRaw);

            if (msgIds.length === 0) {
                setReactions({});
                setMyReactions({});
                return;
            }

            const loadKey = `${sessionId}|${userId || "anon"}|${msgIds.join(",")}`;
            const now = Date.now();

            if (
                !opts?.force &&
                lastReactionsLoadKeyRef.current === loadKey &&
                now - lastReactionsLoadAtRef.current < REACTIONS_REFETCH_DEDUPE_MS
            ) {
                return;
            }

            lastReactionsLoadKeyRef.current = loadKey;
            lastReactionsLoadAtRef.current = now;

            loadingReactionsRef.current = true;
            const reqId = ++reactionsReqIdRef.current;

            try {
                const q = supabase
                    .from(REACTIONS_TABLE)
                    .select("id, session_id, message_id, user_id, emoji, created_at")
                    .eq("session_id", sessionId)
                    .in("message_id", msgIds)
                    .order("created_at", { ascending: false })
                    .limit(REACTIONS_BOOTSTRAP_LIMIT);

                const loadReactionsResult = (await withTimeout<any>(
                    q as any,
                    12000,
                    "loadReactions timeout",
                )) as any;
                const { data, error } = loadReactionsResult;

                if (!aliveRef.current || reqId !== reactionsReqIdRef.current) return;

                if (error) {
                    console.error("reactions load error:", error);
                    return;
                }

                const rows = (data as any as ReactionRow[]) || [];
                const counts: Record<string, Record<string, number>> = {};
                const mine: Record<string, Record<string, boolean>> = {};

                for (const r of rows) {
                    if (!counts[r.message_id]) counts[r.message_id] = {};
                    counts[r.message_id][r.emoji] =
                        (counts[r.message_id][r.emoji] || 0) + 1;

                    if (userId && r.user_id === userId) {
                        if (!mine[r.message_id]) mine[r.message_id] = {};
                        mine[r.message_id][r.emoji] = true;
                    }
                }

                setReactions(counts);
                setMyReactions(mine);
            } catch (e) {
                console.warn("loadReactions failed:", e);
            } finally {
                loadingReactionsRef.current = false;

                if (queuedReactionsReloadRef.current) {
                    queuedReactionsReloadRef.current = false;
                    void loadReactions({ silent: true, force: true });
                }
            }
        },
        [sessionId, userId],
    );

    const bootstrap = useCallback(
        async (opts?: { silent?: boolean; force?: boolean }) => {
            if (!sessionId) return;
            const now = Date.now();
            if (!opts?.force && now - bootTsRef.current < 8000) return;

            if (isHost) {
                await loadDirectPeers();
            }

            const loaded = await loadMessages({ silent: opts?.silent });
            const list = loaded ?? messagesRef.current;
            const ids = normalizeReactionMessageIds(list.map((m) => m.id));
            await loadReactions({
                silent: true,
                messageIds: ids,
                force: opts?.force,
            });
            bootTsRef.current = now;
        },
        [sessionId, isHost, loadDirectPeers, loadMessages, loadReactions],
    );

    useEffect(() => {
        if (!sessionId) return;
        void bootstrap({ silent: false, force: true });
    }, [sessionId, activeMode, activeDirectPeerId, bootstrap]);

    useEffect(() => {
        if (!sessionId || !userId) return;

        const ids = getRecentMessageIdsForReactions();
        if (ids.length === 0) return;

        const key = `${sessionId}|${userId}|${activeMode}|${activeDirectPeerId || ""}|${ids.join(",")}`;
        if (myReactionsRefreshKeyRef.current === key) return;

        myReactionsRefreshKeyRef.current = key;

        void loadReactions({
            silent: true,
            messageIds: ids,
            force: true,
        });
    }, [sessionId, userId, activeMode, activeDirectPeerId, loadReactions]);

    useEffect(() => {
        if (!sessionId) return;

        if (pollingRef.current) {
            chatWindow.clearInterval(pollingRef.current);
            pollingRef.current = null;
        }

        const channel = supabase.channel(`chat:${sessionId}`);

        channel.on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: MSG_TABLE,
                filter: `session_id=eq.${sessionId}`,
            },
            async (payload: any) => {
                const row = payload?.new as MsgRow | undefined;
                if (!row?.id) return;

                const relevant = messageBelongsToView(
                    row,
                    activeMode,
                    userId,
                    hostUserId,
                    activeDirectPeerId,
                );

                if (row.scope === "direct" && isHost && hostUserId) {
                    const otherId =
                        row.user_id === hostUserId
                            ? String(row.dm_peer_user_id || "").trim()
                            : row.user_id;
                    if (otherId && otherId !== hostUserId) {
                        setDirectPeerIds((prev) =>
                            prev.includes(otherId) ? prev : [...prev, otherId],
                        );
                        void ensureProfiles([otherId]);
                    }
                }

                if (!relevant) return;

                await ensureProfiles(
                    [row.user_id, String(row.dm_peer_user_id || "").trim()].filter(
                        Boolean,
                    ),
                );
                if (!aliveRef.current) return;

                const beforeAtBottom = isAtBottom();
                atBottomRef.current = beforeAtBottom;

                setMessages((prev) => {
                    if (prev.some((m) => m.id === row.id)) return prev;

                    const idxOptimistic = prev.findIndex(
                        (m) =>
                            m.id.startsWith("optimistic-") &&
                            m.user_id === row.user_id &&
                            m.body === row.body &&
                            (m.scope || "general") === (row.scope || "general") &&
                            String(m.dm_peer_user_id || "") ===
                            String(row.dm_peer_user_id || ""),
                    );

                    const merged = attachProfile(row);
                    let next: Msg[];
                    if (idxOptimistic !== -1) {
                        next = [...prev];
                        next[idxOptimistic] = merged;
                    } else {
                        next = [...prev, merged];
                    }

                    messagesRef.current = next;
                    return next;
                });

                if (!beforeAtBottom && row.user_id !== userId) {
                    setUnseenNew((n) => Math.min(99, n + 1));
                }
            },
        );

        channel.on(
            "postgres_changes",
            {
                event: "UPDATE",
                schema: "public",
                table: MSG_TABLE,
                filter: `session_id=eq.${sessionId}`,
            },
            async (payload: any) => {
                const row = payload?.new as MsgRow | undefined;
                if (!row?.id) return;
                const relevant = messageBelongsToView(
                    row,
                    activeMode,
                    userId,
                    hostUserId,
                    activeDirectPeerId,
                );
                if (!relevant) {
                    setMessages((prev) => {
                        const next = prev.filter((m) => m.id !== row.id);
                        messagesRef.current = next;
                        return next;
                    });
                    return;
                }

                await ensureProfiles(
                    [row.user_id, String(row.dm_peer_user_id || "").trim()].filter(
                        Boolean,
                    ),
                );
                if (!aliveRef.current) return;

                setMessages((prev) => {
                    const exists = prev.some((m) => m.id === row.id);
                    const mapped = attachProfile(row);
                    const next = exists
                        ? prev.map((m) => (m.id === row.id ? mapped : m))
                        : [...prev, mapped];
                    messagesRef.current = next;
                    return next;
                });
            },
        );

        channel.on(
            "postgres_changes",
            {
                event: "DELETE",
                schema: "public",
                table: MSG_TABLE,
                filter: `session_id=eq.${sessionId}`,
            },
            (payload: any) => {
                const deletedId = payload?.old?.id as string | undefined;
                if (!deletedId) return;

                setMessages((prev) => {
                    const next = prev.filter((m) => m.id !== deletedId);
                    messagesRef.current = next;
                    return next;
                });

                setReactions((prev) => {
                    if (!prev[deletedId]) return prev;
                    const next = { ...prev };
                    delete next[deletedId];
                    return next;
                });

                setMyReactions((prev) => {
                    if (!prev[deletedId]) return prev;
                    const next = { ...prev };
                    delete next[deletedId];
                    return next;
                });
            },
        );

        channel.subscribe((status) => {
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                if (!pollingRef.current) {
                    pollingRef.current = chatWindow.setInterval(() => {
                        void bootstrap({ silent: true, force: true });
                    }, 15000);
                }
                return;
            }

            if (status === "SUBSCRIBED") {
                if (pollingRef.current) {
                    chatWindow.clearInterval(pollingRef.current);
                    pollingRef.current = null;
                }
                if (messagesRef.current.length === 0) {
                    void bootstrap({ silent: true, force: true });
                }
            }
        });

        return () => {
            if (pollingRef.current) {
                chatWindow.clearInterval(pollingRef.current);
                pollingRef.current = null;
            }
            supabase.removeChannel(channel);
        };
    }, [
        sessionId,
        userId,
        activeMode,
        hostUserId,
        activeDirectPeerId,
        isHost,
        attachProfile,
        ensureProfiles,
        bootstrap,
        chatWindow,
    ]);

    useEffect(() => {
        if (!sessionId) return;

        const applyInsert = (r: ReactionRow) => {
            setReactions((prev) => {
                const next = { ...prev };
                const msgMap = { ...(next[r.message_id] || {}) };
                msgMap[r.emoji] = (msgMap[r.emoji] || 0) + 1;
                next[r.message_id] = msgMap;
                return next;
            });

            if (userId && r.user_id === userId) {
                setMyReactions((prev) => {
                    const next = { ...prev };
                    const mineMap = { ...(next[r.message_id] || {}) };
                    mineMap[r.emoji] = true;
                    next[r.message_id] = mineMap;
                    return next;
                });
            }
        };

        const applyDelete = (r: ReactionRow) => {
            setReactions((prev) => {
                const curMsg = prev[r.message_id];
                if (!curMsg) return prev;

                const next = { ...prev };
                const msgMap = { ...curMsg };
                const cur = Number(msgMap[r.emoji] || 0);
                const n = Math.max(0, cur - 1);

                if (n <= 0) delete msgMap[r.emoji];
                else msgMap[r.emoji] = n;

                if (Object.keys(msgMap).length === 0) delete next[r.message_id];
                else next[r.message_id] = msgMap;
                return next;
            });

            if (userId && r.user_id === userId) {
                setMyReactions((prev) => {
                    const curMsg = prev[r.message_id];
                    if (!curMsg) return prev;

                    const next = { ...prev };
                    const mineMap = { ...curMsg };
                    delete mineMap[r.emoji];
                    if (Object.keys(mineMap).length === 0) delete next[r.message_id];
                    else next[r.message_id] = mineMap;
                    return next;
                });
            }
        };

        const shouldSkipFromPending = (ev: string, r: ReactionRow) => {
            if (!userId || r.user_id !== userId) return false;
            const key = reactionKey(ev, r.message_id, r.emoji, r.user_id);
            const ts = pendingReactionOpsRef.current.get(key);
            if (!ts) return false;
            if (Date.now() - ts < 6000) {
                pendingReactionOpsRef.current.delete(key);
                return true;
            }
            pendingReactionOpsRef.current.delete(key);
            return false;
        };

        const ch = supabase
            .channel(`chat-reactions:${sessionId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: REACTIONS_TABLE,
                    filter: `session_id=eq.${sessionId}`,
                },
                (payload: any) => {
                    const ev: string =
                        payload?.eventType || payload?.type || payload?.event || "";
                    const n = payload?.new as ReactionRow | undefined;
                    const o = payload?.old as ReactionRow | undefined;

                    if (ev === "INSERT" && n) {
                        if (shouldSkipFromPending("INSERT", n)) return;
                        applyInsert(n);
                        return;
                    }

                    if (ev === "DELETE" && o) {
                        if (shouldSkipFromPending("DELETE", o)) return;
                        applyDelete(o);
                        return;
                    }

                    if (ev === "UPDATE" && o && n) {
                        if (
                            !(
                                userId &&
                                o.user_id === userId &&
                                shouldSkipFromPending("UPDATE", o)
                            )
                        ) {
                            applyDelete(o);
                            applyInsert(n);
                        }
                        return;
                    }

                    void loadReactions({
                        silent: true,
                        messageIds: getRecentMessageIdsForReactions(),
                    });
                },
            )
            .subscribe();

        return () => {
            supabase.removeChannel(ch);
        };
    }, [sessionId, userId, loadReactions]);

    useLayoutEffect(() => {
        const viewChanged = activeViewKeyRef.current !== activeViewKey;
        if (viewChanged) {
            activeViewKeyRef.current = activeViewKey;
            initialBottomScrollPendingRef.current = true;
            atBottomRef.current = true;
            setUnseenNew(0);
        }

        const forceInitialScroll = initialBottomScrollPendingRef.current;
        const shouldScroll =
            forceInitialScroll || atBottomRef.current || isAtBottom();
        if (shouldScroll) {
            const behavior: ScrollBehavior = forceInitialScroll ? "auto" : "smooth";
            scrollToBottom(behavior);

            let secondFrame = 0;
            const firstFrame = chatWindow.requestAnimationFrame(() => {
                scrollToBottom(behavior);
                secondFrame = chatWindow.requestAnimationFrame(() => {
                    scrollToBottom(behavior);
                });
            });

            if (forceInitialScroll && !loading) {
                initialBottomScrollPendingRef.current = false;
            }

            setUnseenNew(0);
            onBecameVisible?.();

            return () => {
                chatWindow.cancelAnimationFrame(firstFrame);
                if (secondFrame) chatWindow.cancelAnimationFrame(secondFrame);
            };
        }
    }, [
        activeViewKey,
        newestMessageId,
        messages.length,
        loading,
        onBecameVisible,
        chatWindow,
    ]);

    useEffect(() => {
        const el = composerRef.current;
        if (!el) return;
        el.style.height = "0px";
        const next = Math.min(el.scrollHeight, 140);
        el.style.height = `${next}px`;
    }, [text, replyTo]);

    const insertEmojiToComposer = (emoji: string) => {
        const ta = composerRef.current;
        if (!ta) {
            setText((prev) => prev + emoji);
            setComposerEmojiOpen(false);
            return;
        }

        const start = ta.selectionStart ?? text.length;
        const end = ta.selectionEnd ?? text.length;

        setText((prev) => {
            const s = Math.max(0, Math.min(start, prev.length));
            const e = Math.max(s, Math.min(end, prev.length));
            return prev.slice(0, s) + emoji + prev.slice(e);
        });

        setComposerEmojiOpen(false);

        chatWindow.requestAnimationFrame(() => {
            const el = composerRef.current;
            if (!el) return;
            el.focus();
            const pos = start + emoji.length;
            try {
                el.setSelectionRange(pos, pos);
            } catch { }
        });
    };

    const computeEmojiPosition = () => {
        const btn = emojiButtonRef.current;
        if (!btn) return null;

        const rect = btn.getBoundingClientRect();
        const vv = chatWindow.visualViewport;
        const vw = Math.floor(vv?.width || chatWindow.innerWidth);
        const vh = Math.floor(vv?.height || chatWindow.innerHeight);
        const offsetLeft = Math.floor(vv?.offsetLeft || 0);
        const offsetTop = Math.floor(vv?.offsetTop || 0);

        const margin = 10;
        const desiredWidth = vw < 420 ? 280 : vw < 560 ? 300 : 360;
        const width = Math.max(240, Math.min(desiredWidth, vw - margin * 2));
        const desiredHeight = 420;

        let left = rect.right - width + offsetLeft;
        left = Math.max(
            margin + offsetLeft,
            Math.min(left, offsetLeft + vw - width - margin),
        );

        const spaceAbove = rect.top - margin;
        const spaceBelow = vh - rect.bottom - margin;
        const preferAbove = spaceAbove >= 260 || spaceAbove >= spaceBelow;

        let maxHeight = Math.max(
            240,
            Math.min(desiredHeight, (preferAbove ? spaceAbove : spaceBelow) - 8),
        );
        maxHeight = Math.max(240, Math.min(maxHeight, vh - margin * 2));

        let top = preferAbove
            ? rect.top - maxHeight - 8 + offsetTop
            : rect.bottom + 8 + offsetTop;
        top = Math.max(
            margin + offsetTop,
            Math.min(top, offsetTop + vh - maxHeight - margin),
        );

        return { left, top, width, maxHeight };
    };

    useEffect(() => {
        if (!composerEmojiOpen) {
            setEmojiPos(null);
            return;
        }

        setEmojiPos(computeEmojiPosition());

        const onResize = () => setEmojiPos(computeEmojiPosition());
        const onScroll = () => onResize();

        chatWindow.addEventListener("resize", onResize);
        chatWindow.addEventListener("scroll", onScroll, true);

        const onDown = (e: MouseEvent) => {
            const t = e.target as Node | null;
            if (!t) return;
            if (composerEmojiWrapRef.current?.contains(t)) return;
            if (emojiPortalRef.current?.contains(t)) return;
            setComposerEmojiOpen(false);
        };

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setComposerEmojiOpen(false);
        };

        chatDocument.addEventListener("mousedown", onDown);
        chatDocument.addEventListener("keydown", onKey);

        return () => {
            chatWindow.removeEventListener("resize", onResize);
            chatWindow.removeEventListener("scroll", onScroll, true);
            chatDocument.removeEventListener("mousedown", onDown);
            chatDocument.removeEventListener("keydown", onKey);
        };
    }, [chatDocument, chatWindow, composerEmojiOpen]);

    const send = async () => {
        const raw = text.trim();
        if (!raw || !userId || !sessionId) return;

        const outgoingScope: ChatMode =
            activeMode === "direct" ? "direct" : "general";
        const outgoingPeerId =
            outgoingScope === "direct" ? activeDirectPeerId : null;

        const safeReplyTo =
            replyTo && isReplyCompatibleWithActiveComposer(replyTo) ? replyTo : null;

        if (replyTo && !safeReplyTo) {
            // Privacy guard: never leak a quoted DM into All chat, or a quote from one DM thread into another.
            setReplyTo(null);
        }

        const replyQuote = safeReplyTo
            ? quotePreviewForReply(safeReplyTo.body, 240)
            : "";
        const replyName = safeReplyTo?.profile?.full_name || "Participant";
        const replyHeader = safeReplyTo
            ? `↪ [msg:${safeReplyTo.id}] ${replyName}: ${replyQuote || "[message]"}`
            : null;
        const composed = replyHeader ? `${replyHeader}\n\n${raw}` : raw;

        if (outgoingScope === "direct" && !outgoingPeerId) {
            console.warn("[chat][send] blocked direct send: missing peer", {
                sessionId,
                userId,
                hostUserId,
                isHost,
                activeMode,
                activeDirectPeerId,
                externalMode,
                externalDirectPeerUserId,
            });
            alert(
                isHost
                    ? "Pick a participant first."
                    : "Direct host chat is not ready yet.",
            );
            return;
        }

        const optimistic: Msg = {
            id: `optimistic-${Date.now()}`,
            session_id: sessionId,
            user_id: userId,
            body: composed,
            created_at: new Date().toISOString(),
            scope: outgoingScope,
            dm_peer_user_id: outgoingPeerId,
            profile:
                profilesByIdRef.current[userId] ||
                meProfileRef.current ||
                ({ id: userId, full_name: "You", avatar_url: null } as any),
        };

        atBottomRef.current = true;
        setMessages((prev) => {
            const next = [...prev, optimistic];
            messagesRef.current = next;
            return next;
        });

        setText("");
        setComposerEmojiOpen(false);
        setReplyTo(null);

        const { error } = await supabase.from(MSG_TABLE).insert({
            session_id: sessionId,
            user_id: userId,
            body: composed,
            created_at: new Date().toISOString(),
            scope: outgoingScope,
            dm_peer_user_id: outgoingPeerId,
        });

        if (error) {
            console.error("chat send error:", error);
            setMessages((prev) => {
                const next = prev.filter((m) => m.id !== optimistic.id);
                messagesRef.current = next;
                return next;
            });
            setText(composed);
            return;
        }

        if (isHost && outgoingScope === "direct" && outgoingPeerId) {
            setDirectPeerIds((prev) =>
                prev.includes(outgoingPeerId) ? prev : [...prev, outgoingPeerId],
            );
        }

        setVoiceMessagePreview(false);
    };

    voiceSendRef.current = send;

    useEffect(() => {
        const onVoiceMessageSend = () => {
            void voiceSendRef.current();
        };
        const onVoiceMessageCancel = () => {
            setText("");
            setVoiceMessagePreview(false);
            chatWindow.setTimeout(() => composerRef.current?.focus(), 0);
        };

        chatWindow.addEventListener("mysession:voice-message-send", onVoiceMessageSend);
        chatWindow.addEventListener("mysession:voice-message-cancel", onVoiceMessageCancel);
        return () => {
            chatWindow.removeEventListener("mysession:voice-message-send", onVoiceMessageSend);
            chatWindow.removeEventListener("mysession:voice-message-cancel", onVoiceMessageCancel);
        };
    }, [chatWindow]);

    const updateMessage = async (messageId: string, newBody: string) => {
        if (!userId || !sessionId) return;
        const prevBody =
            messagesRef.current.find((m) => m.id === messageId)?.body ?? null;

        setMessages((prev) => {
            const next = prev.map((m) =>
                m.id === messageId ? { ...m, body: newBody } : m,
            );
            messagesRef.current = next;
            return next;
        });

        const { error } = await supabase
            .from(MSG_TABLE)
            .update({ body: newBody })
            .eq("id", messageId)
            .eq("session_id", sessionId)
            .eq("user_id", userId);

        if (error) {
            console.error("chat update error:", error);
            if (prevBody !== null) {
                setMessages((prev) => {
                    const next = prev.map((m) =>
                        m.id === messageId ? { ...m, body: prevBody } : m,
                    );
                    messagesRef.current = next;
                    return next;
                });
            } else {
                void loadMessages({ silent: true });
            }
        }
    };

    const deleteMessage = async (messageId: string) => {
        if (!userId || !sessionId) return;
        const snapshot = messagesRef.current;

        setMessages((prev) => {
            const next = prev.filter((m) => m.id !== messageId);
            messagesRef.current = next;
            return next;
        });

        const { error } = await supabase
            .from(MSG_TABLE)
            .delete()
            .eq("id", messageId)
            .eq("session_id", sessionId)
            .eq("user_id", userId);

        if (error) {
            console.error("chat delete error:", error);
            setMessages(snapshot);
            messagesRef.current = snapshot;
        }
    };

    const toggleReaction = async (messageId: string, emoji: string) => {
        if (!userId || !sessionId) return;
        const already = !!myReactions?.[messageId]?.[emoji];

        setReactions((prev) => {
            const next = { ...prev };
            const msgMap = { ...(next[messageId] || {}) };
            const cur = Number(msgMap[emoji] || 0);
            const nextCount = already ? Math.max(0, cur - 1) : cur + 1;
            if (nextCount <= 0) delete msgMap[emoji];
            else msgMap[emoji] = nextCount;
            if (Object.keys(msgMap).length === 0) delete next[messageId];
            else next[messageId] = msgMap;
            return next;
        });

        setMyReactions((prev) => {
            const next = { ...prev };
            const msgMine = { ...(next[messageId] || {}) };
            if (already) delete msgMine[emoji];
            else msgMine[emoji] = true;
            if (Object.keys(msgMine).length === 0) delete next[messageId];
            else next[messageId] = msgMine;
            return next;
        });

        const expectedEv = already ? "DELETE" : "INSERT";
        pendingReactionOpsRef.current.set(
            reactionKey(expectedEv, messageId, emoji, userId),
            Date.now(),
        );

        if (already) {
            const { error } = await supabase
                .from(REACTIONS_TABLE)
                .delete()
                .eq("session_id", sessionId)
                .eq("message_id", messageId)
                .eq("user_id", userId)
                .eq("emoji", emoji);

            if (error) {
                console.warn("removeReaction error:", error);
                void loadReactions({
                    silent: true,
                    messageIds: getRecentMessageIdsForReactions(),
                });
            }
            return;
        }

        const { error } = await supabase.from(REACTIONS_TABLE).insert({
            session_id: sessionId,
            message_id: messageId,
            user_id: userId,
            emoji,
        });

        if (error) {
            const code = (error as any)?.code;
            const msg = String((error as any)?.message || "");
            const isDup =
                code === "23505" ||
                msg.toLowerCase().includes("duplicate") ||
                msg.toLowerCase().includes("unique");

            if (isDup) {
                pendingReactionOpsRef.current.set(
                    reactionKey("DELETE", messageId, emoji, userId),
                    Date.now(),
                );
                await supabase
                    .from(REACTIONS_TABLE)
                    .delete()
                    .eq("session_id", sessionId)
                    .eq("message_id", messageId)
                    .eq("user_id", userId)
                    .eq("emoji", emoji);
                void loadReactions({
                    silent: true,
                    messageIds: getRecentMessageIdsForReactions(),
                });
                return;
            }

            console.warn("addReaction error:", error);
            void loadReactions({
                silent: true,
                messageIds: getRecentMessageIdsForReactions(),
            });
        }
    };

    const visibleMessages = useMemo(
        () => messages.slice(-VISIBLE_MESSAGE_LIMIT),
        [messages],
    );

    useEffect(() => {
        if (!sessionId || !userId) return;
        if (chatDocument.visibilityState === "hidden") return;

        const unreadForMe = visibleMessages.filter((message) => {
            if (!message.id || message.id.startsWith("optimistic-")) return false;
            if (message.user_id === userId) return false;
            return !reportedReadIdsRef.current.has(message.id);
        });

        if (!unreadForMe.length) return;

        const messageIds = unreadForMe.map((message) => message.id);

        const channel = readReceiptChannelRef.current;
        if (!channel || !readReceiptReadyRef.current) return;

        const timer = chatWindow.setTimeout(() => {
            if (!readReceiptReadyRef.current) return;

            messageIds.forEach((id) => reportedReadIdsRef.current.add(id));

            try {
                void channel.send({
                    type: "broadcast",
                    event: CHAT_READ_RECEIPT_EVENT,
                    payload: {
                        readerUserId: userId,
                        readerName:
                            String(meProfileRef.current?.full_name || "").trim() ||
                            "Participant",
                        readerAvatarUrl:
                            String(meProfileRef.current?.avatar_url || "").trim() ||
                            null,
                        messageIds,
                        mode: activeMode,
                        directPeerUserId: activeDirectPeerId,
                        at: Date.now(),
                    },
                });
            } catch { }
        }, 120);

        return () => chatWindow.clearTimeout(timer);
    }, [
        sessionId,
        userId,
        visibleMessages,
        activeMode,
        activeDirectPeerId,
        chatDocument,
        chatWindow,
    ]);

    const modalMessage = reactionDetails.open
        ? messagesRef.current.find((m) => m.id === reactionDetails.messageId) ||
        null
        : null;
    const modalMessageMain = modalMessage
        ? parseReplyBody(modalMessage.body).main
        : "";
    const modalBg = isLight
        ? "bg-[#F3F1F1] border border-[#D8D0D0]"
        : "bg-[#F3F1F1] border border-[#D8D0D0]";
    const modalTextPrimary = isLight ? "text-black/85" : "text-black/90";
    const modalTextSecondary = isLight ? "text-black/55" : "text-black/55";
    const modalBtn = isLight
        ? "bg-[#ECEAEA] hover:bg-[#DCDCDC] border border-[#D8D0D0] text-black/70"
        : "bg-[#F7F5F5] hover:bg-[#303030] border border-[#D8D0D0] text-black/75";
    const modalPrimaryBtn = "bg-[#81DB86] hover:bg-[#72CF78] text-black";
    const canToggleInModal =
        !!reactionDetails.open &&
        !!reactionDetails.messageId &&
        !!reactionDetails.emoji;
    const myReactedInModal =
        canToggleInModal &&
        !!myReactions?.[reactionDetails.messageId]?.[reactionDetails.emoji];

    const emojiPortal =
        composerEmojiOpen && emojiPos
            ? createPortal(
                <div
                    className="fixed inset-0 z-[99999]"
                    style={{ pointerEvents: "none" }}
                >
                    <div
                        className="absolute inset-0"
                        style={{ pointerEvents: "auto", background: "transparent" }}
                        onMouseDown={() => setComposerEmojiOpen(false)}
                    />
                    <div
                        ref={emojiPortalRef}
                        className={"absolute " + portalBoxCls}
                        style={{
                            pointerEvents: "auto",
                            left: emojiPos.left,
                            top: emojiPos.top,
                            width: emojiPos.width,
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <div
                            style={{ maxHeight: emojiPos.maxHeight }}
                            className="overflow-hidden"
                        >
                            <Picker
                                data={emojiData}
                                theme="light"
                                set="native"
                                previewPosition="none"
                                searchPosition="sticky"
                                navPosition="bottom"
                                skinTonePosition="preview"
                                onEmojiSelect={(e: any) => {
                                    const native = e?.native || e?.emoji || "";
                                    if (native) insertEmojiToComposer(String(native));
                                }}
                            />
                        </div>
                    </div>
                </div>,
                chatDocument.body,
            )
            : null;

    return (
        <div className="h-full flex flex-col bg-transparent min-h-0 relative">
            {reactionDetails.open && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center">
                    <div
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        onClick={closeReactionDetails}
                    />
                    <div
                        className={
                            "relative w-[92vw] max-w-[520px] rounded-2xl shadow-2xl " +
                            modalBg
                        }
                    >
                        <div
                            className={
                                "px-5 py-4 border-b " +
                                (isLight ? "border-[#D8D0D0]" : "border-[#D8D0D0]")
                            }
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div
                                        className={"text-[14px] font-semibold " + modalTextPrimary}
                                    >
                                        {reactionDetails.emoji} Reactions
                                    </div>
                                    <div className={"text-[12px] mt-0.5 " + modalTextSecondary}>
                                        Click outside or press Esc to close
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={closeReactionDetails}
                                    className={
                                        "w-9 h-9 rounded-xl flex items-center justify-center transition " +
                                        modalBtn
                                    }
                                    title="Close"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            {modalMessage && (
                                <div
                                    className={
                                        "mt-3 rounded-xl px-3 py-2 text-[12px] " +
                                        (isLight
                                            ? "bg-[#ECEAEA] border border-[#D8D0D0]"
                                            : "bg-[#F7F5F5] border border-[#D8D0D0]")
                                    }
                                >
                                    <div className={"text-[11px] mb-1 " + modalTextSecondary}>
                                        Message
                                    </div>
                                    <div
                                        className={
                                            modalTextPrimary + " whitespace-pre-wrap break-words"
                                        }
                                    >
                                        {collapseWs(modalMessageMain).slice(0, 260) +
                                            (collapseWs(modalMessageMain).length > 260 ? "…" : "")}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="px-5 py-4">
                            <div className="flex items-center justify-between gap-3">
                                <div className={modalTextSecondary + " text-[12px]"}>
                                    {reactionDetails.loading
                                        ? "Loading…"
                                        : `${reactionDetails.userIds.length} ${reactionDetails.userIds.length === 1 ? "person" : "people"} reacted`}
                                </div>

                                {canToggleInModal && (
                                    <button
                                        type="button"
                                        className={
                                            "px-3 h-9 rounded-xl text-[13px] font-semibold border transition " +
                                            (myReactedInModal
                                                ? modalBtn
                                                : modalPrimaryBtn + " border-[#81DB86]/50")
                                        }
                                        onClick={async () => {
                                            await toggleReaction(
                                                reactionDetails.messageId,
                                                reactionDetails.emoji,
                                            );
                                            void loadReactionDetails(
                                                reactionDetails.messageId,
                                                reactionDetails.emoji,
                                            );
                                        }}
                                        title={myReactedInModal ? "Remove my reaction" : "React"}
                                    >
                                        {myReactedInModal
                                            ? "Remove my reaction"
                                            : "Add my reaction"}
                                    </button>
                                )}
                            </div>

                            {reactionDetails.error && (
                                <div
                                    className={
                                        "mt-3 text-[12px] " +
                                        (isLight ? "text-red-700" : "text-red-300")
                                    }
                                >
                                    {reactionDetails.error}
                                </div>
                            )}

                            <div className="mt-4 max-h-[46vh] overflow-y-auto custom-scrollbar pr-1">
                                {reactionDetails.loading && (
                                    <div className="py-6 flex items-center justify-center">
                                        <div
                                            className={
                                                "w-7 h-7 rounded-full border-2 animate-spin " +
                                                (isLight
                                                    ? "border-black/20 border-t-black/60"
                                                    : "border-[#333333] border-t-white/70")
                                            }
                                        />
                                    </div>
                                )}

                                {!reactionDetails.loading &&
                                    reactionDetails.userIds.length === 0 &&
                                    !reactionDetails.error && (
                                        <div
                                            className={
                                                modalTextSecondary +
                                                " text-[13px] italic py-6 text-center"
                                            }
                                        >
                                            No reactions yet
                                        </div>
                                    )}

                                {!reactionDetails.loading &&
                                    reactionDetails.userIds.length > 0 && (
                                        <div className="space-y-2">
                                            {reactionDetails.userIds.map((uid) => {
                                                const prof =
                                                    profilesByIdRef.current[uid] ||
                                                    (uid === userId ? meProfileRef.current : null) ||
                                                    ({
                                                        id: uid,
                                                        full_name: "Participant",
                                                        avatar_url: null,
                                                    } as Profile);
                                                const displayName =
                                                    uid === userId
                                                        ? "You"
                                                        : prof?.full_name || "Participant";
                                                return (
                                                    <div
                                                        key={uid}
                                                        className={
                                                            "flex items-center gap-3 rounded-xl px-3 py-2 border " +
                                                            (isLight
                                                                ? "bg-[#F3F1F1] border-[#D8D0D0]"
                                                                : "bg-[#F7F5F5] border-[#D8D0D0]")
                                                        }
                                                    >
                                                        <img
                                                            src={avatarFromProfile(prof)}
                                                            className="w-9 h-9 rounded-full object-cover"
                                                            alt=""
                                                        />
                                                        <div className="min-w-0">
                                                            <div
                                                                className={
                                                                    modalTextPrimary + " text-[13px] truncate"
                                                                }
                                                            >
                                                                {displayName}
                                                            </div>
                                                            <div
                                                                className={
                                                                    modalTextSecondary + " text-[11px] truncate"
                                                                }
                                                            >
                                                                {uid === userId ? "This is you" : ""}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showHeader && (
                <div className={"px-5 py-4 border-b " + headerBorder}>
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex items-center gap-3">
                            <div
                                className={
                                    titleText + " font-inter font-semibold truncate min-w-0"
                                }
                            >
                                {title}
                            </div>
                        </div>

                        {onClose && (
                            <button
                                type="button"
                                onClick={onClose}
                                className={
                                    "w-9 h-9 rounded-xl flex items-center justify-center transition " +
                                    headerCloseBtnCls
                                }
                                title="Close"
                            >
                                <X size={18} />
                            </button>
                        )}
                    </div>

                    {activeSubtitle && (
                        <div className={subText + " text-[12px] mt-0.5"}>
                            {activeSubtitle}
                        </div>
                    )}
                </div>
            )}

            <div
                ref={listRef}
                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-4 space-y-3 custom-scrollbar relative"
                onScroll={() => {
                    const at = isAtBottom();
                    atBottomRef.current = at;
                    if (at) {
                        if (unseenNew > 0) setUnseenNew(0);
                        onBecameVisible?.();
                    }
                }}
            >
                {loading && (
                    <div
                        className={
                            (isLight ? "text-black/45" : "text-white/40") + " text-sm italic"
                        }
                    >
                        Loading…
                    </div>
                )}

                {!loading && visibleMessages.length === 0 && (
                    <div
                        className={
                            (isLight ? "text-black/45" : "text-white/40") + " text-sm italic"
                        }
                    >
                        {activeMode === "general"
                            ? "No messages yet"
                            : isHost && !activeDirectPeerId
                                ? "Pick a participant to start a direct thread"
                                : "No direct messages yet"}
                    </div>
                )}

                {visibleMessages.map((m) => {
                    const mine = m.user_id === userId;
                    const canEdit = mine && !m.id.startsWith("optimistic-");
                    return (
                        <div
                            key={m.id}
                            ref={(el) => {
                                messageElementRefs.current[m.id] = el;
                            }}
                            data-message-id={m.id}
                        >
                            <MessageCard
                                msg={m}
                                mine={mine}
                                onReply={(msg) => setReplyTo(msg)}
                                reactionsCounts={reactions[m.id]}
                                myReactions={myReactions[m.id]}
                                onToggleReaction={toggleReaction}
                                onOpenReactionDetails={loadReactionDetails}
                                isLight={isLight}
                                canEdit={canEdit}
                                onUpdateMessage={updateMessage}
                                onDeleteMessage={deleteMessage}
                                onJumpToMessage={jumpToMessage}
                                highlighted={highlightedMessageId === m.id}
                                readers={mine ? readersByMessage[m.id] || [] : []}
                                renderDocument={chatDocument}
                                renderWindow={chatWindow}
                            />
                        </div>
                    );
                })}

                <div ref={bottomRef} />
            </div>

            {unseenNew > 0 && (
                <div className="absolute left-0 right-0 bottom-[96px] flex items-center justify-center pointer-events-none">
                    <button
                        type="button"
                        className={
                            "pointer-events-auto px-4 py-2 rounded-full shadow-xl text-[12px] font-semibold border transition " +
                            (isLight
                                ? "bg-[#F1F1F1]/95 border-[#D8D0D0] text-black/80 hover:bg-[#F3F1F1]"
                                : "bg-[#F7F5F5]/95 border-[#D8D0D0] text-black/85 hover:bg-[#F7F5F5]")
                        }
                        onClick={() => {
                            atBottomRef.current = true;
                            scrollToBottom("smooth");
                            setUnseenNew(0);
                            onBecameVisible?.();
                        }}
                        title="Jump to newest"
                    >
                        New messages ({unseenNew}) • Jump
                    </button>
                </div>
            )}

            <div className={"p-4 border-t " + headerBorder}>
                {replyTo && (
                    <div
                        className={
                            "mb-2 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 " +
                            replyBoxCls
                        }
                    >
                        <div className="min-w-0">
                            <div className={replyingLabel}>Replying</div>
                            <div className={"text-[11px] truncate " + replyingText}>
                                {(replyTo.profile?.full_name || "Participant") +
                                    ": " +
                                    (quotePreviewForReply(replyTo.body, 220) || "[message]")}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setReplyTo(null)}
                            className={
                                "w-8 h-8 rounded-lg flex items-center justify-center transition " +
                                cancelBtnCls
                            }
                            title="Cancel reply"
                        >
                            <X size={16} />
                        </button>
                    </div>
                )}

                {voiceMessagePreview && text.trim() ? (
                    <div
                        className={
                            "mb-2 rounded-xl border px-3 py-2 " +
                            (isLight
                                ? "border-[#81DB86]/60 bg-[#81DB86]/10 text-black/80"
                                : "border-[#81DB86]/45 bg-[#81DB86]/10 text-white/85")
                        }
                    >
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#3FB455]">
                                    Voice message preview
                                </div>
                                <div className="mt-1 text-[12px] leading-4 opacity-75">
                                    Review the message below, then say “Confirm”.
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setText("");
                                        setVoiceMessagePreview(false);
                                    }}
                                    className={
                                        "h-8 rounded-lg px-2.5 text-[11px] font-semibold transition " +
                                        (isLight
                                            ? "bg-black/5 hover:bg-black/10"
                                            : "bg-white/[0.06] hover:bg-white/10")
                                    }
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void send()}
                                    className="h-8 rounded-lg bg-[#81DB86] px-3 text-[11px] font-semibold text-black transition hover:bg-[#72CF78]"
                                >
                                    Confirm
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}

                <div className="flex items-end gap-2">
                    <textarea
                        ref={composerRef}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder={
                            activeMode === "general"
                                ? "Write a message…"
                                : isHost
                                    ? activeDirectPeerId
                                        ? "Write a direct message…"
                                        : "Pick a participant first…"
                                    : "Message the host…"
                        }
                        className={composerInputCls}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void send();
                            }
                        }}
                        onFocus={() => {
                            if (isAtBottom()) onBecameVisible?.();
                        }}
                        disabled={activeMode === "direct" && isHost && !activeDirectPeerId}
                    />

                    <div className="relative" ref={composerEmojiWrapRef}>
                        <button
                            ref={emojiButtonRef}
                            type="button"
                            title="Add emoji"
                            className={composerEmojiBtnCls}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => setComposerEmojiOpen((v) => !v)}
                        >
                            <Smile size={18} />
                        </button>
                    </div>

                    <button
                        onClick={() => void send()}
                        className={
                            "w-11 h-11 rounded-xl flex items-center justify-center transition border " +
                            (text.trim() &&
                                !(activeMode === "direct" && isHost && !activeDirectPeerId)
                                ? sendBtnActive + " border-[#81DB86]/50"
                                : sendBtnDisabled + " border-transparent cursor-not-allowed")
                        }
                        type="button"
                        disabled={
                            !text.trim() ||
                            (activeMode === "direct" && isHost && !activeDirectPeerId)
                        }
                        title="Send"
                    >
                        <SendHorizontal size={18} />
                    </button>
                </div>

                <div className={"mt-2 text-[11px] " + hintText}>
                    Enter — send • Shift+Enter — new line
                </div>
            </div>

            {emojiPortal}
        </div>
    );
}

export default ChatPanel;
