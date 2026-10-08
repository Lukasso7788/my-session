export type DailyHostingSlot = {
  sessionId: string;
  sessionTitle: string;
  hostUserId: string;
  hostName: string;
  bookedStartTime: string;
  bookedEndTime: string;
};

const SAMPLE_SESSION_ID = "00000000-0000-4000-8000-000000000000";

export function dateKeyInTimeZone(value: string | Date, timeZone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function hostSlotOverlapsLocalDate(slot: DailyHostingSlot, dateKey: string, timeZone: string) {
  const start = Date.parse(slot.bookedStartTime);
  const end = Date.parse(slot.bookedEndTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
  return dateKeyInTimeZone(new Date(start), timeZone) <= dateKey
    && dateKeyInTimeZone(new Date(end - 1), timeZone) >= dateKey;
}

const REGIONAL_TIME_ZONES = [
  { label: "US East", timeZone: "America/New_York" },
  { label: "US West", timeZone: "America/Los_Angeles" },
  { label: "Europe", timeZone: "Europe/Berlin" },
  { label: "India", timeZone: "Asia/Kolkata" },
  { label: "Australia", timeZone: "Australia/Sydney" },
] as const;

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function formatTime(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time TBD";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone,
  }).format(date);
}

export function formatHostingRange(slot: DailyHostingSlot, timeZone: string) {
  return `${formatTime(slot.bookedStartTime, timeZone)} – ${formatTime(slot.bookedEndTime, timeZone)}`;
}

export function renderInfiniteHostingSlots(slots: DailyHostingSlot[], timeZone: string, appUrl: string) {
  if (slots.length === 0) return {
    text: "No hosts are scheduled in the 24/7 rooms yet. Check the sessions page for live updates.",
    html: '<p style="margin:12px 0;color:#555;">No hosts are scheduled in the 24/7 rooms yet. Check the sessions page for live updates.</p>',
  };

  const text = `Hosts in 24/7 rooms:\n${slots.map((slot) =>
    `- ${formatHostingRange(slot, timeZone)} — ${slot.hostName} in ${slot.sessionTitle}\n  ${REGIONAL_TIME_ZONES.map(({ label, timeZone: zone }) => `${label}: ${formatHostingRange(slot, zone)}`).join(" · ")}`
  ).join("\n")}`;

  const html = `<div style="margin:22px 0;padding:18px;border-radius:18px;background:#eff8f0;">
    <div style="font-weight:700;font-size:16px;margin-bottom:8px;">Hosts in 24/7 rooms:</div>
    <ul style="padding-left:20px;margin:0;">${slots.map((slot) => {
      const link = `${appUrl}/room-livekit/${encodeURIComponent(slot.sessionId)}`;
      const regional = REGIONAL_TIME_ZONES.map(({ label, timeZone: zone }) => `${label}: ${formatHostingRange(slot, zone)}`).join(" · ");
      const roomTitle = slot.sessionId === SAMPLE_SESSION_ID
        ? `<span>${escapeHtml(slot.sessionTitle)} · test fixture</span>`
        : `<a href="${escapeHtml(link)}" style="color:#111827;text-decoration:underline;">${escapeHtml(slot.sessionTitle)}</a>`;
      return `<li style="margin:8px 0;"><strong>${escapeHtml(formatHostingRange(slot, timeZone))}</strong><span style="color:#555;"> — </span><strong>${escapeHtml(slot.hostName)}</strong> in ${roomTitle}<div style="margin-top:3px;color:#6b7280;font-size:12px;line-height:1.45;">${escapeHtml(regional)}</div></li>`;
    }).join("")}</ul>
  </div>`;

  return { text, html };
}

// Preview fixtures are never mixed into the production audience; only the fixed-inbox
// Plunk test action may request them when no real host reservation exists.
export function sampleInfiniteHostingSlot(scheduleDate: string): DailyHostingSlot {
  return {
    sessionId: SAMPLE_SESSION_ID,
    sessionTitle: "50/10 Deep Work - 24/7 (sample)",
    hostUserId: SAMPLE_SESSION_ID,
    hostName: "Sample host",
    bookedStartTime: `${scheduleDate}T09:00:00.000Z`,
    bookedEndTime: `${scheduleDate}T11:00:00.000Z`,
  };
}
