import React, { useEffect } from "react";

type Platform = {
  rank: number;
  name: string;
  bestFor: string;
  format: string;
  freeAccess: string;
  price: string;
  highlight: string;
  limitations: string[];
  href: string;
};

const platforms: Platform[] = [
  {
    rank: 1,
    name: "MySession",
    bestFor: "Group body doubling and ongoing community",
    format: "Live group sessions, 24/7 Focus Hub, multiple focus formats",
    freeAccess: "First 15 sessions free",
    price: "$10/month or $96/year",
    highlight:
      "A community-first alternative for people who prefer working with a familiar group instead of being matched with one stranger at a time.",
    limitations: [
      "Smaller and newer than the largest established platforms",
      "The live schedule is still expanding across time zones",
    ],
    href: "/register",
  },
  {
    rank: 2,
    name: "Focusmate",
    bestFor: "Simple one-to-one accountability",
    format: "Booked 1:1 video sessions",
    freeAccess: "3 sessions per week",
    price: "$12/month or $8/month billed annually",
    highlight:
      "The most straightforward option when you want a scheduled partner, a clear start time, and very little extra structure.",
    limitations: [
      "Primarily one-to-one rather than community-oriented",
      "The free plan is limited to three sessions each week",
    ],
    href: "https://www.focusmate.com/",
  },
  {
    rank: 3,
    name: "Flow Club",
    bestFor: "Host-led small-group focus sessions",
    format: "Facilitated group sessions with optional music",
    freeAccess: "7-day free trial",
    price: "$40/month or $33.33/month billed annually",
    highlight:
      "A polished, host-led experience for people who want strong structure, social energy, and a large session schedule.",
    limitations: [
      "One of the more expensive options",
      "A more facilitated style may feel excessive for people who want quiet coworking",
    ],
    href: "https://www.flow.club/",
  },
  {
    rank: 4,
    name: "FLOWN",
    bestFor: "A broad deep-work membership",
    format: "Facilitated sessions, 24/7 Drop-In, community hosting",
    freeAccess: "Free option and trial access",
    price: "$25/month or $19/month billed annually",
    highlight:
      "A broad productivity membership combining body doubling, facilitated sessions, a 24/7 room, and additional focus resources.",
    limitations: [
      "More features than some users need",
      "More expensive than lightweight accountability tools",
    ],
    href: "https://flown.com/",
  },
  {
    rank: 5,
    name: "Caveday",
    bestFor: "Intensive guided work sprints",
    format: "30-minute, 1-hour, and 3-hour guided sessions",
    freeAccess: "14-day free trial",
    price: "$35/month",
    highlight:
      "A highly structured environment with human guides, distraction rules, planning workshops, and a round-the-clock focus lounge.",
    limitations: [
      "The guided format is less flexible than casual coworking",
      "Higher price than simple body-doubling platforms",
    ],
    href: "https://www.caveday.org/",
  },
  {
    rank: 6,
    name: "Cofocus",
    bestFor: "Minimal peer coworking",
    format: "Lightweight virtual coworking sessions",
    freeAccess: "Check the current plan on the official site",
    price: "Varies",
    highlight:
      "A relatively simple option for users who want online coworking without a large coaching or content layer.",
    limitations: [
      "Smaller ecosystem and fewer surrounding features",
      "Availability can vary by time zone",
    ],
    href: "https://www.cofocus.one/",
  },
  {
    rank: 7,
    name: "Study Together",
    bestFor: "Students and study accountability",
    format: "Large public study rooms and community spaces",
    freeAccess: "Free community access",
    price: "Free",
    highlight:
      "Useful for students who want the energy of a large study community and do not need a professional coworking environment.",
    limitations: [
      "Student-heavy audience",
      "Large public rooms can feel less personal and less focused",
    ],
    href: "https://www.studytogether.com/",
  },
  {
    rank: 8,
    name: "Discord focus communities",
    bestFor: "Free informal accountability",
    format: "Community voice rooms, timers, and ad hoc sessions",
    freeAccess: "Usually free",
    price: "Usually free",
    highlight:
      "A flexible zero-cost choice for people who already use Discord and are comfortable finding the right community themselves.",
    limitations: [
      "Quality and moderation vary significantly",
      "Sessions may be inconsistent or difficult to discover",
    ],
    href: "https://discord.com/",
  },
];

const faq = [
  {
    question: "What is the best Focusmate alternative?",
    answer:
      "The best alternative depends on the kind of accountability you need. MySession is a strong choice for community-based group body doubling, Flow Club is best for highly facilitated sessions, FLOWN offers a broad deep-work membership, and Caveday is suited to intensive guided work sprints.",
  },
  {
    question: "Is there a free alternative to Focusmate?",
    answer:
      "Yes. MySession includes the first 15 sessions for free, Study Together and many Discord communities are free, and several paid platforms offer trials or free tiers. The trade-off is usually schedule depth, consistency, moderation, or the amount of structure included.",
  },
  {
    question: "Is Focusmate still worth using?",
    answer:
      "Yes. Focusmate remains one of the clearest and most established options for one-to-one virtual accountability. It is especially useful when you want to book a specific time and work with one partner. Alternatives become more attractive when you prefer groups, a recurring community, a 24/7 room, or facilitator-led sessions.",
  },
  {
    question: "What is virtual body doubling?",
    answer:
      "Virtual body doubling means working on your own task while another person or group is visibly present online. The other people do not need to help with the task. Their presence, the shared start time, and a short check-in can make it easier to begin and continue working.",
  },
  {
    question: "Can body doubling help with ADHD?",
    answer:
      "Many people with ADHD report that external structure and another person’s presence reduce the friction of starting tasks. Body doubling is not medical treatment and does not replace professional care, but it can be a practical accountability technique for work, study, chores, and administrative tasks.",
  },
];

function setMeta(name: string, content: string, property = false) {
  const selector = property
    ? `meta[property="${name}"]`
    : `meta[name="${name}"]`;
  let tag = document.head.querySelector(selector) as HTMLMetaElement | null;

  if (!tag) {
    tag = document.createElement("meta");
    if (property) tag.setAttribute("property", name);
    else tag.setAttribute("name", name);
    document.head.appendChild(tag);
  }

  tag.setAttribute("content", content);
}

export default function FocusmateAlternativesPage() {
  useEffect(() => {
    const title = "8 Best Focusmate Alternatives in 2026 | MySession";
    const description =
      "Compare the best Focusmate alternatives for body doubling, virtual coworking, ADHD accountability, deep work, and group focus sessions.";

    document.title = title;
    setMeta("description", description);
    setMeta(
      "keywords",
      "Focusmate alternatives, body doubling online, virtual coworking, ADHD accountability, online focus sessions",
    );
    setMeta("robots", "index,follow,max-image-preview:large");
    setMeta("og:title", title, true);
    setMeta("og:description", description, true);
    setMeta("og:type", "article", true);
    setMeta(
      "og:url",
      "https://www.mysession.club/blog/best-focusmate-alternatives",
      true,
    );
    setMeta(
      "og:image",
      "https://www.mysession.club/blog/focusmate-alternatives/hero.webp",
      true,
    );
    setMeta("twitter:card", "summary_large_image");
    setMeta("twitter:title", title);
    setMeta("twitter:description", description);
    setMeta(
      "twitter:image",
      "https://www.mysession.club/blog/focusmate-alternatives/hero.webp",
    );

    let canonical = document.head.querySelector(
      'link[rel="canonical"]',
    ) as HTMLLinkElement | null;

    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }

    canonical.href =
      "https://www.mysession.club/blog/best-focusmate-alternatives";

    const schemaId = "focusmate-alternatives-schema";
    document.getElementById(schemaId)?.remove();

    const schema = document.createElement("script");
    schema.id = schemaId;
    schema.type = "application/ld+json";
    schema.text = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Article",
          headline: "8 Best Focusmate Alternatives in 2026",
          description,
          datePublished: "2026-07-10",
          dateModified: "2026-07-10",
          author: {
            "@type": "Organization",
            name: "MySession",
            url: "https://www.mysession.club/",
          },
          publisher: {
            "@type": "Organization",
            name: "MySession",
            url: "https://www.mysession.club/",
          },
          mainEntityOfPage:
            "https://www.mysession.club/blog/best-focusmate-alternatives",
          image:
            "https://www.mysession.club/blog/focusmate-alternatives/hero.webp",
        },
        {
          "@type": "FAQPage",
          mainEntity: faq.map((item) => ({
            "@type": "Question",
            name: item.question,
            acceptedAnswer: {
              "@type": "Answer",
              text: item.answer,
            },
          })),
        },
        {
          "@type": "ItemList",
          name: "Best Focusmate alternatives",
          itemListElement: platforms.map((platform) => ({
            "@type": "ListItem",
            position: platform.rank,
            name: platform.name,
            url: platform.href.startsWith("http")
              ? platform.href
              : `https://www.mysession.club${platform.href}`,
          })),
        },
      ],
    });

    document.head.appendChild(schema);

    return () => {
      document.getElementById(schemaId)?.remove();
    };
  }, []);

  const scrollToComparison = () => {
    document
      .getElementById("comparison")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main className="min-h-screen bg-[#F3F1F1] text-[#181818]">
      <header className="sticky top-0 z-40 border-b border-black/10 bg-[#F3F1F1]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between gap-4 px-4 sm:px-6">
          <a href="/" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#81DB86] font-black text-[#102512]">
              M
            </div>
            <span className="font-inter text-[18px] font-bold tracking-[-0.03em]">
              MySession
            </span>
          </a>

          <div className="flex items-center gap-2">
            <a
              href="/sessions"
              className="hidden rounded-xl px-4 py-2 text-[13px] font-semibold text-black/65 transition hover:bg-black/5 sm:inline-flex"
            >
              Browse sessions
            </a>
            <a
              href="/register"
              className="inline-flex h-10 items-center justify-center rounded-xl bg-[#252525] px-4 text-[13px] font-semibold text-white transition hover:bg-[#343434]"
            >
              Join free
            </a>
          </div>
        </div>
      </header>

      <article>
        <section className="relative overflow-hidden border-b border-black/10">
          <div className="absolute inset-0">
            <div className="absolute -left-20 top-10 h-72 w-72 rounded-full bg-[#81DB86]/25 blur-3xl" />
            <div className="absolute right-0 top-0 h-96 w-96 rounded-full bg-[#5286F6]/15 blur-3xl" />
          </div>

          <div className="relative mx-auto grid max-w-[1180px] gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.08fr,0.92fr] lg:items-center">
            <div>
              <div className="mb-5 inline-flex rounded-full border border-black/10 bg-white/55 px-3 py-1.5 text-[12px] font-semibold text-black/60">
                Updated July 2026 · 14 min read
              </div>

              <h1 className="max-w-[760px] font-inter text-[42px] font-black leading-[0.98] tracking-[-0.055em] sm:text-[58px] lg:text-[72px]">
                8 Best Focusmate Alternatives in 2026
              </h1>

              <p className="mt-6 max-w-[720px] text-[18px] leading-8 text-black/62 sm:text-[20px]">
                Focusmate is excellent for simple one-to-one accountability.
                But it is not the only way to body double online. We compared
                the strongest alternatives for group coworking, ADHD-friendly
                focus, guided work sprints, community, and price.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={scrollToComparison}
                  className="h-12 rounded-2xl bg-[#252525] px-6 text-[14px] font-bold text-white transition hover:-translate-y-0.5 hover:bg-[#343434]"
                >
                  See the comparison
                </button>
                <a
                  href="/register"
                  className="inline-flex h-12 items-center justify-center rounded-2xl border border-black/10 bg-white/60 px-6 text-[14px] font-bold transition hover:-translate-y-0.5 hover:bg-white"
                >
                  Try MySession free
                </a>
              </div>
            </div>

            <div
              aria-label="Illustration placeholder for virtual coworking"
              className="relative min-h-[370px] overflow-hidden rounded-[34px] border border-black/10 bg-[#252525] p-5 shadow-[0_30px_80px_rgba(20,20,20,0.18)]"
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(129,219,134,0.28),transparent_32%),radial-gradient(circle_at_90%_80%,rgba(82,134,246,0.24),transparent_34%)]" />

              <div className="relative grid h-full min-h-[330px] grid-cols-2 gap-3">
                {["Planning", "Writing", "Studying", "Deep work"].map(
                  (label, index) => (
                    <div
                      key={label}
                      className="flex flex-col justify-between rounded-[24px] border border-white/10 bg-white/[0.07] p-4 backdrop-blur"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`h-2.5 w-2.5 rounded-full ${
                            index === 1 ? "bg-[#5286F6]" : "bg-[#81DB86]"
                          }`}
                        />
                        <span className="text-[12px] font-semibold text-white/65">
                          Live
                        </span>
                      </div>
                      <div>
                        <div className="mb-3 h-14 w-14 rounded-full bg-white/10" />
                        <div className="text-[14px] font-bold text-white">
                          {label}
                        </div>
                        <div className="mt-1 text-[11px] text-white/45">
                          Working together
                        </div>
                      </div>
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[900px] px-4 py-14 sm:px-6 sm:py-20">
          <p className="text-[19px] leading-9 text-black/72">
            Focusmate helped make virtual body doubling mainstream: you book a
            session, meet one person on video, briefly state what you plan to
            do, work, and report back at the end. That simplicity is still its
            greatest strength. The problem is that one-to-one matching is not
            the ideal environment for everyone.
          </p>

          <p className="mt-6 text-[19px] leading-9 text-black/72">
            Some people focus better in a small group. Some want the same
            familiar people to return each day. Others need a facilitator,
            longer work blocks, a silent 24/7 room, or a cheaper way to work
            several times per day. This guide separates those needs instead of
            pretending there is one universally best platform.
          </p>

          <aside className="mt-10 rounded-[28px] border border-[#81DB86]/40 bg-[#81DB86]/14 p-6 sm:p-8">
            <div className="text-[13px] font-black uppercase tracking-[0.16em] text-[#286A2D]">
              Our quick answer
            </div>
            <p className="mt-3 text-[18px] font-semibold leading-8">
              Choose MySession for group body doubling and community,
              Focusmate for simple one-to-one sessions, Flow Club for polished
              host-led coworking, FLOWN for a broad deep-work membership, and
              Caveday for strict guided sprints.
            </p>
          </aside>
        </section>

        <section
          id="comparison"
          className="scroll-mt-24 border-y border-black/10 bg-white/45"
        >
          <div className="mx-auto max-w-[1180px] px-4 py-14 sm:px-6 sm:py-20">
            <div className="max-w-[760px]">
              <div className="text-[13px] font-black uppercase tracking-[0.16em] text-black/45">
                At a glance
              </div>
              <h2 className="mt-3 text-[34px] font-black tracking-[-0.045em] sm:text-[46px]">
                Focusmate alternatives compared
              </h2>
              <p className="mt-4 text-[17px] leading-8 text-black/60">
                Prices and plan details can change. The figures below were
                checked against official platform pages in July 2026.
              </p>
            </div>

            <div className="mt-10 overflow-x-auto rounded-[26px] border border-black/10 bg-[#F8F7F7] shadow-sm">
              <table className="min-w-[960px] w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-black/10 text-[12px] uppercase tracking-[0.1em] text-black/45">
                    <th className="px-5 py-4">Platform</th>
                    <th className="px-5 py-4">Best for</th>
                    <th className="px-5 py-4">Format</th>
                    <th className="px-5 py-4">Free access</th>
                    <th className="px-5 py-4">Paid price</th>
                  </tr>
                </thead>
                <tbody>
                  {platforms.slice(0, 5).map((platform) => (
                    <tr
                      key={platform.name}
                      className="border-b border-black/[0.07] last:border-0"
                    >
                      <td className="px-5 py-5 align-top">
                        <div className="font-bold">{platform.name}</div>
                        {platform.rank === 1 ? (
                          <span className="mt-2 inline-flex rounded-full bg-[#81DB86]/25 px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-[#286A2D]">
                            Best for groups
                          </span>
                        ) : null}
                      </td>
                      <td className="px-5 py-5 align-top text-[14px] leading-6 text-black/65">
                        {platform.bestFor}
                      </td>
                      <td className="px-5 py-5 align-top text-[14px] leading-6 text-black/65">
                        {platform.format}
                      </td>
                      <td className="px-5 py-5 align-top text-[14px] leading-6 text-black/65">
                        {platform.freeAccess}
                      </td>
                      <td className="px-5 py-5 align-top text-[14px] font-semibold leading-6">
                        {platform.price}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[900px] px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="text-[34px] font-black tracking-[-0.045em] sm:text-[46px]">
            Why people look for a Focusmate alternative
          </h2>

          <div className="mt-9 grid gap-4 sm:grid-cols-2">
            {[
              [
                "Groups instead of one stranger",
                "A group can feel less intense, create more energy, and make it easier to become part of a recurring community.",
              ],
              [
                "More sessions for the money",
                "Three free sessions per week may be enough for occasional use, but not for people who body double every day.",
              ],
              [
                "Different work rhythms",
                "Some tasks fit 25/5 Pomodoros. Others need 50-minute blocks, long deep-work sessions, or flexible drop-in rooms.",
              ],
              [
                "Facilitation and structure",
                "A host, verbal check-ins, music, breaks, and a clear session script can reduce decision-making and help people begin.",
              ],
              [
                "Familiar faces",
                "Repeated contact with the same people can create trust and make showing up feel more natural than repeated random matching.",
              ],
              [
                "A stronger community layer",
                "Some users want more than a booking calendar: chat, recurring hosts, accountability groups, and a place they recognize.",
              ],
            ].map(([title, body]) => (
              <div
                key={title}
                className="rounded-[24px] border border-black/10 bg-white/50 p-6"
              >
                <h3 className="text-[18px] font-black tracking-[-0.025em]">
                  {title}
                </h3>
                <p className="mt-3 text-[15px] leading-7 text-black/60">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y border-black/10 bg-[#252525] text-white">
          <div className="mx-auto max-w-[1180px] px-4 py-14 sm:px-6 sm:py-20">
            <div className="max-w-[760px]">
              <div className="text-[13px] font-black uppercase tracking-[0.16em] text-[#81DB86]">
                The full list
              </div>
              <h2 className="mt-3 text-[34px] font-black tracking-[-0.045em] sm:text-[48px]">
                The 8 best Focusmate alternatives
              </h2>
            </div>

            <div className="mt-12 space-y-6">
              {platforms.map((platform) => (
                <section
                  key={platform.name}
                  className="rounded-[30px] border border-white/10 bg-white/[0.055] p-6 sm:p-8"
                >
                  <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
                    <div>
                      <div className="text-[12px] font-black uppercase tracking-[0.14em] text-white/40">
                        #{platform.rank}
                      </div>
                      <h3 className="mt-2 text-[28px] font-black tracking-[-0.04em]">
                        {platform.name}
                      </h3>
                      <div className="mt-2 text-[14px] font-semibold text-[#81DB86]">
                        Best for: {platform.bestFor}
                      </div>
                    </div>

                    <a
                      href={platform.href}
                      target={platform.href.startsWith("http") ? "_blank" : undefined}
                      rel={
                        platform.href.startsWith("http")
                          ? "noopener noreferrer"
                          : undefined
                      }
                      className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-white/12 bg-white/[0.06] px-4 text-[13px] font-bold transition hover:bg-white/[0.12]"
                    >
                      Visit {platform.name}
                    </a>
                  </div>

                  <p className="mt-6 max-w-[850px] text-[17px] leading-8 text-white/70">
                    {platform.highlight}
                  </p>

                  <div className="mt-6 grid gap-4 md:grid-cols-3">
                    <div className="rounded-2xl bg-black/20 p-4">
                      <div className="text-[11px] font-black uppercase tracking-[0.12em] text-white/35">
                        Format
                      </div>
                      <div className="mt-2 text-[14px] leading-6 text-white/80">
                        {platform.format}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-black/20 p-4">
                      <div className="text-[11px] font-black uppercase tracking-[0.12em] text-white/35">
                        Free access
                      </div>
                      <div className="mt-2 text-[14px] leading-6 text-white/80">
                        {platform.freeAccess}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-black/20 p-4">
                      <div className="text-[11px] font-black uppercase tracking-[0.12em] text-white/35">
                        Price
                      </div>
                      <div className="mt-2 text-[14px] font-bold leading-6 text-white">
                        {platform.price}
                      </div>
                    </div>
                  </div>

                  <div className="mt-6">
                    <div className="text-[12px] font-black uppercase tracking-[0.12em] text-white/35">
                      Things to consider
                    </div>
                    <ul className="mt-3 space-y-2">
                      {platform.limitations.map((item) => (
                        <li
                          key={item}
                          className="flex gap-3 text-[14px] leading-6 text-white/60"
                        >
                          <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#F65252]" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[900px] px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="text-[34px] font-black tracking-[-0.045em] sm:text-[46px]">
            Which platform should you choose?
          </h2>

          <div className="mt-9 overflow-hidden rounded-[28px] border border-black/10 bg-white/55">
            {[
              ["I want group accountability and community", "MySession"],
              ["I want the simplest one-to-one format", "Focusmate"],
              ["I want a polished host-led experience", "Flow Club"],
              ["I want several deep-work tools in one membership", "FLOWN"],
              ["I want strict, highly guided work sprints", "Caveday"],
              ["I am a student and need a free community", "Study Together"],
              ["I want a free informal option", "Discord communities"],
            ].map(([need, result], index) => (
              <div
                key={need}
                className={`grid gap-2 px-6 py-5 sm:grid-cols-[1fr,220px] sm:items-center ${
                  index ? "border-t border-black/[0.07]" : ""
                }`}
              >
                <div className="text-[15px] text-black/62">{need}</div>
                <div className="text-[16px] font-black">{result}</div>
              </div>
            ))}
          </div>

          <h2 className="mt-16 text-[34px] font-black tracking-[-0.045em] sm:text-[46px]">
            What makes a good virtual coworking platform?
          </h2>

          <p className="mt-6 text-[17px] leading-8 text-black/66">
            The right platform is the one you will actually open when a task
            feels difficult. A long feature list is less important than the
            friction between deciding to work and beginning the session. Look
            for enough availability in your time zone, a session length that
            fits your tasks, clear expectations about cameras and check-ins,
            and an environment that feels socially comfortable.
          </p>

          <p className="mt-5 text-[17px] leading-8 text-black/66">
            Price also needs to be compared with frequency. A more expensive
            unlimited membership may be reasonable when it replaces a daily
            coffee-shop routine. A lightweight free tier may be better when
            you only need accountability once or twice per week. The most
            useful test is simple: after one week, did the platform help you
            start more tasks and finish more meaningful work?
          </p>

          <aside className="mt-10 rounded-[28px] border border-black/10 bg-[#ADD3FF]/35 p-6 sm:p-8">
            <h3 className="text-[22px] font-black tracking-[-0.035em]">
              Body doubling is a tool, not a cure
            </h3>
            <p className="mt-3 text-[15px] leading-7 text-black/65">
              Body doubling can provide external structure and gentle social
              accountability. It is not a medical treatment and it does not
              guarantee productivity. People with significant attention,
              anxiety, or executive-function difficulties should treat it as
              one practical support among others.
            </p>
          </aside>
        </section>

        <section className="border-y border-black/10 bg-white/45">
          <div className="mx-auto max-w-[900px] px-4 py-14 sm:px-6 sm:py-20">
            <div className="text-[13px] font-black uppercase tracking-[0.16em] text-black/45">
              Frequently asked questions
            </div>
            <h2 className="mt-3 text-[34px] font-black tracking-[-0.045em] sm:text-[46px]">
              Focusmate alternatives FAQ
            </h2>

            <div className="mt-9 space-y-3">
              {faq.map((item) => (
                <details
                  key={item.question}
                  className="group rounded-[22px] border border-black/10 bg-[#F8F7F7] px-5 py-4 open:bg-white"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-black">
                    <span>{item.question}</span>
                    <span className="text-[20px] font-normal text-black/40 transition group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-4 max-w-[760px] pb-2 text-[15px] leading-7 text-black/62">
                    {item.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1180px] px-4 py-14 sm:px-6 sm:py-20">
          <div className="relative overflow-hidden rounded-[34px] bg-[#81DB86] p-7 text-[#102512] sm:p-12">
            <div className="absolute -right-16 -top-20 h-72 w-72 rounded-full border-[48px] border-white/20" />
            <div className="relative max-w-[720px]">
              <div className="text-[13px] font-black uppercase tracking-[0.16em] text-[#286A2D]">
                Start with one session
              </div>
              <h2 className="mt-3 text-[36px] font-black leading-tight tracking-[-0.05em] sm:text-[52px]">
                Work alongside real people instead of fighting the task alone.
              </h2>
              <p className="mt-5 max-w-[640px] text-[17px] leading-8 text-[#173C1A]/75">
                Join a MySession focus room, state what you are working on, and
                use the shared structure to begin. The free plan is enough to
                test whether group body doubling fits your routine.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="/register"
                  className="inline-flex h-12 items-center justify-center rounded-2xl bg-[#252525] px-6 text-[14px] font-bold text-white transition hover:-translate-y-0.5 hover:bg-[#343434]"
                >
                  Join MySession free
                </a>
                <a
                  href="/sessions"
                  className="inline-flex h-12 items-center justify-center rounded-2xl border border-[#173C1A]/20 bg-white/35 px-6 text-[14px] font-bold transition hover:bg-white/55"
                >
                  Browse live sessions
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[900px] px-4 pb-20 sm:px-6">
          <div className="border-t border-black/10 pt-8">
            <h2 className="text-[18px] font-black">Methodology and sources</h2>
            <p className="mt-3 text-[14px] leading-7 text-black/55">
              We compared format, availability, free access, public pricing,
              degree of facilitation, and intended audience. MySession is our
              own product, so its placement is not an independent editorial
              endorsement. Competitor details were checked using official
              product and pricing pages in July 2026.
            </p>

            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[13px] font-semibold">
              <a
                href="https://www.focusmate.com/pricing/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-black/20 underline-offset-4 hover:decoration-black"
              >
                Focusmate pricing
              </a>
              <a
                href="https://in.flow.club/plans/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-black/20 underline-offset-4 hover:decoration-black"
              >
                Flow Club plans
              </a>
              <a
                href="https://flown.com/pricing"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-black/20 underline-offset-4 hover:decoration-black"
              >
                FLOWN pricing
              </a>
              <a
                href="https://www.caveday.org/passes"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-black/20 underline-offset-4 hover:decoration-black"
              >
                Caveday membership
              </a>
            </div>

            <p className="mt-6 text-[12px] leading-6 text-black/42">
              Last reviewed: July 10, 2026. Product features and prices may
              change after publication.
            </p>
          </div>
        </section>
      </article>
    </main>
  );
}
