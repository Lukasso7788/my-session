// src/pages/LandingPage.tsx
import { Link } from "react-router-dom";

const GRADIENT =
    "linear-gradient(90deg, #5BF367 0%, #3369CB 33%, #E23C7C 66%, #FED234 100%)";

function GradientLine({ className = "" }: { className?: string }) {
    return (
        <div
            className={`rounded-full ${className}`}
            style={{ background: GRADIENT }}
            aria-hidden="true"
        />
    );
}

function GradientButton({
    to,
    children,
    variant = "primary",
}: {
    to: string;
    children: React.ReactNode;
    variant?: "primary" | "ghost";
}) {
    if (variant === "ghost") {
        return (
            <Link
                to={to}
                className="
          inline-flex items-center justify-center
          h-12 px-6 rounded-full
          border border-[#2F2F2F]
          text-[14px] font-semibold text-[#2F2F2F]
          hover:bg-[#2F2F2F] hover:text-white
          transition-transform duration-200
          hover:-translate-y-[1px] active:translate-y-0
        "
            >
                {children}
            </Link>
        );
    }

    return (
        <Link
            to={to}
            className="
        relative inline-flex items-center justify-center
        h-12 px-6 rounded-full
        text-[14px] font-semibold text-white
        overflow-hidden
        transition-transform duration-200
        hover:-translate-y-[1px] active:translate-y-0
        focus:outline-none
      "
        >
            {/* animated gradient bg */}
            <span
                className="absolute inset-0 grad-anim"
                style={{
                    background: GRADIENT,
                    backgroundSize: "220% 220%",
                }}
                aria-hidden="true"
            />
            {/* subtle shine */}
            <span className="absolute inset-0 btn-shine" aria-hidden="true" />
            <span className="relative z-10">{children}</span>
        </Link>
    );
}

function GradientBorderCard({
    children,
    className = "",
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={`relative rounded-[24px] p-[1px] grad-border ${className}`}
            style={{ background: GRADIENT }}
        >
            <div className="rounded-[23px] bg-white">{children}</div>
        </div>
    );
}

function FeatureCard({
    title,
    desc,
    icon,
}: {
    title: string;
    desc: string;
    icon: React.ReactNode;
}) {
    return (
        <GradientBorderCard className="hover:shadow-[0_14px_40px_rgba(0,0,0,0.08)] transition-shadow">
            <div className="p-6">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center bg-[#F6F6F6]">
                        {icon}
                    </div>
                    <h3 className="text-[18px] font-semibold text-[#2F2F2F]">{title}</h3>
                </div>
                <p className="mt-3 text-[14px] leading-relaxed text-[#606060]">{desc}</p>
            </div>
        </GradientBorderCard>
    );
}

function StatPill({ label, value }: { label: string; value: string }) {
    return (
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#DBD8D8] bg-white">
            <span className="text-[13px] text-[#606060]">{label}</span>
            <span className="text-[13px] font-semibold text-[#2F2F2F]">{value}</span>
        </div>
    );
}

export default function LandingPage() {
    return (
        <main className="w-full font-inter text-[#2F2F2F] bg-white">
            {/* ====== HERO ====== */}
            <section className="relative overflow-hidden">
                {/* background accents */}
                <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
                    <div
                        className="absolute -top-20 left-1/2 -translate-x-1/2 w-[820px] h-[420px] rounded-full opacity-[0.18] blur-3xl blob-float"
                        style={{ background: GRADIENT }}
                    />
                    <div
                        className="absolute top-32 -left-24 w-[420px] h-[420px] rounded-full opacity-[0.12] blur-3xl blob-float2"
                        style={{ background: GRADIENT }}
                    />
                    <div className="absolute top-0 left-0 right-0 h-[3px]">
                        <GradientLine className="h-[3px] w-full" />
                    </div>
                </div>

                <div className="w-full px-3 md:px-6 lg:px-10">
                    <div className="pt-[110px] pb-[48px] max-w-[1100px] mx-auto text-center">
                        <h1 className="text-[34px] md:text-[44px] xl:text-[54px] font-semibold leading-[1.08]">
                            Focus sessions with high accountability
                            <br />
                            and AI assistance
                        </h1>

                        <p className="mt-4 text-[15px] md:text-[17px] text-[#606060] max-w-[820px] mx-auto leading-relaxed">
                            Join structured group sessions with clear stages and check-ins.
                            Keep a birds-eye view of everyone’s intentions — and stay on track
                            with an AI screenshare assistant when you need momentum.
                        </p>

                        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                            <GradientButton to="/sessions">Browse sessions</GradientButton>
                            <GradientButton to="/register" variant="ghost">
                                Create account
                            </GradientButton>
                            <Link
                                to="/pricing"
                                className="text-[14px] text-[#2F2F2F] underline underline-offset-4 hover:opacity-80"
                            >
                                See pricing
                            </Link>
                        </div>

                        <div className="mt-10 flex flex-wrap gap-2 justify-center">
                            <StatPill label="Structured stages" value="Check-ins built-in" />
                            <StatPill label="Birds-eye view" value="Intentions panel" />
                            <StatPill label="AI powered focus" value="Screenshare assistant" />
                        </div>

                        <div className="mt-10 max-w-[980px] mx-auto">
                            <GradientBorderCard>
                                <div className="p-4 md:p-6">
                                    <div className="flex items-center justify-between gap-4 flex-wrap">
                                        <div className="text-left">
                                            <div className="text-[14px] text-[#606060]">Next up</div>
                                            <div className="text-[18px] md:text-[20px] font-semibold">
                                                50/5/5 Deep work — 2 hours
                                            </div>
                                            <div className="mt-1 text-[13px] text-[#606060]">
                                                Clear intentions • Timed stages • Accountability check-ins
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="hidden md:block w-px h-10 bg-[#E5E7EB]" />
                                            <div className="text-center">
                                                <div className="text-[26px] font-bold">6</div>
                                                <div className="text-[11px] text-[#606060] -mt-1">
                                                    in the session
                                                </div>
                                            </div>
                                            <GradientButton to="/sessions">Join now</GradientButton>
                                        </div>
                                    </div>
                                </div>
                            </GradientBorderCard>
                        </div>
                    </div>
                </div>
            </section>

            {/* ====== HOW IT WORKS ====== */}
            <section className="w-full px-3 md:px-6 lg:px-10 pb-20">
                <div className="max-w-[1100px] mx-auto">
                    <div className="flex items-end justify-between gap-6 flex-wrap">
                        <div>
                            <h2 className="text-[26px] md:text-[32px] font-semibold">
                                Designed for real accountability
                            </h2>
                            <p className="mt-2 text-[#606060] max-w-[720px]">
                                Sessions are simple, structured, and repeatable — so you show up,
                                state intent, do the work, and leave with visible progress.
                            </p>
                        </div>
                        <GradientLine className="h-[8px] w-[140px] opacity-90" />
                    </div>

                    <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
                        <FeatureCard
                            title="Birds-eye view"
                            desc="See everyone’s stated intention and current stage. You instantly feel the social pull to stay on-task."
                            icon={
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                                    <path
                                        d="M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7Z"
                                        stroke="#2F2F2F"
                                        strokeWidth="1.8"
                                    />
                                    <circle cx="12" cy="12" r="3" stroke="#2F2F2F" strokeWidth="1.8" />
                                </svg>
                            }
                        />
                        <FeatureCard
                            title="Check-ins & stages"
                            desc="Clear stages: kick-off → focus blocks → quick check-ins → wrap. It’s the fastest path to consistency."
                            icon={
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                                    <path
                                        d="M7 3v4M17 3v4M4 9h16M6 12h4M6 16h6"
                                        stroke="#2F2F2F"
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                    />
                                </svg>
                            }
                        />
                        <FeatureCard
                            title="AI screenshare assistant"
                            desc="When you stall, the assistant helps you pick the next step, clarify the task, and keep momentum — without breaking focus."
                            icon={
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                                    <path
                                        d="M4 6h16v10H4V6Z"
                                        stroke="#2F2F2F"
                                        strokeWidth="1.8"
                                    />
                                    <path
                                        d="M8 20h8"
                                        stroke="#2F2F2F"
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                    />
                                </svg>
                            }
                        />
                    </div>
                </div>
            </section>

            {/* ====== AI PLANS ====== */}
            <section className="w-full px-3 md:px-6 lg:px-10 pb-20">
                <div className="max-w-[1100px] mx-auto">
                    <GradientBorderCard>
                        <div className="p-6 md:p-10">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
                                <div>
                                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#DBD8D8] text-[12px] text-[#606060]">
                                        <span className="w-2 h-2 rounded-full grad-dot" aria-hidden="true" />
                                        AI-powered structure
                                    </div>
                                    <h2 className="mt-4 text-[26px] md:text-[34px] font-semibold leading-tight">
                                        AI creates a plan.
                                        <br />
                                        MySession runs the focus.
                                    </h2>
                                    <p className="mt-3 text-[#606060] leading-relaxed">
                                        Studying, professional goals, skill building — get a structured plan
                                        with milestones and progress tracking. Then execute it through
                                        sessions with real accountability.
                                    </p>

                                    <div className="mt-6 flex flex-col sm:flex-row gap-3">
                                        <GradientButton to="/register">Start free</GradientButton>
                                        <GradientButton to="/updates" variant="ghost">
                                            Latest updates
                                        </GradientButton>
                                    </div>
                                </div>

                                <div className="relative">
                                    <div className="rounded-[24px] border border-[#DBD8D8] bg-white p-5">
                                        <div className="flex items-center justify-between">
                                            <div className="text-[14px] text-[#606060]">Intentions panel</div>
                                            <div className="text-[12px] text-[#606060]">Live</div>
                                        </div>

                                        <div className="mt-4 space-y-3">
                                            {[
                                                { title: "Finish pricing page copy", meta: "25 min • stage: Focus" },
                                                { title: "Fix layout on mobile cards", meta: "30 min • stage: Focus" },
                                                { title: "Prepare next focus block", meta: "5 min • stage: Check-in" },
                                            ].map((x) => (
                                                <div
                                                    key={x.title}
                                                    className="rounded-[18px] p-4 bg-[#F6F6F6] border border-transparent hover:border-[#DBD8D8] transition"
                                                >
                                                    <div className="font-semibold">{x.title}</div>
                                                    <div className="text-[12px] text-[#606060] mt-1">{x.meta}</div>
                                                    <div className="mt-3 h-[6px] rounded-full bg-white overflow-hidden">
                                                        <div className="h-full w-[62%] grad-progress grad-anim" />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* floating mini accent */}
                                    <div
                                        className="absolute -bottom-6 -right-6 w-28 h-28 rounded-full opacity-[0.18] blur-2xl blob-float3"
                                        style={{ background: GRADIENT }}
                                        aria-hidden="true"
                                    />
                                </div>
                            </div>
                        </div>
                    </GradientBorderCard>
                </div>
            </section>

            {/* ====== HOSTING ====== */}
            <section className="w-full px-3 md:px-6 lg:px-10 pb-20">
                <div className="max-w-[1100px] mx-auto">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                        <div>
                            <h2 className="text-[26px] md:text-[32px] font-semibold">
                                Host sessions — get 50% off
                            </h2>
                            <p className="mt-2 text-[#606060] leading-relaxed">
                                Running sessions builds the community and makes the platform better.
                                As a host, you get a discount on your plan.
                            </p>

                            <div className="mt-6 flex items-center gap-3">
                                <GradientButton to="/sessions">Host a session</GradientButton>
                                <Link
                                    to="/pricing"
                                    className="text-[14px] underline underline-offset-4 hover:opacity-80"
                                >
                                    Pricing details
                                </Link>
                            </div>
                        </div>

                        <GradientBorderCard className="h-full">
                            <div className="p-6 md:p-8">
                                <div className="text-[14px] text-[#606060]">Hosting benefits</div>
                                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {[
                                        "50% plan discount",
                                        "Higher trust & visibility",
                                        "Better accountability",
                                        "Community growth",
                                    ].map((x) => (
                                        <div
                                            key={x}
                                            className="rounded-[18px] p-4 border border-[#DBD8D8] bg-white hover:shadow-[0_10px_30px_rgba(0,0,0,0.06)] transition-shadow"
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="w-2 h-2 rounded-full grad-dot" aria-hidden="true" />
                                                <div className="text-[14px] font-semibold">{x}</div>
                                            </div>
                                            <div className="mt-2 text-[12px] text-[#606060]">
                                                Designed to reward consistency and contribution.
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </GradientBorderCard>
                    </div>
                </div>
            </section>

            {/* ====== FINAL CTA ====== */}
            <section className="w-full px-3 md:px-6 lg:px-10 pb-24">
                <div className="max-w-[1100px] mx-auto">
                    <GradientBorderCard>
                        <div className="p-8 md:p-12 text-center">
                            <h2 className="text-[26px] md:text-[34px] font-semibold">
                                Cheap, reliable, structured focus — powered by AI
                            </h2>
                            <p className="mt-3 text-[#606060] max-w-[760px] mx-auto">
                                Build a repeatable routine: intentions → check-ins → focus blocks → progress.
                                MySession makes it easy to show up and finish.
                            </p>
                            <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
                                <GradientButton to="/register">Start free</GradientButton>
                                <GradientButton to="/sessions" variant="ghost">
                                    View sessions
                                </GradientButton>
                            </div>

                            <div className="mt-10">
                                <GradientLine className="h-[10px] w-[260px] mx-auto opacity-90" />
                            </div>
                        </div>
                    </GradientBorderCard>
                </div>
            </section>

            {/* ====== local styles (no tailwind config needed) ====== */}
            <style>{`
        .grad-anim {
          animation: gradMove 6s ease-in-out infinite;
        }
        .grad-border:hover {
          filter: drop-shadow(0 16px 44px rgba(0,0,0,0.10));
        }
        .btn-shine {
          background: linear-gradient(
            110deg,
            rgba(255,255,255,0.0) 20%,
            rgba(255,255,255,0.20) 45%,
            rgba(255,255,255,0.0) 70%
          );
          transform: translateX(-60%);
          animation: shine 3.6s ease-in-out infinite;
          opacity: 0.8;
          mix-blend-mode: overlay;
        }
        .grad-dot {
          background: ${GRADIENT};
        }
        .grad-progress {
          background: ${GRADIENT};
          background-size: 220% 220%;
          border-radius: 9999px;
        }

        .blob-float { animation: float1 9s ease-in-out infinite; }
        .blob-float2 { animation: float2 11s ease-in-out infinite; }
        .blob-float3 { animation: float3 8s ease-in-out infinite; }

        @keyframes gradMove {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes shine {
          0% { transform: translateX(-70%); opacity: 0.0; }
          20% { opacity: 0.35; }
          50% { opacity: 0.20; }
          100% { transform: translateX(70%); opacity: 0.0; }
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
          .grad-anim, .btn-shine, .blob-float, .blob-float2, .blob-float3 {
            animation: none !important;
          }
        }
      `}</style>
        </main>
    );
}
