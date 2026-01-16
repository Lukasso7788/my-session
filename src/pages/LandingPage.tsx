// src/pages/LandingPage.tsx
import { useNavigate } from "react-router-dom";

/**
 * Palette (MySession)
 * Use colors as “soft wash” + accents (not hard blocks).
 */
const MS_BLUE = "#5286F6";
const MS_GREEN = "#65D46C";
const MS_RED = "#F65252";

const GRADIENT =
    "linear-gradient(90deg, #65D46C 0%, #5286F6 45%, #F65252 100%)";

/**
 * Light SVG pattern (no external assets)
 * Used as a subtle background texture with fade.
 */
const BG_PATTERN = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${MS_GREEN}" stop-opacity="0.35"/>
      <stop offset="0.5" stop-color="${MS_BLUE}" stop-opacity="0.35"/>
      <stop offset="1" stop-color="${MS_RED}" stop-opacity="0.35"/>
    </linearGradient>
    <filter id="b" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="0.6"/>
    </filter>
  </defs>

  <!-- soft arcs -->
  <g fill="none" stroke="url(#g)" stroke-width="2" opacity="0.28" filter="url(#b)">
    <path d="M-50 140 C 180 40, 360 220, 600 140 S 980 40, 1250 160" />
    <path d="M-50 260 C 240 150, 380 360, 620 260 S 980 150, 1250 280" />
    <path d="M-50 380 C 220 300, 430 460, 670 380 S 980 300, 1250 420" />
  </g>

  <!-- tiny dots -->
  <g opacity="0.22">
    ${Array.from({ length: 70 })
        .map((_, i) => {
            const x = (i * 73) % 1200;
            const y = (i * 41) % 600;
            const c = i % 3 === 0 ? MS_GREEN : i % 3 === 1 ? MS_BLUE : MS_RED;
            return `<circle cx="${x}" cy="${y}" r="2" fill="${c}" />`;
        })
        .join("\n")}
  </g>
</svg>
`)}`;

/**
 * Apply ONLY to session-related CTAs:
 * - Join now
 * - Browse sessions
 * - Join a session
 * - Join session (mini cards)
 * - Open full schedule
 *
 * Behavior:
 * - Default: black button
 * - Hover: subtle animated gradient "sheen" overlay (not full recolor)
 */
const sessionCtaClass = `
  session-cta
  relative isolate overflow-hidden
  before:content-[''] before:absolute before:inset-0 before:opacity-0
  before:transition-opacity before:duration-200
  before:[background-size:220%_220%]
  hover:before:opacity-[0.22]
  hover:before:animate-[gradMove_2.8s_ease-in-out_infinite]
`;

function SectionTitle({
    kicker,
    title,
    subtitle,
}: {
    kicker?: string;
    title: string;
    subtitle?: string;
}) {
    return (
        <div className="text-center max-w-[880px] mx-auto">
            {kicker && (
                <div className="text-[12px] tracking-wide text-[#606060] mb-3">
                    {kicker}
                </div>
            )}
            <h2 className="text-[26px] md:text-[32px] xl:text-[38px] font-normal text-[#2F2F2F] leading-tight">
                {title}
            </h2>
            {subtitle && (
                <p className="mt-4 text-[14px] md:text-[16px] text-[#606060] leading-relaxed">
                    {subtitle}
                </p>
            )}
        </div>
    );
}

function AccentPill({
    text,
    tone,
}: {
    text: string;
    tone: "blue" | "green" | "red" | "neutral";
}) {
    const cfg =
        tone === "blue"
            ? {
                dot: MS_BLUE,
                border: "#C9D9FF",
                bg: "linear-gradient(180deg, rgba(82,134,246,0.16), rgba(82,134,246,0.06))",
                fg: "#1D4ED8",
            }
            : tone === "green"
                ? {
                    dot: MS_GREEN,
                    border: "#C9F2D0",
                    bg: "linear-gradient(180deg, rgba(101,212,108,0.18), rgba(101,212,108,0.07))",
                    fg: "#15803D",
                }
                : tone === "red"
                    ? {
                        dot: MS_RED,
                        border: "#FFD0D0",
                        bg: "linear-gradient(180deg, rgba(246,82,82,0.16), rgba(246,82,82,0.06))",
                        fg: "#B91C1C",
                    }
                    : {
                        dot: "#9CA3AF",
                        border: "#DBD8D8",
                        bg: "linear-gradient(180deg, rgba(0,0,0,0.03), rgba(0,0,0,0.01))",
                        fg: "#606060",
                    };

    return (
        <span
            className="inline-flex items-center gap-2 text-[12px] px-3 py-1 rounded-full border"
            style={{
                borderColor: cfg.border,
                background: cfg.bg,
                color: cfg.fg,
                boxShadow: "0 1px 0 rgba(0,0,0,0.03) inset",
            }}
        >
            <span
                className="w-[7px] h-[7px] rounded-full"
                style={{ backgroundColor: cfg.dot }}
                aria-hidden="true"
            />
            {text}
        </span>
    );
}

function FeatureCard({
    title,
    desc,
    bullets,
    accent,
    comingSoon,
}: {
    title: string;
    desc: string;
    bullets?: string[];
    accent?: "blue" | "green" | "red";
    comingSoon?: boolean;
}) {
    const accentColor =
        accent === "blue"
            ? MS_BLUE
            : accent === "green"
                ? MS_GREEN
                : accent === "red"
                    ? MS_RED
                    : null;

    const softWash =
        accent === "blue"
            ? "radial-gradient(1200px 600px at 0% 0%, rgba(82,134,246,0.10) 0%, rgba(82,134,246,0.00) 55%)"
            : accent === "green"
                ? "radial-gradient(1200px 600px at 0% 0%, rgba(101,212,108,0.11) 0%, rgba(101,212,108,0.00) 55%)"
                : accent === "red"
                    ? "radial-gradient(1200px 600px at 0% 0%, rgba(246,82,82,0.10) 0%, rgba(246,82,82,0.00) 55%)"
                    : "none";

    return (
        <div
            className="border border-[#DBD8D8] rounded-[24px] p-6 bg-white hover:bg-[#FAFAFA] transition relative overflow-hidden"
            style={{
                backgroundImage: softWash,
            }}
        >
            {accentColor && (
                <div
                    className="absolute left-0 top-0 h-full w-[3px] opacity-90"
                    style={{ backgroundColor: accentColor }}
                    aria-hidden="true"
                />
            )}

            <div className="flex items-center justify-between gap-3">
                <div className="text-[16px] font-semibold text-[#2F2F2F]">{title}</div>
                {comingSoon && (
                    <span className="text-[11px] px-2 py-[2px] rounded-full border border-[#DBD8D8] text-[#606060] bg-white/70">
                        Coming soon
                    </span>
                )}
            </div>

            <div className="mt-3 text-[14px] text-[#606060] leading-relaxed">{desc}</div>

            {bullets?.length ? (
                <ul className="mt-4 space-y-2 text-[13px] text-[#606060]">
                    {bullets.map((b) => (
                        <li key={b} className="flex gap-2">
                            <span className="mt-[6px] w-[6px] h-[6px] rounded-full bg-[#2F2F2F] shrink-0" />
                            <span>{b}</span>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}

function FormatCard({
    title,
    desc,
    bullets,
    accent,
}: {
    title: string;
    desc: string;
    bullets: string[];
    accent: "blue" | "green" | "red";
}) {
    const accentColor = accent === "blue" ? MS_BLUE : accent === "green" ? MS_GREEN : MS_RED;

    const wash =
        accent === "blue"
            ? "radial-gradient(900px 400px at 20% 0%, rgba(82,134,246,0.14) 0%, rgba(82,134,246,0.00) 55%)"
            : accent === "green"
                ? "radial-gradient(900px 400px at 20% 0%, rgba(101,212,108,0.16) 0%, rgba(101,212,108,0.00) 55%)"
                : "radial-gradient(900px 400px at 20% 0%, rgba(246,82,82,0.14) 0%, rgba(246,82,82,0.00) 55%)";

    return (
        <div
            className="border border-[#DBD8D8] rounded-[24px] bg-white p-6 relative overflow-hidden"
            style={{
                backgroundImage: wash,
            }}
        >
            <div
                className="absolute -top-12 -right-12 w-40 h-40 rounded-full blur-2xl opacity-60"
                style={{ backgroundColor: accentColor }}
                aria-hidden="true"
            />
            <div className="relative">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="text-[16px] font-semibold text-[#2F2F2F]">{title}</div>
                        <div className="mt-2 text-[14px] text-[#606060] leading-relaxed">{desc}</div>
                    </div>

                    <div
                        className="shrink-0 border rounded-[16px] w-12 h-12 flex items-center justify-center bg-white/60"
                        style={{ borderColor: accentColor }}
                        aria-hidden="true"
                    >
                        <div className="w-5 h-5 rounded-full" style={{ backgroundColor: accentColor }} />
                    </div>
                </div>

                <ul className="mt-4 space-y-2 text-[13px] text-[#606060]">
                    {bullets.map((b) => (
                        <li key={b} className="flex gap-2">
                            <span
                                className="mt-[6px] w-[6px] h-[6px] rounded-full shrink-0"
                                style={{ backgroundColor: accentColor }}
                            />
                            <span>{b}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

function MiniSessionCard({
    title,
    tag,
    tagColor = "blue",
    host,
    minutes,
    startsIn,
    people,
}: {
    title: string;
    tag: string;
    tagColor?: "blue" | "green" | "red";
    host: string;
    minutes: number;
    startsIn: string;
    people: number;
}) {
    const tagCfg =
        tagColor === "blue"
            ? { border: "#C9D9FF", bg: "rgba(82,134,246,0.12)", fg: "#1D4ED8" }
            : tagColor === "green"
                ? { border: "#C9F2D0", bg: "rgba(101,212,108,0.14)", fg: "#15803D" }
                : { border: "#FFD0D0", bg: "rgba(246,82,82,0.12)", fg: "#B91C1C" };

    return (
        <div className="border border-[#DBD8D8] rounded-[28px] bg-white p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="text-[18px] md:text-[20px] font-semibold text-[#2F2F2F] leading-snug">
                        {title}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-[#606060]">
                        <span className="flex items-center gap-1">
                            <span className="opacity-70">Host:</span>
                            <span className="underline underline-offset-2">{host}</span>
                        </span>
                        <span className="opacity-60">•</span>
                        <span>{minutes} min</span>
                        <span className="opacity-60">•</span>
                        <span>Starts in {startsIn}</span>

                        <span
                            className="ml-0 md:ml-2 inline-flex items-center px-3 py-1 rounded-full border"
                            style={{ borderColor: tagCfg.border, background: tagCfg.bg, color: tagCfg.fg }}
                        >
                            {tag}
                        </span>
                    </div>
                </div>

                <div className="hidden md:flex items-center gap-5">
                    <div className="w-px h-10 bg-[#D9D9D9]" />
                    <div className="text-center">
                        <div className="text-[28px] font-bold text-[#2F2F2F]">{people}</div>
                        <div className="text-[10px] text-[#606060] font-light -mt-1">in session</div>
                    </div>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
                <button className="h-12 rounded-full px-6 text-[14px] font-semibold border border-[#2F2F2F] text-[#2F2F2F] hover:bg-[#2F2F2F] hover:text-white transition w-full sm:w-auto">
                    Book session
                </button>

                <button
                    className={`
            h-12 rounded-full px-6 text-[14px] font-semibold
            bg-[#111827] text-white hover:opacity-90 transition
            w-full sm:w-auto
            ${sessionCtaClass}
          `}
                    style={{ ["--cta-grad" as any]: GRADIENT }}
                >
                    <span className="relative z-10">Join session</span>
                </button>
            </div>
        </div>
    );
}

export default function LandingPage() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-white text-[#2F2F2F] font-inter relative overflow-hidden">
            {/* Background pattern that fades out toward the bottom */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-[0.55]"
                style={{
                    backgroundImage: `url("${BG_PATTERN}")`,
                    backgroundRepeat: "repeat",
                    backgroundSize: "1200px 600px",
                    // Fade out near the bottom (so it doesn't fight the CTA/footer)
                    WebkitMaskImage:
                        "linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.0) 92%)",
                    maskImage:
                        "linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.0) 92%)",
                }}
            />

            <main className="relative w-full px-3 md:px-6 lg:px-10 pb-16">
                {/* HERO */}
                <section className="pt-[92px] md:pt-[110px] pb-10 relative">
                    {/* Animated mesh background */}
                    <div aria-hidden="true" className="hero-mesh pointer-events-none absolute -inset-x-24 -top-40 h-[520px] md:h-[580px]" />
                    {/* Soft vignette to keep text readable */}
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute -inset-x-24 -top-40 h-[520px] md:h-[580px]"
                        style={{
                            background:
                                "radial-gradient(900px 420px at 50% 30%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.86) 45%, rgba(255,255,255,1) 70%)",
                        }}
                    />

                    <div className="max-w-[980px] mx-auto text-center relative">
                        <div className="flex flex-wrap items-center justify-center gap-2 mb-5">
                            <AccentPill text="Cheapest on the market" tone="green" />
                            <AccentPill text="$10/month" tone="blue" />
                            <AccentPill text="AI support" tone="red" />
                        </div>

                        <h1 className="text-[30px] md:text-[40px] xl:text-[52px] font-normal leading-tight">
                            High-accountability focus sessions —
                            <br className="hidden md:block" />
                            structured intentions with AI support.
                        </h1>

                        <p className="mt-5 text-[14px] md:text-[16px] text-[#606060] leading-relaxed max-w-[860px] mx-auto">
                            MySession turns “I should do it” into a guided flow: join a session, set clear intentions,
                            follow a structured focus format, track completion, and use AI (including screenshare help) when stuck.
                        </p>

                        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                            <button
                                onClick={() => navigate("/sessions")}
                                className={`
                  h-12 rounded-full px-7 text-[14px] font-semibold
                  bg-[#111827] text-white hover:opacity-90 transition
                  w-full sm:w-auto
                  ${sessionCtaClass}
                `}
                                style={{ ["--cta-grad" as any]: GRADIENT }}
                            >
                                <span className="relative z-10">Join now</span>
                            </button>

                            <button
                                onClick={() => navigate("/pricing")}
                                className="h-12 rounded-full px-7 text-[14px] font-semibold border border-[#2F2F2F] text-[#2F2F2F] hover:bg-[#2F2F2F] hover:text-white transition w-full sm:w-auto"
                            >
                                Subscribe $10/mo
                            </button>
                        </div>

                        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                            <AccentPill text="Group sessions" tone="neutral" />
                            <AccentPill text="24/7 Infinite rooms" tone="blue" />
                            <AccentPill text="Buddy tripling (3 people)" tone="green" />
                            <AccentPill text="Browser-based" tone="neutral" />
                            <AccentPill text="Host sessions (discounts)" tone="neutral" />
                        </div>
                    </div>

                    {/* HERO VISUAL */}
                    <div className="mt-10 max-w-[1100px] mx-auto relative">
                        <div className="border border-[#DBD8D8] rounded-[32px] bg-white/70 backdrop-blur-[6px] p-4 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.05)]">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {/* Left: Intentions / progress */}
                                <div className="bg-white border border-[#EAEAEA] rounded-[24px] p-5 relative overflow-hidden">
                                    <div
                                        aria-hidden="true"
                                        className="absolute -top-20 -left-20 w-56 h-56 rounded-full blur-3xl opacity-40"
                                        style={{ backgroundColor: MS_GREEN }}
                                    />
                                    <div
                                        aria-hidden="true"
                                        className="absolute -bottom-24 -right-24 w-64 h-64 rounded-full blur-3xl opacity-35"
                                        style={{ backgroundColor: MS_BLUE }}
                                    />
                                    <div className="relative">
                                        <div className="flex items-center justify-between">
                                            <div className="text-[14px] font-semibold">Intentions</div>
                                            <div className="text-[12px] text-[#606060]">
                                                Bird’s-eye intentions view <span className="opacity-70">(coming soon)</span>
                                            </div>
                                        </div>

                                        <div className="mt-4 space-y-3">
                                            <div className="rounded-[16px] border border-[#DBD8D8] p-4 bg-white/70">
                                                <div className="text-[13px] font-semibold">
                                                    Today: “Ship sessions page polish”
                                                </div>
                                                <div className="mt-2 text-[12px] text-[#606060]">
                                                    Intention → stages → recap • progress tracked
                                                </div>
                                                <div className="mt-3 h-2 rounded-full bg-[#F1F1F1] overflow-hidden">
                                                    <div className="h-2 w-[62%] bg-[#111827]" />
                                                </div>
                                                <div className="mt-2 text-[12px] text-[#606060]">62% complete</div>
                                            </div>

                                            <div className="rounded-[16px] border border-[#DBD8D8] p-4 bg-white/70">
                                                <div className="text-[13px] font-semibold">AI plan (auto-generated)</div>
                                                <div className="mt-2 text-[12px] text-[#606060] leading-relaxed">
                                                    Break down the goal → schedule focus sessions → track completion → adapt next steps.
                                                </div>
                                            </div>

                                            <div className="rounded-[16px] border border-[#DBD8D8] p-4 bg-white/70">
                                                <div className="text-[13px] font-semibold">Session formats</div>
                                                <div className="mt-2 text-[12px] text-[#606060] leading-relaxed">
                                                    Deep Work, Pomodoro, Short Sprints — plus 24/7 Infinite Rooms and Buddy Tripling (3 people).
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Right: PiP intentions panel */}
                                <div className="bg-white border border-[#EAEAEA] rounded-[24px] p-5 flex flex-col relative overflow-hidden">
                                    <div
                                        aria-hidden="true"
                                        className="absolute -top-24 -right-24 w-72 h-72 rounded-full blur-3xl opacity-35"
                                        style={{ backgroundColor: MS_RED }}
                                    />
                                    <div className="relative flex items-center justify-between">
                                        <div className="text-[14px] font-semibold">Intentions Panel</div>
                                        <div className="text-[12px] text-[#606060]">Picture-in-picture</div>
                                    </div>

                                    <div className="relative mt-4 flex-1 rounded-[20px] border border-[#DBD8D8] bg-[#F6F6F6]/70 p-4">
                                        <div className="text-[12px] text-[#606060]">
                                            Pin your intentions on top of any window — like picture-in-picture — so the goal stays visible while you work.
                                        </div>

                                        <div className="mt-4 rounded-[16px] bg-white border border-[#EAEAEA] p-4">
                                            <div className="flex items-center justify-between">
                                                <div className="text-[13px] font-semibold">Current intention</div>
                                                <div className="text-[12px] text-[#606060]">Deep work</div>
                                            </div>
                                            <div className="mt-3 h-2 rounded-full bg-[#F1F1F1] overflow-hidden">
                                                <div className="h-2 w-[35%] bg-[#111827]" />
                                            </div>
                                            <div className="mt-2 text-[12px] text-[#606060]">
                                                Stage 2/4 • Keep moving — minimal UI, maximum focus
                                            </div>
                                        </div>

                                        <div className="mt-4 rounded-[16px] bg-white border border-[#EAEAEA] p-4">
                                            <div className="text-[13px] font-semibold">AI Screenshare Assistant</div>
                                            <div className="mt-2 text-[12px] text-[#606060]">
                                                Share your screen → ask what to do next → unblock the next step without derailing focus.
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-4 flex flex-col sm:flex-row gap-3 relative">
                                        <button
                                            onClick={() => navigate("/sessions")}
                                            className={`
                        h-12 rounded-full px-6 text-[14px] font-semibold
                        bg-[#111827] text-white hover:opacity-90 transition
                        w-full sm:w-auto
                        ${sessionCtaClass}
                      `}
                                            style={{ ["--cta-grad" as any]: GRADIENT }}
                                        >
                                            <span className="relative z-10">Browse sessions</span>
                                        </button>

                                        <button
                                            onClick={() => navigate("/pricing")}
                                            className="h-12 rounded-full px-6 text-[14px] font-semibold border border-[#2F2F2F] text-[#2F2F2F] hover:bg-[#2F2F2F] hover:text-white transition w-full sm:w-auto"
                                        >
                                            See pricing
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* FORMATS */}
                <section className="py-12">
                    <SectionTitle
                        kicker="Formats"
                        title="Choose the accountability level that fits your day."
                        subtitle="Group sessions for energy, 24/7 rooms for always-available focus, and Buddy Tripling for a cozy circle of 3."
                    />

                    <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <FormatCard
                            accent="blue"
                            title="Group sessions"
                            desc="Join structured sessions with multiple people and stay accountable through shared presence."
                            bullets={[
                                "Best for energy + momentum",
                                "Clear structure (Pomodoro / Deep Work / Sprints)",
                                "Join in seconds — no setup",
                            ]}
                        />
                        <FormatCard
                            accent="green"
                            title="24/7 Infinite Rooms"
                            desc="Always open. Drop in anytime and focus inside a structured room — day or night."
                            bullets={[
                                "No scheduling — just join",
                                "Great for spontaneous motivation",
                                "Reliable “focus place” whenever you need it",
                            ]}
                        />
                        <FormatCard
                            accent="red"
                            title="Buddy Tripling (3 people)"
                            desc="A small, cozy circle for accountability. Easier to fill than larger group sessions — less friction, faster start."
                            bullets={[
                                "Higher comfort, still real accountability",
                                "Easier to match than big group sessions",
                                "Great for recurring sessions + habit building",
                            ]}
                        />
                    </div>
                </section>

                {/* OUTCOMES */}
                <section className="py-12">
                    <SectionTitle
                        kicker="Outcome, not vibes"
                        title="Designed for people who want real progress."
                        subtitle="MySession is built around structured focus sessions — intentions, clear stages, visible progress, and AI help when needed."
                    />

                    <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-4">
                        <FeatureCard
                            accent="blue"
                            comingSoon
                            title="Bird’s-eye intentions view"
                            desc="A fast overview of intentions and progress — so accountability becomes visible at a glance."
                            bullets={["Clear intentions per person", "Progress visibility", "Less silent drift"]}
                        />
                        <FeatureCard
                            accent="green"
                            title="Guided session structure"
                            desc="Not a random call. Sessions follow a clean structure that keeps you moving."
                            bullets={[
                                "Pick a format (Pomodoro / Deep Work / Sprints)",
                                "Stage-based momentum",
                                "Simple recap → real closure",
                            ]}
                        />
                        <FeatureCard
                            accent="red"
                            title="Intentions Panel (PiP overlay)"
                            desc="Pin your intentions over any window like picture-in-picture — stay aligned while working in any app."
                            bullets={["Always visible intention", "Lightweight, non-distracting UI", "Works alongside your workflow"]}
                        />
                    </div>
                </section>

                {/* HOW IT WORKS */}
                <section className="py-12">
                    <SectionTitle
                        kicker="How it works"
                        title="A simple flow that forces momentum."
                        subtitle="Join fast — then the structure keeps you honest."
                    />

                    <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <FeatureCard
                            accent="blue"
                            title="1) Join a session"
                            desc="Pick a format that matches your day: groups, 24/7 rooms, or Buddy Tripling."
                            bullets={["Schedule + filters", "Join instantly", "Zero setup friction"]}
                        />
                        <FeatureCard
                            accent="green"
                            title="2) Set intentions"
                            desc="Write what you will finish. Track progress. Make the goal real."
                            bullets={["Clear intention", "Progress tracking", "AI can help break it down"]}
                        />
                        <FeatureCard
                            accent="red"
                            title="3) Execute with AI help"
                            desc="Work through the session format. If stuck — use AI (including screenshare) to unblock the next step."
                            bullets={["Structured stages", "Less context switching", "Stay focused until completion"]}
                        />
                    </div>
                </section>

                {/* AI + ROADMAP */}
                <section className="py-12">
                    <SectionTitle
                        kicker="AI powered focus"
                        title="Cheap, reliable, structured focus — with AI assistance."
                        subtitle="AI isn’t the product — sessions are. AI plugs into the loop: plan → execute → track → improve."
                    />

                    <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FeatureCard
                            accent="green"
                            title="AI-created plans for any goal"
                            desc="Studying, career growth, building a product — AI turns goals into steps and sessions."
                            bullets={[
                                "Goal → milestones → steps",
                                "Convert steps into focus sessions",
                                "Adjust plan based on real progress",
                            ]}
                        />
                        <FeatureCard
                            accent="blue"
                            title="AI Screenshare Assistant"
                            desc="When you’re stuck, share your screen and ask for the next step — without breaking focus."
                            bullets={["Unblock fast", "Keep momentum", "Reduce doomscrolling + context switching"]}
                        />
                    </div>

                    <div className="mt-8 border border-[#DBD8D8] rounded-[32px] p-6 md:p-10 bg-white/70 backdrop-blur-[6px] relative overflow-hidden">
                        <div
                            aria-hidden="true"
                            className="absolute -top-24 left-1/2 -translate-x-1/2 w-[820px] h-[320px] blur-3xl opacity-40"
                            style={{
                                background:
                                    `radial-gradient(closest-side at 30% 40%, rgba(101,212,108,0.50), rgba(101,212,108,0.00) 70%),
                   radial-gradient(closest-side at 55% 25%, rgba(82,134,246,0.45), rgba(82,134,246,0.00) 70%),
                   radial-gradient(closest-side at 75% 60%, rgba(246,82,82,0.42), rgba(246,82,82,0.00) 70%)`,
                            }}
                        />
                        <div className="relative max-w-[980px] mx-auto text-center">
                            <div className="text-[12px] tracking-wide text-[#606060] mb-3">
                                Always evolving
                            </div>
                            <div className="text-[24px] md:text-[32px] font-normal leading-tight">
                                New formats & features are coming постоянно.
                            </div>
                            <p className="mt-4 text-[14px] md:text-[16px] text-[#606060] leading-relaxed">
                                We keep testing new accountability mechanics — the platform evolves with what actually helps people ship.
                            </p>

                            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
                                <FeatureCard
                                    accent="red"
                                    comingSoon
                                    title="Screenshare-only sessions"
                                    desc="Extra high accountability: it’s harder to drift when others can see what you’re doing."
                                    bullets={["Anti-procrastination by design", "Great for deep work", "Stronger commitment"]}
                                />
                                <FeatureCard
                                    accent="blue"
                                    comingSoon
                                    title="Distraction blocking"
                                    desc="Optional focus mode that blocks distracting sites during sessions."
                                    bullets={["Less temptation", "More consistency", "Better session outcomes"]}
                                />
                                <FeatureCard
                                    accent="green"
                                    comingSoon
                                    title="More session formats"
                                    desc="We’ll keep expanding formats and experimenting with what creates the strongest results."
                                    bullets={["New structures", "Better matching", "More ways to stay accountable"]}
                                />
                            </div>
                        </div>
                    </div>
                </section>

                {/* HOSTING */}
                <section className="py-12">
                    <div className="border border-[#DBD8D8] rounded-[32px] p-6 md:p-10 bg-[#FAFAFA] relative overflow-hidden">
                        <div
                            aria-hidden="true"
                            className="absolute -left-24 -bottom-24 w-72 h-72 rounded-full blur-3xl opacity-30"
                            style={{ backgroundColor: MS_GREEN }}
                        />
                        <div
                            aria-hidden="true"
                            className="absolute -right-24 -top-24 w-72 h-72 rounded-full blur-3xl opacity-25"
                            style={{ backgroundColor: MS_BLUE }}
                        />
                        <div className="max-w-[980px] mx-auto text-center relative">
                            <div className="text-[12px] tracking-wide text-[#606060] mb-3">Hosts</div>
                            <div className="text-[24px] md:text-[32px] font-normal leading-tight">
                                Host sessions — get <span className="font-semibold">50% off</span>.
                            </div>
                            <p className="mt-4 text-[14px] md:text-[16px] text-[#606060] leading-relaxed">
                                Hosting grows the ecosystem. You bring structure — we reward it.
                            </p>

                            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                                <button
                                    onClick={() => navigate("/sessions?create=1")}
                                    className="h-12 rounded-full px-7 text-[14px] font-semibold bg-[#111827] text-white hover:opacity-90 transition w-full sm:w-auto"
                                >
                                    Host your first session
                                </button>
                                <button
                                    onClick={() => navigate("/pricing")}
                                    className="h-12 rounded-full px-7 text-[14px] font-semibold border border-[#2F2F2F] text-[#2F2F2F] hover:bg-[#2F2F2F] hover:text-white transition w-full sm:w-auto"
                                >
                                    See pricing
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* LIVE PREVIEW */}
                <section className="py-12">
                    <SectionTitle
                        kicker="Explore"
                        title="See sessions — join in seconds."
                        subtitle="This is the core product. Simple, fast, and structured."
                    />

                    <div className="mt-10 border border-[#DBD8D8] rounded-[32px] p-4 md:p-8 bg-white/70 backdrop-blur-[6px]">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            <MiniSessionCard
                                title="50/5/5 Deep work — 2 hours"
                                tag="Deep work"
                                tagColor="blue"
                                host="Yaro"
                                minutes={120}
                                startsIn="44 mins"
                                people={6}
                            />
                            <MiniSessionCard
                                title="25/5 Pomodoro — 2 hours"
                                tag="Pomodoro 25/5"
                                tagColor="red"
                                host="Yaro"
                                minutes={120}
                                startsIn="1 hour"
                                people={4}
                            />
                            <MiniSessionCard
                                title="15/3 Short sprints — 2 hours"
                                tag="Short sprints"
                                tagColor="green"
                                host="Yaro"
                                minutes={120}
                                startsIn="2 hours"
                                people={5}
                            />
                        </div>

                        <div className="mt-6 flex justify-center">
                            <button
                                onClick={() => navigate("/sessions")}
                                className={`
                  h-12 rounded-full px-7 text-[14px] font-semibold
                  bg-[#111827] text-white hover:opacity-90 transition
                  w-full sm:w-auto
                  ${sessionCtaClass}
                `}
                                style={{ ["--cta-grad" as any]: GRADIENT }}
                            >
                                <span className="relative z-10">Open full schedule</span>
                            </button>
                        </div>
                    </div>
                </section>

                {/* FAQ */}
                <section className="py-12">
                    <SectionTitle
                        kicker="FAQ"
                        title="Quick answers."
                        subtitle="If you still have doubts — start with one session. That’s the best demo."
                    />

                    <div className="mt-10 max-w-[980px] mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[
                            {
                                q: "Is MySession free?",
                                a: "There is a free tier. Paid plans unlock more structure and AI-assisted workflows.",
                            },
                            {
                                q: "What makes it different from a normal call?",
                                a: "Sessions are structured by default: intentions → format stages → recap. That structure creates real accountability.",
                            },
                            { q: "Do I need to download anything?", a: "No. It’s browser-based." },
                            {
                                q: "Is Buddy Tripling easier to join than big group sessions?",
                                a: "Yes — it’s often easier to fill a cozy 3-person session than a larger group, so you can start faster with less friction.",
                            },
                            {
                                q: "Can AI help with any task?",
                                a: "Yes: planning, breaking down tasks, and screenshare-guided help when you’re stuck — without derailing focus.",
                            },
                            {
                                q: "What do hosts get?",
                                a: "Hosts receive a discount and build trust by running consistent sessions that help others show up.",
                            },
                        ].map((item) => (
                            <div key={item.q} className="border border-[#DBD8D8] rounded-[24px] p-6 bg-white/80 backdrop-blur-[4px]">
                                <div className="text-[14px] font-semibold">{item.q}</div>
                                <div className="mt-2 text-[13px] text-[#606060] leading-relaxed">{item.a}</div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* FINAL CTA */}
                <section className="pt-6 pb-4">
                    <div className="border border-[#DBD8D8] rounded-[32px] p-6 md:p-10 bg-[#111827] text-white relative overflow-hidden">
                        <div
                            aria-hidden="true"
                            className="absolute -inset-20 opacity-70"
                            style={{
                                background:
                                    `radial-gradient(600px 260px at 20% 40%, rgba(101,212,108,0.35), rgba(101,212,108,0.00) 70%),
                   radial-gradient(520px 240px at 55% 30%, rgba(82,134,246,0.32), rgba(82,134,246,0.00) 70%),
                   radial-gradient(520px 240px at 80% 60%, rgba(246,82,82,0.28), rgba(246,82,82,0.00) 70%)`,
                            }}
                        />
                        <div className="max-w-[980px] mx-auto text-center relative">
                            <div className="text-[24px] md:text-[32px] font-normal leading-tight">
                                Start with one session. Ship something today.
                            </div>
                            <div className="mt-3 text-[14px] md:text-[16px] text-white/80">
                                Join a session, set intentions, stay accountable — and keep momentum going.
                            </div>

                            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                                <button
                                    onClick={() => navigate("/sessions")}
                                    className={`
                    h-12 rounded-full px-7 text-[14px] font-semibold
                    bg-white text-[#111827] hover:opacity-90 transition
                    w-full sm:w-auto
                    ${sessionCtaClass}
                  `}
                                    style={{ ["--cta-grad" as any]: GRADIENT }}
                                >
                                    <span className="relative z-10">Join now</span>
                                </button>

                                <button
                                    onClick={() => navigate("/pricing")}
                                    className="h-12 rounded-full px-7 text-[14px] font-semibold border border-white text-white hover:bg-white hover:text-[#111827] transition w-full sm:w-auto"
                                >
                                    Subscribe $10/mo
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Local CSS: CTA sheen + animated hero mesh */}
                <style>{`
          /* CTA sheen background */
          .session-cta::before { background: var(--cta-grad); }

          @keyframes gradMove {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }

          /* HERO animated mesh (3-color palette, soft + airy) */
          .hero-mesh {
            border-radius: 9999px;
            filter: blur(28px);
            opacity: 0.9;
            background:
              radial-gradient(520px 320px at 18% 35%, rgba(101,212,108,0.55), rgba(101,212,108,0.00) 70%),
              radial-gradient(520px 320px at 55% 28%, rgba(82,134,246,0.50), rgba(82,134,246,0.00) 70%),
              radial-gradient(520px 320px at 82% 58%, rgba(246,82,82,0.46), rgba(246,82,82,0.00) 70%);
            animation: meshFloat 14s ease-in-out infinite;
            transform: translate3d(0,0,0);
            /* fade out toward the bottom of hero block */
            -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.65) 45%, rgba(0,0,0,0.0) 95%);
            mask-image: linear-gradient(to bottom, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.65) 45%, rgba(0,0,0,0.0) 95%);
          }

          @keyframes meshFloat {
            0%   { transform: translate3d(-10px, 0px, 0) scale(1.02); }
            25%  { transform: translate3d(18px, 10px, 0) scale(1.05); }
            50%  { transform: translate3d(8px, -8px, 0) scale(1.03); }
            75%  { transform: translate3d(-14px, 8px, 0) scale(1.06); }
            100% { transform: translate3d(-10px, 0px, 0) scale(1.02); }
          }

          /* Reduce motion */
          @media (prefers-reduced-motion: reduce) {
            .session-cta:hover::before { animation: none !important; }
            .hero-mesh { animation: none !important; }
          }
        `}</style>
            </main>
        </div>
    );
}
