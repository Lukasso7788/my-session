// Runs before the app modules: a fake signed-in session plus canned REST answers.
const USER_ID = "00000000-0000-4000-8000-000000000001";
const now = Math.floor(Date.now() / 1000);
const b64 = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "");
const accessToken = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER_ID, exp: now + 86400, role: "authenticated" })}.signature`;

const user = {
  id: USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: "preview@example.com",
  app_metadata: { provider: "email" },
  user_metadata: { full_name: "Anna Fischer", timezone: "Europe/Berlin" },
  created_at: "2025-03-02T10:00:00Z",
};

localStorage.setItem(
  "mysession-auth",
  JSON.stringify({
    access_token: accessToken,
    refresh_token: "preview-refresh",
    token_type: "bearer",
    expires_in: 86400,
    expires_at: now + 86400,
    user,
  }),
);

const profileRow = {
  id: USER_ID,
  full_name: "Anna Fischer",
  bio: "Designer in Berlin. Mornings are for deep work, afternoons for calls.",
  avatar_url: null,
  timezone: "Europe/Berlin",
  created_at: "2025-03-02T10:00:00Z",
  attended_sessions_count: 214,
};

const daysAgo = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
const tables: Record<string, unknown[]> = {
  profiles: [profileRow],
  sessions: [
    { id: "s-1", title: "Morning Deep Work", start_time: daysAgo(-1), duration_minutes: 60, schedule: null, created_at: daysAgo(10) },
    { id: "s-2", title: "Afternoon Sprint", start_time: daysAgo(2), duration_minutes: 50, schedule: null, created_at: daysAgo(12) },
  ],
  host_monetization_profiles: [{ status: "active", support_enabled: true }],
  host_support_payments: [
    { id: "p-1", host_amount_usd: 18, gross_amount_usd: 20, platform_fee_usd: 2, status: "available", created_at: daysAgo(3) },
    { id: "p-2", host_amount_usd: 22.5, gross_amount_usd: 25, platform_fee_usd: 2.5, status: "available", created_at: daysAgo(6) },
    { id: "p-3", host_amount_usd: 9, gross_amount_usd: 10, platform_fee_usd: 1, status: "pending", created_at: daysAgo(1) },
  ],
  host_payout_requests: [],
};

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const json = (body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

  if (url.includes("/auth/v1/user")) return json(user);
  // Other harness pages can set RPC answers before importing this module.
  const rpc = url.match(/\/rest\/v1\/rpc\/([a-z_]+)/);
  if (rpc) return json(((globalThis as any).__harnessRpc || {})[rpc[1]] ?? null);
  const overrides = (globalThis as any).__harnessTables || {};
  const rest = url.match(/\/rest\/v1\/([a-z_]+)/);
  if (rest) {
    const table = rest[1];
    if (table === "host_followers") return new Response(null, { status: 200, headers: { "content-range": "0-0/12" } });
    const rows = overrides[table] ?? tables[table] ?? [];
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const accept = headers.get("accept") || "";
    const body = accept.includes("vnd.pgrst.object") ? rows[0] ?? null : rows;
    return json(body, { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` });
  }
  if (url.includes("127.0.0.1:9")) return json({});
  return realFetch(input, init);
};

export {};
