const DEBUG = true;

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateSessionModal } from "../context/CreateSessionModalContext";
import { useAuth } from "../context/AuthContext";

export default function Header() {
    const navigate = useNavigate();
    const modal = useCreateSessionModal();
    const { user, profile, loading, signOut } = useAuth();

    const [showUserMenu, setShowUserMenu] = useState(false);
    const [mobileMenu, setMobileMenu] = useState(false);
    const [hoverCreate, setHoverCreate] = useState(false);

    const avatarSrc =
        profile?.avatar_url ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(
            profile?.full_name || "User"
        )}`;

    return (
        <header className="border-b border-borderGray bg-white sticky top-0 z-30">
            <div className="w-full px-5 md:px-8 py-5 flex items-center justify-between gap-3">

                {/* LEFT NAV (only on >=1024px) */}
                <nav className="hidden lg:flex items-center gap-6 flex-1 text-sm text-[#2E2E2E]">
                    <button
                        onClick={() => navigate("/sessions")}
                        className="hover:text-brandBlack"
                    >
                        Sessions
                    </button>
                    <button className="hover:text-brandBlack">Pricing</button>
                    <button className="hover:text-brandBlack">Latest updates</button>
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
                            {/* CREATE SESSION: only from ≥768px */}
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
                                    src={
                                        hoverCreate
                                            ? "/icons/create-session-white.svg"
                                            : "/icons/create-session.svg"
                                    }
                                    className="w-5 h-5"
                                />
                                <span>Create a session</span>
                            </button>

                            {/* AVATAR (always from ≥360px in your mockup) */}
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

                            {/* BURGER (hidden only on ≥1024px) */}
                            <button
                                onClick={() => setMobileMenu(true)}
                                className="lg:hidden flex items-center p-2"
                            >
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
                        <button
                            onClick={() => setMobileMenu(false)}
                            className="p-2"
                        >
                            <img src="/icons/close.svg" className="w-6 h-6" />
                        </button>
                    </div>

                    <div className="flex flex-col gap-6 p-6 text-lg text-brandBlack">
                        <button
                            onClick={() => {
                                navigate("/sessions");
                                setMobileMenu(false);
                            }}
                        >
                            Sessions
                        </button>

                        <button>Pricing</button>
                        <button>Latest updates</button>

                        {user && (
                            <>
                                {/* Create always available in menu */}
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
                                >
                                    Profile
                                </button>

                                <button
                                    onClick={async () => {
                                        await signOut();
                                        navigate("/login");
                                        setMobileMenu(false);
                                    }}
                                    className="text-red-600"
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
