export const ALL_JITSI_DOMAINS = [
    "meet-eu.mysession.club",
    "meet-us-east.mysession.club",
    "meet-apac.mysession.club",
] as const;

export type JitsiDomain = (typeof ALL_JITSI_DOMAINS)[number];

export function domainsForSession(session: any): readonly string[] {
    const preferred = String(session?.jitsi_domain || "").trim();

    if (preferred && (ALL_JITSI_DOMAINS as readonly string[]).includes(preferred)) {
        return [preferred, ...ALL_JITSI_DOMAINS.filter((d) => d !== preferred)];
    }

    // если поле пустое — дефолт EU
    return ALL_JITSI_DOMAINS;
}
