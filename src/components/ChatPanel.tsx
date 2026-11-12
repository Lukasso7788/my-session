import React, {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { createPortal } from "react-dom";
import { EmojiPickerPopover } from "./EmojiPickerPopover";
import { supabase } from "../lib/supabase";
import { useLatestCallback } from "../hooks/useLatestCallback";
import { useSpeechDictation } from "../hooks/useSpeechDictation";
import { boundChatMessages, reconcileChatSnapshot, CHAT_PAGE_SIZE, CHAT_WINDOW_LIMIT } from "../lib/chatMessageWindow";
import { createChatProfileLoader } from "../lib/chatProfileLoader";
import { createPanelSnapshotCache } from "../lib/panelSnapshotCache";
import { profileHoverAttrs } from "./ProfileHoverLayer";
import {
    CheckCheck,
    CornerUpLeft,
    Mic,
    Pencil,
    Square,
    SendHorizontal,
    Smile,
    Trash2,
    X,
} from "lucide-react";
import { defaultAvatarUrl } from "../lib/defaultAvatar";

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
// Sent when a chat view opens: people in the session answer with the ids of
// the requester's messages they have read, so receipts missed while the chat
// was closed come back.
const CHAT_READ_RECEIPT_REQUEST_EVENT = "message-read-request";
const CHAT_READ_RECEIPT_MAX_MESSAGES = 500;
const CHAT_READ_RECEIPT_CHANNEL_PREFIX = "chat-read-receipts";
const CHAT_READ_RECEIPT_STORAGE_PREFIX = "mysession_chat_read_receipts_v1";

const MESSAGE_BOOTSTRAP_LIMIT = CHAT_PAGE_SIZE;
const REACTIONS_BOOTSTRAP_LIMIT = 120;
const REACTIONS_MESSAGE_ID_LIMIT = 60;
const REACTIONS_REFETCH_DEDUPE_MS = 30_000;
const VISIBLE_MESSAGE_LIMIT = CHAT_WINDOW_LIMIT;
const EMPTY_READERS: ReadReceiptReader[] = [];
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

const BRAND_GREEN = "#5286F6";
const BRAND_GREEN_HOVER = "#5286F6";
const BRAND_GREEN_SOFT = "rgba(129,219,134,0.14)";
const BRAND_GREEN_BORDER = "rgba(129,219,134,0.48)";

function avatarFromProfile(profile?: Profile | null, isLight = true) {
    return (
        profile?.avatar_url ||
        defaultAvatarUrl(profile?.full_name, null, isLight ? "light" : "dark")
    );
}

/** First names for the hover lists: "Maya, Priya, Jonas +2". */
function shortNamesLabel(names: string[], max = 3) {
    const first = names.slice(0, max).map((name) => String(name || "").trim().split(/\s+/)[0] || "Participant");
    return first.join(", ") + (names.length > max ? ` +${names.length - max}` : "");
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
    confirmedProfiles: Record<string, Profile>;
    meProfile: Profile | null;
    hostUserId: string | null;
    directPeerIds: string[];
};

const CHAT_CACHE = createPanelSnapshotCache<ChatCacheEntry>();

function setChatCache(sessionId: string, entry: ChatCacheEntry) {
    CHAT_CACHE.write(sessionId, entry, entry.ts);
}

type ReactionDetailsState = {
    open: boolean;
    messageId: string;
    emoji: string;
    loading: boolean;
    userIds: string[];
    error?: string | null;
    /** When each person reacted, for the details list. */
    reactedAt?: Record<string, string>;
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
        .order("id", { ascending: false })
        .limit(MESSAGE_BOOTSTRAP_LIMIT);

    if (mode === "general") {
        q = q.or("scope.is.null,scope.eq.general");
        return q;
    }

    if (!currentUserId || !hostUserId) {
        return q.is("id", null);
    }

    if (currentUserId === hostUserId) {
        if (!selectedDirectPeerId) {
            return q.is("id", null);
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
    /** Hovering a reaction shows who reacted; null anchor hides it. */
    onHoverReaction?: (messageId: string, emoji: string, anchor: HTMLElement | null) => void;
    isLight: boolean;
    canEdit: boolean;
    /** A room moderator may delete someone else's public message. */
    canModerate: boolean;
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
    onHoverReaction,
    isLight,
    canEdit,
    canModerate,
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
    const [editEmojiOpen, setEditEmojiOpen] = useState(false);
    const editEmojiButtonRef = useRef<HTMLButtonElement | null>(null);
    const editEmojiMenuRef = useRef<HTMLDivElement | null>(null);
    const [editEmojiPos, setEditEmojiPos] = useState<{
        top: number;
        left: number;
        width: number;
        height: number;
    } | null>(null);
    const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [savingEdit, setSavingEdit] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [readersOpen, setReadersOpen] = useState(false);
    const readReceiptButtonRef = useRef<HTMLButtonElement | null>(null);
    // Hovering the check marks shows who read the message; a click still opens the full list.
    const [readersHoverPos, setReadersHoverPos] = useState<{ left: number; top: number } | null>(null);
    const readersHoverTimerRef = useRef<number | null>(null);
    const showReadersHover = (anchor: HTMLElement | null) => {
        if (readersHoverTimerRef.current) renderWindow.clearTimeout(readersHoverTimerRef.current);
        readersHoverTimerRef.current = null;
        if (!anchor) {
            setReadersHoverPos(null);
            return;
        }
        readersHoverTimerRef.current = renderWindow.setTimeout(() => {
            const rect = anchor.getBoundingClientRect();
            setReadersHoverPos({ left: rect.left + rect.width / 2, top: rect.top });
        }, 250);
    };

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

    // The edit picker lives in a portal: inside the bubble it was clipped by
    // the message list and squeezed to the bubble's width.
    const updateEditEmojiPos = useCallback(() => {
        const button = editEmojiButtonRef.current;
        if (!button) return;

        const rect = button.getBoundingClientRect();
        const vw = renderWindow.innerWidth || 360;
        const vh = renderWindow.innerHeight || 640;
        const margin = 8;
        const width = Math.max(280, Math.min(352, vw - margin * 2));
        const height = Math.min(420, vh - margin * 2);

        const left = Math.max(margin, Math.min(rect.right - width, vw - width - margin));
        const spaceBelow = vh - rect.bottom - margin;
        const spaceAbove = rect.top - margin;
        const top =
            spaceBelow >= height || spaceBelow >= spaceAbove
                ? Math.min(rect.bottom + 8, vh - height - margin)
                : Math.max(margin, rect.top - height - 8);

        setEditEmojiPos({ top, left, width, height });
    }, [renderWindow]);

    useEffect(() => {
        if (!isEditing) setEditEmojiOpen(false);
    }, [isEditing]);

    useEffect(() => {
        if (!editEmojiOpen) {
            setEditEmojiPos(null);
            return;
        }

        updateEditEmojiPos();

        const onDown = (e: MouseEvent) => {
            const t = e.target as Node | null;
            if (!t) return;
            if (editEmojiButtonRef.current?.contains(t)) return;
            if (editEmojiMenuRef.current?.contains(t)) return;
            setEditEmojiOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setEditEmojiOpen(false);
        };
        const onRelayout = () => updateEditEmojiPos();

        renderDocument.addEventListener("mousedown", onDown);
        renderDocument.addEventListener("keydown", onKey);
        renderWindow.addEventListener("resize", onRelayout);
        renderWindow.addEventListener("scroll", onRelayout, true);

        return () => {
            renderDocument.removeEventListener("mousedown", onDown);
            renderDocument.removeEventListener("keydown", onKey);
            renderWindow.removeEventListener("resize", onRelayout);
            renderWindow.removeEventListener("scroll", onRelayout, true);
        };
    }, [editEmojiOpen, renderDocument, renderWindow, updateEditEmojiPos]);

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

    const metaNameCls = isLight ? "text-black/70 font-medium" : "text-[#D9DEE4] font-medium";
    const metaTimeCls = isLight ? "text-black/35" : "text-[#AEB6BF]";
    const actionBtnCls = isLight
        ? "text-black/45 hover:bg-black/[0.06] hover:text-[#2F5FC4]"
        : "text-[#C6CDD5] hover:bg-white/10 hover:text-[#8FB0FA]";
    const dangerBtnCls = isLight ? "text-black/40 hover:text-red-700" : "text-[#C6CDD5] hover:text-red-300";
    const menuCls = isLight ? "bg-[#F3F1F1] border border-[#D8D0D0]" : "bg-[#292929] border border-[#484848] text-[#F4F5F6]";

    // Bubbles: others on white with a soft shadow, yours in a soft accent blue;
    // the corner next to the name is tighter, like a speech tail.
    const bubbleCls =
        "rounded-2xl px-2.5 py-1.5 text-[13px] leading-snug border whitespace-pre-wrap break-words transition " +
        (mine
            ? "rounded-tr-md " +
              (isLight
                ? "bg-[#5286F6]/[0.14] border-transparent text-black/85"
                : "bg-[#5286F6]/25 border-transparent text-white")
            : "rounded-tl-md " +
              (isLight
                ? "bg-white border-black/[0.05] text-black/80 shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                : "bg-[#262626] border-white/[0.05] text-[#F4F5F6]")) +
        (highlighted
            ? isLight
                ? " ring-2 ring-[#6B7280]/55"
                : " ring-2 ring-[#5286F6]/70"
            : "");

    const quoteBoxCls = isLight
        ? "bg-black/[0.045] text-black/65 hover:bg-black/[0.07]"
        : "bg-white/[0.07] text-[#D9DEE4] hover:bg-white/[0.1]";

    // Reactions: round pills. Pale gray when only others reacted; the room's
    // accent blue with a white count once you reacted too.
    const reactionPillBase =
        "inline-flex h-[22px] items-center gap-1 rounded-full px-[7px] text-[12px] cursor-pointer transition-[opacity,transform,background-color] duration-150 ease-out active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5286F6]/50 ";
    const reactionPillOthers = isLight
        ? "bg-black/[0.06] hover:bg-black/[0.1]"
        : "bg-white/[0.08] hover:bg-white/[0.13]";
    const reactionPillMine = "bg-[#5286F6] hover:bg-[#6B98FA]";
    const reactionCountCls = "font-inter font-normal leading-none tabular-nums";

    const { quote, quoteMessageId, main } = useMemo(
        () => parseReplyBody(msg.body),
        [msg.body],
    );

    const insertEmojiToEdit = (emoji: string) => {
        const textarea = editTextareaRef.current;
        const start = textarea?.selectionStart ?? draft.length;
        const end = textarea?.selectionEnd ?? draft.length;

        setDraft((current) => {
            const safeStart = Math.max(0, Math.min(start, current.length));
            const safeEnd = Math.max(safeStart, Math.min(end, current.length));
            return current.slice(0, safeStart) + emoji + current.slice(safeEnd);
        });
        setEditEmojiOpen(false);

        renderWindow.requestAnimationFrame(() => {
            const current = editTextareaRef.current;
            if (!current) return;
            const nextPosition = start + emoji.length;
            current.focus();
            current.setSelectionRange(nextPosition, nextPosition);
        });
    };

    const cancelEdit = () => {
        setIsEditing(false);
        setEditEmojiOpen(false);
        setDraft(msg.body);
    };

    const saveEdit = async () => {
        const next = draft.trim();
        if (!next) return;

        setSavingEdit(true);
        try {
            await onUpdateMessage(msg.id, next);
            setIsEditing(false);
            setEditEmojiOpen(false);
        } finally {
            setSavingEdit(false);
        }
    };

    const doDelete = async () => {
        if (deleting) return;
        const ok = renderWindow.confirm(
            canEdit ? "Delete this message?" : "Delete this message for everyone in the room?",
        );
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
                "group flex items-start gap-2 " + (mine ? "justify-end" : "justify-start")
            }
        >
            {!mine && (
                <img
                    src={avatarFromProfile(msg.profile, isLight)}
                    {...profileHoverAttrs(msg.user_id, msg.profile?.full_name)}
                    className="h-[31px] w-[31px] rounded-full object-cover"
                    alt=""
                />
            )}

            <div className="max-w-[82%] min-w-0">
                <div
                    className={
                        "flex items-center gap-2 mb-0.5 " +
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
                                className="inline-flex items-center gap-1 text-[#5286F6] transition hover:opacity-80"
                                onMouseEnter={(e) => showReadersHover(e.currentTarget)}
                                onMouseLeave={() => showReadersHover(null)}
                                onFocus={(e) => showReadersHover(e.currentTarget)}
                                onBlur={() => showReadersHover(null)}
                                aria-label={
                                    readers.length === 1
                                        ? `Read by ${readers[0]?.fullName || "Participant"}`
                                        : `Read by ${readers.length} people`
                                }
                                onClick={(e) => {
                                    e.stopPropagation();
                                    showReadersHover(null);
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

                            {readersHoverPos && !readersOpen
                                ? createPortal(
                                    <div
                                        className="pointer-events-none fixed z-[10000] w-max -translate-x-1/2 -translate-y-full pb-2 animate-[fadeIn_140ms_ease-out]"
                                        style={{ left: Math.min(Math.max(readersHoverPos.left, 150), renderWindow.innerWidth - 150), top: readersHoverPos.top }}
                                        role="tooltip"
                                        aria-label={`Read by ${readers.map((reader) => reader.fullName || "Participant").join(", ")}`}
                                    >
                                        <div
                                            className={
                                                "flex max-w-[280px] items-center rounded-full border p-1 shadow-[0_10px_30px_rgba(0,0,0,0.16)] " +
                                                (isLight ? "border-[#D8D0D0] bg-[#F7F5F5]" : "border-[#343434] bg-[#232323]")
                                            }
                                        >
                                            <div className="flex -space-x-1.5">
                                                {readers.slice(0, 6).map((reader) => (
                                                    <img
                                                        key={reader.userId}
                                                        src={reader.avatarUrl || defaultAvatarUrl(reader.fullName, null, isLight ? "light" : "dark")}
                                                        className={"h-6 w-6 rounded-full object-cover ring-2 " + (isLight ? "ring-[#F7F5F5]" : "ring-[#232323]")}
                                                        alt=""
                                                    />
                                                ))}
                                                {readers.length > 6 ? (
                                                    <span
                                                        className={
                                                            "flex h-6 min-w-6 items-center justify-center rounded-full px-1 font-inter text-[10px] ring-2 " +
                                                            (isLight ? "bg-[#E6E4E4] text-black/60 ring-[#F7F5F5]" : "bg-[#303030] text-[#C6CDD5] ring-[#232323]")
                                                        }
                                                    >
                                                        +{readers.length - 6}
                                                    </span>
                                                ) : null}
                                            </div>
                                            <CheckCheck size={13} strokeWidth={2.2} className="ml-1.5 shrink-0 text-[#5286F6]" aria-hidden="true" />
                                            <span className={"ml-1 mr-2 truncate font-inter text-[11px] font-medium " + (isLight ? "text-black/75" : "text-[#E3E7EB]")}>
                                                {shortNamesLabel(readers.map((reader) => reader.fullName || "Participant"))}
                                            </span>
                                        </div>
                                    </div>,
                                    renderDocument.body,
                                )
                                : null}

                            {readersOpen
                                ? createPortal(
                                    <div
                                        className="fixed inset-0 z-[220] flex items-center justify-center p-4 font-inter"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setReadersOpen(false);
                                        }}
                                    >
                                        <div className="session-booking-drawer-backdrop absolute inset-0 bg-black/40 backdrop-blur-[2px]" />

                                        <div
                                            role="dialog"
                                            aria-modal="true"
                                            aria-label="Read by"
                                            className={
                                                "relative z-[1] flex max-h-[82vh] w-full max-w-[380px] flex-col overflow-hidden rounded-[24px] border shadow-[0_28px_90px_rgba(0,0,0,0.28)] " +
                                                (isLight ? "border-[#D8D0D0] bg-[#F3F1F1]" : "border-[#343434] bg-[#1B1B1B]")
                                            }
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            {/* Header: check marks, how many people, close */}
                                            <div className="flex items-center gap-3 px-5 pb-3 pt-5">
                                                <div
                                                    className={
                                                        "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-[#5286F6] " +
                                                        (isLight ? "bg-white" : "bg-[#262626]")
                                                    }
                                                    aria-hidden="true"
                                                >
                                                    <CheckCheck size={24} strokeWidth={2.2} />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className={"text-[16px] font-semibold leading-5 " + (isLight ? "text-black/85" : "text-[#F4F5F6]")}>
                                                        Read by
                                                    </div>
                                                    <div className={"mt-0.5 text-[12px] " + (isLight ? "text-black/50" : "text-[#AEB6C0]")}>
                                                        {readers.length === 1 ? "1 person read this message" : `${readers.length} people read this message`}
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    className={
                                                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] transition " +
                                                        (isLight ? "bg-[#E6E6E6] text-black/60 hover:bg-[#DCDCDC]" : "bg-[#303030] text-[#D4D9DF] hover:bg-[#3A3A3A]")
                                                    }
                                                    onClick={() => setReadersOpen(false)}
                                                    aria-label="Close"
                                                    title="Close"
                                                >
                                                    <X size={16} />
                                                </button>
                                            </div>

                                            {/* The message that was read */}
                                            {main ? (
                                                <div
                                                    className={
                                                        "mx-5 mb-3 rounded-2xl border px-3 py-2.5 " +
                                                        (isLight ? "border-[#D8D0D0] bg-[#F7F5F5]" : "border-[#343434] bg-[#232323]")
                                                    }
                                                >
                                                    <div className={"text-[12px] font-semibold " + (isLight ? "text-black/85" : "text-[#F4F5F6]")}>You</div>
                                                    <div className={"mt-0.5 line-clamp-2 text-[12px] leading-4 " + (isLight ? "text-black/55" : "text-[#AEB6C0]")}>
                                                        {main}
                                                    </div>
                                                </div>
                                            ) : null}

                                            {/* Who read it */}
                                            <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-3 pb-3">
                                                {readers.map((reader) => (
                                                    <div
                                                        key={reader.userId}
                                                        className={
                                                            "flex items-center gap-3 rounded-xl px-2 py-2 transition " +
                                                            (isLight ? "hover:bg-black/[0.04]" : "hover:bg-white/[0.05]")
                                                        }
                                                    >
                                                        <img
                                                            src={reader.avatarUrl || defaultAvatarUrl(reader.fullName || "Participant", null, isLight ? "light" : "dark")}
                                                            className="h-8 w-8 shrink-0 rounded-full object-cover"
                                                            alt=""
                                                        />
                                                        <div className={"min-w-0 flex-1 truncate text-[13px] font-semibold " + (isLight ? "text-black/85" : "text-[#F4F5F6]")}>
                                                            {reader.fullName || "Participant"}
                                                        </div>
                                                        {reader.readAt ? (
                                                            <div className={"shrink-0 text-[11px] tabular-nums " + (isLight ? "text-black/45" : "text-[#AEB6C0]")}>
                                                                {new Date(reader.readAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                                            </div>
                                                        ) : null}
                                                        <CheckCheck size={15} strokeWidth={2.2} className="shrink-0 text-[#5286F6]" aria-hidden="true" />
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
                        <div className="ml-0.5 flex h-5 shrink-0 items-center gap-0.5 leading-none opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                            <button
                                type="button"
                                onClick={() => onReply(msg)}
                                className={"flex h-6 w-6 items-center justify-center rounded-full transition " + actionBtnCls}
                                title="Reply"
                                aria-label="Reply"
                            >
                                <CornerUpLeft size={14} className="block shrink-0" />
                            </button>

                            <div className="relative flex h-5 items-center leading-none">
                                <button
                                    ref={reactionButtonRef}
                                    type="button"
                                    onClick={() => {
                                        if (!openReactions) updateReactionMenuPos();
                                        setOpenReactions((v) => !v);
                                    }}
                                    className={"flex h-6 w-6 items-center justify-center rounded-full transition " + actionBtnCls}
                                    title="React"
                                    aria-label="React"
                                >
                                    <Smile size={14} className="block shrink-0" />
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
                                            <div className={`px-2.5 pt-2 pb-2 border-b ${isLight ? "border-[#D8D0D0]" : "border-[#484848]"}`}>
                                                <div className={`mb-1.5 text-[11px] font-semibold ${isLight ? "text-black/55" : "text-[#D9DEE4]"}`}>
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
                                                                        ? "bg-[#5286F6]/18 ring-1 ring-[#5286F6]/65"
                                                                        : isLight ? "hover:bg-[#E8E8E8]" : "hover:bg-[#3A3A3A]")
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
                                                <EmojiPickerPopover
                                                    theme={isLight ? "light" : "dark"}
                                                    onPick={(native) => {
                                                        onToggleReaction(msg.id, native);
                                                        setOpenReactions(false);
                                                    }}
                                                />
                                            </div>
                                        </div>,
                                        renderDocument.body,
                                    )}
                            </div>

                            {canEdit && (
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
                            )}

                            {(canEdit || canModerate) && (
                                <button
                                    type="button"
                                    onClick={doDelete}
                                    className={
                                        "inline-flex h-5 w-5 items-center justify-center leading-none transition " +
                                        dangerBtnCls
                                    }
                                    title={canEdit ? "Delete" : "Delete message (moderator)"}
                                    aria-label={canEdit ? "Delete message" : "Delete message as moderator"}
                                >
                                    <Trash2 size={14} className="block shrink-0" />
                                </button>
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
                    <div className="mt-1 pr-1">
                        <div
                            className={
                                "rounded-xl border px-2.5 pb-1.5 pt-2 transition focus-within:border-[#5286F6] focus-within:ring-2 focus-within:ring-[#5286F6]/15 " +
                                (isLight ? "border-[#D8D0D0] bg-white" : "border-[#484848] bg-[#232323]")
                            }
                        >
                            <textarea
                                ref={editTextareaRef}
                                className={
                                    "block max-h-[180px] min-h-[20px] w-full resize-none bg-transparent text-[13px] leading-[18px] outline-none " +
                                    (isLight ? "text-black/85 placeholder:text-black/35" : "text-[#F4F5F6] placeholder:text-[#8D96A1]")
                                }
                                style={{ fieldSizing: "content" } as React.CSSProperties}
                                rows={1}
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        void saveEdit();
                                    }
                                    if (e.key === "Escape") {
                                        // Escape closes an open emoji picker first.
                                        if (editEmojiOpen) setEditEmojiOpen(false);
                                        else cancelEdit();
                                    }
                                }}
                                aria-label="Edit message"
                                autoFocus
                            />
                            <div className="mt-1.5 flex items-center gap-1">
                                <button
                                    ref={editEmojiButtonRef}
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => setEditEmojiOpen((current) => !current)}
                                    aria-expanded={editEmojiOpen}
                                    className={
                                        "grid h-7 w-7 place-items-center rounded-lg transition " +
                                        (isLight ? "text-black/45 hover:bg-black/[0.06] hover:text-black/75" : "text-[#AEB6C0] hover:bg-white/10 hover:text-white")
                                    }
                                    disabled={savingEdit}
                                    title="Add emoji"
                                    aria-label="Add emoji while editing"
                                >
                                    <Smile size={16} />
                                </button>
                                <span className="flex-1" />
                                <button
                                    type="button"
                                    onClick={cancelEdit}
                                    className={
                                        "h-7 rounded-lg px-2.5 text-[12px] font-medium transition " +
                                        (isLight ? "text-black/60 hover:bg-black/[0.06] hover:text-black/85" : "text-[#C6CDD5] hover:bg-white/10 hover:text-white")
                                    }
                                    disabled={savingEdit}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void saveEdit()}
                                    className="inline-flex h-7 items-center rounded-lg bg-[#5286F6] px-3 text-[12px] font-semibold text-white transition hover:bg-[#6B98FA] disabled:cursor-not-allowed disabled:opacity-40"
                                    disabled={savingEdit || !draft.trim()}
                                >
                                    {savingEdit ? "Saving…" : "Save"}
                                </button>
                            </div>
                        </div>
                        {editEmojiOpen &&
                            editEmojiPos &&
                            createPortal(
                                <div
                                    ref={editEmojiMenuRef}
                                    className={
                                        "fixed z-[99999] overflow-hidden rounded-2xl border shadow-xl " +
                                        (isLight ? "border-[#D8D0D0] bg-[#F3F1F1]" : "border-[#484848] bg-[#292D32]")
                                    }
                                    style={{
                                        top: editEmojiPos.top,
                                        left: editEmojiPos.left,
                                        width: editEmojiPos.width,
                                        maxHeight: editEmojiPos.height,
                                    }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    <EmojiPickerPopover
                                        theme={isLight ? "light" : "dark"}
                                        onPick={insertEmojiToEdit}
                                    />
                                </div>,
                                renderDocument.body,
                            )}
                        <div className={"mt-1 px-0.5 text-[11px] " + (isLight ? "text-black/40" : "text-[#8D96A1]")}>
                            Enter to save · Esc to cancel · Shift+Enter for a new line
                        </div>
                    </div>
                )}

                {hasReactions && !isEditing && (
                    <div
                        className={
                            "mt-1 flex flex-wrap gap-1.5 " +
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
                                        (isMine ? reactionPillMine : reactionPillOthers) +
                                        (reaction.exiting
                                            ? " pointer-events-none opacity-0 scale-90 translate-y-0.5"
                                            : " opacity-100")
                                    }
                                    onClick={() => onToggleReaction(msg.id, emoji)}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        onHoverReaction?.(msg.id, emoji, null);
                                        onOpenReactionDetails(msg.id, emoji);
                                    }}
                                    onMouseEnter={(e) => onHoverReaction?.(msg.id, emoji, e.currentTarget)}
                                    onMouseLeave={() => onHoverReaction?.(msg.id, emoji, null)}
                                    onFocus={(e) => onHoverReaction?.(msg.id, emoji, e.currentTarget)}
                                    onBlur={() => onHoverReaction?.(msg.id, emoji, null)}
                                    aria-pressed={isMine}
                                    aria-label={isMine ? `Remove your ${emoji} reaction` : `React with ${emoji}`}
                                >
                                    <span className="text-[14px] leading-none text-black opacity-100">{emoji}</span>
                                    <span className={reactionCountCls + (isMine ? " text-white" : isLight ? " text-black/60" : " text-[#C6CDD5]")}>{reaction.count}</span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {mine && (
                <img
                    src={avatarFromProfile(msg.profile, isLight)}
                    {...profileHoverAttrs(msg.user_id, msg.profile?.full_name)}
                    className="h-[31px] w-[31px] rounded-full object-cover"
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
        prev.canModerate === next.canModerate &&
        prev.onReply === next.onReply &&
        prev.onToggleReaction === next.onToggleReaction &&
        prev.onOpenReactionDetails === next.onOpenReactionDetails &&
        prev.onHoverReaction === next.onHoverReaction &&
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
    generalChatDisabled = false,
    canModerateMessages = false,
    currentUserId = null,
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
    generalChatDisabled?: boolean;
    /** Super-admin, host, temporary host or session moderator: may delete others' public messages. */
    canModerateMessages?: boolean;
    currentUserId?: string | null;
    renderDocument?: Document | null;
    renderWindow?: Window | null;
}) {
    const isLight = theme === "light";
    const chatDocument = renderDocument || document;
    const chatWindow = renderWindow || window;

    const [userId, setUserId] = useState<string | null>(currentUserId);
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
                    full_name: prev[normalizedId]?.full_name || hostProfileOverride.full_name,
                    avatar_url: prev[normalizedId]?.avatar_url || hostProfileOverride.avatar_url,
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
    const [profileLoadFailed, setProfileLoadFailed] = useState(false);
    const failedProfileIdsRef = useRef(new Set<string>());
    const profileLoader = useMemo(() => ({
        scope: `${sessionId}|${userId || "anon"}`,
        ...createChatProfileLoader(async (ids) => {
            const { data, error } = await withTimeout(Promise.resolve(supabase
                .from("profiles").select("id, full_name, avatar_url").in("id", ids)),
                6_000, "chat profiles timeout");
            if (error) throw error;
            return (data || []) as Profile[];
        }),
    }), [sessionId, userId]);
    const profileLoaderRef = useRef(profileLoader);
    useLayoutEffect(() => {
        profileLoaderRef.current = profileLoader;
        failedProfileIdsRef.current.clear();
        setProfileLoadFailed(false);
    }, [profileLoader]);
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
    const [readReceiptReady, setReadReceiptReady] = useState(false);
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
            // Kept in localStorage so receipts survive closing the chat or the tab
            // (older builds used sessionStorage; read that once as a fallback).
            const raw =
                window.localStorage.getItem(readReceiptStorageKey) ||
                window.sessionStorage.getItem(readReceiptStorageKey);
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
    }, [readReceiptStorageKey]);

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

                const entries = Object.entries(next);
                const capped =
                    entries.length > CHAT_READ_RECEIPT_MAX_MESSAGES
                        ? Object.fromEntries(entries.slice(-CHAT_READ_RECEIPT_MAX_MESSAGES))
                        : next;

                if (readReceiptStorageKey) {
                    try {
                        window.localStorage.setItem(readReceiptStorageKey, JSON.stringify(capped));
                    } catch { }
                }

                return capped;
            });
        },
        [readReceiptStorageKey],
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
    const textForDictationRef = useRef(text);
    textForDictationRef.current = text;
    const dictation = useSpeechDictation({
        win: chatWindow,
        getText: () => textForDictationRef.current,
        setText,
    });

    const [loading, setLoading] = useState(true);
    const [hasOlderMessages, setHasOlderMessages] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const olderLoadingRef = useRef(false);
    const historyScrollAnchorRef = useRef<{ requestId: number; height: number; top: number } | null>(null);
    const messageRevisionRef = useRef(0);
    const messageChangesRef = useRef(new Map<string, number>());
    const noteMessageChange = useLatestCallback((id: string) => {
        messageChangesRef.current.set(id, ++messageRevisionRef.current);
        if (messageChangesRef.current.size > CHAT_WINDOW_LIMIT * 2) {
            messageChangesRef.current.delete(messageChangesRef.current.keys().next().value!);
        }
    });
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
    const queuedReactionMessageIdsRef = useRef(new Set<string>());

    const lastReactionsLoadKeyRef = useRef("");
    const lastReactionsLoadAtRef = useRef(0);

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
    const generalChatLocked = activeMode === "general" && generalChatDisabled;

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

    const messageQueryPeerId = activeMode === "direct" ? activeDirectPeerId : null;
    const activeViewKey = `${sessionId}|${activeMode}|${messageQueryPeerId || ""}`;
    const newestMessageId = messages[messages.length - 1]?.id || "";
    const chatCacheKey = `${activeViewKey}|${userId || "anon"}`;
    const latestChatViewRef = useRef(chatCacheKey);
    useLayoutEffect(() => { latestChatViewRef.current = chatCacheKey; }, [chatCacheKey]);

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
            .on(
                "broadcast",
                { event: CHAT_READ_RECEIPT_REQUEST_EVENT },
                (payload: any) => {
                    const data = payload?.payload || payload || {};
                    const requesterUserId = String(data?.requesterUserId || "").trim();
                    if (!requesterUserId || requesterUserId === userId) return;

                    // Answer with the requester's messages this user has already read.
                    const messageIds = messagesRef.current
                        .filter(
                            (message) =>
                                message.user_id === requesterUserId &&
                                reportedReadIdsRef.current.has(message.id),
                        )
                        .map((message) => message.id);
                    if (!messageIds.length) return;

                    // Spread the replies out so a busy room does not answer at once.
                    window.setTimeout(() => {
                        if (!readReceiptReadyRef.current) return;
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
                                    at: Date.now(),
                                },
                            });
                        } catch { }
                    }, 150 + Math.random() * 650);
                },
            )
            .subscribe((status: string) => {
                readReceiptReadyRef.current = status === "SUBSCRIBED";
                setReadReceiptReady(status === "SUBSCRIBED");
            });

        readReceiptChannelRef.current = channel;

        return () => {
            readReceiptReadyRef.current = false;
            setReadReceiptReady(false);
            readReceiptChannelRef.current = null;
            void supabase.removeChannel(channel);
        };
    }, [sessionId, userId, rememberMessageReaders]);

    // Once this view has my messages loaded, ask the room who has read them.
    const requestedReadReceiptsRef = useRef("");
    const hasOwnMessages = messages.some(
        (message) => message.user_id === userId && !String(message.id).startsWith("optimistic-"),
    );
    useEffect(() => {
        if (!readReceiptReady || !hasOwnMessages || !userId) return;
        const key = `${activeViewKey}|${userId}`;
        if (requestedReadReceiptsRef.current === key) return;
        const channel = readReceiptChannelRef.current;
        if (!channel) return;
        requestedReadReceiptsRef.current = key;
        try {
            void channel.send({
                type: "broadcast",
                event: CHAT_READ_RECEIPT_REQUEST_EVENT,
                payload: { requesterUserId: userId, at: Date.now() },
            });
        } catch { }
    }, [readReceiptReady, hasOwnMessages, activeViewKey, userId]);

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

    const hydrateChatView = useLatestCallback(() => {
        if (!sessionId) return;

        // Invalidate reads before switching room, account or DM thread.
        messagesReqIdRef.current += 1;
        reactionsReqIdRef.current += 1;
        loadingMessagesRef.current = false;
        loadingReactionsRef.current = false;
        queuedMessagesReloadRef.current = false;
        queuedReactionsReloadRef.current = false;
        queuedReactionMessageIdsRef.current.clear();
        olderLoadingRef.current = false;
        historyScrollAnchorRef.current = null;
        setLoadingOlder(false);
        messageChangesRef.current.clear();
        const cached = CHAT_CACHE.read(chatCacheKey);
        if (cached) {
            profileLoader.seed(cached.confirmedProfiles || {});
            messagesRef.current = cached.messages || [];
            profilesByIdRef.current = cached.profilesById || {};
            meProfileRef.current = cached.meProfile || null;

            setMessages(cached.messages || []);
            setReactions(cached.reactions || {});
            setMyReactions(cached.myReactions || {});
            setProfilesById(cached.profilesById || {});
            setMeProfile(cached.meProfile || null);
            if (!hostUserIdOverride) setHostUserId(cached.hostUserId || null);
            setDirectPeerIds(cached.directPeerIds || []);
            setLoading(false);
            setHasOlderMessages((cached.messages?.length || 0) >= CHAT_PAGE_SIZE);
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
            setHasOlderMessages(false);
        }
    });
    useEffect(hydrateChatView, [chatCacheKey, hydrateChatView]);

    useEffect(() => {
        if (!sessionId) return;
        // A view hydration effect has scheduled a new state; don't cache the
        // previous thread's reactions/profile state under the new thread key.
        if (messages !== messagesRef.current) return;
        setChatCache(chatCacheKey, {
            ts: Date.now(),
            messages: messagesRef.current,
            reactions,
            myReactions,
            profilesById: profilesByIdRef.current,
            confirmedProfiles: profileLoader.snapshot(),
            meProfile: meProfileRef.current,
            hostUserId,
            directPeerIds,
        });
    }, [
        sessionId,
        chatCacheKey,
        messages,
        reactions,
        myReactions,
        profilesById,
        profileLoader,
        meProfile,
        hostUserId,
        directPeerIds,
    ]);

    useEffect(() => {
        onBecameVisible?.();
        setUnseenNew(0);
    }, [onBecameVisible, sessionId, activeMode, activeDirectPeerId]);

    const headerBorder = isLight ? "border-[#D8D0D0]" : "border-[#464D54]";
    const titleText = isLight ? "text-black/85" : "text-[#F4F5F6]";
    const subText = isLight ? "text-black/50" : "text-[#B5BCC6]";
    const headerCloseBtnCls = isLight ? "bg-[#ECEAEA] hover:bg-[#DCDCDC] text-black/60" : "bg-[#353B42] hover:bg-[#444B53] text-[#D9DEE4]";
    const replyBoxCls = isLight ? "bg-[#ECEAEA] border-[#D8D0D0]" : "bg-[#292929] border-[#484848]";
    const replyingLabel = `text-[11px] font-medium ${isLight ? "text-[#315DCB]" : "text-[#6B98FA]"}`;
    const replyingText = isLight ? "text-black/55" : "text-[#C6CDD5]";
    const cancelBtnCls = isLight ? "bg-[#ECEAEA] hover:bg-[#DCDCDC] text-black/60" : "bg-[#353B42] hover:bg-[#444B53] text-[#D9DEE4]";
    const hintText = isLight ? "text-black/40" : "text-[#B5BCC6]";
    const sendBtnActive = "bg-[#5286F6] hover:bg-[#6B98FA] text-white";
    const sendBtnDisabled = isLight ? "text-black/30" : "text-[#AEB6BF]/50";
    const composerInputCls =
        "flex-1 min-w-0 min-h-[36px] max-h-[140px] rounded-[10px] resize-none px-3 py-[7px] text-[13px] leading-5 outline-none focus:ring-1 focus:ring-[#5286F6] focus:border-[#5286F6] " +
        (isLight ? "bg-[#F3F1F1] border border-[#D8D0D0] text-black/85 placeholder:text-black/35" : "bg-[#292D32] border border-[#4C5259] text-[#F4F5F6] placeholder:text-[#ABB3BE]");
    // One bar for mic, emoji and send: same surface as the message field.
    const composerBarCls =
        "flex h-9 shrink-0 items-stretch overflow-hidden rounded-[10px] border " +
        (isLight ? "bg-[#F3F1F1] border-[#D8D0D0]" : "bg-[#292D32] border-[#4C5259]");
    const composerBarDividerCls = "my-2 w-px shrink-0 " + (isLight ? "bg-[#D8D0D0]" : "bg-[#4C5259]");
    const composerEmojiBtnCls =
        "w-8 self-stretch shrink-0 flex items-center justify-center transition disabled:opacity-40 " +
        (isLight ? "text-black/60 hover:bg-black/[0.05] hover:text-black/80" : "text-[#D9DEE4] hover:bg-white/[0.06] hover:text-white");
    const portalBoxCls =
        "rounded-2xl border shadow-2xl overflow-hidden " +
        (isLight ? "border-[#D8D0D0] bg-[#F3F1F1]" : "border-[#484848] bg-[#292929] text-[#F4F5F6]");

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const uid = currentUserId || (await supabase.auth.getUser()).data.user?.id || null;
            if (!aliveRef.current || cancelled) return;
            setUserId(uid);
        })();
        return () => { cancelled = true; };
    }, [currentUserId]);

    useEffect(() => {
        if (!sessionId || hostUserIdOverride) return;
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
    }, [sessionId, hostUserIdOverride]);

    const ensureProfiles = useLatestCallback(async (userIds: string[]) => {
        const unique = Array.from(new Set(userIds)).filter(Boolean);
        const loader = profileLoader;
        const confirmed = loader.snapshot();
        if (unique.every((id) => confirmed[id] && confirmed[id] === profilesByIdRef.current[id])) return;
        let map: Record<string, Profile>;
        try {
            map = await loader.ensure(unique);
        } catch (error) {
            if (!aliveRef.current || loader !== profileLoaderRef.current) return;
            console.error("profiles load error:", error);
            map = loader.snapshot();
            unique.filter((id) => !map[id]).forEach((id) => failedProfileIdsRef.current.add(id));
        }
        if (!aliveRef.current || loader !== profileLoaderRef.current) return;
        Object.keys(map).forEach((id) => failedProfileIdsRef.current.delete(id));
        setProfileLoadFailed(failedProfileIdsRef.current.size > 0);
        profilesByIdRef.current = { ...profilesByIdRef.current, ...map };
        setProfilesById((prev) => ({ ...prev, ...map }));
    });

    useEffect(() => {
        let cancelled = false;
        if (userId) void ensureProfiles([userId]).then(() => {
            if (cancelled || !aliveRef.current) return;
            const profile = profilesByIdRef.current[userId];
            if (profile) {
                meProfileRef.current = profile;
                setMeProfile(profile);
            }
        });
        return () => { cancelled = true; };
    }, [userId, profileLoader, ensureProfiles]);

    useEffect(() => {
        if (!messagesRef.current.length) return;

        setMessages((prev) => {
            let changed = false;
            const next = prev.map((m) => {
                const nextProfile =
                    profilesByIdRef.current[m.user_id] ||
                    (m.user_id === userId ? meProfileRef.current : null) ||
                    m.profile ||
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
            const reactedAt = Object.fromEntries(rows.map((r) => [r.user_id, r.created_at] as const));
            await ensureProfiles(ids);
            if (!aliveRef.current) return;

            setReactionDetails((prev) => ({
                ...prev,
                open: true,
                loading: false,
                error: null,
                userIds: ids,
                reactedAt,
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
                .eq("scope", "direct")
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

    // General chat does not depend on host discovery/lease changes.
    const messageQueryHostId = activeMode === "direct" ? hostUserId : null;
    const loadMessages = useCallback(
        async (opts?: { silent?: boolean }): Promise<Msg[] | null> => {
            if (!sessionId) return null;

            if (loadingMessagesRef.current) {
                queuedMessagesReloadRef.current = true;
                return null;
            }

            loadingMessagesRef.current = true;
            const reqId = ++messagesReqIdRef.current;
            const revision = messageRevisionRef.current;

            if (!opts?.silent) setLoading(true);

            try {
                const q = buildMessageQuery(
                    sessionId,
                    activeMode,
                    userId,
                    messageQueryHostId,
                    messageQueryPeerId,
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
                // Resolve the real author name and avatar URL before painting.
                // The image itself downloads independently; it never gates chat.
                await ensureProfiles(safeRows.flatMap((row) =>
                    [row.user_id, String(row.dm_peer_user_id || "")]).filter(Boolean));
                if (!aliveRef.current || reqId !== messagesReqIdRef.current) return null;
                const attached = safeRows.map((r) => attachProfile(r));
                const changed = new Set([...messageChangesRef.current]
                    .filter(([, version]) => version > revision).map(([id]) => id));
                const next = reconcileChatSnapshot(attached, messagesRef.current, changed);
                messagesRef.current = next;
                setMessages(next);
                setHasOlderMessages(safeRows.length === CHAT_PAGE_SIZE);
                return messagesRef.current;
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
                if (aliveRef.current && reqId === messagesReqIdRef.current) {
                    loadingMessagesRef.current = false;
                    if (queuedMessagesReloadRef.current) {
                        queuedMessagesReloadRef.current = false;
                        void loadMessages({ silent: true });
                    }
                }
            }
        },
        [
            sessionId,
            activeMode,
            userId,
            messageQueryHostId,
            messageQueryPeerId,
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

            const msgIdsRaw =
                opts?.messageIds && opts.messageIds.length > 0
                    ? opts.messageIds
                    : getRecentMessageIdsForReactions();
            const msgIds = normalizeReactionMessageIds(msgIdsRaw);

            if (loadingReactionsRef.current) {
                queuedReactionsReloadRef.current = true;
                msgIds.forEach((id) => queuedReactionMessageIdsRef.current.add(id));
                return;
            }

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

                // Replace only this page's counts; keep loaded older pages.
                const mergePage = <T,>(previous: Record<string, T>, page: Record<string, T>) => {
                    const next = { ...previous };
                    msgIds.forEach((id) => delete next[id]);
                    return { ...next, ...page };
                };
                setReactions((previous) => mergePage(previous, counts));
                setMyReactions((previous) => mergePage(previous, mine));
            } catch (e) {
                console.warn("loadReactions failed:", e);
            } finally {
                if (aliveRef.current && reqId === reactionsReqIdRef.current) {
                    loadingReactionsRef.current = false;
                    if (queuedReactionsReloadRef.current) {
                        // Preserve the requested older page, not just recent IDs.
                        const messageIds = [...queuedReactionMessageIdsRef.current].slice(0, CHAT_PAGE_SIZE);
                        messageIds.forEach((id) => queuedReactionMessageIdsRef.current.delete(id));
                        queuedReactionsReloadRef.current = queuedReactionMessageIdsRef.current.size > 0;
                        void loadReactions({ silent: true, force: true, messageIds });
                    }
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

            const loaded = await loadMessages({ silent: opts?.silent });
            if (!aliveRef.current || latestChatViewRef.current !== chatCacheKey) return;
            const list = loaded ?? messagesRef.current;
            const ids = normalizeReactionMessageIds(list.map((m) => m.id));
            await loadReactions({
                silent: true,
                messageIds: ids,
                force: opts?.force,
            });
            if (latestChatViewRef.current === chatCacheKey) bootTsRef.current = now;
        },
        [sessionId, chatCacheKey, loadMessages, loadReactions],
    );

    useEffect(() => {
        if (!sessionId) return;
        void bootstrap({ silent: false, force: true });
    }, [sessionId, bootstrap]);

    // Bootstrap already depends on userId through both loaders, so a second
    // auth-triggered reactions effect would queue the same SELECT twice.
    const onMessageInsert = useLatestCallback(async (payload: any) => {
        const row = payload?.new as MsgRow | undefined;
        if (!row?.id) return;

        const relevant = messageBelongsToView(
            row,
            activeMode,
            userId,
            messageQueryHostId,
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
        noteMessageChange(row.id);
        const viewKey = chatCacheKey;
        const revision = messageChangesRef.current.get(row.id);
        await ensureProfiles(
            [row.user_id, String(row.dm_peer_user_id || "").trim()].filter(
                Boolean,
            ),
        );
        if (!aliveRef.current || latestChatViewRef.current !== viewKey ||
            messageChangesRef.current.get(row.id) !== revision) return;

        const beforeAtBottom = isAtBottom();
        atBottomRef.current = beforeAtBottom;

        setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;

            const idxOptimistic = prev.findIndex(
                (m) =>
                    m.id === `optimistic-${row.id}`,
            );

            const merged = attachProfile(row);
            let next: Msg[];
            if (idxOptimistic !== -1) {
                next = [...prev];
                next[idxOptimistic] = merged;
            } else {
                next = [...prev, merged];
            }

            const bounded = boundChatMessages(next);
            messagesRef.current = bounded;
            return bounded;
        });

        if (!beforeAtBottom && row.user_id !== userId) {
            setUnseenNew((n) => Math.min(99, n + 1));
        }
    });

    const onMessageUpdate = useLatestCallback(async (payload: any) => {
        const row = payload?.new as MsgRow | undefined;
        if (!row?.id) return;
        noteMessageChange(row.id);
        const viewKey = chatCacheKey;
        const revision = messageChangesRef.current.get(row.id);
        const relevant = messageBelongsToView(
            row,
            activeMode,
            userId,
            messageQueryHostId,
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
        if (!aliveRef.current || latestChatViewRef.current !== viewKey ||
            messageChangesRef.current.get(row.id) !== revision) return;

        setMessages((prev) => {
            const exists = prev.some((m) => m.id === row.id);
            const mapped = attachProfile(row);
            const next = exists
                ? prev.map((m) => (m.id === row.id ? mapped : m))
                : [...prev, mapped];
            const bounded = boundChatMessages(next);
            messagesRef.current = bounded;
            return bounded;
        });
    });

    const onMessageDelete = useLatestCallback((payload: any) => {
        const deletedId = payload?.old?.id as string | undefined;
        if (!deletedId) return;
        noteMessageChange(deletedId);

        setMessages((prev) => {
            const next = prev.filter((m) => m.id !== deletedId);
            const bounded = boundChatMessages(next);
            messagesRef.current = bounded;
            return bounded;
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
    });

    const refreshChat = useLatestCallback(() => {
        if (!loadingMessagesRef.current) void bootstrap({ silent: true, force: true });
    });
    useEffect(() => {
        if (!sessionId) return;
        let disposed = false;
        let subscribed = false;
        const channel = supabase.channel(`chat:${sessionId}`);
        channel.on("postgres_changes",
            { event: "INSERT", schema: "public", table: MSG_TABLE, filter: `session_id=eq.${sessionId}` },
            onMessageInsert);
        channel.on("postgres_changes",
            { event: "UPDATE", schema: "public", table: MSG_TABLE, filter: `session_id=eq.${sessionId}` },
            onMessageUpdate);
        channel.on("postgres_changes",
            { event: "DELETE", schema: "public", table: MSG_TABLE, filter: `session_id=eq.${sessionId}` },
            onMessageDelete);
        channel.subscribe((status) => {
            if (disposed) return;
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                // Fallback only while Realtime is unavailable, never healthy rooms.
                if (!pollingRef.current) {
                    pollingRef.current = chatWindow.setInterval(() => {
                        if (chatDocument.visibilityState !== "hidden" && chatWindow.navigator.onLine) refreshChat();
                    }, 15_000);
                }
            } else if (status === "SUBSCRIBED") {
                if (pollingRef.current) chatWindow.clearInterval(pollingRef.current);
                pollingRef.current = null;
                if (subscribed) refreshChat();
                subscribed = true;
            }
        });
        return () => {
            disposed = true;
            if (pollingRef.current) chatWindow.clearInterval(pollingRef.current);
            pollingRef.current = null;
            void supabase.removeChannel(channel);
        };
    }, [sessionId, userId, chatWindow, chatDocument, onMessageInsert, onMessageUpdate, onMessageDelete, refreshChat]);

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

                    const messageId = String(n?.message_id || o?.message_id || "");
                    if (!messagesRef.current.some((message) => message.id === messageId)) return;
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
        const historyAnchor = historyScrollAnchorRef.current;
        if (historyAnchor && historyAnchor.requestId === messagesReqIdRef.current && listRef.current) {
            historyScrollAnchorRef.current = null;
            listRef.current.scrollTop = historyAnchor.top + listRef.current.scrollHeight - historyAnchor.height;
            atBottomRef.current = false;
            return;
        }
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
        if (generalChatLocked) return;
        const raw = text.trim();
        if (!raw || !userId || !sessionId) return;
        // Sending ends dictation, so late words do not land in the next message.
        dictation.stop({ discard: true });

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
            id: `optimistic-${crypto.randomUUID()}`,
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
        const sendViewKey = chatCacheKey;

        atBottomRef.current = true;
        noteMessageChange(optimistic.id);
        setMessages((prev) => {
            const next = boundChatMessages([...prev, optimistic]);
            messagesRef.current = next;
            return next;
        });

        setText("");
        setComposerEmojiOpen(false);
        setReplyTo(null);

        const { data: confirmed, error } = await Promise.resolve(supabase.from(MSG_TABLE).insert({
            id: optimistic.id.slice("optimistic-".length),
            session_id: sessionId,
            user_id: userId,
            body: composed,
            created_at: new Date().toISOString(),
            scope: outgoingScope,
            dm_peer_user_id: outgoingPeerId,
        }).select("id,session_id,user_id,body,created_at,scope,dm_peer_user_id").single())
            .catch((error: unknown) => ({ data: null, error }));

        if (!aliveRef.current || latestChatViewRef.current !== sendViewKey) return;
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

        if (confirmed) void onMessageInsert({ new: confirmed });
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
        const editViewKey = chatCacheKey;
        noteMessageChange(messageId);
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

        if (error && aliveRef.current && latestChatViewRef.current === editViewKey) {
            console.error("chat update error:", error);
            if (prevBody !== null) {
                setMessages((prev) => {
                    const next = prev.map((m) =>
                        m.id === messageId && m.body === newBody ? { ...m, body: prevBody } : m,
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
        const deleteViewKey = chatCacheKey;
        const deleted = messagesRef.current.find((message) => message.id === messageId);
        noteMessageChange(messageId);

        setMessages((prev) => {
            const next = prev.filter((m) => m.id !== messageId);
            messagesRef.current = next;
            return next;
        });

        // Own messages use the existing row policy; a moderator removing someone
        // else's public message goes through a server function that checks
        // the role (super-admin, host, temporary host or session moderator).
        const moderating = !!deleted && deleted.user_id !== userId;
        const { error } = moderating
            ? await supabase.rpc("moderate_delete_chat_message", { p_message_id: messageId })
            : await supabase
                .from(MSG_TABLE)
                .delete()
                .eq("id", messageId)
                .eq("session_id", sessionId)
                .eq("user_id", userId);

        if (error && deleted && aliveRef.current && latestChatViewRef.current === deleteViewKey) {
            console.error("chat delete error:", error);
            if (moderating) {
                try {
                    chatWindow.alert("This message could not be deleted. Please try again.");
                } catch {
                    // Alerts can be blocked in a PiP window; the message is restored either way.
                }
            }
            setMessages((current) => {
                const next = boundChatMessages([deleted, ...current]);
                messagesRef.current = next;
                return next;
            });
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


    const loadOlderMessages = async () => {
        if (olderLoadingRef.current || !hasOlderMessages || messagesRef.current.length >= CHAT_WINDOW_LIMIT) return;
        const oldest = messagesRef.current.find((message) => !message.id.startsWith("optimistic-"));
        if (!oldest) return;
        olderLoadingRef.current = true;
        setLoadingOlder(true);
        const requestId = messagesReqIdRef.current;
        const revision = messageRevisionRef.current;
        const list = listRef.current;
        const previousHeight = list?.scrollHeight || 0;
        const previousTop = list?.scrollTop || 0;
        try {
            const query = buildMessageQuery(sessionId, activeMode, userId, hostUserId, activeDirectPeerId)
                .or(`created_at.lt.${oldest.created_at},and(created_at.eq.${oldest.created_at},id.lt.${oldest.id})`);
            const { data, error } = await withTimeout(Promise.resolve(query), 12_000, "older messages timeout");
            if (!aliveRef.current || requestId !== messagesReqIdRef.current) return;
            if (error) throw error;
            const rows = ((data || []) as MsgRow[]).reverse();
            await ensureProfiles(rows.map((row) => row.user_id));
            if (!aliveRef.current || requestId !== messagesReqIdRef.current) return;
            // A deletion while this page was loading must not be resurrected.
            const currentIds = new Set(messagesRef.current.map((message) => message.id));
            const page = rows.filter((row) =>
                (messageChangesRef.current.get(row.id) || 0) <= revision || currentIds.has(row.id));
            const next = boundChatMessages([...page.map(attachProfile), ...messagesRef.current]);
            if (list) historyScrollAnchorRef.current = { requestId, height: previousHeight, top: previousTop };
            messagesRef.current = next;
            setMessages(next);
            setHasOlderMessages(rows.length === CHAT_PAGE_SIZE);
            void loadReactions({ messageIds: rows.map((row) => row.id), force: true });
        } catch (error) {
            console.warn("chat history load failed:", error);
        } finally {
            if (requestId === messagesReqIdRef.current && aliveRef.current) {
                olderLoadingRef.current = false;
                setLoadingOlder(false);
            }
        }
    };
    const onReplyMessage = useLatestCallback((msg: Msg) => {
        setReplyTo(msg);
        chatWindow.requestAnimationFrame(() => {
            const composer = composerRef.current;
            if (!composer || composer.disabled) return;
            composer.focus();
            const end = composer.value.length;
            try { composer.setSelectionRange(end, end); } catch { }
        });
    });
    const onToggleMessageReaction = useLatestCallback(toggleReaction);
    const onOpenMessageReactionDetails = useLatestCallback(loadReactionDetails);

    // Hovering a reaction shows who reacted ("Maya and Priya reacted with 🔥").
    // Names come from the same reactions table as the details window and are
    // cached per message, emoji and count, so a repeat hover is instant.
    const [hoverReaction, setHoverReaction] = useState<{
        messageId: string;
        emoji: string;
        left: number;
        top: number;
        userIds: string[] | null;
    } | null>(null);
    const hoverReactionTimerRef = useRef<number | null>(null);
    const reactorsCacheRef = useRef(new Map<string, string[]>());
    const showReactors = async (messageId: string, emoji: string, anchor: HTMLElement) => {
        const rect = anchor.getBoundingClientRect();
        const count = reactions[messageId]?.[emoji] ?? 0;
        const cacheKey = `${messageId}|${emoji}|${count}`;
        const cached = reactorsCacheRef.current.get(cacheKey) || null;
        setHoverReaction({ messageId, emoji, left: rect.left + rect.width / 2, top: rect.top, userIds: cached });
        if (cached || !sessionId) return;
        try {
            const { data } = await supabase
                .from(REACTIONS_TABLE)
                .select("user_id, created_at")
                .eq("session_id", sessionId)
                .eq("message_id", messageId)
                .eq("emoji", emoji)
                .order("created_at", { ascending: true })
                .limit(50);
            const ids = ((data as any[]) || []).map((row) => String(row.user_id || "")).filter(Boolean);
            await ensureProfiles(ids);
            if (!aliveRef.current) return;
            reactorsCacheRef.current.set(cacheKey, ids);
            setHoverReaction((current) =>
                current && current.messageId === messageId && current.emoji === emoji
                    ? { ...current, userIds: ids }
                    : current,
            );
        } catch {
            // The popover just keeps "Loading…"; right-click still opens the full list.
        }
    };
    const hoverMessageReaction = (messageId: string, emoji: string, anchor: HTMLElement | null) => {
        if (hoverReactionTimerRef.current) chatWindow.clearTimeout(hoverReactionTimerRef.current);
        hoverReactionTimerRef.current = null;
        if (!anchor) {
            setHoverReaction(null);
            return;
        }
        hoverReactionTimerRef.current = chatWindow.setTimeout(() => void showReactors(messageId, emoji, anchor), 250);
    };
    const onHoverMessageReaction = useLatestCallback(hoverMessageReaction);
    const onUpdateChatMessage = useLatestCallback(updateMessage);
    const onDeleteChatMessage = useLatestCallback(deleteMessage);
    const visibleMessages = useMemo(
        () => messages.slice(-VISIBLE_MESSAGE_LIMIT),
        [messages],
    );

    useEffect(() => {
        const retainedIds = new Set(messages.map((message) => message.id));
        const prune = <T,>(previous: Record<string, T>) => {
            const keys = Object.keys(previous);
            if (keys.every((id) => retainedIds.has(id))) return previous;
            return Object.fromEntries(keys.filter((id) => retainedIds.has(id)).map((id) => [id, previous[id]]));
        };
        setReactions(prune);
        setMyReactions(prune);
        // Read receipts are not pruned: they belong to messages that may only be
        // out of view (another chat tab, or not loaded yet) and are capped in
        // rememberMessageReaders instead.
        reportedReadIdsRef.current = new Set([...reportedReadIdsRef.current].filter((id) => retainedIds.has(id)));
    }, [messages]);

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
    const modalTextPrimary = isLight ? "text-black/85" : "text-[#F4F5F6]";
    const modalTextSecondary = isLight ? "text-black/55" : "text-[#B5BCC6]";
    const canToggleInModal =
        !!reactionDetails.open &&
        !!reactionDetails.messageId &&
        !!reactionDetails.emoji;
    // Every reaction on the open message, by count.
    const modalReactionTabs = reactionDetails.open
        ? Object.entries(reactions[reactionDetails.messageId] || {})
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1])
        : [];
    const myReactedInModal =
        canToggleInModal &&
        !!myReactions?.[reactionDetails.messageId]?.[reactionDetails.emoji];

    // Who reacted: their avatars, stacked, above the hovered reaction.
    const reactorsPopover = hoverReaction
        ? (() => {
            const ids = hoverReaction.userIds;
            const shown = (ids || []).slice(0, 6);
            const more = (ids || []).length - shown.length;
            return createPortal(
                <div
                    className="pointer-events-none fixed z-[10000] w-max -translate-x-1/2 -translate-y-full pb-2 animate-[fadeIn_140ms_ease-out]"
                    style={{ left: Math.min(Math.max(hoverReaction.left, 150), chatWindow.innerWidth - 150), top: hoverReaction.top }}
                    role="tooltip"
                >
                    <div
                        className={
                            "flex max-w-[280px] items-center rounded-full border p-1 shadow-[0_10px_30px_rgba(0,0,0,0.16)] " +
                            (isLight ? "border-[#D8D0D0] bg-[#F7F5F5]" : "border-[#343434] bg-[#232323]")
                        }
                    >
                        {ids === null ? (
                            <span className={"px-2 py-1 font-inter text-[12px] " + (isLight ? "text-black/50" : "text-[#AEB6C0]")}>Loading…</span>
                        ) : (
                            <div className="flex -space-x-1.5">
                                {shown.map((uid) => (
                                    <img
                                        key={uid}
                                        src={avatarFromProfile(profilesByIdRef.current[uid] || (uid === userId ? meProfileRef.current : null), isLight)}
                                        className={"h-6 w-6 rounded-full object-cover ring-2 " + (isLight ? "ring-[#F7F5F5]" : "ring-[#232323]")}
                                        alt=""
                                    />
                                ))}
                                {more > 0 ? (
                                    <span
                                        className={
                                            "flex h-6 min-w-6 items-center justify-center rounded-full px-1 font-inter text-[10px] ring-2 " +
                                            (isLight ? "bg-[#E6E4E4] text-black/60 ring-[#F7F5F5]" : "bg-[#303030] text-[#C6CDD5] ring-[#232323]")
                                        }
                                    >
                                        +{more}
                                    </span>
                                ) : null}
                            </div>
                        )}
                        {ids && ids.length > 0 ? (
                            <span className="ml-1.5 shrink-0 text-[13px] leading-none text-black opacity-100" aria-hidden="true">{hoverReaction.emoji}</span>
                        ) : null}
                        {ids && ids.length > 0 ? (
                            <span className={"ml-1 mr-2 truncate font-inter text-[11px] font-medium " + (isLight ? "text-black/75" : "text-[#E3E7EB]")}>
                                {shortNamesLabel(ids.map((uid) => (uid === userId ? "You" : profilesByIdRef.current[uid]?.full_name || "Participant")))}
                            </span>
                        ) : null}
                    </div>
                </div>,
                chatDocument.body,
            );
        })()
        : null;
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
                            <EmojiPickerPopover
                                theme={theme}
                                onPick={insertEmojiToComposer}
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
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 font-inter">
                    <div
                        className="session-booking-drawer-backdrop absolute inset-0 bg-black/40 backdrop-blur-[2px]"
                        onClick={closeReactionDetails}
                    />
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={`${reactionDetails.emoji} reactions`}
                        className={
                            "relative flex max-h-[82vh] w-full max-w-[380px] flex-col overflow-hidden rounded-[24px] border shadow-[0_28px_90px_rgba(0,0,0,0.28)] " +
                            (isLight ? "border-[#D8D0D0] bg-[#F3F1F1]" : "border-[#343434] bg-[#1B1B1B]")
                        }
                    >
                        {/* Header: the emoji, how many people, close */}
                        <div className="flex items-center gap-3 px-5 pb-3 pt-5">
                            <div
                                className={
                                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-[26px] leading-none " +
                                    (isLight ? "bg-white" : "bg-[#262626]")
                                }
                                aria-hidden="true"
                            >
                                {reactionDetails.emoji}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className={"text-[16px] font-semibold leading-5 " + modalTextPrimary}>
                                    Reactions
                                </div>
                                <div className={"mt-0.5 text-[12px] " + modalTextSecondary}>
                                    {reactionDetails.loading
                                        ? "Loading…"
                                        : `${reactionDetails.userIds.length} ${reactionDetails.userIds.length === 1 ? "person" : "people"} reacted with ${reactionDetails.emoji}`}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={closeReactionDetails}
                                className={
                                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] transition " +
                                    (isLight ? "bg-[#E6E6E6] text-black/60 hover:bg-[#DCDCDC]" : "bg-[#303030] text-[#D4D9DF] hover:bg-[#3A3A3A]")
                                }
                                title="Close"
                                aria-label="Close"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Every reaction on this message, to switch between them */}
                        {modalReactionTabs.length > 1 && (
                            <div className="flex flex-wrap gap-1.5 px-5 pb-3">
                                {modalReactionTabs.map(([emoji, count]) => {
                                    const active = emoji === reactionDetails.emoji;
                                    return (
                                        <button
                                            key={emoji}
                                            type="button"
                                            onClick={() => {
                                                if (!active) void loadReactionDetails(reactionDetails.messageId, emoji);
                                            }}
                                            className={
                                                "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] transition " +
                                                (active
                                                    ? "bg-[#5286F6] text-white"
                                                    : isLight
                                                        ? "bg-black/[0.06] text-black/60 hover:bg-black/[0.1]"
                                                        : "bg-white/[0.08] text-[#C6CDD5] hover:bg-white/[0.13]")
                                            }
                                            aria-pressed={active}
                                        >
                                            <span className="text-[15px] leading-none text-black opacity-100">{emoji}</span>
                                            <span className="tabular-nums">{count}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {/* The message that was reacted to */}
                        {modalMessage && (
                            <div
                                className={
                                    "mx-5 mb-3 flex items-start gap-2.5 rounded-2xl border px-3 py-2.5 " +
                                    (isLight ? "border-[#D8D0D0] bg-[#F7F5F5]" : "border-[#343434] bg-[#232323]")
                                }
                            >
                                <img
                                    src={avatarFromProfile(modalMessage.profile, isLight)}
                                    className="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover"
                                    alt=""
                                />
                                <div className="min-w-0 flex-1">
                                    <div className={"text-[12px] font-semibold " + modalTextPrimary}>
                                        {modalMessage.user_id === userId ? "You" : modalMessage.profile?.full_name || "Participant"}
                                    </div>
                                    <div className={"mt-0.5 line-clamp-2 text-[12px] leading-4 " + modalTextSecondary}>
                                        {collapseWs(modalMessageMain)}
                                    </div>
                                </div>
                            </div>
                        )}

                        {reactionDetails.error && (
                            <div className={"mx-5 mb-2 text-[12px] " + (isLight ? "text-red-700" : "text-red-300")}>
                                {reactionDetails.error}
                            </div>
                        )}

                        {/* Who reacted */}
                        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-3 pb-2">
                            {reactionDetails.loading ? (
                                <div className="flex items-center justify-center py-8">
                                    <div
                                        className={
                                            "h-6 w-6 animate-spin rounded-full border-2 " +
                                            (isLight ? "border-black/15 border-t-[#5286F6]" : "border-white/15 border-t-[#5286F6]")
                                        }
                                    />
                                </div>
                            ) : reactionDetails.userIds.length === 0 && !reactionDetails.error ? (
                                <div className={"py-8 text-center text-[13px] " + modalTextSecondary}>No reactions yet</div>
                            ) : (
                                reactionDetails.userIds.map((uid) => {
                                    const prof =
                                        profilesByIdRef.current[uid] ||
                                        (uid === userId ? meProfileRef.current : null) ||
                                        ({ id: uid, full_name: "Participant", avatar_url: null } as Profile);
                                    const isMe = uid === userId;
                                    const reactedAt = reactionDetails.reactedAt?.[uid];
                                    return (
                                        <div
                                            key={uid}
                                            className={
                                                "flex items-center gap-3 rounded-xl px-2 py-2 transition " +
                                                (isLight ? "hover:bg-black/[0.04]" : "hover:bg-white/[0.05]")
                                            }
                                        >
                                            <img
                                                src={avatarFromProfile(prof, isLight)}
                                                {...profileHoverAttrs(uid, prof?.full_name)}
                                                className="h-8 w-8 shrink-0 rounded-full object-cover"
                                                alt=""
                                            />
                                            <div
                                                className={
                                                    "min-w-0 flex-1 truncate text-[13px] font-semibold " +
                                                    (isMe ? (isLight ? "text-[#2F5FC4]" : "text-[#8FB0FA]") : modalTextPrimary)
                                                }
                                            >
                                                {isMe ? "You" : prof?.full_name || "Participant"}
                                            </div>
                                            {reactedAt ? (
                                                <div className={"shrink-0 text-[11px] tabular-nums " + modalTextSecondary}>
                                                    {formatTime(reactedAt)}
                                                </div>
                                            ) : null}
                                            <span className="shrink-0 text-[15px] leading-none" aria-hidden="true">
                                                {reactionDetails.emoji}
                                            </span>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {/* Add or remove your own */}
                        {canToggleInModal && (
                            <div className={"border-t p-3 " + (isLight ? "border-[#D8D0D0]" : "border-[#343434]")}>
                                <button
                                    type="button"
                                    className={
                                        "flex h-10 w-full items-center justify-center gap-2 rounded-xl text-[13px] font-semibold transition " +
                                        (myReactedInModal
                                            ? isLight
                                                ? "bg-[#E6E6E6] text-black/70 hover:bg-[#DCDCDC]"
                                                : "bg-[#303030] text-[#D4D9DF] hover:bg-[#3A3A3A]"
                                            : "bg-[#5286F6] text-white hover:bg-[#6B98FA]")
                                    }
                                    onClick={async () => {
                                        await toggleReaction(reactionDetails.messageId, reactionDetails.emoji);
                                        void loadReactionDetails(reactionDetails.messageId, reactionDetails.emoji);
                                    }}
                                >
                                    <span className="text-[15px] leading-none text-black opacity-100">{reactionDetails.emoji}</span>
                                    {myReactedInModal ? "Remove my reaction" : "React"}
                                </button>
                            </div>
                        )}
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
                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-3 space-y-2 custom-scrollbar relative"
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
                            (isLight ? "text-black/45" : "text-[#B5BCC6]") + " text-sm italic"
                        }
                    >
                        Loading…
                    </div>
                )}

                {profileLoadFailed && (
                    <div role="status" className="rounded-lg bg-black/5 px-3 py-2 text-xs text-black/60">
                        Some names and avatars couldn’t load.{' '}
                        <button type="button" className="underline font-medium hover:text-black"
                            onClick={() => void ensureProfiles([...failedProfileIdsRef.current])}>
                            Retry profiles
                        </button>
                    </div>
                )}

                {!loading && visibleMessages.length === 0 && (
                    <div
                        className={
                            (isLight ? "text-black/45" : "text-[#B5BCC6]") + " text-sm italic"
                        }
                    >
                        {activeMode === "general"
                            ? "No messages yet"
                            : isHost && !activeDirectPeerId
                                ? "Pick a participant to start a direct thread"
                                : "No direct messages yet"}
                    </div>
                )}

                {!loading && hasOlderMessages && messages.length < CHAT_WINDOW_LIMIT && (
                    <button type="button" disabled={loadingOlder} onClick={() => void loadOlderMessages()}
                        className="mx-auto block rounded-lg px-3 py-2 text-xs text-black/55 hover:bg-black/5 disabled:opacity-50">
                        {loadingOlder ? "Loading history…" : "Load older messages"}
                    </button>
                )}
                {messages.length >= CHAT_WINDOW_LIMIT && (
                    <p className="text-center text-[11px] text-black/40">Showing the latest {CHAT_WINDOW_LIMIT} loaded messages</p>
                )}
                {visibleMessages.map((m) => {
                    const mine = m.user_id === userId;
                    const canEdit = mine && !m.id.startsWith("optimistic-");
                    // Moderators remove others' public messages; direct messages stay private.
                    const canModerate = canModerateMessages && !mine && m.scope !== "direct" && !m.id.startsWith("optimistic-");
                    return (
                        <div
                            key={m.id}
                            ref={(el) => {
                                if (el) messageElementRefs.current[m.id] = el;
                                else delete messageElementRefs.current[m.id];
                            }}
                            data-message-id={m.id}
                        >
                            <MessageCard
                                msg={m}
                                mine={mine}
                                onReply={onReplyMessage}
                                reactionsCounts={reactions[m.id]}
                                myReactions={myReactions[m.id]}
                                onToggleReaction={onToggleMessageReaction}
                                onOpenReactionDetails={onOpenMessageReactionDetails}
                                onHoverReaction={onHoverMessageReaction}
                                isLight={isLight}
                                canEdit={canEdit}
                                canModerate={canModerate}
                                onUpdateMessage={onUpdateChatMessage}
                                onDeleteMessage={onDeleteChatMessage}
                                onJumpToMessage={jumpToMessage}
                                highlighted={highlightedMessageId === m.id}
                                readers={mine ? readersByMessage[m.id] || EMPTY_READERS : EMPTY_READERS}
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
                                : "bg-[#353B42]/95 border-[#4C5259] text-[#F4F5F6] hover:bg-[#444B53]")
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

            <div className={"px-2.5 pt-2.5 pb-2 border-t " + headerBorder}>
                {generalChatLocked && (
                    <div className={"mb-3 rounded-xl px-3 py-2 text-[12px] leading-5 " + (isLight ? "bg-[#F0F0F0] text-black/60" : "bg-white/[0.06] text-[#D0D6DD]")}>
                        Public chat is disabled by the host. Use DMs to message the host privately.
                    </div>
                )}
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
                                ? "border-[#5286F6]/60 bg-[#5286F6]/10 text-black/80"
                                : "border-[#5286F6]/45 bg-[#5286F6]/10 text-white/85")
                        }
                    >
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className={`text-[11px] font-semibold uppercase tracking-[0.06em] ${isLight ? "text-[#3FB455]" : "text-[#6B98FA]"}`}>
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
                                    className="h-8 rounded-lg bg-[#5286F6] px-3 text-[11px] font-semibold text-black transition hover:bg-[#5286F6]"
                                >
                                    Confirm
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}

                <div className="flex items-end gap-1">
                    <textarea
                        ref={composerRef}
                        rows={1}
                        value={text}
                        onChange={(e) => {
                            // Typing or deleting while dictating: keep the edit and
                            // only add speech that comes after it.
                            dictation.manualEdit(e.target.value);
                            setText(e.target.value);
                        }}
                        placeholder={
                            generalChatLocked
                                ? "Public chat is disabled for this session"
                                : activeMode === "general"
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
                        disabled={generalChatLocked || (activeMode === "direct" && isHost && !activeDirectPeerId)}
                    />

                    {/* Mic, emoji and send share one bar split by thin dividers, so the
                        message field keeps as much width as possible. */}
                    <div className={composerBarCls}>
                        {dictation.supported ? (
                            <>
                                <button
                                    type="button"
                                    title={dictation.listening ? "Stop dictation" : "Dictate a message (your room mic is muted while you speak)"}
                                    aria-label={dictation.listening ? "Stop dictation" : "Dictate a message"}
                                    aria-pressed={dictation.listening}
                                    className={
                                        dictation.listening
                                            ? "w-8 self-stretch shrink-0 flex items-center justify-center transition bg-[#F65252]/15 text-[#F65252]"
                                            : composerEmojiBtnCls
                                    }
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                        dictation.clearError();
                                        dictation.toggle();
                                        composerRef.current?.focus();
                                    }}
                                    disabled={generalChatLocked || (activeMode === "direct" && isHost && !activeDirectPeerId)}
                                >
                                    {dictation.listening ? (
                                        <Square size={12} fill="currentColor" className="motion-safe:animate-pulse" />
                                    ) : (
                                        <Mic size={16} />
                                    )}
                                </button>
                                <span className={composerBarDividerCls} aria-hidden="true" />
                            </>
                        ) : null}

                        <div className="relative flex self-stretch" ref={composerEmojiWrapRef}>
                            <button
                                ref={emojiButtonRef}
                                type="button"
                                title="Add emoji"
                                className={composerEmojiBtnCls}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => setComposerEmojiOpen((v) => !v)}
                                disabled={generalChatLocked}
                            >
                                <Smile size={16} />
                            </button>
                        </div>

                        <span className={composerBarDividerCls} aria-hidden="true" />

                        <button
                            onClick={() => void send()}
                            className={
                                "w-9 self-stretch shrink-0 flex items-center justify-center transition " +
                                (text.trim() &&
                                    !generalChatLocked &&
                                    !(activeMode === "direct" && isHost && !activeDirectPeerId)
                                    ? sendBtnActive
                                    : sendBtnDisabled + " cursor-not-allowed")
                            }
                            type="button"
                            disabled={
                                !text.trim() ||
                                generalChatLocked ||
                                (activeMode === "direct" && isHost && !activeDirectPeerId)
                            }
                            title="Send"
                        >
                            <SendHorizontal size={16} />
                        </button>
                    </div>
                </div>

                <div className={"mt-1.5 px-0.5 text-[11px] " + (dictation.error ? "text-[#F65252]" : hintText)} aria-live="polite">
                    {dictation.error
                        ? dictation.error
                        : dictation.listening
                            ? "Listening… your room mic is muted. Tap ■ to stop, Enter to send."
                            : "Enter — send • Shift+Enter — new line"}
                </div>
            </div>

            {emojiPortal}
            {reactorsPopover}
        </div>
    );
}

export default ChatPanel;
