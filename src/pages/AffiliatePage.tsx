import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { ensureMyReferralCode } from "../lib/referrals";

type PartnerStatus = "none" | "pending" | "active" | "suspended";
type PartnerTier = "none" | "partner" | "approved_community_partner" | "strategic_partner";

type PartnerProfile = {
    id: string;
    user_id: string;
    tier: PartnerTier | string;
    status: PartnerStatus | string;
    activation_reward_usd: number | null;
    revenue_share_percent: number | null;
    revenue_share_months: number | null;
    special_revenue_share_percent: number | null;
    application_note: string | null;
    approved_at: string | null;
    notes: string | null;
};

type ReferralRow = {
    id: string;
    referrer_user_id: string;
    referred_user_id: string;
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

function formatMoney(value: number) {
    const safe = Number.isFinite(value) ? value : 0;
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
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

export default function AffiliatePage() {
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState("");
    const [fullName, setFullName] = useState("");
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
        if (typeof window === "undefined") return `https://www.mysession.club/?ref=${referralCode}`;
        return `${window.location.origin}/?ref=${referralCode}`;
    }, [referralCode]);

    const stats = useMemo(() => {
        const registered = referrals.length;
        const activated = referrals.filter((r) => r.status === "activated" || r.status === "paid").length;
        const paid = referrals.filter((r) => r.status === "paid" || !!r.first_paid_at).length;

        const pendingRewards = rewards
            .filter((r) => String(r.status || "").toLowerCase() === "pending")
            .reduce((sum, r) => sum + Number(r.amount_usd || 0), 0);

        const availableRewards = rewards
            .filter((r) => String(r.status || "").toLowerCase() === "available")
            .reduce((sum, r) => sum + Number(r.amount_usd || 0), 0);

        const paidOutRewards = rewards
            .filter((r) => String(r.status || "").toLowerCase() === "paid")
            .reduce((sum, r) => sum + Number(r.amount_usd || 0), 0);

        const totalRewards = rewards.reduce((sum, r) => sum + Number(r.amount_usd || 0), 0);

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

            const { data: profileData } = await supabase
                .from("profiles")
                .select("full_name")
                .eq("id", user.id)
                .maybeSingle();

            const name =
                String((profileData as any)?.full_name || user.user_metadata?.full_name || user.email || "Partner").trim();

            setFullName(name);

            const codeRow = await ensureMyReferralCode(user.id, name);
            setReferralCode(String(codeRow?.code || ""));

            const [
                partnerResult,
                referralsResult,
                rewardsResult,
                payoutsResult,
            ] = await Promise.all([
                supabase
                    .from("partner_profiles")
                    .select(
                        "id, user_id, tier, status, activation_reward_usd, revenue_share_percent, revenue_share_months, special_revenue_share_percent, application_note, approved_at, notes"
                    )
                    .eq("user_id", user.id)
                    .maybeSingle(),

                supabase
                    .from("referrals")
                    .select("id, referrer_user_id, referred_user_id, status, registered_at, activated_at, first_paid_at")
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
                    .order("created_at", { ascending: false }),
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
                activation_reward_usd: 2,
                revenue_share_percent: 50,
                revenue_share_months: 3,
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

            const { error: insertError } = await supabase
                .from("affiliate_payout_requests")
                .insert({
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
        <main className="min-h-screen bg-white px-6 py-10 font-inter text-[#2F2F2F]">
            <div className="mx-auto max-w-6xl">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#666]">
                            MySession Growth
                        </div>
                        <h1 className="mt-2 text-[36px] font-bold">Affiliate Program</h1>
                        <p className="mt-3 max-w-2xl text-[15px] leading-7 text-[#666]">
                            Earn rewards by bringing creators, hosts, students, communities, and focused people
                            into real MySession accountability sessions.
                        </p>
                    </div>

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

                {error ? (
                    <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                        {error}
                    </div>
                ) : null}

                {isActive && !showDetails ? (
                    <>
                        <section className="mt-8 rounded-[28px] border border-black/10 bg-gray-50 p-6">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className={`rounded-full px-3 py-1 text-[12px] font-bold ${getTierBadgeClass(tier)}`}>
                                            {formatTier(tier)}
                                        </span>
                                        <span className={`rounded-full px-3 py-1 text-[12px] font-bold ${getStatusBadgeClass(status)}`}>
                                            {status}
                                        </span>
                                    </div>

                                    <h2 className="mt-4 text-[24px] font-bold">
                                        Your affiliate dashboard
                                    </h2>
                                    <p className="mt-2 text-[14px] leading-6 text-[#666]">
                                        Share your link. Rewards are created when referred users activate or become paid.
                                    </p>
                                </div>

                                <div className="rounded-2xl border border-black/10 bg-white p-4">
                                    <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                        Referral link
                                    </div>
                                    <div className="mt-2 break-all text-[14px] font-semibold">
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
                                ["Paid referrals", stats.paid],
                                ["Total rewards", formatMoney(stats.totalRewards)],
                                ["Pending rewards", formatMoney(stats.pendingRewards)],
                                ["Available balance", formatMoney(stats.availableRewards)],
                                ["Paid out", formatMoney(stats.paidOutRewards)],
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

                        <section className="mt-8 rounded-[28px] border border-black/10 bg-white p-6">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <h2 className="text-[22px] font-bold">Payout</h2>
                                    <p className="mt-1 text-[14px] text-[#666]">
                                        Payouts are manual for now. Minimum payout is $20 available balance.
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleAskForPayout}
                                    disabled={payoutBusy || stats.availableRewards < 20}
                                    className="rounded-full bg-[#2F2F2F] px-5 py-2.5 text-[14px] font-semibold text-white disabled:opacity-50"
                                >
                                    {payoutBusy ? "Requesting..." : "Ask for payout"}
                                </button>
                            </div>

                            <div className="mt-5 space-y-2">
                                {payoutRequests.length === 0 ? (
                                    <div className="rounded-2xl border border-black/10 bg-gray-50 px-4 py-4 text-[14px] text-[#666]">
                                        No payout requests yet.
                                    </div>
                                ) : (
                                    payoutRequests.map((p) => (
                                        <div key={p.id} className="flex items-center justify-between rounded-2xl border border-black/10 bg-gray-50 px-4 py-3">
                                            <div className="font-semibold">{formatMoney(Number(p.amount_usd || 0))}</div>
                                            <div className="rounded-full bg-amber-100 px-3 py-1 text-[12px] font-bold text-amber-700">
                                                {p.status || "requested"}
                                            </div>
                                        </div>
                                    ))
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
                                    Default approved referral partner for creators, hosts, and community owners.
                                </p>
                                <ul className="mt-4 space-y-2 text-[14px] text-[#444]">
                                    <li>• $1–2 per activated user</li>
                                    <li>• 50% revenue share for first 3 paid months</li>
                                </ul>
                            </div>

                            <div className="rounded-[28px] border border-blue-200 bg-blue-50 p-6 shadow-sm">
                                <div className="text-[13px] font-bold uppercase tracking-[0.12em] text-blue-700">
                                    Tier 2
                                </div>
                                <h2 className="mt-2 text-[24px] font-bold">Approved Community Partner</h2>
                                <p className="mt-2 text-[14px] leading-6 text-[#555]">
                                    For partners with clear community access or proven activation.
                                </p>
                                <ul className="mt-4 space-y-2 text-[14px] text-[#333]">
                                    <li>• $2 per activated user</li>
                                    <li>• 50% revenue share for first year</li>
                                    <li>• Priority support</li>
                                    <li>• Co-branded sessions later</li>
                                </ul>
                            </div>

                            <div className="rounded-[28px] border border-purple-200 bg-purple-50 p-6 shadow-sm">
                                <div className="text-[13px] font-bold uppercase tracking-[0.12em] text-purple-700">
                                    Tier 3
                                </div>
                                <h2 className="mt-2 text-[24px] font-bold">Strategic Partner</h2>
                                <p className="mt-2 text-[14px] leading-6 text-[#555]">
                                    For recurring collaboration, large active communities, and proven audience access.
                                </p>
                                <ul className="mt-4 space-y-2 text-[14px] text-[#333]">
                                    <li>• $2–3 per activated user</li>
                                    <li>• Minimum 50% first-year revenue share</li>
                                    <li>• Optional special launch share: 70–100%</li>
                                    <li>• Deeper platform integration later</li>
                                </ul>
                            </div>
                        </section>

                        <section className="mt-8 rounded-[28px] border border-black/10 bg-gray-50 p-6">
                            <h2 className="text-[24px] font-bold">How activation works</h2>
                            <p className="mt-3 max-w-3xl text-[15px] leading-7 text-[#666]">
                                A referred user counts as activated when they register, join a live session,
                                stay for at least 20 minutes, and are not a duplicate or self-referral.
                            </p>

                            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
                                <div className="rounded-2xl bg-white p-4">
                                    <div className="font-bold">1. Share your link</div>
                                    <p className="mt-1 text-[13px] text-[#666]">Invite people from your audience or community.</p>
                                </div>
                                <div className="rounded-2xl bg-white p-4">
                                    <div className="font-bold">2. They activate</div>
                                    <p className="mt-1 text-[13px] text-[#666]">They attend a real focus session for 20+ minutes.</p>
                                </div>
                                <div className="rounded-2xl bg-white p-4">
                                    <div className="font-bold">3. You earn</div>
                                    <p className="mt-1 text-[13px] text-[#666]">Rewards and revenue share are tracked internally.</p>
                                </div>
                            </div>
                        </section>

                        {!isActive && (
                            <section className="mt-8 rounded-[28px] border border-black/10 bg-white p-6 shadow-sm">
                                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                                    <div>
                                        <h2 className="text-[24px] font-bold">
                                            Apply for Affiliate Program
                                        </h2>
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