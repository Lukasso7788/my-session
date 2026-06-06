// src/pages/LandingPage.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const ROTATING_LINES = [
    "Struggle To Get Started?",
    "Lose Focus Easily?",
    "Keep Putting Things Off?",
    "Get Distracted At Home?",
    "Work Better Around Other People?",
];

const TASK_CHIPS = [
    { emoji: "🖼️", label: "Creating digital art", tone: "green" },
    { emoji: "📚", label: "Studying for my exam", tone: "blue" },
    { emoji: "📱", label: "Building a mobile app", tone: "red" },
    { emoji: "📅", label: "Planning my week", tone: "purple" },
    { emoji: "🔍", label: "Meal prepping", tone: "neutral" },
    { emoji: "🙂", label: "Working on a business", tone: "green" },
    { emoji: "✍️", label: "Writing a newsletter", tone: "blue" },
    { emoji: "💻", label: "Coding a feature", tone: "red" },
];

const AUDIENCE_CHIPS = [
    { emoji: "🎓", label: "Students", tone: "green" },
    { emoji: "💼", label: "Freelancers", tone: "red" },
    { emoji: "🎨", label: "Designers", tone: "blue" },
    { emoji: "👨‍💻", label: "Developers", tone: "purple" },
    { emoji: "🎬", label: "Video editors", tone: "neutral" },
    { emoji: "🚀", label: "Founders", tone: "green" },
    { emoji: "🏠", label: "Remote workers", tone: "red" },
    { emoji: "✨", label: "Creators", tone: "blue" },
];

const HERO_TASK_CARDS = [
    {
        name: "Daniel",
        avatar: "/images/landing/hero-card-avatar-daniel.png",
        flag: "/images/landing/flag-france.svg",
        task1: "Studying biology",
        task2: "Working on my thesis chapter 3",
        position: "leftTop",
    },
    {
        name: "Alex R.",
        avatar: "/images/landing/hero-card-avatar-alex.png",
        flag: "/images/landing/flag-india.svg",
        task1: "Preparing slides for tomorrow's meeting",
        task2: "Editing a client report",
        position: "rightTop",
    },
    {
        name: "Mark",
        avatar: "/images/landing/hero-card-avatar-mark.png",
        flag: "/images/landing/flag-spain.svg",
        task1: "Reviewing code",
        task2: "Fixing bugs in my side project",
        position: "leftBottom",
    },
    {
        name: "Sofia",
        avatar: "/images/landing/hero-card-avatar-sofia.png",
        flag: "/images/landing/flag-canada.svg",
        task1: "Researching ideas for my next article",
        task2: "Writing a newsletter",
        position: "rightBottom",
    },
];

const STATS = [
    { value: "85%", text: "Report getting started on tasks more easily." },
    { value: "3.8x", text: "More likely to finish the task they came to do." },
    { value: "95%", text: "Of people report improved focus." },
];

const FAQ_ITEMS = [
    {
        q: "What is MySession?",
        a: "MySession is a live coworking platform where you join structured focus rooms, set your intention, work alongside others, and finish more work with less friction.",
    },
    {
        q: "Do I need to talk?",
        a: "No. Most sessions are silent by default. You can simply join, write your task, and work.",
    },
    {
        q: "Is it good for ADHD?",
        a: "Many ADHD and procrastination-prone users find body doubling helpful because it makes starting and staying on task easier.",
    },
    {
        q: "Can I join anytime?",
        a: "Yes. Infinite rooms are available 24/7, and scheduled sessions run throughout the day.",
    },
    {
        q: "Do I need to download anything?",
        a: "No. MySession is browser-based. Open the app, join a room, and start working.",
    },
];

function cx(...parts: Array<string | false | null | undefined>) {
    return parts.filter(Boolean).join(" ");
}

function SectionShell({
    children,
    className = "",
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section className={cx("mx-auto w-full max-w-[1180px] px-5 md:px-8", className)}>
            {children}
        </section>
    );
}

function RotatingPrompt() {
    const [index, setIndex] = useState(0);
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setVisible(false);
            window.setTimeout(() => {
                setIndex((prev) => (prev + 1) % ROTATING_LINES.length);
                setVisible(true);
            }, 190);
        }, 2450);

        return () => window.clearInterval(timer);
    }, []);

    return (
        <span
            className={cx(
                "inline-block min-h-[1.08em] transition-all duration-200",
                visible ? "translate-y-0 opacity-100" : "translate-y-[8px] opacity-0"
            )}
        >
            {ROTATING_LINES[index]}
        </span>
    );
}

function CtaButton({
    to,
    children,
    dark = false,
}: {
    to: string;
    children: React.ReactNode;
    dark?: boolean;
}) {
    return (
        <Link
            to={to}
            className={cx(
                "inline-flex h-[52px] items-center justify-center rounded-full px-7 text-[14px] font-semibold transition duration-200 hover:-translate-y-0.5",
                dark
                    ? "bg-[#2F2F2F] text-white shadow-[0_20px_44px_rgba(47,47,47,0.28)] hover:bg-[#242424]"
                    : "border border-[#DCDCDC] bg-white text-[#2F2F2F] hover:bg-[#F8F8F8]"
            )}
        >
            {children}
        </Link>
    );
}

function Chip({ item }: { item: { emoji: string; label: string; tone: string } }) {
    const styles: Record<string, string> = {
        green: "bg-[rgba(101,212,108,0.20)] text-[#2F2F2F]",
        blue: "bg-[rgba(82,134,246,0.20)] text-[#2F2F2F]",
        red: "bg-[rgba(246,82,82,0.20)] text-[#2F2F2F]",
        purple: "bg-[rgba(99,102,241,0.20)] text-[#2F2F2F]",
        neutral: "bg-[rgba(47,47,47,0.20)] text-[#2F2F2F]",
    };

    return (
        <span
            className={cx(
                "inline-flex h-[65px] shrink-0 items-center gap-[8px] rounded-full px-[28px] text-[14px] font-medium leading-none",
                styles[item.tone] || styles.neutral
            )}
        >
            <span className="text-[15px] leading-none">{item.emoji}</span>
            <span className="whitespace-nowrap">{item.label}</span>
        </span>
    );
}

function MovingChips({
    items,
    reverse = false,
}: {
    items: Array<{ emoji: string; label: string; tone: string }>;
    reverse?: boolean;
}) {
    return (
        <div className="relative overflow-hidden py-1">
            <div
                className={cx(
                    "landing-chip-track flex w-max items-center gap-[10px]",
                    reverse && "landing-chip-track-reverse"
                )}
            >
                {[...items, ...items, ...items].map((item, index) => (
                    <Chip key={`${item.label}-${index}`} item={item} />
                ))}
            </div>
        </div>
    );
}

function HeroTaskCard({ card }: { card: (typeof HERO_TASK_CARDS)[number] }) {
    return (
        <div className="w-[151px] rounded-[8px] border border-[#E6E6E6] bg-white px-[16px] py-[16px] text-left shadow-[0_18px_42px_rgba(47,47,47,0.08)]">
            <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-[8px]">
                    <img
                        src={card.avatar}
                        alt={`${card.name} avatar`}
                        className="h-[25px] w-[25px] shrink-0 rounded-full object-cover"
                        draggable={false}
                    />

                    <div className="min-w-0 pt-[1px]">
                        <div className="truncate text-[10px] font-medium leading-[12px] text-[#2F2F2F]">
                            {card.name}
                        </div>

                        <img
                            src={card.flag}
                            alt=""
                            className="mt-[3px] h-[7px] w-[11px] select-none object-cover"
                            draggable={false}
                        />
                    </div>
                </div>

                <div className="flex shrink-0 items-center gap-[4px] pt-[2px] text-[6px] font-medium leading-none text-[#28DC2B]">
                    <span className="h-[5px] w-[5px] rounded-full bg-[#28DC2B]" />
                    Live now
                </div>
            </div>

            <div className="mt-[15px] text-[9px] font-medium leading-[11px] text-[#666666]">
                Working on:
            </div>

            <div className="mt-[8px] space-y-[7px]">
                {[card.task1, card.task2].map((task) => (
                    <div key={task} className="flex items-start gap-[7px]">
                        <span className="mt-[1px] h-[11px] w-[11px] shrink-0 rounded-full border border-[#2F2F2F]" />
                        <span className="text-[9px] font-medium leading-[11px] text-[#2F2F2F]">
                            {task}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function HeroArtwork() {
    const positionClass: Record<string, string> = {
        leftTop: "left-[70px] top-[18px] lg:left-[88px] xl:left-[112px]",
        rightTop: "right-[70px] top-[18px] lg:right-[88px] xl:right-[112px]",
        leftBottom: "left-[70px] bottom-[92px] lg:left-[88px] xl:left-[112px]",
        rightBottom: "right-[70px] bottom-[92px] lg:right-[88px] xl:right-[112px]",
    };

    return (
        <div className="mx-auto mt-[64px] w-full max-w-[1320px] md:mt-[70px]">
            <div className="relative hidden min-h-[585px] md:block">
                <div className="pointer-events-none absolute left-1/2 top-[54px] w-[700px] -translate-x-1/2 lg:w-[760px] xl:w-[805px]">
                    <img
                        src="/images/landing/hero-room-desktop.png"
                        alt="MySession live coworking room preview"
                        className="block w-full select-none object-contain"
                        draggable={false}
                    />
                </div>

                {HERO_TASK_CARDS.map((card) => (
                    <div key={card.name} className={cx("absolute z-10", positionClass[card.position])}>
                        <HeroTaskCard card={card} />
                    </div>
                ))}
            </div>

            <div className="block md:hidden">
                <img
                    src="/images/landing/hero-room-mobile.png"
                    alt="MySession live room preview"
                    className="mx-auto block w-full max-w-[420px] select-none object-contain"
                    draggable={false}
                />

                <div className="mx-auto mt-5 grid max-w-[420px] grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                    {HERO_TASK_CARDS.map((card) => (
                        <HeroTaskCard key={card.name} card={card} />
                    ))}
                </div>
            </div>
        </div>
    );
}

function StatCards() {
    return (
        <SectionShell className="mt-[118px] md:mt-[130px]">
            <div className="mx-auto grid max-w-[780px] grid-cols-1 gap-6 sm:grid-cols-3">
                {STATS.map((stat) => (
                    <div
                        key={stat.value}
                        className="min-h-[150px] rounded-[18px] border border-[#E9E9E9] bg-white px-7 py-8 text-center shadow-[0_16px_40px_rgba(47,47,47,0.04)]"
                    >
                        <div className="text-[44px] font-bold leading-none tracking-[-1.1%] text-[#2F2F2F]">
                            {stat.value}
                        </div>
                        <p className="mx-auto mt-7 max-w-[170px] text-[14px] font-medium leading-[22px] text-[#747474]">
                            {stat.text}
                        </p>
                    </div>
                ))}
            </div>
        </SectionShell>
    );
}

function FeatureCard({
    title,
    text,
    children,
}: {
    title: string;
    text: string;
    children?: React.ReactNode;
}) {
    return (
        <div className="rounded-[22px] border border-[#E9E9E9] bg-white p-7 shadow-[0_16px_40px_rgba(47,47,47,0.04)]">
            <h3 className="text-[20px] font-bold tracking-[-0.5px] text-[#2F2F2F]">{title}</h3>
            <p className="mt-3 text-[14px] font-medium leading-[24px] text-[#747474]">{text}</p>
            {children ? <div className="mt-6">{children}</div> : null}
        </div>
    );
}

function WorkMoreSection() {
    return (
        <SectionShell className="mt-[120px]">
            <div className="text-center">
                <h2 className="text-[30px] font-bold leading-[34px] tracking-[-1.1%] text-[#2F2F2F] md:text-[34px] md:leading-[38px]">
                    Work Alongside Others And
                    <br />
                    Get X2 More Done
                </h2>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
                <FeatureCard
                    title="Built for every kind of person"
                    text="Whether you have ADHD, tend to procrastinate, get distracted easily, feel lonely working alone, or simply work better around people — MySession gives you structure and visible accountability."
                >
                    <CtaButton to="/sessions" dark>
                        Join now
                    </CtaButton>
                </FeatureCard>

                <FeatureCard
                    title="Join focused people already working"
                    text="Enter a live room, set your intention, and work beside people who are also trying to move their day forward. Quiet, simple, and structured."
                >
                    <div className="space-y-3 rounded-[16px] bg-[#F8F8F8] p-4">
                        {[
                            ["Sarah", "Writing client notes", "Live"],
                            ["Justin", "Studying biology", "Focus"],
                            ["Amina", "Building a feature", "Deep work"],
                        ].map(([name, task, tag]) => (
                            <div
                                key={name}
                                className="flex items-center justify-between rounded-[14px] bg-white px-4 py-3"
                            >
                                <div>
                                    <div className="text-[13px] font-bold text-[#2F2F2F]">{name}</div>
                                    <div className="mt-0.5 text-[12px] font-medium text-[#747474]">{task}</div>
                                </div>
                                <div className="rounded-full bg-[rgba(101,212,108,0.20)] px-3 py-1 text-[11px] font-bold text-[#2F2F2F]">
                                    {tag}
                                </div>
                            </div>
                        ))}
                    </div>
                </FeatureCard>

                <FeatureCard
                    title="Built for every kind of work"
                    text="Deep work, studying, design, coding, writing, admin, research, planning, workouts, or just starting the one task you keep avoiding."
                >
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {["Code", "Study", "Design", "Write", "Plan", "Admin"].map((item) => (
                            <div
                                key={item}
                                className="rounded-[14px] bg-[#F8F8F8] px-4 py-4 text-center text-[13px] font-bold text-[#2F2F2F]"
                            >
                                {item}
                            </div>
                        ))}
                    </div>
                </FeatureCard>

                <FeatureCard
                    title="Your session, your rhythm"
                    text="Choose Pomodoro, deep work, short sprints, or a 24/7 infinite room. The format gives the day a container, so your task is easier to start."
                >
                    <div className="rounded-[18px] border border-[#E9E9E9] bg-[#F8F8F8] p-5">
                        <div className="mx-auto flex h-[116px] w-[116px] items-center justify-center rounded-full border-[10px] border-[rgba(101,212,108,0.35)] bg-white">
                            <div className="text-center">
                                <div className="text-[28px] font-bold text-[#2F2F2F]">32:14</div>
                                <div className="text-[11px] font-bold text-[#747474]">focus left</div>
                            </div>
                        </div>
                    </div>
                </FeatureCard>
            </div>
        </SectionShell>
    );
}

function FormatCard({
    icon,
    title,
    text,
    bullets,
}: {
    icon: string;
    title: string;
    text: string;
    bullets: string[];
}) {
    return (
        <div className="rounded-[22px] border border-[#E9E9E9] bg-white p-7 shadow-[0_16px_40px_rgba(47,47,47,0.04)]">
            <div className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-[rgba(101,212,108,0.18)] text-[22px]">
                {icon}
            </div>
            <h3 className="mt-7 text-[20px] font-bold tracking-[-0.5px] text-[#2F2F2F]">
                {title}
            </h3>
            <p className="mt-3 text-[14px] font-medium leading-[24px] text-[#747474]">{text}</p>
            <ul className="mt-6 space-y-3">
                {bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-3 text-[13px] font-medium leading-[22px] text-[#2F2F2F]">
                        <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-[#65D46C]" />
                        <span>{bullet}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function FormatsSection() {
    return (
        <SectionShell className="mt-[122px]">
            <div className="text-center">
                <h2 className="text-[30px] font-bold leading-[34px] tracking-[-1.1%] text-[#2F2F2F] md:text-[34px] md:leading-[38px]">
                    Find The Format That Fits
                    <br />
                    Your Day
                </h2>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
                <FormatCard
                    icon="✅"
                    title="Group sessions"
                    text="Structured live coworking with check-ins and a shared focus container."
                    bullets={["Great for momentum", "Pomodoro and deep work", "Best when you need structure"]}
                />
                <FormatCard
                    icon="🔵"
                    title="24/7 rooms"
                    text="Permanent rooms you can enter anytime without waiting for a scheduled session."
                    bullets={["Always available", "Low-friction start", "Perfect for daily rhythm"]}
                />
                <FormatCard
                    icon="🎧"
                    title="Buddy tripling"
                    text="Small circles for people who want a calmer, more personal accountability format."
                    bullets={["Comfortable and focused", "Good for recurring work", "Easy to build habit"]}
                />
            </div>
        </SectionShell>
    );
}

function CommunitySection() {
    return (
        <SectionShell className="mt-[120px]">
            <div className="overflow-hidden rounded-[34px] border border-[#F4DADA] bg-[linear-gradient(135deg,#FFFFFF_0%,#FFF4F4_100%)] px-7 py-14 text-center md:px-10 md:py-16">
                <div className="mx-auto flex w-max -space-x-3">
                    {["🧑", "👩", "👨", "👩‍💻", "🧑‍🎨", "👨‍🎓", "👩‍🔬", "🧑‍💼"].map((emoji, i) => (
                        <div
                            key={`${emoji}-${i}`}
                            className="flex h-[54px] w-[54px] items-center justify-center rounded-full border-[3px] border-white bg-[#F2F2F2] text-[24px] shadow-sm"
                        >
                            {emoji}
                        </div>
                    ))}
                </div>

                <h2 className="mx-auto mt-10 max-w-[620px] text-[26px] font-bold leading-[32px] tracking-[-1.1%] text-[#2F2F2F] md:text-[32px] md:leading-[38px]">
                    You’re Not Just Joining Sessions. You’re Joining A Community.
                </h2>
                <p className="mx-auto mt-5 max-w-[620px] text-[15px] font-medium leading-[25px] text-[#747474]">
                    Work with students, freelancers, designers, developers, founders, remote workers, and creators — all showing up to make progress together.
                </p>
                <div className="mt-8">
                    <CtaButton to="/sessions" dark>
                        Join a session — it’s free
                    </CtaButton>
                </div>
                <div className="mt-10">
                    <MovingChips items={AUDIENCE_CHIPS} reverse />
                </div>
            </div>
        </SectionShell>
    );
}

function HowItWorksSection() {
    const items = [
        { step: "1", title: "Join a session", text: "Pick a focus room or scheduled session and enter from your browser." },
        { step: "2", title: "Write your task", text: "Set one clear intention, so your next step is visible and concrete." },
        { step: "3", title: "Work alongside others", text: "Stay in the room, follow the flow, and finish more than you would alone." },
    ];

    return (
        <SectionShell className="mt-[120px]">
            <div className="text-center">
                <h2 className="text-[30px] font-bold leading-[34px] tracking-[-1.1%] text-[#2F2F2F] md:text-[34px] md:leading-[38px]">
                    How It Works
                </h2>
            </div>
            <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
                {items.map((item) => (
                    <div
                        key={item.step}
                        className="rounded-[22px] border border-[#E9E9E9] bg-white p-7 shadow-[0_16px_40px_rgba(47,47,47,0.04)]"
                    >
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(101,212,108,0.20)] text-[15px] font-bold text-[#2F2F2F]">
                            {item.step}
                        </div>
                        <h3 className="mt-7 text-[20px] font-bold tracking-[-0.5px] text-[#2F2F2F]">
                            {item.title}
                        </h3>
                        <p className="mt-3 text-[14px] font-medium leading-[24px] text-[#747474]">
                            {item.text}
                        </p>
                    </div>
                ))}
            </div>
        </SectionShell>
    );
}

function FaqSection() {
    return (
        <SectionShell className="mt-[122px] max-w-[880px]">
            <div className="text-center">
                <h2 className="text-[30px] font-bold leading-[34px] tracking-[-1.1%] text-[#2F2F2F] md:text-[34px] md:leading-[38px]">
                    Frequently Asked
                    <br />
                    Questions
                </h2>
            </div>

            <div className="mt-10 overflow-hidden rounded-[22px] border border-[#E9E9E9] bg-white">
                {FAQ_ITEMS.map((item) => (
                    <details key={item.q} className="group border-b border-[#E9E9E9] last:border-b-0">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 text-left text-[15px] font-bold text-[#2F2F2F]">
                            {item.q}
                            <span className="text-[20px] leading-none text-[#747474] transition group-open:rotate-45">
                                +
                            </span>
                        </summary>
                        <p className="px-6 pb-5 text-[14px] font-medium leading-[24px] text-[#747474]">
                            {item.a}
                        </p>
                    </details>
                ))}
            </div>
        </SectionShell>
    );
}

function FinalCta() {
    return (
        <SectionShell className="mt-[120px] pb-[96px]">
            <div className="rounded-[28px] bg-[#2F2F2F] px-7 py-14 text-center shadow-[0_30px_80px_rgba(47,47,47,0.22)] md:px-10 md:py-16">
                <h2 className="mx-auto max-w-[560px] text-[30px] font-bold leading-[36px] tracking-[-1.1%] text-white md:text-[38px] md:leading-[44px]">
                    Ready To Get Things
                    <br />
                    Done, Together?
                </h2>
                <p className="mx-auto mt-4 max-w-[480px] text-[15px] font-medium leading-[25px] text-white/70">
                    Join a live focus session and make the next step easier to start.
                </p>
                <div className="mt-8">
                    <Link
                        to="/sessions"
                        className="inline-flex h-[52px] items-center justify-center rounded-full bg-[#65D46C] px-8 text-[14px] font-bold text-[#2F2F2F] shadow-[0_18px_44px_rgba(101,212,108,0.30)] transition hover:-translate-y-0.5"
                    >
                        Join a session — free
                    </Link>
                </div>
            </div>
        </SectionShell>
    );
}

export default function LandingPage() {
    const heroCopy = useMemo(
        () => (
            <>
                Join{" "}
                <span className="underline decoration-[#2F2F2F]/25 underline-offset-4">
                    live coworking sessions
                </span>
                , work alongside focused people,
                <br className="hidden sm:block" />
                and actually get things done.
            </>
        ),
        []
    );

    return (
        <main className="min-h-screen overflow-hidden bg-[linear-gradient(90deg,#F2FAF2_0%,#F7F8FA_45%,#F1F5FF_100%)] text-[#2F2F2F]">
            <section className="relative mx-auto max-w-[1440px] px-4 pb-[70px] pt-[128px] md:px-8 md:pb-[88px] md:pt-[150px]">
                <div className="mx-auto max-w-[760px] text-center">
                    <h1 className="text-[40px] font-bold leading-[44px] tracking-[-1.1%] text-[#2F2F2F] md:text-[44px] md:leading-[48px]">
                        Do You
                        <br />
                        <RotatingPrompt />
                    </h1>

                    <p className="mx-auto mt-[24px] max-w-[480px] text-[16px] font-medium leading-[24px] tracking-[0px] text-[#747474]">
                        {heroCopy}
                    </p>

                    <div className="mt-[26px] flex justify-center">
                        <CtaButton to="/sessions" dark>
                            Join A Session — It’s Free
                        </CtaButton>
                    </div>
                </div>

                <HeroArtwork />

                <div className="mx-auto mt-[46px] max-w-[1220px] md:mt-[52px]">
                    <MovingChips items={TASK_CHIPS} />
                </div>
            </section>

            <StatCards />
            <WorkMoreSection />
            <FormatsSection />
            <CommunitySection />
            <HowItWorksSection />
            <FaqSection />
            <FinalCta />

            <style>{`
        .landing-chip-track {
          animation: landingChipMove 28s linear infinite;
          will-change: transform;
        }

        .landing-chip-track-reverse {
          animation-direction: reverse;
          animation-duration: 34s;
        }

        @keyframes landingChipMove {
          0% { transform: translateX(0); }
          100% { transform: translateX(-33.333%); }
        }

        @media (max-width: 767px) {
          .landing-chip-track {
            animation-duration: 18s;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .landing-chip-track {
            animation: none !important;
          }
        }
      `}</style>
        </main>
    );
}