import { useEffect } from "react";
import { ArrowRight, Check, Clock3, Layers3, Sparkles, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { applyPageSeo, safeJsonLd } from "../../lib/pageSeo";
import { buildSeoPageStructuredData } from "../../lib/seoStructuredData";
import {
  getRelatedSeoPages,
  type SeoPageDefinition,
} from "../../data/seoPageRegistry";

const ctaLabels: Record<SeoPageDefinition["ctaVariant"], string> = {
  join: "Join a focus session",
  try: "Try body doubling",
  start: "Start focusing now",
  explore: "Explore focus rooms",
  compare: "See MySession sessions",
};

const typeLabels: Record<SeoPageDefinition["pageType"], string> = {
  guide: "Practical guide",
  "use-case": "Use case",
  comparison: "Platform comparison",
  "session-format": "Session format",
};

export default function DataDrivenSeoPage({ page }: { page: SeoPageDefinition }) {
  const relatedPages = getRelatedSeoPages(page);
  const canonicalUrl = page.canonicalUrl;

  useEffect(() => {
    applyPageSeo({
      title: page.title,
      description: page.metaDescription,
      canonicalUrl,
      type: page.pageType === "guide" ? "article" : "website",
      noIndex: !page.indexable,
      article: page.pageType === "guide"
        ? { publishedAt: page.createdAt, modifiedAt: page.updatedAt, authorName: "MySession" }
        : undefined,
    });
  }, [canonicalUrl, page]);

  return (
    <main className="min-h-screen bg-[#fafafa] text-[#202124]">
      {buildSeoPageStructuredData(page).map((item, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(item) }}
        />
      ))}

      <div className="mx-auto max-w-[1120px] px-5 pb-20 pt-8 sm:px-8 lg:pt-12">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-black/45">
          <Link className="transition-colors hover:text-black" to="/">Home</Link>
          <span aria-hidden="true">/</span>
          <span>{typeLabels[page.pageType]}</span>
        </nav>

        <header className="mt-6 overflow-hidden rounded-[32px] bg-[#202124] px-6 py-10 text-white sm:px-10 sm:py-14 lg:px-14">
          <div className="max-w-[760px]">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/75">
              <Sparkles size={13} aria-hidden="true" />
              {typeLabels[page.pageType]}
            </div>
            <h1 className="mt-5 text-4xl font-extrabold tracking-[-0.045em] sm:text-5xl lg:text-[58px] lg:leading-[1.02]">
              {page.h1}
            </h1>
            <p className="mt-5 max-w-[700px] text-base leading-7 text-white/70 sm:text-lg">
              {page.heroDescription}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/sessions"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#7de08b] px-6 text-sm font-semibold text-[#142417] transition-transform hover:-translate-y-0.5"
              >
                {ctaLabels[page.ctaVariant]} <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link
                to="/how-it-works"
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-white/10 px-6 text-sm font-semibold text-white transition-colors hover:bg-white/15"
              >
                How it works
              </Link>
            </div>
          </div>
        </header>

        <section aria-label="MySession focus room features" className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            [Users, "Shared presence", "Work independently, together"],
            [Clock3, "Flexible timing", "Scheduled and always-open rooms"],
            [Layers3, "Visible structure", "Tasks, stages and check-ins"],
          ].map(([Icon, title, text]) => {
            const FeatureIcon = Icon as typeof Users;
            return (
              <div key={String(title)} className="rounded-2xl bg-white p-5">
                <FeatureIcon size={20} className="text-[#3aa652]" aria-hidden="true" />
                <div className="mt-3 text-sm font-semibold">{String(title)}</div>
                <div className="mt-1 text-xs leading-5 text-black/55">{String(text)}</div>
              </div>
            );
          })}
        </section>

        <div className="mx-auto mt-14 max-w-[840px] space-y-14">
          {page.sections.map((section, sectionIndex) => (
            <section key={section.heading} className="scroll-mt-24">
              <div className="flex items-start gap-4">
                <span className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#e9f8ec] text-xs font-bold text-[#2f8f43]">
                  {String(sectionIndex + 1).padStart(2, "0")}
                </span>
                <div>
                  <h2 className="text-2xl font-bold tracking-[-0.025em] sm:text-3xl">{section.heading}</h2>
                  <div className="mt-4 space-y-4 text-[15px] leading-7 text-black/65 sm:text-base">
                    {section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                  </div>
                  {section.bullets?.length ? (
                    <ul className="mt-5 grid gap-2 sm:grid-cols-2">
                      {section.bullets.map((bullet) => (
                        <li key={bullet} className="flex items-start gap-2.5 rounded-xl bg-white px-4 py-3 text-sm leading-5 text-black/70">
                          <Check size={16} className="mt-0.5 shrink-0 text-[#36a14d]" aria-hidden="true" />
                          {bullet}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            </section>
          ))}

          {page.pageType === "comparison" ? (
            <section>
              <h2 className="text-2xl font-bold tracking-[-0.025em]">What MySession is designed around</h2>
              <div className="mt-5 overflow-hidden rounded-2xl bg-white">
                {[
                  ["Entry", "Book a scheduled session or enter an available 24/7 room"],
                  ["Accountability", "Group presence, intentions, visible tasks and check-ins"],
                  ["Room tools", "Session stages, chat, reactions and optional music"],
                  ["Best way to decide", "Try the working format and verify current provider details"],
                ].map(([label, value]) => (
                  <div key={label} className="grid gap-1 border-b border-black/[0.06] px-5 py-4 last:border-0 sm:grid-cols-[150px_1fr]">
                    <div className="text-xs font-semibold uppercase tracking-wide text-black/40">{label}</div>
                    <div className="text-sm leading-6 text-black/70">{value}</div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {page.faqItems.length > 0 ? (
            <section>
              <h2 className="text-2xl font-bold tracking-[-0.025em]">Frequently asked questions</h2>
              <div className="mt-5 space-y-2">
                {page.faqItems.map((item) => (
                  <details key={item.question} className="group rounded-2xl bg-white px-5 py-4">
                    <summary className="cursor-pointer list-none pr-8 text-sm font-semibold marker:hidden">
                      {item.question}
                    </summary>
                    <p className="mt-3 text-sm leading-6 text-black/60">{item.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          ) : null}

          <section aria-labelledby="related-guides-title">
            <h2 id="related-guides-title" className="text-2xl font-bold tracking-[-0.025em]">Continue exploring</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {relatedPages.map((related) => (
                <Link key={related.slug} to={related.route} className="group rounded-2xl bg-white p-5 transition-transform hover:-translate-y-0.5">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#3a9a4e]">{typeLabels[related.pageType]}</div>
                  <div className="mt-2 flex items-center justify-between gap-4 font-semibold">
                    {related.h1}
                    <ArrowRight size={16} className="shrink-0 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <section className="rounded-[28px] bg-[#e9f8ec] px-6 py-8 sm:px-9">
            <h2 className="text-2xl font-bold tracking-[-0.025em]">Make the next focus block concrete</h2>
            <p className="mt-2 max-w-[620px] text-sm leading-6 text-black/60">Choose a room, name one outcome, and work beside people who are doing the same for their own tasks.</p>
            <Link to="/sessions" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#202124] px-5 text-sm font-semibold text-white">
              Browse sessions <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </section>
        </div>
      </div>
    </main>
  );
}
