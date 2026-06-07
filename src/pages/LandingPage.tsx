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
        role: "Student",
        avatar: 1,
    },
    {
        quote: "I get more done in one focused session here than I usually do in a whole distracted afternoon alone.",
        name: "Jordan",
        role: "Founder",
        avatar: 2,
    },
    {
        quote: "The structure is simple, calm, and effective. I can join, write my task, and get back into focus fast.",
        name: "Sofia",
        role: "Designer",
        avatar: 3,
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
    return <section className={cx("mx-auto w-full max-w-[1180px] px-5 md:px-8", className)}>{children}</section>;
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
        <span className={cx("inline-flex h-[65px] shrink-0 items-center gap-[8px] rounded-full px-[28px] text-[14px] font-medium leading-none", styles[item.tone] || styles.neutral)}>
            <span className="text-[15px] leading-none">{item.emoji}</span>
            <span className="whitespace-nowrap">{item.label}</span>
        </span>
    );
}

function MovingChips({ items, reverse = false }: { items: Array<{ emoji: string; label: string; tone: string }>; reverse?: boolean }) {
    return (
        <div className="relative overflow-hidden py-1">
            <div className={cx("landing-chip-track flex w-max items-center gap-[10px]", reverse && "landing-chip-track-reverse")}>
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
        <SectionShell className="mt-[104px] md:mt-[118px]">
            <div className="mx-auto grid max-w-[860px] grid-cols-1 gap-[26px] sm:grid-cols-3">
                {STATS.map((stat) => (
                    <div
                        key={stat.value}
                        className="flex min-h-[192px] flex-col items-center justify-center rounded-[16px] border border-[#E9E9E9] bg-white px-8 py-9 text-center shadow-[0_18px_45px_rgba(47,47,47,0.045)]"
                    >
                        <div className="text-[42px] font-bold leading-none tracking-[-0.8px] text-[#2F2F2F] md:text-[46px]">{stat.value}</div>
                        <p className="mx-auto mt-[30px] max-w-[175px] text-[14px] font-medium leading-[22px] text-[#747474]">{stat.text}</p>
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
        <div className="rounded-[14px] bg-[#F8F8F8] p-[14px]">
            <div className="overflow-hidden rounded-[10px] bg-white shadow-[0_8px_24px_rgba(47,47,47,0.04)]">
                <div className="flex h-[40px] items-center justify-between border-b border-[#F0F0F0] px-[14px]">
                    <div className="flex items-center gap-[7px] text-[10px] font-medium text-[#747474]"><span className="text-[13px]">⌕</span>Search people in sessions</div>
                    <div className="flex items-center gap-[5px] text-[8px] font-medium text-[#747474]"><span className="h-[4px] w-[4px] rounded-full bg-[#65D46C]" />560 online</div>
                </div>

                <div className="flex gap-[6px] border-b border-[#F0F0F0] px-[14px] py-[9px]">
                    {["All", "ADHD", "Procrastinators", "Introverts"].map((tag, index) => (
                        <span key={tag} className={cx("rounded-full px-[10px] py-[5px] text-[8px] font-bold", index === 0 ? "bg-[#2F2F2F] text-white" : "bg-[#F1F1F1] text-[#2F2F2F]")}>{tag}</span>
                    ))}
                </div>

                <div className="px-[14px]">
                    {people.map((person) => (
                        <div key={person.name} className="flex h-[42px] items-center justify-between border-b border-[#F4F4F4] last:border-b-0">
                            <div className="flex items-center gap-[9px]">
                                <MiniAvatar index={person.avatar} size={23} />
                                <div>
                                    <div className="text-[10px] font-bold leading-none text-[#2F2F2F]">{person.name}</div>
                                    <div className="mt-[4px] text-[8px] font-medium leading-none text-[#747474]">{person.role}</div>
                                </div>
                            </div>
                            <span className={cx("rounded-[7px] px-[8px] py-[5px] text-[8px] font-bold", tagClass[person.tone])}>{person.tag}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="mt-[14px] overflow-hidden rounded-[10px] bg-white shadow-[0_8px_24px_rgba(47,47,47,0.04)]">
                <div className="flex h-[36px] items-center justify-between border-b border-[#F0F0F0] px-[14px]">
                    <div className="flex items-center gap-[7px] text-[10px] font-bold text-[#747474]"><span>⌁</span>Happening right now</div>
                    <div className="flex items-center gap-[5px] text-[8px] font-medium text-[#747474]"><span className="h-[4px] w-[4px] rounded-full bg-[#65D46C]" />Live</div>
                </div>

                <div className="px-[14px]">
                    {activity.map((item) => (
                        <div key={`${item.name}-${item.text}`} className="flex h-[35px] items-center justify-between border-b border-[#F4F4F4] last:border-b-0">
                            <div className="flex min-w-0 items-center gap-[8px]">
                                <MiniAvatar index={item.avatar} size={21} />
                                <div className="truncate text-[9px] font-medium text-[#2F2F2F]"><span className="font-bold">{item.name}</span> {item.text}</div>
                            </div>
                            <div className="flex min-w-[50px] items-center justify-end gap-[8px] text-[8px] font-medium text-[#747474]">
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
        <div className="rounded-[14px] bg-[#F8F8F8] p-[14px]">
            <div className="rounded-[10px] bg-white px-[14px] py-[12px] shadow-[0_8px_24px_rgba(47,47,47,0.04)]">
                <div className="mb-[12px] flex items-center justify-between">
                    <div className="text-[9px] font-bold text-[#2F2F2F]"># Rooms by activity</div>
                    <div className="rounded-full bg-[#F2F2F2] px-[9px] py-[4px] text-[8px] font-bold text-[#2F2F2F]">+ New</div>
                </div>

                <div className="grid grid-cols-3 gap-[8px]">
                    {rooms.map((room) => (
                        <div key={room.title} className="rounded-[10px] bg-[#F8F8F8] px-[14px] py-[14px]">
                            <div className={cx("mb-[12px] flex h-[24px] w-[24px] items-center justify-center rounded-full text-[12px]", toneClass[room.tone])}>{room.icon}</div>
                            <div className="text-[10px] font-bold text-[#2F2F2F]">{room.title}</div>
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
        <div className="rounded-[14px] bg-[#F8F8F8] p-[14px]">
            <div className="overflow-hidden rounded-[10px] bg-white shadow-[0_8px_24px_rgba(47,47,47,0.04)]">
                <div className="flex h-[38px] items-center justify-between border-b border-[#F0F0F0] px-[16px]">
                    <div className="flex items-center gap-[7px] text-[9px] font-bold text-[#2F2F2F]"><span className="h-[5px] w-[5px] rounded-full bg-[#65D46C]" />Quiet focus · 50/10</div>
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
                            <div className="flex -space-x-[7px]">{[4, 5, 6].map((avatar) => <MiniAvatar key={avatar} index={avatar} size={24} />)}</div>
                            <span className="text-[9px] font-medium text-[#747474]">+25 working alongside you</span>
                        </div>
                    </div>
                </div>

                <div className="flex h-[38px] items-center justify-between border-t border-[#F0F0F0] px-[16px]">
                    <div className="flex items-center gap-[20px] text-[9px] font-medium text-[#747474]"><span>⌁ Mic off</span><span>▧ Camera off</span></div>
                    <div className="text-[9px] font-bold text-[#2F2F2F]">Just show up ↗</div>
                </div>
            </div>
        </div>
    );
}

function WorkMoreSection() {
    return (
        <section className="mt-[118px] bg-[#F7F7F7] px-5 py-[90px] md:mt-[130px] md:px-8 md:py-[112px]">
            <div className="mx-auto max-w-[1200px]">
                <div className="text-center">
                    <h2 className="text-[30px] font-bold leading-[38px] tracking-[-0.8px] text-[#2F2F2F] md:text-[36px] md:leading-[44px]">Work Alongside Others And<br />Get x2 More Done</h2>
                </div>

                <div className="mt-[46px] grid grid-cols-1 gap-[22px] lg:grid-cols-2">
                    <div className="overflow-hidden rounded-[12px] border border-[#E9E9E9] bg-white px-[42px] py-[40px] lg:col-span-2 lg:min-h-[424px]">
                        <div className="grid h-full grid-cols-1 gap-[34px] lg:grid-cols-[470px_1fr] lg:items-center">
                            <div>
                                <h3 className="text-[24px] font-bold leading-[30px] tracking-[-0.4px] text-[#2F2F2F]">Built for every kind of person</h3>
                                <p className="mt-[20px] max-w-[430px] text-[16px] font-medium leading-[25px] text-[#747474]">Whether you have ADHD, tend to procrastinate, get distracted easily, feel lonely working alone, or simply work better around people, MySession brings you into a structured community of people working on things that matter.</p>

                                <div className="mt-[30px]">
                                    <Link to="/sessions" className="inline-flex h-[38px] items-center justify-center rounded-full bg-[#2F2F2F] px-[22px] text-[13px] font-bold text-white transition hover:-translate-y-0.5 hover:bg-[#242424]">Join Now</Link>
                                </div>

                                <div className="mt-[44px] grid max-w-[445px] grid-cols-2 gap-[22px]">
                                    <div className="rounded-[16px] border border-[#EDEDED] bg-white px-[22px] py-[22px]">
                                        <div className="flex items-center justify-between"><div className="text-[13px] font-medium text-[#747474]">Active today</div><div className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-[rgba(101,212,108,0.18)] text-[15px] font-bold text-[#65D46C]">↗</div></div>
                                        <div className="mt-[13px] text-[46px] font-medium leading-none tracking-[-1px] text-[#2F2F2F]">120</div>
                                        <div className="mt-[16px] text-[14px] font-medium text-[#747474]">+18% vs last week</div>
                                    </div>

                                    <div className="rounded-[16px] border border-[#EDEDED] bg-white px-[22px] py-[22px]">
                                        <div className="flex items-center justify-between"><div className="text-[13px] font-medium text-[#747474]">Sessions ran</div><div className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-[rgba(82,134,246,0.18)] text-[15px] font-bold text-[#5286F6]">✧</div></div>
                                        <div className="mt-[13px] text-[46px] font-medium leading-none tracking-[-1px] text-[#2F2F2F]">3.5K</div>
                                        <div className="mt-[16px] text-[14px] font-medium text-[#747474]">All time</div>
                                    </div>
                                </div>
                            </div>
                            <PeoplePanelMockup />
                        </div>
                    </div>

                    <div className="rounded-[12px] border border-[#E9E9E9] bg-white px-[42px] py-[40px]">
                        <h3 className="text-[24px] font-bold leading-[30px] tracking-[-0.4px] text-[#2F2F2F]">Built for every kind of work</h3>
                        <p className="mt-[20px] max-w-[500px] text-[16px] font-medium leading-[25px] text-[#747474]">From deep work and serious projects to morning routines, reading, meditation, and workouts, everyone is here to show up and make progress, whatever that looks like for them.</p>
                        <div className="mt-[32px]"><ActivityRoomsMockup /></div>
                    </div>

                    <div className="rounded-[12px] border border-[#E9E9E9] bg-white px-[42px] py-[40px]">
                        <h3 className="text-[24px] font-bold leading-[30px] tracking-[-0.4px] text-[#2F2F2F]">Your space, your pace</h3>
                        <p className="mt-[20px] max-w-[500px] text-[16px] font-medium leading-[25px] text-[#747474]">Join a session and actually make your plans a reality. Even if you're shy or introverted, you don't need to talk or perform. Just show up and work alongside others.</p>
                        <div className="mt-[32px]"><PaceMockup /></div>
                    </div>
                </div>
            </div>
        </section>
    );
}

function FormatCard({ icon, title, text, bullets }: { icon: string; title: string; text: string; bullets: string[] }) {
    return (
        <div className="rounded-[22px] border border-[#E9E9E9] bg-white p-7 shadow-[0_16px_40px_rgba(47,47,47,0.04)]">
            <div className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-[rgba(101,212,108,0.18)] text-[22px]">{icon}</div>
            <h3 className="mt-7 text-[20px] font-bold tracking-[-0.5px] text-[#2F2F2F]">{title}</h3>
            <p className="mt-3 text-[14px] font-medium leading-[24px] text-[#747474]">{text}</p>
            <ul className="mt-6 space-y-3">{bullets.map((bullet) => <li key={bullet} className="flex gap-3 text-[13px] font-medium leading-[22px] text-[#2F2F2F]"><span className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-[#65D46C]" /><span>{bullet}</span></li>)}</ul>
        </div>
    );
}

function FormatsSection() {
    return (
        <SectionShell className="mt-[122px]">
            <div className="text-center"><h2 className="text-[30px] font-bold leading-[34px] tracking-[-0.8px] text-[#2F2F2F] md:text-[34px] md:leading-[38px]">Find The Format That Fits<br />Your Day</h2></div>
            <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
                <FormatCard icon="✅" title="Group sessions" text="Structured live coworking with check-ins and a shared focus container." bullets={["Standard formats: 50/10, 25/5 Pomodoro", "Custom sprints: 5, 10, 15-min formats", "Verbal check-ins built in"]} />
                <FormatCard icon="🔵" title="24/7 rooms" text="Permanent rooms you can enter anytime without waiting for a scheduled session." bullets={["Great for spontaneous work sessions", "Never wait for a session to start", "Drop in, drop out anytime"]} />
                <FormatCard icon="🎧" title="Buddy tripling" text="Small circles for people who want a calmer, more personal accountability format." bullets={["Screenshare-only sessions available", "Great for recurring sessions and habit building", "Quiet accountability with people you know"]} />
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
        <div className="absolute left-1/2 top-0 z-20 h-[168px] w-[660px] max-w-[94vw] -translate-x-1/2 -translate-y-[82px]">
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

                    <h2 className="mx-auto mt-[30px] max-w-[670px] text-[30px] font-bold leading-[37px] tracking-[-0.8px] text-[#2F2F2F] md:text-[34px] md:leading-[42px]">
                        You’re Not Just Joining Sessions. You’re Joining A Community.
                    </h2>

                    <p className="mx-auto mt-[22px] max-w-[630px] text-[15px] font-medium leading-[25px] text-[#747474]">
                        A global community of creators, builders, students, and professionals — all showing up every day to work on things that matter. No pressure, no judgment — just people doing their best work, together.
                    </p>

                    <div className="mt-[34px]">
                        <CtaButton to="/sessions" dark>Join A Session — It’s Free</CtaButton>
                    </div>
                </div>

                <div className="relative z-10 mt-[130px] -mx-7 overflow-hidden pb-[44px] md:-mx-10">
                    <MovingChips items={AUDIENCE_CHIPS} reverse />
                </div>
            </div>
        </SectionShell>
    );
}

function TestimonialsSection() {
    return (
        <SectionShell className="mt-[118px] max-w-[1220px]">
            <div className="grid grid-cols-1 gap-[34px] md:grid-cols-3">
                {TESTIMONIALS.map((item) => (
                    <article key={item.name} className="min-h-[210px] px-1">
                        <p className="text-[18px] font-bold leading-[30px] tracking-[-0.3px] text-[#2F2F2F] md:text-[19px] md:leading-[31px]">
                            “{item.quote}”
                        </p>

                        <div className="mt-[26px] flex items-center gap-[12px]">
                            <MiniAvatar index={item.avatar} size={34} />
                            <div>
                                <div className="text-[13px] font-bold leading-none text-[#2F2F2F]">{item.name}</div>
                                <div className="mt-[5px] text-[12px] font-medium leading-none text-[#747474]">{item.role}</div>
                            </div>
                        </div>
                    </article>
                ))}
            </div>
        </SectionShell>
    );
}

function HowScheduleMockup() {
    return (
        <div className="rounded-[14px] bg-[#F8F8F8] p-[16px]">
            <div className="overflow-hidden rounded-[12px] bg-white shadow-[0_8px_22px_rgba(47,47,47,0.04)]">
                <div className="flex h-[40px] items-center justify-between border-b border-[#EFEFEF] px-[14px] text-[9px] text-[#747474]">
                    <span>▣ Mic off</span>
                    <span>Mon</span>
                </div>
                {[
                    ["9:00", "#65D46C", "Deep work · 50/10", "Join"],
                    ["9:42", "#5286F6", "Reading room", "33 in"],
                    ["10:12", "#6366F1", "Buddy tripling", "25 in"],
                ].map(([time, color, title, tag]) => (
                    <div key={title} className="flex h-[42px] items-center border-b border-[#F3F3F3] px-[14px] last:border-b-0">
                        <div className="w-[48px] text-[10px] font-medium text-[#2F2F2F]">{time}</div>
                        <span className="mr-[14px] h-[6px] w-[6px] rounded-full" style={{ backgroundColor: color }} />
                        <div className="flex-1 text-[10px] font-bold text-[#2F2F2F]">{title}</div>
                        <div className={cx("rounded-full px-[12px] py-[6px] text-[8px] font-bold", tag === "Join" ? "bg-[#65D46C] text-white" : "text-[#747474]")}>{tag}</div>
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
        <div className="rounded-[14px] bg-[#F8F8F8] p-[16px]">
            <div className="rounded-[12px] bg-white px-[16px] py-[14px] shadow-[0_8px_22px_rgba(47,47,47,0.04)]">
                <div className="mb-[18px] flex items-center justify-between text-[9px] text-[#2F2F2F]">
                    <span>☷ My focus list</span>
                    <span className="rounded-full bg-[#F2F2F2] px-[10px] py-[5px] text-[8px] font-bold">Join</span>
                </div>
                <div className="space-y-[9px]">
                    {items.map((item) => (
                        <div key={item.text} className="flex items-center gap-[9px] text-[10px] font-medium text-[#2F2F2F]">
                            <span className={cx("flex h-[12px] w-[12px] items-center justify-center rounded-full border", item.done ? "border-[#65D46C] bg-[#EAFBEA] text-[8px] text-[#65D46C]" : "border-[#2F2F2F]")}>{item.done ? "✓" : ""}</span>
                            <span className={item.done ? "line-through decoration-[#2F2F2F]/40" : ""}>{item.text}</span>
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
        <div className="rounded-[14px] bg-[#F8F8F8] p-[16px]">
            <div className="rounded-[12px] bg-white px-[16px] py-[16px] shadow-[0_8px_22px_rgba(47,47,47,0.04)]">
                <div className="mb-[16px] text-[10px] font-bold text-[#2F2F2F]">✧ Wins from this session</div>
                <div className="space-y-[12px]">
                    {wins.map((win) => (
                        <div key={win.name} className="flex items-center gap-[10px]">
                            <MiniAvatar index={win.avatar} size={28} />
                            <div>
                                <div className="text-[10px] font-bold leading-none text-[#2F2F2F]">{win.name}</div>
                                <div className="mt-[4px] text-[8px] font-medium text-[#747474]">{win.text}</div>
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
        <SectionShell className="mt-[120px] max-w-[1260px]">
            <div className="text-center">
                <h2 className="text-[34px] font-bold leading-[40px] tracking-[-1px] text-[#2F2F2F] md:text-[40px] md:leading-[46px]">
                    How It Works
                </h2>
            </div>

            <div className="mt-[50px] grid grid-cols-1 gap-[26px] md:grid-cols-3">
                {items.map((item) => (
                    <div key={item.step} className="rounded-[16px] border border-[#E4E4E4] bg-white px-[36px] pb-[18px] pt-[40px] shadow-[0_12px_34px_rgba(47,47,47,0.035)]">
                        <div className="flex h-[40px] w-[40px] items-center justify-center rounded-full bg-[rgba(101,212,108,0.20)] text-[18px] font-bold text-[#39B94A]">
                            {item.step}
                        </div>

                        <h3 className="mt-[34px] text-[22px] font-bold leading-[28px] tracking-[-0.3px] text-[#2F2F2F]">
                            {item.title}
                        </h3>

                        <p className="mt-[18px] min-h-[88px] text-[17px] font-medium leading-[27px] text-[#747474]">
                            {item.text}
                        </p>

                        <div className="mt-[26px]">
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
        <SectionShell className="mt-[122px] max-w-[1180px]">
            <div className="text-center">
                <h2 className="text-[30px] font-bold leading-[34px] tracking-[-0.8px] text-[#2F2F2F] md:text-[34px] md:leading-[38px]">
                    Frequently Asked<br />Questions
                </h2>
            </div>

            <div className="mx-auto mt-10 w-full max-w-[1040px] overflow-hidden rounded-[22px] border border-[#E9E9E9] bg-white">
                {FAQ_ITEMS.map((item) => (
                    <details key={item.q} className="group border-b border-[#E9E9E9] last:border-b-0">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-8 py-5 text-left text-[15px] font-bold text-[#2F2F2F]">
                            {item.q}
                            <span className="text-[20px] leading-none text-[#747474] transition group-open:rotate-45">+</span>
                        </summary>
                        <p className="px-8 pb-5 text-[14px] font-medium leading-[24px] text-[#747474]">{item.a}</p>
                    </details>
                ))}
            </div>
        </SectionShell>
    );
}

function FinalCta() {
    return (
        <section className="mt-[120px] w-full px-4 pb-[96px] md:px-6">
            <div className="mx-auto w-full max-w-[calc(100vw-48px)] rounded-[28px] bg-[#2F2F2F] px-7 py-14 text-center shadow-[0_30px_80px_rgba(47,47,47,0.22)] md:px-10 md:py-16">
                <h2 className="mx-auto max-w-[760px] text-[30px] font-bold leading-[36px] tracking-[-0.8px] text-white md:text-[42px] md:leading-[48px]">
                    Ready To Get Things<br />Done, Together?
                </h2>
                <p className="mx-auto mt-4 max-w-[620px] text-[15px] font-medium leading-[25px] text-white/70">
                    Join a live focus session and make the next step easier to start.
                </p>
                <div className="mt-8">
                    <Link to="/sessions" className="inline-flex h-[52px] items-center justify-center rounded-full bg-[#65D46C] px-8 text-[14px] font-bold text-[#2F2F2F] shadow-[0_18px_44px_rgba(101,212,108,0.30)] transition hover:-translate-y-0.5">
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
            <section className="relative mx-auto max-w-[1440px] px-4 pb-[70px] pt-[128px] md:px-8 md:pb-[88px] md:pt-[150px]">
                <div className="mx-auto max-w-[760px] text-center">
                    <h1 className="text-[40px] font-bold leading-[44px] tracking-[-0.8px] text-[#2F2F2F] md:text-[44px] md:leading-[48px]">
                        Do You<br /><RotatingPrompt />
                    </h1>

                    <p className="mx-auto mt-[24px] max-w-[480px] text-[16px] font-medium leading-[24px] tracking-[0px] text-[#747474]">
                        {heroCopy}
                    </p>

                    <div className="mt-[26px] flex justify-center">
                        <CtaButton to="/sessions" dark>Join A Session — It’s Free</CtaButton>
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
            <TestimonialsSection />
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