// src/pages/LiveKit/screenShareHelpers.ts
import { Room, Track } from "livekit-client";

type ProfileLite = {
  full_name?: string | null;
};

function looksLikeUuid(v: string) {
  const s = String(v || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
}

function extractBaseUserIdFromIdentity(identity: string) {
  const s = String(identity || "").trim().toLowerCase();
  const m = s.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:--.*)?$/);
  if (m && m[1]) return m[1];
  return s;
}

export type ScreenShareTile = {
  id: string;
  kind: "screen";
  label: string;
  isLocal: boolean;
  videoTrack?: Track;
  participantIdentity?: string;
  participantUserId?: string;
  micMuted?: boolean;
  camPubExists?: boolean;
  camPubMuted?: boolean;
  camPubHasTrack?: boolean;
};

export function buildScreenShareTiles(args: {
  room: Room;
  authUserId?: string | null;
  displayName?: string;
  userName?: string;
  profilesById?: Record<string, ProfileLite>;
}): ScreenShareTile[] {
  const { room, authUserId, displayName, userName, profilesById = {} } = args;
  const out: ScreenShareTile[] = [];

  const lp = room.localParticipant;
  const localScreenPub = Array.from(lp.videoTrackPublications.values()).find(
    (p: any) => p.source === Track.Source.ScreenShare
  ) as any;

  if (localScreenPub?.track && !localScreenPub?.isMuted) {
    const localIdentity = String(lp.identity || "");
    const localUserId =
      authUserId && looksLikeUuid(authUserId)
        ? String(authUserId).toLowerCase()
        : extractBaseUserIdFromIdentity(localIdentity);

    out.push({
      id: "local-screen",
      kind: "screen",
      label: `${(displayName || userName || "You").trim() || "You"} • Screen`,
      isLocal: true,
      videoTrack: localScreenPub.track,
      participantIdentity: localIdentity || undefined,
      participantUserId: localUserId || undefined,
      micMuted: true,
      camPubExists: true,
      camPubMuted: false,
      camPubHasTrack: true,
    });
  }

  room.remoteParticipants.forEach((rp) => {
    const screenPub = Array.from(rp.videoTrackPublications.values()).find(
      (p: any) => p.source === Track.Source.ScreenShare
    ) as any;

    if (!screenPub?.track || !!screenPub?.isMuted) return;

    const identity = String(rp.identity || "");
    const baseUserId = extractBaseUserIdFromIdentity(identity);
    const profile = looksLikeUuid(baseUserId) ? profilesById[baseUserId] : undefined;
    const name = String(profile?.full_name || rp.name || rp.identity || "Guest").trim() || "Guest";

    out.push({
      id: `${rp.sid}__screen`,
      kind: "screen",
      label: `${name} • Screen`,
      isLocal: false,
      videoTrack: screenPub.track,
      participantIdentity: identity || undefined,
      participantUserId: baseUserId || undefined,
      micMuted: true,
      camPubExists: true,
      camPubMuted: false,
      camPubHasTrack: true,
    });
  });

  return out;
}