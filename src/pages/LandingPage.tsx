// src/pages/LandingPage.tsx
import { useMemo, useRef } from "react";
import { Link } from "react-router-dom";

/**
 * Palette (MySession)
 * Use colors as “soft wash” + accents (not hard blocks).
 */
const MS_BLUE = "#5286F6";
const MS_GREEN = "#65D46C";
const MS_RED = "#F65252";

const GRADIENT = "linear-gradient(90deg, #65D46C 0%, #5286F6 45%, #F65252 100%)";

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
            {kicker && <div className="text-[12px] tracking-wide text-[#606060] mb-3">{kicker}</div>}
            <h2 className="text-[26px] md:text-[32px] xl:text-[38px] font-normal text-[#2F2F2F] leading-tight">
                {title}
            </h2>
            {subtitle && (
                <p className="mt-4 text-[14px] md:text-[16px] text-[#606060] leading-relaxed">{subtitle}</p>
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
            <span className="w-[7px] h-[7px] rounded-full" style={{ backgroundColor: cfg.dot }} />
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
            style={{ backgroundImage: softWash }}
        >
            {accentColor && (
                <div
                    className="absolute left-0 top-0 h-full w-[3px] opacity-90"
                    style={{ backgroundColor: accentColor }}
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
            style={{ backgroundImage: wash }}
        >
            <div
                className="absolute -top-12 -right-12 w-40 h-40 rounded-full blur-2xl opacity-60"
                style={{ backgroundColor: accentColor }}
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
                <Link
                    to="/sessions"
                    className="h-12 rounded-full px-6 text-[14px] font-semibold border border-[#2F2F2F] text-[#2F2F2F] hover:bg-[#2F2F2F] hover:text-white transition w-full sm:w-auto inline-flex items-center justify-center"
                >
                    Book session
                </Link>

                <Link
                    to="/sessions"
                    className={`
            h-12 rounded-full px-6 text-[14px] font-semibold
            bg-[#111827] text-white hover:opacity-90 transition
            w-full sm:w-auto inline-flex items-center justify-center
            ${sessionCtaClass}
          `}
                    style={{ ["--cta-grad" as any]: GRADIENT }}
                >
                    <span className="relative z-10">Join session</span>
                </Link>
            </div>
        </div>
    );
}

/**
 * Hero animation: “focus particles”
 */
function FocusParticles({ count = 26 }: { count?: number }) {
    const dots = useMemo(() => {
        let seed = 1337;
        const rand = () => {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };

        const colors = [
            { c: MS_GREEN, a: 0.55 },
            { c: MS_BLUE, a: 0.5 },
            { c: MS_RED, a: 0.45 },
        ];

        return Array.from({ length: count }).map((_, i) => {
            const col = colors[i % colors.length];
            const size = 4 + Math.round(rand() * 5);
            const x = 6 + rand() * 88;
            const y = 8 + rand() * 62;
            const dur = 10 + rand() * 12;
            const delay = -(rand() * 18);
            const drift = 18 + rand() * 38;
            const blur = rand() > 0.7 ? 6 : 0;
            const ring = rand() > 0.55;
            const glow = rand() > 0.55;

            return {
                key: `p-${i}`,
                size,
                x,
                y,
                dur,
                delay,
                drift,
                blur,
                ring,
                glow,
                color: col.c,
                alpha: col.a,
            };
        });
    }, [count]);

    const rootRef = useRef<HTMLDivElement | null>(null);

    return (
        <div
            ref={rootRef}
            aria-hidden="true"
            className="focus-particles pointer-events-none absolute -inset-x-24 -top-40 h-[520px] md:h-[580px] overflow-hidden"
        >
            {dots.map((d) => (
                <span
                    key={d.key}
                    className={`focus-dot ${d.ring ? "is-ring" : ""} ${d.glow ? "is-glow" : ""}`}
                    style={
                        {
                            left: `${d.x}%`,
                            top: `${d.y}%`,
                            width: `${d.size}px`,
                            height: `${d.size}px`,
                            ["--dot-c" as any]: d.color,
                            ["--dot-a" as any]: d.alpha,
                            ["--dot-dur" as any]: `${d.dur}s`,
                            ["--dot-delay" as any]: `${d.delay}s`,
                            ["--dot-drift" as any]: `${d.drift}px`,
                            filter: d.blur ? `blur(${d.blur}px)` : undefined,
                        } as any
                    }
                />
            ))}
            <div className="focus-sweep" />
        </div>
    );
}

export default function LandingPage() {
    const coreConceptLinks = [
        { text: "Body doubling", tone: "green" as const, to: "/body-doubling" },
        { text: "Online coworking", tone: "blue" as const, to: "/online-coworking" },
        { text: "Group focus sessions", tone: "red" as const, to: "/group-focus-sessions" },
        { text: "Silent coworking", tone: "neutral" as const, to: "/silent-coworking" },
        { text: "ADHD productivity", tone: "neutral" as const, to: "/adhd-productivity" },
    ];

    const aiPillar = { text: "Real-time AI assistant", tone: "red" as const, to: "/ai-assistant" };

    const faqItems = [
        {
            q: "What is body doubling?",
            a: "Body doubling is working alongside another person (in-person or online) to make it easier to start and stay on task — often with live presence and minimal talking.",
        },
        {
            q: "Does body doubling work online?",
            a: "For many people, yes. Online body doubling uses live coworking sessions so you get real-time presence and accountability without needing to chat.",
        },
        {
            q: "Are online coworking sessions silent?",
            a: "Most sessions are silent coworking: mic off by default, and people work on their own tasks with a simple intention and recap.",
        },
        {
            q: "Do I need to talk during sessions?",
            a: "No. Talking is optional. The default is quiet focus with a lightweight structure: intention → focus blocks → recap.",
        },
        {
            q: "Is MySession similar to Focusmate?",
            a: "It’s the same category (body doubling / online coworking), but MySession focuses on group sessions and always-available rooms — plus an integrated real-time AI assistant.",
        },
        {
            q: "Can I join group focus sessions anytime?",
            a: "Yes. Join scheduled sessions or drop into always-open rooms (24/7) whenever you need a focus container right now.",
        },
        {
            q: "Is body doubling good for ADHD?",
            a: "Some people with ADHD say body doubling helps them start and stay engaged. This is not medical advice — it’s a productivity format that some people find supportive.",
        },
        {
            q: "What makes the AI assistant different from “just ChatGPT”?",
            a: "It’s built into the session loop: it helps you decide the next step and keep momentum, and can optionally use screenshare context — without leaving the focus session.",
        },
    ];

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
                    WebkitMaskImage:
                        "linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.0) 92%)",
                    maskImage:
                        "linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.0) 92%)",
                }}
            />

            <main className="relative w-full px-3 md:px-6 lg:px-10 pb-16">
                {/* HERO */}
                <section className="pt-[92px] md:pt-[110px] pb-10 relative">
                    <FocusParticles count={28} />
                    <div aria-hidden="true" className="hero-mesh pointer-events-none absolute -inset-x-24 -top-40 h-[520px] md:h-[580px]" />
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
                            <AccentPill text="Body doubling" tone="green" />
                            <AccentPill text="Online coworking" tone="blue" />
                            <AccentPill text="Group focus sessions" tone="red" />
                            <AccentPill text="Real-time AI assistant" tone="red" />
                            <AccentPill text="$10/month" tone="neutral" />
                        </div>

                        <h1 className="text-[30px] md:text-[40px] xl:text-[52px] font-normal leading-tight">
                            Live online body doubling
                            <br className="hidden md:block" />
                            &amp; group focus sessions — with real-time AI support.
                        </h1>

                        <p className="mt-5 text-[14px] md:text-[16px] text-[#606060] leading-relaxed max-w-[940px] mx-auto">
                            <span className="text-[#2F2F2F]">MySession is a platform for live online body doubling and group focus sessions.</span>{" "}
                            Join silent coworking rooms (video-based accountability sessions), set a simple intention, and follow a structured focus format.{" "}
                            <span className="text-[#2F2F2F]">Built-in real-time AI assistant (screenshare included)</span>{" "}
                            helps you unblock the next step mid-session — without leaving the focus container.
                        </p>

                        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                            <Link
                                to="/sessions"
                                className={`
                  h-12 rounded-full px-7 text-[14px] font-semibold
                  bg-[#111827] text-white hover:opacity-90 transition
                  w-full sm:w-auto inline-flex items-center justify-center
                  ${sessionCtaClass}
                `}
                                style={{ ["--cta-grad" as any]: GRADIENT }}
                            >
                                <span className="relative z-10">Join a focus session</span>
                            </Link>

                            <Link
                                to="/ai-assistant"
                                className="h-12 rounded-full px-7 text-[14px] font-semibold border border-[#2F2F2F] text-[#2F2F2F] hover:bg-[#2F2F2F] hover:text-white transition w-full sm:w-auto inline-flex items-center justify-center"
                            >
                                See AI assistant
                            </Link>
                        </div>

                        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                            <AccentPill text="Silent coworking" tone="neutral" />
                            <AccentPill text="Focus sessions with video" tone="neutral" />
                            <AccentPill text="Virtual coworking sessions" tone="neutral" />
                            <AccentPill text="24/7 rooms" tone="blue" />
                            <AccentPill text="Buddy tripling (3 people)" tone="green" />
                        </div>
                    </div>

                    {/* HERO VISUAL */}
                    <div className="mt-10 max-w-[1100px] mx-auto relative">
                        <div className="border border-[#DBD8D8] rounded-[32px] bg-white/70 backdrop-blur-[6px] p-4 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.05)]">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {/* Left */}
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
                                            <div className="text-[14px] font-semibold">Intention → focus → recap</div>
                                            <div className="text-[12px] text-[#606060]">Structure that keeps you moving</div>
                                        </div>

                                        <div className="mt-4 space-y-3">
                                            <div className="rounded-[16px] border border-[#DBD8D8] p-4 bg-white/70">
                                                <div className="text-[13px] font-semibold">Current intention: “Ship sessions polish”</div>
                                                <div className="mt-2 text-[12px] text-[#606060]">Intention → stages → recap • progress tracked</div>
                                                <div className="mt-3 h-2 rounded-full bg-[#F1F1F1] overflow-hidden">
                                                    <div className="h-2 w-[62%] bg-[#111827]" />
                                                </div>
                                                <div className="mt-2 text-[12px] text-[#606060]">62% complete</div>
                                            </div>

                                            <div className="rounded-[16px] border border-[#DBD8D8] p-4 bg-white/70">
                                                <div className="text-[13px] font-semibold">Body doubling (live presence)</div>
                                                <div className="mt-2 text-[12px] text-[#606060] leading-relaxed">
                                                    Work alongside others — less friction to start, more follow-through — without chatter.
                                                </div>
                                            </div>

                                            <div className="rounded-[16px] border border-[#DBD8D8] p-4 bg-white/70">
                                                <div className="text-[13px] font-semibold">AI assistant inside the loop</div>
                                                <div className="mt-2 text-[12px] text-[#606060] leading-relaxed">
                                                    If stuck mid-session: ask for the next step, break down tasks, or use screenshare context.
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Right */}
                                <div className="bg-white border border-[#EAEAEA] rounded-[24px] p-5 flex flex-col relative overflow-hidden">
                                    <div
                                        aria-hidden="true"
                                        className="absolute -top-24 -right-24 w-72 h-72 rounded-full blur-3xl opacity-35"
                                        style={{ backgroundColor: MS_RED }}
                                    />
                                    <div className="relative flex items-center justify-between">
                                        <div className="text-[14px] font-semibold">Real-time AI assistant</div>
                                        <div className="text-[12px] text-[#606060]">Screenshare included</div>
                                    </div>

                                    <div className="relative mt-4 flex-1 rounded-[20px] border border-[#DBD8D8] bg-[#F6F6F6]/70 p-4">
                                        <div className="text-[12px] text-[#606060]">
                                            Built into the session workflow — it helps you decide “what next” without leaving the focus container.
                                        </div>

                                        <div className="mt-4 rounded-[16px] bg-white border border-[#EAEAEA] p-4">
                                            <div className="flex items-center justify-between">
                                                <div className="text-[13px] font-semibold">Current block</div>
                                                <div className="text-[12px] text-[#606060]">Deep work</div>
                                            </div>
                                            <div className="mt-3 h-2 rounded-full bg-[#F1F1F1] overflow-hidden">
                                                <div className="h-2 w-[35%] bg-[#111827]" />
                                            </div>
                                            <div className="mt-2 text-[12px] text-[#606060]">Stage 2/4 • Keep moving — minimal UI, maximum focus</div>
                                        </div>

                                        <div className="mt-4 rounded-[16px] bg-white border border-[#EAEAEA] p-4">
                                            <div className="text-[13px] font-semibold">Screenshare unblock</div>
                                            <div className="mt-2 text-[12px] text-[#606060]">
                                                Share your screen → ask what to do next → get a concrete next step, then continue the session.
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-4 flex flex-col sm:flex-row gap-3 relative">
                                        <Link
                                            to="/sessions"
                                            className={`
                        h-12 rounded-full px-6 text-[14px] font-semibold
                        bg-[#111827] text-white hover:opacity-90 transition
                        w-full sm:w-auto inline-flex items-center justify-center
                        ${sessionCtaClass}
                      `}
                                            style={{ ["--cta-grad" as any]: GRADIENT }}
                                        >
                                            <span className="relative z-10">Browse sessions</span>
                                        </Link>

                                        <Link
                                            to="/ai-assistant"
                                            className="h-12 rounded-full px-6 text-[14px] font-semibold border border-[#2F2F2F] text-[#2F2F2F] hover:bg-[#2F2F2F] hover:text-white transition w-full sm:w-auto inline-flex items-center justify-center"
                                        >
                                            Learn AI assistant
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* CONCEPTS + AI (clean, user-facing) */}
                <section className="py-10">
                    <SectionTitle
                        kicker="Start here"
                        title="Body doubling is the core. AI helps when you’re stuck."
                        subtitle="Join a live focus container (silent by default). Start with an intention, work in focus blocks, recap — and use the built-in AI assistant when you need the next step."
                    />

                    <div className="mt-7 max-w-[980px] mx-auto flex flex-wrap items-center justify-center gap-2">
                        {coreConceptLinks.map((c) => (
                            <Link
                                key={c.to}
                                to={c.to}
                                className="focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#111827]/20 rounded-full"
                                aria-label={`Open ${c.text}`}
                            >
                                <AccentPill text={c.text} tone={c.tone} />
                            </Link>
                        ))}
                    </div>

                    <div className="mt-5 max-w-[980px] mx-auto">
                        <div className="border border-[#DBD8D8] rounded-[20px] bg-white/80 backdrop-blur-[4px] px-5 py-4 flex flex-col md:flex-row items-center justify-between gap-3">
                            <div className="text-[13px] text-[#606060]">
                                <span className="font-semibold text-[#2F2F2F]">Built-in AI assistant:</span>{" "}
                                get a concrete next step mid-session (screenshare optional) — without leaving the focus container.
                            </div>

                            <Link
                                to={aiPillar.to}
                                className={`
                  h-10 rounded-full px-5 text-[13px] font-semibold
                  bg-[#111827] text-white hover:opacity-90 transition inline-flex items-center justify-center
                  ${sessionCtaClass}
                `}
                                style={{ ["--cta-grad" as any]: GRADIENT }}
                            >
                                <span className="relative z-10">Try AI assistant</span>
                            </Link>
                        </div>
                    </div>

                    <div className="mt-4 text-center text-[12px] text-[#606060]">
                        If you’re new: start with <span className="underline underline-offset-2">Body doubling</span>. If you’re stuck: open the{" "}
                        <span className="underline underline-offset-2">AI assistant</span>.
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
                            title="Group focus sessions"
                            desc="Join structured sessions with multiple people and stay accountable through shared presence."
                            bullets={["Best for energy + momentum", "Clear structure (Pomodoro / Deep Work / Sprints)", "Join in seconds — no setup"]}
                        />
                        <FormatCard
                            accent="green"
                            title="24/7 Infinite Rooms"
                            desc="Always open. Drop in anytime and focus inside a structured room — day or night."
                            bullets={["No scheduling — just join", "Great for spontaneous motivation", "Reliable “focus place” whenever you need it"]}
                        />
                        <FormatCard
                            accent="red"
                            title="Buddy Tripling (3 people)"
                            desc="A small, cozy circle for accountability. Easier to fill than larger group sessions — less friction, faster start."
                            bullets={["Higher comfort, still real accountability", "Easier to match than big group sessions", "Great for recurring sessions + habit building"]}
                        />
                    </div>
                </section>

                {/* HOW IT WORKS */}
                <section className="py-12">
                    <SectionTitle kicker="How it works" title="A simple flow that forces momentum." subtitle="Join fast — then the structure keeps you honest." />

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

                {/* LIVE PREVIEW */}
                <section className="py-12">
                    <SectionTitle kicker="Explore" title="See sessions — join in seconds." subtitle="This is the core product. Simple, fast, and structured." />

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
                            <Link
                                to="/sessions"
                                className={`
                  h-12 rounded-full px-7 text-[14px] font-semibold
                  bg-[#111827] text-white hover:opacity-90 transition
                  w-full sm:w-auto inline-flex items-center justify-center
                  ${sessionCtaClass}
                `}
                                style={{ ["--cta-grad" as any]: GRADIENT }}
                            >
                                <span className="relative z-10">Open full schedule</span>
                            </Link>
                        </div>
                    </div>
                </section>

                {/* FAQ */}
                <section className="py-12">
                    <SectionTitle kicker="FAQ" title="Quick answers." subtitle="If you still have doubts — start with one session. That’s the best demo." />

                    <div className="mt-10 max-w-[980px] mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
                        {faqItems.map((item) => (
                            <div
                                key={item.q}
                                className="border border-[#DBD8D8] rounded-[24px] p-6 bg-white/80 backdrop-blur-[4px]"
                            >
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
                                background: `radial-gradient(600px 260px at 20% 40%, rgba(101,212,108,0.35), rgba(101,212,108,0.00) 70%),
                           radial-gradient(520px 240px at 55% 30%, rgba(82,134,246,0.32), rgba(82,134,246,0.00) 70%),
                           radial-gradient(520px 240px at 80% 60%, rgba(246,82,82,0.28), rgba(246,82,82,0.00) 70%)`,
                            }}
                        />
                        <div className="max-w-[980px] mx-auto text-center relative">
                            <div className="text-[24px] md:text-[32px] font-normal leading-tight">Start with one session. Ship something today.</div>
                            <div className="mt-3 text-[14px] md:text-[16px] text-white/80">
                                Join a session, set intentions, stay accountable — and keep momentum going.
                            </div>

                            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                                <Link
                                    to="/sessions"
                                    className={`
                    h-12 rounded-full px-7 text-[14px] font-semibold
                    bg-white text-[#111827] hover:opacity-90 transition
                    w-full sm:w-auto inline-flex items-center justify-center
                    ${sessionCtaClass}
                  `}
                                    style={{ ["--cta-grad" as any]: GRADIENT }}
                                >
                                    <span className="relative z-10">Join now</span>
                                </Link>

                                <Link
                                    to="/pricing"
                                    className="h-12 rounded-full px-7 text-[14px] font-semibold border border-white text-white hover:bg-white hover:text-[#111827] transition w-full sm:w-auto inline-flex items-center justify-center"
                                >
                                    Subscribe $10/mo
                                </Link>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Local CSS */}
                <style>{`
          /* CTA sheen background */
          .session-cta::before { background: var(--cta-grad); }

          @keyframes gradMove {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }

          /* HERO animated mesh */
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

          /* Focus particles */
          .focus-particles {
            -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.65) 45%, rgba(0,0,0,0.0) 95%);
            mask-image: linear-gradient(to bottom, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.65) 45%, rgba(0,0,0,0.0) 95%);
          }

          .focus-dot {
            position: absolute;
            border-radius: 9999px;
            background: color-mix(in srgb, var(--dot-c) calc(var(--dot-a) * 100%), transparent);
            opacity: 0.75;
            transform: translate3d(0,0,0);
            animation:
              dotDrift var(--dot-dur) ease-in-out infinite,
              dotPulse 4.8s ease-in-out infinite;
            animation-delay: var(--dot-delay), var(--dot-delay);
            box-shadow: 0 0 0 0 rgba(0,0,0,0);
          }

          .focus-dot.is-ring {
            background: transparent;
            border: 1px solid color-mix(in srgb, var(--dot-c) 55%, transparent);
          }

          .focus-dot.is-glow {
            box-shadow:
              0 0 16px color-mix(in srgb, var(--dot-c) 30%, transparent),
              0 0 32px color-mix(in srgb, var(--dot-c) 18%, transparent);
          }

          @keyframes dotDrift {
            0%   { transform: translate3d(0px, 0px, 0) scale(1); }
            40%  { transform: translate3d(calc(var(--dot-drift) * 0.6), calc(var(--dot-drift) * -0.35), 0) scale(1.05); }
            70%  { transform: translate3d(calc(var(--dot-drift) * -0.35), calc(var(--dot-drift) * 0.55), 0) scale(0.98); }
            100% { transform: translate3d(0px, 0px, 0) scale(1); }
          }

          @keyframes dotPulse {
            0%, 100% { opacity: 0.55; }
            50%      { opacity: 0.85; }
          }

          /* Subtle sweeping flow line */
          .focus-sweep {
            position: absolute;
            left: -20%;
            top: 20%;
            width: 140%;
            height: 2px;
            opacity: 0.15;
            background: ${GRADIENT};
            filter: blur(0.4px);
            transform: rotate(-8deg);
            animation: sweep 9s ease-in-out infinite;
          }

          @keyframes sweep {
            0%   { transform: translateX(-8%) rotate(-8deg); opacity: 0.0; }
            15%  { opacity: 0.18; }
            50%  { transform: translateX(8%) rotate(-8deg); opacity: 0.14; }
            85%  { opacity: 0.18; }
            100% { transform: translateX(-8%) rotate(-8deg); opacity: 0.0; }
          }

          /* Reduce motion */
          @media (prefers-reduced-motion: reduce) {
            .session-cta:hover::before { animation: none !important; }
            .hero-mesh { animation: none !important; }
            .focus-dot, .focus-sweep { animation: none !important; }
          }
        `}</style>
            </main>
        </div>
    );
}
