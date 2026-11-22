import assert from "node:assert/strict";
import test from "node:test";
import { addDays, monthGrid, shiftMonth, toIsoDate } from "../src/lib/taskCalendar.ts";

test("month grid starts on Monday and keeps six stable weeks", () => {
  const cells = monthGrid("2026-11-22");
  assert.equal(cells.length, 42);
  assert.equal(cells[0].iso, "2026-10-26");
  assert.equal(cells.find((cell) => cell.iso === "2026-11-01")?.inMonth, true);
  assert.equal(cells[0].inMonth, false);
  assert.equal(cells.filter((cell) => cell.inMonth).length, 30);
});

test("day and month changes stay on the local calendar", () => {
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-11-01", -1), "2026-10-31");
  assert.equal(shiftMonth("2026-01-31", 1), "2026-02-28");
  assert.equal(shiftMonth("2026-03-31", -1), "2026-02-28");
  const today = new Date(2026, 10, 22);
  assert.equal(toIsoDate(today), "2026-11-22");
});
