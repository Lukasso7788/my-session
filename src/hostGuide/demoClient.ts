// In-memory Supabase client for the /host-guide page.
//
// The walkthrough renders the real room components (top bar, tiles, task
// panel), which read data through src/lib/supabase. On this page that module
// returns this client instead (window.__MYSESSION_DEMO_SUPABASE__), so the
// room shows fixture data and:
// - the demo session lives in memory under its own key; the visitor's real
//   sign-in in localStorage ("mysession-auth") is never read or written here;
// - REST/RPC/auth calls are answered locally by demoFetch; nothing reaches the
//   database.
// Must be imported before any module that imports src/lib/supabase.
import { createClient } from "@supabase/supabase-js";
import { GUIDE_ME, GUIDE_PEOPLE } from "./people";

type Row = Record<string, unknown>;

/** Fixture tables; the walkthrough swaps task rows per scene. */
export const demoTables: Record<string, Row[]> = {
  profiles: GUIDE_PEOPLE.map((p) => ({ id: p.id, full_name: p.name, avatar_url: p.avatar || null, timezone: p.tz })),
  session_chat_messages: [],
  session_chat_reactions: [],
  panel_intentions: [],
  intentions: [],
};

const DEMO_STORAGE_KEY = "mysession-host-guide-demo";
const nowSec = Math.floor(Date.now() / 1000);
const b64 = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "");
const demoUser = {
  id: GUIDE_ME,
  aud: "authenticated",
  role: "authenticated",
  email: "host-guide@example.invalid",
  app_metadata: { provider: "email" },
  user_metadata: { full_name: GUIDE_PEOPLE[0].name, timezone: GUIDE_PEOPLE[0].tz },
  created_at: "2025-03-02T10:00:00Z",
};
const demoSession = {
  access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: GUIDE_ME, exp: nowSec + 86400, role: "authenticated" })}.demo`,
  refresh_token: "host-guide-demo",
  token_type: "bearer",
  expires_in: 86400,
  expires_at: nowSec + 86400,
  user: demoUser,
};

/** The host's name and photo also show in the task panel, so keep the fixtures in sync. */
export function setDemoHost(name: string, avatarUrl: string | null) {
  Object.assign(demoTables.profiles[0], { full_name: name, avatar_url: avatarUrl });
  demoUser.user_metadata.full_name = name;
}

const memory = new Map<string, string>([[DEMO_STORAGE_KEY, JSON.stringify(demoSession)]]);
const memoryStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
};

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

async function demoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/auth/v1/user")) return json(demoUser);
  if (url.includes("/auth/v1/")) return json({});
  if (/\/rest\/v1\/rpc\//.test(url)) return json(null);
  const rest = url.match(/\/rest\/v1\/([a-z_]+)/);
  if (rest) {
    const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "GET" && method !== "HEAD") return json([]); // Demo writes are dropped.
    const rows = demoTables[rest[1]] ?? [];
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const single = (headers.get("accept") || "").includes("vnd.pgrst.object");
    return json(single ? rows[0] ?? null : rows, { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` });
  }
  return json({});
}

export const demoSupabase = createClient("https://host-guide.demo.invalid", "host-guide-demo", {
  auth: {
    storage: memoryStorage,
    storageKey: DEMO_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: { fetch: demoFetch },
});

(window as unknown as { __MYSESSION_DEMO_SUPABASE__?: unknown }).__MYSESSION_DEMO_SUPABASE__ = demoSupabase;
