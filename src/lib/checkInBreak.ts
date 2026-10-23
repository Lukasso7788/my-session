// The short phase between focus blocks is one thing: a check-in and a break.
// Everywhere it shows (timelines, the room, editors) it is called
// "Check-in & break" and uses the Intentions color, whatever an older session
// saved for it (e.g. "Break & check-in" in the break color). Check-in blocks
// share the Intentions color too.

export const CHECK_IN_BREAK_TITLE = "Check-in & break";
export const INTENTIONS_COLOR = "#ADD3FF";

/** True for names like "Break & check-in", "Check-in and break", "break/check in". */
export function isCheckInBreakName(raw: unknown): boolean {
  const text = String(raw || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return false;
  return /\bbreak\b/.test(text) && /\bcheck ?in\b/.test(text);
}

/** The display name for a phase, with the check-in & break name made canonical. */
export function canonicalPhaseName(raw: string): string {
  return isCheckInBreakName(raw) ? CHECK_IN_BREAK_TITLE : raw;
}
