import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { attachReferralToNewUser } from "../lib/referrals";
import { notifyAuthProfileReady } from "../lib/authProfileEvents";
import { useAuth } from "../context/AuthContext";

const SESSION_RECOVERY_WINDOW_MS = 90_000;

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
    const { adoptSession } = useAuth();
    const handledUserIdRef = useRef<string>("");
    const [callbackError, setCallbackError] = useState("");

    useEffect(() => {
        let mounted = true;

        const finishAuth = async (session: Session) => {
            if (!mounted || !session?.user?.id) return;

            const userId = String(session.user.id);

            if (handledUserIdRef.current === userId) {
                // A repeated SIGNED_IN event is expected when persistence is
                // confirmed below. The first invocation owns navigation; a
                // duplicate must not unmount the callback while it is awaiting.
                return;
            }

            handledUserIdRef.current = userId;

            // Discord has already returned a valid session at this point.
            // Re-apply that exact session before routing so persistence is
            // completed even when the browser's initial URL detection was slow.
            const { data: persistedData, error: persistError } =
                await supabase.auth.setSession({
                    access_token: session.access_token,
                    refresh_token: session.refresh_token,
                });
            if (persistError) throw persistError;
            if (persistedData.session?.user?.id !== userId) {
                throw new Error("The browser did not persist the signed-in session.");
            }
            if (!mounted) return;
            adoptSession(persistedData.session);

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

        let recoveryTimer: number | null = window.setTimeout(() => {
            if (mounted && !handledUserIdRef.current) {
                setCallbackError(
                    "We couldn't finish signing you in. Check the connection and try once more."
                );
            }
        }, SESSION_RECOVERY_WINDOW_MS);

        const handleAuthRedirect = async () => {
            try {
                // Do not wrap this in repeated timeouts. Supabase initialization
                // and the PKCE exchange share one browser lock; abandoned calls
                // keep running and retries only create a lock queue.
                const result = await supabase.auth.getSession();
                if (result.error) throw result.error;

                if (result.data.session) {
                    if (recoveryTimer) {
                        window.clearTimeout(recoveryTimer);
                        recoveryTimer = null;
                    }
                    await finishAuth(result.data.session);
                }
            } catch (error) {
                console.warn("[auth callback] session restore failed:", error);
                if (mounted && !handledUserIdRef.current) {
                    setCallbackError(
                        "We couldn't finish signing you in. Check the connection and try once more."
                    );
                }
            }
        };
        void handleAuthRedirect();

        return () => {
            mounted = false;
            if (recoveryTimer) window.clearTimeout(recoveryTimer);
        };
    }, [adoptSession, navigate]);

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
                                onClick={() => navigate(`/login?redirect=${encodeURIComponent(getRedirectPath())}`, { replace: true })}
                                className="flex-1 rounded-full bg-[#2f2f2f] px-4 py-3 text-sm font-semibold text-white hover:bg-black"
                            >
                                Try sign in again
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate("/sessions", { replace: true })}
                                className="flex-1 rounded-full bg-gray-100 px-4 py-3 text-sm font-semibold hover:bg-gray-200"
                            >
                                Continue without login
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
