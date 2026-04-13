// src/pages/LandingPage.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const MS_BLUE = "#5286F6";
const MS_GREEN = "#65D46C";
const MS_RED = "#F65252";

const ROTATING_LINES = [
    "struggle to get started?",
    "lose focus easily?",
    "keep putting things off?",
    "get distracted at home?",
    "work better around other people?",
];

const STATS = [
    "95% of users report improved focus",
    "3.8x more likely to finish your tasks",
    "85% report getting started on tasks more easily",
];

const MOVING_LINE =
    "Moving task lines • Moving task lines • Moving task lines • Moving task lines • Moving task lines • Moving task lines • Moving task lines • ";

const FAQ_ITEMS = [
    {
        q: "What is body doubling?",
        a: "Working alongside other people — even silently — makes it easier to start and stay on task. MySession brings that online.",
    },
    {
        q: "Do I have to talk during sessions?",
        a: "No. Sessions are silent by default. You show up, set your tasks, and work. That’s it.",
    },
    {
        q: "Who will I be working with?",
        a: "Designers, developers, writers, students, freelancers — people from all over the world working on their own things, just like you.",
    },
    {
        q: "Is it really free to start?",
        a: "Yes. You can join your first session for free, no credit card required.",
    },
    {
        q: "Is MySession good for ADHD?",
        a: "Many people with ADHD find that working alongside others helps them start and stay on task. MySession’s structured sessions and group energy make that easier.",
    },
    {
        q: "Can I join from anywhere?",
        a: "Yes — MySession is fully browser-based, no downloads required. Join from home, a coffee shop, or wherever you work.",
    },
];

const SESSION_TYPES = [
    {
        title: "Group sessions",
        description:
            "Join a structured session with others, follow the structure, and get things done. Best for momentum and accountability.",
        bullets: [
            "Standard formats: 50/10, 25/5 Pomodoro",
            "Custom sprints: 5, 10, 15-min formats",
            "Verbal check-ins built in",
        ],
        tone: "red" as const,
    },
    {
        title: "24/7 Rooms",
        description:
            "Always open. Drop in anytime, day or night — no scheduling, just show up and work.",
        bullets: ["Great for spontaneous work sessions"],
        tone: "blue" as const,
    },
    {
        title: "Buddy Tripling",
        description:
            "A cozy circle of 3. Personal enough to feel comfortable and to keep you on track.",
        bullets: [
            "Screenshare-only sessions available",
            "Great for recurring sessions and habit building",
        ],
        tone: "green" as const,
    },
];

function cx(...parts: Array<string | false | null | undefined>) {
    return parts.filter(Boolean).join(" ");
}

function Shell({ children }: { children: React.ReactNode }) {
    return <div className="mx-auto w-full max-w-[1180px] px-4 md:px-6">{children}</div>;
}

function Label({
    children,
    tone = "neutral",
}: {
    children: React.ReactNode;
    tone?: "neutral" | "blue" | "green" | "red";
}) {
    const cls =
        tone === "blue"
            ? "border-[#C8D7FF] bg-[#EEF3FF] text-[#335CCF]"
            : tone === "green"
                ? "border-[#CBEBCD] bg-[#EFF9EF] text-[#2F8C39]"
                : tone === "red"
                    ? "border-[#F3CACA] bg-[#FFF0F0] text-[#C94848]"
                    : "border-[#D7D2CC] bg-[#F4F1ED] text-[#5B5651]";

    return (
        <div
            className={cx(
                "inline-flex items-center rounded-full border px-3 py-1 text-[12px] font-medium",
                cls
            )}
        >
            {children}
        </div>
    );
}

function Card({
    children,
    className = "",
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cx(
                "rounded-[28px] border border-[#D9D4CE] bg-[#FCFBF9] p-6 md:p-8 shadow-[0_1px_0_rgba(0,0,0,0.02)] transition duration-300 hover:-translate-y-[2px] hover:shadow-[0_12px_40px_rgba(17,24,39,0.05)]",
                className
            )}
        >
            {children}
        </div>
    );
}

function SoftButton({
    to,
    children,
    dark = false,
    className = "",
}: {
    to: string;
    children: React.ReactNode;
    dark?: boolean;
    className?: string;
}) {
    return (
        <Link
            to={to}
            className={cx(
                "inline-flex h-12 items-center justify-center rounded-full px-6 text-[14px] font-semibold transition duration-200",
                dark
                    ? "bg-[#2F2F2F] text-white hover:opacity-90"
                    : "border border-[#2F2F2F] text-[#2F2F2F] hover:bg-[#2F2F2F] hover:text-white",
                className
            )}
        >
            {children}
        </Link>
    );
}

function AccentDot({ tone }: { tone: "blue" | "green" | "red" }) {
    const color = tone === "blue" ? MS_BLUE : tone === "green" ? MS_GREEN : MS_RED;
    return <span className="mt-[8px] h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}

function SessionChip({
    children,
    tone,
}: {
    children: React.ReactNode;
    tone: "blue" | "green" | "red";
}) {
    const cls =
        tone === "blue"
            ? "border-[#C8D7FF] bg-[#EEF3FF] text-[#335CCF]"
            : tone === "green"
                ? "border-[#CBEBCD] bg-[#EFF9EF] text-[#2F8C39]"
                : "border-[#F3CACA] bg-[#FFF0F0] text-[#C94848]";

    return (
        <span className={cx("inline-flex items-center rounded-full border px-3 py-1 text-[12px] font-medium", cls)}>
            {children}
        </span>
    );
}

function Reveal({
    children,
    delay = 0,
}: {
    children: React.ReactNode;
    delay?: number;
}) {
    return (
        <div
            className="landing-reveal"
            style={{
                animationDelay: `${delay}ms`,
            }}
        >
            {children}
        </div>
    );
}

function RotatingPrompt() {
    const [index, setIndex] = useState(0);
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        const hideTimer = window.setInterval(() => {
            setVisible(false);

            window.setTimeout(() => {
                setIndex((prev) => (prev + 1) % ROTATING_LINES.length);
                setVisible(true);
            }, 220);
        }, 2500);

        return () => {
            window.clearInterval(hideTimer);
        };
    }, []);

    return (
        <span
            className={cx(
                "inline-block min-h-[1.2em] transition-all duration-200",
                visible ? "translate-y-0 opacity-100" : "translate-y-[6px] opacity-0"
            )}
        >
            {ROTATING_LINES[index]}
        </span>
    );
}

function SessionTypeCard({
    title,
    description,
    bullets,
    tone,
}: {
    title: string;
    description: string;
    bullets: string[];
    tone: "blue" | "green" | "red";
}) {
    return (
        <div className="rounded-[24px] border border-[#D9D4CE] bg-white p-5 md:p-6 transition duration-300 hover:-translate-y-[2px] hover:shadow-[0_12px_34px_rgba(17,24,39,0.05)]">
            <div className="flex items-center justify-between gap-4">
                <h3 className="text-[20px] font-semibold text-[#2F2F2F]">{title}</h3>
                <div
                    className="h-3 w-3 rounded-full"
                    style={{
                        backgroundColor: tone === "blue" ? MS_BLUE : tone === "green" ? MS_GREEN : MS_RED,
                    }}
                />
            </div>

            <p className="mt-3 text-[14px] leading-relaxed text-[#5F5A55]">{description}</p>

            <ul className="mt-4 space-y-2">
                {bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-3 text-[14px] leading-relaxed text-[#3F3B37]">
                        <AccentDot tone={tone} />
                        <span>{bullet}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function SessionRow({
    title,
    host,
    duration,
    startsIn,
    tag,
    tagTone,
    people,
}: {
    title: string;
    host: string;
    duration: string;
    startsIn: string;
    tag: string;
    tagTone: "blue" | "green" | "red";
    people: string;
}) {
    return (
        <div className="rounded-[28px] border border-[#D9D4CE] bg-[#FCFBF9] px-5 py-5 md:px-8 md:py-6 transition duration-300 hover:-translate-y-[2px] hover:shadow-[0_14px_40px_rgba(17,24,39,0.05)]">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_auto_auto] lg:items-center">
                <div className="min-w-0">
                    <div className="text-[28px] font-semibold leading-tight text-[#121212]">{title}</div>

                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-[#6A655F]">
                        <span>Host: {host}</span>
                        <span>•</span>
                        <span>{duration}</span>
                        <span>•</span>
                        <span>Starts in {startsIn}</span>
                        <SessionChip tone={tagTone}>{tag}</SessionChip>
                    </div>
                </div>

                <div className="hidden items-center gap-5 lg:flex">
                    <div className="h-10 w-px bg-[#DED9D2]" />
                    <div className="text-center">
                        <div className="text-[28px] font-semibold text-[#121212]">{people}</div>
                        <div className="mt-[-2px] text-[11px] text-[#7A746D]">In the session</div>
                    </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
                    <SoftButton to="/sessions" className="w-full sm:w-auto">
                        Book session
                    </SoftButton>
                    <SoftButton to="/sessions" dark className="w-full sm:w-auto">
                        Join session
                    </SoftButton>
                </div>
            </div>
        </div>
    );
}

function FaqCard({ q, a }: { q: string; a: string }) {
    return (
        <div className="rounded-[24px] border border-[#D9D4CE] bg-white p-5 md:p-6 transition duration-300 hover:-translate-y-[2px] hover:shadow-[0_10px_30px_rgba(17,24,39,0.04)]">
            <div className="text-[16px] font-semibold leading-snug text-[#2F2F2F]">{q}</div>
            <p className="mt-3 text-[14px] leading-relaxed text-[#5F5A55]">{a}</p>
        </div>
    );
}

export default function LandingPage() {
    const tabs = useMemo(
        () => [
            { label: "Group sessions", active: false },
            { label: "Infinite rooms", active: true },
            { label: "Body tripling", active: false },
        ],
        []
    );

    return (
        <div className="min-h-screen bg-[#F5F3F0] text-[#2F2F2F]">
            <main className="pb-16 pt-[88px] md:pt-[104px]">
                <Shell>
                    {/* HERO */}
                    <section className="mb-6 md:mb-8">
                        <Reveal>
                            <Card className="overflow-hidden">
                                <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
                                    <div>
                                        <Label tone="red">Hero section</Label>

                                        <div className="mt-5">
                                            <div className="text-[36px] font-semibold leading-tight text-[#121212] md:text-[52px]">
                                                Do you
                                            </div>

                                            <div className="mt-3 text-[28px] font-medium leading-tight text-[#4D4741] md:text-[40px]">
                                                <RotatingPrompt />
                                            </div>

                                            <p className="mt-7 max-w-[680px] text-[16px] leading-relaxed text-[#5F5A55]">
                                                Join live coworking sessions, work alongside focused people,
                                                and actually get things done.
                                            </p>

                                            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                                                <SoftButton to="/sessions" dark className="w-full sm:w-auto">
                                                    Join a session — it’s free
                                                </SoftButton>
                                                <SoftButton to="/pricing" className="w-full sm:w-auto">
                                                    See pricing
                                                </SoftButton>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="rounded-[24px] border border-[#D9D4CE] bg-white p-5 md:p-6">
                                        <div className="flex items-center justify-center">
                                            <div className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#2F2F2F] text-[28px] text-white">
                                                ∞
                                            </div>
                                        </div>

                                        <div className="mt-5 text-center text-[30px] font-semibold leading-tight text-[#121212] md:text-[38px]">
                                            24/7 Infinite Rooms
                                        </div>

                                        <p className="mx-auto mt-5 max-w-[520px] text-center text-[15px] leading-relaxed text-[#5F5A55]">
                                            24/7 Infinite Rooms are always open, giving you a structured
                                            space to focus whenever inspiration strikes. Join at any time,
                                            follow the built-in workflow, stay accountable with others, and
                                            keep your momentum going — day or night.
                                        </p>

                                        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
                                            <div className="rounded-[18px] border border-[#D9E4FF] bg-[#F1F5FF] px-4 py-4 text-center">
                                                <div className="text-[14px] font-semibold text-[#2F2F2F]">
                                                    Always Open
                                                </div>
                                                <div className="mt-1 text-[12px] text-[#6A655F]">24/7 Access</div>
                                            </div>

                                            <div className="rounded-[18px] border border-[#D7EFD8] bg-[#F2FBF2] px-4 py-4 text-center">
                                                <div className="text-[14px] font-semibold text-[#2F2F2F]">
                                                    Stay accountable
                                                </div>
                                                <div className="mt-1 text-[12px] text-[#6A655F]">With others</div>
                                            </div>

                                            <div className="rounded-[18px] border border-[#F1D3D3] bg-[#FFF2F2] px-4 py-4 text-center">
                                                <div className="text-[14px] font-semibold text-[#2F2F2F]">
                                                    Structured Flow
                                                </div>
                                                <div className="mt-1 text-[12px] text-[#6A655F]">Built-in workflow</div>
                                            </div>

                                            <div className="rounded-[18px] border border-[#D9E4FF] bg-[#F1F5FF] px-4 py-4 text-center">
                                                <div className="text-[14px] font-semibold text-[#2F2F2F]">
                                                    Keep momentum
                                                </div>
                                                <div className="mt-1 text-[12px] text-[#6A655F]">Day & Night</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        </Reveal>
                    </section>

                    {/* STATS */}
                    <section className="mb-6 md:mb-8">
                        <Reveal delay={80}>
                            <Card>
                                <Label tone="neutral">stats</Label>

                                <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-3">
                                    {STATS.map((item) => (
                                        <div key={item} className="text-center">
                                            <div className="text-[15px] font-medium leading-relaxed text-[#2F2F2F]">
                                                {item}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="mt-8 overflow-hidden rounded-full border border-[#E0DCD7] bg-white py-3">
                                    <div className="landing-marquee whitespace-nowrap text-[13px] text-[#5F5A55]">
                                        <span className="mx-4">{MOVING_LINE}</span>
                                        <span className="mx-4">{MOVING_LINE}</span>
                                    </div>
                                </div>
                            </Card>
                        </Reveal>
                    </section>

                    {/* PAIN / TRUTHS */}
                    <section className="mb-6 md:mb-8">
                        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.18fr_0.82fr]">
                            <Reveal delay={120}>
                                <Card>
                                    <Label tone="red">pain/truths</Label>

                                    <div className="mt-6">
                                        <h2 className="text-[26px] font-semibold leading-tight text-[#121212]">
                                            Work alongside others — and get x2 more done
                                        </h2>

                                        <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-[#5F5A55]">
                                            <p>
                                                Whether you have ADHD, tend to procrastinate, get distracted
                                                easily, feel lonely working alone, or simply work better around
                                                people — MySession brings you into a structured community of
                                                people working on things that matter. Join a session, set your
                                                tasks, and actually make your plans a reality.
                                            </p>

                                            <p>
                                                Even if you’re shy or introverted — you don’t need to talk or
                                                perform. Just show up and work alongside others.
                                            </p>
                                        </div>

                                        <div className="mt-8 flex flex-wrap gap-x-3 gap-y-2 text-[13px] text-[#4E4A46]">
                                            <span>Writers</span>
                                            <span>•</span>
                                            <span>Designers</span>
                                            <span>•</span>
                                            <span>Developers</span>
                                            <span>•</span>
                                            <span>Students</span>
                                            <span>•</span>
                                            <span>Freelancers</span>
                                            <span>•</span>
                                            <span>Marketers</span>
                                            <span>•</span>
                                            <span>Founders</span>
                                            <span>•</span>
                                            <span>Creators</span>
                                            <span>•</span>
                                            <span>Researchers</span>
                                        </div>
                                    </div>
                                </Card>
                            </Reveal>

                            <Reveal delay={180}>
                                <Card className="h-full">
                                    <Label tone="neutral">Who it is &gt; What + Value</Label>

                                    <div className="mt-6 space-y-4 text-[14px] leading-relaxed text-[#5F5A55]">
                                        <p>
                                            Whether you have ADHD, tend to procrastinate, get distracted
                                            easily, feel lonely working alone, or simply work better around
                                            people, MySession brings you into a structured community of people
                                            working on things that matter.
                                        </p>

                                        <p>
                                            From deep work and serious projects to morning routines, reading,
                                            meditation, and workouts, everyone is here to show up and make
                                            progress, whatever that looks like for them.
                                        </p>

                                        <p>
                                            Join a session, set your tasks, and actually make your plans a
                                            reality. Even if you’re shy or introverted, you don’t need to talk
                                            or perform. Just show up and work alongside others.
                                        </p>
                                    </div>
                                </Card>
                            </Reveal>
                        </div>
                    </section>

                    {/* HOW IT WORKS */}
                    <section className="mb-6 md:mb-8">
                        <Reveal delay={220}>
                            <Card>
                                <Label tone="green">how it works</Label>

                                <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
                                    <div className="rounded-[24px] border border-[#D9D4CE] bg-white p-5 md:p-6">
                                        <div className="text-[18px] font-semibold text-[#121212]">
                                            1) Join a session
                                        </div>
                                        <p className="mt-4 text-[14px] leading-relaxed text-[#5F5A55]">
                                            Choose what fits your day — a group session, a 24/7 room, or a
                                            cozy circle of 3. Jump right in.
                                        </p>
                                    </div>

                                    <div className="rounded-[24px] border border-[#D9D4CE] bg-white p-5 md:p-6">
                                        <div className="text-[18px] font-semibold text-[#121212]">
                                            2) Work alongside others
                                        </div>
                                        <p className="mt-4 text-[14px] leading-relaxed text-[#5F5A55]">
                                            Write down what you want to finish, see focused people around you,
                                            and naturally get into your work. Silent, structured,
                                            distraction-free.
                                        </p>
                                    </div>

                                    <div className="rounded-[24px] border border-[#D9D4CE] bg-white p-5 md:p-6">
                                        <div className="text-[18px] font-semibold text-[#121212]">
                                            3) Celebrate your progress
                                        </div>
                                        <p className="mt-4 text-[14px] leading-relaxed text-[#5F5A55]">
                                            Session done, share what you got done, celebrate your wins, and
                                            leave feeling accomplished.
                                        </p>
                                    </div>
                                </div>
                            </Card>
                        </Reveal>
                    </section>

                    {/* TYPE OF SESSIONS */}
                    <section className="mb-6 md:mb-8">
                        <Reveal delay={260}>
                            <Card>
                                <Label tone="blue">Type of sessions</Label>

                                <div className="mt-6">
                                    <div className="mx-auto flex w-full max-w-[620px] items-center justify-between rounded-full border border-[#D9D4CE] bg-white p-1 text-[14px]">
                                        {tabs.map((tab) => (
                                            <div
                                                key={tab.label}
                                                className={cx(
                                                    "flex-1 rounded-full px-4 py-3 text-center transition duration-200",
                                                    tab.active
                                                        ? "bg-[#2F2F2F] font-medium text-white"
                                                        : "text-[#5F5A55]"
                                                )}
                                            >
                                                {tab.label}
                                            </div>
                                        ))}
                                    </div>

                                    <div className="mt-7 text-center">
                                        <h2 className="text-[26px] font-semibold leading-tight text-[#121212]">
                                            Find the format that fits your day
                                        </h2>
                                    </div>

                                    <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
                                        {SESSION_TYPES.map((item) => (
                                            <SessionTypeCard
                                                key={item.title}
                                                title={item.title}
                                                description={item.description}
                                                bullets={item.bullets}
                                                tone={item.tone}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </Card>
                        </Reveal>
                    </section>

                    {/* SESSION LIST PREVIEW */}
                    <section className="mb-6 md:mb-8">
                        <Reveal delay={300}>
                            <Card>
                                <Label tone="neutral">Live schedule preview</Label>

                                <div className="mt-6 space-y-4">
                                    <SessionRow
                                        title="50/5/5 Deep work - 2 hours"
                                        host="Yaro"
                                        duration="120 min"
                                        startsIn="44 mins"
                                        tag="Deep work"
                                        tagTone="blue"
                                        people="6"
                                    />

                                    <SessionRow
                                        title="25/5 Pomodoro - 2 hours"
                                        host="Yaro"
                                        duration="120 min"
                                        startsIn="44 mins"
                                        tag="Pomodoro 25/5"
                                        tagTone="red"
                                        people="6"
                                    />

                                    <SessionRow
                                        title="15/3 Short Sprints - 2 hours"
                                        host="Yaro"
                                        duration="120 min"
                                        startsIn="44 mins"
                                        tag="Short sprints"
                                        tagTone="green"
                                        people="6"
                                    />
                                </div>
                            </Card>
                        </Reveal>
                    </section>

                    {/* SOCIAL / COMMUNITY */}
                    <section className="mb-6 md:mb-8">
                        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.92fr_1.08fr]">
                            <Reveal delay={340}>
                                <Card>
                                    <Label tone="blue">What people come back for</Label>

                                    <div className="mt-6 grid grid-cols-1 gap-4">
                                        <div className="rounded-[22px] border border-[#D9D4CE] bg-white p-5">
                                            <div className="text-[16px] font-semibold text-[#121212]">
                                                Low-friction start
                                            </div>
                                            <p className="mt-2 text-[14px] leading-relaxed text-[#5F5A55]">
                                                The hardest part is starting. MySession gives you a room,
                                                structure, and other people already working — so it becomes
                                                easier to begin.
                                            </p>
                                        </div>

                                        <div className="rounded-[22px] border border-[#D9D4CE] bg-white p-5">
                                            <div className="text-[16px] font-semibold text-[#121212]">
                                                Consistent accountability
                                            </div>
                                            <p className="mt-2 text-[14px] leading-relaxed text-[#5F5A55]">
                                                Sessions are not just video calls. They are containers that help
                                                you keep your plan in front of you and follow through.
                                            </p>
                                        </div>

                                        <div className="rounded-[22px] border border-[#D9D4CE] bg-white p-5">
                                            <div className="text-[16px] font-semibold text-[#121212]">
                                                A calm community
                                            </div>
                                            <p className="mt-2 text-[14px] leading-relaxed text-[#5F5A55]">
                                                No pressure, no performance. Just people quietly showing up to
                                                work on things that matter.
                                            </p>
                                        </div>
                                    </div>
                                </Card>
                            </Reveal>

                            <Reveal delay={380}>
                                <Card>
                                    <Label tone="red">Community</Label>

                                    <div className="mt-6 max-w-[820px]">
                                        <h2 className="text-[26px] font-semibold leading-tight text-[#121212]">
                                            You’re not just joining sessions. You’re joining a community.
                                        </h2>

                                        <p className="mt-5 text-[15px] leading-relaxed text-[#5F5A55]">
                                            A global community of creators, builders, students, and
                                            professionals — all showing up every day to work on things that
                                            matter. No pressure, no judgment — just people doing their best
                                            work, together.
                                        </p>

                                        <div className="mt-6 flex flex-wrap gap-2">
                                            <Label tone="green">Silent by default</Label>
                                            <Label tone="blue">Structured sessions</Label>
                                            <Label tone="red">Real accountability</Label>
                                            <Label tone="neutral">Global community</Label>
                                        </div>
                                    </div>
                                </Card>
                            </Reveal>
                        </div>
                    </section>

                    {/* FAQ */}
                    <section className="mb-6 md:mb-8">
                        <Reveal delay={420}>
                            <Card>
                                <Label tone="neutral">FAQs</Label>

                                <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                                    {FAQ_ITEMS.map((item) => (
                                        <FaqCard key={item.q} q={item.q} a={item.a} />
                                    ))}
                                </div>
                            </Card>
                        </Reveal>
                    </section>

                    {/* FINAL CTA */}
                    <section>
                        <Reveal delay={460}>
                            <Card className="bg-[#EDF6EC]">
                                <Label tone="green">final CTA</Label>

                                <div className="mt-6 max-w-[760px]">
                                    <h2 className="text-[28px] font-semibold leading-tight text-[#121212] md:text-[34px]">
                                        Ready to get things done, together?
                                    </h2>

                                    <p className="mt-4 text-[16px] leading-relaxed text-[#5F5A55]">
                                        Join a session now — it’s free.
                                    </p>

                                    <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                                        <SoftButton to="/sessions" dark className="w-full sm:w-auto">
                                            Join a session now
                                        </SoftButton>
                                        <SoftButton to="/pricing" className="w-full sm:w-auto">
                                            View pricing
                                        </SoftButton>
                                    </div>
                                </div>
                            </Card>
                        </Reveal>
                    </section>
                </Shell>

                <style>{`
          .landing-reveal {
            opacity: 0;
            transform: translateY(14px);
            animation: landingReveal 720ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
          }

          @keyframes landingReveal {
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          .landing-marquee {
            display: inline-block;
            min-width: 200%;
            animation: landingMarquee 24s linear infinite;
          }

          @keyframes landingMarquee {
            0% {
              transform: translateX(0);
            }
            100% {
              transform: translateX(-50%);
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .landing-reveal,
            .landing-marquee {
              animation: none !important;
              opacity: 1 !important;
              transform: none !important;
            }
          }
        `}</style>
            </main>
        </div>
    );
}