import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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

function formatMoney(value: number) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
    }).format(Number.isFinite(value) ? value : 0);
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
        <main className="min-h-screen bg-white px-4 py-8 font-inter text-[#2F2F2F] sm:px-6 sm:py-10">
            <div className="mx-auto max-w-6xl">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#666]">
                            MySession Growth
                        </div>
                        <h1 className="mt-2 text-[32px] font-bold sm:text-[36px]">
                            Referral Program
                        </h1>
                        <p className="mt-3 max-w-2xl text-[15px] leading-7 text-[#666]">
                            Invite people to MySession and earn MySession credits. Referral credits are not cash payouts.
                        </p>
                    </div>

                    <Link
                        to="/affiliate"
                        className="rounded-full border border-[#2F2F2F] px-5 py-2.5 text-center text-[14px] font-semibold hover:bg-[#2F2F2F] hover:text-white"
                    >
                        Affiliate Program
                    </Link>
                </div>

                {error ? (
                    <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                        {error}
                    </div>
                ) : null}

                <section className="mt-8 rounded-[28px] border border-black/10 bg-gray-50 p-5 sm:p-6">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <h2 className="text-[24px] font-bold">Your referral link</h2>
                            <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[#666]">
                                Share this link with friends. Referral rewards are handled as MySession credits.
                            </p>
                        </div>

                        <div className="rounded-2xl border border-black/10 bg-white p-4 lg:min-w-[440px]">
                            <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                Referral code
                            </div>
                            <div className="mt-2 text-[20px] font-bold">{referralCode || "—"}</div>

                            <div className="mt-4 text-[12px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                Link
                            </div>
                            <div className="mt-2 break-all rounded-xl bg-gray-50 p-3 text-[14px] font-semibold">
                                {referralLink || "No referral link yet"}
                            </div>

                            <button
                                type="button"
                                onClick={handleCopy}
                                disabled={!referralLink}
                                className="mt-3 rounded-full bg-[#2F2F2F] px-4 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
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
                        ["Available credits", formatMoney(stats.availableCredits)],
                        ["Pending credits", formatMoney(stats.pendingCredits)],
                        ["Used credits", formatMoney(stats.usedCredits)],
                        ["Lifetime credits", formatMoney(stats.lifetimeCredits)],
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
                        <h2 className="text-[24px] font-bold">How referral credits work</h2>

                        <div className="mt-5 rounded-2xl bg-gray-50 p-5">
                            <div className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                MySession credits
                            </div>
                            <p className="mt-2 text-[13px] leading-5 text-[#666]">
                                Referral rewards are credits inside MySession. They can be used for subscriptions,
                                upgrades, or manual credit adjustments.
                            </p>
                        </div>

                        <div className="mt-5 rounded-2xl bg-gray-50 p-5">
                            <div className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                Cash payouts
                            </div>
                            <p className="mt-2 text-[13px] leading-5 text-[#666]">
                                Real money payouts belong to the Affiliate Program, not the Referral Program.
                            </p>
                        </div>
                    </div>

                    <div className="rounded-[28px] border border-black/10 bg-gray-50 p-6">
                        <h2 className="text-[24px] font-bold">Referral status</h2>

                        <ul className="mt-5 space-y-3 text-[15px] text-[#444]">
                            <li>• Registered — the user signed up through your link.</li>
                            <li>• Activated — the user completed a real session milestone.</li>
                            <li>• Paid — the user made their first successful payment.</li>
                            <li>• Credits — your earned MySession referral credits.</li>
                        </ul>

                        <div className="mt-6 rounded-2xl bg-white p-4 text-[13px] leading-6 text-[#666]">
                            For cash-based partner rewards, apply to the Affiliate Program.
                        </div>
                    </div>
                </section>

                <section className="mt-8 rounded-[28px] border border-black/10 bg-white p-6 shadow-sm">
                    <h2 className="text-[24px] font-bold">Recent credit rewards</h2>
                    <p className="mt-2 text-[14px] leading-6 text-[#666]">
                        Referral credit rewards and manual adjustments will appear here.
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
                                            {formatMoney(normalizeRewardAmount(reward))}
                                        </div>
                                        <div className="rounded-full bg-gray-100 px-3 py-1 text-[12px] font-semibold text-[#666]">
                                            {reward.status || "unknown"}
                                        </div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="px-4 py-8 text-center text-[14px] text-[#777]">
                                No credit rewards yet.
                            </div>
                        )}
                    </div>
                </section>
            </div>
        </main>
    );
}