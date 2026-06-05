import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { attachReferralToNewUser } from "../lib/referrals";

function getRedirectPath() {
    if (typeof window === "undefined") return "/sessions";

    const params = new URLSearchParams(window.location.search);
    const redirect = params.get("redirect");

    if (!redirect) return "/sessions";
    if (!redirect.startsWith("/")) return "/sessions";

    return redirect;
}

export const AuthCallback = () => {
    const navigate = useNavigate();
    const handledUserIdRef = useRef<string>("");

    useEffect(() => {
        let mounted = true;

        const finishAuth = async (session: any) => {
            if (!mounted || !session?.user?.id) return;

            const userId = String(session.user.id);

            if (handledUserIdRef.current === userId) {
                navigate(getRedirectPath(), { replace: true });
                return;
            }

            handledUserIdRef.current = userId;

            try {
                const fullName =
                    session.user.user_metadata?.full_name ||
                    session.user.user_metadata?.name ||
                    session.user.email ||
                    "User";

                const avatarUrl =
                    session.user.user_metadata?.avatar_url ||
                    session.user.user_metadata?.picture ||
                    null;

                await supabase.from("profiles").upsert(
                    {
                        id: userId,
                        full_name: fullName,
                        avatar_url: avatarUrl,
                        bio: "",
                    },
                    { onConflict: "id" }
                );

                await attachReferralToNewUser(userId);
            } catch (error) {
                console.warn("[auth callback] profile/referral setup failed:", error);
            }

            if (!mounted) return;

            navigate(getRedirectPath(), { replace: true });
        };

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!mounted) return;
            if (session) void finishAuth(session);
        });

        const handleAuthRedirect = async () => {
            const {
                data: { session },
            } = await supabase.auth.getSession();

            if (!mounted) return;

            if (session) {
                await finishAuth(session);
                return;
            }

            setTimeout(async () => {
                if (!mounted) return;

                const {
                    data: { session: retrySession },
                } = await supabase.auth.getSession();

                if (!mounted) return;

                if (retrySession) {
                    await finishAuth(retrySession);
                } else {
                    navigate("/login", { replace: true });
                }
            }, 2500);
        };

        void handleAuthRedirect();

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, [navigate]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-900">
            <div className="text-center">
                <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
                <h2 className="mb-2 text-xl font-semibold">Finishing sign in...</h2>
                <p className="text-gray-500">
                    Please wait, we’re redirecting you to the app.
                </p>
            </div>
        </div>
    );
};

export default AuthCallback;