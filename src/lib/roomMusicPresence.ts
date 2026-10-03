import type { SupabaseClient } from "@supabase/supabase-js";

// Shared music status is ephemeral: Presence adds no database writes.
export const SESSION_LIVE_STATUS_CHANNEL = "sessions-active-hosts";
const MUSIC_KEY_PREFIX = "shared-music:";

export async function roomMusicPresenceKey(sessionId: string): Promise<string> {
  const normalized = sessionId.trim().toLowerCase();
  if (!normalized) throw new Error("A session ID is required for music presence.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return MUSIC_KEY_PREFIX + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function sharedRoomMusicActive(
  connected: boolean,
  roomTrackId: string | null,
  roomTrackPlaying: boolean,
  canControlRoomSoundtrack: boolean,
  sharingTabMusic: boolean,
): boolean {
  // Only the shared soundtrack controller or tab-audio publisher advertises.
  // A listener's local/personal player must not create a second presence.
  return connected && ((!!roomTrackId && roomTrackPlaying && canControlRoomSoundtrack) || sharingTabMusic);
}

export function musicSessionIdsFromPresence(
  state: Record<string, unknown>,
  visibleSessionsByKey: ReadonlyMap<string, string>,
): Set<string> {
  const active = new Set<string>();
  for (const [key, payloads] of Object.entries(state)) {
    const sessionId = visibleSessionsByKey.get(key);
    if (!sessionId || !Array.isArray(payloads)) continue;
    if (payloads.some((payload) => !!payload && typeof payload === "object" && (payload as { playing?: unknown }).playing === true)) {
      active.add(sessionId);
    }
  }
  return active;
}

export function sameSessionIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

export function advertiseSharedMusic(
  client: Pick<SupabaseClient, "channel" | "removeChannel">,
  sessionId: string,
): () => void {
  let disposed = false;
  let channel: ReturnType<SupabaseClient["channel"]> | null = null;

  void roomMusicPresenceKey(sessionId).then((key) => {
    if (disposed) return;
    const next = client.channel(SESSION_LIVE_STATUS_CHANNEL, {
      // This publisher has no presence event handler, so realtime-js will
      // otherwise subscribe with Presence disabled even if track() is called.
      config: { presence: { key, enabled: true } },
    });
    channel = next;
    next.subscribe((status) => {
      // Re-track once per subscription/reconnect; removing the channel
      // withdraws the indicator promptly when playback stops or room exits.
      if (status === "SUBSCRIBED" && !disposed) {
        void next.track({ playing: true }).catch(() => {});
      }
    });
  }).catch(() => {
    // Presence/WebCrypto failure must not affect the room's actual playback.
  });

  return () => {
    disposed = true;
    if (channel) void client.removeChannel(channel);
  };
}
