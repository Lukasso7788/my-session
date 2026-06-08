import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

type PartnerStatus = "none" | "pending" | "active" | "suspended";
type PartnerTier = "none" | "partner" | "approved_community_partner" | "strategic_partner";

type PartnerProfile = {
    id: string;
    user_id: string;
    tier: PartnerTier | string;
    status: PartnerStatus | string;
    subscribed_user_reward_usd?: number | null;
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
};

type RewardRow = {
    id: string;
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
    code: string;
    type?: string;
    is_active?: boolean;
};

function formatMoney(value: number) {
    const safe = Number.isFinite(value) ? value : 0;
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
    }).format(safe);
}

function formatTier(tier: string) {
    if (tier === "partner") return "Partner";
    if (tier === "approved_community_partner") return "Approved Community Partner";
    if (tier === "strategic_partner") return "Strategic Partner";
    return "Not active";
}

function getTierBadgeClass(tier: string) {
    if (tier === "strategic_partner") return "bg-purple-100 text-purple-700";
    if (tier === "approved_community_partner") return "bg-blue-100 text-blue-700";
    if (tier === "partner") return "bg-green-100 text-green-700";
    return "bg-gray-100 text-gray-700";
}

function getStatusBadgeClass(status: string) {
    if (status === "active") return "bg-green-100 text-green-700";
    if (status === "pending") return "bg-amber-100 text-amber-700";
    if (status === "suspended") return "bg-red-100 text-red-700";
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

    const status = String(partnerProfile?.status || "none").toLowerCase();
    const tier = String(partnerProfile?.tier || "none").toLowerCase();
    const isActive = status === "active";

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

        const affiliateRewards = rewards.filter((r) =>
            [
                "first_payment_bonus",
                "affiliate_first_payment",
                "affiliate_paid",
                "partner_paid",
                "partner_revenue_share",
                "manual_adjustment",
            ].includes(String(r.type || ""))
        );

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
    }, [referrals, rewards]);

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

            const [partnerResult, referralsResult, rewardsResult, payoutsResult] = await Promise.all([
                supabase
                    .from("partner_profiles")
                    .select(
                        "id, user_id, tier, status, subscribed_user_reward_usd, revenue_share_label, revenue_share_months, special_launch_reward_label, application_note, approved_at, notes"
                    )
                    .eq("user_id", user.id)
                    .maybeSingle(),

                supabase
                    .from("referrals")
                    .select("id, status, registered_at, activated_at, first_paid_at")
                    .eq("referrer_user_id", user.id)
                    .order("registered_at", { ascending: false }),

                supabase
                    .from("reward_ledger")
                    .select("id, type, amount_usd, status, created_at, available_at")
                    .eq("user_id", user.id)
                    .order("created_at", { ascending: false }),

                supabase
                    .from("affiliate_payout_requests")
                    .select("id, amount_usd, status, requested_at, resolved_at")
                    .eq("user_id", user.id)
                    .order("requested_at", { ascending: false }),
            ]);

            if (partnerResult.error) {
                console.warn("[affiliate] partner profile load failed:", partnerResult.error);
                setPartnerProfile(null);
            } else {
                setPartnerProfile((partnerResult.data as PartnerProfile) || null);
                setApplicationNote(String((partnerResult.data as any)?.application_note || ""));
            }

            if (referralsResult.error) {
                console.warn("[affiliate] referrals load failed:", referralsResult.error);
                setReferrals([]);
            } else {
                setReferrals((referralsResult.data as ReferralRow[]) || []);
            }

            if (rewardsResult.error) {
                console.warn("[affiliate] rewards load failed:", rewardsResult.error);
                setRewards([]);
            } else {
                setRewards((rewardsResult.data as RewardRow[]) || []);
            }

            if (payoutsResult.error) {
                console.warn("[affiliate] payouts load failed:", payoutsResult.error);
                setPayoutRequests([]);
            } else {
                setPayoutRequests((payoutsResult.data as PayoutRequestRow[]) || []);
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

    const handleApply = async () => {
        if (!userId) return;

        try {
            setApplying(true);
            setError("");

            const payload = {
                user_id: userId,
                tier: "partner",
                status: "pending",
                application_note: applicationNote.trim() || null,
                subscribed_user_reward_usd: 5,
                revenue_share_label: "$5 per subscribed user",
                revenue_share_months: null,
                updated_at: new Date().toISOString(),
            };

            const { error: upsertError } = await supabase
                .from("partner_profiles")
                .upsert(payload, { onConflict: "user_id" });

            if (upsertError) throw upsertError;

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

            const { error: insertError } = await supabase.from("affiliate_payout_requests").insert({
                user_id: userId,
                amount_usd: Number(stats.availableRewards.toFixed(2)),
                status: "requested",
                note: "Affiliate payout requested from affiliate dashboard.",
            });

            if (insertError) throw insertError;

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
        <main className="min-h-screen bg-white px-4 py-8 font-inter text-[#2F2F2F] sm:px-6 sm:py-10">
            <div className="mx-auto max-w-6xl">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#666]">
                            MySession Growth
                        </div>
                        <h1 className="mt-2 text-[32px] font-bold sm:text-[36px]">Affiliate Program</h1>
                        <p className="mt-3 max-w-2xl text-[15px] leading-7 text-[#666]">
                            For creators, admins, hosts, and community owners who can bring paying users to MySession.
                            Affiliates earn real payout-trackable rewards.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <Link
                            to="/referrals"
                            className="rounded-full border border-[#2F2F2F] px-5 py-2.5 text-[14px] font-semibold hover:bg-[#2F2F2F] hover:text-white"
                        >
                            Referral Program
                        </Link>

                        {isActive && (
                            <button
                                type="button"
                                onClick={() => setShowDetails((v) => !v)}
                                className="rounded-full border border-[#2F2F2F] px-5 py-2.5 text-[14px] font-semibold hover:bg-[#2F2F2F] hover:text-white"
                            >
                                {showDetails ? "View dashboard" : "View program details"}
                            </button>
                        )}
                    </div>
                </div>

                {error ? (
                    <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                        {error}
                    </div>
                ) : null}

                {isActive && !showDetails ? (
                    <>
                        <section className="mt-8 rounded-[28px] border border-black/10 bg-gray-50 p-5 sm:p-6">
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

                                    <h2 className="mt-4 text-[24px] font-bold">Your affiliate dashboard</h2>
                                    <p className="mt-2 text-[14px] leading-6 text-[#666]">
                                        Share your partner link. When a referred user becomes paid, your affiliate balance receives $5.
                                    </p>
                                </div>

                                <div className="rounded-2xl border border-black/10 bg-white p-4 lg:min-w-[440px]">
                                    <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                        Partner code
                                    </div>
                                    <div className="mt-2 text-[20px] font-bold">{referralCode || "—"}</div>

                                    <div className="mt-4 text-[12px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                        Partner link
                                    </div>
                                    <div className="mt-2 break-all rounded-xl bg-gray-50 p-3 text-[14px] font-semibold">
                                        {referralLink}
                                    </div>

                                    <button
                                        type="button"
                                        onClick={handleCopy}
                                        className="mt-3 rounded-full bg-[#2F2F2F] px-4 py-2 text-[13px] font-semibold text-white"
                                    >
                                        {copyText}
                                    </button>
                                </div>
                            </div>
                        </section>

                        <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            {[
                                ["Registered referrals", stats.registered],
                                ["Activated referrals", stats.activated],
                                ["Subscribed referrals", stats.paid],
                                ["Available payout balance", formatMoney(stats.availableRewards)],
                                ["Pending rewards", formatMoney(stats.pendingRewards)],
                                ["Paid out", formatMoney(stats.paidOutRewards)],
                                ["Total affiliate rewards", formatMoney(stats.totalRewards)],
                                ["Payout requests", payoutRequests.length],
                            ].map(([label, value]) => (
                                <div key={label} className="rounded-[22px] border border-black/10 bg-white p-5 shadow-sm">
                                    <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                        {label}
                                    </div>
                                    <div className="mt-2 text-[28px] font-bold">{value}</div>
                                </div>
                            ))}
                        </section>

                        <section className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
                            <div className="rounded-[28px] border border-black/10 bg-white p-6 shadow-sm">
                                <h2 className="text-[24px] font-bold">How affiliate rewards work</h2>

                                <div className="mt-5 rounded-2xl bg-gray-50 p-5">
                                    <div className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                        Paid referred user
                                    </div>
                                    <div className="mt-2 text-[30px] font-bold">+$5</div>
                                    <p className="mt-2 text-[13px] leading-5 text-[#666]">
                                        You earn $5 when a user you referred makes their first successful MySession payment.
                                    </p>
                                </div>

                                <div className="mt-5 rounded-2xl bg-gray-50 p-5">
                                    <div className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                        Referral vs affiliate
                                    </div>
                                    <p className="mt-2 text-[13px] leading-5 text-[#666]">
                                        Referral rewards are MySession credits. Affiliate rewards are real payout-trackable money.
                                    </p>
                                </div>
                            </div>

                            <div className="rounded-[28px] border border-black/10 bg-gray-50 p-6">
                                <h2 className="text-[24px] font-bold">Payout</h2>
                                <p className="mt-2 text-[14px] leading-6 text-[#666]">
                                    Payouts are manual for now. Minimum payout is $20 available balance.
                                </p>

                                <button
                                    type="button"
                                    onClick={handleAskForPayout}
                                    disabled={payoutBusy || stats.availableRewards < 20}
                                    className="mt-5 rounded-full bg-[#2F2F2F] px-5 py-2.5 text-[14px] font-semibold text-white disabled:opacity-50"
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
                            <h2 className="text-[24px] font-bold">Recent affiliate rewards</h2>
                            <p className="mt-2 text-[14px] leading-6 text-[#666]">
                                Paid-referral rewards and payout-trackable adjustments will appear here.
                            </p>

                            <div className="mt-5 overflow-hidden rounded-2xl border border-black/10">
                                {rewards.length ? (
                                    rewards.slice(0, 8).map((reward) => (
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
                                    <li>• $5 per subscribed user</li>
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
                                    <li>• $5 per subscribed user</li>
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
                                    <li>• $5+ per subscribed user</li>
                                    <li>• Custom partnership structure</li>
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
                                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
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
                                            disabled={status === "pending"}
                                        />

                                        <button
                                            type="button"
                                            onClick={handleApply}
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
                                </div>
                            </section>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}