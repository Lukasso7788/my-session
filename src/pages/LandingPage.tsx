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

const TESTIMONIALS = [
    {
        quote: "MySession helps me stop overthinking and actually start. It feels like having people quietly working beside me.",
        name: "Anna",
        avatar: 1,
    },
    {
        quote: "I get more done in one focused session here than I usually do in a whole distracted afternoon alone.",
        name: "Jordan",
        avatar: 2,
    },
    {
        quote: "The structure is simple, calm, and effective. I can join, write my task, and get back into focus fast.",
        name: "Sofia",
        avatar: 3,
    },
];

const FORMAT_CARDS = [
    {
        icon: "♙",
        tone: "green",
        title: "Group sessions",
        text: "Join a structured session with others, feel the energy, and get things done. Best for momentum and accountability.",
        bullets: ["Standard formats: 50/10, 25/5 Pomodoro", "Custom sprints: 5, 10, 15-min formats", "Verbal check-ins built in"],
        visual: "session",
    },
    {
        icon: "⇄",
        tone: "blue",
        title: "24/7 Rooms",
        text: "Always open, day or night — drop in whenever you need a focus space and start working.",
        bullets: ["Great for spontaneous work sessions", "Never wait for a session to start", "Drop in, drop out anytime"],
        visual: "rooms",
    },
    {
        icon: "◷",
        tone: "red",
        title: "Buddy Tripling",
        text: "A cozy circle of 3. Personal enough to feel comfortable, structured enough to keep you on track.",
        bullets: ["Screenshare-only sessions available", "Great for recurring sessions and habit building"],
        visual: "buddy",
    },
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

function SectionShell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
    return <section className={cx("mx-auto w-full max-w-[1180px] px-4 sm:px-5 md:px-6 lg:px-8", className)}>{children}</section>;
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
        <span className={cx("inline-block min-h-[1.08em] transition-all duration-200", visible ? "translate-y-0 opacity-100" : "translate-y-[8px] opacity-0")}>
            {ROTATING_LINES[index]}
        </span>
    );
}

function CtaButton({ to, children, dark = false }: { to: string; children: React.ReactNode; dark?: boolean }) {
    return (
        <Link
            to={to}
            className={cx(
                "inline-flex h-[48px] items-center justify-center rounded-full px-6 text-[13px] font-semibold transition duration-200 hover:-translate-y-0.5 sm:h-[52px] sm:px-7 sm:text-[14px]",
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
        <span className={cx("inline-flex h-[48px] shrink-0 items-center gap-[7px] rounded-full px-[18px] text-[12px] font-medium leading-none sm:h-[58px] sm:px-[24px] sm:text-[13px] lg:h-[65px] lg:px-[28px] lg:text-[14px]", styles[item.tone] || styles.neutral)}>
            <span className="text-[14px] leading-none sm:text-[15px]">{item.emoji}</span>
            <span className="whitespace-nowrap">{item.label}</span>
        </span>
    );
}

function MovingChips({ items, reverse = false }: { items: Array<{ emoji: string; label: string; tone: string }>; reverse?: boolean }) {
    return (
        <div className="relative overflow-hidden py-1">
            <div className={cx("landing-chip-track flex w-max items-center gap-[8px] sm:gap-[10px]", reverse && "landing-chip-track-reverse")}>
                {[...items, ...items, ...items].map((item, index) => (
                    <Chip key={`${item.label}-${index}`} item={item} />
                ))}
            </div>
        </div>
    );
}

function HeroArtwork() {
    return (
        <div className="mx-auto mt-[44px] w-full max-w-[1320px] sm:mt-[54px] md:mt-[64px] lg:mt-[70px]">
            <div className="hidden md:block">
                <img src="/images/landing/hero-complete-desktop.png" alt="MySession live coworking room preview" className="mx-auto block w-full max-w-[1180px] select-none object-contain" draggable={false} />
            </div>

            <div className="block md:hidden">
                <img src="/images/landing/hero-complete-mobile.png" alt="MySession live coworking room preview" className="mx-auto block w-full max-w-[420px] select-none object-contain" draggable={false} />
            </div>
        </div>
    );
}

function StatCards() {
    return (
        <SectionShell className="mt-[76px] sm:mt-[92px] lg:mt-[118px]">
            <div className="mx-auto grid max-w-[860px] grid-cols-1 gap-[18px] sm:grid-cols-3 sm:gap-[18px] lg:gap-[26px]">
                {STATS.map((stat) => (
                    <div key={stat.value} className="flex min-h-[150px] flex-col items-center justify-center rounded-[16px] border border-[#E9E9E9] bg-white px-6 py-8 text-center shadow-[0_18px_45px_rgba(47,47,47,0.045)] sm:min-h-[170px] sm:px-5 lg:min-h-[192px] lg:px-8 lg:py-9">
                        <div className="text-[38px] font-bold leading-none tracking-[-0.8px] text-[#2F2F2F] sm:text-[40px] lg:text-[46px]">{stat.value}</div>
                        <p className="mx-auto mt-[22px] max-w-[175px] text-[13px] font-medium leading-[20px] text-[#747474] sm:text-[13px] lg:mt-[30px] lg:text-[14px] lg:leading-[22px]">{stat.text}</p>
                    </div>
                ))}
            </div>
        </SectionShell>
    );
}

function MiniAvatar({ index, size = 22 }: { index: number; size?: number }) {
    return <img src={`/images/landing/community-avatar-${index}.png`} alt="" draggable={false} className="shrink-0 rounded-full border border-white object-cover" style={{ width: size, height: size }} />;
}

function PeoplePanelMockup() {
    const people = [
        { name: "Sofia", role: "Writer", avatar: 1, tag: "ADHD", tone: "green" },
        { name: "Jordan", role: "Founder", avatar: 2, tag: "Procrastinator", tone: "blue" },
        { name: "Sam", role: "Designer", avatar: 3, tag: "Better w/ people", tone: "purple" },
        { name: "Riya", role: "Student", avatar: 4, tag: "Easily distracted", tone: "red" },
    ];

    const activity = [
        { name: "Sofia", avatar: 5, text: "completed Draft launch email", icon: "◎", time: "just now", color: "#65D46C" },
        { name: "Jordan", avatar: 6, text: "started Deep work · 50 min", icon: "◌", time: "1m", color: "#5286F6" },
        { name: "Sam", avatar: 7, text: "joined Morning routine room", icon: "□", time: "3m", color: "#6366F1" },
        { name: "Riya", avatar: 8, text: "hit a 14-day streak", icon: "♧", time: "5m", color: "#F65252" },
    ];

    const tagClass: Record<string, string> = {
        green: "bg-[#EAFBEA] text-[#65C96A]",
        blue: "bg-[#EEF4FF] text-[#5286F6]",
        purple: "bg-[#F1EEFF] text-[#7D6EF6]",
        red: "bg-[#FFF0F0] text-[#F65252]",
    };

    return (
        <div className="w-full rounded-[14px] bg-[#F8F8F8] p-[10px] sm:p-[14px]">
            <div className="overflow-hidden rounded-[10px] bg-white shadow-[0_8px_24px_rgba(47,47,47,0.04)]">
                <div className="flex h-[40px] items-center justify-between border-b border-[#F0F0F0] px-[10px] sm:px-[14px]">
                    <div className="flex min-w-0 items-center gap-[7px] truncate text-[9px] font-medium text-[#747474] sm:text-[10px]"><span className="text-[13px]">⌕</span>Search people in sessions</div>
                    <div className="flex shrink-0 items-center gap-[5px] text-[8px] font-medium text-[#747474]"><span className="h-[4px] w-[4px] rounded-full bg-[#65D46C]" />560 online</div>
                </div>

                <div className="flex gap-[6px] overflow-x-auto border-b border-[#F0F0F0] px-[10px] py-[9px] sm:px-[14px]">
                    {["All", "ADHD", "Procrastinators", "Introverts"].map((tag, index) => (
                        <span key={tag} className={cx("shrink-0 rounded-full px-[9px] py-[5px] text-[8px] font-bold", index === 0 ? "bg-[#2F2F2F] text-white" : "bg-[#F1F1F1] text-[#2F2F2F]")}>{tag}</span>
                    ))}
                </div>

                <div className="px-[10px] sm:px-[14px]">
                    {people.map((person) => (
                        <div key={person.name} className="flex h-[42px] items-center justify-between gap-2 border-b border-[#F4F4F4] last:border-b-0">
                            <div className="flex min-w-0 items-center gap-[9px]">
                                <MiniAvatar index={person.avatar} size={23} />
                                <div className="min-w-0">
                                    <div className="truncate text-[10px] font-bold leading-none text-[#2F2F2F]">{person.name}</div>
                                    <div className="mt-[4px] truncate text-[8px] font-medium leading-none text-[#747474]">{person.role}</div>
                                </div>
                            </div>
                            <span className={cx("shrink-0 rounded-[7px] px-[8px] py-[5px] text-[8px] font-bold", tagClass[person.tone])}>{person.tag}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="mt-[14px] overflow-hidden rounded-[10px] bg-white shadow-[0_8px_24px_rgba(47,47,47,0.04)]">
                <div className="flex h-[36px] items-center justify-between border-b border-[#F0F0F0] px-[10px] sm:px-[14px]">
                    <div className="flex items-center gap-[7px] text-[10px] font-bold text-[#747474]"><span>⌁</span>Happening right now</div>
                    <div className="flex items-center gap-[5px] text-[8px] font-medium text-[#747474]"><span className="h-[4px] w-[4px] rounded-full bg-[#65D46C]" />Live</div>
                </div>

                <div className="px-[10px] sm:px-[14px]">
                    {activity.map((item) => (
                        <div key={`${item.name}-${item.text}`} className="flex h-[35px] items-center justify-between border-b border-[#F4F4F4] last:border-b-0">
                            <div className="flex min-w-0 items-center gap-[8px]">
                                <MiniAvatar index={item.avatar} size={21} />
                                <div className="truncate text-[9px] font-medium text-[#2F2F2F]"><span className="font-bold">{item.name}</span> {item.text}</div>
                            </div>
                            <div className="flex min-w-[44px] items-center justify-end gap-[6px] text-[8px] font-medium text-[#747474]">
                                <span style={{ color: item.color }}>{item.icon}</span>{item.time}
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
        { title: "Deep work", icon: "♧", tone: "green", people: "45 in", avatars: [1, 2, 3] },
        { title: "Reading", icon: "▣", tone: "blue", people: "122 in", avatars: [4, 5, 6] },
        { title: "Meditation", icon: "⌘", tone: "purple", people: "84 in", avatars: [7, 8, 9] },
        { title: "Workout", icon: "⌁", tone: "red", people: "67 in", avatars: [2, 5, 8] },
        { title: "Morning", icon: "☕", tone: "green", people: "103 in", avatars: [1, 6, 9] },
        { title: "Wind down", icon: "◔", tone: "purple", people: "33 in", avatars: [3, 4, 7] },
    ];

    const toneClass: Record<string, string> = {
        green: "bg-[#EAFBEA] text-[#65D46C]",
        blue: "bg-[#EEF4FF] text-[#5286F6]",
        purple: "bg-[#F1EEFF] text-[#7D6EF6]",
        red: "bg-[#FFF0F0] text-[#F65252]",
    };

    return (
        <div className="rounded-[14px] bg-[#F8F8F8] p-[10px] sm:p-[14px]">
            <div className="rounded-[10px] bg-white px-[10px] py-[12px] shadow-[0_8px_24px_rgba(47,47,47,0.04)] sm:px-[14px]">
                <div className="mb-[12px] flex items-center justify-between">
                    <div className="text-[9px] font-bold text-[#2F2F2F]"># Rooms by activity</div>
                    <div className="rounded-full bg-[#F2F2F2] px-[9px] py-[4px] text-[8px] font-bold text-[#2F2F2F]">+ New</div>
                </div>

                <div className="grid grid-cols-2 gap-[8px] sm:grid-cols-3">
                    {rooms.map((room) => (
                        <div key={room.title} className="rounded-[10px] bg-[#F8F8F8] px-[10px] py-[12px] sm:px-[14px] sm:py-[14px]">
                            <div className={cx("mb-[10px] flex h-[24px] w-[24px] items-center justify-center rounded-full text-[12px] sm:mb-[12px]", toneClass[room.tone])}>{room.icon}</div>
                            <div className="truncate text-[10px] font-bold text-[#2F2F2F]">{room.title}</div>
                            <div className="mt-[10px] flex items-center gap-[6px]">
                                <div className="flex -space-x-[5px]">
                                    {room.avatars.map((avatar) => <MiniAvatar key={`${room.title}-${avatar}`} index={avatar} size={16} />)}
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
        <div className="rounded-[14px] bg-[#F8F8F8] p-[10px] sm:p-[14px]">
            <div className="overflow-hidden rounded-[10px] bg-white shadow-[0_8px_24px_rgba(47,47,47,0.04)]">
                <div className="flex h-[38px] items-center justify-between gap-2 border-b border-[#F0F0F0] px-[12px] sm:px-[16px]">
                    <div className="flex min-w-0 items-center gap-[7px] truncate text-[9px] font-bold text-[#2F2F2F]"><span className="h-[5px] w-[5px] shrink-0 rounded-full bg-[#65D46C]" />Quiet focus · 50/10</div>
                    <div className="shrink-0 text-[8px] font-bold text-[#747474]">Round 2 of 4</div>
                </div>

                <div className="flex flex-col items-center gap-[22px] px-[18px] py-[30px] sm:flex-row sm:gap-[28px] sm:px-[24px] lg:gap-[34px] lg:px-[34px] lg:py-[42px]">
                    <div className="flex h-[106px] w-[106px] shrink-0 items-center justify-center rounded-full border-[7px] border-[#65D46C] sm:h-[112px] sm:w-[112px] lg:h-[118px] lg:w-[118px] lg:border-[8px]">
                        <div className="text-[28px] font-medium tracking-[1px] text-[#2F2F2F] lg:text-[32px]">32:14</div>
                    </div>
                    <div className="text-center sm:text-left">
                        <div className="text-[12px] font-medium text-[#747474]">Working on...</div>
                        <div className="mt-[4px] text-[15px] font-bold text-[#2F2F2F] sm:text-[16px]">Outline Q3 roadmap</div>
                        <div className="mt-[12px] flex items-center justify-center gap-[10px] sm:justify-start">
                            <div className="flex -space-x-[7px]">{[4, 5, 6].map((avatar) => <MiniAvatar key={avatar} index={avatar} size={24} />)}</div>
                            <span className="text-[9px] font-medium text-[#747474]">+25 working alongside you</span>
                        </div>
                    </div>
                </div>

                <div className="flex h-auto min-h-[38px] flex-col gap-2 border-t border-[#F0F0F0] px-[12px] py-[10px] sm:flex-row sm:items-center sm:justify-between sm:px-[16px]">
                    <div className="flex items-center gap-[16px] text-[9px] font-medium text-[#747474] sm:gap-[20px]"><span>⌁ Mic off</span><span>▧ Camera off</span></div>
                    <div className="text-[9px] font-bold text-[#2F2F2F]">Just show up ↗</div>
                </div>
            </div>
        </div>
    );
}

function WorkMoreSection() {
    return (
        <section className="mt-[86px] bg-[#F7F7F7] px-4 py-[70px] sm:px-5 sm:py-[82px] lg:mt-[130px] lg:px-8 lg:py-[112px]">
            <div className="mx-auto max-w-[1200px]">
                <div className="text-center">
                    <h2 className="text-[28px] font-bold leading-[34px] tracking-[-0.8px] text-[#2F2F2F] sm:text-[32px] sm:leading-[40px] lg:text-[36px] lg:leading-[44px]">Work Alongside Others And<br />Get x2 More Done</h2>
                </div>

                <div className="mt-[34px] grid grid-cols-1 gap-[18px] lg:mt-[46px] lg:grid-cols-2 lg:gap-[22px]">
                    <div className="overflow-hidden rounded-[12px] border border-[#E9E9E9] bg-white px-5 py-7 sm:px-7 sm:py-8 lg:col-span-2 lg:min-h-[424px] lg:px-[42px] lg:py-[40px]">
                        <div className="grid h-full grid-cols-1 gap-[28px] lg:grid-cols-[470px_1fr] lg:items-center lg:gap-[34px]">
                            <div>
                                <h3 className="text-[22px] font-bold leading-[28px] tracking-[-0.4px] text-[#2F2F2F] lg:text-[24px] lg:leading-[30px]">Built for every kind of person</h3>
                                <p className="mt-[16px] max-w-[520px] text-[15px] font-medium leading-[24px] text-[#747474] lg:mt-[20px] lg:max-w-[430px] lg:text-[16px] lg:leading-[25px]">Whether you have ADHD, tend to procrastinate, get distracted easily, feel lonely working alone, or simply work better around people, MySession brings you into a structured community of people working on things that matter.</p>

                                <div className="mt-[24px] lg:mt-[30px]">
                                    <Link to="/sessions" className="inline-flex h-[38px] items-center justify-center rounded-full bg-[#2F2F2F] px-[22px] text-[13px] font-bold text-white transition hover:-translate-y-0.5 hover:bg-[#242424]">Join Now</Link>
                                </div>

                                <div className="mt-[30px] grid max-w-[445px] grid-cols-1 gap-[14px] xs:grid-cols-2 sm:grid-cols-2 lg:mt-[44px] lg:gap-[22px]">
                                    <div className="rounded-[16px] border border-[#EDEDED] bg-white px-[18px] py-[20px] lg:px-[22px] lg:py-[22px]">
                                        <div className="flex items-center justify-between"><div className="text-[13px] font-medium text-[#747474]">Active today</div><div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[rgba(101,212,108,0.18)] text-[15px] font-bold text-[#65D46C] lg:h-[36px] lg:w-[36px]">↗</div></div>
                                        <div className="mt-[13px] text-[40px] font-medium leading-none tracking-[-1px] text-[#2F2F2F] lg:text-[46px]">120</div>
                                        <div className="mt-[14px] text-[13px] font-medium text-[#747474] lg:mt-[16px] lg:text-[14px]">+18% vs last week</div>
                                    </div>

                                    <div className="rounded-[16px] border border-[#EDEDED] bg-white px-[18px] py-[20px] lg:px-[22px] lg:py-[22px]">
                                        <div className="flex items-center justify-between"><div className="text-[13px] font-medium text-[#747474]">Sessions ran</div><div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[rgba(82,134,246,0.18)] text-[15px] font-bold text-[#5286F6] lg:h-[36px] lg:w-[36px]">✧</div></div>
                                        <div className="mt-[13px] text-[40px] font-medium leading-none tracking-[-1px] text-[#2F2F2F] lg:text-[46px]">3.5K</div>
                                        <div className="mt-[14px] text-[13px] font-medium text-[#747474] lg:mt-[16px] lg:text-[14px]">All time</div>
                                    </div>
                                </div>
                            </div>
                            <PeoplePanelMockup />
                        </div>
                    </div>

                    <div className="rounded-[12px] border border-[#E9E9E9] bg-white px-5 py-7 sm:px-7 sm:py-8 lg:px-[42px] lg:py-[40px]">
                        <h3 className="text-[22px] font-bold leading-[28px] tracking-[-0.4px] text-[#2F2F2F] lg:text-[24px] lg:leading-[30px]">Built for every kind of work</h3>
                        <p className="mt-[16px] max-w-[520px] text-[15px] font-medium leading-[24px] text-[#747474] lg:mt-[20px] lg:text-[16px] lg:leading-[25px]">From deep work and serious projects to morning routines, reading, meditation, and workouts, everyone is here to show up and make progress, whatever that looks like for them.</p>
                        <div className="mt-[24px] lg:mt-[32px]"><ActivityRoomsMockup /></div>
                    </div>

                    <div className="rounded-[12px] border border-[#E9E9E9] bg-white px-5 py-7 sm:px-7 sm:py-8 lg:px-[42px] lg:py-[40px]">
                        <h3 className="text-[22px] font-bold leading-[28px] tracking-[-0.4px] text-[#2F2F2F] lg:text-[24px] lg:leading-[30px]">Your space, your pace</h3>
                        <p className="mt-[16px] max-w-[520px] text-[15px] font-medium leading-[24px] text-[#747474] lg:mt-[20px] lg:text-[16px] lg:leading-[25px]">Join a session and actually make your plans a reality. Even if you're shy or introverted, you don't need to talk or perform. Just show up and work alongside others.</p>
                        <div className="mt-[24px] lg:mt-[32px]"><PaceMockup /></div>
                    </div>
                </div>
            </div>
        </section>
    );
}

function FormatSessionMockup() {
    return (
        <div className="rounded-[12px] bg-[#F7F7F7] p-[10px] sm:p-[14px]">
            <div className="rounded-[12px] bg-white px-[12px] py-[12px] shadow-[0_8px_22px_rgba(47,47,47,0.04)] sm:px-[16px] sm:py-[14px]">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-[7px] truncate text-[7px] font-bold text-[#2F2F2F]">
                        <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-[#65D46C]" />
                        Quiet focus · 50/10
                    </div>
                    <span className="shrink-0 rounded-full bg-[#F2F2F2] px-[8px] py-[5px] text-[7px] font-medium text-[#747474]">50:00</span>
                </div>

                <div className="mt-[15px] flex items-center justify-center">
                    <div className="flex h-[54px] w-[54px] items-center justify-center rounded-full border-[4px] border-[#65D46C] text-[16px] font-medium tracking-[-0.011em] text-[#2F2F2F]">42:18</div>
                </div>

                <div className="mt-[12px] flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center">
                        <div className="flex -space-x-[6px]">
                            {[1, 2, 3].map((avatar) => <MiniAvatar key={avatar} index={avatar} size={22} />)}
                        </div>
                        <span className="ml-[6px] rounded-full bg-[#F2F2F2] px-[7px] py-[4px] text-[7px] font-medium text-[#747474]">+32</span>
                        <span className="ml-[6px] hidden text-[7px] font-medium text-[#747474] xs:inline">Joined session</span>
                    </div>
                    <span className="shrink-0 text-[7px] font-bold text-[#2F2F2F]">Join now ↗</span>
                </div>
            </div>
        </div>
    );
}

function FormatRoomsMockup() {
    const rows = [
        ["#65D46C", "15/3 Short sprints", "65 in"],
        ["#5286F6", "50/10 Deep Work", "18 in"],
        ["#F65252", "25/5 Pomodoro", "33 in"],
    ];

    return (
        <div className="rounded-[12px] bg-[#F7F7F7] p-[10px] sm:p-[14px]">
            <div className="overflow-hidden rounded-[12px] bg-white shadow-[0_8px_22px_rgba(47,47,47,0.04)]">
                {rows.map(([color, title, count]) => (
                    <div key={title} className="flex h-[41px] items-center border-b border-[#EFEFEF] px-[12px] last:border-b-0 sm:px-[18px]">
                        <span className="mr-[10px] h-[6px] w-[6px] shrink-0 rounded-full sm:mr-[14px]" style={{ backgroundColor: color }} />
                        <span className="min-w-0 flex-1 truncate text-[8px] font-bold text-[#2F2F2F]">{title}</span>
                        <span className="mr-[12px] shrink-0 text-[8px] font-medium text-[#747474] sm:mr-[18px]">{count}</span>
                        <span className="shrink-0 text-[10px] text-[#2F2F2F]">›</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function FormatBuddyMockup() {
    return (
        <div className="rounded-[12px] bg-[#F7F7F7] p-[10px] sm:p-[14px]">
            <div className="rounded-[12px] bg-white px-[10px] py-[12px] shadow-[0_8px_22px_rgba(47,47,47,0.04)] sm:px-[14px] sm:py-[14px]">
                <div className="grid grid-cols-4 gap-[6px] sm:gap-[8px]">
                    {[1, 2, 3, 4].map((avatar) => (
                        <div key={avatar} className="flex h-[48px] items-center justify-center rounded-[10px] bg-[#F4F4F4] sm:h-[56px]">
                            <MiniAvatar index={avatar} size={30} />
                        </div>
                    ))}
                </div>

                <div className="mt-[10px] flex h-[30px] items-center justify-between rounded-[8px] bg-[#F4F4F4] px-[10px] sm:px-[12px]">
                    <div className="flex items-center gap-[7px] text-[7px] font-medium text-[#747474]">
                        <span className="h-[6px] w-[6px] rounded-full bg-[#F65252]" />
                        Screenshare on
                    </div>
                    <span className="text-[8px] font-bold text-[#2F2F2F]">1:24:06</span>
                </div>
            </div>
        </div>
    );
}

function FormatVisual({ type }: { type: string }) {
    if (type === "session") return <FormatSessionMockup />;
    if (type === "rooms") return <FormatRoomsMockup />;
    return <FormatBuddyMockup />;
}

function FormatCard({ icon, tone, title, text, bullets, visual }: { icon: string; tone: string; title: string; text: string; bullets: string[]; visual: string }) {
    const toneClass: Record<string, string> = {
        green: "bg-[rgba(101,212,108,0.24)] text-[#39B94A]",
        blue: "bg-[rgba(82,134,246,0.24)] text-[#5286F6]",
        red: "bg-[rgba(246,82,82,0.24)] text-[#F65252]",
    };

    return (
        <div className="rounded-[12px] border border-[#E4E4E4] bg-white px-5 pb-7 pt-6 shadow-[0_12px_34px_rgba(47,47,47,0.025)] sm:px-7 sm:pb-8 sm:pt-7 lg:px-[32px] lg:pb-[38px] lg:pt-[32px]">
            <div className={cx("flex h-[44px] w-[44px] items-center justify-center rounded-[14px] text-[20px] font-bold sm:h-[48px] sm:w-[48px] sm:text-[22px]", toneClass[tone])}>{icon}</div>

            <h3 className="mt-[24px] text-[20px] font-bold leading-[24px] tracking-[-0.011em] text-[#2F2F2F] lg:mt-[27px]">{title}</h3>

            <p className="mt-[14px] min-h-0 max-w-none text-[16px] font-medium leading-[24px] tracking-[-0.011em] text-[#747474] sm:min-h-[72px] lg:mt-[16px] lg:min-h-[96px] lg:max-w-[320px]">{text}</p>

            <div className="mt-[24px] lg:mt-[28px]">
                <FormatVisual type={visual} />
            </div>

            <ul className="mt-[24px] space-y-[4px] pl-[18px] lg:mt-[28px]">
                {bullets.map((bullet) => (
                    <li key={bullet} className="list-disc text-[16px] font-medium leading-[24px] tracking-[-0.011em] text-[#2F2F2F]">
                        {bullet}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function FormatsSection() {
    return (
        <SectionShell className="mt-[86px] max-w-[1120px] sm:mt-[104px] lg:mt-[122px]">
            <div className="text-center">
                <h2 className="mx-auto max-w-[494px] text-[30px] font-bold leading-[36px] tracking-[-0.011em] text-[#2F2F2F] sm:text-[34px] sm:leading-[40px] lg:text-[38px] lg:leading-[46px]">
                    Find The Format That Fits<br />Your Day
                </h2>
            </div>

            <div className="mt-[34px] grid grid-cols-1 gap-[18px] sm:mt-[44px] lg:mt-[58px] lg:grid-cols-3 lg:gap-[22px]">
                {FORMAT_CARDS.map((card) => (
                    <FormatCard key={card.title} icon={card.icon} tone={card.tone} title={card.title} text={card.text} bullets={card.bullets} visual={card.visual} />
                ))}
            </div>
        </SectionShell>
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
        <div className="absolute left-1/2 top-0 z-20 h-[112px] w-[430px] max-w-[94vw] -translate-x-1/2 -translate-y-[56px] scale-[0.64] sm:h-[140px] sm:w-[560px] sm:-translate-y-[70px] sm:scale-[0.82] lg:h-[168px] lg:w-[660px] lg:-translate-y-[82px] lg:scale-100">
            {COMMUNITY_AVATARS.map((src, index) => {
                const p = avatars[index];

                return (
                    <div key={src} className="absolute" style={{ left: `${p.x}px`, top: `${p.y}px`, transform: `rotate(${p.r}deg)` }}>
                        <img src={src} alt="" draggable={false} className="h-[104px] w-[104px] rounded-[30px] border-[1px] border-white object-cover shadow-[0_18px_42px_rgba(47,47,47,0.16)] transition-transform duration-300 ease-out hover:-translate-y-3 hover:scale-[1.045]" />
                    </div>
                );
            })}
        </div>
    );
}

function CommunitySection() {
    return (
        <SectionShell className="mt-[118px] sm:mt-[138px] lg:mt-[155px]">
            <div className="relative overflow-visible rounded-[24px] border border-[#F4DADA] bg-[linear-gradient(135deg,#FFFFFF_0%,#FFF4F4_100%)] px-4 pb-0 pt-[82px] text-center shadow-[0_18px_55px_rgba(47,47,47,0.04)] sm:rounded-[30px] sm:px-7 sm:pt-[104px] lg:rounded-[34px] lg:px-10 lg:pt-[132px]">
                <CommunityAvatarArc />

                <div className="pointer-events-none absolute left-[6%] top-[9%] h-[180px] w-[180px] rounded-full bg-[rgba(82,134,246,0.14)] blur-[72px] lg:h-[230px] lg:w-[230px] lg:blur-[82px]" />
                <div className="pointer-events-none absolute right-[7%] top-[9%] h-[200px] w-[200px] rounded-full bg-[rgba(246,82,82,0.14)] blur-[78px] lg:h-[270px] lg:w-[270px] lg:blur-[90px]" />
                <div className="pointer-events-none absolute bottom-[7%] left-[18%] h-[190px] w-[190px] rounded-full bg-[rgba(101,212,108,0.14)] blur-[78px] lg:h-[250px] lg:w-[250px] lg:blur-[92px]" />

                <div className="relative z-10">
                    <div className="mx-auto inline-flex h-[40px] items-center gap-2 rounded-full border border-black/10 bg-white/70 px-5 text-[12px] font-bold text-[#2F2F2F] shadow-[0_10px_28px_rgba(47,47,47,0.05)] backdrop-blur sm:h-[44px] sm:px-7 sm:text-[13px]">
                        <span className="text-[17px] sm:text-[18px]">⌘</span>
                        Community
                    </div>

                    <h2 className="mx-auto mt-[24px] max-w-[670px] text-[26px] font-bold leading-[32px] tracking-[-0.8px] text-[#2F2F2F] sm:text-[30px] sm:leading-[37px] lg:mt-[30px] lg:text-[34px] lg:leading-[42px]">
                        You’re Not Just Joining Sessions. You’re Joining A Community.
                    </h2>

                    <p className="mx-auto mt-[18px] max-w-[630px] text-[14px] font-medium leading-[23px] text-[#747474] sm:text-[15px] sm:leading-[25px] lg:mt-[22px]">
                        A global community of creators, builders, students, and professionals — all showing up every day to work on things that matter. No pressure, no judgment — just people doing their best work, together.
                    </p>

                    <div className="mt-[28px] lg:mt-[34px]">
                        <CtaButton to="/sessions" dark>Join A Session — It’s Free</CtaButton>
                    </div>
                </div>

                <div className="relative z-10 mt-[82px] -mx-4 overflow-hidden pb-[32px] sm:-mx-7 sm:mt-[104px] lg:-mx-10 lg:mt-[130px] lg:pb-[44px]">
                    <MovingChips items={AUDIENCE_CHIPS} reverse />
                </div>
            </div>
        </SectionShell>
    );
}

function TestimonialsSection() {
    return (
        <SectionShell className="mt-[78px] max-w-[1220px] sm:mt-[96px] lg:mt-[118px]">
            <div className="grid grid-cols-1 gap-[30px] sm:grid-cols-2 lg:grid-cols-3 lg:gap-[34px]">
                {TESTIMONIALS.map((item) => (
                    <article key={item.name} className="min-h-0 px-1 lg:min-h-[210px]">
                        <p className="text-[16px] font-medium leading-[24px] tracking-[-0.011em] text-[#2F2F2F]">
                            “{item.quote}”
                        </p>

                        <div className="mt-[22px] flex items-center gap-[12px] lg:mt-[26px]">
                            <MiniAvatar index={item.avatar} size={44} />
                            <div className="text-[16px] font-medium leading-[24px] tracking-[-0.011em] text-[#747474]">{item.name}</div>
                        </div>
                    </article>
                ))}
            </div>
        </SectionShell>
    );
}

function HowScheduleMockup() {
    return (
        <div className="rounded-[14px] bg-[#F8F8F8] p-[12px] sm:p-[16px]">
            <div className="overflow-hidden rounded-[12px] bg-white shadow-[0_8px_22px_rgba(47,47,47,0.04)]">
                <div className="flex h-[40px] items-center justify-between border-b border-[#EFEFEF] px-[12px] text-[9px] text-[#747474] sm:px-[14px]">
                    <span>▣ Mic off</span>
                    <span>Mon</span>
                </div>
                {[
                    ["9:00", "#65D46C", "Deep work · 50/10", "Join"],
                    ["9:42", "#5286F6", "Reading room", "33 in"],
                    ["10:12", "#6366F1", "Buddy tripling", "25 in"],
                ].map(([time, color, title, tag]) => (
                    <div key={title} className="flex h-[42px] items-center border-b border-[#F3F3F3] px-[12px] last:border-b-0 sm:px-[14px]">
                        <div className="w-[42px] text-[10px] font-medium text-[#2F2F2F] sm:w-[48px]">{time}</div>
                        <span className="mr-[10px] h-[6px] w-[6px] rounded-full sm:mr-[14px]" style={{ backgroundColor: color }} />
                        <div className="min-w-0 flex-1 truncate text-[10px] font-bold text-[#2F2F2F]">{title}</div>
                        <div className={cx("shrink-0 rounded-full px-[10px] py-[6px] text-[8px] font-bold sm:px-[12px]", tag === "Join" ? "bg-[#65D46C] text-white" : "text-[#747474]")}>{tag}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function HowFocusListMockup() {
    const items = [
        { text: "Reviewing and refactoring code", done: true },
        { text: "Studying for finals and organizing notes", done: true },
        { text: "Writing a blog post about productivity", done: false },
        { text: "Improving my portfolio and case studies", done: false },
        { text: "Planning my week and priorities", done: false },
    ];

    return (
        <div className="rounded-[14px] bg-[#F8F8F8] p-[12px] sm:p-[16px]">
            <div className="rounded-[12px] bg-white px-[14px] py-[14px] shadow-[0_8px_22px_rgba(47,47,47,0.04)] sm:px-[16px]">
                <div className="mb-[18px] flex items-center justify-between text-[9px] text-[#2F2F2F]">
                    <span>☷ My focus list</span>
                    <span className="rounded-full bg-[#F2F2F2] px-[10px] py-[5px] text-[8px] font-bold">Join</span>
                </div>
                <div className="space-y-[9px]">
                    {items.map((item) => (
                        <div key={item.text} className="flex items-center gap-[9px] text-[10px] font-medium text-[#2F2F2F]">
                            <span className={cx("flex h-[12px] w-[12px] shrink-0 items-center justify-center rounded-full border", item.done ? "border-[#65D46C] bg-[#EAFBEA] text-[8px] text-[#65D46C]" : "border-[#2F2F2F]")}>{item.done ? "✓" : ""}</span>
                            <span className={cx("min-w-0 truncate", item.done ? "line-through decoration-[#2F2F2F]/40" : "")}>{item.text}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function HowWinsMockup() {
    const wins = [
        { name: "Anna", text: "Completed updating resume and cover letter 🎉", avatar: 1 },
        { name: "Alexander", text: "Wrapped up editing a short video project", avatar: 3 },
        { name: "Khusanov", text: "Completed drafting ideas for my next project", avatar: 6 },
    ];

    return (
        <div className="rounded-[14px] bg-[#F8F8F8] p-[12px] sm:p-[16px]">
            <div className="rounded-[12px] bg-white px-[14px] py-[16px] shadow-[0_8px_22px_rgba(47,47,47,0.04)] sm:px-[16px]">
                <div className="mb-[16px] text-[10px] font-bold text-[#2F2F2F]">✧ Wins from this session</div>
                <div className="space-y-[12px]">
                    {wins.map((win) => (
                        <div key={win.name} className="flex items-center gap-[10px]">
                            <MiniAvatar index={win.avatar} size={28} />
                            <div className="min-w-0">
                                <div className="text-[10px] font-bold leading-none text-[#2F2F2F]">{win.name}</div>
                                <div className="mt-[4px] truncate text-[8px] font-medium text-[#747474]">{win.text}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function HowItWorksSection() {
    const items = [
        {
            step: "1",
            title: "Join a session",
            text: "Choose what fits your day — a group session, a 24/7 room, or a cozy circle of 3 people. Jump right in.",
            visual: <HowScheduleMockup />,
        },
        {
            step: "2",
            title: "Work alongside others",
            text: "Write down what you want to finish and let the energy of the room do the rest. Silent, structured, and distraction-free.",
            visual: <HowFocusListMockup />,
        },
        {
            step: "3",
            title: "Finish and share wins",
            text: "Session done — share what you got done, celebrate your wins, and leave feeling accomplished.",
            visual: <HowWinsMockup />,
        },
    ];

    return (
        <SectionShell className="mt-[86px] max-w-[1260px] sm:mt-[104px] lg:mt-[120px]">
            <div className="text-center">
                <h2 className="text-[30px] font-bold leading-[36px] tracking-[-1px] text-[#2F2F2F] sm:text-[34px] sm:leading-[40px] lg:text-[40px] lg:leading-[46px]">
                    How It Works
                </h2>
            </div>

            <div className="mt-[34px] grid grid-cols-1 gap-[18px] sm:mt-[42px] sm:grid-cols-2 lg:mt-[50px] lg:grid-cols-3 lg:gap-[26px]">
                {items.map((item) => (
                    <div key={item.step} className="rounded-[16px] border border-[#E4E4E4] bg-white px-5 pb-5 pt-7 shadow-[0_12px_34px_rgba(47,47,47,0.035)] sm:px-6 sm:pb-5 sm:pt-8 lg:px-[36px] lg:pb-[18px] lg:pt-[40px]">
                        <div className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-[rgba(101,212,108,0.20)] text-[16px] font-bold text-[#39B94A] lg:h-[40px] lg:w-[40px] lg:text-[18px]">
                            {item.step}
                        </div>

                        <h3 className="mt-[24px] text-[20px] font-bold leading-[26px] tracking-[-0.3px] text-[#2F2F2F] lg:mt-[34px] lg:text-[22px] lg:leading-[28px]">
                            {item.title}
                        </h3>

                        <p className="mt-[14px] min-h-0 text-[15px] font-medium leading-[24px] text-[#747474] lg:mt-[18px] lg:min-h-[88px] lg:text-[17px] lg:leading-[27px]">
                            {item.text}
                        </p>

                        <div className="mt-[22px] lg:mt-[26px]">
                            {item.visual}
                        </div>
                    </div>
                ))}
            </div>
        </SectionShell>
    );
}

function FaqSection() {
    return (
        <SectionShell className="mt-[86px] max-w-[1180px] sm:mt-[104px] lg:mt-[122px]">
            <div className="text-center">
                <h2 className="text-[30px] font-bold leading-[34px] tracking-[-0.8px] text-[#2F2F2F] md:text-[34px] md:leading-[38px]">
                    Frequently Asked<br />Questions
                </h2>
            </div>

            <div className="mx-auto mt-8 w-full max-w-[1040px] overflow-hidden rounded-[18px] border border-[#E9E9E9] bg-white sm:mt-10 sm:rounded-[22px]">
                {FAQ_ITEMS.map((item) => (
                    <details key={item.q} className="group border-b border-[#E9E9E9] last:border-b-0">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 text-left text-[14px] font-bold text-[#2F2F2F] sm:px-8 sm:text-[15px]">
                            {item.q}
                            <span className="text-[20px] leading-none text-[#747474] transition group-open:rotate-45">+</span>
                        </summary>
                        <p className="px-5 pb-5 text-[14px] font-medium leading-[24px] text-[#747474] sm:px-8">{item.a}</p>
                    </details>
                ))}
            </div>
        </SectionShell>
    );
}

function FinalCta() {
    return (
        <section className="mt-[86px] w-full px-4 pb-[72px] sm:mt-[104px] sm:px-5 lg:mt-[120px] lg:px-6 lg:pb-[96px]">
            <div className="mx-auto w-full rounded-[22px] bg-[#2F2F2F] px-5 py-12 text-center shadow-[0_30px_80px_rgba(47,47,47,0.22)] sm:rounded-[26px] sm:px-7 sm:py-14 lg:max-w-[calc(100vw-48px)] lg:rounded-[28px] lg:px-10 lg:py-16">
                <h2 className="mx-auto max-w-[760px] text-[30px] font-bold leading-[36px] tracking-[-0.8px] text-white sm:text-[36px] sm:leading-[42px] lg:text-[42px] lg:leading-[48px]">
                    Ready To Get Things<br />Done, Together?
                </h2>
                <p className="mx-auto mt-4 max-w-[620px] text-[14px] font-medium leading-[24px] text-white/70 sm:text-[15px] sm:leading-[25px]">
                    Join a live focus session and make the next step easier to start.
                </p>
                <div className="mt-8">
                    <Link to="/sessions" className="inline-flex h-[50px] items-center justify-center rounded-full bg-[#65D46C] px-7 text-[14px] font-bold text-[#2F2F2F] shadow-[0_18px_44px_rgba(101,212,108,0.30)] transition hover:-translate-y-0.5 sm:h-[52px] sm:px-8">
                        Join a session — free
                    </Link>
                </div>
            </div>
        </section>
    );
}

export default function LandingPage() {
    const heroCopy = useMemo(
        () => (
            <>
                Join{" "}
                <span className="underline decoration-[#2F2F2F]/25 underline-offset-4">live coworking sessions</span>
                , work alongside focused people,
                <br className="hidden sm:block" />
                and actually get things done.
            </>
        ),
        []
    );

    return (
        <main className="min-h-screen overflow-hidden bg-[linear-gradient(90deg,#F2FAF2_0%,#F7F8FA_45%,#F1F5FF_100%)] text-[#2F2F2F]">
            <section className="relative mx-auto max-w-[1440px] px-4 pb-[54px] pt-[92px] sm:px-5 sm:pb-[64px] sm:pt-[112px] md:px-6 md:pb-[78px] md:pt-[132px] lg:px-8 lg:pb-[88px] lg:pt-[150px]">
                <div className="mx-auto max-w-[760px] text-center">
                    <h1 className="text-[34px] font-bold leading-[38px] tracking-[-0.8px] text-[#2F2F2F] sm:text-[38px] sm:leading-[42px] md:text-[42px] md:leading-[46px] lg:text-[44px] lg:leading-[48px]">
                        Do You<br /><RotatingPrompt />
                    </h1>

                    <p className="mx-auto mt-[20px] max-w-[480px] text-[14px] font-medium leading-[22px] tracking-[0px] text-[#747474] sm:mt-[24px] sm:text-[16px] sm:leading-[24px]">
                        {heroCopy}
                    </p>

                    <div className="mt-[24px] flex justify-center sm:mt-[26px]">
                        <CtaButton to="/sessions" dark>Join A Session — It’s Free</CtaButton>
                    </div>
                </div>

                <HeroArtwork />

                <div className="mx-auto mt-[34px] max-w-[1220px] sm:mt-[42px] md:mt-[48px] lg:mt-[52px]">
                    <MovingChips items={TASK_CHIPS} />
                </div>
            </section>

            <StatCards />
            <WorkMoreSection />
            <FormatsSection />
            <CommunitySection />
            <TestimonialsSection />
            <HowItWorksSection />
            <FaqSection />
            <FinalCta />

            <style>{`
                @media (min-width: 360px) {
                    .xs\\:grid-cols-2 {
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                    }

                    .xs\\:inline {
                        display: inline;
                    }
                }

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

                @media (max-width: 1023px) {
                    .landing-chip-track {
                        animation-duration: 20s;
                    }
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