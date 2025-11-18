import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Header() {
    const navigate = useNavigate();
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

    useEffect(() => {
        async function loadProfile() {
            const {
                data: { user },
            } = await supabase.auth.getUser();

            if (!user) return;

            const { data: profile } = await supabase
                .from("profiles")
                .select("avatar_url")
                .eq("id", user.id)
                .single();

            if (profile?.avatar_url) {
                setAvatarUrl(profile.avatar_url);
            }
        }

        loadProfile();
    }, []);

    return (
        <header className="w-full flex items-center justify-between py-6 px-10 border-b border-[#E5E5E5]">
            {/* Logo */}
            <button
                onClick={() => navigate("/sessions")}
                className="text-4xl font-extrabold hover:opacity-80 transition"
            >
                MySession
            </button>

            {/* Right side */}
            <div className="flex items-center gap-6">
                <button
                    onClick={() => navigate("/create")}
                    className="px-5 py-2 rounded-full border border-black text-black text-sm font-medium hover:bg-black hover:text-white transition"
                >
                    Create a session
                </button>

                <button onClick={() => navigate("/profile")}>
                    <img
                        src={
                            avatarUrl ||
                            "https://ui-avatars.com/api/?name=User&background=EEE&color=111"
                        }
                        alt="avatar"
                        className="w-[50px] h-[50px] rounded-full border border-borderGray object-cover"
                    />
                </button>
            </div>
        </header>
    );
}
