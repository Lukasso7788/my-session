import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const pages = JSON.parse(await readFile(path.resolve("src/data/seo-pages.json"), "utf8"));
const dist = path.resolve("dist");
const template = await readFile(path.join(dist, "index.html"), "utf8");

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const safeJson = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");

const corePages = [
  {
    slug: "home",
    route: "/",
    pageType: "website",
    schemaType: "WebSite",
    eyebrow: "Live online focus community",
    title: "MySession – Stay Focused 24/7",
    metaDescription: "Join live virtual coworking and body doubling sessions, work alongside focused people, and use structured focus rooms to finally get things done.",
    h1: "Live body doubling sessions for focused work",
    heroDescription: "MySession gives remote workers, students, creators, and independent professionals a shared place to begin, focus, and finish meaningful work.",
    sections: [
      {
        heading: "Focus with other people, without another meeting",
        body: [
          "Working alone can make a clear task feel strangely difficult to start. MySession uses body doubling: people join the same online focus room, state what they intend to do, and then work independently while sharing a quiet sense of momentum.",
          "There is no need to collaborate on the same project or perform productivity for the room. The value comes from a visible start, a protected work interval, and the knowledge that other people are following through on their own commitments at the same time.",
        ],
      },
      {
        heading: "Choose a focus format that fits your day",
        body: [
          "Join an available room when you need to begin now, or choose a scheduled session when an appointment creates stronger accountability. Different session lengths make it easier to match the room to a quick administrative task, a normal study block, or deeper project work.",
        ],
        bullets: [
          "Live body doubling and virtual coworking rooms",
          "Clear intentions, tasks, stages, and check-ins",
          "Flexible sessions for studying, writing, planning, and remote work",
          "Camera, microphone, chat, and room controls that stay in your hands",
        ],
      },
      {
        heading: "A simple rhythm for making progress",
        body: [
          "Pick one concrete outcome before the work interval begins. Join the room, add your intention, and let the shared timer protect the block from extra planning. At the end, record what moved forward and name the next action so returning to the task is easier.",
          "MySession is designed to make starting feel lighter, not to turn focus into another complicated system. You can use the structure when it helps, choose the room that suits the task, and build a repeatable practice around real completed work.",
        ],
      },
    ],
    faqItems: [
      { question: "What is body doubling?", answer: "Body doubling means working on your own task while another person or group is also present and focused on theirs." },
      { question: "Do I need to work on the same task as everyone else?", answer: "No. Participants can study, write, plan, code, or handle different work while sharing the same focus interval." },
    ],
    relatedPageSlugs: ["how-it-works", "body-doubling", "body-doubling-for-adhd", "body-doubling-for-studying"],
    updatedAt: "2026-09-09",
  },
  {
    slug: "how-it-works",
    route: "/how-it-works",
    pageType: "how-to",
    schemaType: "HowTo",
    eyebrow: "A simple focus loop",
    title: "How MySession works | MySession",
    metaDescription: "MySession helps you focus through live online body doubling sessions: join a room, set an intention, work during the timer, check in, and recap your progress.",
    h1: "How MySession works",
    heroDescription: "MySession turns an open-ended task into a clear shared focus block: join, set an intention, work, check in, and leave with a concrete next step.",
    sections: [
      {
        heading: "1. Choose a live focus room",
        body: [
          "Start with the amount of structure you need. You can enter an available room when you want to begin immediately or choose a scheduled session when putting time on the calendar helps you follow through.",
          "Room length and format are visible before you join, so you can match a short block to a difficult start or reserve a longer session for study, writing, design, coding, and other work that benefits from continuity.",
        ],
      },
      {
        heading: "2. Set a concrete intention",
        body: [
          "Before the focus stage begins, describe the outcome you want from the block. A specific intention such as “outline the first three sections” is easier to act on than a broad goal such as “work on the report.”",
          "Your intention is a lightweight commitment, not a promise to finish an entire project. Other participants can see that everyone has arrived with a purpose while each person keeps control of their own work.",
        ],
      },
      {
        heading: "3. Work alongside other focused people",
        body: [
          "During the work stage, everyone focuses independently. Shared presence supplies a gentle external cue to stay with the task without turning the room into a meeting, class, or collaboration session.",
          "The room timeline shows the current stage and what comes next. Optional camera, microphone, chat, task, and sound controls let you use the level of visibility and interaction that fits the session rules and your environment.",
        ],
      },
      {
        heading: "4. Check in and record what changed",
        body: [
          "When the focus interval ends, pause long enough to notice what moved forward. You can mark tasks complete, share a win, or state that the original intention needs another block.",
          "A useful check-in is honest rather than performative. If the task was larger than expected, resize the next action. That closes the loop and lowers the effort required to restart later.",
        ],
      },
      {
        heading: "5. Repeat with the right amount of structure",
        body: [
          "Use MySession whenever shared focus makes beginning or continuing easier. Some people rely on a regular scheduled room; others join only when they feel stuck or need a clear boundary around a demanding task.",
          "The basic process stays the same across formats: choose the room, name the work, protect the interval, and finish with a next step. Repeating that small cycle can turn vague plans into visible progress without adding another complicated productivity system.",
        ],
      },
    ],
    faqItems: [
      { question: "Do participants work on the same thing?", answer: "No. Everyone can work independently; the shared room provides timing, presence, and accountability." },
      { question: "Can I join when I need to focus right now?", answer: "Yes. MySession includes available focus rooms as well as scheduled sessions." },
    ],
    relatedPageSlugs: ["home", "body-doubling", "body-doubling-for-adhd", "body-doubling-for-studying"],
    updatedAt: "2026-09-09",
  },
];

const prerenderPages = [...corePages, ...pages.filter((item) => item.indexable)];
const pageBySlug = new Map(prerenderPages.map((page) => [page.slug, page]));

function replaceOrInsert(html, pattern, replacement) {
  return pattern.test(html) ? html.replace(pattern, replacement) : html.replace("</head>", `  ${replacement}\n</head>`);
}

function renderVisibleContent(page) {
  const sections = page.sections.map((section) => `
    <section>
      <h2>${escapeHtml(section.heading)}</h2>
      ${section.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
      ${section.bullets?.length ? `<ul>${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>` : ""}
    </section>`).join("");
  const faq = page.faqItems?.length ? `
    <section><h2>Frequently asked questions</h2>
      ${page.faqItems.map((item) => `<h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(item.answer)}</p>`).join("")}
    </section>` : "";
  const related = (page.relatedPageSlugs || [])
    .map((slug) => pageBySlug.get(slug)).filter(Boolean)
    .map((item) => `<li><a href="${escapeHtml(item.route)}">${escapeHtml(item.h1)}</a></li>`).join("");
  return `<main class="seo-prerender">
    <nav aria-label="Breadcrumb"><a href="/">Home</a> / ${escapeHtml(page.h1)}</nav>
    <header><p>${escapeHtml(page.eyebrow || page.pageType)}</p><h1>${escapeHtml(page.h1)}</h1><p>${escapeHtml(page.heroDescription)}</p><a href="/sessions">Browse focus sessions</a></header>
    ${sections}${faq}
    <section><h2>Continue exploring</h2><ul>${related}</ul></section>
  </main>`;
}

function render(page) {
  const canonical = `https://mysession.club${page.route}`;
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.metaDescription);
  let html = template.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
  html = replaceOrInsert(html, /<meta\s+name="description"[\s\S]*?\/?>/i, `<meta name="description" content="${description}" />`);
  html = replaceOrInsert(html, /<meta\s+name="robots"[\s\S]*?\/?>/i, `<meta name="robots" content="index, follow, max-image-preview:large" />`);
  html = replaceOrInsert(html, /<link\s+rel="canonical"[\s\S]*?\/?>/i, `<link rel="canonical" href="${canonical}" />`);
  html = replaceOrInsert(html, /<meta\s+property="og:title"[\s\S]*?\/?>/i, `<meta property="og:title" content="${title}" />`);
  html = replaceOrInsert(html, /<meta\s+property="og:description"[\s\S]*?\/?>/i, `<meta property="og:description" content="${description}" />`);
  html = replaceOrInsert(html, /<meta\s+property="og:url"[\s\S]*?\/?>/i, `<meta property="og:url" content="${canonical}" />`);
  html = replaceOrInsert(html, /<meta\s+property="og:type"[\s\S]*?\/?>/i, `<meta property="og:type" content="${page.pageType === "guide" ? "article" : "website"}" />`);
  html = replaceOrInsert(html, /<meta\s+name="twitter:title"[\s\S]*?\/?>/i, `<meta name="twitter:title" content="${title}" />`);
  html = replaceOrInsert(html, /<meta\s+name="twitter:description"[\s\S]*?\/?>/i, `<meta name="twitter:description" content="${description}" />`);
  const jsonLd = page.schemaType === "WebSite"
    ? {
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebSite", "@id": `${canonical}#website`, name: "MySession", url: canonical, description: page.metaDescription },
          { "@type": "Organization", "@id": `${canonical}#organization`, name: "MySession", url: canonical },
        ],
      }
    : page.schemaType === "HowTo"
      ? {
          "@context": "https://schema.org",
          "@type": "HowTo",
          name: page.h1,
          description: page.metaDescription,
          url: canonical,
          step: page.sections.map((section, index) => ({
            "@type": "HowToStep",
            position: index + 1,
            name: section.heading.replace(/^\d+\.\s*/, ""),
            text: section.body.join(" "),
          })),
        }
      : {
          "@context": "https://schema.org",
          "@type": page.pageType === "guide" ? "Article" : "WebPage",
          headline: page.h1,
          name: page.h1,
          description: page.metaDescription,
          url: canonical,
          dateModified: page.updatedAt,
        };
  html = html.replace("</head>", `  <script type="application/ld+json">${safeJson(jsonLd)}</script>\n</head>`);
  return html.replace('<div id="root"></div>', `<div id="root">${renderVisibleContent(page)}</div>`);
}

for (const page of prerenderPages) {
  const output = page.route === "/" ? dist : path.join(dist, ...page.route.slice(1).split("/"));
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "index.html"), render(page), "utf8");
}
console.log(`[prerender-seo] Wrote ${prerenderPages.length} route-specific HTML files.`);
