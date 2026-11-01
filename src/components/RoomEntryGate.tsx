import { useLayoutEffect, useState, type ReactNode } from "react";

import { consumeRecentRoomResume } from "../lib/recentRoomResume";
import { RoomCrashBoundary } from "./RoomErrorBoundary";

const MOBILE_ROOM_LEASE_PREFIX = "mysession_mobile_room_lease:";

function clearRoomEntryRecoveryLease(sessionId: string) {
  if (typeof window === "undefined" || !sessionId) return;

  const prefix = `${MOBILE_ROOM_LEASE_PREFIX}${sessionId}:`;

  try {
    const matchingKeys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix)) matchingKeys.push(key);
    }
    matchingKeys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Storage can be unavailable in strict privacy modes. The room's own
    // prejoin default still applies when no persisted recovery lease is readable.
  }
}

/**
 * Every way into a room (/room-livekit/:id and a public /:slug link) goes
 * through here. Someone who was in this room within the last 20 minutes and
 * did not press Leave keeps the recovery lease, so the room rejoins with the
 * previous microphone/camera choice. Every other entry clears it and shows
 * prejoin.
 */
export function RoomEntryGate({ sessionId, children }: { sessionId: string; children: ReactNode }) {
  const id = String(sessionId || "").trim();
  const [preparedSessionId, setPreparedSessionId] = useState("");

  useLayoutEffect(() => {
    if (!consumeRecentRoomResume(id)) clearRoomEntryRecoveryLease(id);
    setPreparedSessionId(id);
  }, [id]);

  // Gate the room for one layout pass so a stale recovery lease can never
  // auto-skip prejoin on a fresh room entry.
  if (!id || preparedSessionId !== id) return null;

  return (
    <RoomCrashBoundary key={id} routeId={id}>
      {children}
    </RoomCrashBoundary>
  );
}
