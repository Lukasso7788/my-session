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
    if (redirect.startsWith("//")) return "/sessions";

    return redirect;
}

function getOAuthProfileDefaults(user: any) {
    const metadata = user?.user_metadata || {};

    const fullName = String(
        metadata.full_name || metadata.name || user?.email || "User"
    ).trim();

    const avatarUrl = String(metadata.avatar_url || metadata.picture || "").trim();

    return {
        fullName: fullName || "User",
        avatarUrl: avatarUrl || null,
    };
}

async function ensureProfileWithoutOverwriting(user: any) {
    const userId = String(user?.id || "").trim();
    if (!userId) return;

    const { data: existing, error: existingError } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, bio")
        .eq("id", userId)
        .maybeSingle();

    if (existingError) {
        console.warn("[auth callback] profile lookup failed:", existingError);
        return;
    }

    if (existing?.id) {
        // Important: existing profile wins.
        // OAuth login must NOT overwrite user's edited name, avatar, or bio.
        return;
    }

    const defaults = getOAuthProfileDefaults(user);

    const { error: insertError } = await supabase.from("profiles").insert({
        id: userId,
        full_name: defaults.fullName,
        avatar_url: defaults.avatarUrl,
        bio: "",
    });

    if (insertError) {
        console.warn("[auth callback] profile insert failed:", insertError);
    }
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
                await ensureProfileWithoutOverwriting(session.user);
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
