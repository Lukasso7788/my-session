import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type MessageChange = RealtimePostgresChangesPayload<Record<string, unknown>>;
type Listener = {
  onChange: (payload: MessageChange) => void;
  onStatus?: (status: string) => void;
};
type Subscription = {
  channel: RealtimeChannel;
  listeners: Set<Listener>;
  status: string | null;
  closeTimer: ReturnType<typeof setTimeout> | null;
};

const subscriptions = new Map<string, Subscription>();
let subscriptionGeneration = 0;

/** Share one database subscription between the chat panel and unread counter. */
export function subscribeToChatMessages(
  sessionId: string,
  onChange: Listener["onChange"],
  onStatus?: Listener["onStatus"],
) {
  const listener: Listener = { onChange, onStatus };
  let subscription = subscriptions.get(sessionId);
  const isNew = !subscription;
  if (!subscription) {
    subscription = {
      channel: supabase.channel(`room-chat-messages:${sessionId}:${++subscriptionGeneration}`),
      listeners: new Set(),
      status: null,
      closeTimer: null,
    };
    subscriptions.set(sessionId, subscription);
  }
  const current = subscription;
  if (current.closeTimer !== null) clearTimeout(current.closeTimer);
  current.closeTimer = null;
  current.listeners.add(listener);

  if (isNew) {
    current.channel.on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "session_chat_messages",
      filter: `session_id=eq.${sessionId}`,
    }, (payload) => {
      for (const consumer of current.listeners) {
        try {
          consumer.onChange(payload);
        } catch (error) {
          console.warn("[chat] Realtime consumer failed", error);
        }
      }
    }).subscribe((status) => {
      current.status = status;
      for (const consumer of current.listeners) consumer.onStatus?.(status);
    });
  } else if (current.status) {
    queueMicrotask(() => {
      if (current.listeners.has(listener) && current.status) onStatus?.(current.status);
    });
  }

  return () => {
    if (!current.listeners.delete(listener) || current.listeners.size > 0) return;
    // Panel/PiP transfers and StrictMode remounts reuse the live subscription.
    current.closeTimer = setTimeout(() => {
      current.closeTimer = null;
      if (current.listeners.size > 0) return;
      subscriptions.delete(sessionId);
      void supabase.removeChannel(current.channel);
    }, 500);
  };
}
