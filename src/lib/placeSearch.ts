// Place search for the optional profile location. Uses Photon (OpenStreetMap
// data, built for search-as-you-type), so it covers everything down to
// villages and hamlets. Only the typed query is sent; nothing about the user.
const PHOTON_URL = "https://photon.komoot.io/api/";

export const LOCATION_NAME_MAX_LENGTH = 160;

export type PlaceSuggestion = {
  /** What gets saved and shown on the profile. */
  label: string;
  /** The place itself ("Lukasheve"). */
  name: string;
  /** Everything above it ("Zaporizhia Raion, Zaporizhia Oblast, Ukraine"). */
  context: string;
  /** OSM place kind: village, town, city, hamlet… */
  kind: string;
};

type PhotonProperties = {
  name?: string;
  osm_value?: string;
  city?: string;
  district?: string;
  county?: string;
  state?: string;
  country?: string;
};

// Tagged as places in OSM, but nobody would call them "where I live".
const SKIPPED_KINDS = new Set(["house", "plot", "farm", "square", "city_block", "allotments"]);

export function normalizeLocationName(value: string | null | undefined): string | null {
  const clean = String(value || "").replace(/\s+/g, " ").trim().slice(0, LOCATION_NAME_MAX_LENGTH).trim();
  return clean || null;
}

function uniqueParts(parts: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    const clean = String(part || "").trim();
    const key = clean.toLocaleLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

export function placeFromPhoton(properties: PhotonProperties): PlaceSuggestion | null {
  const name = String(properties.name || "").trim();
  const kind = String(properties.osm_value || "").trim();
  if (!name || SKIPPED_KINDS.has(kind)) return null;
  // A hamlet or suburb sits inside a town; keep that town in the context.
  const contextParts = uniqueParts([
    properties.city,
    properties.county,
    properties.state,
    properties.country,
  ]).filter((part) => part.toLocaleLowerCase() !== name.toLocaleLowerCase());
  const label = [name, ...contextParts].join(", ").slice(0, LOCATION_NAME_MAX_LENGTH).trim();
  return { label, name, context: contextParts.join(", "), kind };
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceSuggestion[]> {
  const clean = query.trim();
  if (clean.length < 2) return [];
  const params = new URLSearchParams({ q: clean, limit: "10", lang: "en", osm_tag: "place" });
  const response = await fetch(`${PHOTON_URL}?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(`Place search failed (${response.status})`);
  const json = (await response.json()) as { features?: Array<{ properties?: PhotonProperties }> };
  const seen = new Set<string>();
  const places: PlaceSuggestion[] = [];
  for (const feature of json.features || []) {
    const place = placeFromPhoton(feature.properties || {});
    if (!place || seen.has(place.label)) continue;
    seen.add(place.label);
    places.push(place);
  }
  return places.slice(0, 8);
}
