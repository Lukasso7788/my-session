import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { build } from "esbuild";
import { rawTimeZones } from "@vvo/tzdb";

const { outputFiles } = await build({
  entryPoints: [resolve("src/lib/timezoneSearch.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const {
  buildTimeZoneOptions,
  searchTimeZones,
} = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
const { outputFiles: timezoneFiles } = await build({
  entryPoints: [resolve("src/lib/timezones.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { chooseTimeZoneForFirstConfirmation } = await import(
  `data:text/javascript;base64,${Buffer.from(timezoneFiles[0].contents).toString("base64")}`,
);

const options = buildTimeZoneOptions(rawTimeZones, "Asia/Kolkata", "en-US");

test("country, city, continent, Cyrillic country and IANA alias searches find India", () => {
  for (const query of ["India", "Индия", "Mumbai", "Kolkata", "Calcutta", "Asia/Kolkata"]) {
    assert.ok(
      searchTimeZones(options, query).some((option) => option.value === "Asia/Kolkata"),
      `Missing Asia/Kolkata for ${query}`,
    );
  }
  assert.ok(searchTimeZones(options, "Asia").length > 0);
});

test("selected timezone is listed first when the search is empty", () => {
  assert.equal(searchTimeZones(options, "", "Asia/Kolkata")[0].value, "Asia/Kolkata");
});

test("unmatched text never silently chooses a timezone", () => {
  assert.deepEqual(searchTimeZones(options, "Atlantis nowhere"), []);
});

test("browser timezone replaces only the database's unconfirmed UTC default", () => {
  assert.equal(chooseTimeZoneForFirstConfirmation("", "UTC", "", "Asia/Kolkata"), "Asia/Kolkata");
  assert.equal(chooseTimeZoneForFirstConfirmation("Europe/Paris", "UTC", "", "Asia/Kolkata"), "Europe/Paris");
  assert.equal(chooseTimeZoneForFirstConfirmation("", "UTC", "Europe/Kyiv", "Asia/Kolkata"), "Europe/Kyiv");
  assert.equal(chooseTimeZoneForFirstConfirmation("", "Europe/Warsaw", "", "Asia/Kolkata"), "Europe/Warsaw");
  assert.equal(chooseTimeZoneForFirstConfirmation("", "UTC", "", null), "UTC");
});
