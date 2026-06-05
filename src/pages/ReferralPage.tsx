import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { ensureMyReferralCode } from "../lib/referrals";

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

function formatMoney(value: number) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
    }).format(Number.isFinite(value) ? value : 0);
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
        if (typeof window === "undefined") {
            return `https://www.mysession.club/?ref=${referralCode}`;
        }
        return `${window.location.origin}/?ref=${referralCode}`;
    }, [referralCode]);

    const stats = useMemo(() => {
        const registered = referrals.length;
        const activated = referrals.filter(
            (r) => r.status === "activated" || r.status === "paid" || !!r.activated_at
        ).length;
        const paid = referrals.filter((r) => r.status === "paid" || !!r.first_paid_at).length;

        const referralRewards = rewards.filter((r) =>
            ["invitation_activation", "invitation_paid", "manual_adjustment"].includes(r.type)
        );

        const pendingCredits = referralRewards
            .filter((r) => String(r.status || "").toLowerCase() === "pending")
            .reduce((sum, r) => sum + Number(r.amount_usd || 0), 0);

        const availableCredits = referralRewards
            .filter((r) => String(r.status || "").toLowerCase() === "available")
            .reduce((sum, r) => sum + Number(r.amount_usd || 0), 0);

        const usedCredits = referralRewards
            .filter((r) => ["used", "paid"].includes(String(r.status || "").toLowerCase()))
            .reduce((sum, r) => sum + Number(r.amount_usd || 0), 0);

        const lifetimeCredits = referralRewards.reduce(
            (sum, r) => sum + Number(r.amount_usd || 0),
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

            const { data: profileData } = await supabase
                .from("profiles")
                .select("full_name")
                .eq("id", user.id)
                .maybeSingle();

            const name = String(
                (profileData as any)?.full_name || user.user_metadata?.full_name || user.email || "User"
            ).trim();

            const codeRow = await ensureMyReferralCode(user.id, name);
            setReferralCode(String(codeRow?.code || ""));

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
        <main className="min-h-screen bg-white px-6 py-10 font-inter text-[#2F2F2F]">
            <div className="mx-auto max-w-6xl">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#666]">
                            MySession Growth
                        </div>
                        <h1 className="mt-2 text-[36px] font-bold">Referral Program</h1>
                        <p className="mt-3 max-w-2xl text-[15px] leading-7 text-[#666]">
                            Invite friends to MySession and earn MySession Credits. Credits can later
                            help with subscription discounts, upgrades, host support, or manual adjustments.
                        </p>
                    </div>

                    <Link
                        to="/affiliate"
                        className="rounded-full border border-[#2F2F2F] px-5 py-2.5 text-[14px] font-semibold hover:bg-[#2F2F2F] hover:text-white"
                    >
                        Go to Affiliate Program
                    </Link>
                </div>

                {error ? (
                    <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                        {error}
                    </div>
                ) : null}

                <section className="mt-8 rounded-[28px] border border-black/10 bg-gray-50 p-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <h2 className="text-[24px] font-bold">Your referral link</h2>
                            <p className="mt-2 text-[14px] leading-6 text-[#666]">
                                Share this with friends. A user becomes activated after registration and
                                20+ minutes in a real live session.
                            </p>
                        </div>

                        <div className="rounded-2xl border border-black/10 bg-white p-4 lg:min-w-[420px]">
                            <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                Link
                            </div>
                            <div className="mt-2 break-all text-[14px] font-semibold">{referralLink}</div>
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
                        ["Lifetime credits", formatMoney(stats.lifetimeCredits)],
                        ["Pending credits", formatMoney(stats.pendingCredits)],
                        ["Available credits", formatMoney(stats.availableCredits)],
                        ["Used credits", formatMoney(stats.usedCredits)],
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
                        <h2 className="text-[24px] font-bold">Rewards</h2>
                        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="rounded-2xl bg-gray-50 p-5">
                                <div className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                    Activated user
                                </div>
                                <div className="mt-2 text-[30px] font-bold">+$2</div>
                                <p className="mt-2 text-[13px] leading-5 text-[#666]">
                                    MySession Credit when your invited user registers and attends a 20+ minute session.
                                </p>
                            </div>

                            <div className="rounded-2xl bg-gray-50 p-5">
                                <div className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                    Paid user
                                </div>
                                <div className="mt-2 text-[30px] font-bold">+$5</div>
                                <p className="mt-2 text-[13px] leading-5 text-[#666]">
                                    Extra MySession Credit when your invited user becomes paid.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-[28px] border border-black/10 bg-gray-50 p-6">
                        <h2 className="text-[24px] font-bold">Credits can be used for</h2>
                        <ul className="mt-5 space-y-3 text-[15px] text-[#444]">
                            <li>• Subscription discounts</li>
                            <li>• Subscription upgrades</li>
                            <li>• Future host support</li>
                            <li>• Manual adjustment</li>
                        </ul>

                        <div className="mt-6 rounded-2xl bg-white p-4 text-[13px] leading-6 text-[#666]">
                            Referral Program credits are not direct cash payouts. For professional
                            community promotion and payout-trackable partner rewards, use the Affiliate Program.
                        </div>
                    </div>
                </section>
            </div>
        </main>
    );
}