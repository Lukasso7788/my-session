import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { SendHorizontal } from "lucide-react";
import { supabase } from "../../lib/supabase";

type PiPChatMessage = {
  id: string;
  session_id: string;
  user_id: string;
  body: string;
  created_at: string;
  scope?: "general" | "direct" | null;
};

type PiPChatProfile = {
  id: string;
  full_name?: string | null;
  avatar_url?: string | null;
};

const MESSAGE_LIMIT = 100;

function formatMessageTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function avatarFor(profile?: PiPChatProfile | null) {
  return (
    profile?.avatar_url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.full_name || "Participant")}`
  );
}

function LiveKitPiPChatContent({
  sessionId,
  userId,
}: {
  sessionId: string;
  userId: string | null;
}) {
  const [messages, setMessages] = useState<PiPChatMessage[]>([]);
  const [profiles, setProfiles] = useState<Record<string, PiPChatProfile>>({});
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);

  const loadProfiles = useCallback(async (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids.map(String).filter(Boolean)));
    if (!uniqueIds.length) return;

    const { data, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", uniqueIds);

    if (profileError || !mountedRef.current) return;

    setProfiles((previous) => {
      const next = { ...previous };
      for (const profile of (data || []) as PiPChatProfile[]) {
        next[String(profile.id)] = profile;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    const loadLatest = async () => {
      setLoading(true);
      setError("");

      const { data, error: messagesError } = await supabase
        .from("session_chat_messages")
        .select("id, session_id, user_id, body, created_at, scope")
        .eq("session_id", sessionId)
        .or("scope.is.null,scope.eq.general")
        .order("created_at", { ascending: false })
        .limit(MESSAGE_LIMIT);

      if (cancelled) return;
      if (messagesError) {
        setError("Could not load chat");
        setLoading(false);
        return;
      }

      const latest = ((data || []) as PiPChatMessage[]).slice().reverse();
      setMessages(latest);
      setLoading(false);
      void loadProfiles(latest.map((message) => message.user_id));
    };

    void loadLatest();

    const channel = supabase
      .channel(`pip-chat:${sessionId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "session_chat_messages",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload: { new: PiPChatMessage }) => {
          const incoming = payload?.new;
          if (!incoming?.id || incoming.scope === "direct") return;

          setMessages((previous) => {
            if (previous.some((message) => message.id === incoming.id)) {
              return previous;
            }

            const optimisticIndex = previous.findIndex(
              (message) =>
                message.id.startsWith("pip-optimistic-") &&
                message.user_id === incoming.user_id &&
                message.body === incoming.body,
            );

            const next = [...previous];
            if (optimisticIndex >= 0) next[optimisticIndex] = incoming;
            else next.push(incoming);
            return next.slice(-MESSAGE_LIMIT);
          });
          void loadProfiles([incoming.user_id]);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      void supabase.removeChannel(channel);
    };
  }, [loadProfiles, sessionId]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const ownerWindow = list.ownerDocument.defaultView;
    const scroll = () => {
      list.scrollTop = list.scrollHeight;
    };

    scroll();
    const firstFrame = ownerWindow?.requestAnimationFrame(scroll);
    const secondFrame = ownerWindow?.requestAnimationFrame(scroll);

    return () => {
      if (firstFrame != null) ownerWindow?.cancelAnimationFrame(firstFrame);
      if (secondFrame != null) ownerWindow?.cancelAnimationFrame(secondFrame);
    };
  }, [loading, messages.length]);

  const sendMessage = async () => {
    const body = text.trim();
    if (!body || !userId || sending) return;

    const optimistic: PiPChatMessage = {
      id: `pip-optimistic-${Date.now()}`,
      session_id: sessionId,
      user_id: userId,
      body,
      created_at: new Date().toISOString(),
      scope: "general",
    };

    setSending(true);
    setError("");
    setText("");
    setMessages((previous) => [...previous, optimistic].slice(-MESSAGE_LIMIT));

    const { error: sendError } = await supabase
      .from("session_chat_messages")
      .insert({
        session_id: sessionId,
        user_id: userId,
        body,
        created_at: optimistic.created_at,
        scope: "general",
        dm_peer_user_id: null,
      });

    if (sendError) {
      setMessages((previous) =>
        previous.filter((message) => message.id !== optimistic.id),
      );
      setText(body);
      setError("Message was not sent");
    }
    setSending(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#F3F1F1] text-[#1F1F1F]">
      <div
        ref={listRef}
        className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 py-3"
      >
        {loading ? (
          <div className="py-4 text-center text-xs text-black/45">Loading chat…</div>
        ) : null}

        {!loading && messages.length === 0 ? (
          <div className="py-4 text-center text-xs text-black/45">
            No messages yet
          </div>
        ) : null}

        {messages.map((message) => {
          const mine = message.user_id === userId;
          const profile = profiles[message.user_id];
          return (
            <div
              key={message.id}
              className={`flex items-start gap-2 ${mine ? "justify-end" : "justify-start"}`}
            >
              {!mine ? (
                <img
                  src={avatarFor(profile)}
                  alt=""
                  className="h-7 w-7 shrink-0 rounded-full object-cover"
                />
              ) : null}
              <div className="max-w-[82%] min-w-0">
                <div className={`mb-1 flex gap-2 text-[10px] text-black/40 ${mine ? "justify-end" : "justify-start"}`}>
                  <span className="truncate">
                    {mine ? "You" : profile?.full_name || "Participant"}
                  </span>
                  <span className="shrink-0">{formatMessageTime(message.created_at)}</span>
                </div>
                <div
                  className={`whitespace-pre-wrap break-words rounded-2xl border px-3 py-2 text-[12px] leading-snug ${mine
                    ? "border-[#81DB86]/60 bg-[#81DB86]/16 text-black/85"
                    : "border-[#D8D0D0] bg-[#ECEAEA] text-black/80"
                    }`}
                >
                  {message.body}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-[#D8D0D0] bg-[#F3F1F1] p-3">
        {error ? (
          <div className="mb-2 text-[11px] font-medium text-red-600">{error}</div>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            rows={1}
            placeholder={userId ? "Write a message…" : "Sign in to chat"}
            disabled={!userId || sending}
            className="max-h-24 min-h-[40px] flex-1 resize-none rounded-xl border border-[#D8D0D0] bg-white px-3 py-2 text-[12px] text-black/85 outline-none placeholder:text-black/35 focus:border-[#81DB86] focus:ring-1 focus:ring-[#81DB86] disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={!text.trim() || !userId || sending}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#81DB86] text-[#143818] transition hover:bg-[#72CF78] disabled:cursor-not-allowed disabled:opacity-45"
            title="Send message"
            aria-label="Send message"
          >
            <SendHorizontal size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}

class PiPChatErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="flex h-full items-center justify-center bg-[#F3F1F1] px-6 text-center text-xs text-black/55">
          Chat is temporarily unavailable. Video and room controls are still active.
        </div>
      );
    }

    return this.props.children;
  }
}

export default function LiveKitPiPChat(props: {
  sessionId: string;
  userId: string | null;
}) {
  return (
    <PiPChatErrorBoundary>
      <LiveKitPiPChatContent {...props} />
    </PiPChatErrorBoundary>
  );
}
