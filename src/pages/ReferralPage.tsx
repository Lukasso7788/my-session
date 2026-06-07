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

function getOrigin() {
    if (typeof window === "undefined") return "https://www.mysession.club";
    return window.location.origin;
}

export default function ReferralPage() {
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [referralCode, setReferralCode] = useState("");
    const [referrals, setReferrals] = useState<ReferralRow[]>([]);
    const [rewards, setRewards] = useState<RewardRow[]>([]);
    const [copiedTarget, setCopiedTarget] = useState<"referral" | "payment" | "">("");
    const [error, setError] = useState("");

    const referralLink = useMemo(() => {
        if (!referralCode) return "";
        return `${getOrigin()}/?ref=${encodeURIComponent(referralCode)}`;
    }, [referralCode]);

    const paymentLink = useMemo(() => {
        if (!referralCode) return "";
        return `${getOrigin()}/pricing?ref=${encodeURIComponent(referralCode)}`;
    }, [referralCode]);

    const stats = useMemo(() => {
        const registered = referrals.length;
        const activated = referrals.filter(
            (r) => r.status === "activated" || r.status === "paid" || !!r.activated_at
        ).length;
        const paid = referrals.filter((r) => r.status === "paid" || !!r.first_paid_at).length;

        const referralRewards = rewards.filter((r) =>
            [
                "invitation_activation",
                "invitation_paid",
                "first_payment_bonus",
                "manual_adjustment",
            ].includes(r.type)
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
                (profileData as any)?.full_name ||
                user.user_metadata?.full_name ||
                user.email ||
                "User"
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

    const copyToClipboard = async (value: string, target: "referral" | "payment") => {
        if (!value) return;

        try {
            await navigator.clipboard.writeText(value);
            setCopiedTarget(target);
            window.setTimeout(() => setCopiedTarget(""), 1400);
        } catch {
            setCopiedTarget("");
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
                            Invite people to MySession. When someone you referred becomes a paying member,
                            you earn $5.
                        </p>
                    </div>

                    <Link
                        to="/affiliate"
                        className="rounded-full border border-[#2F2F2F] px-5 py-2.5 text-center text-[14px] font-semibold hover:bg-[#2F2F2F] hover:text-white"
                    >
                        Go to Affiliate Program
                    </Link>
                </div>

                {error ? (
                    <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                        {error}
                    </div>
                ) : null}

                <section className="mt-8 rounded-[28px] border border-black/10 bg-gray-50 p-5 sm:p-6">
                    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                        <div className="rounded-2xl border border-black/10 bg-white p-4">
                            <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                Referral link
                            </div>
                            <h2 className="mt-2 text-[22px] font-bold">Invite people</h2>
                            <p className="mt-2 text-[14px] leading-6 text-[#666]">
                                Send this link to invite someone to MySession. We will remember your referral
                                code when they register.
                            </p>
                            <div className="mt-4 break-all rounded-xl bg-gray-50 p-3 text-[14px] font-semibold">
                                {referralLink}
                            </div>
                            <button
                                type="button"
                                onClick={() => copyToClipboard(referralLink, "referral")}
                                className="mt-3 rounded-full bg-[#2F2F2F] px-4 py-2 text-[13px] font-semibold text-white"
                            >
                                {copiedTarget === "referral" ? "Copied" : "Copy referral link"}
                            </button>
                        </div>

                        <div className="rounded-2xl border border-black/10 bg-white p-4">
                            <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                Payment link
                            </div>
                            <h2 className="mt-2 text-[22px] font-bold">Send people to pricing</h2>
                            <p className="mt-2 text-[14px] leading-6 text-[#666]">
                                Send this link when someone is ready to upgrade. If they pay after using it,
                                you earn $5.
                            </p>
                            <div className="mt-4 break-all rounded-xl bg-gray-50 p-3 text-[14px] font-semibold">
                                {paymentLink}
                            </div>
                            <button
                                type="button"
                                onClick={() => copyToClipboard(paymentLink, "payment")}
                                className="mt-3 rounded-full bg-[#65D46C] px-4 py-2 text-[13px] font-bold text-[#2F2F2F]"
                            >
                                {copiedTarget === "payment" ? "Copied" : "Copy payment link"}
                            </button>
                        </div>
                    </div>

                    <div className="mt-5 rounded-2xl bg-white p-4 text-[13px] leading-6 text-[#666]">
                        Both links use the same referral code. The payment link simply sends the referred
                        user directly to the pricing page.
                    </div>
                </section>

                <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                        ["Registered referrals", stats.registered],
                        ["Activated referrals", stats.activated],
                        ["Paid referrals", stats.paid],
                        ["Lifetime earned", formatMoney(stats.lifetimeCredits)],
                        ["Pending rewards", formatMoney(stats.pendingCredits)],
                        ["Available balance", formatMoney(stats.availableCredits)],
                        ["Used / paid out", formatMoney(stats.usedCredits)],
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
                        <h2 className="text-[24px] font-bold">Reward rule</h2>
                        <div className="mt-5 rounded-2xl bg-gray-50 p-5">
                            <div className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                First paid user
                            </div>
                            <div className="mt-2 text-[30px] font-bold">+$5</div>
                            <p className="mt-2 text-[13px] leading-5 text-[#666]">
                                You earn $5 when a referred user makes their first successful MySession payment.
                            </p>
                        </div>

                        <div className="mt-5 rounded-2xl bg-gray-50 p-5">
                            <div className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#777]">
                                Protection
                            </div>
                            <p className="mt-2 text-[13px] leading-5 text-[#666]">
                                Rewards are counted once per referred paying user, so duplicate Stripe webhooks
                                should not create duplicate rewards.
                            </p>
                        </div>
                    </div>

                    <div className="rounded-[28px] border border-black/10 bg-gray-50 p-6">
                        <h2 className="text-[24px] font-bold">How to use this</h2>
                        <ul className="mt-5 space-y-3 text-[15px] text-[#444]">
                            <li>• Use the referral link for general invites.</li>
                            <li>• Use the payment link when someone is ready to subscribe.</li>
                            <li>• Registered users appear in your referral stats.</li>
                            <li>• Paid users create a $5 reward after Stripe webhook processing.</li>
                        </ul>

                        <div className="mt-6 rounded-2xl bg-white p-4 text-[13px] leading-6 text-[#666]">
                            The payment link is not a separate Stripe Payment Link. It is a MySession pricing
                            link with your referral code, so attribution stays inside MySession.
                        </div>
                    </div>
                </section>
            </div>
        </main>
    );
}