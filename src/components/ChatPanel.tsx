// src/components/ChatPanel.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

type ChatPanelProps = {
    sessionId: string;
};

type ChatMessage = {
    id: string;
    session_id: string;
    user_id: string;
    message: string;
    created_at?: string;
    profiles?: {
        full_name?: string;
        avatar_url?: string;
    };
};

function getAvatar(profile?: any) {
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

export function ChatPanel({ sessionId }: ChatPanelProps) {
    const [user, setUser] = useState<any>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(true);

    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);

    const listRef = useRef<HTMLDivElement | null>(null);

    // 1) load auth user
    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => setUser(data.user));
    }, []);

    const loadMessages = async () => {
        if (!sessionId) return;

        setLoading(true);

        // ВАЖНО: таблица названа так, потому что у тебя была функция purge_old_session_chat_messages()
        const { data, error } = await supabase
            .from("session_chat_messages")
            .select(
                `id, session_id, user_id, message, created_at,
         profiles ( full_name, avatar_url )`
            )
            .eq("session_id", sessionId)
            .order("created_at", { ascending: true });

        if (!error) setMessages((data as any) || []);
        setLoading(false);
    };

    // 2) initial load + realtime
    useEffect(() => {
        if (!sessionId) return;

        loadMessages();

        const channel = supabase.channel(`chat_realtime_${sessionId}`);

        channel.on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: "session_chat_messages",
                filter: `session_id=eq.${sessionId}`,
            },
            (payload) => {
                const row = payload.new as any;

                // Быстрое отображение: добавляем в список сразу
                // (но профиля может не быть в payload.new — тогда просто reload, чтобы подтянуть profiles join)
                setMessages((prev) => {
                    const exists = prev.some((m) => m.id === row?.id);
                    if (exists) return prev;

                    // если нет created_at — всё равно добавим, но лучше перезагрузить
                    return [...prev, row];
                });

                // Чтобы гарантированно были name/avatar — перезагрузим (лёгкий, но надёжный способ)
                loadMessages();
            }
        );

        channel.on(
            "postgres_changes",
            {
                event: "UPDATE",
                schema: "public",
                table: "session_chat_messages",
                filter: `session_id=eq.${sessionId}`,
            },
            () => {
                loadMessages();
            }
        );

        channel.on(
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
        );

        channel.subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    // 3) autoscroll when messages grow
    useEffect(() => {
        if (!listRef.current) return;
        listRef.current.scrollTop = listRef.current.scrollHeight;
    }, [messages.length]);

    const canSend = useMemo(() => {
        return !!sessionId && !!user?.id && text.trim().length > 0 && !sending;
    }, [sessionId, user?.id, text, sending]);

    const sendMessage = async () => {
        if (!canSend) return;

        const msg = text.trim();
        setSending(true);

        try {
            // оптимистично очистим input сразу
            setText("");

            const { error } = await supabase.from("session_chat_messages").insert([
                {
                    session_id: sessionId,
                    user_id: user.id,
                    message: msg,
                },
            ]);

            if (error) {
                console.error("sendMessage error:", error);
                // если ошибка — вернём текст обратно (чтобы не потерять)
                setText(msg);
            }
        } finally {
            setSending(false);
        }
    };

    return (
        // Как и IntentionsPanel: без собственного "хедера", RoomPage рисует header сам.
        <div className="h-full flex flex-col min-h-0">
            {/* messages */}
            <div
                ref={listRef}
                className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4"
            >
                {loading ? (
                    <div className="text-[12px] text-white/45 italic">Loading...</div>
                ) : messages.length === 0 ? (
                    <div className="text-[12px] text-white/45 italic">
                        No messages yet. Say hi 👋
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {messages.map((m) => {
                            const isMine = m.user_id === user?.id;
                            const name = isMine ? "You" : m.profiles?.full_name || "Participant";
                            const time = formatTime(m.created_at);

                            return (
                                <div
                                    key={m.id}
                                    className={
                                        "flex items-start gap-3 " + (isMine ? "justify-end" : "justify-start")
                                    }
                                >
                                    {!isMine && (
                                        <img
                                            src={getAvatar(m.profiles)}
                                            className="w-9 h-9 rounded-full object-cover"
                                            alt=""
                                        />
                                    )}

                                    <div className={isMine ? "max-w-[78%]" : "max-w-[78%]"}>
                                        <div className={"flex items-center gap-2 " + (isMine ? "justify-end" : "")}>
                                            <div className="text-[12px] text-white/70 font-medium truncate">
                                                {name}
                                            </div>
                                            <div className="text-[11px] text-white/40">{time}</div>
                                        </div>

                                        <div
                                            className={
                                                "mt-1 rounded-2xl border border-white/5 px-3 py-2.5 " +
                                                (isMine
                                                    ? "bg-emerald-500/15 text-white/90"
                                                    : "bg-[#0B1220]/70 text-white/85")
                                            }
                                        >
                                            <div className="text-[13px] whitespace-pre-wrap break-words">
                                                {m.message}
                                            </div>
                                        </div>
                                    </div>

                                    {isMine && (
                                        <img
                                            src={getAvatar({ full_name: user?.user_metadata?.full_name || "You" })}
                                            className="w-9 h-9 rounded-full object-cover"
                                            alt=""
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* input */}
            <div className="p-4 border-t border-white/5">
                <div className="flex items-end gap-2">
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Write a message..."
                        className="
              flex-1 min-h-[44px] max-h-[140px]
              bg-[#0B1220]/70 border border-white/10 rounded-xl
              px-3 py-3 text-[13px] text-white/85 placeholder:text-white/35
              outline-none focus:ring-1 focus:ring-[#4C9FFF]
              resize-none
            "
                        onKeyDown={(e) => {
                            // Enter = send, Shift+Enter = newline
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                sendMessage();
                            }
                        }}
                    />

                    <button
                        onClick={sendMessage}
                        disabled={!canSend}
                        className={
                            "h-11 px-5 rounded-xl font-semibold text-[13px] transition " +
                            (canSend
                                ? "bg-emerald-500 hover:bg-emerald-600 text-[#02140B]"
                                : "bg-[#111827] text-white/35 cursor-not-allowed")
                        }
                        type="button"
                        title="Send"
                    >
                        {sending ? "..." : "Send"}
                    </button>
                </div>

                <div className="mt-2 text-[11px] text-white/35">
                    Enter — send • Shift+Enter — new line
                </div>
            </div>
        </div>
    );
}

export default ChatPanel;
