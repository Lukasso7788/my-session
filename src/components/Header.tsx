import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useCreateSessionModal } from "../context/CreateSessionModalContext";
import { useAuth } from "../context/AuthContext";
import { loadEntitlementState, type EntitlementState } from "../lib/entitlements";
import { getPaywallDecision } from "../lib/paywall";
import PaywallModal from "./PaywallModal";

const DEBUG = true;
const BRAND_BLACK = "#2F2F2F";

const tabs = [
    {
        id: "group",
        label: "Group sessions",
        iconActive: "/icons/group-active-black.svg",
        iconInactive: "/icons/group-inactive.svg",
    },
    {
        id: "infinite",
        label: "Infinite rooms",
        iconActive: "/icons/infinite-active-black.svg",
        iconInactive: "/icons/infinite-inactive.svg",
    },
    {
        id: "body",
        label: "Body tripling",
        iconActive: "/icons/body-active-black.svg",
        iconInactive: "/icons/body-inactive.svg",
    },
] as const;

type SessionTabId = (typeof tabs)[number]["id"];

function getPlanBadgeLabel(state: EntitlementState | null): "Free" | "Pro" | null {
    if (!state?.isLoggedIn) return null;

    const plan = String(state?.entitlement?.plan || "free").toLowerCase();

    if (
        plan === "pro_monthly" ||
        plan === "pro_yearly" ||
        plan === "lifetime" ||
        plan === "founding_free"
    ) {
        return "Pro";
    }

    return "Free";
}

function getPlanPopoverTitle(state: EntitlementState | null): string {
    if (!state?.isLoggedIn) return "";

    const plan = String(state?.entitlement?.plan || "free").toLowerCase();

    if (
        plan === "pro_monthly" ||
        plan === "pro_yearly" ||
        plan === "lifetime" ||
        plan === "founding_free"
    ) {
        return "Pro plan";
    }

    return "Free plan";
}

function getPlanPopoverText(state: EntitlementState | null): string {
    if (!state?.isLoggedIn) return "";

    const plan = String(state?.entitlement?.plan || "free").toLowerCase();
    const status = String(state?.entitlement?.status || "active").toLowerCase();

    if (plan === "pro_monthly" || plan === "pro_yearly") {
        return "Your Pro plan is active.";
    }

    if (plan === "lifetime" || plan === "founding_free") {
        return "Your Pro access is active.";
    }

    if (plan === "free" && status === "trialing") {
        return "Your account is currently marked as Free in trial state.";
    }

    const used = Math.max(0, Number(state.lifetimeSessionsCount || 0));
    const remaining = Math.max(0, 15 - used);

    return remaining > 0
        ? `${remaining} of your 15 free sessions remaining.`
        : "Your 15 free sessions are used. Upgrade to Pro to continue.";
}

export default function Header() {
    const navigate = useNavigate();
    const location = useLocation();
    const modal = useCreateSessionModal();
    const { user, profile, loading, signOut } = useAuth();

    const [showUserMenu, setShowUserMenu] = useState(false);
    const [mobileMenu, setMobileMenu] = useState(false);
    const [hoverCreate, setHoverCreate] = useState(false);

    const [sessionsOpen, setSessionsOpen] = useState(false);
    const [hoveredSessionTab, setHoveredSessionTab] = useState<SessionTabId | null>(null);
    const dropdownRef = useRef<HTMLDivElement | null>(null);

    const [entitlementState, setEntitlementState] = useState<EntitlementState | null>(null);
    const [planBadgeOpen, setPlanBadgeOpen] = useState(false);
    const planBadgeWrapRef = useRef<HTMLDivElement | null>(null);
    const planBadgeCloseTimeoutRef = useRef<number | null>(null);

    const [paywallOpen, setPaywallOpen] = useState(false);

    const avatarSrc =
        profile?.avatar_url ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.full_name || "User")}`;

    const activeSessionsTab: SessionTabId = useMemo(() => {
        const params = new URLSearchParams(location.search);
        const tab = (params.get("tab") || "group").toLowerCase();

        if (tab === "infinite" || tab === "body" || tab === "group") return tab as SessionTabId;
        return "group";
    }, [location.search]);

    const planBadgeLabel = useMemo(() => getPlanBadgeLabel(entitlementState), [entitlementState]);
    const planPopoverTitle = useMemo(() => getPlanPopoverTitle(entitlementState), [entitlementState]);
    const planPopoverText = useMemo(() => getPlanPopoverText(entitlementState), [entitlementState]);

    const paywallDecision = useMemo(() => {
        if (!entitlementState) return null;

        return getPaywallDecision({
            entitlement: entitlementState.entitlement,
            usage: entitlementState.usage,
            lifetimeSessionsCount: entitlementState.lifetimeSessionsCount,
        });
    }, [entitlementState]);

    useEffect(() => {
        console.log("[PAYWALL Header]", {
            entitlementState,
            paywallDecision,
        });
    }, [entitlementState, paywallDecision]);

    useEffect(() => {
        function onDocClick(e: MouseEvent) {
            if (!dropdownRef.current) return;
            if (!dropdownRef.current.contains(e.target as Node)) setSessionsOpen(false);
        }

        function onEsc(e: KeyboardEvent) {
            if (e.key === "Escape") {
                setSessionsOpen(false);
                setPlanBadgeOpen(false);
                setPaywallOpen(false);
            }
        }

        document.addEventListener("mousedown", onDocClick);
        document.addEventListener("keydown", onEsc);

        return () => {
            document.removeEventListener("mousedown", onDocClick);
            document.removeEventListener("keydown", onEsc);
        };
    }, []);

    useEffect(() => {
        function onDocClick(e: MouseEvent) {
            if (!planBadgeWrapRef.current) return;
            if (!planBadgeWrapRef.current.contains(e.target as Node)) {
                setPlanBadgeOpen(false);
            }
        }

        document.addEventListener("mousedown", onDocClick);
        return () => {
            document.removeEventListener("mousedown", onDocClick);
        };
    }, []);

    useEffect(() => {
        setMobileMenu(false);
        setSessionsOpen(false);
        setShowUserMenu(false);
        setPlanBadgeOpen(false);
        setPaywallOpen(false);
    }, [location.pathname, location.search]);

    useEffect(() => {
        if (!mobileMenu) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prev;
        };
    }, [mobileMenu]);

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            if (!user?.id) {
                setEntitlementState(null);
                return;
            }

            try {
                const state = await loadEntitlementState();
                if (!cancelled) {
                    setEntitlementState(state);
                    if (DEBUG) console.log("[DEBUG Header] entitlement state:", state);
                }
            } catch (e) {
                console.error("[DEBUG Header] entitlement load failed:", e);
                if (!cancelled) setEntitlementState(null);
            }
        };

        void run();

        return () => {
            cancelled = true;
        };
    }, [user?.id]);

    useEffect(() => {
        return () => {
            if (planBadgeCloseTimeoutRef.current != null) {
                window.clearTimeout(planBadgeCloseTimeoutRef.current);
            }
        };
    }, []);

    const goToSessions = (tabId: SessionTabId) => {
        navigate(`/sessions?tab=${tabId}`);
        setSessionsOpen(false);
        setMobileMenu(false);
    };

    const handlePlanBadgeClick = () => {
        if (!planBadgeLabel) return;

        if (planBadgeLabel === "Free") {
            navigate("/pricing");
            return;
        }

        setPlanBadgeOpen((v) => !v);
    };

    const openPlanPopover = () => {
        if (planBadgeCloseTimeoutRef.current != null) {
            window.clearTimeout(planBadgeCloseTimeoutRef.current);
            planBadgeCloseTimeoutRef.current = null;
        }
        setPlanBadgeOpen(true);
    };

    const closePlanPopoverWithDelay = () => {
        if (planBadgeCloseTimeoutRef.current != null) {
            window.clearTimeout(planBadgeCloseTimeoutRef.current);
        }

        planBadgeCloseTimeoutRef.current = window.setTimeout(() => {
            setPlanBadgeOpen(false);
            planBadgeCloseTimeoutRef.current = null;
        }, 140);
    };

    const handleCreateSessionClick = () => {
        if (paywallDecision?.blocked) {
            setPaywallOpen(true);
            return;
        }

        modal.open();
    };

    return (
        <>
            <header className="border-b border-borderGray bg-white sticky top-0 z-30">
                <div className="w-full px-5 md:px-8 py-5 flex items-center justify-between gap-3">
                    <nav className="hidden lg:flex items-center gap-6 flex-1 text-sm text-[#2E2E2E]">
                        <div className="relative" ref={dropdownRef}>
                            <button
                                onClick={() => setSessionsOpen((v) => !v)}
                                onMouseEnter={() => setSessionsOpen(true)}
                                className="hover:text-[#2F2F2F] inline-flex items-center gap-1.5"
                            >
                                Sessions
                                <span
                                    className={["transition-transform", sessionsOpen ? "rotate-180" : "rotate-0"].join(" ")}
                                    aria-hidden
                                >
                                    <img src="/icons/arrow.svg" className="w-3 h-3" alt="" />
                                </span>
                            </button>

                            {sessionsOpen && (
                                <div
                                    className="absolute left-0 top-9 w-[240px] bg-white rounded-2xl shadow-lg border border-borderGray z-40 p-2"
                                    onMouseLeave={() => {
                                        setHoveredSessionTab(null);
                                        setSessionsOpen(false);
                                    }}
                                >
                                    {tabs.map((t) => {
                                        const isHover = hoveredSessionTab === t.id;
                                        const isActive = activeSessionsTab === t.id;
                                        const showActiveIcon = isHover || isActive;

                                        return (
                                            <button
                                                key={t.id}
                                                onClick={() => goToSessions(t.id)}
                                                onMouseEnter={() => setHoveredSessionTab(t.id)}
                                                onMouseLeave={() => setHoveredSessionTab(null)}
                                                className={[
                                                    "w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors",
                                                    isHover ? "bg-black/5" : "bg-transparent",
                                                ].join(" ")}
                                            >
                                                <img src={showActiveIcon ? t.iconActive : t.iconInactive} className="w-5 h-5" alt="" />
                                                <span
                                                    className={[
                                                        "text-sm",
                                                        isHover || isActive ? `text-[${BRAND_BLACK}]` : "text-[#2E2E2E]",
                                                    ].join(" ")}
                                                    style={isHover || isActive ? { color: BRAND_BLACK } : undefined}
                                                >
                                                    {t.label}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <button onClick={() => navigate("/pricing")} className="hover:text-[#2F2F2F]">
                            Pricing
                        </button>

                        <button onClick={() => navigate("/focus-plan")} className="hover:text-[#2F2F2F]">
                            Focus plan
                        </button>
                    </nav>

                    <div className="flex-1 flex justify-start lg:justify-center">
                        <div className="relative inline-flex items-center justify-center" ref={planBadgeWrapRef}>
                            <button
                                onClick={() => navigate("/")}
                                className="text-[28px] md:text-4xl font-extrabold text-brandBlack hover:opacity-80 transition"
                            >
                                MySession
                            </button>

                            {planBadgeLabel ? (
                                <div
                                    className="absolute -right-[32px] -top-[2px] z-20 pb-[12px]"
                                    onMouseEnter={openPlanPopover}
                                    onMouseLeave={closePlanPopoverWithDelay}
                                >
                                    <button
                                        type="button"
                                        onClick={handlePlanBadgeClick}
                                        className="inline-flex items-center justify-center rounded-[8px] border border-[#2F2F2F] bg-white px-[6px] py-[2px] text-[12px] font-bold leading-none text-[#2F2F2F] shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                                        style={{ fontFamily: "Inter, sans-serif" }}
                                        aria-label={`Current plan: ${planBadgeLabel}`}
                                        title={planBadgeLabel === "Free" ? "Upgrade plan" : "Plan status"}
                                    >
                                        {planBadgeLabel}
                                    </button>

                                    {planBadgeOpen ? (
                                        <div className="absolute right-0 top-full mt-0 w-[220px] pt-[8px]">
                                            <div className="rounded-[14px] border border-[#2F2F2F]/10 bg-white p-3 text-left shadow-[0_12px_32px_rgba(0,0,0,0.12)]">
                                                <div className="text-[12px] font-semibold text-[#2F2F2F]">
                                                    {planPopoverTitle}
                                                </div>

                                                <div className="mt-1 text-[12px] leading-[1.45] text-[#2F2F2F]/75">
                                                    {planPopoverText}
                                                </div>

                                                {planBadgeLabel === "Free" ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setPlanBadgeOpen(false);
                                                            navigate("/pricing");
                                                        }}
                                                        className="mt-3 w-full rounded-[10px] bg-[#2F2F2F] px-3 py-2 text-[12px] font-semibold text-white transition hover:opacity-90"
                                                    >
                                                        Upgrade plan
                                                    </button>
                                                ) : null}
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-3 flex-1">
                        {loading ? null : (
                            <>
                                {!user && (
                                    <>
                                        <button
                                            onClick={() => navigate("/login")}
                                            className="hidden sm:inline-flex px-4 py-2 rounded-full border border-gray-300 text-sm hover:bg-slate-50"
                                        >
                                            Log in
                                        </button>

                                        <button
                                            onClick={() => navigate("/register")}
                                            className="hidden sm:inline-flex px-4 py-2 rounded-full bg-brandBlack text-white text-sm hover:opacity-90"
                                        >
                                            Sign up
                                        </button>
                                    </>
                                )}

                                {user && (
                                    <>
                                        <button
                                            onClick={handleCreateSessionClick}
                                            onMouseEnter={() => setHoverCreate(true)}
                                            onMouseLeave={() => setHoverCreate(false)}
                                            className={`
                        hidden md:inline-flex items-center gap-2 px-6 py-3 rounded-full
                        border text-base font-medium transition-colors duration-200
                        border-[#2F2F2F]
                        ${hoverCreate ? "bg-[#2F2F2F] text-white" : "hover:bg-slate-50"}
                      `}
                                        >
                                            <img
                                                src={hoverCreate ? "/icons/create-session-white.svg" : "/icons/create-session.svg"}
                                                className="w-5 h-5"
                                                alt=""
                                            />
                                            <span>Create a session</span>
                                        </button>

                                        <button onClick={() => setShowUserMenu((v) => !v)} className="hidden sm:flex items-center">
                                            <img
                                                src={avatarSrc}
                                                className="w-[42px] h-[42px] md:w-[50px] md:h-[50px] rounded-full border border-borderGray object-cover"
                                                alt=""
                                            />
                                        </button>

                                        {showUserMenu && (
                                            <div className="hidden sm:block absolute right-0 top-14 w-52 bg-white rounded-xl shadow-lg border border-borderGray z-40 overflow-hidden">
                                                <button
                                                    onClick={() => {
                                                        navigate("/profile");
                                                        setShowUserMenu(false);
                                                    }}
                                                    className="w-full text-left px-4 py-2 text-sm font-light hover:bg-slate-50"
                                                >
                                                    Profile
                                                </button>

                                                <button
                                                    onClick={() => {
                                                        navigate("/focus-shield");
                                                        setShowUserMenu(false);
                                                    }}
                                                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-light hover:bg-slate-50"
                                                >
                                                    <img src="/icons/focus-shield.svg" className="h-4 w-4" alt="" />
                                                    <span>FocusShield</span>
                                                </button>

                                                <button
                                                    onClick={async () => {
                                                        await signOut();
                                                        navigate("/login");
                                                        setShowUserMenu(false);
                                                    }}
                                                    className="w-full text-left px-4 py-2 text-sm font-light text-red-600 hover:bg-red-50"
                                                >
                                                    Log out
                                                </button>
                                            </div>
                                        )}
                                    </>
                                )}

                                <button onClick={() => setMobileMenu(true)} className="lg:hidden flex items-center p-2">
                                    <img src="/icons/burger-menu.svg" className="w-7 h-7" alt="Menu" />
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {mobileMenu && (
                    <div className="fixed inset-0 z-50 bg-white w-screen h-[100dvh] overflow-x-hidden overflow-y-auto animate-fadeIn">
                        <div className="w-full min-w-0">
                            <div className="flex justify-between items-center px-5 py-4 border-b border-borderGray">
                                <span className="text-xl font-bold">Menu</span>
                                <button onClick={() => setMobileMenu(false)} className="p-2">
                                    <img src="/icons/close.svg" className="w-6 h-6" alt="Close" />
                                </button>
                            </div>

                            <div className="flex flex-col gap-6 p-6 text-lg text-brandBlack w-full min-w-0">
                                <div className="flex flex-col gap-3 w-full min-w-0">
                                    <button
                                        onClick={() => {
                                            navigate("/sessions");
                                            setMobileMenu(false);
                                        }}
                                        className="text-left"
                                    >
                                        Sessions
                                    </button>

                                    <div className="pl-2 flex flex-col gap-2 w-full min-w-0">
                                        {tabs.map((t) => (
                                            <button
                                                key={t.id}
                                                onClick={() => goToSessions(t.id)}
                                                className={[
                                                    "flex items-center gap-3 px-3 py-2 rounded-xl border border-borderGray hover:bg-black/5 text-left w-full",
                                                    activeSessionsTab === t.id ? "bg-black/5" : "",
                                                ].join(" ")}
                                            >
                                                <img
                                                    src={activeSessionsTab === t.id ? t.iconActive : t.iconInactive}
                                                    className="w-5 h-5 shrink-0"
                                                    alt=""
                                                />
                                                <span className="text-base break-words">{t.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <button
                                    onClick={() => {
                                        navigate("/pricing");
                                        setMobileMenu(false);
                                    }}
                                    className="text-left"
                                >
                                    Pricing
                                </button>

                                <button
                                    onClick={() => {
                                        navigate("/focus-plan");
                                        setMobileMenu(false);
                                    }}
                                    className="text-left"
                                >
                                    Focus plan
                                </button>

                                <button
                                    onClick={() => {
                                        navigate("/focus-shield");
                                        setMobileMenu(false);
                                    }}
                                    className="inline-flex items-center gap-3 text-left"
                                >
                                    <img src="/icons/focus-shield.svg" className="h-5 w-5" alt="" />
                                    <span>FocusShield</span>
                                </button>

                                {user && (
                                    <>
                                        <button
                                            onClick={() => {
                                                if (paywallDecision?.blocked) {
                                                    setPaywallOpen(true);
                                                    setMobileMenu(false);
                                                    return;
                                                }

                                                modal.open();
                                                setMobileMenu(false);
                                            }}
                                            className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-brandBlack text-base hover:bg-slate-100 w-full justify-center"
                                        >
                                            <img src="/icons/create-session.svg" className="w-5 h-5" alt="" />
                                            Create session
                                        </button>

                                        <button
                                            onClick={() => {
                                                navigate("/profile");
                                                setMobileMenu(false);
                                            }}
                                            className="text-left"
                                        >
                                            Profile
                                        </button>

                                        <button
                                            onClick={async () => {
                                                await signOut();
                                                navigate("/login");
                                                setMobileMenu(false);
                                            }}
                                            className="text-red-600 text-left"
                                        >
                                            Log out
                                        </button>
                                    </>
                                )}

                                {!user && (
                                    <>
                                        <button
                                            onClick={() => {
                                                navigate("/login");
                                                setMobileMenu(false);
                                            }}
                                            className="px-4 py-3 rounded-full border border-gray-300 w-full"
                                        >
                                            Log in
                                        </button>

                                        <button
                                            onClick={() => {
                                                navigate("/register");
                                                setMobileMenu(false);
                                            }}
                                            className="px-4 py-3 rounded-full bg-brandBlack text-white w-full"
                                        >
                                            Sign up
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </header>

            <PaywallModal
                open={paywallOpen}
                onClose={() => setPaywallOpen(false)}
                title="Upgrade to create sessions"
                description="You’ve used your 15 free sessions. Upgrade to Pro to keep creating and hosting sessions."
            />
        </>
    );
}
