import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AuthCallback() {
    const navigate = useNavigate();
    console.log("AuthCallback mounted", window.location.href);
    useEffect(() => {
        async function finishLogin() {
            console.log("[AuthCallback] Starting...");

            const hash = window.location.hash.substring(1);
            const params = new URLSearchParams(hash);

            const access_token = params.get("access_token");
            const refresh_token = params.get("refresh_token");

            console.log("[AuthCallback] Tokens from URL:", {
                access_token,
                refresh_token,
            });

            if (access_token && refresh_token) {
                const { data, error } = await supabase.auth.setSession({
                    access_token,
                    refresh_token,
                });

                console.log("[AuthCallback] setSession() result:", { data, error });
            } else {
                console.warn("[AuthCallback] Missing tokens in URL!");
            }

            navigate("/sessions");
        }

        finishLogin();
    }, []);

    return <div>Processing login…</div>;
}
