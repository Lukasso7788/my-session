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
  if (error) {
    if (isMissingColumnError(error)) {
      columnMissing = true;
      return { saved: false, unavailable: true };
    }
    throw error;
  }
  cache.set(userId, Promise.resolve(location));
  return { saved: true, unavailable: false };
}
