// src/components/ChatPanel.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { CornerUpLeft, X, Smile, SendHorizontal, Pencil, Trash2, Check } from "lucide-react";

type RoomTheme = "dark" | "light";

type Profile = { id: string; full_name?: string | null; avatar_url?: string | null };

type MsgRow = {
    id: string;
    session_id: string;
    user_id: string;
    body: string;
    created_at: string;
};

type Msg = MsgRow & { profile?: Profile | null };

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

// базовый набор эмодзи (можешь расширить)
const REACTION_EMOJIS = ["🔥", "😂", "👏", "❤️", "👍", "👎"] as const;

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

// группировка реакций:
// - counts: message_id -> emoji -> count
// - mine:   message_id -> emoji -> true (если я ставил)
function groupReactions(rows: ReactionRow[], myUserId: string | null) {
    const counts: Record<string, Record<string, number>> = {};
    const mine: Record<string, Record<string, boolean>> = {};

    for (const r of rows) {
        if (!counts[r.message_id]) counts[r.message_id] = {};
        counts[r.message_id][r.emoji] = (counts[r.message_id][r.emoji] || 0) + 1;

        if (myUserId && r.user_id === myUserId) {
            if (!mine[r.message_id]) mine[r.message_id] = {};
            mine[r.message_id][r.emoji] = true;
        }
    }

    return { counts, mine };
}

// --- Reply parsing: вытягиваем цитату из тела сообщения, чтобы красиво отрендерить
function parseReplyBody(body: string): { quote: string | null; main: string } {
    if (!body) return { quote: null, main: "" };

    // Форматы:
    // 1) "↪ Reply: ...\n\nmain"
    // 2) "↪ <something>\n\nmain"
    // 3) "↪ Reply to: ...\n\nmain"
    const trimmed = body.trimStart();
    if (!trimmed.startsWith("↪")) return { quote: null, main: body };

    const parts = trimmed.split(/\n\s*\n/); // first block + rest
    if (parts.length <= 1) {
        const firstLine = trimmed.split("\n")[0] || trimmed;
        const q = firstLine.replace(/^↪\s*/, "").replace(/^Reply:\s*/i, "").replace(/^Reply to:\s*/i, "");
        return { quote: q.trim() || null, main: trimmed.replace(firstLine, "").trim() };
    }

    const header = parts[0] || "";
    const q = header.replace(/^↪\s*/, "").replace(/^Reply:\s*/i, "").replace(/^Reply to:\s*/i, "").trim();
    const main = parts.slice(1).join("\n\n");
    return { quote: q || null, main };
}

function withTimeout<T>(p: Promise<T>, ms: number, label = "timeout"): Promise<T> {
    let t: any;
    const timeout = new Promise<T>((_, reject) => {
        t = setTimeout(() => reject(new Error(label)), ms);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

function MessageCard({
    msg,
    mine,
    onReply,
    reactionsCounts,
    myReactions,
    onToggleReaction,
    isLight,
    canEdit,
    onUpdateMessage,
    onDeleteMessage,
}: {
    msg: Msg;
    mine: boolean;
    onReply: (m: Msg) => void;
    reactionsCounts: Record<string, number> | undefined;
    myReactions: Record<string, boolean> | undefined;
    onToggleReaction: (messageId: string, emoji: string) => void;
    isLight: boolean;

    canEdit: boolean;
    onUpdateMessage: (messageId: string, newBody: string) => Promise<void>;
    onDeleteMessage: (messageId: string) => Promise<void>;
}) {
    const name = mine ? "You" : msg.profile?.full_name || "Participant";
    const time = formatTime(msg.created_at);

    const [openReactions, setOpenReactions] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);

    // edit state
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState(msg.body);
    const [savingEdit, setSavingEdit] = useState(false);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        // если сообщение обновилось realtime — синхронизируем draft, если не в режиме редактирования
        if (!isEditing) setDraft(msg.body);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [msg.body]);

    useEffect(() => {
        if (!openReactions) return;
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node | null;
            if (!t || !menuRef.current) return;
            if (!menuRef.current.contains(t)) setOpenReactions(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [openReactions]);

    const hasReactions = reactionsCounts && Object.keys(reactionsCounts).length > 0;

    const metaNameCls = isLight ? "text-black/55" : "text-white/55";
    const metaTimeCls = isLight ? "text-black/35" : "text-white/35";
    const actionBtnCls = isLight
        ? "text-black/45 hover:text-emerald-700"
        : "text-white/45 hover:text-emerald-300";

    const dangerBtnCls = isLight
        ? "text-black/40 hover:text-red-700"
        : "text-white/40 hover:text-red-300";

    const menuCls = isLight
        ? "bg-white border border-black/10"
        : "bg-[#020617] border border-white/10";

    const bubbleCls =
        "rounded-2xl px-3 py-2 text-[13px] leading-snug border whitespace-pre-wrap break-words " +
        (mine
            ? isLight
                ? "bg-emerald-500/15 border-emerald-600/25 text-black/85"
                : "bg-emerald-500/15 border-emerald-400/20 text-white/90"
            : isLight
                ? "bg-black/5 border-black/10 text-black/80"
                : "bg-white/5 border-white/10 text-white/85");

    const quoteBoxCls = isLight
        ? "bg-white/70 border border-black/10 text-black/70"
        : "bg-black/25 border border-white/10 text-white/70";

    const reactionPillBase = isLight
        ? "px-2 py-1 rounded-xl bg-black/5 border border-black/10 text-[12px] text-black/70 flex items-center gap-1 transition"
        : "px-2 py-1 rounded-xl bg-white/5 border border-white/10 text-[12px] text-white/80 flex items-center gap-1 transition";

    const reactionPillMine = isLight
        ? "ring-1 ring-emerald-400/60 border-emerald-500/40"
        : "ring-1 ring-emerald-300/40 border-emerald-300/30";

    const reactionCountCls = isLight ? "text-black/50" : "text-white/60";

    const inputCls = isLight
        ? "w-full min-h-[42px] max-h-[180px] rounded-xl resize-none px-3 py-2 text-[13px] outline-none bg-white border border-black/10 text-black/85 placeholder:text-black/35 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
        : "w-full min-h-[42px] max-h-[180px] rounded-xl resize-none px-3 py-2 text-[13px] outline-none bg-[#0B1220]/70 border border-white/10 text-white/85 placeholder:text-white/35 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500";

    const { quote, main } = useMemo(() => parseReplyBody(msg.body), [msg.body]);

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
        const ok = window.confirm("Delete this message?");
        if (!ok) return;

        setDeleting(true);
        try {
            await onDeleteMessage(msg.id);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className={"flex items-start gap-3 " + (mine ? "justify-end" : "justify-start")}>
            {!mine && (
                <img
                    src={avatarFromProfile(msg.profile)}
                    className="w-9 h-9 rounded-full object-cover"
                    alt=""
                />
            )}

            <div className="max-w-[82%] min-w-0">
                <div className={"flex items-center gap-2 mb-1 " + (mine ? "justify-end" : "justify-start")}>
                    <div className={"text-[11px] truncate " + metaNameCls}>{name}</div>
                    <div className={"text-[11px] " + metaTimeCls}>{time}</div>

                    {!isEditing && (
                        <>
                            <button
                                type="button"
                                onClick={() => onReply(msg)}
                                className={"ml-1 inline-flex items-center gap-1 text-[11px] transition " + actionBtnCls}
                                title="Reply"
                            >
                                <CornerUpLeft size={14} />
                                Reply
                            </button>

                            {/* reactions button */}
                            <div className="relative" ref={menuRef}>
                                <button
                                    type="button"
                                    onClick={() => setOpenReactions((v) => !v)}
                                    className={"ml-1 inline-flex items-center gap-1 text-[11px] transition " + actionBtnCls}
                                    title="React"
                                >
                                    <Smile size={14} />
                                    React
                                </button>

                                {openReactions && (
                                    <div className={"absolute z-50 mt-2 right-0 rounded-2xl px-3 py-2 flex gap-2 text-xl shadow-xl " + menuCls}>
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
                                                        "hover:scale-[1.06] transition " +
                                                        (isMine
                                                            ? (isLight
                                                                ? "drop-shadow-[0_0_0.6rem_rgba(16,185,129,0.35)]"
                                                                : "drop-shadow-[0_0_0.7rem_rgba(16,185,129,0.25)]")
                                                            : "")
                                                    }
                                                    title={isMine ? `Remove ${e}` : e}
                                                    type="button"
                                                >
                                                    {e}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* edit/delete for mine */}
                            {canEdit && (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => setIsEditing(true)}
                                        className={"ml-1 inline-flex items-center gap-1 text-[11px] transition " + actionBtnCls}
                                        title="Edit"
                                    >
                                        <Pencil size={14} />
                                    </button>

                                    <button
                                        type="button"
                                        onClick={doDelete}
                                        className={"ml-1 inline-flex items-center gap-1 text-[11px] transition " + dangerBtnCls}
                                        title="Delete"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </>
                            )}
                        </>
                    )}
                </div>

                {!isEditing ? (
                    <div className={bubbleCls}>
                        {/* quoted reply block */}
                        {quote && (
                            <div className={"mb-2 rounded-xl px-3 py-2 text-[12px] leading-snug " + quoteBoxCls}>
                                <div className="text-[10px] opacity-75 mb-1">Reply</div>
                                <div className="whitespace-pre-wrap break-words">{quote}</div>
                            </div>
                        )}
                        <div className="whitespace-pre-wrap break-words">{main}</div>
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
                                    saveEdit();
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
                                className={isLight ? "px-3 h-9 rounded-xl bg-black/5 hover:bg-black/10 border border-black/10 text-black/70 text-sm" : "px-3 h-9 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/75 text-sm"}
                                disabled={savingEdit}
                                title="Cancel"
                            >
                                <X size={16} />
                            </button>

                            <button
                                type="button"
                                onClick={saveEdit}
                                className={"px-3 h-9 rounded-xl text-sm font-semibold inline-flex items-center gap-2 " + (savingEdit ? "opacity-70 cursor-not-allowed" : "") + " " + (isLight ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white")}
                                disabled={savingEdit || !draft.trim()}
                                title="Save"
                            >
                                <Check size={16} />
                                Save
                            </button>
                        </div>
                        <div className={"mt-1 text-[11px] " + (isLight ? "text-black/40" : "text-white/35")}>
                            Enter — save • Shift+Enter — new line • Esc — cancel
                        </div>
                    </div>
                )}

                {/* reactions row */}
                {hasReactions && !isEditing && (
                    <div className={"mt-2 flex flex-wrap gap-2 " + (mine ? "justify-end" : "justify-start")}>
                        {Object.entries(reactionsCounts!).map(([emoji, count]) => {
                            const isMine = !!myReactions?.[emoji];
                            return (
                                <button
                                    key={emoji}
                                    type="button"
                                    className={reactionPillBase + " " + (isMine ? reactionPillMine : "")}
                                    onClick={() => onToggleReaction(msg.id, emoji)}
                                    title={isMine ? `Remove ${emoji}` : `React ${emoji}`}
                                >
                                    <span>{emoji}</span>
                                    <span className={reactionCountCls}>{count}</span>
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

export function ChatPanel({
    sessionId,
    theme = "dark",

    // IMPORTANT: showHeader теперь управляет только сабтайтлом,
    // а заголовок "Chat" мы показываем ВСЕГДА (чтобы он не пропадал).
    showHeader = true,

    title = "Chat",
    subtitle = "All messages for this session",

    onClose, // NEW: если хочешь крестик сверху — прокинь сюда
    onBecameVisible, // ✅ NEW
}: {
    sessionId: string;
    theme?: RoomTheme;
    showHeader?: boolean;

    title?: string;
    subtitle?: string;

    onClose?: () => void;
    onBecameVisible?: () => void; // ✅ NEW
}) {
    const isLight = theme === "light";

    const [userId, setUserId] = useState<string | null>(null);

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

    // reactions: counts + mine
    const [reactions, setReactions] = useState<Record<string, Record<string, number>>>({});
    const [myReactions, setMyReactions] = useState<Record<string, Record<string, boolean>>>({});

    const [text, setText] = useState("");
    const [loading, setLoading] = useState(true);

    const [replyTo, setReplyTo] = useState<Msg | null>(null);

    const bottomRef = useRef<HTMLDivElement | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);

    const pollingRef = useRef<number | null>(null);

    // ✅ safety / lifecycle
    const aliveRef = useRef(true);
    useEffect(() => {
        aliveRef.current = true;
        return () => {
            aliveRef.current = false;
        };
    }, []);

    // request ids (ignore stale results)
    const messagesReqIdRef = useRef(0);
    const reactionsReqIdRef = useRef(0);

    // in-flight locks + queued reload flags
    const loadingMessagesRef = useRef(false);
    const loadingReactionsRef = useRef(false);
    const queuedMessagesReloadRef = useRef(false);
    const queuedReactionsReloadRef = useRef(false);

    // debounce for reactions reload
    const reactionsReloadTimerRef = useRef<number | null>(null);

    // autoscroll control
    const atBottomRef = useRef<boolean>(true);
    const [unseenNew, setUnseenNew] = useState<number>(0);

    const composerRef = useRef<HTMLTextAreaElement | null>(null);

    const isAtBottom = () => {
        const el = listRef.current;
        if (!el) return true;
        const threshold = 140; // px
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        return distance <= threshold;
    };

    const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
        bottomRef.current?.scrollIntoView({ behavior });
    };

    const scheduleReloadReactions = (delayMs = 400) => {
        if (reactionsReloadTimerRef.current) {
            window.clearTimeout(reactionsReloadTimerRef.current);
            reactionsReloadTimerRef.current = null;
        }
        reactionsReloadTimerRef.current = window.setTimeout(() => {
            reactionsReloadTimerRef.current = null;
            void loadReactions({ silent: true });
        }, delayMs);
    };

    // ✅ inform parent that chat became visible
    useEffect(() => {
        onBecameVisible?.();
        setUnseenNew(0);
    }, [onBecameVisible, sessionId]);

    // ---------- theme tokens
    const headerBorder = isLight ? "border-black/10" : "border-white/5";
    const titleText = isLight ? "text-black/85" : "text-white/85";
    const subText = isLight ? "text-black/50" : "text-white/45";

    const headerCloseBtnCls = isLight
        ? "bg-black/5 hover:bg-black/10 text-black/60"
        : "bg-white/5 hover:bg-white/10 text-white/70";

    const replyBoxCls = isLight ? "bg-black/5 border-black/10" : "bg-white/5 border-white/10";
    const replyingLabel = "text-[11px] text-emerald-500/90 font-medium";
    const replyingText = isLight ? "text-black/55" : "text-white/55";

    const cancelBtnCls = isLight
        ? "bg-black/5 hover:bg-black/10 text-black/60"
        : "bg-[#111827] hover:bg-[#1f2937] text-white/70";

    const hintText = isLight ? "text-black/40" : "text-white/35";

    const sendBtnActive = "bg-emerald-600 hover:bg-emerald-700 text-white";
    const sendBtnDisabled = isLight ? "bg-black/10 text-black/35" : "bg-white/10 text-white/35";

    const composerInputCls = isLight
        ? "flex-1 min-h-[44px] max-h-[140px] rounded-xl resize-none px-3 py-3 text-[13px] outline-none bg-white border border-black/10 text-black/85 placeholder:text-black/35 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
        : "flex-1 min-h-[44px] max-h-[140px] rounded-xl resize-none px-3 py-3 text-[13px] outline-none bg-[#0B1220]/70 border border-white/10 text-white/85 placeholder:text-white/35 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500";

    // ---------- auth user + my profile
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
                    setMeProfile(p as any);
                    setProfilesById((prev) => ({ ...prev, [uid]: p as any }));
                }
            }
        })();
    }, []);

    // ---------- ensureProfiles
    const ensureProfiles = async (userIds: string[]) => {
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
        (profs || []).forEach((p: any) => (map[p.id] = p));
        if (!aliveRef.current) return;
        setProfilesById((prev) => ({ ...prev, ...map }));
    };

    const attachProfile = (row: MsgRow): Msg => {
        const map = profilesByIdRef.current;
        const mp = meProfileRef.current;
        return {
            ...row,
            profile: (map[row.user_id] || (row.user_id === userId ? mp : null)) ?? null,
        };
    };

    const getRecentMessageIdsForReactions = () => {
        // only for non-optimistic (since reactions table references real ids)
        const ids = messagesRef.current
            .filter((m) => !!m.id && !m.id.startsWith("optimistic-"))
            .slice(-300)
            .map((m) => m.id);
        // unique
        return Array.from(new Set(ids));
    };

    // ---------- load messages (initial + fallback)
    const loadMessages = async (opts?: { silent?: boolean }) => {
        if (!sessionId) return;

        if (loadingMessagesRef.current) {
            queuedMessagesReloadRef.current = true;
            return;
        }

        loadingMessagesRef.current = true;
        const reqId = ++messagesReqIdRef.current;

        if (!opts?.silent) setLoading(true);

        try {
            const q = supabase
                .from(MSG_TABLE)
                .select("id, session_id, user_id, body, created_at")
                .eq("session_id", sessionId)
                .order("created_at", { ascending: true })
                .limit(300);

            const { data: rows, error } = await withTimeout(q, 12000, "loadMessages timeout");

            if (!aliveRef.current) return;
            if (reqId !== messagesReqIdRef.current) return;

            if (error) {
                console.error("chat load error:", error);
                setMessages([]);
                return;
            }

            const safeRows = (rows as any as MsgRow[]) || [];
            await ensureProfiles(safeRows.map((r) => r.user_id));

            if (!aliveRef.current) return;
            if (reqId !== messagesReqIdRef.current) return;

            setMessages(safeRows.map((r) => attachProfile(r)));
        } catch (e) {
            console.warn("loadMessages failed:", e);
            if (!aliveRef.current) return;
            if (reqId !== messagesReqIdRef.current) return;
            // keep whatever we had; just stop spinner
        } finally {
            if (aliveRef.current && reqId === messagesReqIdRef.current && !opts?.silent) {
                setLoading(false);
            }
            loadingMessagesRef.current = false;

            // if someone asked while we were loading — run once more silently
            if (queuedMessagesReloadRef.current) {
                queuedMessagesReloadRef.current = false;
                void loadMessages({ silent: true });
            }
        }
    };

    // ---------- load reactions (only for recent messages, debounced reload)
    const loadReactions = async (opts?: { silent?: boolean }) => {
        if (!sessionId) return;

        if (loadingReactionsRef.current) {
            queuedReactionsReloadRef.current = true;
            return;
        }

        loadingReactionsRef.current = true;
        const reqId = ++reactionsReqIdRef.current;

        try {
            const msgIds = getRecentMessageIdsForReactions();

            if (msgIds.length === 0) {
                if (!aliveRef.current) return;
                if (reqId !== reactionsReqIdRef.current) return;
                setReactions({});
                setMyReactions({});
                return;
            }

            const q = supabase
                .from(REACTIONS_TABLE)
                .select("id, session_id, message_id, user_id, emoji, created_at")
                .eq("session_id", sessionId)
                .in("message_id", msgIds)
                // upper bound just in case; usually far smaller
                .limit(5000);

            const { data, error } = await withTimeout(q, 12000, "loadReactions timeout");

            if (!aliveRef.current) return;
            if (reqId !== reactionsReqIdRef.current) return;

            if (error) {
                console.error("reactions load error:", error);
                setReactions({});
                setMyReactions({});
                return;
            }

            const grouped = groupReactions((data as any as ReactionRow[]) || [], userId);
            setReactions(grouped.counts);
            setMyReactions(grouped.mine);
        } catch (e) {
            console.warn("loadReactions failed:", e);
            if (!aliveRef.current) return;
            if (reqId !== reactionsReqIdRef.current) return;
            // keep old reactions
        } finally {
            loadingReactionsRef.current = false;

            if (queuedReactionsReloadRef.current) {
                queuedReactionsReloadRef.current = false;
                void loadReactions({ silent: true });
            }
        }
    };

    // initial load (messages then reactions) on session change
    useEffect(() => {
        if (!sessionId) return;

        (async () => {
            await loadMessages();
            // after messages are set, load reactions for those message ids
            await loadReactions();
        })();

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    // when userId appears/changes: refresh "my reactions" mapping
    useEffect(() => {
        if (!sessionId) return;
        // no need to reload messages, just rebuild mine[] by reloading reactions
        void loadReactions({ silent: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, userId]);

    // ---------- realtime messages: update state directly
    useEffect(() => {
        if (!sessionId) return;

        // stop previous polling
        if (pollingRef.current) {
            window.clearInterval(pollingRef.current);
            pollingRef.current = null;
        }

        const channel = supabase.channel(`chat:${sessionId}`);

        channel.on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: MSG_TABLE, filter: `session_id=eq.${sessionId}` },
            async (payload: any) => {
                const row = payload?.new as MsgRow | undefined;
                if (!row?.id) return;

                await ensureProfiles([row.user_id]);
                if (!aliveRef.current) return;

                const beforeAtBottom = isAtBottom();
                atBottomRef.current = beforeAtBottom;

                setMessages((prev) => {
                    if (prev.some((m) => m.id === row.id)) return prev;

                    const idxOptimistic = prev.findIndex(
                        (m) => m.id.startsWith("optimistic-") && m.user_id === row.user_id && m.body === row.body
                    );

                    const merged = attachProfile(row);

                    if (idxOptimistic !== -1) {
                        const next = [...prev];
                        next[idxOptimistic] = merged;
                        return next;
                    }

                    return [...prev, merged];
                });

                if (!beforeAtBottom && row.user_id !== userId) {
                    setUnseenNew((n) => Math.min(99, n + 1));
                }

                // reactions for a new message usually none, but if they appear quickly — we'll pick up via reactions channel.
            }
        );

        channel.on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: MSG_TABLE, filter: `session_id=eq.${sessionId}` },
            async (payload: any) => {
                const row = payload?.new as MsgRow | undefined;
                if (!row?.id) return;

                await ensureProfiles([row.user_id]);
                if (!aliveRef.current) return;

                setMessages((prev) => prev.map((m) => (m.id === row.id ? attachProfile(row) : m)));
            }
        );

        channel.on(
            "postgres_changes",
            { event: "DELETE", schema: "public", table: MSG_TABLE, filter: `session_id=eq.${sessionId}` },
            (payload: any) => {
                const deletedId = payload?.old?.id as string | undefined;
                if (!deletedId) return;
                setMessages((prev) => prev.filter((m) => m.id !== deletedId));
            }
        );

        channel.subscribe((status) => {
            console.log("chat channel status:", status);

            // ✅ smarter fallback polling:
            // only when channel actually errors or times out
            const shouldPoll = status === "CHANNEL_ERROR" || status === "TIMED_OUT";

            if (shouldPoll) {
                if (!pollingRef.current) {
                    pollingRef.current = window.setInterval(() => {
                        void loadMessages({ silent: true });
                        // reactions reload is cheap now, but still do it less often
                        scheduleReloadReactions(0);
                    }, 12000);
                }
                return;
            }

            if (status === "SUBSCRIBED") {
                if (pollingRef.current) {
                    window.clearInterval(pollingRef.current);
                    pollingRef.current = null;
                }
                // catch-up on successful (re)subscribe without spinner
                void loadMessages({ silent: true });
                scheduleReloadReactions(0);
            }
        });

        return () => {
            if (pollingRef.current) {
                window.clearInterval(pollingRef.current);
                pollingRef.current = null;
            }
            supabase.removeChannel(channel);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, userId]);

    // ---------- realtime reactions (debounced reload)
    useEffect(() => {
        if (!sessionId) return;

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
                () => {
                    scheduleReloadReactions(400);
                }
            )
            .subscribe((status) => {
                console.log("reactions channel status:", status);
            });

        return () => {
            if (reactionsReloadTimerRef.current) {
                window.clearTimeout(reactionsReloadTimerRef.current);
                reactionsReloadTimerRef.current = null;
            }
            supabase.removeChannel(ch);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, userId]);

    // autoscroll only if user is near bottom
    useEffect(() => {
        const shouldScroll = atBottomRef.current || isAtBottom();
        if (shouldScroll) {
            scrollToBottom("smooth");
            setUnseenNew(0);
            onBecameVisible?.();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages.length]);

    // auto-resize composer textarea (чтобы не занимал дохера места)
    useEffect(() => {
        const el = composerRef.current;
        if (!el) return;

        // reset then set
        el.style.height = "0px";
        const next = Math.min(el.scrollHeight, 140);
        el.style.height = `${next}px`;
    }, [text, replyTo]);

    const send = async () => {
        const raw = text.trim();
        if (!raw || !userId || !sessionId) return;

        const replyHeader = replyTo
            ? `↪ ${replyTo.profile?.full_name || "Participant"}: ${replyTo.body}`
            : null;

        const composed = replyHeader ? `${replyHeader}\n\n${raw}` : raw;

        // optimistic
        const optimistic: Msg = {
            id: `optimistic-${Date.now()}`,
            session_id: sessionId,
            user_id: userId,
            body: composed,
            created_at: new Date().toISOString(),
            profile:
                profilesByIdRef.current[userId] ||
                meProfileRef.current ||
                ({ id: userId, full_name: "You", avatar_url: null } as any),
        };

        atBottomRef.current = true;

        setMessages((prev) => [...prev, optimistic]);
        setText("");
        setReplyTo(null);

        const { error } = await supabase.from(MSG_TABLE).insert({
            session_id: sessionId,
            user_id: userId,
            body: composed,
            created_at: new Date().toISOString(),
        });

        if (error) {
            console.error("chat send error:", error);
            setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
            setText(composed);
            return;
        }
    };

    const updateMessage = async (messageId: string, newBody: string) => {
        if (!userId || !sessionId) return;

        // optimistic update
        const prevBody = messagesRef.current.find((m) => m.id === messageId)?.body ?? null;

        setMessages((prev) =>
            prev.map((m) => (m.id === messageId ? { ...m, body: newBody } : m))
        );

        const { error } = await supabase
            .from(MSG_TABLE)
            .update({ body: newBody })
            .eq("id", messageId)
            .eq("session_id", sessionId)
            .eq("user_id", userId);

        if (error) {
            console.error("chat update error:", error);

            // revert (best effort)
            if (prevBody !== null) {
                setMessages((prev) =>
                    prev.map((m) => (m.id === messageId ? { ...m, body: prevBody } : m))
                );
            } else {
                void loadMessages({ silent: true });
            }
        }
    };

    const deleteMessage = async (messageId: string) => {
        if (!userId || !sessionId) return;

        // optimistic remove
        const snapshot = messagesRef.current;
        setMessages((prev) => prev.filter((m) => m.id !== messageId));

        const { error } = await supabase
            .from(MSG_TABLE)
            .delete()
            .eq("id", messageId)
            .eq("session_id", sessionId)
            .eq("user_id", userId);

        if (error) {
            console.error("chat delete error:", error);
            // revert
            setMessages(snapshot);
        }
    };

    const toggleReaction = async (messageId: string, emoji: string) => {
        if (!userId || !sessionId) return;

        const already = !!myReactions?.[messageId]?.[emoji];

        // optimistic UI update
        setReactions((prev) => {
            const next = { ...prev };
            const msgMap = { ...(next[messageId] || {}) };

            const cur = Number(msgMap[emoji] || 0);
            const nextCount = already ? Math.max(0, cur - 1) : cur + 1;

            if (nextCount <= 0) {
                delete msgMap[emoji];
            } else {
                msgMap[emoji] = nextCount;
            }

            if (Object.keys(msgMap).length === 0) {
                delete next[messageId];
            } else {
                next[messageId] = msgMap;
            }

            return next;
        });

        setMyReactions((prev) => {
            const next = { ...prev };
            const msgMine = { ...(next[messageId] || {}) };

            if (already) {
                delete msgMine[emoji];
            } else {
                msgMine[emoji] = true;
            }

            if (Object.keys(msgMine).length === 0) {
                delete next[messageId];
            } else {
                next[messageId] = msgMine;
            }

            return next;
        });

        // DB action
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
                // best effort resync
                scheduleReloadReactions(200);
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
                await supabase
                    .from(REACTIONS_TABLE)
                    .delete()
                    .eq("session_id", sessionId)
                    .eq("message_id", messageId)
                    .eq("user_id", userId)
                    .eq("emoji", emoji);

                scheduleReloadReactions(200);
                return;
            }

            console.warn("addReaction error:", error);
            scheduleReloadReactions(200);
        }
    };

    const uiMessages = useMemo(() => messages, [messages]);

    return (
        <div className="h-full flex flex-col bg-transparent min-h-0 relative">
            {/* HEADER */}
            {showHeader && (
                <div className={"px-5 py-4 border-b " + headerBorder}>
                    <div className="flex items-center justify-between gap-3">
                        <div className={titleText + " font-inter font-semibold truncate min-w-0"}>{title}</div>

                        {onClose && (
                            <button
                                type="button"
                                onClick={onClose}
                                className={"w-9 h-9 rounded-xl flex items-center justify-center transition " + headerCloseBtnCls}
                                title="Close"
                            >
                                <X size={18} />
                            </button>
                        )}
                    </div>

                    {subtitle && (
                        <div className={subText + " text-[12px] mt-0.5"}>{subtitle}</div>
                    )}
                </div>
            )}

            {/* LIST */}
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
                    <div className={(isLight ? "text-black/45" : "text-white/40") + " text-sm italic"}>
                        Loading…
                    </div>
                )}

                {!loading && uiMessages.length === 0 && (
                    <div className={(isLight ? "text-black/45" : "text-white/40") + " text-sm italic"}>
                        No messages yet
                    </div>
                )}

                {uiMessages.map((m) => {
                    const mine = m.user_id === userId;
                    const canEdit = mine && !m.id.startsWith("optimistic-");

                    return (
                        <MessageCard
                            key={m.id}
                            msg={m}
                            mine={mine}
                            onReply={(msg) => setReplyTo(msg)}
                            reactionsCounts={reactions[m.id]}
                            myReactions={myReactions[m.id]}
                            onToggleReaction={toggleReaction}
                            isLight={isLight}
                            canEdit={canEdit}
                            onUpdateMessage={updateMessage}
                            onDeleteMessage={deleteMessage}
                        />
                    );
                })}

                <div ref={bottomRef} />
            </div>

            {/* "New messages" bubble */}
            {unseenNew > 0 && (
                <div className="absolute left-0 right-0 bottom-[96px] flex items-center justify-center pointer-events-none">
                    <button
                        type="button"
                        className={
                            "pointer-events-auto px-4 py-2 rounded-full shadow-xl text-[12px] font-semibold border transition " +
                            (isLight
                                ? "bg-white/95 border-black/10 text-black/80 hover:bg-white"
                                : "bg-[#0B1220]/95 border-white/10 text-white/85 hover:bg-[#0B1220]")
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

            {/* COMPOSER */}
            <div className={"p-4 border-t " + headerBorder}>
                {replyTo && (
                    <div className={"mb-2 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 " + replyBoxCls}>
                        <div className="min-w-0">
                            <div className={replyingLabel}>Replying</div>
                            <div className={"text-[11px] truncate " + replyingText}>
                                {(replyTo.profile?.full_name || "Participant") + ": " + replyTo.body}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setReplyTo(null)}
                            className={"w-8 h-8 rounded-lg flex items-center justify-center transition " + cancelBtnCls}
                            title="Cancel reply"
                        >
                            <X size={16} />
                        </button>
                    </div>
                )}

                {/* ROW: input + send button */}
                <div className="flex items-end gap-2">
                    <textarea
                        ref={composerRef}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Write a message…"
                        className={composerInputCls}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                send();
                            }
                        }}
                        onFocus={() => {
                            if (isAtBottom()) {
                                onBecameVisible?.();
                            }
                        }}
                    />

                    <button
                        onClick={send}
                        className={
                            "w-11 h-11 rounded-xl flex items-center justify-center transition border " +
                            (text.trim()
                                ? sendBtnActive + " border-emerald-500/40"
                                : sendBtnDisabled + " border-transparent cursor-not-allowed")
                        }
                        type="button"
                        disabled={!text.trim()}
                        title="Send"
                    >
                        <SendHorizontal size={18} />
                    </button>
                </div>

                {/* hint under row */}
                <div className={"mt-2 text-[11px] " + hintText}>
                    Enter — send • Shift+Enter — new line
                </div>
            </div>
        </div>
    );
}

export default ChatPanel;
