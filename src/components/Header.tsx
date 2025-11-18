import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UserCircle } from "lucide-react";
import { supabase } from "../lib/supabase";

export function Header() {
    const navigate = useNavigate();
    const [user, setUser] = useState<any>(null);
    const [menuOpen, setMenuOpen] = useState(false);

    // Restore auth
    useEffect(() => {
        const load = async () => {
            const { data } = await supabase.auth.getSession();
            setUser(data?.session?.user ?? null);
        };
        load();

        const { data: listener } = supabase.auth.onAuthStateChange(
            (_event, session) => setUser(session?.user ?? null)
        );

        return () => listener.subscription.unsubscribe();
    }, []);

    return (
        <header className="w-full border-b border-borderGray">
            <div className="px-8 py-6 flex items-center justify-between w-full">

                {/* LEFT NAV */}
                <nav className="flex items-center gap-6 text-sm text-[#2E2E2E]">
                    <button onClick={() => navigate("/sessions")} className="hover:text-black">
                        Sessions
                    </button>
                    <button className="hover:text-black">Pricing</button>
                    <button className="hover:text-black">Latest updates</button>
                </nav>

                {/* LOGO */}
                <button
                    onClick={() => navigate("/")}
                    className="text-4xl font-extrabold hover:opacity-80 transition"
                >
                    MySession
                </button>

                {/* AUTH */}
                <div className="flex items-center gap-4 relative">
                    {!user ? (
                        <>
                            <button
                                onClick={() => navigate("/login")}
                                className="px-4 py-2 rounded-full border border-borderGray text-sm hover:bg-slate-50"
                            >
                                Log in
                            </button>
                            <button
                                onClick={() => navigate("/register")}
                                className="px-4 py-2 rounded-full bg-brandBlack text-white text-sm hover:bg-black"
                            >
                                Sign up
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={() => navigate("/create")}
                                className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-borderGray text-sm hover:bg-slate-50"
                            >
                                <img src="/icons/create-session.svg" className="w-5 h-5" />
                                Create a session
                            </button>

                            <button onClick={() => setMenuOpen(!menuOpen)}>
                                {user.user_metadata?.avatar_url ? (
                                    <img
                                        src={user.user_metadata.avatar_url}
                                        className="w-[50px] h-[50px] rounded-full border border-borderGray object-cover"
                                    />
                                ) : (
                                    <UserCircle className="w-[50px] h-[50px] text-slate-600" />
                                )}
                            </button>

                            {menuOpen && (
                                <div className="absolute right-0 top-14 w-48 bg-white border border-borderGray rounded-xl shadow-lg py-2">
                                    <button
                                        onClick={() => navigate("/profile")}
                                        className="w-full text-left px-4 py-2 text-[14px] font-light hover:bg-slate-50"
                                    >
                                        Profile
                                    </button>
                                    <button
                                        onClick={async () => {
                                            await supabase.auth.signOut();
                                            setMenuOpen(false);
                                            navigate("/login");
                                        }}
                                        className="w-full text-left px-4 py-2 text-[14px] font-light text-red-600 hover:bg-red-50"
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
