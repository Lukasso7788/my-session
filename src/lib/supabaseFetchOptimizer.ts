type ResponseSnapshot = {
  body: ArrayBuffer;
  headers: [string, string][];
  status: number;
  statusText: string;
};

type CacheEntry = {
  expiresAt: number;
  snapshot: ResponseSnapshot;
};

type RequestPolicy = {
  ttlMs: number;
  coalesceDelayMs: number;
};

const responseCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ResponseSnapshot>>();

const MAX_CACHE_ENTRIES = 220;

let hostLeaseGeneration = 0;

export function invalidateHostLeaseCache() {
  hostLeaseGeneration += 1;
  for (const key of responseCache.keys()) {
    if (key.includes("/infinite_room_host_leases") || key.includes("/rpc/heartbeat_infinite_room_host")) responseCache.delete(key);
  }
  for (const key of inFlight.keys()) {
    if (key.includes("/infinite_room_host_leases") || key.includes("/rpc/heartbeat_infinite_room_host")) inFlight.delete(key);
  }
}

function getRequestUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return input.url;
  return String(input);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return String(init.method).toUpperCase();
  if (input instanceof Request) return String(input.method || "GET").toUpperCase();
  return "GET";
}

function requestPolicy(method: string, pathname: string): RequestPolicy {
  if (method === "GET") {
    // Realtime task updates can emit several events at once. Hold the first
    // request briefly so the whole burst shares one fresh database response.
    // Do not keep a post-response cache here: a later remote task change must
    // always be able to trigger a fresh read.
    if (pathname === "/rest/v1/panel_intentions") {
      return { ttlMs: 0, coalesceDelayMs: 700 };
    }
    if (pathname === "/rest/v1/intention_encouragements") {
      return { ttlMs: 0, coalesceDelayMs: 500 };
    }
    if (pathname === "/rest/v1/intentions") {
      return { ttlMs: 0, coalesceDelayMs: 300 };
    }
    if (pathname === "/rest/v1/session_chat_message_reactions") {
      return { ttlMs: 0, coalesceDelayMs: 300 };
    }

    if (pathname === "/rest/v1/infinite_room_host_leases") {
      return { ttlMs: 15_000, coalesceDelayMs: 0 };
    }
    if (pathname === "/rest/v1/user_entitlements") {
      return { ttlMs: 60_000, coalesceDelayMs: 0 };
    }
    if (pathname === "/rest/v1/user_weekly_usage") {
      return { ttlMs: 60_000, coalesceDelayMs: 0 };
    }
    if (pathname === "/rest/v1/account_access_controls") {
      return { ttlMs: 60_000, coalesceDelayMs: 0 };
    }
    if (pathname === "/rest/v1/profiles") {
      return { ttlMs: 30_000, coalesceDelayMs: 0 };
    }
    if (pathname === "/rest/v1/session_attendance") {
      return { ttlMs: 10_000, coalesceDelayMs: 0 };
    }
  }

  if (method === "POST") {
    // Normal attendance cadence is 30s, so 20s only suppresses duplicate
    // remount/visibility heartbeats, not the regular presence refresh.
    if (pathname === "/rest/v1/rpc/attendance_heartbeat") {
      return { ttlMs: 20_000, coalesceDelayMs: 0 };
    }
    if (pathname === "/rest/v1/rpc/heartbeat_infinite_room_host") {
      return { ttlMs: 8_000, coalesceDelayMs: 0 };
    }
    if (pathname === "/rest/v1/rpc/get_lifetime_attendance_count") {
      return { ttlMs: 60_000, coalesceDelayMs: 0 };
    }
  }

  return { ttlMs: 0, coalesceDelayMs: 0 };
}

async function snapshotResponse(response: Response): Promise<ResponseSnapshot> {
  const headers: [string, string][] = [];
  response.headers.forEach((value, key) => headers.push([key, value]));
  return {
    body: await response.arrayBuffer(),
    headers,
    status: response.status,
    statusText: response.statusText,
  };
}

function responseFromSnapshot(snapshot: ResponseSnapshot) {
  const body = snapshot.body.byteLength ? snapshot.body.slice(0) : null;
  return new Response(body, {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: snapshot.headers,
  });
}

function pruneCache(now = Date.now()) {
  for (const [key, entry] of responseCache) {
    if (entry.expiresAt <= now) responseCache.delete(key);
  }
  while (responseCache.size > MAX_CACHE_ENTRIES) {
    const firstKey = responseCache.keys().next().value as string | undefined;
    if (!firstKey) break;
    responseCache.delete(firstKey);
  }
}

async function requestBodyKey(request: Request, method: string) {
  if (method === "GET" || method === "HEAD") return "";
  try {
    return await request.clone().text();
  } catch {
    return "";
  }
}

function wait(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export const optimizedSupabaseFetch: typeof fetch = async (input, init) => {
  const method = requestMethod(input, init);
  const rawUrl = getRequestUrl(input);
  let pathname = "";

  try {
    pathname = new URL(
      rawUrl,
      typeof window !== "undefined" ? window.location.origin : "http://localhost",
    ).pathname;
  } catch {
    return fetch(input, init);
  }

  const policy = requestPolicy(method, pathname);
  const leaseGeneration = hostLeaseGeneration;
  const isLeaseRequest = pathname === "/rest/v1/infinite_room_host_leases" || pathname === "/rest/v1/rpc/heartbeat_infinite_room_host";
  if (!policy.ttlMs && !policy.coalesceDelayMs) return fetch(input, init);

  const request = input instanceof Request && !init ? input : new Request(input, init);
  const auth = request.headers.get("authorization") || "";
  const bodyKey = await requestBodyKey(request, method);
  const cacheKey = `${method}|${request.url}|${auth.slice(-24)}|${bodyKey}|${isLeaseRequest ? leaseGeneration : ""}`;
  const now = Date.now();

  pruneCache(now);

  if (policy.ttlMs) {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return responseFromSnapshot(cached.snapshot);
    }
  }

  const pending = inFlight.get(cacheKey);
  if (pending) {
    return responseFromSnapshot(await pending);
  }

  const fetchPromise = (async () => {
    if (policy.coalesceDelayMs) {
      await wait(policy.coalesceDelayMs);
    }

    const response = await fetch(request);
    const snapshot = await snapshotResponse(response);

    if (
      policy.ttlMs &&
      (!isLeaseRequest || leaseGeneration === hostLeaseGeneration) &&
      snapshot.status >= 200 &&
      snapshot.status < 300
    ) {
      responseCache.set(cacheKey, {
        expiresAt: Date.now() + policy.ttlMs,
        snapshot,
      });
    }

    return snapshot;
  })();

  inFlight.set(cacheKey, fetchPromise);

  try {
    return responseFromSnapshot(await fetchPromise);
  } finally {
    if (inFlight.get(cacheKey) === fetchPromise) {
      inFlight.delete(cacheKey);
    }
  }
};
