import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { attachReferralToNewUser } from "../lib/referrals";
import { withTimeout } from "../lib/promiseTimeout";
import { notifyAuthProfileReady } from "../lib/authProfileEvents";

const SESSION_TIMEOUT_MS = 8_000;
const SESSION_RECOVERY_WINDOW_MS = 45_000;
const SESSION_RETRY_INTERVAL_MS = 1_500;

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

    const defaults = getOAuthProfileDefaults(user);

    if (existing?.id) {
        // Keep user-edited values, but hydrate fields that the initial profile
        // bootstrap did not receive from Discord yet.
        const missingFields: Record<string, string> = {};
        const existingName = String(existing.full_name || "").trim();
        const isBootstrapName =
            !existingName ||
            existingName.toLowerCase() === "user" ||
            existingName.toLowerCase() === String(user.email || "").toLowerCase();
        if (isBootstrapName && defaults.fullName) {
            missingFields.full_name = defaults.fullName;
        }
        if (!String(existing.avatar_url || "").trim() && defaults.avatarUrl) {
            missingFields.avatar_url = defaults.avatarUrl;
        }

        if (Object.keys(missingFields).length) {
            const { error: updateError } = await supabase
                .from("profiles")
                .update(missingFields)
                .eq("id", userId);
            if (updateError) {
                console.warn("[auth callback] profile hydration failed:", updateError);
            }
        }
        return;
    }

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
    const [callbackError, setCallbackError] = useState("");

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
                notifyAuthProfileReady(userId);
            });
        };

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!mounted) return;
            if (session) void finishAuth(session);
        });

        const handleAuthRedirect = async () => {
            const recoveryStartedAt = Date.now();

            while (
                mounted &&
                Date.now() - recoveryStartedAt < SESSION_RECOVERY_WINDOW_MS
            ) {
                try {
                    const result = await withTimeout(
                        supabase.auth.getSession(),
                        SESSION_TIMEOUT_MS,
                        "Timed out while restoring the authenticated session."
                    );
                    if (result.error) throw result.error;

                    if (result.data.session) {
                        await finishAuth(result.data.session);
                        return;
                    }
                } catch (error) {
                    console.warn("[auth callback] session restore attempt failed:", error);
                }

                if (!mounted) return;

                await new Promise<void>((resolve) => {
                    window.setTimeout(resolve, SESSION_RETRY_INTERVAL_MS);
                });
            }

            if (mounted && !handledUserIdRef.current) {
                setCallbackError(
                    "We couldn't finish signing you in. Please retry the connection."
                );
            }
        };

        void handleAuthRedirect();

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, [navigate]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-white px-4 text-[#2f2f2f]">
            <div className="w-full max-w-sm text-center">
                {callbackError ? (
                    <div className="rounded-3xl border border-gray-200 p-6">
                        <h2 className="mb-2 text-xl font-semibold">Sign-in needs another try</h2>
                        <p className="mb-5 text-sm leading-6 text-gray-500">{callbackError}</p>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => window.location.reload()}
                                className="flex-1 rounded-full bg-[#2f2f2f] px-4 py-3 text-sm font-semibold text-white hover:bg-black"
                            >
                                Try again
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate("/login", { replace: true })}
                                className="flex-1 rounded-full bg-gray-100 px-4 py-3 text-sm font-semibold hover:bg-gray-200"
                            >
                                Back to login
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="mx-auto mb-4 h-11 w-11 animate-spin rounded-full border-2 border-gray-200 border-t-[#2f2f2f]" />
                        <h2 className="mb-2 text-xl font-semibold">Finishing sign in...</h2>
                        <p className="text-sm text-gray-500">
                            Please wait while MySession restores your session.
                        </p>
                    </>
                )}
            </div>
        </div>
    );
};

export default AuthCallback;
