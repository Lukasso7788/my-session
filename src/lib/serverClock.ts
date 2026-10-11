/**
 * Offset between the server clock and this device, measured from a same-origin
 * HTTP Date header. Session start/end times come from the server, so room
 * timing (auto-close, join window, stage display) must not depend on a device
 * clock that runs ahead or behind.
 */

// The HTTP Date header has one-second resolution; smaller differences are noise.
const MIN_SKEW_MS = 2_000;
const MAX_ROUND_TRIP_MS = 10_000;

let offsetMs = 0;
let loadPromise: Promise<number> | null = null;

export function computeServerClockOffset(
  dateHeader: string | null | undefined,
  requestStartedAt: number,
  responseReceivedAt: number,
): number | null {
  const serverMs = Date.parse(String(dateHeader || ""));
  if (!Number.isFinite(serverMs)) return null;
  const roundTripMs = responseReceivedAt - requestStartedAt;
  if (!Number.isFinite(roundTripMs) || roundTripMs < 0 || roundTripMs > MAX_ROUND_TRIP_MS) return null;

  // The header truncates to the second, so assume the middle of that second.
  const midpoint = requestStartedAt + roundTripMs / 2;
  const offset = serverMs + 500 - midpoint;
  return Math.abs(offset) < MIN_SKEW_MS ? 0 : Math.round(offset);
}

export function getServerClockOffsetMs(): number {
  return offsetMs;
}

export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** Measures once per page load; later calls share the first result. */
export function loadServerClockOffset(): Promise<number> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    if (typeof window === "undefined" || typeof fetch !== "function") return offsetMs;
    try {
      const requestStartedAt = Date.now();
      // Vercel serves this static file with the edge's current time in Date.
      const response = await fetch(`/robots.txt?clock=${requestStartedAt}`, {
        method: "HEAD",
        cache: "no-store",
      });
      const next = computeServerClockOffset(
        response.headers.get("date"),
        requestStartedAt,
        Date.now(),
      );
      if (next !== null) offsetMs = next;
    } catch {
      // Keep the device clock when the measurement fails.
    }
    return offsetMs;
  })();
  return loadPromise;
}
