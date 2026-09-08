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

const responseCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ResponseSnapshot>>();

const MAX_CACHE_ENTRIES = 160;

function getRequestUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return input.url;
  return String(input);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return String(init.method).toUpperCase();
  if (input instanceof Request) return String(input.method || "GET").toUpperCase();
  return "GET";
}

function cacheTtlMs(method: string, pathname: string) {
  if (method === "GET") {
    if (pathname === "/rest/v1/infinite_room_host_leases") return 15_000;
    if (pathname === "/rest/v1/user_entitlements") return 15_000;
    if (pathname === "/rest/v1/user_weekly_usage") return 15_000;
    if (pathname === "/rest/v1/account_access_controls") return 15_000;
    if (pathname === "/rest/v1/profiles") return 3_000;
  }

  if (method === "POST") {
    if (pathname === "/rest/v1/rpc/attendance_heartbeat") return 4_000;
    if (pathname === "/rest/v1/rpc/heartbeat_infinite_room_host") return 5_000;
  }

  return 0;
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

  const ttlMs = cacheTtlMs(method, pathname);
  if (!ttlMs) return fetch(input, init);

  const request = input instanceof Request && !init ? input : new Request(input, init);
  const auth = request.headers.get("authorization") || "";
  const bodyKey = await requestBodyKey(request, method);
  const cacheKey = `${method}|${request.url}|${auth.slice(-24)}|${bodyKey}`;
  const now = Date.now();

  pruneCache(now);

  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return responseFromSnapshot(cached.snapshot);
  }

  const pending = inFlight.get(cacheKey);
  if (pending) {
    return responseFromSnapshot(await pending);
  }

  const fetchPromise = (async () => {
    const response = await fetch(request);
    const snapshot = await snapshotResponse(response);

    if (snapshot.status >= 200 && snapshot.status < 300) {
      responseCache.set(cacheKey, {
        expiresAt: Date.now() + ttlMs,
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
