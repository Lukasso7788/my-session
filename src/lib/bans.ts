import { supabase } from "./supabase";

export type ActiveBan = {
  id: string;
  banned_user_id: string;
  banned_by_user_id?: string | null;
  reason: string;
  internal_notes?: string | null;
  starts_at: string;
  expires_at?: string | null;
  revoked_at?: string | null;
  created_at?: string | null;
};

export type BanPreset =
  | {
      id: string;
      label: string;
      description?: string;
      ms: number;
      permanent?: false;
      custom?: false;
    }
  | {
      id: "permanent";
      label: string;
      description?: string;
      ms?: 0;
      permanent: true;
      custom?: false;
    }
  | {
      id: "custom";
      label: string;
      description?: string;
      ms?: 0;
      permanent?: false;
      custom: true;
    };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function months(n: number) {
  return Math.round(n * 30.4375 * DAY);
}

function years(n: number) {
  return Math.round(n * 365.25 * DAY);
}

export const BAN_PRESETS: BanPreset[] = [
  { id: "2h", label: "2 hours", ms: 2 * HOUR },
  { id: "6h", label: "6 hours", ms: 6 * HOUR },
  { id: "12h", label: "12 hours", ms: 12 * HOUR },
  { id: "1d", label: "1 day", ms: DAY },
  { id: "2d", label: "2 days", ms: 2 * DAY },
  { id: "1w", label: "1 week", ms: 7 * DAY },
  { id: "2w", label: "2 weeks", ms: 14 * DAY },
  { id: "4w", label: "4 weeks", ms: 28 * DAY },
  { id: "1m", label: "1 month", ms: months(1) },
  { id: "2m", label: "2 months", ms: months(2) },
  { id: "3m", label: "3 months", ms: months(3) },
  { id: "4m", label: "4 months", ms: months(4) },
  { id: "6m", label: "6 months", ms: months(6) },
  { id: "12m", label: "12 months", ms: months(12) },
  { id: "24m", label: "24 months", ms: months(24) },
  { id: "36m", label: "36 months", ms: months(36) },
  { id: "5y", label: "5 years", ms: years(5) },
  { id: "10y", label: "10 years", ms: years(10) },
  { id: "permanent", label: "Permanent", permanent: true },
  { id: "custom", label: "Custom", custom: true },
];

export function formatBanEnd(raw?: string | null) {
  if (!raw) return "Permanent";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "Unknown";

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatBanCountdown(expiresAt?: string | null, nowMs = Date.now()) {
  if (!expiresAt) return "Permanent";

  const end = new Date(expiresAt).getTime();
  if (!Number.isFinite(end)) return "Unknown";
  const ms = Math.max(0, end - nowMs);

  if (ms <= 0) return "Expired";

  const totalSec = Math.ceil(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function getBanExpiresAtFromPreset(preset: BanPreset, customExpiresAt?: string) {
  if ("permanent" in preset && preset.permanent) return null;

  if ("custom" in preset && preset.custom) {
    const raw = String(customExpiresAt || "").trim();
    if (!raw) return "";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString();
  }

  const ms = Number((preset as any).ms || 0);
  if (!Number.isFinite(ms) || ms <= 0) return "";

  return new Date(Date.now() + ms).toISOString();
}

export function isBanActive(ban: Pick<ActiveBan, "starts_at" | "expires_at" | "revoked_at">) {
  if (ban.revoked_at) return false;

  const now = Date.now();
  const starts = new Date(ban.starts_at).getTime();
  if (Number.isFinite(starts) && starts > now) return false;

  if (!ban.expires_at) return true;

  const expires = new Date(ban.expires_at).getTime();
  return Number.isFinite(expires) && expires > now;
}

export async function isCurrentUserAdmin() {
  const { data, error } = await supabase.rpc("is_app_admin");
  if (error) {
    console.warn("[bans] is_app_admin failed:", error);
    return false;
  }

  return Boolean(data);
}

export async function getCurrentUserActiveBan(): Promise<ActiveBan | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = String(sessionData.session?.user?.id || "").trim();
  if (!userId) return null;

  const { data, error } = await supabase
    .from("user_bans")
    .select("id, banned_user_id, banned_by_user_id, reason, internal_notes, starts_at, expires_at, revoked_at, created_at")
    .eq("banned_user_id", userId)
    .is("revoked_at", null)
    .lte("starts_at", new Date().toISOString())
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[bans] active ban load failed:", error);
    return null;
  }

  return (data as ActiveBan) || null;
}

export async function createUserBan(params: {
  bannedUserId: string;
  reason: string;
  expiresAt: string | null;
  internalNotes?: string;
}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const adminUserId = String(sessionData.session?.user?.id || "").trim();

  if (!adminUserId) throw new Error("Admin auth required.");

  const bannedUserId = String(params.bannedUserId || "").trim();
  const reason = String(params.reason || "").trim();
  const internalNotes = String(params.internalNotes || "").trim();

  if (!bannedUserId) throw new Error("Choose a user to ban.");
  if (!reason) throw new Error("Ban reason is required.");

  const { data, error } = await supabase
    .from("user_bans")
    .insert({
      banned_user_id: bannedUserId,
      banned_by_user_id: adminUserId,
      reason,
      internal_notes: internalNotes || null,
      starts_at: new Date().toISOString(),
      expires_at: params.expiresAt || null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as ActiveBan;
}

export async function revokeUserBan(params: {
  banId: string;
  reason?: string;
}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const adminUserId = String(sessionData.session?.user?.id || "").trim();

  if (!adminUserId) throw new Error("Admin auth required.");

  const { error } = await supabase
    .from("user_bans")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by_user_id: adminUserId,
      revoked_reason: String(params.reason || "").trim() || null,
    })
    .eq("id", params.banId);

  if (error) throw error;
}

export async function listActiveBans() {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("user_bans")
    .select("*")
    .is("revoked_at", null)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw error;
  return (data || []) as ActiveBan[];
}

export async function searchAdminUsers(query: string) {
  const q = String(query || "").trim();

  if (!q) return [];

  const uuidLike =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);

  if (uuidLike) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url, email, created_at")
      .eq("id", q)
      .limit(10);

    if (!error && data) return data;
  }

  // Prefer admin view if email is protected on profiles in normal RLS.
  const { data, error } = await supabase
    .from("admin_profile_search")
    .select("id, full_name, avatar_url, email, created_at")
    .or(`full_name.ilike.%${q}%,email.ilike.%${q}%,id.eq.${q}`)
    .limit(20);

  if (!error && data) return data;

  // Fallback if admin_profile_search is not created yet.
  const fallback = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, email, created_at")
    .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
    .limit(20);

  if (fallback.error) throw fallback.error;
  return fallback.data || [];
}
