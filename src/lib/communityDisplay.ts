// Small display helpers shared by the Hosts and Leaderboard pages.

let regionNames: Intl.DisplayNames | null | undefined;

// "UA" -> "Ukraine". Flag emoji are avoided on purpose: Windows shows them
// as two letters.
export function countryName(code: string | null | undefined): string | null {
  const normalized = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return null;
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(normalized) || normalized;
  } catch {
    return normalized;
  }
}

export function initials(name: string | null | undefined): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]).join("");
  return (letters || "M").toUpperCase();
}

export function formatCount(value: number | string | null | undefined): string {
  const numeric = Number(value) || 0;
  return new Intl.NumberFormat("en-US").format(numeric);
}

// Flat background/text pairs for initials avatars, picked by a stable hash
// of the user id so a person keeps the same color everywhere.
const AVATAR_TONES = [
  { background: "#E4EDFF", color: "#2F5FD0" },
  { background: "#E5F8E7", color: "#2F8F35" },
  { background: "#FFE9E4", color: "#C2412D" },
  { background: "#EEF0FF", color: "#5145CD" },
  { background: "#FFF3D6", color: "#8A6100" },
  { background: "#F1F1F1", color: "#2F2F2F" },
] as const;

export function avatarTone(seed: string | null | undefined) {
  let hash = 0;
  for (const char of String(seed || "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

// "in 20 min", "in 5 h", "in 3 days", "2 days ago", "just now".
export function relativeTime(target: number, now = Date.now()): string {
  const diff = target - now;
  const minutes = Math.round(Math.abs(diff) / 60_000);
  let text: string;
  if (minutes < 1) return "just now";
  if (minutes < 60) text = `${minutes} min`;
  else if (minutes < 60 * 24) text = `${Math.round(minutes / 60)} h`;
  else {
    const days = Math.round(minutes / (60 * 24));
    text = `${days} ${days === 1 ? "day" : "days"}`;
  }
  return diff > 0 ? `in ${text}` : `${text} ago`;
}

export function formatHours(value: number | string | null | undefined): string {
  const numeric = Number(value) || 0;
  return numeric >= 100 ? String(Math.round(numeric)) : numeric.toFixed(1).replace(/\.0$/, "");
}
