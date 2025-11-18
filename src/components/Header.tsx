// src/components/Header.tsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { UserCircle } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function Header() {
    const navigate = useNavigate();
    const [user, setUser] = useState<any>(null);
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [isHoveringCreate, setIsHoveringCreate] = useState(false);

    // Restore session
    useEffect(() => {
        const load = async () => {
            const { data } = await supabase.auth.getSession();
            setUser(data?.session?.user ?? null);
        };
        load();

        const { data: listener } = supabase.auth.onAuthStateChange(
            (_ev, session) => {
                setUser(session?.user ?? null);
            }
        );

        return () => listener.subscription.unsubscribe();
    }, []);

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

                {/* CENTER LOGO */}
                <div className="flex-1 flex justify-center">
                    <button
                        onClick={() => navigate("/")}
                        className="text-4xl font-extrabold hover:opacity-80 transition"
                    >
                        MySession
                    </button>
                </div>

                {/* RIGHT AUTH */}
                <div className="flex-1 flex items-center justify-end gap-3 relative">
                    {!user ? (
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
                            {/* CREATE SESSION BUTTON */}
                            <button
                                onClick={() => navigate("/sessions#create")}
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
                                    alt="create session"
                                    className="w-5 h-5"
                                />
                                <span>Create a session</span>
                            </button>

                            {/* AVATAR BUTTON */}
                            <button
                                onClick={() => setShowUserMenu((v) => !v)}
                                className="flex items-center"
                            >
                                {user.user_metadata?.avatar_url ? (
                                    <img
                                        src={user.user_metadata.avatar_url}
                                        alt="avatar"
                                        className="w-[50px] h-[50px] rounded-full border border-borderGray object-cover"
                                    />
                                ) : (
                                    <UserCircle className="w-10 h-10 text-slate-600" />
                                )}
                            </button>

                            {/* DROPDOWN */}
                            {showUserMenu && (
                                <div className="absolute right-0 top-12 w-48 bg-white rounded-xl shadow-lg border border-borderGray z-20">
                                    <button
                                        onClick={() => navigate("/profile")}
                                        className="w-full text-left px-4 py-2 text-sm font-light hover:bg-slate-50"
                                    >
                                        Profile
                                    </button>

                                    <button
                                        onClick={async () => {
                                            await supabase.auth.signOut();
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
