import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateSessionModal } from "../hooks/useCreateSessionModal";
import { useAuth } from "../context/AuthContext";

export default function Header() {
    const navigate = useNavigate();
    const modal = useCreateSessionModal();
    const { user, profile, loading, signOut } = useAuth();

    const [showUserMenu, setShowUserMenu] = useState(false);
    const [isHoveringCreate, setIsHoveringCreate] = useState(false);

    const avatarSrc =
        profile?.avatar_url ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(
            profile?.full_name || "User"
        )}`;

    return (
        <header className="border-b border-borderGray">
            <div className="w-full px-8 py-6 flex items-center justify-between gap-3">
                {/* LEFT NAV */}
                <nav className="flex items-center gap-6 flex-1 text-sm text-[#2E2E2E]">
                    <button
                        onClick={() => navigate("/sessions")}
                        className="hover:text-black"
                    >
                        Sessions
                    </button>
                    <button className="hover:text-black">Pricing</button>
                    <button className="hover:text-black">Latest updates</button>
                </nav>

                {/* LOGO */}
                <div className="flex-1 flex justify-center">
                    <button
                        onClick={() => navigate("/")}
                        className="text-4xl font-extrabold hover:opacity-80 transition"
                    >
                        MySession
                    </button>
                </div>

                {/* RIGHT AUTH AREA */}
                <div className="flex-1 flex items-center justify-end gap-3 relative">
                    {loading ? (
                        <div className="text-sm text-gray-500">Checking session...</div>
                    ) : !user ? (
                        <div className="flex gap-3">
                            <button
                                onClick={() => navigate("/login")}
                                className="px-4 py-2 rounded-full border border-borderGray text-sm hover:bg-slate-50"
                            >
                                Log in
                            </button>

                            <button
                                onClick={() => navigate("/register")}
                                className="px-4 py-2 rounded-full bg-brandBlack text-white hover:bg-black text-sm font-medium"
                            >
                                Sign up
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* CREATE SESSION */}
                            <button
                                onClick={() => modal.open()}
                                onMouseEnter={() => setIsHoveringCreate(true)}
                                onMouseLeave={() => setIsHoveringCreate(false)}
                                className={`
                  inline-flex items-center gap-2 px-6 py-3 rounded-full 
                  border text-base font-medium transition-colors duration-200
                  border-[#2F2F2F] 
                  ${isHoveringCreate ? "bg-[#2F2F2F] text-white" : "hover:bg-slate-50"}
                `}
                            >
                                <img
                                    src={
                                        isHoveringCreate
                                            ? "/icons/create-session-white.svg"
                                            : "/icons/create-session.svg"
                                    }
                                    className="w-5 h-5"
                                />
                                <span>Create a session</span>
                            </button>

                            {/* AVATAR */}
                            <button
                                onClick={() => setShowUserMenu((v) => !v)}
                                className="flex items-center"
                            >
                                <img
                                    src={avatarSrc}
                                    className="w-[50px] h-[50px] rounded-full border border-borderGray object-cover"
                                />
                            </button>

                            {/* DROPDOWN */}
                            {showUserMenu && (
                                <div className="absolute right-0 top-12 w-48 bg-white rounded-xl shadow-lg border border-borderGray z-20">
                                    <button
                                        onClick={() => {
                                            setShowUserMenu(false);
                                            navigate("/profile");
                                        }}
                                        className="w-full text-left px-4 py-2 text-sm font-light hover:bg-slate-50"
                                    >
                                        Profile
                                    </button>

                                    <button
                                        onClick={async () => {
                                            await signOut();
                                            setShowUserMenu(false);
                                            navigate("/login");
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
        </header>
    );
}
