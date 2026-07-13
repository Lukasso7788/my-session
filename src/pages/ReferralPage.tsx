import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Check, Copy, Gift, Link2, Sparkles, Users } from "lucide-react";
import { supabase } from "../lib/supabase";

type ReferralRow = {
    id: string;
    status: string | null;
    registered_at: string | null;
    activated_at: string | null;
    first_paid_at: string | null;
};

type RewardRow = {
    id: string;
    type: string;
    amount_usd: number | null;
    status: string | null;
    created_at: string | null;
};

type ReferralCodeRow = {
    id?: string;
    owner_user_id?: string;
    code: string;
    type?: string;
    is_active?: boolean;
};

function formatCredits(value: number) {
    const safe = Number.isFinite(value) ? value : 0;
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(safe)} credits`;
}

function getOrigin() {
    if (typeof window === "undefined") return "https://www.mysession.club";
    return window.location.origin;
}

function normalizeRewardAmount(row: RewardRow) {
    return Number(row.amount_usd || 0);
}

async function getOrCreateReferralCode(): Promise<ReferralCodeRow | null> {
    const { data, error } = await supabase.rpc("get_or_create_referral_code");

    if (error) {
        console.error("[referrals] get_or_create_referral_code failed:", error);
        throw error;
    }

    return data as ReferralCodeRow | null;
}

export default function ReferralPage() {
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [referralCode, setReferralCode] = useState("");
    const [referrals, setReferrals] = useState<ReferralRow[]>([]);
    const [rewards, setRewards] = useState<RewardRow[]>([]);
    const [copyText, setCopyText] = useState("Copy link");
    const [error, setError] = useState("");

    const referralLink = useMemo(() => {
        if (!referralCode) return "";
        return `${getOrigin()}/?ref=${encodeURIComponent(referralCode)}`;
    }, [referralCode]);

    const stats = useMemo(() => {
        const registered = referrals.length;

        const activated = referrals.filter(
            (r) => r.status === "activated" || r.status === "paid" || !!r.activated_at
        ).length;

        const paid = referrals.filter((r) => r.status === "paid" || !!r.first_paid_at).length;

        const creditRewards = rewards.filter((r) =>
            [
                "invitation_activation",
                "referral_credit",
                "manual_adjustment",
            ].includes(String(r.type || ""))
        );

        const pendingCredits = creditRewards
            .filter((r) => String(r.status || "").toLowerCase() === "pending")
            .reduce((sum, r) => sum + normalizeRewardAmount(r), 0);

        const availableCredits = creditRewards
            .filter((r) => String(r.status || "").toLowerCase() === "available")
            .reduce((sum, r) => sum + normalizeRewardAmount(r), 0);

        const usedCredits = creditRewards
            .filter((r) => ["used", "paid", "paid_out"].includes(String(r.status || "").toLowerCase()))
            .reduce((sum, r) => sum + normalizeRewardAmount(r), 0);

        const lifetimeCredits = creditRewards.reduce(
            (sum, r) => sum + normalizeRewardAmount(r),
            0
        );

        return {
            registered,
            activated,
            paid,
            pendingCredits,
            availableCredits,
            usedCredits,
            lifetimeCredits,
        };
    }, [referrals, rewards]);

    const loadReferralPage = async () => {
        try {
            setLoading(true);
            setError("");

            const { data: authData } = await supabase.auth.getUser();
            const user = authData?.user;

            if (!user) {
                navigate("/login", { replace: true });
                return;
            }

            const codeRow = await getOrCreateReferralCode();
            const code = String(codeRow?.code || "").trim();

            if (!code) {
                throw new Error("Could not create your referral code.");
            }

            setReferralCode(code);

            const [referralsResult, rewardsResult] = await Promise.all([
                supabase
                    .from("referrals")
                    .select("id, status, registered_at, activated_at, first_paid_at")
                    .eq("referrer_user_id", user.id)
                    .order("registered_at", { ascending: false }),

                supabase
                    .from("reward_ledger")
                    .select("id, type, amount_usd, status, created_at")
                    .eq("user_id", user.id)
                    .order("created_at", { ascending: false }),
            ]);

            if (referralsResult.error) {
                console.warn("[referrals] load referrals failed:", referralsResult.error);
                setReferrals([]);
            } else {
                setReferrals((referralsResult.data as ReferralRow[]) || []);
            }

            if (rewardsResult.error) {
                console.warn("[referrals] load rewards failed:", rewardsResult.error);
                setRewards([]);
            } else {
                setRewards((rewardsResult.data as RewardRow[]) || []);
            }
        } catch (e: any) {
            console.error("[referrals] load failed:", e);
            setError(String(e?.message || e || "Failed to load Referral Program."));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadReferralPage();
    }, []);

    const handleCopy = async () => {
        if (!referralLink) return;

        try {
            await navigator.clipboard.writeText(referralLink);
            setCopyText("Copied");
            window.setTimeout(() => setCopyText("Copy link"), 1400);
        } catch {
            setCopyText("Copy failed");
            window.setTimeout(() => setCopyText("Copy link"), 1400);
        }
    };

    if (loading) {
        return (
            <main className="min-h-screen bg-white px-6 py-16 font-inter text-[#2F2F2F]">
                <div className="mx-auto max-w-5xl text-center">
                    <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-black" />
                </div>
            </main>
        );
    }

    return (
        <main className="relative min-h-screen overflow-hidden bg-[#F4F6F1] px-4 py-6 font-inter text-[#17201B] sm:px-6 sm:py-10">
            <div className="pointer-events-none absolute -left-24 top-40 h-72 w-72 rounded-full bg-[#CFF8D8]/60 blur-3xl" />
            <div className="pointer-events-none absolute -right-24 top-0 h-80 w-80 rounded-full bg-[#DCE8FF]/70 blur-3xl" />

            <div className="relative mx-auto max-w-6xl">
                <div className="mb-5 flex items-center justify-between gap-4">
                    <div className="inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.14em] text-[#526158]">
                        <Sparkles className="h-4 w-4 text-[#2E7D50]" />
                        MySession Referral Program
                    </div>
                    <Link
                        to="/affiliate"
                        className="rounded-full border border-[#17201B]/15 bg-white/70 px-4 py-2 text-center text-[13px] font-semibold backdrop-blur transition hover:bg-white"
                    >
                        Looking for cash rewards? <span className="hidden sm:inline">Affiliate Program</span>
                    </Link>
                </div>

                <section className="relative overflow-hidden rounded-[32px] bg-[#17231D] px-5 py-7 text-white shadow-[0_24px_70px_rgba(23,35,29,0.18)] sm:px-8 sm:py-10 lg:px-12">
                    <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-[#74E69A]/20 blur-2xl" />
                    <div className="relative grid gap-9 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
                        <div>
                            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-[#DDF9E5]">
                                <Users className="h-4 w-4" /> Made for friends, not sales pitches
                            </div>
                            <h1 className="mt-5 max-w-2xl text-[38px] font-bold leading-[1.05] tracking-[-0.04em] sm:text-[52px]">
                                Invite a friend. Make focus easier together.
                            </h1>
                            <p className="mt-5 max-w-xl text-[16px] leading-7 text-white/70">
                                Give someone a place to show up and focus with you. When your referral qualifies,
                                you receive MySession credits to use inside the product.
                            </p>
                            <div className="mt-6 flex flex-wrap gap-2 text-[12px] font-semibold text-white/80">
                                <span className="rounded-full bg-white/10 px-3 py-2">One link</span>
                                <span className="rounded-full bg-white/10 px-3 py-2">A shared focus habit</span>
                                <span className="rounded-full bg-white/10 px-3 py-2">No cash awkwardness</span>
                            </div>
                        </div>

                        <div className="rounded-[26px] border border-white/10 bg-white/[0.07] p-5 backdrop-blur sm:p-6">
                            <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#9FE7B4]">A shared win</div>
                            <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                                <div className="rounded-2xl bg-white p-4 text-[#17201B]">
                                    <Users className="h-5 w-5 text-[#2E7D50]" />
                                    <div className="mt-3 text-[12px] font-bold uppercase tracking-[0.1em] text-[#718078]">Your friend gets</div>
                                    <div className="mt-1 text-[15px] font-bold">A place to focus with you</div>
                                </div>
                                <ArrowRight className="mx-auto h-5 w-5 rotate-90 text-white/40 sm:rotate-0" />
                                <div className="rounded-2xl bg-[#CFF8D8] p-4 text-[#173522]">
                                    <Gift className="h-5 w-5 text-[#2E7D50]" />
                                    <div className="mt-3 text-[12px] font-bold uppercase tracking-[0.1em] text-[#467557]">You get</div>
                                    <div className="mt-1 text-[15px] font-bold">MySession credits</div>
                                </div>
                            </div>
                            <p className="mt-4 text-[12px] leading-5 text-white/55">
                                Credits can be used for MySession subscriptions and upgrades. They are not cash payouts.
                            </p>
                        </div>
                    </div>
                </section>

                {error ? (
                    <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</div>
                ) : null}

                <section className="mt-6 grid gap-5 rounded-[28px] border border-black/[0.07] bg-white/90 p-5 shadow-sm backdrop-blur sm:p-7 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
                    <div>
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#E9F8ED] text-[#2E7D50]">
                            <Link2 className="h-5 w-5" />
                        </div>
                        <h2 className="mt-4 text-[26px] font-bold tracking-[-0.02em]">Your personal invite</h2>
                        <p className="mt-2 max-w-md text-[14px] leading-6 text-[#68736C]">
                            Send it directly to someone you would genuinely like to see in your next focus session.
                        </p>
                    </div>
                    <div className="rounded-[22px] border border-black/[0.07] bg-[#F7F8F5] p-3 sm:p-4">
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#718078]">Code: {referralCode || "—"}</span>
                            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[#718078]">Personal</span>
                        </div>
                        <div className="mt-3 break-all rounded-2xl bg-white px-4 py-3 text-[13px] font-medium text-[#334139]">{referralLink || "No referral link yet"}</div>
                        <button
                            type="button"
                            onClick={handleCopy}
                            disabled={!referralLink}
                            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#17231D] px-4 py-3 text-[13px] font-semibold text-white transition hover:bg-[#26382E] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                        >
                            <Copy className="h-4 w-4" /> {copyText}
                        </button>
                    </div>
                </section>

                <section className="mt-6 grid gap-3 md:grid-cols-3">
                    {[
                        ["01", "Share your link", "Choose a friend who would benefit from a regular focus ritual."],
                        ["02", "They join MySession", "Their registration and activity are connected to your invite."],
                        ["03", "Credits appear", "Qualifying referral rewards are added to your MySession balance."],
                    ].map(([number, title, body]) => (
                        <div key={number} className="rounded-[24px] border border-black/[0.07] bg-white/75 p-5">
                            <div className="text-[12px] font-bold text-[#2E7D50]">{number}</div>
                            <h3 className="mt-4 text-[18px] font-bold">{title}</h3>
                            <p className="mt-2 text-[13px] leading-6 text-[#68736C]">{body}</p>
                        </div>
                    ))}
                </section>

                <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {[
                        ["Friends invited", stats.registered],
                        ["Activated", stats.activated],
                        ["Available", formatCredits(stats.availableCredits)],
                        ["Lifetime credits", formatCredits(stats.lifetimeCredits)],
                    ].map(([label, value], index) => (
                        <div key={label} className={`rounded-[22px] border p-5 ${index === 2 ? "border-[#A8E8B9] bg-[#E9F8ED]" : "border-black/[0.07] bg-white"}`}>
                            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#718078]">{label}</div>
                            <div className="mt-2 text-[23px] font-bold tracking-[-0.02em] sm:text-[28px]">{value}</div>
                        </div>
                    ))}
                </section>

                <section className="mt-8 grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
                    <div className="rounded-[28px] border border-black/[0.07] bg-white p-6 sm:p-7">
                        <div className="flex items-center gap-3">
                            <Gift className="h-6 w-6 text-[#2E7D50]" />
                            <h2 className="text-[24px] font-bold">What the credits are for</h2>
                        </div>
                        <div className="mt-5 space-y-3">
                            {["Apply them to a MySession subscription", "Use them toward product upgrades", "Keep friendship and cash rewards separate"].map((item) => (
                                <div key={item} className="flex items-center gap-3 rounded-2xl bg-[#F6F8F4] px-4 py-3 text-[14px] font-medium">
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#D9F4E0] text-[#2E7D50]"><Check className="h-4 w-4" /></span>
                                    {item}
                                </div>
                            ))}
                        </div>
                        <div className="mt-5 flex flex-wrap gap-2 text-[12px] text-[#68736C]">
                            <span className="rounded-full border border-black/10 px-3 py-1.5">Pending: {formatCredits(stats.pendingCredits)}</span>
                            <span className="rounded-full border border-black/10 px-3 py-1.5">Used: {formatCredits(stats.usedCredits)}</span>
                        </div>
                    </div>

                    <div className="rounded-[28px] bg-[#E8EEF9] p-6 sm:p-7">
                        <h2 className="text-[24px] font-bold">Need a business incentive?</h2>
                        <p className="mt-3 text-[14px] leading-6 text-[#596576]">
                            The Affiliate Program is built for creators and community partners who actively promote MySession and want cash payouts.
                        </p>
                        <Link to="/affiliate" className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#253B65] px-5 py-3 text-[13px] font-semibold text-white">
                            Explore Affiliate Program <ArrowRight className="h-4 w-4" />
                        </Link>
                    </div>
                </section>

                <section className="mt-8 rounded-[28px] border border-black/[0.07] bg-white p-5 sm:p-7">
                    <h2 className="text-[24px] font-bold">Recent credit activity</h2>
                    <p className="mt-2 text-[14px] leading-6 text-[#68736C]">Referral rewards and manual credit adjustments appear here.</p>
                    <div className="mt-5 overflow-hidden rounded-2xl border border-black/[0.07]">
                        {rewards.length ? rewards.slice(0, 8).map((reward) => (
                            <div key={reward.id} className="flex flex-col gap-2 border-b border-black/[0.07] px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <div className="text-[14px] font-bold">{reward.type}</div>
                                    <div className="mt-1 text-[12px] text-[#718078]">{reward.created_at ? new Date(reward.created_at).toLocaleString() : "No date"}</div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="text-[15px] font-bold">{formatCredits(normalizeRewardAmount(reward))}</div>
                                    <div className="rounded-full bg-[#F1F3EF] px-3 py-1 text-[12px] font-semibold text-[#68736C]">{reward.status || "unknown"}</div>
                                </div>
                            </div>
                        )) : <div className="px-4 py-9 text-center text-[14px] text-[#718078]">No credit activity yet. Your first invite starts here.</div>}
                    </div>
                </section>
            </div>
        </main>
    );
}
