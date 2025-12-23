// src/components/Header.tsx
const DEBUG = true;

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useCreateSessionModal } from "../context/CreateSessionModalContext";
import { useAuth } from "../context/AuthContext";

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

export default function Header() {
    const navigate = useNavigate();
    const location = useLocation();
    const modal = useCreateSessionModal();
    const { user, profile, loading, signOut } = useAuth();

    const [showUserMenu, setShowUserMenu] = useState(false);
    const [mobileMenu, setMobileMenu] = useState(false);
    const [hoverCreate, setHoverCreate] = useState(false);

    // Sessions dropdown (desktop)
    const [sessionsOpen, setSessionsOpen] = useState(false);
    const [hoveredSessionTab, setHoveredSessionTab] = useState<SessionTabId | null>(null);
    const dropdownRef = useRef<HTMLDivElement | null>(null);

    const avatarSrc =
        profile?.avatar_url ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.full_name || "User")}`;

    // ✅ FIX: determine active tab by querystring (?tab=...)
    const activeSessionsTab: SessionTabId = useMemo(() => {
        const params = new URLSearchParams(location.search);
        const tab = (params.get("tab") || "group").toLowerCase();

        if (tab === "infinite" || tab === "body" || tab === "group") return tab;
        return "group";
    }, [location.search]);

    useEffect(() => {
        function onDocClick(e: MouseEvent) {
            if (!dropdownRef.current) return;
            if (!dropdownRef.current.contains(e.target as Node)) setSessionsOpen(false);
        }
        function onEsc(e: KeyboardEvent) {
            if (e.key === "Escape") setSessionsOpen(false);
        }
        document.addEventListener("mousedown", onDocClick);
        document.addEventListener("keydown", onEsc);
        return () => {
            document.removeEventListener("mousedown", onDocClick);
            document.removeEventListener("keydown", onEsc);
        };
    }, []);

    const goToSessions = (tabId: SessionTabId) => {
        navigate(`/sessions?tab=${tabId}`);
        setSessionsOpen(false);
        setMobileMenu(false);
    };

    return (
        <header className="border-b border-borderGray bg-white sticky top-0 z-30">
            <div className="w-full px-5 md:px-8 py-5 flex items-center justify-between gap-3">
                {/* LEFT NAV (only on >=1024px) */}
                <nav className="hidden lg:flex items-center gap-6 flex-1 text-sm text-[#2E2E2E]">
                    {/* Sessions dropdown */}
                    <div className="relative" ref={dropdownRef}>
                        <button
                            onClick={() => setSessionsOpen((v) => !v)}
                            onMouseEnter={() => setSessionsOpen(true)}
                            className="hover:text-[#2F2F2F] inline-flex items-center gap-2"
                        >
                            Sessions
                            <span
                                className={[
                                    "transition-transform",
                                    sessionsOpen ? "rotate-180" : "rotate-0",
                                ].join(" ")}
                                aria-hidden
                            >
                                <img src="/icons/arrow.svg" className="w-3 h-3" />
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
                                            <img
                                                src={showActiveIcon ? t.iconActive : t.iconInactive}
                                                className="w-5 h-5"
                                                alt=""
                                            />
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

                    {/* Pricing + Updates */}
                    <button onClick={() => navigate("/pricing")} className="hover:text-[#2F2F2F]">
                        Pricing
                    </button>
                    <button onClick={() => navigate("/updates")} className="hover:text-[#2F2F2F]">
                        Latest updates
                    </button>
                </nav>

                {/* LOGO */}
                <div className="flex-1 flex justify-start lg:justify-center">
                    <button
                        onClick={() => navigate("/")}
                        className="text-[28px] md:text-4xl font-extrabold text-brandBlack hover:opacity-80 transition"
                    >
                        MySession
                    </button>
                </div>

                {/* RIGHT */}
                <div className="flex-1 flex items-center justify-end gap-3 relative">
                    {loading ? (
                        <div className="text-sm text-gray-500">Checking session...</div>
                    ) : !user ? (
                        <div className="hidden sm:flex gap-3">
                            <button
                                onClick={() => navigate("/login")}
                                className="px-4 py-2 rounded-full border border-borderGray text-sm hover:bg-slate-50"
                            >
                                Log in
                            </button>

                            <button
                                onClick={() => navigate("/register")}
                                className="px-4 py-2 rounded-full bg-brandBlack text-white hover:bg-brandBlack text-sm font-medium"
                            >
                                Sign up
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* CREATE SESSION */}
                            <button
                                onClick={() => modal.open()}
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
                                />
                                <span>Create a session</span>
                            </button>

                            {/* AVATAR */}
                            {user && (
                                <button
                                    onClick={() => setShowUserMenu((v) => !v)}
                                    className="hidden sm:flex items-center"
                                >
                                    <img
                                        src={avatarSrc}
                                        className="w-[42px] h-[42px] md:w-[50px] md:h-[50px] rounded-full border border-borderGray object-cover"
                                    />
                                </button>
                            )}

                            {/* BURGER */}
                            <button onClick={() => setMobileMenu(true)} className="lg:hidden flex items-center p-2">
                                <img src="/icons/burger-menu.svg" className="w-7 h-7" />
                            </button>

                            {/* Desktop User Menu */}
                            {showUserMenu && (
                                <div className="hidden sm:block absolute right-0 top-14 w-48 bg-white rounded-xl shadow-lg border border-borderGray z-40">
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
                </div>
            </div>

            {/* FULL-SCREEN MENU */}
            {mobileMenu && (
                <div className="fixed inset-0 z-50 bg-white w-full max-w-full h-screen overflow-y-auto animate-fadeIn">
                    <div className="flex justify-between items-center px-5 py-4 border-b border-borderGray">
                        <span className="text-xl font-bold">Menu</span>
                        <button onClick={() => setMobileMenu(false)} className="p-2">
                            <img src="/icons/close.svg" className="w-6 h-6" />
                        </button>
                    </div>

                    <div className="flex flex-col gap-6 p-6 text-lg text-brandBlack">
                        {/* Sessions section in mobile */}
                        <div className="flex flex-col gap-3">
                            <button
                                onClick={() => {
                                    navigate("/sessions");
                                    setMobileMenu(false);
                                }}
                                className="text-left"
                            >
                                Sessions
                            </button>

                            <div className="pl-2 flex flex-col gap-2">
                                {tabs.map((t) => (
                                    <button
                                        key={t.id}
                                        onClick={() => goToSessions(t.id)}
                                        className="flex items-center gap-3 px-3 py-2 rounded-xl border border-borderGray hover:bg-black/5 text-left"
                                    >
                                        <img src={t.iconInactive} className="w-5 h-5" alt="" />
                                        <span className="text-base">{t.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Pricing + Updates */}
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
                                navigate("/updates");
                                setMobileMenu(false);
                            }}
                            className="text-left"
                        >
                            Latest updates
                        </button>

                        {user && (
                            <>
                                <button
                                    onClick={() => {
                                        modal.open();
                                        setMobileMenu(false);
                                    }}
                                    className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-brandBlack text-base hover:bg-slate-100"
                                >
                                    <img src="/icons/create-session.svg" className="w-5 h-5" />
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
                                    className="px-4 py-3 rounded-full border border-gray-300"
                                >
                                    Log in
                                </button>

                                <button
                                    onClick={() => {
                                        navigate("/register");
                                        setMobileMenu(false);
                                    }}
                                    className="px-4 py-3 rounded-full bg-brandBlack text-white"
                                >
                                    Sign up
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}
        </header>
    );
}
