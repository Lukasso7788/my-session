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

export function formatTimeZoneLabel(value: string): string {
  return value.replace(/_/g, " ");
}

/**
 * Someone's current local time ("4:12 PM"), nothing else. The zone itself is
 * only chosen in the timezone modal; the place is the separate, optional
 * profile location and is never derived from the timezone.
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
