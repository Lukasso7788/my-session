import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

function safeNextPath(raw: string | null) {
    const fallback = "/sessions";
    const next = String(raw || "").trim();

    if (!next) return fallback;

    // Не разрешаем external redirects.
    if (/^https?:\/\//i.test(next)) return fallback;
    if (!next.startsWith("/")) return fallback;

    return next;
}

export default function AuthCallbackPage() {
    const navigate = useNavigate();

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            const url = new URL(window.location.href);
            const next = safeNextPath(url.searchParams.get("next"));

            try {
                await supabase.auth.getSession();
            } catch (e) {
                console.error("[auth-callback] getSession failed:", e);
            }

            if (!cancelled) {
                navigate(next, { replace: true });
            }
        };

        void run();

        return () => {
            cancelled = true;
        };
    }, [navigate]);

    return (
        <main className="min-h-screen bg-white text-gray-950 flex items-center justify-center px-6">
            <div className="rounded-3xl border border-gray-200 bg-white px-6 py-5 shadow-sm text-center">
                <div className="text-base font-semibold">Signing you in…</div>
                <div className="mt-2 text-sm text-gray-500">
                    You’ll return to your session in a moment.
                </div>
            </div>
        </main>
    );
}