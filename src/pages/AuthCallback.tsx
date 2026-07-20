import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { attachReferralToNewUser } from "../lib/referrals";
import { withTimeout } from "../lib/promiseTimeout";

const SESSION_TIMEOUT_MS = 10_000;

function getRedirectPath() {
    if (typeof window === "undefined") return "/sessions";

    const params = new URLSearchParams(window.location.search);
    const redirect = params.get("redirect");

    if (!redirect) return "/sessions";
    if (!redirect.startsWith("/")) return "/sessions";
    if (redirect.startsWith("//")) return "/sessions";

    return redirect;
}

function getOAuthProfileDefaults(user: User) {
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

async function ensureProfileWithoutOverwriting(user: User) {
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

        const finishAuth = async (session: Session) => {
            if (!mounted || !session?.user?.id) return;

            const userId = String(session.user.id);

            if (handledUserIdRef.current === userId) {
                navigate(getRedirectPath(), { replace: true });
                return;
            }

            handledUserIdRef.current = userId;

            // The authenticated session is sufficient to enter the app. Profile
            // hydration is best-effort and must not add PostgREST latency to OAuth.
            navigate(getRedirectPath(), { replace: true });

            void Promise.allSettled([
                ensureProfileWithoutOverwriting(session.user),
                attachReferralToNewUser(userId),
            ]).then((results) => {
                results.forEach((result) => {
                    if (result.status === "rejected") {
                        console.warn("[auth callback] background profile setup failed:", result.reason);
                    }
                });
            });
        };

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!mounted) return;
            if (session) void finishAuth(session);
        });

        const handleAuthRedirect = async () => {
            let session: Session | null = null;

            try {
                const result = await withTimeout(
                    supabase.auth.getSession(),
                    SESSION_TIMEOUT_MS,
                    "Timed out while restoring the authenticated session."
                );
                if (result.error) throw result.error;
                session = result.data.session;
            } catch (error) {
                console.warn("[auth callback] initial session restore failed:", error);
            }

            if (!mounted) return;

            if (session) {
                await finishAuth(session);
                return;
            }

            window.setTimeout(async () => {
                if (!mounted) return;

                let retrySession: Session | null = null;
                try {
                    const result = await withTimeout(
                        supabase.auth.getSession(),
                        SESSION_TIMEOUT_MS,
                        "Timed out while retrying the authenticated session."
                    );
                    if (result.error) throw result.error;
                    retrySession = result.data.session;
                } catch (error) {
                    console.warn("[auth callback] retry session restore failed:", error);
                }

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
