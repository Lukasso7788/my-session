import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BarChart3, Check, Copy, Megaphone, TrendingUp, Wallet } from "lucide-react";
import { supabase } from "../lib/supabase";

type PartnerStatus = "none" | "pending" | "active" | "approved" | "suspended";
type PartnerTier = "none" | "partner" | "approved_community_partner" | "strategic_partner";

type PartnerProfile = {
    id: string;
    user_id: string;
    tier: PartnerTier | string;
    status: PartnerStatus | string;
    subscribed_user_reward_usd?: number | null;
    revenue_share_percent?: number | null;
    revenue_share_label?: string | null;
    revenue_share_months?: number | null;
    special_launch_reward_label?: string | null;
    application_note: string | null;
    approved_at: string | null;
    notes: string | null;
};

type ReferralRow = {
    id: string;
    status: string | null;
    registered_at: string | null;
    activated_at: string | null;
    first_paid_at: string | null;
    affiliate_terms_version?: string | null;
};

type RewardRow = {
    id: string;
    referral_id?: string | null;
    type: string;
    amount_usd: number | null;
    status: string | null;
    created_at: string | null;
    available_at: string | null;
};

type PayoutRequestRow = {
    id: string;
    amount_usd: number | null;
    status: string | null;
    requested_at: string | null;
    resolved_at: string | null;
};

type ReferralCodeRow = {
    id?: string;
    owner_user_id?: string;
    user_id?: string;
    code: string;
    type?: string;
    is_active?: boolean;
};

const AFFILIATE_REWARD_TYPES = [
    "first_payment_bonus",
    "affiliate_first_payment",
    "affiliate_paid",
    "partner_paid",
    "partner_revenue_share",
    "partner_revenue_share_reversal",
    "manual_adjustment",
];

const CURRENT_AFFILIATE_TERMS_VERSION = "partner_50pct_6mo_v1";
const AFFILIATE_REVENUE_SHARE_PERCENT = 50;
const AFFILIATE_REVENUE_SHARE_MONTHS = 6;
const AFFILIATE_MAX_PER_MEMBER_USD = 30;

function addUtcMonths(value: string, months: number) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    const targetMonthIndex = date.getUTCMonth() + months;
    const targetYear = date.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
    const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
    const targetDay = Math.min(
        date.getUTCDate(),
        new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
    );

    return new Date(Date.UTC(
        targetYear,
        targetMonth,
        targetDay,
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds(),
        date.getUTCMilliseconds()
    ));
}

function revenueShareMonthsRemaining(firstPaidAt: string | null) {
    if (!firstPaidAt) return AFFILIATE_REVENUE_SHARE_MONTHS;

    const end = addUtcMonths(firstPaidAt, AFFILIATE_REVENUE_SHARE_MONTHS);
    if (!end) return 0;

    const remainingMs = end.getTime() - Date.now();
    if (remainingMs <= 0) return 0;

    const averageMonthMs = (365.2425 / 12) * 24 * 60 * 60 * 1000;
    return Math.min(
        AFFILIATE_REVENUE_SHARE_MONTHS,
        Math.max(1, Math.ceil(remainingMs / averageMonthMs))
    );
}

function formatMoney(value: number) {
    const safe = Number.isFinite(value) ? value : 0;

    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
    }).format(safe);
}

function formatDate(value: string | null) {
    if (!value) return "—";

    try {
        return new Date(value).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    } catch {
        return "—";
    }
}

function formatTier(tier: string) {
    if (tier === "partner") return "Partner";
    if (tier === "approved_community_partner") return "Approved Community Partner";
    if (tier === "strategic_partner") return "Strategic Partner";
    return "Not active";
}

function normalizeStatus(status: string) {
    const value = String(status || "none").toLowerCase();
    if (value === "approved") return "active";
    return value;
}

function getTierBadgeClass(tier: string) {
    if (tier === "strategic_partner") return "bg-purple-100 text-purple-700";
    if (tier === "approved_community_partner") return "bg-blue-100 text-blue-700";
    if (tier === "partner") return "bg-green-100 text-green-700";
    return "bg-gray-100 text-gray-700";
}

function getStatusBadgeClass(status: string) {
    if (status === "active" || status === "approved") return "bg-green-100 text-green-700";
    if (status === "pending") return "bg-amber-100 text-amber-700";
    if (status === "suspended") return "bg-red-100 text-red-700";
    return "bg-gray-100 text-gray-700";
}

function getReferralStatusBadgeClass(status: string) {
    if (status === "paid") return "bg-green-100 text-green-700";
    if (status === "activated") return "bg-blue-100 text-blue-700";
    if (status === "registered") return "bg-gray-100 text-gray-700";
    return "bg-gray-100 text-gray-700";
}

function getOrigin() {
    if (typeof window === "undefined") return "https://www.mysession.club";
    return window.location.origin;
}

async function getOrCreateReferralCode(): Promise<ReferralCodeRow | null> {
    const { data, error } = await supabase.rpc("get_or_create_referral_code");

    if (error) {
        console.error("[affiliate] get_or_create_referral_code failed:", error);
        throw error;
    }

    return data as ReferralCodeRow | null;
}

async function loadPartnerProfile(userId: string) {
    const { data, error } = await supabase
        .from("partner_profiles")
        .select(
            "id, user_id, tier, status, subscribed_user_reward_usd, revenue_share_percent, revenue_share_label, revenue_share_months, special_launch_reward_label, application_note, approved_at, notes"
        )
        .eq("user_id", userId)
        .maybeSingle();

    if (error) throw error;
    return (data as PartnerProfile) || null;
}

async function loadRewards(userId: string) {
    const byUserId = await supabase
        .from("reward_ledger")
        .select("id, referral_id, type, amount_usd, status, created_at, available_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

    if (!byUserId.error) return (byUserId.data as RewardRow[]) || [];

    console.warn("[affiliate] reward_ledger user_id load failed, trying referrer_user_id:", byUserId.error);

    const byReferrerUserId = await supabase
        .from("reward_ledger")
        .select("id, referral_id, type, amount_usd, status, created_at, available_at")
        .eq("referrer_user_id", userId)
        .order("created_at", { ascending: false });

    if (byReferrerUserId.error) throw byReferrerUserId.error;
    return (byReferrerUserId.data as RewardRow[]) || [];
}

async function loadPayoutRequests(userId: string) {
    const affiliatePayouts = await supabase
        .from("affiliate_payout_requests")
        .select("id, amount_usd, status, requested_at, resolved_at")
        .eq("user_id", userId)
        .order("requested_at", { ascending: false });

    if (!affiliatePayouts.error) return (affiliatePayouts.data as PayoutRequestRow[]) || [];

    console.warn("[affiliate] affiliate_payout_requests load failed, trying payout_requests:", affiliatePayouts.error);

    const payouts = await supabase
        .from("payout_requests")
        .select("id, amount_usd, status, requested_at, resolved_at")
        .eq("user_id", userId)
        .order("requested_at", { ascending: false });

    if (payouts.error) throw payouts.error;
    return (payouts.data as PayoutRequestRow[]) || [];
}

export default function AffiliatePage() {
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState("");
    const [partnerProfile, setPartnerProfile] = useState<PartnerProfile | null>(null);
    const [referralCode, setReferralCode] = useState("");
    const [referrals, setReferrals] = useState<ReferralRow[]>([]);
    const [rewards, setRewards] = useState<RewardRow[]>([]);
    const [payoutRequests, setPayoutRequests] = useState<PayoutRequestRow[]>([]);

    const [applicationNote, setApplicationNote] = useState("");
    const [applying, setApplying] = useState(false);
    const [copyText, setCopyText] = useState("Copy link");
    const [showDetails, setShowDetails] = useState(false);
    const [payoutBusy, setPayoutBusy] = useState(false);
    const [error, setError] = useState("");

    const rawStatus = String(partnerProfile?.status || "none").toLowerCase();
    const status = normalizeStatus(rawStatus);
    const tier = String(partnerProfile?.tier || "none").toLowerCase();
    const isActive = status === "active";

    const referralLink = useMemo(() => {
        if (!referralCode) return "";
        return `${getOrigin()}/?ref=${encodeURIComponent(referralCode)}`;
    }, [referralCode]);

    const affiliateRewards = useMemo(() => {
        return rewards.filter((r) => AFFILIATE_REWARD_TYPES.includes(String(r.type || "")));
    }, [rewards]);

    const stats = useMemo(() => {
        const registered = referrals.length;

        const activated = referrals.filter(
            (r) => r.status === "activated" || r.status === "paid" || !!r.activated_at
        ).length;

        const paid = referrals.filter((r) => r.status === "paid" || !!r.first_paid_at).length;

        const pendingRewards = affiliateRewards
            .filter((r) => String(r.status || "").toLowerCase() === "pending")
            .reduce((sum, r) => sum + Number(r.amount_usd || 0), 0);

        const availableRewards = affiliateRewards
            .filter((r) => String(r.status || "").toLowerCase() === "available")
            .reduce((sum, r) => sum + Number(r.amount_usd || 0), 0);

        const paidOutRewards = affiliateRewards
            .filter((r) => ["paid", "paid_out"].includes(String(r.status || "").toLowerCase()))
            .reduce((sum, r) => sum + Number(r.amount_usd || 0), 0);

        const totalRewards = affiliateRewards.reduce(
            (sum, r) => sum + Number(r.amount_usd || 0),
            0
        );

        return {
            registered,
            activated,
            paid,
            pendingRewards,
            availableRewards,
            paidOutRewards,
            totalRewards,
        };
    }, [referrals, affiliateRewards]);

    const loadAffiliate = async () => {
        try {
            setLoading(true);
            setError("");

            const { data: authData } = await supabase.auth.getUser();
            const user = authData?.user;

            if (!user) {
                navigate("/login", { replace: true });
                return;
            }

            setUserId(user.id);

            const codeRow = await getOrCreateReferralCode();
            setReferralCode(String(codeRow?.code || ""));

            const [partnerResult, referralsResult, rewardsResult, payoutsResult] = await Promise.allSettled([
                loadPartnerProfile(user.id),

                supabase
                    .from("referrals")
                    .select("id, status, registered_at, activated_at, first_paid_at, affiliate_terms_version")
                    .eq("referrer_user_id", user.id)
                    .order("registered_at", { ascending: false }),

                loadRewards(user.id),

                loadPayoutRequests(user.id),
            ]);

            if (partnerResult.status === "fulfilled") {
                setPartnerProfile(partnerResult.value);
                setApplicationNote(String(partnerResult.value?.application_note || ""));
            } else {
                console.warn("[affiliate] partner profile load failed:", partnerResult.reason);
                setPartnerProfile(null);
            }

            if (referralsResult.status === "fulfilled") {
                const result = referralsResult.value;

                if (result.error) {
                    console.warn("[affiliate] referrals load failed:", result.error);
                    setReferrals([]);
                } else {
                    setReferrals((result.data as ReferralRow[]) || []);
                }
            } else {
                console.warn("[affiliate] referrals load failed:", referralsResult.reason);
                setReferrals([]);
            }

            if (rewardsResult.status === "fulfilled") {
                setRewards(rewardsResult.value);
            } else {
                console.warn("[affiliate] rewards load failed:", rewardsResult.reason);
                setRewards([]);
            }

            if (payoutsResult.status === "fulfilled") {
                setPayoutRequests(payoutsResult.value);
            } else {
                console.warn("[affiliate] payouts load failed:", payoutsResult.reason);
                setPayoutRequests([]);
            }
        } catch (e: any) {
            console.error("[affiliate] load failed:", e);
            setError(String(e?.message || e || "Failed to load affiliate program."));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadAffiliate();
    }, []);

    const handleApply = async (event?: FormEvent<HTMLFormElement>) => {
        event?.preventDefault();

        if (!userId || applying || status === "pending" || isActive) return;

        try {
            setApplying(true);
            setError("");

            const now = new Date().toISOString();
            const note = applicationNote.trim();

            const existing = await supabase
                .from("partner_profiles")
                .select("id")
                .eq("user_id", userId)
                .maybeSingle();

            if (existing.error) throw existing.error;

            if (existing.data?.id) {
                const { error: updateError } = await supabase
                    .from("partner_profiles")
                    .update({
                        tier: "partner",
                        status: "pending",
                        application_note: note || null,
                        subscribed_user_reward_usd: 0,
                        revenue_share_percent: AFFILIATE_REVENUE_SHARE_PERCENT,
                        revenue_share_label: "50% for first 6 months (up to $30)",
                        revenue_share_months: AFFILIATE_REVENUE_SHARE_MONTHS,
                        updated_at: now,
                    })
                    .eq("user_id", userId);

                if (updateError) throw updateError;
            } else {
                const { error: insertError } = await supabase.from("partner_profiles").insert({
                    user_id: userId,
                    tier: "partner",
                    status: "pending",
                    application_note: note || null,
                    subscribed_user_reward_usd: 0,
                    revenue_share_percent: AFFILIATE_REVENUE_SHARE_PERCENT,
                    revenue_share_label: "50% for first 6 months (up to $30)",
                    revenue_share_months: AFFILIATE_REVENUE_SHARE_MONTHS,
                    created_at: now,
                    updated_at: now,
                });

                if (insertError) throw insertError;
            }

            await loadAffiliate();
            setShowDetails(false);
        } catch (e: any) {
            console.error("[affiliate] apply failed:", e);
            setError(String(e?.message || e || "Failed to apply."));
        } finally {
            setApplying(false);
        }
    };

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

    const handleAskForPayout = async () => {
        if (!userId) return;

        if (stats.availableRewards < 20) {
            setError("Minimum payout is $20 available balance.");
            return;
        }

        try {
            setPayoutBusy(true);
            setError("");

            const payload = {
                user_id: userId,
                amount_usd: Number(stats.availableRewards.toFixed(2)),
                status: "requested",
                note: "Affiliate payout requested from affiliate dashboard.",
                requested_at: new Date().toISOString(),
            };

            const affiliatePayout = await supabase.from("affiliate_payout_requests").insert(payload);

            if (affiliatePayout.error) {
                console.warn("[affiliate] affiliate_payout_requests insert failed, trying payout_requests:", affiliatePayout.error);

                const fallbackPayout = await supabase.from("payout_requests").insert(payload);
                if (fallbackPayout.error) throw fallbackPayout.error;
            }

            await loadAffiliate();
        } catch (e: any) {
            console.error("[affiliate] payout request failed:", e);
            setError(String(e?.message || e || "Failed to request payout."));
        } finally {
            setPayoutBusy(false);
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
        <main className="relative min-h-screen overflow-hidden bg-[#F3F5F8] px-4 py-6 font-inter text-[#172033] sm:px-6 sm:py-10">
            <div className="pointer-events-none absolute -left-32 top-20 h-96 w-96 rounded-full bg-[#DDE7FF] blur-3xl" />
            <div className="pointer-events-none absolute -right-24 top-72 h-80 w-80 rounded-full bg-[#D8F4E1]/70 blur-3xl" />
            <div className="relative mx-auto max-w-6xl">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.14em] text-[#5C6980]">
                        <TrendingUp className="h-4 w-4 text-[#335DC5]" /> MySession Affiliate Program
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Link to="/referrals" className="rounded-full border border-[#172033]/10 bg-white/70 px-4 py-2 text-[13px] font-semibold backdrop-blur transition hover:bg-white">
                            Inviting friends? Referral Program
                        </Link>
                        {isActive && (
                            <button type="button" onClick={() => setShowDetails((v) => !v)} className="rounded-full bg-[#172033] px-4 py-2 text-[13px] font-semibold text-white">
                                {showDetails ? "View dashboard" : "Program details"}
                            </button>
                        )}
                    </div>
                </div>

                <section className="relative overflow-hidden rounded-[32px] bg-[#18233D] px-5 py-7 text-white shadow-[0_24px_70px_rgba(24,35,61,0.2)] sm:px-8 sm:py-10 lg:px-12">
                    <div className="absolute -right-20 -top-28 h-80 w-80 rounded-full bg-[#5D86FF]/30 blur-3xl" />
                    <div className="relative grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
                        <div>
                            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-[#C9D7FF]">
                                <Megaphone className="h-4 w-4" /> For creators, hosts and community partners
                            </div>
                            <h1 className="mt-5 max-w-2xl text-[38px] font-bold leading-[1.05] tracking-[-0.04em] sm:text-[52px]">
                                Turn your audience into trackable revenue.
                            </h1>
                            <p className="mt-5 max-w-xl text-[16px] leading-7 text-white/70">
                                Share MySession with people who will use it. Earn 50% of every subscription payment from members you refer for their first 6 months. That's up to $30 per paying member.
                            </p>
                            <div className="mt-6 flex flex-wrap gap-2 text-[12px] font-semibold text-white/80">
                                <span className="rounded-full bg-white/10 px-3 py-2">Trackable partner link</span>
                                <span className="rounded-full bg-white/10 px-3 py-2">Real cash balance</span>
                                <span className="rounded-full bg-white/10 px-3 py-2">Manual payouts from $20</span>
                            </div>
                        </div>

                        <div className="rounded-[26px] border border-white/10 bg-white/[0.07] p-5 backdrop-blur sm:p-6">
                            <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#AFC3FF]">Standard revenue share</div>
                            <div className="mt-2 flex items-end gap-3">
                                <div className="text-[58px] font-bold leading-none tracking-[-0.05em]">50%</div>
                                <div className="pb-1 text-[13px] leading-5 text-white/55">of every paid subscription charge<br />for the first 6 months</div>
                            </div>
                            <div className="mt-6 grid grid-cols-3 gap-2">
                                {[1, 5, 10].map((count) => (
                                    <div key={count} className="rounded-2xl bg-white/10 p-3 text-center">
                                        <div className="text-[11px] text-white/55">{count} {count === 1 ? "member" : "members"} max</div>
                                        <div className="mt-1 text-[18px] font-bold">{formatMoney(AFFILIATE_MAX_PER_MEMBER_USD * count)}</div>
                                    </div>
                                ))}
                            </div>
                            <p className="mt-4 text-[12px] leading-5 text-white/50">Earn 50% of every subscription payment from members you refer for their first 6 months. That's up to $30 per paying member.</p>
                        </div>
                    </div>
                </section>

                {error ? (
                    <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                        {error}
                    </div>
                ) : null}

                {isActive && !showDetails ? (
                    <>
                        <section className="mt-6 rounded-[28px] border border-black/[0.07] bg-white/90 p-5 shadow-sm backdrop-blur sm:p-7">
                            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className={`rounded-full px-3 py-1 text-[12px] font-bold ${getTierBadgeClass(tier)}`}>
                                            {formatTier(tier)}
                                        </span>
                                        <span className={`rounded-full px-3 py-1 text-[12px] font-bold ${getStatusBadgeClass(status)}`}>
                                            {status}
                                        </span>
                                    </div>

                                    <h2 className="mt-4 text-[26px] font-bold tracking-[-0.02em]">Your affiliate dashboard</h2>
                                    <p className="mt-2 max-w-xl text-[14px] leading-6 text-[#68738A]">
                                        Share your partner link. Earn 50% of every successful subscription payment from each referred member during their first 6 paid months, up to $30 per member.
                                    </p>
                                </div>

                                <div className="rounded-[22px] border border-black/[0.07] bg-[#F4F6FA] p-4 lg:min-w-[440px]">
                                    <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                        Partner code
                                    </div>
                                    <div className="mt-2 text-[20px] font-bold">{referralCode || "—"}</div>

                                    <div className="mt-4 text-[12px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                        Partner link
                                    </div>
                                    <div className="mt-2 break-all rounded-xl bg-white p-3 text-[14px] font-medium text-[#34405A]">
                                        {referralLink || "Generating link..."}
                                    </div>

                                    <button
                                        type="button"
                                        onClick={handleCopy}
                                        disabled={!referralLink}
                                        className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#335DC5] px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
                                    >
                                        <Copy className="h-4 w-4" /> {copyText}
                                    </button>
                                </div>
                            </div>
                        </section>

                        <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            {[
                                ["Registered referrals", stats.registered],
                                ["Activated referrals", stats.activated],
                                ["Subscribed referrals", stats.paid],
                                ["Payable balance", formatMoney(stats.availableRewards)],
                                ["Pending rewards", formatMoney(stats.pendingRewards)],
                                ["Paid out", formatMoney(stats.paidOutRewards)],
                                ["Total affiliate rewards", formatMoney(stats.totalRewards)],
                                ["Payout requests", payoutRequests.length],
                            ].map(([label, value]) => (
                                <div key={label} className="rounded-[22px] border border-black/[0.07] bg-white p-5 shadow-sm">
                                    <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                        {label}
                                    </div>
                                    <div className="mt-2 text-[28px] font-bold">{value}</div>
                                </div>
                            ))}
                        </section>

                        <section className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                            <div className="rounded-[28px] border border-black/[0.07] bg-white p-6 shadow-sm">
                                <div className="flex items-center gap-3">
                                    <BarChart3 className="h-6 w-6 text-[#335DC5]" />
                                    <h2 className="text-[24px] font-bold">How a reward is earned</h2>
                                </div>
                                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                                    {[
                                        ["01", "Share", "Use your trackable partner link."],
                                        ["02", "Convert", "A referred member makes a successful paid charge after any free trial."],
                                        ["03", "Earn", "Receive 50% of qualifying payments for 6 months, up to $30 per paying member."],
                                    ].map(([number, title, body]) => (
                                        <div key={number} className="rounded-2xl bg-[#F4F6FA] p-4">
                                            <div className="text-[11px] font-bold text-[#335DC5]">{number}</div>
                                            <div className="mt-3 text-[15px] font-bold">{title}</div>
                                            <p className="mt-1 text-[12px] leading-5 text-[#68738A]">{body}</p>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-4 flex items-start gap-3 rounded-2xl border border-[#DCE5FA] bg-[#F6F8FD] p-4 text-[13px] leading-5 text-[#53617A]">
                                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#335DC5]" />
                                    Affiliate rewards are real payout-trackable money. Friend-to-friend MySession credits stay in the separate Referral Program.
                                </div>
                            </div>

                            <div className="rounded-[28px] bg-[#E7ECF8] p-6">
                                <Wallet className="h-7 w-7 text-[#335DC5]" />
                                <h2 className="mt-4 text-[24px] font-bold">Payout</h2>
                                <p className="mt-2 text-[14px] leading-6 text-[#59667D]">
                                    Payouts are manual for now. Minimum payout is $20 available balance.
                                </p>

                                <button
                                    type="button"
                                    onClick={handleAskForPayout}
                                    disabled={payoutBusy || stats.availableRewards < 20}
                                    className="mt-5 rounded-full bg-[#335DC5] px-5 py-2.5 text-[14px] font-semibold text-white disabled:opacity-50"
                                >
                                    {payoutBusy ? "Requesting..." : "Ask for payout"}
                                </button>

                                <div className="mt-5 space-y-2">
                                    {payoutRequests.length === 0 ? (
                                        <div className="rounded-2xl border border-black/10 bg-white px-4 py-4 text-[14px] text-[#666]">
                                            No payout requests yet.
                                        </div>
                                    ) : (
                                        payoutRequests.map((p) => (
                                            <div key={p.id} className="flex items-center justify-between rounded-2xl border border-black/10 bg-white px-4 py-3">
                                                <div className="font-semibold">{formatMoney(Number(p.amount_usd || 0))}</div>
                                                <div className="rounded-full bg-amber-100 px-3 py-1 text-[12px] font-bold text-amber-700">
                                                    {p.status || "requested"}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </section>

                        <section className="mt-8 rounded-[28px] border border-black/10 bg-white p-6 shadow-sm">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                                <div>
                                    <h2 className="text-[24px] font-bold">Referred users</h2>
                                    <p className="mt-2 text-[14px] leading-6 text-[#666]">
                                        These are users assigned to your partner link.
                                    </p>
                                </div>
                                <div className="text-[13px] font-semibold text-[#666]">
                                    {stats.paid} paid / {stats.registered} registered
                                </div>
                            </div>

                            <div className="mt-5 overflow-hidden rounded-2xl border border-black/10">
                                {referrals.length ? (
                                    referrals.slice(0, 12).map((referral) => {
                                        const referralStatus = referral.first_paid_at
                                            ? "paid"
                                            : referral.activated_at
                                                ? "activated"
                                                : String(referral.status || "registered").toLowerCase();
                                        const referralRewards = affiliateRewards.filter(
                                            (reward) => reward.referral_id === referral.id
                                        );
                                        const referralEarnings = referralRewards.reduce(
                                            (sum, reward) => sum + Number(reward.amount_usd || 0),
                                            0
                                        );
                                        const referralPending = referralRewards
                                            .filter((reward) => String(reward.status || "").toLowerCase() === "pending")
                                            .reduce((sum, reward) => sum + Number(reward.amount_usd || 0), 0);
                                        const referralPayable = referralRewards
                                            .filter((reward) => String(reward.status || "").toLowerCase() === "available")
                                            .reduce((sum, reward) => sum + Number(reward.amount_usd || 0), 0);
                                        const usesCurrentTerms =
                                            referral.affiliate_terms_version === CURRENT_AFFILIATE_TERMS_VERSION;
                                        const monthsRemaining = usesCurrentTerms
                                            ? revenueShareMonthsRemaining(referral.first_paid_at)
                                            : null;

                                        return (
                                            <div
                                                key={referral.id}
                                                className="flex flex-col gap-3 border-b border-black/10 px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                                            >
                                                <div>
                                                    <div className="text-[14px] font-bold text-[#2F2F2F]">
                                                        Referral #{referral.id.slice(0, 8)}
                                                    </div>
                                                    <div className="mt-1 text-[12px] text-[#777]">
                                                        Registered: {formatDate(referral.registered_at)}
                                                    </div>
                                                </div>

                                                <div className="flex flex-wrap items-center justify-end gap-2">
                                                    <span className={`rounded-full px-3 py-1 text-[12px] font-bold ${getReferralStatusBadgeClass(referralStatus)}`}>
                                                        {referralStatus}
                                                    </span>
                                                    {referral.first_paid_at ? (
                                                        <span className="rounded-full bg-green-50 px-3 py-1 text-[12px] font-bold text-green-700">
                                                            Paid {formatDate(referral.first_paid_at)}
                                                        </span>
                                                    ) : null}
                                                    <span className="rounded-full bg-[#F4F6FA] px-3 py-1 text-[12px] font-semibold text-[#53617A]">
                                                        Earned {formatMoney(referralEarnings)}
                                                    </span>
                                                    <span className="rounded-full bg-amber-50 px-3 py-1 text-[12px] font-semibold text-amber-700">
                                                        Pending {formatMoney(referralPending)}
                                                    </span>
                                                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-[12px] font-semibold text-emerald-700">
                                                        Payable {formatMoney(referralPayable)}
                                                    </span>
                                                    <span className="rounded-full bg-blue-50 px-3 py-1 text-[12px] font-semibold text-blue-700">
                                                        {usesCurrentTerms
                                                            ? referral.first_paid_at
                                                                ? `${monthsRemaining} month${monthsRemaining === 1 ? "" : "s"} remaining`
                                                                : "6 months start at first paid charge"
                                                            : "Legacy $5 terms"}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="px-4 py-8 text-center text-[14px] text-[#777]">
                                        No referred users yet.
                                    </div>
                                )}
                            </div>
                        </section>

                        <section className="mt-8 rounded-[28px] border border-black/10 bg-white p-6 shadow-sm">
                            <h2 className="text-[24px] font-bold">Recent affiliate rewards</h2>
                            <p className="mt-2 text-[14px] leading-6 text-[#666]">
                                Paid-referral rewards and payout-trackable adjustments will appear here.
                            </p>

                            <div className="mt-5 overflow-hidden rounded-2xl border border-black/10">
                                {affiliateRewards.length ? (
                                    affiliateRewards.slice(0, 8).map((reward) => (
                                        <div
                                            key={reward.id}
                                            className="flex flex-col gap-2 border-b border-black/10 px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                                        >
                                            <div>
                                                <div className="text-[14px] font-bold text-[#2F2F2F]">
                                                    {reward.type}
                                                </div>
                                                <div className="mt-1 text-[12px] text-[#777]">
                                                    {reward.created_at
                                                        ? new Date(reward.created_at).toLocaleString()
                                                        : "No date"}
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-3">
                                                <div className="text-[15px] font-bold">
                                                    {formatMoney(Number(reward.amount_usd || 0))}
                                                </div>
                                                <div className="rounded-full bg-gray-100 px-3 py-1 text-[12px] font-semibold text-[#666]">
                                                    {reward.status || "unknown"}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="px-4 py-8 text-center text-[14px] text-[#777]">
                                        No affiliate rewards yet.
                                    </div>
                                )}
                            </div>
                        </section>
                    </>
                ) : (
                    <>
                        <section className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-3">
                            <div className="rounded-[28px] border border-black/10 bg-white p-6 shadow-sm">
                                <div className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                    Tier 1
                                </div>
                                <h2 className="mt-2 text-[24px] font-bold">Partner</h2>
                                <p className="mt-2 text-[14px] leading-6 text-[#666]">
                                    Default approved partner for creators, hosts, and community owners.
                                </p>
                                <ul className="mt-4 space-y-2 text-[14px] text-[#444]">
                                    <li>• 50% of payments for the first 6 months</li>
                                    <li>• Up to $30 per paying member</li>
                                    <li>• Manual payouts</li>
                                    <li>• Partner dashboard</li>
                                </ul>
                            </div>

                            <div className="rounded-[28px] border border-blue-200 bg-blue-50 p-6 shadow-sm">
                                <div className="text-[13px] font-bold uppercase tracking-[0.12em] text-blue-700">
                                    Tier 2
                                </div>
                                <h2 className="mt-2 text-[24px] font-bold">Approved Community Partner</h2>
                                <p className="mt-2 text-[14px] leading-6 text-[#555]">
                                    For partners with proven activation or active community access.
                                </p>
                                <ul className="mt-4 space-y-2 text-[14px] text-[#333]">
                                    <li>• 50% of payments for the first 6 months</li>
                                    <li>• Up to $30 per paying member</li>
                                    <li>• Priority support</li>
                                    <li>• Custom landing page later</li>
                                    <li>• Co-branded sessions later</li>
                                </ul>
                            </div>

                            <div className="rounded-[28px] border border-purple-200 bg-purple-50 p-6 shadow-sm">
                                <div className="text-[13px] font-bold uppercase tracking-[0.12em] text-purple-700">
                                    Tier 3
                                </div>
                                <h2 className="mt-2 text-[24px] font-bold">Strategic Partner</h2>
                                <p className="mt-2 text-[14px] leading-6 text-[#555]">
                                    For large communities, recurring collaborations, and proven audience access.
                                </p>
                                <ul className="mt-4 space-y-2 text-[14px] text-[#333]">
                                    <li>• 50% of payments for the first 6 months by default</li>
                                    <li>• Up to $30 per paying member</li>
                                    <li>• Custom campaigns or partnership structure by agreement</li>
                                    <li>• Co-branded onboarding</li>
                                    <li>• Optional special launch deal</li>
                                </ul>
                            </div>
                        </section>

                        <section className="mt-8 rounded-[28px] border border-black/10 bg-gray-50 p-6">
                            <h2 className="text-[24px] font-bold">Referral credits are separate</h2>
                            <p className="mt-3 max-w-3xl text-[15px] leading-7 text-[#666]">
                                Referral rewards are MySession credits. Affiliate rewards are real payout-trackable
                                money for approved partners.
                            </p>

                            <div className="mt-5">
                                <Link
                                    to="/referrals"
                                    className="inline-flex rounded-full border border-[#2F2F2F] px-5 py-2.5 text-[14px] font-semibold hover:bg-[#2F2F2F] hover:text-white"
                                >
                                    View Referral Program
                                </Link>
                            </div>
                        </section>

                        {!isActive && (
                            <section className="mt-8 rounded-[28px] border border-black/10 bg-white p-6 shadow-sm">
                                <form onSubmit={handleApply} className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                                    <div>
                                        <h2 className="text-[24px] font-bold">Apply for Affiliate Program</h2>
                                        <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[#666]">
                                            Tell us where you plan to promote MySession: community, audience,
                                            hosting, creator channel, or partner collaboration.
                                        </p>

                                        {partnerProfile && (
                                            <div className="mt-4 flex flex-wrap gap-2">
                                                <span className={`rounded-full px-3 py-1 text-[12px] font-bold ${getStatusBadgeClass(status)}`}>
                                                    {status}
                                                </span>
                                                <span className={`rounded-full px-3 py-1 text-[12px] font-bold ${getTierBadgeClass(tier)}`}>
                                                    {formatTier(tier)}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="w-full lg:max-w-[420px]">
                                        <textarea
                                            value={applicationNote}
                                            onChange={(e) => setApplicationNote(e.target.value)}
                                            placeholder="Example: I host focus sessions for students / I admin a productivity community / I can promote to my Discord audience..."
                                            rows={5}
                                            className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-[14px] outline-none focus:ring-2 focus:ring-black/15"
                                            disabled={status === "pending" || applying}
                                        />

                                        <button
                                            type="submit"
                                            disabled={applying || status === "pending"}
                                            className="mt-3 w-full rounded-full bg-[#2F2F2F] px-5 py-3 text-[14px] font-semibold text-white disabled:opacity-50"
                                        >
                                            {status === "pending"
                                                ? "Application pending"
                                                : applying
                                                    ? "Submitting..."
                                                    : "Apply for Affiliate Program"}
                                        </button>
                                    </div>
                                </form>
                            </section>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}
