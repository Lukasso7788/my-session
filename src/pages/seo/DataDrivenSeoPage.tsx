import { useEffect } from "react";
import { ArrowRight, Check, Clock3, Layers3, Sparkles, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { applyPageSeo, safeJsonLd } from "../../lib/pageSeo";
import { buildSeoPageStructuredData } from "../../lib/seoStructuredData";
import {
  getRelatedSeoPages,
  seoPagesBySlug,
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
  "topic-hub": "Topic hub",
  guide: "Practical guide",
  "use-case": "Use case",
  comparison: "Platform comparison",
  "session-format": "Session format",
};

export default function DataDrivenSeoPage({ slug }: { slug: string }) {
  const page = seoPagesBySlug.get(slug);
  if (!page) {
    return <main className="min-h-screen px-5 py-20 text-center">Guide not found.</main>;
  }
  return <SeoPageContent page={page} />;
}

function SeoPageContent({ page }: { page: SeoPageDefinition }) {
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

  if (page.pageType === "topic-hub") {
    return (
      <main className="min-h-screen bg-[#f7f9fd] text-[#19253b]">
        {buildSeoPageStructuredData(page).map((item, index) => (
          <script key={index} type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(item) }} />
        ))}
        <div className="mx-auto max-w-[1120px] px-5 pb-16 pt-6 sm:px-8 lg:pt-9">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-[#68758b]">
            <Link className="hover:text-[#326fda]" to="/">Home</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Body doubling</span>
          </nav>

          <header className="mt-5 overflow-hidden rounded-[28px] border border-[#dce6f6] bg-[#edf4ff] lg:grid lg:grid-cols-[1.05fr_0.95fr]">
            <div className="flex flex-col justify-center px-6 py-9 sm:px-10 sm:py-12 lg:px-12">
              <h1 className="max-w-[600px] text-4xl font-bold leading-[1.1] tracking-[-0.045em] sm:text-5xl">
                {page.h1}
              </h1>
              <p className="mt-5 max-w-[510px] text-base leading-7 text-[#52617a]">
                {page.heroDescription}
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link to="/sessions" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#5286f6] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#326fda] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#326fda]">
                  Find a room <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <Link to="/how-it-works" className="inline-flex min-h-11 items-center rounded-full border border-[#b6cdf6] bg-white px-5 text-sm font-semibold text-[#285ebc] transition-colors hover:bg-[#f6faff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#326fda]">
                  How it works
                </Link>
              </div>
            </div>
            <img
              src="/blog/editorial/body-doubling-together.jpg"
              alt="Two people quietly working on their own tasks at the same table"
              width={1672}
              height={941}
              fetchPriority="high"
              className="h-[245px] w-full object-cover object-center sm:h-[330px] lg:h-full lg:min-h-[390px]"
            />
          </header>

          <div className="mx-auto max-w-[900px]">
            <section className="grid gap-4 border-b border-[#dce6f6] py-9 sm:grid-cols-[220px_1fr] sm:gap-9">
              <h2 className="text-xl font-semibold tracking-[-0.02em]">{page.sections[0].heading}</h2>
              <p className="text-[15px] leading-7 text-[#52617a]">{page.sections[0].body[0]}</p>
            </section>

            <section aria-labelledby="body-doubling-reading" className="py-9">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 id="body-doubling-reading" className="text-2xl font-semibold tracking-[-0.025em]">Read more, or just begin</h2>
                  <p className="mt-2 text-sm text-[#62718a]">A practical guide if you want the details. A room if you are ready now.</p>
                </div>
                <Link to="/guides/what-is-body-doubling" className="inline-flex items-center gap-1 text-sm font-semibold text-[#285ebc] hover:underline focus-visible:underline">
                  What is body doubling? <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {relatedPages.slice(0, 3).map((related) => (
                  <Link key={related.slug} to={related.route} className="group flex min-h-[100px] items-end justify-between gap-3 rounded-2xl border border-[#dce6f6] bg-white p-5 text-sm font-semibold transition-colors hover:border-[#8fb5fc] hover:bg-[#f8fbff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#326fda]">
                    <span>{related.h1}</span>
                    <ArrowRight size={16} className="shrink-0 text-[#5286f6] transition-transform group-hover:translate-x-1" aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </section>

            <section aria-labelledby="body-doubling-questions" className="border-t border-[#dce6f6] pt-8">
              <h2 id="body-doubling-questions" className="text-lg font-semibold">A few quick answers</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {page.faqItems.map((item) => (
                  <details key={item.question} className="group rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-[#e2e9f4]">
                    <summary className="cursor-pointer font-medium text-[#263653] marker:text-[#5286f6]">{item.question}</summary>
                    <p className="mt-2 leading-6 text-[#62718a]">{item.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>
    );
  }

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
