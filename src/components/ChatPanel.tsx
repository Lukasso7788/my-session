// src/components/ChatPanel.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { CornerUpLeft, X } from "lucide-react";

type Profile = { full_name?: string; avatar_url?: string } | null;

type Msg = {
    id: string;
    session_id: string;
    user_id: string;
    body: string;
    created_at: string;
    profiles?: Profile;
};

function avatarFromProfile(profile?: Profile) {
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

function MessageCard({
    msg,
    mine,
    currentUserId,
    onReply,
}: {
    msg: Msg;
    mine: boolean;
    currentUserId: string | null;
    onReply: (m: Msg) => void;
}) {
    const name = mine ? "You" : msg.profiles?.full_name || "Participant";
    const time = formatTime(msg.created_at);

    return (
        <div className={"flex items-start gap-3 " + (mine ? "justify-end" : "justify-start")}>
            {/* Left avatar (others) */}
            {!mine && (
                <img
                    src={avatarFromProfile(msg.profiles)}
                    className="w-9 h-9 rounded-full object-cover"
                    alt=""
                />
            )}

            <div className="max-w-[82%] min-w-0">
                {/* meta row */}
                <div className={"flex items-center gap-2 mb-1 " + (mine ? "justify-end" : "justify-start")}>
                    <div className="text-[11px] text-white/55 truncate">{name}</div>
                    <div className="text-[11px] text-white/35">{time}</div>

                    {/* reply (на любые сообщения, включая свои — как хочешь, сейчас на любые) */}
                    <button
                        type="button"
                        onClick={() => onReply(msg)}
                        className="
              ml-1 inline-flex items-center gap-1
              text-[11px] text-white/45 hover:text-emerald-300
              transition
            "
                        title="Reply"
                    >
                        <CornerUpLeft size={14} />
                        Reply
                    </button>
                </div>

                {/* bubble */}
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
            </div>

            {/* Right spacer (to keep alignment) */}
            {mine && (
                <div className="w-9 h-9 rounded-full opacity-0" aria-hidden="true" />
            )}
        </div>
    );
}

export function ChatPanel({ sessionId }: { sessionId: string }) {
    const [userId, setUserId] = useState<string | null>(null);

    const [messages, setMessages] = useState<Msg[]>([]);
    const [text, setText] = useState("");
    const [loading, setLoading] = useState(true);

    // reply
    const [replyTo, setReplyTo] = useState<Msg | null>(null);

    const bottomRef = useRef<HTMLDivElement | null>(null);

    // auth user id
    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    }, []);

    const load = async () => {
        if (!sessionId) return;

        setLoading(true);

        // IMPORTANT:
        // УБРАЛ gte(last 30 days) — потому что это частая причина "пусто",
        // если created_at вдруг NULL / тип не совпал / default не сработал.
        // Старые сообщения всё равно вычищаются scheduled функцией.
        const { data, error } = await supabase
            .from("session_chat_messages")
            .select("id, session_id, user_id, body, created_at, profiles(full_name, avatar_url)")
            .eq("session_id", sessionId)
            .order("created_at", { ascending: true })
            .limit(300);

        if (error) {
            console.error("chat load error:", error);
            setMessages([]);
            setLoading(false);
            return;
        }

        setMessages((data as any) || []);
        setLoading(false);
    };

    // initial load
    useEffect(() => {
        if (!sessionId) return;
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    // realtime
    useEffect(() => {
        if (!sessionId) return;

        const ch = supabase
            .channel(`chat:${sessionId}`)
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "session_chat_messages",
                    filter: `session_id=eq.${sessionId}`,
                },
                () => load()
            )
            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "session_chat_messages",
                    filter: `session_id=eq.${sessionId}`,
                },
                () => load()
            )
            .on(
                "postgres_changes",
                {
                    event: "DELETE",
                    schema: "public",
                    table: "session_chat_messages",
                    filter: `session_id=eq.${sessionId}`,
                },
                (payload: any) => {
                    const deletedId = payload?.old?.id;
                    if (!deletedId) return;
                    setMessages((prev) => prev.filter((m) => m.id !== deletedId));
                }
            )
            .subscribe((status) => {
                console.log("chat channel status:", status);
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
        const body = text.trim();
        if (!body || !userId || !sessionId) return;

        // optimistic append (чтобы видно было сразу, даже если SELECT/RLS тупит)
        const optimistic: Msg = {
            id: `optimistic-${Date.now()}`,
            session_id: sessionId,
            user_id: userId,
            body: replyTo ? `↪ Reply: ${replyTo.body}\n\n${body}` : body,
            created_at: new Date().toISOString(),
            profiles: { full_name: "You", avatar_url: undefined },
        };

        setMessages((prev) => [...prev, optimistic]);

        const payload: any = {
            session_id: sessionId,
            user_id: userId,
            body: replyTo ? `↪ Reply: ${replyTo.body}\n\n${body}` : body,
            // IMPORTANT: created_at чтобы оно точно попало в сортировки/фильтры
            created_at: new Date().toISOString(),
        };

        const { error } = await supabase.from("session_chat_messages").insert(payload);

        if (error) {
            console.error("chat send error:", error);
            // rollback optimistic on failure
            setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
            return;
        }

        setText("");
        setReplyTo(null);
        // load() не обязателен — realtime поймает, но если realtime выключен, можно раскомментить:
        // load();
    };

    const uiMessages = useMemo(() => messages, [messages]);

    return (
        <div className="h-full flex flex-col bg-transparent min-h-0">
            {/* HEADER */}
            <div className="px-5 py-4 border-b border-white/5">
                <div className="text-white/85 font-inter font-semibold">Chat</div>
                <div className="text-white/45 text-[12px]">History: last 30 days</div>
            </div>

            {/* LIST */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3 custom-scrollbar">
                {loading && <div className="text-white/40 text-sm italic">Loading…</div>}

                {!loading && uiMessages.length === 0 && (
                    <div className="text-white/40 text-sm italic">No messages yet</div>
                )}

                {uiMessages.map((m) => {
                    const mine = m.user_id === userId;
                    return (
                        <MessageCard
                            key={m.id}
                            msg={m}
                            mine={mine}
                            currentUserId={userId}
                            onReply={(msg) => setReplyTo(msg)}
                        />
                    );
                })}

                <div ref={bottomRef} />
            </div>

            {/* INPUT */}
            <div className="p-4 border-t border-white/5">
                {/* Reply bar */}
                {replyTo && (
                    <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2">
                        <div className="min-w-0">
                            <div className="text-[11px] text-emerald-300/90 font-medium">Replying</div>
                            <div className="text-[11px] text-white/55 truncate">
                                {replyTo.profiles?.full_name || "Participant"}: {replyTo.body}
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

                <div className="flex items-center gap-2">
                    <input
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && send()}
                        placeholder="Write a message…"
                        className="
              flex-1 h-11 rounded-xl
              bg-[#0B1220]/70 border border-white/10
              px-3 text-[13px]
              text-white/85 placeholder:text-white/35
              outline-none focus:outline-none
              focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
            "
                    />
                    <button
                        onClick={send}
                        className="h-11 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-[#02140B] font-semibold"
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
