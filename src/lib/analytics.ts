// src/lib/analytics.ts

export type ProductEventProperties = Record<string, unknown>;

type AnalyticsWindow = Window & {
  gtag?: (...args: unknown[]) => void;
  dataLayer?: Array<Record<string, unknown>>;
};

/**
 * Sends a non-blocking product analytics event when an analytics provider
 * is available. The room must never fail because analytics is unavailable.
 */
export function captureProductEvent(
  eventName: string,
  properties: ProductEventProperties = {},
): void {
  const name = String(eventName || "").trim();
  if (!name || typeof window === "undefined") return;

  const analyticsWindow = window as AnalyticsWindow;

  try {
    if (typeof analyticsWindow.gtag === "function") {
      analyticsWindow.gtag("event", name, properties);
      return;
    }

    if (Array.isArray(analyticsWindow.dataLayer)) {
      analyticsWindow.dataLayer.push({
        event: name,
        ...properties,
      });
    }
  } catch {
    // Analytics must never interrupt the room or the production build.
  }
}
