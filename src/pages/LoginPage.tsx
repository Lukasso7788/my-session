// src/pages/LoginPage.tsx
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

export default function LoginPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // ---------------- EMAIL / PASSWORD LOGIN ----------------
  const handleLogin = async () => {
    console.log("[DEBUG Login] Email login started", { email });

    if (!email || !password) {
      alert("Please enter email and password");
      return;
    }

    try {
      setLoading(true);

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      console.log("[DEBUG Login] signInWithPassword response:", { data, error });

      if (error) {
        console.error("[DEBUG Login] Login error:", error);
        alert(error.message);
        return;
      }

      // Проверяем, попала ли сессия в storage
      const rawStorage = localStorage.getItem("mysession-auth");
      console.log("[DEBUG Login] LocalStorage after login:", rawStorage);

      const { data: sessionData } = await supabase.auth.getSession();
      console.log("[DEBUG Login] getSession() after email login:", sessionData);

      navigate("/sessions");
    } catch (err) {
      console.error("[DEBUG Login] Unexpected login exception:", err);
    } finally {
      setLoading(false);
    }
  };

  // ---------------- OAUTH PROVIDERS ----------------
  const loginWithGoogle = async () => {
    console.log("[DEBUG Login] Google OAuth started");

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  const loginWithFacebook = async () => {
    console.log("[DEBUG Login] Facebook OAuth started");

    await supabase.auth.signInWithOAuth({
      provider: "facebook",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex justify-center items-center px-4">
      <div className="bg-slate-800 rounded-2xl p-10 w-full max-w-md shadow-xl space-y-6">

        <h1 className="text-2xl font-bold text-center">Log In</h1>

        {/* Email */}
        <input
          type="email"
          placeholder="Email"
          className="w-full px-3 py-2 rounded bg-slate-700 border border-slate-600"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        {/* Password */}
        <input
          type="password"
          placeholder="Password"
          className="w-full px-3 py-2 rounded bg-slate-700 border border-slate-600"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {/* Email Login Button */}
        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full bg-blue-600 py-2 rounded-lg hover:bg-blue-700"
        >
          {loading ? "Loading..." : "Login"}
        </button>

        <div className="h-px bg-slate-600 my-4"></div>

        {/* Google */}
        <button
          onClick={loginWithGoogle}
          className="w-full bg-white text-black py-2 rounded-lg hover:bg-gray-200"
        >
          Continue with Google
        </button>

        {/* Facebook */}
        <button
          onClick={loginWithFacebook}
          className="w-full bg-blue-700 text-white py-2 rounded-lg hover:bg-blue-800"
        >
          Continue with Facebook
        </button>

        <p
          className="text-sm text-blue-300 text-center cursor-pointer hover:underline"
          onClick={() => navigate("/register")}
        >
          Don't have an account? Register
        </p>
      </div>
    </div>
  );
}
