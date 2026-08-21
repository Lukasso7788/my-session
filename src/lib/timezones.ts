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

export function getDetectedTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
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
