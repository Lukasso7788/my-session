// src/components/ChatPanel.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { CornerUpLeft, X, Smile } from "lucide-react";

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

// группировка реакций: message_id -> emoji -> count
function groupReactions(rows: ReactionRow[]) {
    const out: Record<string, Record<string, number>> = {};
    for (const r of rows) {
        if (!out[r.message_id]) out[r.message_id] = {};
        out[r.message_id][r.emoji] = (out[r.message_id][r.emoji] || 0) + 1;
    }
    return out;
}

function MessageCard({
    msg,
    mine,
    onReply,
    reactionsCounts,
    onAddReaction,
}: {
    msg: Msg;
    mine: boolean;
    onReply: (m: Msg) => void;
    reactionsCounts: Record<string, number> | undefined;
    onAddReaction: (messageId: string, emoji: string) => void;
}) {
    const name = mine ? "You" : msg.profile?.full_name || "Participant";
    const time = formatTime(msg.created_at);

    const [openReactions, setOpenReactions] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);

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
                    <div className="text-[11px] text-white/55 truncate">{name}</div>
                    <div className="text-[11px] text-white/35">{time}</div>

                    <button
                        type="button"
                        onClick={() => onReply(msg)}
                        className="ml-1 inline-flex items-center gap-1 text-[11px] text-white/45 hover:text-emerald-300 transition"
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
                            className="ml-1 inline-flex items-center gap-1 text-[11px] text-white/45 hover:text-emerald-300 transition"
                            title="React"
                        >
                            <Smile size={14} />
                            React
                        </button>

                        {openReactions && (
                            <div className="absolute z-50 mt-2 right-0 bg-[#020617] border border-white/10 rounded-2xl px-3 py-2 flex gap-2 text-xl shadow-xl">
                                {REACTION_EMOJIS.map((e) => (
                                    <button
                                        key={e}
                                        onClick={() => {
                                            onAddReaction(msg.id, e);
                                            setOpenReactions(false);
                                        }}
                                        className="hover:scale-[1.06] transition"
                                        title={e}
                                        type="button"
                                    >
                                        {e}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div
                    className={
                        "rounded-2xl px-3 py-2 text-[13px] leading-snug border whitespace-pre-wrap break-words " +
                        (mine
                            ? "bg-emerald-500/15 border-emerald-400/20 text-white/90"
                            : "bg-white/5 border-white/10 text-white/85")
                    }
                >
                    {msg.body}
                </div>

                {/* reactions row */}
                {hasReactions && (
                    <div className={"mt-2 flex flex-wrap gap-2 " + (mine ? "justify-end" : "justify-start")}>
                        {Object.entries(reactionsCounts!).map(([emoji, count]) => (
                            <div
                                key={emoji}
                                className="
                  px-2 py-1 rounded-xl
                  bg-white/5 border border-white/10
                  text-[12px] text-white/80
                  flex items-center gap-1
                "
                            >
                                <span>{emoji}</span>
                                <span className="text-white/60">{count}</span>
                            </div>
                        ))}
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

export function ChatPanel({ sessionId }: { sessionId: string }) {
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

    const [reactions, setReactions] = useState<Record<string, Record<string, number>>>({});

    const [text, setText] = useState("");
    const [loading, setLoading] = useState(true);

    const [replyTo, setReplyTo] = useState<Msg | null>(null);

    const bottomRef = useRef<HTMLDivElement | null>(null);

    const pollingRef = useRef<number | null>(null);

    // ---------- auth user + my profile
    useEffect(() => {
        (async () => {
            const { data } = await supabase.auth.getUser();
            const uid = data.user?.id ?? null;
            setUserId(uid);

            if (uid) {
                const { data: p } = await supabase
                    .from("profiles")
                    .select("id, full_name, avatar_url")
                    .eq("id", uid)
                    .single();

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

    // ---------- load messages (initial + fallback)
    const loadMessages = async () => {
        if (!sessionId) return;

        setLoading(true);

        const { data: rows, error } = await supabase
            .from(MSG_TABLE)
            .select("id, session_id, user_id, body, created_at")
            .eq("session_id", sessionId)
            .order("created_at", { ascending: true })
            .limit(300);

        if (error) {
            console.error("chat load error:", error);
            setMessages([]);
            setLoading(false);
            return;
        }

        const safeRows = (rows as any as MsgRow[]) || [];
        await ensureProfiles(safeRows.map((r) => r.user_id));
        setMessages(safeRows.map((r) => attachProfile(r)));

        setLoading(false);
    };

    // ---------- load reactions
    const loadReactions = async () => {
        if (!sessionId) return;

        const { data, error } = await supabase
            .from(REACTIONS_TABLE)
            .select("id, session_id, message_id, user_id, emoji, created_at")
            .eq("session_id", sessionId)
            .limit(2000);

        if (error) {
            console.error("reactions load error:", error);
            setReactions({});
            return;
        }

        setReactions(groupReactions((data as any as ReactionRow[]) || []));
    };

    // initial load
    useEffect(() => {
        if (!sessionId) return;
        loadMessages();
        loadReactions();
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

                // профили на лету
                await ensureProfiles([row.user_id]);

                setMessages((prev) => {
                    // если уже есть — не дублируем
                    if (prev.some((m) => m.id === row.id)) return prev;

                    // если есть оптимистик от этого же пользователя и тем же body — заменим
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
            }
        );

        channel.on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: MSG_TABLE, filter: `session_id=eq.${sessionId}` },
            async (payload: any) => {
                const row = payload?.new as MsgRow | undefined;
                if (!row?.id) return;

                await ensureProfiles([row.user_id]);

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

            // Fallback: если realtime не завёлся — поллим, чтобы люди не “одинокие”
            if (status !== "SUBSCRIBED") {
                if (!pollingRef.current) {
                    pollingRef.current = window.setInterval(() => {
                        // не спамим бесконечно: only if something looks stale
                        loadMessages();
                        loadReactions();
                    }, 2500);
                }
            } else {
                if (pollingRef.current) {
                    window.clearInterval(pollingRef.current);
                    pollingRef.current = null;
                }
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
    }, [sessionId]);

    // ---------- realtime reactions
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
                    // реакции проще и безопаснее перезагрузить (их мало)
                    loadReactions();
                }
            )
            .subscribe((status) => {
                console.log("reactions channel status:", status);
            });

        return () => {
            supabase.removeChannel(ch);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    // autoscroll
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages.length]);

    const send = async () => {
        const raw = text.trim();
        if (!raw || !userId || !sessionId) return;

        const composed = replyTo ? `↪ Reply: ${replyTo.body}\n\n${raw}` : raw;

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
            // rollback optimistic
            setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
            // возвращаем текст
            setText(composed);
            return;
        }

        // если realtime вдруг не сработает — fallback polling подтянет
    };

    const addReaction = async (messageId: string, emoji: string) => {
        if (!userId || !sessionId) return;

        // upsert-like: благодаря уникальному индексу (message_id, user_id, emoji)
        const { error } = await supabase.from(REACTIONS_TABLE).insert({
            session_id: sessionId,
            message_id: messageId,
            user_id: userId,
            emoji,
        });

        if (error) {
            // если дубль — это окей (уникальный индекс), можно игнорить
            // но пусть лог будет
            console.warn("addReaction error (maybe duplicate):", error);
        }
    };

    const uiMessages = useMemo(() => messages, [messages]);

    return (
        <div className="h-full flex flex-col bg-transparent min-h-0">
            {/* HEADER */}
            <div className="px-5 py-4 border-b border-white/5">
                <div className="text-white/85 font-inter font-semibold">Chat</div>
                <div className="text-white/45 text-[12px]">All messages for this session</div>
            </div>

            {/* LIST */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3 custom-scrollbar">
                {loading && <div className="text-white/40 text-sm italic">Loading…</div>}

                {!loading && uiMessages.length === 0 && (
                    <div className="text-white/40 text-sm italic">No messages yet</div>
                )}

                {uiMessages.map((m) => (
                    <MessageCard
                        key={m.id}
                        msg={m}
                        mine={m.user_id === userId}
                        onReply={(msg) => setReplyTo(msg)}
                        reactionsCounts={reactions[m.id]}
                        onAddReaction={addReaction}
                    />
                ))}

                <div ref={bottomRef} />
            </div>

            {/* COMPOSER (FULL WIDTH) */}
            <div className="p-4 border-t border-white/5">
                {replyTo && (
                    <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2">
                        <div className="min-w-0">
                            <div className="text-[11px] text-emerald-300/90 font-medium">Replying</div>
                            <div className="text-[11px] text-white/55 truncate">
                                {(replyTo.profile?.full_name || "Participant") + ": " + replyTo.body}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setReplyTo(null)}
                            className="w-8 h-8 rounded-lg bg-[#111827] hover:bg-[#1f2937] flex items-center justify-center text-white/70"
                            title="Cancel reply"
                        >
                            <X size={16} />
                        </button>
                    </div>
                )}

                {/* textarea full width */}
                <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Write a message…"
                    className="
            w-full min-h-[48px] max-h-[160px]
            rounded-xl resize-none
            bg-[#0B1220]/70 border border-white/10
            px-3 py-3 text-[13px]
            text-white/85 placeholder:text-white/35
            outline-none focus:outline-none
            focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
          "
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            send();
                        }
                    }}
                />

                <div className="mt-2 flex items-center justify-between">
                    <div className="text-[11px] text-white/35">Enter — send • Shift+Enter — new line</div>

                    <button
                        onClick={send}
                        className="h-11 px-5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-[#02140B] font-semibold"
                        type="button"
                    >
                        Send
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ChatPanel;
