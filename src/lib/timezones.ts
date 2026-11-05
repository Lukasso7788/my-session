const FALLBACK_TIME_ZONES = [
  "UTC",
  "Europe/Kyiv",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Warsaw",
  "Europe/Istanbul",
  "Africa/Casablanca",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: "timeZone") => string[];
};

export function getBrowserTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidTimeZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

export function getDetectedTimeZone(): string {
  return getBrowserTimeZone() || "UTC";
}

// profiles.timezone defaults to UTC in the database. Until it has been
// confirmed, that value is not evidence that the person selected UTC.
export function chooseTimeZoneForFirstConfirmation(
  metadataZone: string,
  profileZone: string,
  rememberedZone: string,
  browserZone: string | null,
): string {
  if (isValidTimeZone(metadataZone)) return metadataZone;
  if (isValidTimeZone(rememberedZone)) return rememberedZone;
  if (profileZone !== "UTC" && isValidTimeZone(profileZone)) return profileZone;
  return browserZone || (isValidTimeZone(profileZone) ? profileZone : "UTC");
}

export function getSupportedTimeZones(current?: string | null): string[] {
  let zones = FALLBACK_TIME_ZONES;

  try {
    const supported = (Intl as IntlWithSupportedValues).supportedValuesOf?.("timeZone");
    if (supported?.length) zones = supported;
  } catch {
    zones = FALLBACK_TIME_ZONES;
  }

  const normalizedCurrent = String(current || "").trim();
  return Array.from(
    new Set(normalizedCurrent ? [normalizedCurrent, ...zones] : zones),
  ).sort((a, b) => a.localeCompare(b));
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

// IANA's fixed-offset zones use the POSIX sign, so "Etc/GMT-3" is UTC+3.
const ETC_GMT_ZONE = /^Etc\/GMT([+-])(\d{1,2})$/;

/** Fixed-offset zones for people who think in GMT rather than in a city. Whole hours only (IANA has no Etc/GMT+5:30). */
export const FIXED_OFFSET_TIME_ZONES: string[] = (() => {
  // GMT+0 itself is the existing "UTC" choice.
  const zones: string[] = [];
  for (let hours = -12; hours <= 14; hours += 1) {
    if (hours === 0) continue;
    // Displayed offset +h is stored as Etc/GMT-h.
    zones.push(`Etc/GMT${hours > 0 ? "-" : "+"}${Math.abs(hours)}`);
  }
  return zones;
})();

export function isFixedOffsetTimeZone(value: string): boolean {
  return value === "Etc/GMT" || ETC_GMT_ZONE.test(value);
}

export function formatTimeZoneLabel(value: string): string {
  if (value === "Etc/GMT" || value === "Etc/UTC") return "GMT+0";
  const fixed = String(value || "").match(ETC_GMT_ZONE);
  if (fixed) return `GMT${fixed[1] === "-" ? "+" : "-"}${Number(fixed[2])}`;
  // Older browsers still report the legacy alias.
  if (value === "Europe/Kiev") return "Europe/Kyiv";
  return value.replace(/_/g, " ");
}

/** Current offset from UTC in minutes (DST included), or null for an unknown zone. */
export function getTimeZoneOffsetMinutes(timeZone: string, at: number | Date = Date.now()): number | null {
  try {
    const date = new Date(at instanceof Date ? at.getTime() : at);
    date.setUTCSeconds(0, 0);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    }).formatToParts(date);
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const wallClockAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
    const minutes = Math.round((wallClockAsUtc - date.getTime()) / 60_000);
    return Number.isFinite(minutes) ? minutes : null;
  } catch {
    return null;
  }
}

/** "GMT+2", "GMT+5:30", "GMT-3:30", "GMT+0". */
export function formatGmtOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  return `GMT${sign}${hours}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`;
}

/**
 * Reads "GMT+3", "utc -5", "+5:30", "+0530", "GMT" as an offset in minutes.
 * Anything else (a city, a country) returns null.
 */
export function parseGmtOffsetQuery(query: string): number | null {
  const clean = String(query || "").toLowerCase().replace(/−/g, "-").replace(/\s+/g, "");
  if (clean === "gmt" || clean === "utc" || clean === "gmt0" || clean === "utc0") return 0;
  const match = clean.match(/^(?:gmt|utc)?([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || 0);
  if (hours > 14 || ![0, 15, 30, 45].includes(minutes)) return null;
  return (match[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
}

// Zones whose IANA city has a better-known English name today.
const TIME_ZONE_CITY_NAMES: Record<string, string> = {
  "europe/kiev": "Kyiv",
  "europe/kyiv": "Kyiv",
  "asia/calcutta": "Kolkata",
};

/**
 * The city a timezone is named after ("Europe/Berlin" -> "Berlin"), used in
 * room tiles when the person chose no location. Empty for UTC and the
 * fixed-offset Etc/GMT zones, which name no place.
 */
export function timeZoneCityName(timeZone: string): string {
  const zone = String(timeZone || "").trim();
  if (!zone.includes("/") || zone.startsWith("Etc/")) return "";
  return TIME_ZONE_CITY_NAMES[zone.toLowerCase()] || zone.split("/").pop()!.replace(/_/g, " ");
}

/**
 * Someone's current local time ("4:12 PM"), nothing else. The zone itself is
 * only chosen in the timezone modal; the place comes from the optional profile
 * location, or in room tiles from the zone's city (timeZoneCityName).
 */
export function formatLocalTime(timeZone: string, at: number | Date = Date.now()): string {
  const zone = String(timeZone || "").trim();
  if (!zone) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: "numeric", minute: "2-digit" })
      .format(at instanceof Date ? at : new Date(at));
  } catch {
    return "";
  }
}
