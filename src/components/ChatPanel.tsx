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

export function ChatPanel({ sessionId }: { sessionId: string }) {
    const [userId, setUserId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Msg[]>([]);
    const [text, setText] = useState("");
    const [loading, setLoading] = useState(true);

    const bottomRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    }, []);

    const load = async () => {
        setLoading(true);

        const { data, error } = await supabase
            .from("session_chat_messages")
            .select("id, session_id, user_id, body, created_at, profiles(full_name, avatar_url)")
            .eq("session_id", sessionId)
            .gte("created_at", iso30DaysAgo())
            .order("created_at", { ascending: true });

        if (error) console.error("chat load error:", error);
        setMessages((data as any) || []);
        setLoading(false);
    };

    useEffect(() => {
        if (!sessionId) return;
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    useEffect(() => {
        if (!sessionId) return;

        const ch = supabase
            .channel(`chat:${sessionId}`)
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "session_chat_messages", filter: `session_id=eq.${sessionId}` },
                () => load()
            )
            .subscribe();

        return () => {
            supabase.removeChannel(ch);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages.length]);

    const send = async () => {
        const body = text.trim();
        if (!body || !userId) return;

        const { error } = await supabase.from("session_chat_messages").insert({
            session_id: sessionId,
            user_id: userId,
            body,
        });

        if (error) {
            console.error("chat send error:", error);
            return;
        }
        setText("");
    };

    const uiMessages = useMemo(() => messages, [messages]);

    return (
        <div className="h-full flex flex-col bg-transparent">
            <div className="px-5 py-4 border-b border-white/5">
                <div className="text-white/85 font-inter font-semibold">Chat</div>
                <div className="text-white/45 text-[12px]">History: last 30 days</div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
                {loading && <div className="text-white/40 text-sm italic">Loading…</div>}

                {!loading && uiMessages.length === 0 && (
                    <div className="text-white/40 text-sm italic">No messages yet</div>
                )}

                {uiMessages.map((m) => {
                    const mine = m.user_id === userId;
                    const name = mine ? "You" : m.profiles?.full_name || "Participant";

                    return (
                        <div key={m.id} className={"flex " + (mine ? "justify-end" : "justify-start")}>
                            <div
                                className={
                                    "max-w-[82%] rounded-2xl px-3 py-2 text-[13px] leading-snug border " +
                                    (mine
                                        ? "bg-emerald-500/15 border-emerald-400/20 text-white/90"
                                        : "bg-white/5 border-white/10 text-white/85")
                                }
                            >
                                <div className="text-[11px] text-white/45 mb-1">{name}</div>
                                <div className="whitespace-pre-wrap break-words">{m.body}</div>
                            </div>
                        </div>
                    );
                })}

                <div ref={bottomRef} />
            </div>

            <div className="p-4 border-t border-white/5">
                <div className="flex items-center gap-2">
                    <input
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && send()}
                        placeholder="Write a message…"
                        className="flex-1 h-11 rounded-xl bg-[#0B1220]/70 border border-white/10 px-3 text-[13px] outline-none text-white/85 placeholder:text-white/35 focus:border-emerald-400/40"
                    />
                    <button
                        onClick={send}
                        className="h-11 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-[#02140B] font-semibold"
                    >
                        Send
                    </button>
                </div>
            </div>
        </div>
    );
}
