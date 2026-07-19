export const PAYWALL_ENABLED =
  String(import.meta.env.VITE_PAYWALL_ENABLED ?? "false")
    .trim()
    .toLowerCase() === "true";

export const USAGE_TRACKING_ENABLED =
  String(import.meta.env.VITE_USAGE_TRACKING_ENABLED || "false").toLowerCase() === "true";
