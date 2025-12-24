// src/pages/LandingPage.tsx
import { useNavigate } from "react-router-dom";

const GRADIENT =
    "linear-gradient(90deg, #5BF367 0%, #3369CB 33%, #E23C7C 66%, #FED234 100%)";

function AccentLine({ className = "" }: { className?: string }) {
    return (
        <div
            className={`rounded-full ${className} grad-anim`}
            style={{ background: GRADIENT, backgroundSize: "220% 220%" }}
            aria-hidden="true"
        />
    );
}

function AccentDot({ className = "" }: { className?: string }) {
    return (
        <span
            className={`inline-block rounded-full ${className} grad-anim`}
            style={{ background: GRADIENT, backgroundSize: "220% 220%" }}
            aria-hidden="true"
        />
    );
}

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
                <div className="text-[12px] tracking-wide text-[#606060] mb-3 inline-flex items-center gap-2">
                    <AccentDot className="w-[7px] h-[7px]" />
                    <span>{kicker}</span>
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

            {/* subtle accent line */}
            <div className="mt-6 flex justify-center">
                <AccentLine className="h-[6px] w-[120px] opacity-70" />
            </div>
        </div>
    );
}

function FeatureCard({
    title,
    desc,
    bullets,
}: {
    title: string;
    desc: string;
    bullets?: string[];
}) {
    return (
        <div className="border border-[#DBD8D8] rounded-[24px] p-6 bg-white hover:bg-[#FAFAFA] transition feature-float">
            <div className="text-[16px] font-semibold text-[#2F2F2F]">{title}</div>
            <div className="mt-2 text-[14px] text-[#606060] leading-relaxed">{desc}</div>
            {bullets?.length ? (
                <ul className="mt-4 space-y-2 text-[13px] text-[#606060]">
                    {bullets.map((b) => (
                        <li key={b} className="flex gap-2">
                            {/* accent bullet (gradient) but tiny */}
                            <AccentDot className="mt-[6px] w-[6px] h-[6px] shrink-0 opacity-90" />
                            <span>{b}</span>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}

function MiniSessionCard({
    title,
    tag,
    host,
    minutes,
    startsIn,
    people,
}: {
    title: string;
    tag: string;
    host: string;
    minutes: number;
    startsIn: string;
    people: number;
}) {
    return (
        <div className="border border-[#DBD8D8] rounded-[28px] bg-white p-5 flex flex-col gap-4 feature-float">
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

                        <span className="ml-0 md:ml-2 inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#DBD8D8] bg-white text-[#606060]">
                            <AccentDot className="w-[7px] h-[7px] opacity-80" />
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

                {/* join: keep black, add subtle gradient ring on hover only */}
                <button className="h-12 rounded-full px-6 text-[14px] font-semibold bg-[#111827] text-white transition w-full sm:w-auto btn-grad-ring">
                    Join session
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
                <section className="pt-[92px] md:pt-[110px] pb-10 relative overflow-hidden">
                    {/* subtle animated background accents (low opacity, so gradient stays 10–15%) */}
                    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                        <div
                            className="absolute -top-24 left-1/2 -translate-x-1/2 w-[820px] h-[420px] rounded-full blur-3xl opacity-[0.08] blob-float"
                            style={{ background: GRADIENT }}
                        />
                        <div
                            className="absolute top-40 -left-28 w-[420px] h-[420px] rounded-full blur-3xl opacity-[0.06] blob-float2"
                            style={{ background: GRADIENT }}
                        />
                        {/* very thin accent line at top of hero */}
                        <div className="absolute top-0 left-0 right-0 flex justify-center">
                            <AccentLine className="h-[3px] w-[420px] opacity-70" />
                        </div>
                    </div>

                    <div className="max-w-[980px] mx-auto text-center relative">
                        <h1 className="text-[30px] md:text-[40px] xl:text-[52px] font-normal leading-tight">
                            High-accountability focus sessions —
                            <br className="hidden md:block" />
                            with structure, intentions, and AI support.
                        </h1>

                        <p className="mt-5 text-[14px] md:text-[16px] text-[#606060] leading-relaxed max-w-[820px] mx-auto">
                            MySession turns “I should do it” into a clear, guided flow: define intentions, follow session stages with
                            check-ins, keep a birds-eye view on progress, and get AI help for any task (including screenshare support).
                        </p>

                        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                            {/* keep primary as black, add very subtle gradient ring on hover */}
                            <button
                                onClick={() => navigate("/sessions")}
                                className="h-12 rounded-full px-7 text-[14px] font-semibold bg-[#111827] text-white transition w-full sm:w-auto btn-grad-ring"
                            >
                                Browse sessions
                            </button>
                            <button
                                onClick={() => navigate("/sessions?create=1")}
                                className="h-12 rounded-full px-7 text-[14px] font-semibold border border-[#2F2F2F] text-[#2F2F2F] hover:bg-[#2F2F2F] hover:text-white transition w-full sm:w-auto"
                            >
                                Host a session
                            </button>
                        </div>

                        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                            {["Browser-based", "Guided check-ins", "Intentions + progress", "AI assistance"].map((x) => (
                                <span
                                    key={x}
                                    className="text-[12px] px-3 py-1 rounded-full border border-[#DBD8D8] text-[#606060] bg-white inline-flex items-center gap-2"
                                >
                                    <AccentDot className="w-[7px] h-[7px] opacity-70" />
                                    {x}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* HERO VISUAL (маркетинговый мок birds-eye view + PiP bar) */}
                    <div className="mt-10 max-w-[1100px] mx-auto relative">
                        {/* subtle gradient corner accent (tiny) */}
                        <div
                            className="pointer-events-none absolute -top-4 -right-4 w-24 h-24 rounded-full blur-2xl opacity-[0.10] blob-float3"
                            style={{ background: GRADIENT }}
                            aria-hidden="true"
                        />

                        <div className="border border-[#DBD8D8] rounded-[32px] bg-[#FAFAFA] p-4 md:p-6 hover:shadow-[0_18px_60px_rgba(0,0,0,0.06)] transition-shadow">
                            {/* thin accent line inside container (very subtle) */}
                            <AccentLine className="h-[3px] w-full opacity-35 mb-4" />

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {/* Left: Intention panel */}
                                <div className="bg-white border border-[#EAEAEA] rounded-[24px] p-5 feature-float">
                                    <div className="flex items-center justify-between">
                                        <div className="text-[14px] font-semibold">Intentions panel</div>
                                        <div className="text-[12px] text-[#606060]">Bird’s-eye view</div>
                                    </div>

                                    <div className="mt-4 space-y-3">
                                        <div className="rounded-[16px] border border-[#DBD8D8] p-4">
                                            <div className="text-[13px] font-semibold">Today: “Ship sessions page mobile polish”</div>
                                            <div className="mt-2 text-[12px] text-[#606060]">
                                                Plan: 3 steps • 2 check-ins • progress tracked
                                            </div>

                                            {/* progress: only bar uses gradient (tiny, controlled) */}
                                            <div className="mt-3 h-2 rounded-full bg-[#F1F1F1] overflow-hidden">
                                                <div
                                                    className="h-2 w-[62%] grad-anim"
                                                    style={{ background: GRADIENT, backgroundSize: "220% 220%" }}
                                                />
                                            </div>

                                            <div className="mt-2 text-[12px] text-[#606060]">62% complete</div>
                                        </div>

                                        <div className="rounded-[16px] border border-[#DBD8D8] p-4">
                                            <div className="text-[13px] font-semibold">AI plan (auto-generated)</div>
                                            <div className="mt-2 text-[12px] text-[#606060] leading-relaxed">
                                                Break down the goal → schedule focus blocks → track completion → adapt next steps.
                                            </div>
                                        </div>

                                        <div className="rounded-[16px] border border-[#DBD8D8] p-4">
                                            <div className="text-[13px] font-semibold">Check-in prompts</div>
                                            <div className="mt-2 text-[12px] text-[#606060]">
                                                Start: “What will you finish?” • Mid: “What changed?” • End: “What did you ship?”
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Right: PiP taskbar */}
                                <div className="bg-white border border-[#EAEAEA] rounded-[24px] p-5 flex flex-col feature-float">
                                    <div className="flex items-center justify-between">
                                        <div className="text-[14px] font-semibold">Focus taskbar</div>
                                        <div className="text-[12px] text-[#606060]">Picture-in-picture overlay</div>
                                    </div>

                                    <div className="mt-4 flex-1 rounded-[20px] border border-[#DBD8D8] bg-[#F6F6F6] p-4">
                                        <div className="text-[12px] text-[#606060]">
                                            Always-on-top overlay so you keep accountability while working in any app.
                                        </div>

                                        <div className="mt-4 rounded-[16px] bg-white border border-[#EAEAEA] p-4">
                                            <div className="flex items-center justify-between">
                                                <div className="text-[13px] font-semibold">Session stage</div>
                                                <div className="text-[12px] text-[#606060]">Deep work</div>
                                            </div>

                                            {/* keep stage bar black to not overuse gradient */}
                                            <div className="mt-3 h-2 rounded-full bg-[#F1F1F1] overflow-hidden">
                                                <div className="h-2 w-[35%] bg-[#111827]" />
                                            </div>

                                            <div className="mt-2 text-[12px] text-[#606060]">
                                                Stage 2/4 • Next check-in in 12:00
                                            </div>
                                        </div>

                                        <div className="mt-4 rounded-[16px] bg-white border border-[#EAEAEA] p-4">
                                            <div className="text-[13px] font-semibold">AI Screenshare Assistant</div>
                                            <div className="mt-2 text-[12px] text-[#606060]">
                                                “Share your screen → ask for guidance → unblock the next step (while staying focused).”
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-4 flex flex-col sm:flex-row gap-3">
                                        <button
                                            onClick={() => navigate("/sessions")}
                                            className="h-12 rounded-full px-6 text-[14px] font-semibold bg-[#111827] text-white transition w-full sm:w-auto btn-grad-ring"
                                        >
                                            Join a session
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

                {/* SOCIAL PROOF / OUTCOMES */}
                <section className="py-12">
                    <SectionTitle
                        kicker="Outcome, not vibes"
                        title="Designed for people who want real progress."
                        subtitle="MySession is structured by default: intentions → staged focus → check-ins → recap. You get accountability that actually changes behavior."
                    />

                    <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-4">
                        <FeatureCard
                            title="Bird’s-eye intentions view"
                            desc="See what everyone is working on — quickly. Less ambiguity, more commitment."
                            bullets={["Clear goals per person", "Visible progress tracking", "Less “silent procrastination”"]}
                        />
                        <FeatureCard
                            title="Defined session stages + check-ins"
                            desc="No random calls. Sessions have a structure that keeps people honest and aligned."
                            bullets={[
                                "Start check-in (what you’ll finish)",
                                "Mid check-in (adjust plan)",
                                "End check-in (ship + recap)",
                            ]}
                        />
                        <FeatureCard
                            title="Always-on-top focus taskbar"
                            desc="Picture-in-picture overlay that keeps the session present while you work anywhere."
                            bullets={["Stage progress & timer", "Next check-in countdown", "Quick access to intentions panel"]}
                        />
                    </div>
                </section>

                {/* HOW IT WORKS */}
                <section className="py-12">
                    <SectionTitle
                        kicker="How it works"
                        title="A simple flow that forces momentum."
                        subtitle="Join in seconds — then the structure does the heavy lifting."
                    />

                    <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <FeatureCard
                            title="1) Pick a session"
                            desc="Choose a format and a time. The session card shows what matters."
                            bullets={["Schedule + filters", "Book or join instantly", "Zero setup friction"]}
                        />
                        <FeatureCard
                            title="2) Set intentions"
                            desc="Write what you will finish. Everyone sees it. Accountability becomes real."
                            bullets={["Bird’s-eye view", "AI can help refine goal", "Progress tracking"]}
                        />
                        <FeatureCard
                            title="3) Execute with check-ins + AI"
                            desc="Work through stages. Get nudged by check-ins. Use AI screenshare assistant when stuck."
                            bullets={["Staged focus", "Mid-session recalibration", "End recap for closure"]}
                        />
                    </div>
                </section>

                {/* AI POWERED FOCUS */}
                <section className="py-12">
                    <SectionTitle
                        kicker="AI powered focus"
                        title="Cheap, reliable, structured focus — with AI assistance."
                        subtitle="Not another chatbot. AI is integrated into the accountability loop: plan → execute → track → improve."
                    />

                    <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FeatureCard
                            title="AI-created plans for any goal"
                            desc="Studying, career growth, building a product — AI generates a structured plan and MySession turns it into daily focus execution."
                            bullets={[
                                "Goal → milestones → daily tasks",
                                "Progress tracking inside intentions panel",
                                "Adapt plan based on what actually happened",
                            ]}
                        />
                        <FeatureCard
                            title="AI Screenshare Assistant"
                            desc="When you’re stuck, share the screen and ask for the next step — without breaking focus."
                            bullets={["Unblock tasks fast", "Stay inside the session structure", "Reduce context switching & doomscrolling"]}
                        />
                    </div>
                </section>

                {/* HOSTING INCENTIVE */}
                <section className="py-12">
                    <div className="border border-[#DBD8D8] rounded-[32px] p-6 md:p-10 bg-[#FAFAFA] relative overflow-hidden">
                        {/* tiny accent */}
                        <div className="absolute top-0 left-1/2 -translate-x-1/2">
                            <AccentLine className="h-[3px] w-[260px] opacity-55" />
                        </div>

                        <div className="max-w-[980px] mx-auto text-center">
                            <div className="text-[12px] tracking-wide text-[#606060] mb-3 inline-flex items-center gap-2">
                                <AccentDot className="w-[7px] h-[7px]" />
                                Hosts
                            </div>
                            <div className="text-[24px] md:text-[32px] font-normal leading-tight">
                                Host sessions — get <span className="font-semibold">50% off</span>.
                            </div>
                            <p className="mt-4 text-[14px] md:text-[16px] text-[#606060] leading-relaxed">
                                Hosting grows the ecosystem. You bring structure — we reward it.
                            </p>

                            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                                <button
                                    onClick={() => navigate("/sessions?create=1")}
                                    className="h-12 rounded-full px-7 text-[14px] font-semibold bg-[#111827] text-white transition w-full sm:w-auto btn-grad-ring"
                                >
                                    Host your first session
                                </button>
                                <button
                                    onClick={() => navigate("/pricing")}
                                    className="h-12 rounded-full px-7 text-[14px] font-semibold border border-[#2F2F2F] text-[#2F2F2F] hover:bg-[#2F2F2F] hover:text-white transition w-full sm:w-auto"
                                >
                                    How discounts work
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

                    <div className="mt-10 border border-[#DBD8D8] rounded-[32px] p-4 md:p-8 relative">
                        {/* subtle accent line */}
                        <AccentLine className="h-[3px] w-[220px] opacity-40 mb-6" />

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            <MiniSessionCard
                                title="50/5/5 Deep work — 2 hours"
                                tag="Deep work"
                                host="Yaro"
                                minutes={120}
                                startsIn="44 mins"
                                people={6}
                            />
                            <MiniSessionCard
                                title="25/5 Pomodoro — 2 hours"
                                tag="Pomodoro 25/5"
                                host="Yaro"
                                minutes={120}
                                startsIn="1 hour"
                                people={4}
                            />
                            <MiniSessionCard
                                title="15/3 Short sprints — 2 hours"
                                tag="Short sprints"
                                host="Yaro"
                                minutes={120}
                                startsIn="2 hours"
                                people={5}
                            />
                        </div>

                        <div className="mt-6 flex justify-center">
                            <button
                                onClick={() => navigate("/sessions")}
                                className="h-12 rounded-full px-7 text-[14px] font-semibold bg-[#111827] text-white transition w-full sm:w-auto btn-grad-ring"
                            >
                                Open full schedule
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
                            { q: "Is MySession free?", a: "There is a free tier. Paid plans unlock advanced structure + AI assistance features." },
                            { q: "What makes it different from a normal call?", a: "Sessions are structured: intentions → stages → check-ins → recap. That structure drives accountability." },
                            { q: "Do I need to download anything?", a: "No. It’s browser-based." },
                            { q: "Can AI help with any task?", a: "Yes: planning, breaking down tasks, and screenshare-guided help when you’re stuck — without derailing focus." },
                            { q: "What do hosts get?", a: "Hosts receive a 50% discount and grow trust via their profile & consistent sessions." },
                            { q: "Is it good for studying / professional goals?", a: "Yes. The core is structured focus + progress tracking for your intentions and plans." },
                        ].map((item) => (
                            <div key={item.q} className="border border-[#DBD8D8] rounded-[24px] p-6 bg-white feature-float">
                                <div className="text-[14px] font-semibold inline-flex items-center gap-2">
                                    <AccentDot className="w-[7px] h-[7px] opacity-75" />
                                    {item.q}
                                </div>
                                <div className="mt-2 text-[13px] text-[#606060] leading-relaxed">{item.a}</div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* FINAL CTA */}
                <section className="pt-6 pb-4">
                    <div className="border border-[#DBD8D8] rounded-[32px] p-6 md:p-10 bg-[#111827] text-white relative overflow-hidden">
                        {/* accent gradient line only */}
                        <div className="absolute top-0 left-0 right-0 flex justify-center">
                            <AccentLine className="h-[3px] w-[320px] opacity-80" />
                        </div>

                        <div className="max-w-[980px] mx-auto text-center relative">
                            <div className="text-[24px] md:text-[32px] font-normal leading-tight">
                                Start with one session. Ship something today.
                            </div>
                            <div className="mt-3 text-[14px] md:text-[16px] text-white/80">
                                Browse sessions, set intentions, follow check-ins, and keep progress visible.
                            </div>

                            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                                <button
                                    onClick={() => navigate("/sessions")}
                                    className="h-12 rounded-full px-7 text-[14px] font-semibold bg-white text-[#111827] hover:opacity-90 transition w-full sm:w-auto"
                                >
                                    Browse sessions
                                </button>
                                <button
                                    onClick={() => navigate("/sessions?create=1")}
                                    className="h-12 rounded-full px-7 text-[14px] font-semibold border border-white text-white hover:bg-white hover:text-[#111827] transition w-full sm:w-auto"
                                >
                                    Host a session
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* local, minimal animations */}
                <style>{`
          .grad-anim {
            animation: gradMove 7s ease-in-out infinite;
          }

          .btn-grad-ring {
            position: relative;
          }
          .btn-grad-ring::after {
            content: "";
            position: absolute;
            inset: -2px;
            border-radius: 9999px;
            background: ${GRADIENT};
            background-size: 220% 220%;
            opacity: 0;
            transition: opacity 180ms ease, transform 180ms ease;
            z-index: -1;
            filter: blur(0px);
          }
          .btn-grad-ring:hover::after {
            opacity: 0.55; /* subtle ring */
          }

          .feature-float {
            transition: transform 180ms ease, box-shadow 180ms ease;
          }
          .feature-float:hover {
            transform: translateY(-2px);
            box-shadow: 0 14px 40px rgba(0,0,0,0.07);
          }

          .blob-float { animation: float1 10s ease-in-out infinite; }
          .blob-float2 { animation: float2 12s ease-in-out infinite; }
          .blob-float3 { animation: float3 9s ease-in-out infinite; }

          @keyframes gradMove {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }
          @keyframes float1 {
            0%, 100% { transform: translate(-50%, 0px) scale(1); }
            50% { transform: translate(-50%, 14px) scale(1.02); }
          }
          @keyframes float2 {
            0%, 100% { transform: translate(0px, 0px) scale(1); }
            50% { transform: translate(18px, 10px) scale(1.03); }
          }
          @keyframes float3 {
            0%, 100% { transform: translate(0px, 0px) scale(1); }
            50% { transform: translate(-10px, 12px) scale(1.05); }
          }

          @media (prefers-reduced-motion: reduce) {
            .grad-anim, .blob-float, .blob-float2, .blob-float3 {
              animation: none !important;
            }
            .feature-float:hover { transform: none; }
          }
        `}</style>
            </main>
        </div>
    );
}
