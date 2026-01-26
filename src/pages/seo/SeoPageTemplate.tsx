// src/pages/seo/SeoPageTemplate.tsx
import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";

export type FaqItem = { q: string; a: string };

export type SeoSection = {
    h2: string;
    paragraphs?: ReactNode[];
    bullets?: ReactNode[];
};

export type RelatedLink = { label: string; to: string };

function safeJsonLd(obj: unknown) {
    // Prevent closing script tags / HTML injection in JSON-LD
    return JSON.stringify(obj).replace(/</g, "\\u003c");
}

function upsertMeta(name: string, content: string) {
    if (typeof document === "undefined") return;
    let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
    if (!el) {
        el = document.createElement("meta");
        el.setAttribute("name", name);
        document.head.appendChild(el);
    }
    el.setAttribute("content", content);
}

function upsertMetaProperty(property: string, content: string) {
    if (typeof document === "undefined") return;
    let el = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null;
    if (!el) {
        el = document.createElement("meta");
        el.setAttribute("property", property);
        document.head.appendChild(el);
    }
    el.setAttribute("content", content);
}

function upsertLink(rel: string, href: string) {
    if (typeof document === "undefined") return;
    let el = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
    if (!el) {
        el = document.createElement("link");
        el.setAttribute("rel", rel);
        document.head.appendChild(el);
    }
    el.setAttribute("href", href);
}

export default function SeoPageTemplate(props: {
    /** Used for title only */
    pageTitle: string;
    /** H1 must be "What is X?" */
    h1: string;

    /** 3–6 short paragraphs are OK */
    intro: ReactNode[];

    /** Canonical sections (H2 blocks) */
    sections?: SeoSection[];

    /** 6–12 items is fine */
    faq: FaqItem[];

    /** Optional meta description (not visible on page) */
    metaDescription?: string;

    /** Optional related internal links (good for internal linking) */
    relatedLinks?: RelatedLink[];

    /** Optional secondary CTA */
    secondaryCta?: { label: string; to: string };
}) {
    const {
        pageTitle,
        h1,
        intro,
        sections = [],
        faq,
        metaDescription,
        relatedLinks = [],
        secondaryCta = { label: "See AI assistant", to: "/ai-assistant" },
    } = props;

    useEffect(() => {
        try {
            const path =
                typeof window !== "undefined" && window.location?.pathname
                    ? window.location.pathname
                    : "/";
            const url = `https://mysession.club${path}`;

            document.title = `${pageTitle} | MySession`;

            if (metaDescription) {
                upsertMeta("description", metaDescription);
            }

            // Canonical
            upsertLink("canonical", url);

            // Open Graph
            upsertMetaProperty("og:title", `${pageTitle} | MySession`);
            upsertMetaProperty("og:description", metaDescription ?? "");
            upsertMetaProperty("og:url", url);
            upsertMetaProperty("og:type", "website");

            // Twitter
            upsertMeta("twitter:card", "summary_large_image");
            upsertMeta("twitter:title", `${pageTitle} | MySession`);
            upsertMeta("twitter:description", metaDescription ?? "");
        } catch { }
    }, [pageTitle, metaDescription]);

    const faqJsonLd = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faq.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: {
                "@type": "Answer",
                text: f.a,
            },
        })),
    };

    const orgJsonLd = {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "MySession",
        url: "https://mysession.club",
    };

    const appJsonLd = {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "MySession",
        operatingSystem: "Web",
        applicationCategory: "ProductivityApplication",
        url: "https://mysession.club",
        description:
            typeof metaDescription === "string" && metaDescription.trim().length > 0
                ? metaDescription
                : "Live online body doubling and group focus sessions — with optional real-time AI support.",
    };

    return (
        <div className="min-h-screen bg-white text-[#111827] px-4 py-14">
            {/* JSON-LD (not visible) */}
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(faqJsonLd) }} />
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(orgJsonLd) }} />
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(appJsonLd) }} />

            <div className="max-w-3xl mx-auto">
                {/* Small brand line (no "canonical", no SEO text) */}
                <div className="text-[12px] text-black/45">MySession</div>

                <h1 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight">{h1}</h1>

                {relatedLinks.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                        {relatedLinks.map((l) => (
                            <Link
                                key={l.to}
                                to={l.to}
                                className="text-[12px] px-3 py-1 rounded-full border border-black/10 text-black/60 hover:text-black hover:border-black/20 transition"
                            >
                                {l.label}
                            </Link>
                        ))}
                    </div>
                ) : null}

                <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-black/70">
                    {intro.map((p, idx) => (
                        <p key={idx}>{p}</p>
                    ))}
                </div>

                {sections.length > 0 ? (
                    <div className="mt-10 space-y-10">
                        {sections.map((s) => (
                            <section key={s.h2}>
                                <h2 className="text-xl font-semibold">{s.h2}</h2>

                                {s.paragraphs?.length ? (
                                    <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-black/70">
                                        {s.paragraphs.map((p, idx) => (
                                            <p key={idx}>{p}</p>
                                        ))}
                                    </div>
                                ) : null}

                                {s.bullets?.length ? (
                                    <ul className="mt-4 space-y-2 text-[14px] text-black/70">
                                        {s.bullets.map((b, idx) => (
                                            <li key={idx} className="flex gap-2">
                                                <span className="mt-[8px] w-[6px] h-[6px] rounded-full bg-black/60 shrink-0" />
                                                <span>{b}</span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : null}
                            </section>
                        ))}
                    </div>
                ) : null}

                <div className="mt-10 flex flex-col sm:flex-row gap-3">
                    <Link
                        to="/sessions"
                        className="h-11 inline-flex items-center justify-center rounded-full px-6 text-[14px] font-semibold bg-[#111827] text-white hover:opacity-90 transition"
                    >
                        Join a session
                    </Link>

                    <Link
                        to={secondaryCta.to}
                        className="h-11 inline-flex items-center justify-center rounded-full px-6 text-[14px] font-semibold border border-[#111827] text-[#111827] hover:bg-[#111827] hover:text-white transition"
                    >
                        {secondaryCta.label}
                    </Link>

                    <Link
                        to="/"
                        className="h-11 inline-flex items-center justify-center rounded-full px-6 text-[14px] font-semibold border border-black/10 text-black/70 hover:border-black/20 hover:text-black transition"
                    >
                        Back to landing
                    </Link>
                </div>

                <div className="mt-12">
                    <h2 className="text-xl font-semibold">FAQ</h2>
                    <div className="mt-4 space-y-3">
                        {faq.map((item) => (
                            <div key={item.q} className="border border-black/10 rounded-2xl p-5">
                                <div className="font-semibold text-[14px]">{item.q}</div>
                                <div className="mt-2 text-[14px] text-black/65 leading-relaxed">{item.a}</div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* ничего лишнего внизу */}
            </div>
        </div>
    );
}
