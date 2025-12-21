// src/components/ChatPanel.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

type ChatPanelProps = {
    sessionId: string;
};

/**
 * IMPORTANT:
 * - поменяй TABLE_NAME на твоё реальное имя таблицы, если отличается.
 *   (судя по твоим SQL функциям, похоже это session_chat_messages)
 */
const TABLE_NAME = "session_chat_messages";

type ChatMessageRow = {
    id: string;
    session_id: string;
    user_id: string;
    message: string;
    created_at?: string;
};

type Profile = {
    full_name?: string;
    avatar_url?: string;
};

type ChatMessage = ChatMessageRow & {
    profiles?: Profile | null;
};

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

export function ChatPanel({ sessionId }: ChatPanelProps) {
    const [user, setUser] = useState<any>(null);

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(true);

    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);

    const listRef = useRef<HTMLDivElement | null>(null);

    // ---- 1) auth user
    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => setUser(data.user));
    }, []);

    // ---- 2) load messages
    const loadMessages = async () => {
        if (!sessionId) return;

        setLoading(true);

        /**
         * Тут самый частый источник "чат пустой":
         * 1) table name отличается
         * 2) column name отличается (message/text/body)
         * 3) RLS не даёт SELECT
         *
         * Мы специально логируем ошибку и данные — чтобы ты увидел в консоли.
         */
        const { data, error } = await supabase
            .from(TABLE_NAME)
            .select(
                `id, session_id, user_id, message, created_at,
         profiles ( full_name, avatar_url )`
            )
            .eq("session_id", sessionId)
            .order("created_at", { ascending: true });

        if (error) {
            console.error("[ChatPanel] loadMessages error:", error);
            setMessages([]);
            setLoading(false);
            return;
        }

        console.log("[ChatPanel] loadMessages ok, rows:", data?.length ?? 0);
        setMessages((data as any) || []);
        setLoading(false);
    };

    // ---- 3) realtime subscription
    useEffect(() => {
        if (!sessionId) return;

        loadMessages();

        const channel = supabase.channel(`chat_realtime_${sessionId}`);

        // INSERT
        channel.on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: TABLE_NAME,
                filter: `session_id=eq.${sessionId}`,
            },
            (payload) => {
                console.log("[ChatPanel] realtime INSERT:", payload);
                // payload.new обычно без join profiles, поэтому просто reload
                loadMessages();
            }
        );

        // UPDATE
        channel.on(
            "postgres_changes",
            {
                event: "UPDATE",
                schema: "public",
                table: TABLE_NAME,
                filter: `session_id=eq.${sessionId}`,
            },
            (payload) => {
                console.log("[ChatPanel] realtime UPDATE:", payload);
                loadMessages();
            }
        );

        // DELETE
        channel.on(
            "postgres_changes",
            {
                event: "DELETE",
                schema: "public",
                table: TABLE_NAME,
                filter: `session_id=eq.${sessionId}`,
            },
            (payload: any) => {
                console.log("[ChatPanel] realtime DELETE:", payload);
                const deletedId = payload?.old?.id;
                if (!deletedId) return;
                setMessages((prev) => prev.filter((m) => m.id !== deletedId));
            }
        );

        channel.subscribe((status) => {
            console.log("[ChatPanel] channel status:", status);
        });

        return () => {
            supabase.removeChannel(channel);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    // ---- autoscroll
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
            setText("");

            const { error } = await supabase.from(TABLE_NAME).insert([
                {
                    session_id: sessionId,
                    user_id: user.id,
                    message: msg,
                },
            ]);

            if (error) {
                console.error("[ChatPanel] sendMessage error:", error);
                setText(msg);
                return;
            }

            // на всякий случай сразу reload (если realtime не сработал)
            loadMessages();
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="h-full flex flex-col min-h-0">
            {/* MESSAGES */}
            <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4">
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
                                            src={avatarFromProfile(m.profiles)}
                                            className="w-9 h-9 rounded-full object-cover"
                                            alt=""
                                        />
                                    )}

                                    <div className="max-w-[78%]">
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
                                            <div className="text-[13px] whitespace-pre-wrap break-words leading-5">
                                                {m.message}
                                            </div>
                                        </div>
                                    </div>

                                    {isMine && (
                                        <img
                                            src={avatarFromProfile({
                                                full_name:
                                                    user?.user_metadata?.full_name ||
                                                    user?.user_metadata?.name ||
                                                    "You",
                                            })}
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

            {/* INPUT */}
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
              outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500
              resize-none
            "
                        onKeyDown={(e) => {
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
