// src/pages/LandingPage.tsx
import { useNavigate } from "react-router-dom";

const GRADIENT =
    "linear-gradient(90deg, #5BF367 0%, #3369CB 33%, #E23C7C 66%, #FED234 100%)";

// MySession brand colors (used subtly across the page)
const MS_BLUE = "#5286F6";
const MS_GREEN = "#65D46C";
const MS_RED = "#F65252";

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
        <div className="text-center max-w-[860px] mx-auto">
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
    color,
}: {
    text: string;
    color: "blue" | "green" | "red" | "neutral";
}) {
    const cfg =
        color === "blue"
            ? { border: "#A7C2FF", bg: "#E4EDFF", fg: "#2563EB" }
            : color === "green"
                ? { border: "#A7F3B3", bg: "#E9FBEF", fg: "#16A34A" }
                : color === "red"
                    ? { border: "#FFB3B3", bg: "#FFECEC", fg: "#DC2626" }
                    : { border: "#DBD8D8", bg: "#FFFFFF", fg: "#606060" };

    return (
        <span
            className="text-[12px] px-3 py-1 rounded-full border"
            style={{
                borderColor: cfg.border,
                backgroundColor: cfg.bg,
                color: cfg.fg,
            }}
        >
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
        accent === "blue" ? MS_BLUE : accent === "green" ? MS_GREEN : accent === "red" ? MS_RED : null;

    return (
        <div className="border border-[#DBD8D8] rounded-[24px] p-6 bg-white hover:bg-[#FAFAFA] transition">
            <div className="flex items-center justify-between gap-3">
                <div className="text-[16px] font-semibold text-[#2F2F2F]">{title}</div>
                {comingSoon && (
                    <span className="text-[11px] px-2 py-[2px] rounded-full border border-[#DBD8D8] text-[#606060]">
                        Coming soon
                    </span>
                )}
            </div>

            {accentColor && (
                <div className="mt-3 h-[2px] rounded-full" style={{ backgroundColor: accentColor, opacity: 0.9 }} />
            )}

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
    const bg20 =
        accent === "blue"
            ? "#5286F61F"
            : accent === "green"
                ? "#65D46C1F"
                : "#F652521F";

    return (
        <div className="border border-[#DBD8D8] rounded-[24px] bg-white p-6">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="text-[16px] font-semibold text-[#2F2F2F]">{title}</div>
                    <div className="mt-2 text-[14px] text-[#606060] leading-relaxed">{desc}</div>
                </div>

                <div
                    className="shrink-0 border rounded-[14px] w-12 h-12 flex items-center justify-center"
                    style={{
                        borderColor: accentColor,
                        backgroundColor: bg20,
                    }}
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
            ? { border: "#A7C2FF", bg: "#E4EDFF", fg: "#2563EB" }
            : tagColor === "green"
                ? { border: "#A7F3B3", bg: "#E9FBEF", fg: "#16A34A" }
                : { border: "#FFB3B3", bg: "#FFECEC", fg: "#DC2626" };

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
                            style={{ borderColor: tagCfg.border, backgroundColor: tagCfg.bg, color: tagCfg.fg }}
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

                {/* session-related CTA: hover gradient sheen */}
                <button
                    className={`
            h-12 rounded-full px-6 text-[14px] font-semibold
            bg-[#111827] text-white hover:opacity-90 transition
            w-full sm:w-auto
            ${sessionCtaClass}
          `}
                    style={{
                        ["--cta-grad" as any]: GRADIENT,
                    }}
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
        <div className="min-h-screen bg-white text-[#2F2F2F] font-inter">
            {/* NOTE: Header у тебя уже есть глобально, поэтому тут только контент */}
            <main className="w-full px-3 md:px-6 lg:px-10 pb-16">
                {/* HERO */}
                <section className="pt-[92px] md:pt-[110px] pb-10">
                    <div className="max-w-[980px] mx-auto text-center">
                        <div className="flex flex-wrap items-center justify-center gap-2 mb-5">
                            <AccentPill text="Cheapest on the market" color="green" />
                            <AccentPill text="$10/month" color="blue" />
                            <AccentPill text="AI support" color="red" />
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
                            {/* session-related CTA */}
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

                            {/* not session-related */}
                            <button
                                onClick={() => navigate("/pricing")}
                                className="h-12 rounded-full px-7 text-[14px] font-semibold border border-[#2F2F2F] text-[#2F2F2F] hover:bg-[#2F2F2F] hover:text-white transition w-full sm:w-auto"
                            >
                                Subscribe $10/mo
                            </button>
                        </div>

                        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                            <AccentPill text="Group sessions" color="neutral" />
                            <AccentPill text="24/7 Infinite rooms" color="blue" />
                            <AccentPill text="Buddy tripling (3 people)" color="green" />
                            <AccentPill text="Browser-based" color="neutral" />
                            <AccentPill text="Host sessions (discounts)" color="neutral" />
                        </div>
                    </div>

                    {/* HERO VISUAL (маркетинговый мок: intentions + PiP panel) */}
                    <div className="mt-10 max-w-[1100px] mx-auto">
                        <div className="border border-[#DBD8D8] rounded-[32px] bg-[#FAFAFA] p-4 md:p-6">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {/* Left: Intentions / progress */}
                                <div className="bg-white border border-[#EAEAEA] rounded-[24px] p-5">
                                    <div className="flex items-center justify-between">
                                        <div className="text-[14px] font-semibold">Intentions</div>
                                        <div className="text-[12px] text-[#606060]">
                                            Bird’s-eye intentions view <span className="opacity-70">(coming soon)</span>
                                        </div>
                                    </div>

                                    <div className="mt-4 space-y-3">
                                        <div className="rounded-[16px] border border-[#DBD8D8] p-4">
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

                                        <div className="rounded-[16px] border border-[#DBD8D8] p-4">
                                            <div className="text-[13px] font-semibold">AI plan (auto-generated)</div>
                                            <div className="mt-2 text-[12px] text-[#606060] leading-relaxed">
                                                Break down the goal → schedule focus sessions → track completion → adapt next steps.
                                            </div>
                                        </div>

                                        <div className="rounded-[16px] border border-[#DBD8D8] p-4">
                                            <div className="text-[13px] font-semibold">Session formats</div>
                                            <div className="mt-2 text-[12px] text-[#606060] leading-relaxed">
                                                Deep Work, Pomodoro, Short Sprints — plus 24/7 Infinite Rooms and Buddy Tripling (3 people).
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Right: PiP intentions panel */}
                                <div className="bg-white border border-[#EAEAEA] rounded-[24px] p-5 flex flex-col">
                                    <div className="flex items-center justify-between">
                                        <div className="text-[14px] font-semibold">Intentions Panel</div>
                                        <div className="text-[12px] text-[#606060]">Picture-in-picture</div>
                                    </div>

                                    <div className="mt-4 flex-1 rounded-[20px] border border-[#DBD8D8] bg-[#F6F6F6] p-4">
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

                                    <div className="mt-4 flex flex-col sm:flex-row gap-3">
                                        {/* session-related CTA */}
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

                                        {/* not session-related */}
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

                {/* OUTCOMES / POSITIONING */}
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

                {/* AI POWERED FOCUS */}
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

                    {/* ROADMAP */}
                    <div className="mt-8 border border-[#DBD8D8] rounded-[32px] p-6 md:p-10 bg-[#FAFAFA]">
                        <div className="max-w-[980px] mx-auto text-center">
                            <div className="text-[12px] tracking-wide text-[#606060] mb-3">Always evolving</div>
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

                {/* HOSTING INCENTIVE */}
                <section className="py-12">
                    <div className="border border-[#DBD8D8] rounded-[32px] p-6 md:p-10 bg-[#FAFAFA]">
                        <div className="max-w-[980px] mx-auto text-center">
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

                {/* LIVE SESSIONS PREVIEW */}
                <section className="py-12">
                    <SectionTitle
                        kicker="Explore"
                        title="See sessions — join in seconds."
                        subtitle="This is the core product. Simple, fast, and structured."
                    />

                    <div className="mt-10 border border-[#DBD8D8] rounded-[32px] p-4 md:p-8">
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
                            {/* session-related CTA: hover gradient sheen */}
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
                            <div key={item.q} className="border border-[#DBD8D8] rounded-[24px] p-6 bg-white">
                                <div className="text-[14px] font-semibold">{item.q}</div>
                                <div className="mt-2 text-[13px] text-[#606060] leading-relaxed">{item.a}</div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* FINAL CTA */}
                <section className="pt-6 pb-4">
                    <div className="border border-[#DBD8D8] rounded-[32px] p-6 md:p-10 bg-[#111827] text-white">
                        <div className="max-w-[980px] mx-auto text-center">
                            <div className="text-[24px] md:text-[32px] font-normal leading-tight">
                                Start with one session. Ship something today.
                            </div>
                            <div className="mt-3 text-[14px] md:text-[16px] text-white/80">
                                Join a session, set intentions, stay accountable — and keep momentum going.
                            </div>

                            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                                {/* session-related CTA: hover gradient sheen */}
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

                                {/* not session-related */}
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

                {/* Only local CSS for sheen overlay */}
                <style>{`
          /* Make the sheen background work ONLY for CTA buttons */
          .session-cta::before { background: var(--cta-grad); }

          @keyframes gradMove {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }

          /* Safety: reduce motion */
          @media (prefers-reduced-motion: reduce) {
            .session-cta:hover::before { animation: none !important; }
          }
        `}</style>
            </main>
        </div>
    );
}
