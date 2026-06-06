// src/pages/LandingPage.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const ROTATING_LINES = [
    "struggle to get started?",
    "lose focus easily?",
    "keep putting things off?",
    "get distracted at home?",
    "work better around other people?",
];

const TASK_CHIPS = [
    "Creating digital art",
    "Studying for my exams",
    "Building a mobile app",
    "Planning my week",
    "Writing emails",
    "Editing video",
    "Designing UI",
    "Reading papers",
    "Coding features",
    "Cleaning my inbox",
];

const AUDIENCE_CHIPS = [
    "Students",
    "Freelancers",
    "Designers",
    "Developers",
    "Video editors",
    "Founders",
    "Remote workers",
    "Creators",
    "Writers",
    "Researchers",
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

function RotatingPrompt() {
    const [index, setIndex] = useState(0);
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setVisible(false);
            window.setTimeout(() => {
                setIndex((prev) => (prev + 1) % ROTATING_LINES.length);
                setVisible(true);
            }, 180);
        }, 2300);

        return () => window.clearInterval(timer);
    }, []);

    return (
        <span
            className={cx(
                "inline-block transition-all duration-200",
                visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
            )}
        >
            {ROTATING_LINES[index]}
        </span>
    );
}

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "green" | "blue" | "red" | "purple" | "neutral" }) {
    const cls =
        tone === "green"
            ? "bg-[#DDF7E3] text-[#227A36] border-[#C7EED0]"
            : tone === "blue"
                ? "bg-[#E3ECFF] text-[#315FD5] border-[#D1E0FF]"
                : tone === "red"
                    ? "bg-[#FFE2E2] text-[#B54343] border-[#FFD0D0]"
                    : tone === "purple"
                        ? "bg-[#EAE6FF] text-[#6547C7] border-[#DCD5FF]"
                        : "bg-[#ECEDEF] text-[#55585E] border-[#DCDDDF]";

    return (
        <span className={cx("inline-flex items-center rounded-full border px-4 py-2 text-[13px] font-semibold shadow-sm", cls)}>
            {children}
        </span>
    );
}

function CtaButton({ to, children, dark = false }: { to: string; children: React.ReactNode; dark?: boolean }) {
    return (
        <Link
            to={to}
            className={cx(
                "inline-flex items-center justify-center rounded-full px-6 py-3 text-[14px] font-bold transition hover:-translate-y-0.5",
                dark
                    ? "bg-[#2F2F2F] text-white shadow-[0_10px_25px_rgba(0,0,0,0.18)] hover:bg-black"
                    : "border border-[#D9D9D9] bg-white text-[#2F2F2F] hover:bg-[#F7F7F7]"
            )}
        >
            {children}
        </Link>
    );
}

function VideoTile({ name, emoji, tone }: { name: string; emoji: string; tone: "green" | "blue" | "red" | "neutral" }) {
    const bg =
        tone === "green"
            ? "from-[#DBF8DF] to-[#F7FFF8]"
            : tone === "blue"
                ? "from-[#DDE9FF] to-[#F8FBFF]"
                : tone === "red"
                    ? "from-[#FFE1E1] to-[#FFF8F8]"
                    : "from-[#ECEEF2] to-[#FAFAFA]";

    return (
        <div className={cx("relative h-[108px] overflow-hidden rounded-[14px] bg-gradient-to-br p-3", bg)}>
            <div className="absolute left-3 top-3 rounded-full bg-white/80 px-2 py-1 text-[10px] font-bold text-[#444]">● Focus</div>
            <div className="flex h-full items-center justify-center text-[34px]">{emoji}</div>
            <div className="absolute bottom-2 left-2 rounded-full bg-white/85 px-2 py-1 text-[11px] font-bold text-[#333]">{name}</div>
        </div>
    );
}

function HeroMockup() {
    return (
        <div className="relative mx-auto mt-10 w-full max-w-[780px]">
            <div className="absolute -left-14 top-7 hidden w-[125px] rounded-[18px] border border-[#DCEFE0] bg-white p-3 shadow-sm lg:block">
                <div className="text-[11px] font-bold text-[#2F2F2F]">Yaro</div>
                <div className="mt-1 text-[10px] leading-4 text-[#707070]">Shipping the next task.</div>
                <div className="mt-2 h-2 w-14 rounded-full bg-[#65D46C]" />
            </div>

            <div className="absolute -right-14 top-12 hidden w-[125px] rounded-[18px] border border-[#DCEFE0] bg-white p-3 shadow-sm lg:block">
                <div className="text-[11px] font-bold text-[#2F2F2F]">Ana</div>
                <div className="mt-1 text-[10px] leading-4 text-[#707070]">Studying for exams.</div>
                <div className="mt-2 h-2 w-16 rounded-full bg-[#5286F6]" />
            </div>

            <div className="rounded-[26px] border border-[#DFE4E8] bg-white p-3 shadow-[0_18px_70px_rgba(30,35,45,0.10)]">
                <div className="mb-3 flex items-center justify-between rounded-[18px] bg-[#F8FAFB] px-4 py-3">
                    <div>
                        <div className="text-[13px] font-bold text-[#2F2F2F]">25/5 Pomodoro room</div>
                        <div className="text-[11px] text-[#777]">Live now · Silent coworking</div>
                    </div>
                    <div className="rounded-full bg-[#65D46C]/20 px-3 py-1 text-[11px] font-bold text-[#2E8B45]">8 online</div>
                </div>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    <VideoTile name="Maya" emoji="🎧" tone="green" />
                    <VideoTile name="Justin" emoji="💻" tone="blue" />
                    <VideoTile name="Sara" emoji="📚" tone="red" />
                    <VideoTile name="Leo" emoji="✍️" tone="neutral" />
                    <VideoTile name="Nina" emoji="🎨" tone="blue" />
                    <VideoTile name="You" emoji="🚀" tone="green" />
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_150px]">
                    <div className="rounded-[18px] border border-[#E8ECEF] bg-[#FAFBFC] p-4">
                        <div className="text-[12px] font-bold text-[#2F2F2F]">Current intention</div>
                        <div className="mt-2 text-[12px] leading-5 text-[#666]">Finish one clear task before the next break.</div>
                    </div>
                    <div className="flex items-center justify-center rounded-[18px] border border-[#E8ECEF] bg-[#FAFBFC]">
                        <div className="text-center">
                            <div className="text-[26px] font-black text-[#2F2F2F]">23:41</div>
                            <div className="text-[11px] font-semibold text-[#777]">focus left</div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="absolute -bottom-8 left-8 hidden w-[125px] rounded-[18px] border border-[#DCEFE0] bg-white p-3 shadow-sm lg:block">
                <div className="text-[11px] font-bold text-[#2F2F2F]">Goal</div>
                <div className="mt-1 text-[10px] leading-4 text-[#707070]">One finished step.</div>
            </div>

            <div className="absolute -bottom-6 right-10 hidden w-[125px] rounded-[18px] border border-[#DCEFE0] bg-white p-3 shadow-sm lg:block">
                <div className="text-[11px] font-bold text-[#2F2F2F]">Check-in</div>
                <div className="mt-1 text-[10px] leading-4 text-[#707070]">Share progress fast.</div>
            </div>
        </div>
    );
}

function MovingChips({ items, reverse = false }: { items: string[]; reverse?: boolean }) {
    const tones: Array<"green" | "blue" | "red" | "purple" | "neutral"> = ["green", "blue", "red", "purple", "neutral"];

    return (
        <div className="overflow-hidden py-2">
            <div className={cx("landing-chip-track flex w-max gap-3", reverse && "landing-chip-track-reverse")}>
                {[...items, ...items].map((item, index) => (
                    <Pill key={`${item}-${index}`} tone={tones[index % tones.length]}>{item}</Pill>
                ))}
            </div>
        </div>
    );
}

function StatCard({ value, label }: { value: string; label: string }) {
    return (
        <div className="rounded-[14px] border border-[#ECECEC] bg-white px-8 py-8 text-center shadow-sm">
            <div className="text-[34px] font-black tracking-tight text-[#2F2F2F]">{value}</div>
            <div className="mt-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#777]">{label}</div>
        </div>
    );
}

function FeatureCard({ title, body, visual, cta }: { title: string; body: string; visual: React.ReactNode; cta?: string }) {
    return (
        <div className="rounded-[22px] border border-[#E9E9E9] bg-white p-6 shadow-sm">
            <h3 className="text-[18px] font-black text-[#2F2F2F]">{title}</h3>
            <p className="mt-3 text-[14px] leading-6 text-[#666]">{body}</p>
            {cta && <Link to="/sessions" className="mt-5 inline-flex rounded-full bg-[#2F2F2F] px-4 py-2 text-[12px] font-bold text-white">{cta}</Link>}
            <div className="mt-5">{visual}</div>
        </div>
    );
}

function MiniSessionList() {
    return (
        <div className="space-y-2 rounded-[18px] border border-[#ECECEC] bg-[#FAFAFA] p-3">
            {["25/5 Pomodoro", "50/10 Deep Work", "90/20 Deep Work", "15/3 Sprints"].map((item, index) => (
                <div key={item} className="flex items-center justify-between rounded-[12px] bg-white px-3 py-2">
                    <span className="text-[12px] font-bold text-[#333]">{item}</span>
                    <span className={cx("rounded-full px-2 py-1 text-[10px] font-bold", index === 0 ? "bg-[#DDF7E3] text-[#227A36]" : "bg-[#ECEDEF] text-[#555]")}>{index === 0 ? "Live" : "Open"}</span>
                </div>
            ))}
        </div>
    );
}

function SessionTypeCard({ icon, title, body, tone }: { icon: string; title: string; body: string; tone: "green" | "blue" | "red" }) {
    const cls = tone === "green" ? "bg-[#E5F8EA]" : tone === "blue" ? "bg-[#E9F0FF]" : "bg-[#FFE8E8]";
    return (
        <div className="rounded-[22px] border border-[#E9E9E9] bg-white p-6 shadow-sm">
            <div className={cx("flex h-11 w-11 items-center justify-center rounded-[14px] text-[21px]", cls)}>{icon}</div>
            <h3 className="mt-5 text-[18px] font-black text-[#2F2F2F]">{title}</h3>
            <p className="mt-3 text-[14px] leading-6 text-[#666]">{body}</p>
            <div className="mt-5 rounded-[16px] border border-[#EEEEEE] bg-[#FAFAFA] p-3">
                <div className="h-2 rounded-full bg-[#E5E5E5]">
                    <div className={cx("h-2 rounded-full", tone === "green" ? "bg-[#65D46C]" : tone === "blue" ? "bg-[#5286F6]" : "bg-[#F65252]")} style={{ width: "68%" }} />
                </div>
                <div className="mt-3 flex justify-between text-[11px] font-bold text-[#777]"><span>Focus</span><span>Check-in</span></div>
            </div>
        </div>
    );
}

function StepCard({ number, title, body }: { number: string; title: string; body: string }) {
    return (
        <div className="rounded-[22px] border border-[#E9E9E9] bg-white p-6 shadow-sm">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#DDF7E3] text-[13px] font-black text-[#23833C]">{number}</div>
            <h3 className="mt-5 text-[18px] font-black text-[#2F2F2F]">{title}</h3>
            <p className="mt-3 text-[14px] leading-6 text-[#666]">{body}</p>
            <div className="mt-5 rounded-[16px] border border-[#EEEEEE] bg-[#FAFAFA] p-3">
                <div className="space-y-2">
                    <div className="h-3 w-5/6 rounded-full bg-[#E5E7EB]" />
                    <div className="h-3 w-3/5 rounded-full bg-[#E5E7EB]" />
                    <div className="h-3 w-4/6 rounded-full bg-[#DDF7E3]" />
                </div>
            </div>
        </div>
    );
}

function FaqItem({ q, a }: { q: string; a: string }) {
    const [open, setOpen] = useState(false);
    return (
        <button type="button" onClick={() => setOpen((v) => !v)} className="w-full rounded-[16px] border border-[#ECECEC] bg-white px-5 py-4 text-left transition hover:bg-[#FAFAFA]">
            <div className="flex items-center justify-between gap-4">
                <span className="text-[14px] font-black text-[#2F2F2F]">{q}</span>
                <span className="text-[18px] font-black text-[#777]">{open ? "−" : "+"}</span>
            </div>
            {open && <p className="mt-3 text-[14px] leading-6 text-[#666]">{a}</p>}
        </button>
    );
}

export default function LandingPage() {
    return (
        <div className="min-h-screen bg-[#F6F6F4] text-[#2F2F2F]">
            <main className="overflow-hidden pb-20">
                <section className="mx-auto max-w-[1120px] px-4 pt-20 text-center md:pt-28">
                    <div className="mx-auto max-w-[640px]">
                        <h1 className="text-[36px] font-black leading-[0.95] tracking-[-0.04em] text-[#2F2F2F] md:text-[58px]">
                            Do You<br />
                            <RotatingPrompt />
                        </h1>
                        <p className="mx-auto mt-5 max-w-[560px] text-[15px] leading-7 text-[#686868] md:text-[17px]">
                            Join live coworking sessions, set your intention, work alongside other focused people, and get your next meaningful task done.
                        </p>
                        <div className="mt-7 flex justify-center">
                            <CtaButton to="/sessions" dark>Join a session →</CtaButton>
                        </div>
                    </div>

                    <HeroMockup />

                    <div className="mx-auto mt-16 max-w-[1040px]">
                        <MovingChips items={TASK_CHIPS} />
                    </div>

                    <div className="mx-auto mt-16 grid max-w-[760px] grid-cols-1 gap-5 md:grid-cols-3">
                        <StatCard value="85%" label="start easier" />
                        <StatCard value="3.8x" label="more follow-through" />
                        <StatCard value="95%" label="better focus" />
                    </div>
                </section>

                <section className="mx-auto mt-24 max-w-[1120px] px-4">
                    <div className="text-center">
                        <h2 className="text-[28px] font-black leading-tight tracking-[-0.03em] md:text-[38px]">
                            Work Alongside Others And<br />Get X2 More Done
                        </h2>
                    </div>

                    <div className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-2">
                        <FeatureCard
                            title="Built for every kind of person"
                            body="Whether you procrastinate, feel lonely working alone, or simply focus better with people around, MySession gives you a structured room to start."
                            cta="Join →"
                            visual={<MiniSessionList />}
                        />
                        <FeatureCard
                            title="Accountability without pressure"
                            body="Set your intention, stay in the room, work quietly, and check in when it helps. No performance. No forced talking."
                            visual={<MiniSessionList />}
                        />
                        <FeatureCard
                            title="Built for every kind of work"
                            body="Deep work, studying, writing, design, coding, admin, planning, reading, and creative work all fit inside the same simple structure."
                            visual={<MiniSessionList />}
                        />
                        <FeatureCard
                            title="Your session, your rhythm"
                            body="Use 25/5, 50/10, 90/20, or short 15/3 sprints. Pick the room that matches your energy today."
                            visual={
                                <div className="rounded-[18px] border border-[#ECECEC] bg-[#FAFAFA] p-5 text-center">
                                    <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full border-[8px] border-[#65D46C] bg-white text-[24px] font-black">32:14</div>
                                    <div className="mt-3 text-[12px] font-bold text-[#777]">Focus timer running</div>
                                </div>
                            }
                        />
                    </div>
                </section>

                <section className="mx-auto mt-24 max-w-[1120px] px-4">
                    <div className="text-center">
                        <h2 className="text-[28px] font-black leading-tight tracking-[-0.03em] md:text-[38px]">
                            Find The Format That Fits<br />Your Day
                        </h2>
                    </div>

                    <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
                        <SessionTypeCard icon="🍅" title="Pomodoro" tone="green" body="Short structured cycles for getting started and keeping momentum when your brain resists the task." />
                        <SessionTypeCard icon="🎯" title="Deep work" tone="blue" body="Longer focus blocks for serious projects, coding, writing, studying, and high-value work." />
                        <SessionTypeCard icon="🤝" title="Buddy / group rooms" tone="red" body="Work around real people, share your intention, and stay accountable without turning it into a meeting." />
                    </div>
                </section>

                <section className="mx-auto mt-24 max-w-[1120px] px-4">
                    <div className="rounded-[34px] border border-[#F3D4D4] bg-gradient-to-br from-white to-[#FFF1F1] px-6 py-14 text-center shadow-sm md:px-10">
                        <div className="mx-auto -mt-24 mb-8 flex w-max -space-x-3">
                            {["🧑‍💻", "👩‍🎨", "🧑‍🎓", "👨‍💻", "👩‍💼", "🧑‍🔬", "👨‍🎨"].map((emoji, index) => (
                                <div key={`${emoji}-${index}`} className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white bg-[#ECEDEF] text-[24px] shadow-sm">{emoji}</div>
                            ))}
                        </div>
                        <h2 className="text-[24px] font-black tracking-[-0.03em] md:text-[34px]">
                            You're Not Just Joining Sessions. You're<br />Joining A Community.
                        </h2>
                        <p className="mx-auto mt-5 max-w-[620px] text-[15px] leading-7 text-[#666]">
                            Join people from around the world who are showing up to work, study, build, create, and move their lives forward one focused session at a time.
                        </p>
                        <div className="mt-8 flex justify-center">
                            <CtaButton to="/sessions" dark>Join a session →</CtaButton>
                        </div>
                        <div className="mt-10">
                            <MovingChips items={AUDIENCE_CHIPS} reverse />
                        </div>
                    </div>
                </section>

                <section className="mx-auto mt-24 max-w-[1120px] px-4">
                    <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
                        {[
                            ["I finally started the thing I kept avoiding for weeks.", "Anna, student"],
                            ["The room makes it much harder to disappear into distractions.", "Daniel, developer"],
                            ["It feels calm. I can work with people without it becoming social pressure.", "Maya, designer"],
                        ].map(([quote, author]) => (
                            <div key={quote} className="rounded-[22px] bg-white p-6 shadow-sm">
                                <p className="text-[15px] leading-7 text-[#444]">“{quote}”</p>
                                <div className="mt-5 text-[13px] font-black text-[#2F2F2F]">{author}</div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="mx-auto mt-24 max-w-[1120px] px-4">
                    <div className="text-center">
                        <h2 className="text-[28px] font-black tracking-[-0.03em] md:text-[36px]">How It Works</h2>
                    </div>
                    <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
                        <StepCard number="1" title="Join a session" body="Pick a room or scheduled session and enter with one clear task in mind." />
                        <StepCard number="2" title="Work alongside others" body="Stay in the room, see other focused people, and let the structure carry you into the task." />
                        <StepCard number="3" title="Share progress" body="Use the check-in to notice what moved forward, then come back for the next session." />
                    </div>
                </section>

                <section className="mx-auto mt-24 max-w-[760px] px-4">
                    <div className="text-center">
                        <h2 className="text-[28px] font-black tracking-[-0.03em] md:text-[36px]">Frequently Asked<br />Questions</h2>
                    </div>
                    <div className="mt-10 space-y-3">
                        {FAQ_ITEMS.map((item) => <FaqItem key={item.q} q={item.q} a={item.a} />)}
                    </div>
                </section>

                <section className="mx-auto mt-24 max-w-[1120px] px-4">
                    <div className="rounded-[28px] bg-[#2F2F2F] px-6 py-14 text-center text-white shadow-[0_20px_60px_rgba(0,0,0,0.18)] md:px-10">
                        <h2 className="text-[30px] font-black leading-tight tracking-[-0.04em] md:text-[44px]">
                            Ready To Get Things<br />Done, Together?
                        </h2>
                        <p className="mt-4 text-[15px] text-white/70">Join a session now. Your next task gets easier when you stop doing it alone.</p>
                        <div className="mt-8 flex justify-center">
                            <Link to="/sessions" className="rounded-full bg-[#65D46C] px-7 py-3 text-[14px] font-black text-[#17351E] shadow-[0_0_35px_rgba(101,212,108,0.35)] transition hover:-translate-y-0.5">
                                Join a session now →
                            </Link>
                        </div>
                    </div>
                </section>
            </main>

            <style>{`
        .landing-chip-track {
          animation: landingChipMove 26s linear infinite;
        }

        .landing-chip-track-reverse {
          animation-direction: reverse;
        }

        @keyframes landingChipMove {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }

        @media (prefers-reduced-motion: reduce) {
          .landing-chip-track {
            animation: none !important;
          }
        }
      `}</style>
        </div>
    );
}
