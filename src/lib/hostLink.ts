// A host's personal link: mysession.club/<slug> always opens the group
// session that host is running now (or their next one). The slug lives in
// profiles.host_slug; a database trigger registers it in public_url_slugs
// (owner_type 'profile'), which also keeps it unique across sessions and hosts.
import { seoRouteManifest } from "../data/seoRouteManifest";

export const HOST_LINK_MIN = 3;
export const HOST_LINK_MAX = 32;

// Top-level paths the app (or the server) already uses. A host link there
// would never be reached, because the real page wins.
const RESERVED = new Set([
  "about", "account", "admin", "adhd-body-doubling", "adhd-productivity", "affiliate", "ai-assistant", "api",
  "app", "assets", "auth", "backgrounds", "badges", "billing", "blog", "contact", "dashboard", "data-deletion",
  "downloads", "email", "faq", "focus-plan", "focus-sessions", "focus-shield", "focusmate-alternatives",
  "fonts", "group-focus-sessions", "guides", "help", "home", "host", "host-guide", "hosts", "how-it-works",
  "icons", "images", "index", "leaderboard", "libs", "livekit", "login", "logout", "me", "mysession",
  "one-on-one", "online-coworking", "pricing", "privacy", "procrastination", "profile", "push", "referrals",
  "refund-policy", "register", "room", "room-iframe", "room-livekit", "room-livekit-clean", "rules", "session",
  "sessions", "sessions-concept", "sessions-schedule", "settings", "signin", "signup", "silent-coworking",
  "sounds", "static", "stripe", "study-together", "support", "tasks", "terms", "ui-playground",
  "update-password", "updates", "vectorizer", "www",
]);

export function isReservedHostLink(slug: string): boolean {
  return RESERVED.has(slug) || seoRouteManifest.some((page) => page.slug === slug);
}

/** What the person typed, as it will be saved: lowercase letters, digits, "-" and "_". */
export function normalizeHostLink(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/^\/+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, HOST_LINK_MAX);
}

/** Empty string when the link is fine to check for availability. */
export function hostLinkProblem(slug: string): string {
  if (!slug) return "";
  if (slug.length < HOST_LINK_MIN) return `Use at least ${HOST_LINK_MIN} characters.`;
  if (!/^[a-z0-9]/.test(slug) || !/[a-z0-9]$/.test(slug)) return "Start and end with a letter or a number.";
  if (/^[0-9a-f]{8}-?[0-9a-f]{4}/.test(slug)) return "Choose a name, not an ID.";
  if (isReservedHostLink(slug)) return "This address is already a MySession page.";
  return "";
}

export type HostLinkSession = {
  id: string;
  start_time?: string | null;
  duration_minutes?: number | null;
  session_format_type?: string | null;
  format?: string | null;
  schedule?: unknown;
  description?: string | null;
  is_private?: boolean | null;
  is_hidden?: boolean | null;
};

function isInfinite(session: HostLinkSession): boolean {
  if (String(session.session_format_type || "").toLowerCase() === "infinite") return true;
  if (String(session.format || "").toLowerCase() === "infinite") return true;
  let schedule: any = session.schedule;
  if (typeof schedule === "string") {
    try { schedule = JSON.parse(schedule); } catch { schedule = null; }
  }
  return !!schedule && typeof schedule === "object" && schedule.kind === "infinite_room";
}

/**
 * The group session a host link opens: the one running now (the earliest if
 * two overlap), otherwise the next one. Infinite rooms, private, hidden and
 * one-on-one sessions are never opened by a public host link.
 */
export function pickHostLinkSession<T extends HostLinkSession>(sessions: T[], now = Date.now()): T | null {
  const timed = sessions
    .filter((session) =>
      session?.id &&
      !isInfinite(session) &&
      session.is_private !== true &&
      session.is_hidden !== true &&
      !String(session.description || "").startsWith("one-on-one:"),
    )
    .map((session) => {
      const start = Date.parse(String(session.start_time || ""));
      const minutes = Number(session.duration_minutes || 0);
      const end = Number.isFinite(start) && minutes > 0 ? start + minutes * 60_000 : start;
      return { session, start, end };
    })
    .filter(({ start }) => Number.isFinite(start))
    .sort((a, b) => a.start - b.start);

  const live = timed.find(({ start, end }) => start <= now && now < end);
  if (live) return live.session;
  const next = timed.find(({ start }) => start > now);
  return next ? next.session : null;
}
