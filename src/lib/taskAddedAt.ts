// When a task was added, shown on hover in the room task panel: just the time
// for today ("2:34 PM"), "Yesterday, 9:10 AM", and the date from two days
// back ("Oct 12, 9:10 AM", with the year when it is not this year). Absolute times,
// so the label never goes stale.
export function formatTaskAddedAt(value: string | null | undefined, now: Date = new Date()): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const clock = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (days <= 0) return clock;
  if (days === 1) return `Yesterday, ${clock}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  const day = date.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  return `${day}, ${clock}`;
}
