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

export function formatHours(value: number | string | null | undefined): string {
  const numeric = Number(value) || 0;
  return numeric >= 100 ? String(Math.round(numeric)) : numeric.toFixed(1).replace(/\.0$/, "");
}
