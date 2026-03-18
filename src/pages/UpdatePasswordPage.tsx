import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import HeaderLite from "../components/HeaderLite";
import { Eye, EyeOff } from "lucide-react";

export default function UpdatePasswordPage() {
    const navigate = useNavigate();

    const [password, setPassword] = useState("");
    const [password2, setPassword2] = useState("");
    const [showPass, setShowPass] = useState(false);
    const [ready, setReady] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let mounted = true;

        const init = async () => {
            try {
                const { data } = await supabase.auth.getSession();
                if (mounted && data.session) {
                    setReady(true);
                }
            } catch { }

            const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
                if (event === "PASSWORD_RECOVERY" || session) {
                    setReady(true);
                }
            });

            return () => {
                sub.subscription.unsubscribe();
            };
        };

        let cleanup: any;
        init().then((fn) => {
            cleanup = fn;
        });

        return () => {
            mounted = false;
            if (cleanup) cleanup();
        };
    }, []);

    const handleUpdatePassword = async () => {
        if (!password || !password2) {
            alert("Please enter the new password twice.");
            return;
        }

        if (password.length < 6) {
            alert("Password should be at least 6 characters.");
            return;
        }

        if (password !== password2) {
            alert("Passwords do not match.");
            return;
        }

        try {
            setLoading(true);

            const { error } = await supabase.auth.updateUser({
                password,
            });

            if (error) {
                alert(error.message);
                return;
            }

            alert("Password updated successfully.");
            navigate("/login", { replace: true });
        } catch (error: any) {
            alert(error?.message || "Failed to update password.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-white text-gray-900 flex flex-col font-inter">
            <HeaderLite />

            <div className="flex flex-col items-center w-full pt-16 px-4">
                <div className="w-full max-w-md mx-auto">
                    <h2 className="text-center text-[32px] font-bold mb-6">Set new password</h2>

                    {!ready ? (
                        <div className="rounded-[16px] border border-gray-200 bg-gray-50 px-4 py-4 text-sm text-gray-700">
                            Open this page from the password reset email link.
                        </div>
                    ) : (
                        <>
                            <label className="block text-sm mb-1">New password</label>
                            <div className="relative mb-4">
                                <input
                                    type={showPass ? "text" : "password"}
                                    placeholder="Enter new password"
                                    className="w-full border border-gray-300 rounded-[16px] px-4 py-3 bg-white focus:ring-2 focus:ring-[#2F2F2F] outline-none"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                                <button
                                    type="button"
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                                    onClick={() => setShowPass((v) => !v)}
                                >
                                    {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>

                            <label className="block text-sm mb-1">Repeat new password</label>
                            <input
                                type={showPass ? "text" : "password"}
                                placeholder="Repeat new password"
                                className="w-full border border-gray-300 rounded-[16px] px-4 py-3 mb-6 bg-white focus:ring-2 focus:ring-[#2F2F2F] outline-none"
                                value={password2}
                                onChange={(e) => setPassword2(e.target.value)}
                            />

                            <button
                                onClick={handleUpdatePassword}
                                disabled={loading}
                                className="w-full bg-[#2F2F2F] text-white py-3 rounded-[16px] text-[18px] font-semibold hover:bg-[#1F1F1F] transition disabled:opacity-60"
                            >
                                {loading ? "Saving…" : "Update password"}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}