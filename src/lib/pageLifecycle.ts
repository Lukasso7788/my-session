declare const __MYSESSION_BUILD_ID__: string | undefined;

/** Short identifier of the deployed build (git SHA on Vercel). */
export const APP_BUILD_ID: string =
  typeof __MYSESSION_BUILD_ID__ === "string" && __MYSESSION_BUILD_ID__
    ? __MYSESSION_BUILD_ID__
    : "dev";

export type PageLoadDiagnostics = {
  /** "navigate", "reload", "back_forward", "prerender" or "unknown". */
  navigationType: string;
  /** Chromium sets document.wasDiscarded after the OS/browser dropped a background tab. */
  wasDiscarded: boolean | null;
  buildId: string;
};

export function getPageLoadDiagnostics(): PageLoadDiagnostics {
  let navigationType = "unknown";
  try {
    const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (entry?.type) navigationType = String(entry.type);
  } catch {
    // Older browsers without Navigation Timing Level 2.
  }

  let wasDiscarded: boolean | null = null;
  try {
    const flag = (document as Document & { wasDiscarded?: boolean }).wasDiscarded;
    if (typeof flag === "boolean") wasDiscarded = flag;
  } catch {
    // ignore
  }

  return { navigationType, wasDiscarded, buildId: APP_BUILD_ID };
}
