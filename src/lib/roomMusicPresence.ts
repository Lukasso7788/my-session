// The Sessions list already listens on this Realtime topic for host leases.
// Presence carries only an opaque room key while shared music is actually on;
// it needs no Postgres row, polling, or extra subscription on the listing page.
export const SESSION_LIVE_STATUS_CHANNEL = "sessions-active-hosts";
const MUSIC_KEY_PREFIX = "shared-music:";

export async function roomMusicPresenceKey(sessionId: string): Promise<string> {
  // Avoid exposing even private/hidden session IDs in a public Presence payload.
  const normalized = sessionId.trim().toLowerCase();
  if (!normalized) throw new Error("A session ID is required for music presence.");
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized),
  );
  return MUSIC_KEY_PREFIX +
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function sharedRoomMusicActive(
  connected: boolean,
  roomTrackId: string | null,
  roomTrackPlaying: boolean,
  sharingTabMusic: boolean,
  remoteTabMusicActive: boolean,
): boolean {
  // A personal "For me" soundtrack never advertises music for the room.
  return connected && ((!!roomTrackId && roomTrackPlaying) || sharingTabMusic || remoteTabMusicActive);
}

export function musicSessionIdsFromPresence(
  state: Record<string, unknown>,
  visibleSessionsByKey: ReadonlyMap<string, string>,
): Set<string> {
  const active = new Set<string>();
  for (const [key, payloads] of Object.entries(state)) {
    const sessionId = visibleSessionsByKey.get(key);
    if (!sessionId || !Array.isArray(payloads)) continue;
    if (payloads.some((payload) =>
      !!payload && typeof payload === "object" && (payload as { playing?: unknown }).playing === true
    )) {
      active.add(sessionId);
    }
  }
  return active;
}

export function sameSessionIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}
import type { SupabaseClient } from "@supabase/supabase-js";


export function advertiseSharedMusic(
  client: Pick<SupabaseClient, "channel" | "removeChannel">,
  sessionId: string,
): () => void {
  let disposed = false;
  let channel: ReturnType<SupabaseClient["channel"]> | null = null;

  // Only called while shared music is active. Re-track on a Realtime reconnect,
  // and never track from a late async callback after the room has left.
  void roomMusicPresenceKey(sessionId).then((key) => {
    if (disposed) return;
    const next = client.channel(SESSION_LIVE_STATUS_CHANNEL, {
      config: { presence: { key, enabled: false } },
    });
    channel = next;
    next.subscribe((status) => {
      if (status === "SUBSCRIBED" && !disposed) {
        void next.track({ playing: true }).catch(() => {});
      }
    });
  }).catch(() => {
    // WebCrypto or Realtime unavailable: playback remains unaffected.
  });

  return () => {
    disposed = true;
    if (channel) void client.removeChannel(channel);
  };
}
