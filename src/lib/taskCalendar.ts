export function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseIsoDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year || 1970, (month || 1) - 1, day || 1);
}

export function addDays(iso: string, amount: number) {
  const date = parseIsoDate(iso);
  date.setDate(date.getDate() + amount);
  return toIsoDate(date);
}

export function shiftMonth(iso: string, amount: number) {
  const date = parseIsoDate(iso);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + amount);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return toIsoDate(date);
}

export function monthGrid(iso: string) {
  const current = parseIsoDate(iso);
  const first = new Date(current.getFullYear(), current.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(1 - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      iso: toIsoDate(date),
      inMonth: date.getMonth() === current.getMonth(),
    };
  });
}

export function formatMonthHeading(iso: string) {
  return parseIsoDate(iso).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function formatDayHeading(iso: string) {
  return parseIsoDate(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
