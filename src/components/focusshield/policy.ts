export type FocusShieldWeb = {
  domains: string[];
  urls: string[];
  allow: string[];
};

export type FocusShieldPolicy = {
  active: boolean;
  locked: boolean;
  startedAt: number | null;
  endAt: number | null;
  updatedAt: number | null;
  source: string;
  web: FocusShieldWeb;
  desktop: { applications: string[] };
};

export type FocusShieldPreset = {
  id: string;
  label: string;
  domains: string[];
  group: "common" | "category";
  hint?: string;
};

export const FOCUS_SHIELD_EVENT = "mysession:focus-shield";
export const FOCUS_SHIELD_CACHE_KEY = "mysession_focus_shield_policy_v1";
export const FOCUS_SHIELD_PAGE_SOURCE = "mysession-focus-shield";
export const FOCUS_SHIELD_PAGE_RESULT = "mysession-focus-shield-result";

export const EMPTY_FOCUS_SHIELD_POLICY: FocusShieldPolicy = {
  active: false,
  locked: false,
  startedAt: null,
  endAt: null,
  updatedAt: null,
  source: "session",
  web: { domains: [], urls: [], allow: [] },
  desktop: { applications: [] },
};

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function normalizeDomain(value: string) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split(/[/?#]/)[0]
    .replace(/\.$/, "")
    .toLowerCase();
}

export function normalizeUrl(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    url.hash = "";
    url.search = "";
    return (url.origin + url.pathname).replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function parseCustomBlockList(text: string) {
  const domains: string[] = [];
  const urls: string[] = [];
  for (const line of String(text || "").split("\n")) {
    const value = line.trim();
    if (!value || value.startsWith("#")) continue;
    if (/^https?:\/\//i.test(value) || value.includes("/")) {
      const url = normalizeUrl(value);
      if (url) urls.push(url);
    } else {
      const domain = normalizeDomain(value);
      if (domain && domain.includes(".")) domains.push(domain);
    }
  }
  return { domains: unique(domains).slice(0, 80), urls: unique(urls).slice(0, 80) };
}

export function collectBlockTargets(presetDomains: string[], customText: string) {
  const custom = parseCustomBlockList(customText);
  return {
    domains: unique([...presetDomains.map(normalizeDomain), ...custom.domains]).slice(0, 200),
    urls: custom.urls.slice(0, 200),
  };
}

export function clampShieldMinutes(minutes: number) {
  if (!Number.isFinite(minutes)) return 25;
  return Math.min(1440, Math.max(1, Math.round(minutes)));
}

export function createActivePolicy(args: {
  domains: string[];
  urls: string[];
  minutes: number;
  locked: boolean;
  now?: number;
  source?: string;
  applications?: string[];
}): FocusShieldPolicy {
  const now = args.now ?? Date.now();
  const minutes = clampShieldMinutes(args.minutes);
  return {
    active: true,
    locked: Boolean(args.locked),
    startedAt: now,
    endAt: now + minutes * 60_000,
    updatedAt: now,
    source: args.source || "session",
    web: {
      domains: unique(args.domains.map(normalizeDomain)).slice(0, 200),
      urls: unique(args.urls.map(normalizeUrl)).slice(0, 200),
      allow: [],
    },
    desktop: {
      applications: unique((args.applications || []).map((item) => String(item || "").trim())).slice(0, 80),
    },
  };
}

export function deactivatePolicy(
  policy: FocusShieldPolicy | null | undefined,
  source = "session",
  now = Date.now(),
): FocusShieldPolicy {
  const base = policy || EMPTY_FOCUS_SHIELD_POLICY;
  return {
    ...base,
    active: false,
    locked: false,
    startedAt: null,
    endAt: null,
    updatedAt: now,
    source,
    web: base.web || EMPTY_FOCUS_SHIELD_POLICY.web,
    desktop: base.desktop || EMPTY_FOCUS_SHIELD_POLICY.desktop,
  };
}

export function isShieldRunning(policy: FocusShieldPolicy | null | undefined, now = Date.now()) {
  if (!policy?.active) return false;
  if (typeof policy.endAt === "number" && now >= policy.endAt) return false;
  return true;
}

export function isShieldLocked(policy: FocusShieldPolicy | null | undefined, now = Date.now()) {
  return isShieldRunning(policy, now) && Boolean(policy?.locked);
}

export function formatShieldRemaining(endAt: number | null | undefined, now = Date.now()) {
  if (!endAt) return "--:--";
  const totalSeconds = Math.max(0, Math.floor((endAt - now) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function coercePolicy(value: unknown): FocusShieldPolicy | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<FocusShieldPolicy> & {
    web?: Partial<FocusShieldWeb>;
    desktop?: { applications?: unknown };
  };
  const asList = (input: unknown) => (Array.isArray(input) ? input.map((item) => String(item || "")) : []);
  const domains = asList(raw.web?.domains).map(normalizeDomain);
  const urls = asList(raw.web?.urls).map(normalizeUrl);
  const allow = asList(raw.web?.allow).map(normalizeDomain);
  const applications = asList(raw.desktop?.applications).map((item) => item.trim()).filter(Boolean);
  const numberOrNull = (input: unknown) => (typeof input === "number" && Number.isFinite(input) ? input : null);
  return {
    active: Boolean(raw.active),
    locked: Boolean(raw.locked),
    startedAt: numberOrNull(raw.startedAt),
    endAt: numberOrNull(raw.endAt),
    updatedAt: numberOrNull(raw.updatedAt),
    source: String(raw.source || "session").slice(0, 40),
    web: {
      domains: unique(domains).slice(0, 200),
      urls: unique(urls).slice(0, 200),
      allow: unique(allow).slice(0, 80),
    },
    desktop: { applications: unique(applications).slice(0, 80) },
  };
}

export function newerPolicy(left: FocusShieldPolicy | null, right: FocusShieldPolicy | null) {
  if (!left) return right;
  if (!right) return left;
  return (left.updatedAt || 0) >= (right.updatedAt || 0) ? left : right;
}

export function readCachedPolicy() {
  if (typeof localStorage === "undefined") return null;
  try {
    return coercePolicy(JSON.parse(localStorage.getItem(FOCUS_SHIELD_CACHE_KEY) || "null"));
  } catch {
    return null;
  }
}

export function writeCachedPolicy(policy: FocusShieldPolicy | null) {
  if (typeof localStorage === "undefined") return;
  try {
    if (!policy) localStorage.removeItem(FOCUS_SHIELD_CACHE_KEY);
    else localStorage.setItem(FOCUS_SHIELD_CACHE_KEY, JSON.stringify(policy));
  } catch {
    // A full cache must not block the shield itself.
  }
}

export function previewSiteLabel(domains: string[], urls: string[]) {
  if (domains[0]) return domains[0];
  if (urls[0]) return urls[0].replace(/^https?:\/\//, "");
  return "";
}
