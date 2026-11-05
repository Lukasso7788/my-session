import { supabase } from "./supabase";
import { normalizeLocationName } from "./placeSearch";

// profiles.location_name is optional and separate from the required timezone.
// It is read and written on its own so that profile loading and saving keep
// working while the column is still being rolled out.
let columnMissing = false;

function isMissingColumnError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    String(error.message || "").includes("location_name")
  );
}

const cache = new Map<string, Promise<string | null>>();

export function loadProfileLocation(userId: string, { fresh = false } = {}): Promise<string | null> {
  if (!userId || columnMissing) return Promise.resolve(null);
  const cached = cache.get(userId);
  if (cached && !fresh) return cached;
  const request = (async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("location_name")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      if (isMissingColumnError(error)) columnMissing = true;
      return null;
    }
    return normalizeLocationName((data as { location_name?: string | null } | null)?.location_name);
  })().catch(() => null);
  cache.set(userId, request);
  return request;
}

export type SaveLocationResult = { saved: boolean; unavailable: boolean };

export async function saveProfileLocation(userId: string, value: string | null): Promise<SaveLocationResult> {
  const location = normalizeLocationName(value);
  const { error } = await supabase
    .from("profiles")
    .update({ location_name: location })
    .eq("id", userId);
  // Location is optional: a missing column or a missing column grant (403,
  // 42501) must never fail saving the rest of the profile.
  if (error) {
    if (isMissingColumnError(error)) columnMissing = true;
    console.warn("[profile] location was not saved:", error);
    return { saved: false, unavailable: true };
  }
  cache.set(userId, Promise.resolve(location));
  known.set(userId.toLowerCase(), location);
  notify();
  return { saved: true, unavailable: false };
}

// Rooms ask for many people at once: requests made in the same tick become a
// single query, and every tile reads from one shared, subscribable map.
const known = new Map<string, string | null>();
const listeners = new Set<() => void>();
const queued = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  for (const listener of listeners) listener();
}

async function flushQueued() {
  flushTimer = null;
  const ids = Array.from(queued);
  queued.clear();
  if (!ids.length) return;
  if (columnMissing) {
    for (const id of ids) known.set(id, null);
    notify();
    return;
  }
  const { data, error } = await supabase
    .from("profiles")
    .select("id, location_name")
    .in("id", ids);
  if (error && isMissingColumnError(error)) columnMissing = true;
  const rows = (error ? [] : data || []) as Array<{ id: string; location_name?: string | null }>;
  const byId = new Map(rows.map((row) => [String(row.id).toLowerCase(), normalizeLocationName(row.location_name)]));
  for (const id of ids) known.set(id, byId.get(id) ?? null);
  notify();
}

export function subscribeProfileLocations(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The saved location for a person, or undefined while it is loading. */
export function getProfileLocationSnapshot(userId: string | null | undefined): string | null | undefined {
  const id = String(userId || "").trim().toLowerCase();
  if (!id) return null;
  if (known.has(id)) return known.get(id);
  if (!queued.has(id)) {
    queued.add(id);
    if (!flushTimer) flushTimer = setTimeout(() => void flushQueued().catch(() => undefined), 0);
  }
  return undefined;
}
