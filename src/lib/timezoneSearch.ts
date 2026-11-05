import {
  FIXED_OFFSET_TIME_ZONES,
  formatGmtOffset,
  formatTimeZoneLabel,
  getSupportedTimeZones,
  getTimeZoneOffsetMinutes,
  isFixedOffsetTimeZone,
  isValidTimeZone,
  parseGmtOffsetQuery,
} from "./timezones";

export type TimeZoneRecord = {
  name: string;
  alternativeName: string;
  group: string[];
  continentName: string;
  countryName: string;
  countryCode: string;
  mainCities: string[];
};

export type TimeZoneOption = {
  value: string;
  label: string;
  /** Current offset from UTC in minutes, used for "GMT+3" searches. */
  offsetMinutes: number | null;
  searchTerms: string[];
};

const regionNamesByLanguage = new Map<string, { of: (code: string) => string | undefined }>();

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[_/.,()-]/g, " ")
    .toLocaleLowerCase()
    .trim();
}

function localizedCountries(code: string, locale: string): string[] {
  if (!code) return [];
  try {
    const displayNames = Intl as typeof Intl & {
      DisplayNames?: new (locales: string[], options: { type: "region" }) => {
        of: (regionCode: string) => string | undefined;
      };
    };
    if (!displayNames.DisplayNames) return [];
    return Array.from(new Set([locale, "en", "ru", "uk"]))
      .map((language) => {
        let names = regionNamesByLanguage.get(language);
        if (!names) {
          names = new displayNames.DisplayNames!([language], { type: "region" });
          regionNamesByLanguage.set(language, names);
        }
        return names.of(code);
      })
      .filter((name): name is string => Boolean(name));
  } catch {
    return [];
  }
}

export function buildTimeZoneOptions(
  records: TimeZoneRecord[],
  current?: string | null,
  locale = "en",
): TimeZoneOption[] {
  const recordByZone = new Map<string, TimeZoneRecord>();
  for (const record of records) {
    for (const alias of [record.name, ...record.group]) {
      if (!recordByZone.has(alias)) recordByZone.set(alias, record);
    }
  }

  const zones = new Set([
    "UTC",
    ...FIXED_OFFSET_TIME_ZONES,
    ...getSupportedTimeZones(current),
    ...records.map((record) => record.name),
  ]);
  const now = Date.now();

  return Array.from(zones)
    .filter(isValidTimeZone)
    .map((value) => {
      const record = recordByZone.get(value);
      const offsetMinutes = getTimeZoneOffsetMinutes(value, now);
      const offset = offsetMinutes == null ? "" : formatGmtOffset(offsetMinutes);
      const fixed = isFixedOffsetTimeZone(value);
      const name = record
        ? `${formatTimeZoneLabel(value)} · ${record.countryName} (${record.mainCities.slice(0, 3).join(", ")})`
        : fixed
          ? `${formatTimeZoneLabel(value)} · fixed offset, no daylight saving`
          : formatTimeZoneLabel(value);
      const label = offset ? `(${offset}) ${name}` : name;
      const terms = [
        offset,
        offset.replace("GMT", "UTC"),
        value,
        record?.name || "",
        record?.alternativeName || "",
        record?.continentName || "",
        record?.countryName || "",
        ...(record?.group || []),
        ...(record?.mainCities || []),
        ...localizedCountries(record?.countryCode || "", locale),
      ];
      return {
        value,
        label,
        offsetMinutes,
        searchTerms: terms.filter(Boolean).map(normalize),
      };
    })
    .sort((a, b) => a.value.localeCompare(b.value));
}

/** "Europe/Kyiv (GMT+2)" for the closed picker. */
export function describeSelectedTimeZone(value: string): string {
  if (!value) return "";
  const minutes = getTimeZoneOffsetMinutes(value);
  const label = formatTimeZoneLabel(value);
  if (minutes == null || isFixedOffsetTimeZone(value)) return label;
  return `${label} (${formatGmtOffset(minutes)})`;
}

export function searchTimeZones(
  options: TimeZoneOption[],
  query: string,
  selected?: string | null,
  limit = 35,
): TimeZoneOption[] {
  // "GMT+3", "+5:30", "UTC-5": every zone at that offset right now, the plain
  // fixed-offset choice first, then the cities.
  const offsetQuery = parseGmtOffsetQuery(query);
  if (offsetQuery != null) {
    return options
      .filter((option) => option.offsetMinutes === offsetQuery)
      .sort((a, b) =>
        Number(isFixedOffsetTimeZone(b.value) || b.value === "UTC") -
          Number(isFixedOffsetTimeZone(a.value) || a.value === "UTC") ||
        a.value.localeCompare(b.value),
      )
      .slice(0, Math.max(limit, 80));
  }

  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    const current = options.find((option) => option.value === selected);
    const remaining = options.filter((option) => option !== current);
    return [...(current ? [current] : []), ...remaining].slice(0, limit);
  }

  const words = normalizedQuery.split(/\s+/).filter(Boolean);
  return options
    .map((option) => {
      const matches = words.every((word) =>
        option.searchTerms.some((term) => term.includes(word)),
      );
      if (!matches) return null;
      const rank = option.searchTerms.some((term) => term === normalizedQuery)
        ? 0
        : option.searchTerms.some((term) => term.startsWith(normalizedQuery))
          ? 1
          : 2;
      return { option, rank };
    })
    .filter((match): match is { option: TimeZoneOption; rank: number } => match !== null)
    .sort((a, b) => a.rank - b.rank || a.option.value.localeCompare(b.option.value))
    .slice(0, limit)
    .map(({ option }) => option);
}
