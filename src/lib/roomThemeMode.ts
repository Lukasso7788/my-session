export type RoomThemeMode = "light" | "autumn" | "dark";

export function parseRoomThemeMode(value: string | null | undefined): RoomThemeMode {
  const normalized = value?.trim().toLowerCase();
  return normalized === "light" || normalized === "autumn" ? normalized : "dark";
}

// Existing room components only need a light/dark contrast base. Autumn uses
// the dark contrast base with warm surfaces supplied by the room stylesheet.
export function roomThemeContrastBase(mode: RoomThemeMode): "light" | "dark" {
  return mode === "dark" ? "dark" : "light";
}
