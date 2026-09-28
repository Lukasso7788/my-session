type AuthStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredAuthSession = {
  access_token?: unknown;
  expires_at?: unknown;
  expires_in?: unknown;
};

// GoTrue's absolute expires_at uses server time, while auth-js compares it to
// Date.now() on the device. A badly skewed clock can make every fresh token
// appear expired, triggering a refresh loop. expires_in is a relative lifetime.
// This adapter changes only the SDK's local refresh schedule, never the JWT or
// the server-side expiration/authorization decision.
export function createClockSafeAuthStorage(
  storage: AuthStorage,
  sessionKey: string,
  nowMs: () => number = Date.now,
): AuthStorage {
  return {
    getItem: (key) => storage.getItem(key),
    removeItem: (key) => storage.removeItem(key),
    setItem: (key, value) => {
      if (key !== sessionKey) {
        storage.setItem(key, value);
        return;
      }

      try {
        const session = JSON.parse(value) as StoredAuthSession;
        const token = session?.access_token;
        const expiresIn = Number(session?.expires_in);
        const expiresAt = Number(session?.expires_at);
        if (
          typeof token !== "string" || !token ||
          !Number.isFinite(expiresIn) || expiresIn <= 0 ||
          !Number.isFinite(expiresAt) || expiresAt <= 0
        ) {
          storage.setItem(key, value);
          return;
        }

        const localExpectedExpiry = Math.round(nowMs() / 1000) + expiresIn;
        // A device behind the server by more than ~30 seconds could otherwise
        // spend most of the SDK's 90-second refresh margin before the real JWT
        // expires. Small clock differences keep the SDK's original timestamp.
        if (Math.abs(expiresAt - localExpectedExpiry) <= 30) {
          storage.setItem(key, value);
          return;
        }

        const previous = storage.getItem(key);
        let previousSession: StoredAuthSession | null = null;
        try {
          previousSession = previous ? JSON.parse(previous) as StoredAuthSession : null;
        } catch {
          // A damaged old value must not prevent a fresh token from recovering.
        }
        if (
          previousSession?.access_token === token &&
          Number.isFinite(Number(previousSession.expires_at)) &&
          Number(previousSession.expires_at) > 0
        ) {
          // updateUser can re-save the same token later. Never extend its local
          // lifetime by treating the original expires_in as a new full lifetime.
          session.expires_at = previousSession.expires_at;
        } else {
          // Refresh a little early to allow for network delay and SDK's own
          // 90-second margin. Only use this when server/device clocks differ.
          const safetySeconds = Math.min(60, Math.floor(expiresIn * 0.05));
          session.expires_at = localExpectedExpiry - safetySeconds;
        }
        storage.setItem(key, JSON.stringify(session));
      } catch {
        // Storage and malformed values retain the SDK's normal behavior.
        storage.setItem(key, value);
      }
    },
  };
}
