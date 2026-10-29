// Hours we most need hosts for, set in Kyiv time and shown to each person in
// their own time zone.
export const PRIORITY_SLOT_ZONE = "Europe/Kyiv";
export const PRIORITY_SLOT_START_HOUR = 6;
export const PRIORITY_SLOT_END_HOUR = 16;

function validZone(timeZone: string | null | undefined) {
  if (!timeZone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return timeZone;
  } catch {
    return null;
  }
}

export function localTimeZone(preferred?: string | null) {
  return validZone(preferred) || validZone(Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC";
}

// Minutes the zone is ahead of UTC at a given instant.
function zoneOffsetMinutes(timeZone: string, at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

// The instant it is `hour`:00 in Kyiv on the Kyiv calendar day of `day`.
function kyivHourInstant(day: Date, hour: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PRIORITY_SLOT_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(day);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  const guess = Date.UTC(get("year"), get("month") - 1, get("day"), hour);
  const offset = zoneOffsetMinutes(PRIORITY_SLOT_ZONE, new Date(guess));
  return new Date(guess - offset * 60_000);
}

function formatTime(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

export type PrioritySlots = {
  start: string; // "08:00" in the person's zone
  end: string;
  timeZone: string;
  isKyiv: boolean; // same clock as Kyiv, so no need to mention it
};

export function prioritySlotsFor(timeZone?: string | null, day: Date = new Date()): PrioritySlots {
  const zone = localTimeZone(timeZone);
  const start = kyivHourInstant(day, PRIORITY_SLOT_START_HOUR);
  const end = kyivHourInstant(day, PRIORITY_SLOT_END_HOUR);
  return {
    start: formatTime(start, zone),
    end: formatTime(end, zone),
    timeZone: zone,
    isKyiv: zoneOffsetMinutes(zone, start) === zoneOffsetMinutes(PRIORITY_SLOT_ZONE, start),
  };
}
