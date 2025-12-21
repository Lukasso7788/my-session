// src/components/ChatPanel.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

type Msg = {
    id: string;
    session_id: string;
    user_id: string;
    body: string;
    created_at: string;
    profiles?: { full_name?: string; avatar_url?: string } | null;
};

function iso30DaysAgo() {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString();
}

function avatarFromProfile(profile?: { full_name?: string; avatar_url?: string } | null) {
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

export function ChatPanel({ sessionId }: { sessionId: string }) {
    const [userId, setUserId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Msg[]>([]);
    const [text, setText] = useState("");
    const [loading, setLoading] = useState(true);

    const bottomRef = useRef<HTMLDivElement | null>(null);

    // auth user id
    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    }, []);

    const load = async () => {
        if (!sessionId) return;

        setLoading(true);

        const { data, error } = await supabase
            .from("session_chat_messages")
            .select("id, session_id, user_id, body, created_at, profiles(full_name, avatar_url)")
            .eq("session_id", sessionId)
            .gte("created_at", iso30DaysAgo())
            .order("created_at", { ascending: true });

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
                // чтобы ты видел, подключился ли realtime
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

        const { error } = await supabase.from("session_chat_messages").insert({
            session_id: sessionId,
            user_id: userId,
            body, // ВАЖНО: body, НЕ message
        });

        if (error) {
            console.error("chat send error:", error);
            return;
        }

        setText("");
        // load() не обязателен (realtime поймает), но можно оставить:
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
                    const name = mine ? "You" : m.profiles?.full_name || "Participant";
                    const time = formatTime(m.created_at);

                    return (
                        <div key={m.id} className={"flex items-start gap-3 " + (mine ? "justify-end" : "justify-start")}>
                            {!mine && (
                                <img
                                    src={avatarFromProfile(m.profiles)}
                                    className="w-9 h-9 rounded-full object-cover"
                                    alt=""
                                />
                            )}

                            <div
                                className={
                                    "max-w-[82%] rounded-2xl px-3 py-2 text-[13px] leading-snug border " +
                                    (mine
                                        ? "bg-emerald-500/15 border-emerald-400/20 text-white/90"
                                        : "bg-white/5 border-white/10 text-white/85")
                                }
                            >
                                <div className={"flex items-center gap-2 mb-1 " + (mine ? "justify-end" : "justify-start")}>
                                    <div className="text-[11px] text-white/55">{name}</div>
                                    <div className="text-[11px] text-white/35">{time}</div>
                                </div>
                                <div className="whitespace-pre-wrap break-words">{m.body}</div>
                            </div>

                            {mine && (
                                <img
                                    src={avatarFromProfile({
                                        full_name: "You",
                                        avatar_url: null as any,
                                    })}
                                    className="w-9 h-9 rounded-full object-cover opacity-0"
                                    alt=""
                                />
                            )}
                        </div>
                    );
                })}

                <div ref={bottomRef} />
            </div>

            {/* INPUT */}
            <div className="p-4 border-t border-white/5">
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
              outline-none text-white/85 placeholder:text-white/35
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
