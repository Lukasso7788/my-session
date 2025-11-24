import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AuthCallback() {
    const navigate = useNavigate();

    useEffect(() => {
        async function finishLogin() {
            console.log("[AuthCallback] Running finishLogin()");

            const { data, error } = await supabase.auth.getSession();

            console.log("[AuthCallback] Session:", data?.session);
            console.log("[AuthCallback] Error:", error);

            navigate("/sessions");
        }
        finishLogin();
    }, []);

    return <div>Processing login...</div>;
}
