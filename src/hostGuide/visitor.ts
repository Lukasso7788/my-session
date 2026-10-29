// Who is reading the host guide: they play the host in the walkthrough.
// Read-only: looks at the stored MySession sign-in and fetches the visitor's
// own profile (name, photo). Never writes, refreshes or changes the session.
const AUTH_STORAGE_KEY = "mysession-auth"; // as in src/lib/supabase.ts
const PROFILE_TIMEOUT_MS = 2500;

export type GuideVisitor = { name: string; avatar: string | null; signedIn: boolean };

type StoredSession = {
  access_token?: string;
  user?: { id?: string; user_metadata?: Record<string, unknown> };
};

function firstName(value: unknown): string {
  return String(value || "").trim().split(/\s+/)[0] || "";
}

export async function loadGuideVisitor(): Promise<GuideVisitor> {
  // ?as=Name[&avatar=url]: preview the guide as someone else (no lookup).
  const params = new URLSearchParams(window.location.search);
  if (params.get("as")) return { name: firstName(params.get("as")) || "You", avatar: params.get("avatar") || null, signedIn: true };

  let stored: StoredSession | null = null;
  try {
    stored = JSON.parse(window.localStorage.getItem(AUTH_STORAGE_KEY) || "null");
  } catch {
    stored = null;
  }
  const userId = String(stored?.user?.id || "");
  if (!userId) return { name: "You", avatar: null, signedIn: false };

  const metadata = stored?.user?.user_metadata || {};
  const fallback: GuideVisitor = {
    name: firstName(metadata.full_name || metadata.name) || "You",
    avatar: String(metadata.avatar_url || metadata.picture || "") || null,
    signedIn: true,
  };

  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key || !stored?.access_token) return fallback;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PROFILE_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=full_name,avatar_url`,
      { headers: { apikey: key, Authorization: `Bearer ${stored.access_token}` }, signal: controller.signal },
    );
    if (!response.ok) return fallback; // e.g. an expired token: keep the stored name.
    const [row] = (await response.json()) as Array<{ full_name?: string | null; avatar_url?: string | null }>;
    return {
      name: firstName(row?.full_name) || fallback.name,
      avatar: row?.avatar_url || fallback.avatar,
      signedIn: true,
    };
  } catch {
    return fallback;
  } finally {
    window.clearTimeout(timer);
  }
}
