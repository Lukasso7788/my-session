// src/pages/LandingPage.tsx
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

type SessionTypeCardProps = {
    title: string;
    description: string;
    bullets: string[];
};

type FaqItem = {
    q: string;
    a: string;
};

const stats = [
    "95% of users report improved focus",
    "3.8x more likely to finish your tasks",
    "85% report getting started on tasks more easily",
];

const movingLine =
    "Moving task lines • Moving task lines • Moving task lines • Moving task lines • Moving task lines • Moving task lines • Moving task lines •";

const sessionTypes: SessionTypeCardProps[] = [
    {
        title: "Group sessions",
        description:
            "Join a structured session with others, follow the structure, and get things done. Best for momentum and accountability.",
        bullets: [
            "Standard formats: 50/10, 25/5 Pomodoro",
            "Custom sprints: 5, 10, 15-min formats",
            "Verbal check-ins built in",
        ],
    },
    {
        title: "24/7 Rooms",
        description:
            "Always open. Drop in anytime, day or night — no scheduling, just show up and work.",
        bullets: ["Great for spontaneous work sessions"],
    },
    {
        title: "Buddy Tripling",
        description:
            "A cozy circle of 3. Personal enough to feel comfortable and to keep you on track.",
        bullets: [
            "Screenshare-only sessions available",
            "Great for recurring sessions and habit building",
        ],
    },
];

const faqItems: FaqItem[] = [
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
        a: "Yes. Join your first session for free, no credit card required.",
    },
    {
        q: "Is MySession good for ADHD?",
        a: "Many people with ADHD find that working alongside others helps them start and stay on task. MySession’s structured sessions and group energy make that easier.",
    },
    {
        q: "Can I join from anywhere?",
        a: "Yes — MySession is fully browser-based, no downloads required. Join from home, a coffee shop, or anywhere you work.",
    },
];

function Shell({ children }: { children: ReactNode }) {
    return <div className="mx-auto w-full max-w-[1180px] px-4 md:px-6">{children}</div>;
}

function SectionLabel({ children }: { children: ReactNode }) {
    return (
        <div className="inline-flex items-center rounded-full border border-[#D7D2CC] bg-[#F3EFEA] px-3 py-1 text-[12px] font-medium text-[#4E4A46]">
            {children}
        </div>
    );
}

function SectionCard({
    children,
    className = "",
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={`rounded-[28px] border border-[#D8D4CF] bg-[#FBFAF8] p-6 md:p-8 shadow-[0_1px_0_rgba(0,0,0,0.02)] ${className}`}
        >
            {children}
        </div>
    );
}

function OutlineButton({
    to,
    children,
    className = "",
}: {
    to: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <Link
            to={to}
            className={`inline-flex h-12 items-center justify-center rounded-full border border-[#2F2F2F] px-6 text-[14px] font-semibold text-[#2F2F2F] transition hover:bg-[#2F2F2F] hover:text-white ${className}`}
        >
            {children}
        </Link>
    );
}

function SolidButton({
    to,
    children,
    className = "",
}: {
    to: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <Link
            to={to}
            className={`inline-flex h-12 items-center justify-center rounded-full bg-[#2F2F2F] px-6 text-[14px] font-semibold text-white transition hover:opacity-90 ${className}`}
        >
            {children}
        </Link>
    );
}

function MetricItem({ text }: { text: string }) {
    return (
        <div className="text-center">
            <div className="text-[15px] font-medium leading-relaxed text-[#2F2F2F]">{text}</div>
        </div>
    );
}

function SessionTypeCard({ title, description, bullets }: SessionTypeCardProps) {
    return (
        <div className="rounded-[24px] border border-[#D8D4CF] bg-white p-5 md:p-6">
            <div className="text-[20px] font-semibold text-[#2F2F2F]">{title}</div>
            <p className="mt-3 text-[14px] leading-relaxed text-[#5F5A55]">{description}</p>

            <ul className="mt-4 space-y-2">
                {bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-3 text-[14px] leading-relaxed text-[#3F3B37]">
                        <span className="mt-[8px] h-[6px] w-[6px] shrink-0 rounded-full bg-[#2F2F2F]" />
                        <span>{bullet}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function HowStep({
    index,
    title,
    text,
}: {
    index: string;
    title: string;
    text: string;
}) {
    return (
        <div className="rounded-[24px] border border-[#D8D4CF] bg-white p-5 md:p-6">
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#2F2F2F] bg-[#2F2F2F] text-[14px] font-semibold text-white">
                    {index}
                </div>
                <div className="text-[18px] font-semibold text-[#2F2F2F]">{title}</div>
            </div>

            <p className="mt-4 text-[14px] leading-relaxed text-[#5F5A55]">{text}</p>
        </div>
    );
}

function FaqCard({ q, a }: FaqItem) {
    return (
        <div className="rounded-[24px] border border-[#D8D4CF] bg-white p-5 md:p-6">
            <div className="text-[16px] font-semibold leading-snug text-[#2F2F2F]">{q}</div>
            <p className="mt-3 text-[14px] leading-relaxed text-[#5F5A55]">{a}</p>
        </div>
    );
}

export default function LandingPage() {
    return (
        <div className="min-h-screen bg-[#F5F3F0] text-[#2F2F2F]">
            <main className="pb-16 pt-[88px] md:pt-[104px]">
                <Shell>
                    {/* HERO */}
                    <section className="mb-6 md:mb-8">
                        <SectionCard>
                            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
                                <div>
                                    <SectionLabel>Hero section</SectionLabel>

                                    <div className="mt-5">
                                        <h1 className="text-[30px] font-semibold leading-tight text-[#2F2F2F] md:text-[42px]">
                                            Do you...
                                        </h1>

                                        <ul className="mt-5 space-y-3 text-[16px] leading-relaxed text-[#3F3B37]">
                                            <li>• struggle to get started?</li>
                                            <li>• lose focus easily?</li>
                                            <li>• keep putting things off?</li>
                                            <li>• get distracted at home?</li>
                                            <li>• work better around other people?</li>
                                        </ul>

                                        <p className="mt-7 max-w-[650px] text-[16px] leading-relaxed text-[#5F5A55]">
                                            join live coworking sessions, work alongside focused people,
                                            and actually get things done.
                                        </p>

                                        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                                            <SolidButton to="/sessions" className="w-full sm:w-auto">
                                                Join a session — it’s free
                                            </SolidButton>
                                            <OutlineButton to="/pricing" className="w-full sm:w-auto">
                                                See pricing
                                            </OutlineButton>
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-[24px] border border-[#D8D4CF] bg-white p-5 md:p-6">
                                    <div className="flex items-center justify-center">
                                        <div className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#2F2F2F] text-[28px] text-white">
                                            ∞
                                        </div>
                                    </div>

                                    <div className="mt-5 text-center text-[30px] font-semibold leading-tight text-[#2F2F2F] md:text-[38px]">
                                        Work alongside others — and get more done
                                    </div>

                                    <p className="mx-auto mt-5 max-w-[520px] text-center text-[15px] leading-relaxed text-[#5F5A55]">
                                        Join structured live sessions, show up with your task, and
                                        build momentum by working around other focused people.
                                    </p>

                                    <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
                                        {[
                                            ["Always Open", "24/7 Access"],
                                            ["Stay accountable", "With others"],
                                            ["Structured Flow", "Built-in workflow"],
                                            ["Keep momentum", "Day & Night"],
                                        ].map(([title, subtitle]) => (
                                            <div
                                                key={title}
                                                className="rounded-[18px] border border-[#D8D4CF] bg-[#FAFAF8] px-4 py-4 text-center"
                                            >
                                                <div className="text-[14px] font-semibold text-[#2F2F2F]">
                                                    {title}
                                                </div>
                                                <div className="mt-1 text-[12px] text-[#6A655F]">
                                                    {subtitle}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </SectionCard>
                    </section>

                    {/* STATS */}
                    <section className="mb-6 md:mb-8">
                        <SectionCard>
                            <SectionLabel>stats</SectionLabel>

                            <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-3">
                                {stats.map((item) => (
                                    <MetricItem key={item} text={item} />
                                ))}
                            </div>

                            <div className="mt-8 overflow-hidden rounded-full border border-[#E0DCD7] bg-white py-3">
                                <div className="landing-marquee whitespace-nowrap text-[13px] text-[#5F5A55]">
                                    <span className="mx-4">{movingLine}</span>
                                    <span className="mx-4">{movingLine}</span>
                                </div>
                            </div>
                        </SectionCard>
                    </section>

                    {/* PAIN / TRUTHS */}
                    <section className="mb-6 md:mb-8">
                        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.18fr_0.82fr]">
                            <SectionCard>
                                <SectionLabel>pain/truths</SectionLabel>

                                <div className="mt-6">
                                    <h2 className="text-[26px] font-semibold leading-tight text-[#2F2F2F]">
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
                                        <span>Researcher</span>
                                    </div>
                                </div>
                            </SectionCard>

                            <SectionCard className="h-full">
                                <SectionLabel>Who it is &gt; What + Value</SectionLabel>

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
                            </SectionCard>
                        </div>
                    </section>

                    {/* HOW IT WORKS */}
                    <section className="mb-6 md:mb-8">
                        <SectionCard>
                            <SectionLabel>how it works</SectionLabel>

                            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
                                <HowStep
                                    index="1"
                                    title="Join a session"
                                    text="Choose what fits your day — a group session, a 24/7 room, or a cozy circle of 3. Jump right in."
                                />

                                <HowStep
                                    index="2"
                                    title="Work alongside others"
                                    text="Write down what you want to finish, see focused people around you, and naturally get into your work. Silent, structured, distraction-free."
                                />

                                <HowStep
                                    index="3"
                                    title="Celebrate your progress"
                                    text="Session done, share what you got done, celebrate your wins, and leave feeling accomplished."
                                />
                            </div>
                        </SectionCard>
                    </section>

                    {/* TYPE OF SESSIONS */}
                    <section className="mb-6 md:mb-8">
                        <SectionCard>
                            <SectionLabel>Type of sessions</SectionLabel>

                            <div className="mt-6">
                                <div className="mx-auto flex w-full max-w-[620px] items-center justify-between rounded-full border border-[#D8D4CF] bg-white p-1 text-[14px]">
                                    <div className="flex-1 rounded-full px-4 py-3 text-center text-[#5F5A55]">
                                        Group sessions
                                    </div>
                                    <div className="flex-1 rounded-full bg-[#2F2F2F] px-4 py-3 text-center font-medium text-white">
                                        Infinite rooms
                                    </div>
                                    <div className="flex-1 rounded-full px-4 py-3 text-center text-[#5F5A55]">
                                        Body tripling
                                    </div>
                                </div>

                                <div className="mt-7 text-center">
                                    <h2 className="text-[26px] font-semibold leading-tight text-[#2F2F2F]">
                                        Find the format that fits your day
                                    </h2>
                                </div>

                                <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
                                    {sessionTypes.map((item) => (
                                        <SessionTypeCard
                                            key={item.title}
                                            title={item.title}
                                            description={item.description}
                                            bullets={item.bullets}
                                        />
                                    ))}
                                </div>
                            </div>
                        </SectionCard>
                    </section>

                    {/* TESTIMONIALS */}
                    <section className="mb-6 md:mb-8">
                        <SectionCard>
                            <SectionLabel>testimonials</SectionLabel>

                            <div className="mt-6 rounded-[24px] border border-dashed border-[#D8D4CF] bg-white px-6 py-10 text-center text-[15px] text-[#5F5A55]">
                                [Testimonials — to be collected from real users]
                            </div>
                        </SectionCard>
                    </section>

                    {/* COMMUNITY */}
                    <section className="mb-6 md:mb-8">
                        <SectionCard>
                            <SectionLabel>Community</SectionLabel>

                            <div className="mt-6 max-w-[820px]">
                                <h2 className="text-[26px] font-semibold leading-tight text-[#2F2F2F]">
                                    You’re not just joining sessions. You’re joining a community.
                                </h2>

                                <p className="mt-5 text-[15px] leading-relaxed text-[#5F5A55]">
                                    A global community of creators, builders, students, and professionals
                                    — all showing up every day to work on things that matter. No pressure,
                                    no judgment — just people doing their best work, together.
                                </p>
                            </div>
                        </SectionCard>
                    </section>

                    {/* FAQ */}
                    <section className="mb-6 md:mb-8">
                        <SectionCard>
                            <SectionLabel>FAQs</SectionLabel>

                            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                                {faqItems.map((item) => (
                                    <FaqCard key={item.q} q={item.q} a={item.a} />
                                ))}
                            </div>
                        </SectionCard>
                    </section>

                    {/* FINAL CTA */}
                    <section>
                        <SectionCard className="bg-[#E6F1E5]">
                            <SectionLabel>final CTA</SectionLabel>

                            <div className="mt-6 max-w-[760px]">
                                <h2 className="text-[28px] font-semibold leading-tight text-[#2F2F2F] md:text-[34px]">
                                    Ready to get things done, together?
                                </h2>

                                <p className="mt-4 text-[16px] leading-relaxed text-[#5F5A55]">
                                    Join a session now — it’s free.
                                </p>

                                <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                                    <SolidButton to="/sessions" className="w-full sm:w-auto">
                                        Join a session now
                                    </SolidButton>
                                    <OutlineButton to="/pricing" className="w-full sm:w-auto">
                                        View pricing
                                    </OutlineButton>
                                </div>
                            </div>
                        </SectionCard>
                    </section>
                </Shell>

                <style>{`
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
            .landing-marquee {
              animation: none !important;
              transform: none !important;
            }
          }
        `}</style>
            </main>
        </div>
    );
}