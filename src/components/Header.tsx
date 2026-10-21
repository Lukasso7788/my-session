import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useCreateSessionModal } from "../context/CreateSessionModalContext";
import { useAuth } from "../context/AuthContext";
import {
    isPersonalPaywallForced,
    type EntitlementState,
} from "../lib/entitlements";
import { getPaywallDecision } from "../lib/paywall";
import PaywallModal from "./PaywallModal";
import FreeSessionsNotice from "./FreeSessionsNotice";
import HeaderPlanBadge from "./HeaderPlanBadge";
import { useAccountEntitlement } from "../hooks/useAccountEntitlement";
import { getFreeSessionUsage } from "../lib/freeSessionNotice";
import { PAYWALL_ENABLED } from "../lib/flags";
import { getMembershipBadge, isComplimentaryPro } from "../lib/membershipPresentation";

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
        label: "24/7 sessions",
        iconActive: "/icons/infinite-active-black.svg",
        iconInactive: "/icons/infinite-inactive.svg",
    },
    {
        id: "one-on-one",
        label: "1-on-1",
        iconActive: "/icons/one-on-one-inactive.svg",
        iconInactive: "/icons/one-on-one-inactive.svg",
    },
] as const;

type SessionTabId = (typeof tabs)[number]["id"];

function getPlanPopoverTitle(state: EntitlementState | null): string {
    if (!state?.isLoggedIn) return "";
    if (state.isUnlimited && state.entitlement?.plan === "founding_free") return "Founding Member Pro";
    return state.isUnlimited ? "Pro plan" : "Free plan";
}

function getPlanPopoverText(state: EntitlementState | null): string {
    if (!state?.isLoggedIn) return "";

    const plan = String(state?.entitlement?.plan || "free").toLowerCase();
    const status = String(state?.entitlement?.status || "active").toLowerCase();

    if (state.isUnlimited && isComplimentaryPro(state.entitlement)) {
        return "Your complimentary Pro access is active. No recurring payments or automatic renewal.";
    }

    if (state.isUnlimited && (plan === "pro_monthly" || plan === "pro_yearly")) {
        return "Manage your plan, billing and cancellation in account settings.";
    }

    if (state.isUnlimited && plan === "founding_free") {
        return "Free permanent Pro access as a founding member. No subscription or renewal payments.";
    }

    if (state.isUnlimited && plan === "lifetime") {
        return "Your purchased Lifetime Pro access is active. No renewal payments.";
    }

    const usage = getFreeSessionUsage({ ...state, enabled: PAYWALL_ENABLED });
    if (usage) return `${usage.title}. ${Math.min(usage.used, usage.limit)} of ${usage.limit} free sessions used.`;
    if (state.lifetimeSessionsCount === null) return "Your session usage is temporarily unavailable.";
    return `${state.lifetimeSessionsCount} sessions attended. Your plan is Free${status === "trialing" ? " (trial)" : ""}.`;
}

export default function Header() {
    const navigate = useNavigate();
    const location = useLocation();
    const isUnifiedSessions = location.pathname === "/sessions";
    const sessionTabs = tabs;
    const modal = useCreateSessionModal();
    const { user, profile, loading, signOut } = useAuth();

    const [showUserMenu, setShowUserMenu] = useState(false);
    const [mobileMenu, setMobileMenu] = useState(false);
    const [hoverCreate, setHoverCreate] = useState(false);

    const [sessionsOpen, setSessionsOpen] = useState(false);
    const [hoveredSessionTab, setHoveredSessionTab] = useState<SessionTabId | null>(null);
    const dropdownRef = useRef<HTMLDivElement | null>(null);

    const { state: entitlementState } = useAccountEntitlement(user?.id, location.pathname);
    const [planBadgeOpen, setPlanBadgeOpen] = useState(false);
    const planBadgeWrapRef = useRef<HTMLDivElement | null>(null);
    const planBadgeCloseTimeoutRef = useRef<number | null>(null);

    const [paywallOpen, setPaywallOpen] = useState(false);

    const avatarSrc =
        profile?.avatar_url ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.full_name || "User")}`;

    const activeSessionsTab: SessionTabId = useMemo(() => {
        if (isUnifiedSessions && new URLSearchParams(location.search).get("tab") !== "one-on-one") return location.hash === "#group-sessions" ? "group" : "infinite";
        if (location.pathname === "/one-on-one") return "one-on-one";

        const params = new URLSearchParams(location.search);
        const tab = (params.get("tab") || (location.pathname === "/sessions" ? "infinite" : "group")).toLowerCase();

        if (tab === "infinite" || tab === "one-on-one" || tab === "group") return tab as SessionTabId;
        return "group";
    }, [isUnifiedSessions, location.hash, location.pathname, location.search]);

    const planBadgeLabel = getMembershipBadge({
        isLoggedIn: Boolean(entitlementState?.isLoggedIn),
        isUnlimited: Boolean(entitlementState?.isUnlimited),
        plan: entitlementState?.entitlement?.plan,
    });
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

    const paywallBlocked = isPersonalPaywallForced(entitlementState)
        ? true
        : !!paywallDecision?.blocked;

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
        return () => {
            if (planBadgeCloseTimeoutRef.current != null) {
                window.clearTimeout(planBadgeCloseTimeoutRef.current);
            }
        };
    }, []);

    const goToSessions = (tabId: SessionTabId) => {
        if (tabId !== "one-on-one") {
            navigate(`/sessions#${tabId === "infinite" ? "infinite-rooms" : "group-sessions"}`);
        } else {
            navigate(`/sessions?tab=${tabId}`);
        }
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
        if (paywallBlocked) {
            setPaywallOpen(true);
            return;
        }

        modal.open();
    };

    return (
        <>
            <header className="border-b border-borderGray bg-white sticky top-0 z-30">
                <div className="w-full px-5 md:px-8 py-5 flex items-center justify-between gap-3 lg:gap-6">
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
                                    {sessionTabs.map((t) => {
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

                        <button onClick={() => navigate("/tasks")} className="hover:text-[#2F2F2F]">
                            Tasks
                        </button>

                        {/* Until the right side has room (wider when signed in,
                            because of Create a session and the avatar) these stay here. */}
                        <button onClick={() => navigate("/hosts")} className={`hover:text-[#2F2F2F] ${user ? "2xl:hidden" : "xl:hidden"}`}>
                            Hosts
                        </button>

                        <button onClick={() => navigate("/leaderboard")} className={`hover:text-[#2F2F2F] ${user ? "2xl:hidden" : "xl:hidden"}`}>
                            Leaderboard
                        </button>
                    </nav>

                    <div className="flex-1 flex justify-start lg:flex-none lg:justify-center">
                        <div className="relative inline-flex items-center justify-center" ref={planBadgeWrapRef}>
                            <button
                                onClick={() => navigate("/")}
                                className="text-[28px] md:text-4xl font-extrabold text-brandBlack hover:opacity-80 transition"
                            >
                                MySession
                            </button>

                            {planBadgeLabel ? (
                                <HeaderPlanBadge
                                    label={planBadgeLabel}
                                    open={planBadgeOpen}
                                    title={planPopoverTitle}
                                    description={planPopoverText}
                                    onBadgeClick={handlePlanBadgeClick}
                                    onOpen={openPlanPopover}
                                    onClose={closePlanPopoverWithDelay}
                                    onActionClick={() => {
                                        setPlanBadgeOpen(false);
                                        navigate(planBadgeLabel === "Free" ? "/pricing" : "/settings#subscription");
                                    }}
                                />
                            ) : null}
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-3 flex-1">
                        <div className={`mr-1 hidden items-center gap-1 ${user ? "2xl:flex" : "xl:flex"}`}>
                            {([
                                ["/hosts", "Hosts"],
                                ["/leaderboard", "Leaderboard"],
                            ] as const).map(([path, label]) => {
                                const active = location.pathname === path;
                                return (
                                    <button
                                        key={path}
                                        onClick={() => navigate(path)}
                                        aria-current={active ? "page" : undefined}
                                        className={`h-10 px-3 text-sm transition-colors ${active ? "text-[#2F2F2F]" : "text-[#2E2E2E] hover:text-[#2F2F2F]"}`}
                                    >
                                        {label}
                                    </button>
                                );
                            })}
                        </div>

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
                                            <span>Create session</span>
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
                                                        navigate("/settings");
                                                        setShowUserMenu(false);
                                                    }}
                                                    className="w-full text-left px-4 py-2 text-sm font-light hover:bg-slate-50"
                                                >
                                                    Settings
                                                </button>

                                                <button
                                                    onClick={() => { navigate("/settings#subscription"); setShowUserMenu(false); }}
                                                    className="w-full text-left px-4 py-2 text-sm font-light hover:bg-slate-50"
                                                >Subscription</button>

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
                                        {sessionTabs.map((t) => (
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
                                        navigate("/tasks");
                                        setMobileMenu(false);
                                    }}
                                    className="text-left"
                                >
                                    Tasks
                                </button>

                                <button
                                    onClick={() => {
                                        navigate("/hosts");
                                        setMobileMenu(false);
                                    }}
                                    className="text-left"
                                >
                                    Hosts
                                </button>

                                <button
                                    onClick={() => {
                                        navigate("/leaderboard");
                                        setMobileMenu(false);
                                    }}
                                    className="text-left"
                                >
                                    Leaderboard
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
                                                handleCreateSessionClick();
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
                                            onClick={() => {
                                                navigate("/settings");
                                                setMobileMenu(false);
                                            }}
                                            className="text-left"
                                        >
                                            Settings
                                        </button>

                                        <button onClick={() => { navigate("/settings#subscription"); setMobileMenu(false); }} className="text-left">Subscription</button>

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

                {location.pathname === "/sessions" ? (
                    // Inside the sticky header so it stays attached while scrolling. Edge to
                    // edge; -mb-px lays its red bottom line over the header's own border.
                    <FreeSessionsNotice state={entitlementState} className="relative -mb-px border-t border-t-borderGray" />
                ) : null}
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
