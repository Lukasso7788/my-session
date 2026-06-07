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

const COMMUNITY_AVATARS = [
    "/images/landing/community-avatar-1.png",
    "/images/landing/community-avatar-2.png",
    "/images/landing/community-avatar-3.png",
    "/images/landing/community-avatar-4.png",
    "/images/landing/community-avatar-5.png",
    "/images/landing/community-avatar-6.png",
    "/images/landing/community-avatar-7.png",
    "/images/landing/community-avatar-8.png",
    "/images/landing/community-avatar-9.png",
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

function HeroArtwork() {
    return (
        <div className="mx-auto mt-[64px] w-full max-w-[1320px] md:mt-[70px]">
            <div className="hidden md:block">
                <img
                    src="/images/landing/hero-complete-desktop.png"
                    alt="MySession live coworking room preview"
                    className="mx-auto block w-full max-w-[1180px] select-none object-contain"
                    draggable={false}
                />
            </div>

            <div className="block md:hidden">
                <img
                    src="/images/landing/hero-complete-mobile.png"
                    alt="MySession live coworking room preview"
                    className="mx-auto block w-full max-w-[420px] select-none object-contain"
                    draggable={false}
                />
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

function PeoplePanelMockup() {
    const people = [
        { name: "Sofia", role: "Writer", avatar: "/images/landing/community-avatar-1.png", tag: "ADHD", tone: "green" },
        { name: "Jordan", role: "Founder", avatar: "/images/landing/community-avatar-2.png", tag: "Procrastinator", tone: "blue" },
        { name: "Sam", role: "Designer", avatar: "/images/landing/community-avatar-3.png", tag: "Better w/ people", tone: "purple" },
        { name: "Riya", role: "Student", avatar: "/images/landing/community-avatar-4.png", tag: "Easily distracted", tone: "red" },
    ];

    const activity = [
        { avatar: "/images/landing/community-avatar-5.png", name: "Sofia", action: "completed Draft launch email", icon: "◎", time: "just now" },
        { avatar: "/images/landing/community-avatar-6.png", name: "Jordan", action: "started Deep work · 50 min", icon: "◌", time: "1m" },
        { avatar: "/images/landing/community-avatar-7.png", name: "Sam", action: "joined Morning routine room", icon: "□", time: "3m" },
        { avatar: "/images/landing/community-avatar-8.png", name: "Riya", action: "hit a 14-day streak", icon: "♧", time: "5m" },
    ];

    const tagClass: Record<string, string> = {
        green: "bg-[#EAFBEA] text-[#58C85C]",
        blue: "bg-[#EDF3FF] text-[#5286F6]",
        purple: "bg-[#F0EDFF] text-[#7C6CF2]",
        red: "bg-[#FFF0F0] text-[#F65252]",
    };

    return (
        <div className="rounded-[14px] bg-[#F8F8F8] p-[14px]">
            <div className="rounded-[10px] bg-white shadow-[0_6px_20px_rgba(47,47,47,0.04)]">
                <div className="flex h-[38px] items-center justify-between border-b border-[#F1F1F1] px-[14px]">
                    <div className="flex items-center gap-2 text-[10px] font-medium text-[#777]">
                        <span className="text-[13px]">⌕</span>
                        Search people in session
                    </div>
                    <div className="flex items-center gap-1 text-[8px] font-semibold text-[#65D46C]">
                        <span className="h-[4px] w-[4px] rounded-full bg-[#65D46C]" />
                        560 online
                    </div>
                </div>

                <div className="flex gap-[6px] border-b border-[#F1F1F1] px-[14px] py-[9px]">
                    {["All", "ADHD", "Procrastinators", "Introverts"].map((tag, index) => (
                        <span
                            key={tag}
                            className={cx(
                                "rounded-full px-[11px] py-[5px] text-[9px] font-bold",
                                index === 0 ? "bg-[#2F2F2F] text-white" : "bg-[#F1F1F1] text-[#2F2F2F]"
                            )}
                        >
                            {tag}
                        </span>
                    ))}
                </div>

                <div className="px-[14px] py-[8px]">
                    {people.map((person) => (
                        <div key={person.name} className="flex h-[42px] items-center justify-between border-b border-[#F4F4F4] last:border-b-0">
                            <div className="flex items-center gap-[10px]">
                                <img src={person.avatar} alt="" className="h-[24px] w-[24px] rounded-full object-cover" draggable={false} />
                                <div>
                                    <div className="text-[10px] font-bold leading-none text-[#2F2F2F]">{person.name}</div>
                                    <div className="mt-[4px] text-[8px] font-medium leading-none text-[#747474]">{person.role}</div>
                                </div>
                            </div>
                            <span className={cx("rounded-[7px] px-[8px] py-[5px] text-[8px] font-bold", tagClass[person.tone])}>
                                {person.tag}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="mt-[14px] rounded-[10px] bg-white shadow-[0_6px_20px_rgba(47,47,47,0.04)]">
                <div className="flex h-[34px] items-center justify-between border-b border-[#F1F1F1] px-[14px]">
                    <div className="text-[10px] font-bold text-[#747474]">⌁ Happening right now</div>
                    <div className="flex items-center gap-1 text-[8px] font-bold text-[#65D46C]">
                        <span className="h-[4px] w-[4px] rounded-full bg-[#65D46C]" />
                        Live
                    </div>
                </div>

                <div className="px-[14px] py-[8px]">
                    {activity.map((item) => (
                        <div key={`${item.name}-${item.action}`} className="flex h-[34px] items-center justify-between border-b border-[#F4F4F4] last:border-b-0">
                            <div className="flex items-center gap-[9px]">
                                <img src={item.avatar} alt="" className="h-[22px] w-[22px] rounded-full object-cover" draggable={false} />
                                <div className="text-[9px] font-medium text-[#2F2F2F]">
                                    <span className="font-bold">{item.name}</span>{" "}
                                    <span>{item.action}</span>
                                </div>
                            </div>
                            <div className="flex min-w-[48px] items-center justify-end gap-[8px] text-[8px] font-bold text-[#747474]">
                                <span className="text-[#65D46C]">{item.icon}</span>
                                {item.time}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function ActivityRoomsMockup() {
    const rooms = [
        { title: "Deep work", icon: "♧", color: "green", people: "45 in" },
        { title: "Reading", icon: "▣", color: "blue", people: "122 in" },
        { title: "Meditation", icon: "⌘", color: "purple", people: "84 in" },
        { title: "Workout", icon: "⌁", color: "red", people: "67 in" },
        { title: "Morning", icon: "☕", color: "green", people: "103 in" },
        { title: "Wind down", icon: "◔", color: "purple", people: "33 in" },
    ];

    const colorClass: Record<string, string> = {
        green: "bg-[#EAFBEA] text-[#65D46C]",
        blue: "bg-[#EDF3FF] text-[#5286F6]",
        purple: "bg-[#F0EDFF] text-[#7C6CF2]",
        red: "bg-[#FFF0F0] text-[#F65252]",
    };

    return (
        <div className="rounded-[14px] bg-[#F8F8F8] p-[14px]">
            <div className="rounded-[10px] bg-white px-[14px] py-[12px] shadow-[0_6px_20px_rgba(47,47,47,0.04)]">
                <div className="mb-[12px] flex items-center justify-between">
                    <div className="text-[9px] font-bold text-[#2F2F2F]"># Rooms by activity</div>
                    <div className="rounded-full bg-[#F2F2F2] px-[9px] py-[4px] text-[8px] font-bold text-[#2F2F2F]">+ New</div>
                </div>

                <div className="grid grid-cols-3 gap-[8px]">
                    {rooms.map((room) => (
                        <div key={room.title} className="rounded-[10px] bg-[#F8F8F8] px-[14px] py-[14px]">
                            <div className={cx("mb-[12px] flex h-[24px] w-[24px] items-center justify-center rounded-full text-[12px]", colorClass[room.color])}>
                                {room.icon}
                            </div>
                            <div className="text-[10px] font-bold text-[#2F2F2F]">{room.title}</div>
                            <div className="mt-[10px] flex items-center gap-[6px]">
                                <div className="flex -space-x-[5px]">
                                    {[1, 2, 3].map((i) => (
                                        <img
                                            key={i}
                                            src={`/images/landing/community-avatar-${i}.png`}
                                            alt=""
                                            className="h-[16px] w-[16px] rounded-full border border-white object-cover"
                                            draggable={false}
                                        />
                                    ))}
                                </div>
                                <div className="text-[8px] font-medium text-[#747474]">+ {room.people}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function PaceMockup() {
    return (
        <div className="rounded-[14px] bg-[#F8F8F8] p-[14px]">
            <div className="rounded-[10px] bg-white shadow-[0_6px_20px_rgba(47,47,47,0.04)]">
                <div className="flex h-[38px] items-center justify-between border-b border-[#F1F1F1] px-[16px]">
                    <div className="flex items-center gap-[7px] text-[9px] font-bold text-[#2F2F2F]">
                        <span className="h-[5px] w-[5px] rounded-full bg-[#65D46C]" />
                        Quiet focus · 50/10
                    </div>
                    <div className="text-[8px] font-bold text-[#747474]">Round 2 of 4</div>
                </div>

                <div className="flex items-center gap-[34px] px-[34px] py-[42px]">
                    <div className="flex h-[118px] w-[118px] shrink-0 items-center justify-center rounded-full border-[8px] border-[#65D46C]">
                        <div className="text-[32px] font-medium tracking-[1px] text-[#2F2F2F]">32:14</div>
                    </div>

                    <div>
                        <div className="text-[12px] font-medium text-[#747474]">Working on...</div>
                        <div className="mt-[4px] text-[16px] font-bold text-[#2F2F2F]">Outline Q3 roadmap</div>
                        <div className="mt-[12px] flex items-center gap-[10px]">
                            <div className="flex -space-x-[7px]">
                                {[4, 5, 6].map((i) => (
                                    <img
                                        key={i}
                                        src={`/images/landing/community-avatar-${i}.png`}
                                        alt=""
                                        className="h-[24px] w-[24px] rounded-full border border-white object-cover"
                                        draggable={false}
                                    />
                                ))}
                            </div>
                            <span className="text-[9px] font-medium text-[#747474]">+25 working alongside you</span>
                        </div>
                    </div>
                </div>

                <div className="flex h-[38px] items-center justify-between border-t border-[#F1F1F1] px-[16px]">
                    <div className="flex items-center gap-[20px] text-[9px] font-medium text-[#747474]">
                        <span>⌁ Mic off</span>
                        <span>▧ Camera off</span>
                    </div>
                    <div className="text-[9px] font-bold text-[#2F2F2F]">Just show up ↗</div>
                </div>
            </div>
        </div>
    );
}

function WorkMoreSection() {
    return (
        <section className="mt-[118px] bg-[#000000] px-5 py-[90px] md:mt-[130px] md:px-8 md:py-[112px]">
            <div className="mx-auto max-w-[1200px]">
                <div className="text-center">
                    <h2 className="text-[30px] font-bold leading-[38px] tracking-[-0.8px] text-[#252525] md:text-[36px] md:leading-[44px]">
                        Work Alongside Others And
                        <br />
                        Get x2 More Done
                    </h2>
                </div>

                <div className="mt-[46px] grid grid-cols-1 gap-[22px] lg:grid-cols-2">
                    <div className="overflow-hidden rounded-[12px] bg-white px-[42px] py-[40px] lg:col-span-2 lg:min-h-[424px]">
                        <div className="grid h-full grid-cols-1 gap-[34px] lg:grid-cols-[470px_1fr] lg:items-center">
                            <div>
                                <h3 className="text-[24px] font-bold leading-[30px] tracking-[-0.4px] text-[#2F2F2F]">
                                    Built for every kind of person
                                </h3>

                                <p className="mt-[20px] max-w-[430px] text-[16px] font-medium leading-[25px] text-[#747474]">
                                    Whether you have ADHD, tend to procrastinate, get distracted
                                    easily, feel lonely working alone, or simply work better around
                                    people, MySession brings you into a structured community of
                                    people working on things that matter.
                                </p>

                                <div className="mt-[30px]">
                                    <Link
                                        to="/sessions"
                                        className="inline-flex h-[38px] items-center justify-center rounded-full bg-[#2F2F2F] px-[22px] text-[13px] font-bold text-white transition hover:-translate-y-0.5 hover:bg-[#242424]"
                                    >
                                        Join Now
                                    </Link>
                                </div>

                                <div className="mt-[44px] grid max-w-[445px] grid-cols-2 gap-[22px]">
                                    <div className="rounded-[16px] border border-[#EDEDED] bg-white px-[22px] py-[22px]">
                                        <div className="flex items-center justify-between">
                                            <div className="text-[13px] font-medium text-[#747474]">Active today</div>
                                            <div className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-[rgba(101,212,108,0.18)] text-[15px] font-bold text-[#65D46C]">
                                                ↗
                                            </div>
                                        </div>
                                        <div className="mt-[13px] text-[46px] font-medium leading-none tracking-[-1px] text-[#2F2F2F]">
                                            120
                                        </div>
                                        <div className="mt-[16px] text-[14px] font-medium text-[#747474]">
                                            +18% vs last week
                                        </div>
                                    </div>

                                    <div className="rounded-[16px] border border-[#EDEDED] bg-white px-[22px] py-[22px]">
                                        <div className="flex items-center justify-between">
                                            <div className="text-[13px] font-medium text-[#747474]">Sessions ran</div>
                                            <div className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-[rgba(82,134,246,0.18)] text-[15px] font-bold text-[#5286F6]">
                                                ✧
                                            </div>
                                        </div>
                                        <div className="mt-[13px] text-[46px] font-medium leading-none tracking-[-1px] text-[#2F2F2F]">
                                            3.5K
                                        </div>
                                        <div className="mt-[16px] text-[14px] font-medium text-[#747474]">
                                            All time
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <PeoplePanelMockup />
                        </div>
                    </div>

                    <div className="rounded-[12px] bg-white px-[42px] py-[40px]">
                        <h3 className="text-[24px] font-bold leading-[30px] tracking-[-0.4px] text-[#2F2F2F]">
                            Built for every kind of work
                        </h3>

                        <p className="mt-[20px] max-w-[500px] text-[16px] font-medium leading-[25px] text-[#747474]">
                            From deep work and serious projects to morning routines, reading,
                            meditation, and workouts, everyone is here to show up and make
                            progress, whatever that looks like for them.
                        </p>

                        <div className="mt-[32px]">
                            <ActivityRoomsMockup />
                        </div>
                    </div>

                    <div className="rounded-[12px] bg-white px-[42px] py-[40px]">
                        <h3 className="text-[24px] font-bold leading-[30px] tracking-[-0.4px] text-[#2F2F2F]">
                            Your space, your pace
                        </h3>

                        <p className="mt-[20px] max-w-[500px] text-[16px] font-medium leading-[25px] text-[#747474]">
                            Join a session and actually make your plans a reality. Even if you're
                            shy or introverted, you don't need to talk or perform. Just show up
                            and work alongside others.
                        </p>

                        <div className="mt-[32px]">
                            <PaceMockup />
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

function CommunityAvatarArc() {
    const avatars = [
        { x: 0, y: 62, r: -18 },
        { x: 62, y: 34, r: -14 },
        { x: 130, y: 16, r: -9 },
        { x: 202, y: 5, r: -4 },
        { x: 276, y: 0, r: 0 },
        { x: 350, y: 5, r: 4 },
        { x: 422, y: 16, r: 9 },
        { x: 490, y: 34, r: 14 },
        { x: 552, y: 62, r: 18 },
    ];

    return (
        <div className="absolute left-1/2 top-0 z-20 h-[168px] w-[660px] max-w-[94vw] -translate-x-1/2 -translate-y-[82px]">
            {COMMUNITY_AVATARS.map((src, index) => {
                const p = avatars[index];

                return (
                    <div
                        key={src}
                        className="absolute"
                        style={{
                            left: `${p.x}px`,
                            top: `${p.y}px`,
                            transform: `rotate(${p.r}deg)`,
                        }}
                    >
                        <img
                            src={src}
                            alt=""
                            draggable={false}
                            className="h-[104px] w-[104px] rounded-[30px] border-[1px] border-white object-cover shadow-[0_18px_42px_rgba(47,47,47,0.16)] transition-transform duration-300 ease-out hover:-translate-y-3 hover:scale-[1.045]"
                        />
                    </div>
                );
            })}
        </div>
    );
}

function CommunitySection() {
    return (
        <SectionShell className="mt-[155px]">
            <div className="relative overflow-visible rounded-[34px] border border-[#F4DADA] bg-[linear-gradient(135deg,#FFFFFF_0%,#FFF4F4_100%)] px-7 pb-0 pt-[118px] text-center shadow-[0_18px_55px_rgba(47,47,47,0.04)] md:px-10 md:pt-[132px]">
                <CommunityAvatarArc />

                <div className="pointer-events-none absolute left-[6%] top-[9%] h-[230px] w-[230px] rounded-full bg-[rgba(82,134,246,0.14)] blur-[82px]" />
                <div className="pointer-events-none absolute right-[7%] top-[9%] h-[270px] w-[270px] rounded-full bg-[rgba(246,82,82,0.14)] blur-[90px]" />
                <div className="pointer-events-none absolute bottom-[7%] left-[18%] h-[250px] w-[250px] rounded-full bg-[rgba(101,212,108,0.14)] blur-[92px]" />

                <div className="relative z-10">
                    <div className="mx-auto inline-flex h-[44px] items-center gap-2 rounded-full border border-black/10 bg-white/70 px-7 text-[13px] font-bold text-[#2F2F2F] shadow-[0_10px_28px_rgba(47,47,47,0.05)] backdrop-blur">
                        <span className="text-[18px]">⌘</span>
                        Community
                    </div>

                    <h2 className="mx-auto mt-[30px] max-w-[670px] text-[30px] font-bold leading-[37px] tracking-[-1.1%] text-[#2F2F2F] md:text-[34px] md:leading-[42px]">
                        You’re Not Just Joining Sessions. You’re Joining A Community.
                    </h2>

                    <p className="mx-auto mt-[22px] max-w-[630px] text-[15px] font-medium leading-[25px] text-[#747474]">
                        A global community of creators, builders, students, and professionals —
                        all showing up every day to work on things that matter. No pressure, no
                        judgment — just people doing their best work, together.
                    </p>

                    <div className="mt-[34px]">
                        <CtaButton to="/sessions" dark>
                            Join A Session — It’s Free
                        </CtaButton>
                    </div>
                </div>

                <div className="relative z-10 mt-[130px] -mx-7 overflow-hidden pb-[44px] md:-mx-10">
                    <MovingChips items={AUDIENCE_CHIPS} reverse />
                </div>
            </div>
        </SectionShell>
    );
}

function HowItWorksSection() {
    const items = [
        {
            step: "1",
            title: "Join a session",
            text: "Pick a focus room or scheduled session and enter from your browser.",
        },
        {
            step: "2",
            title: "Write your task",
            text: "Set one clear intention, so your next step is visible and concrete.",
        },
        {
            step: "3",
            title: "Work alongside others",
            text: "Stay in the room, follow the flow, and finish more than you would alone.",
        },
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

                    .landing-chip-track span {
                        height: 48px;
                        padding-left: 18px;
                        padding-right: 18px;
                        font-size: 12px;
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