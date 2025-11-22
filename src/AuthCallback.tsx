// src/pages/AuthCallback.tsx
import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

export default function AuthCallback() {
    const navigate = useNavigate();

    useEffect(() => {
        console.log("[OAuth Callback] Page loaded, checking session…");

        supabase.auth
            .getSession()
            .then(({ data }) => {
                console.log("[OAuth Callback] Session:", data);
                navigate("/sessions");
            })
            .catch((err) => {
                console.error("[OAuth Callback] Error:", err);
                navigate("/login");
            });
    }, []);

    return (
        <div className="flex items-center justify-center min-h-screen text-xl">
            Completing login…
        </div>
    );
}
