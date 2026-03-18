import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, ExternalLink } from "lucide-react";
import HeaderLite from "../components/HeaderLite";

function isInAppBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /FBAN|FBAV|Instagram|Line|Telegram|Twitter|Discord|TikTok|Snapchat|Pinterest/i.test(
    ua
  );
}

export default function LoginPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState("");
  const [oauthLoading, setOauthLoading] = useState<null | "google" | "facebook">(null);

  const inApp = useMemo(() => isInAppBrowser(), []);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (data.user) navigate("/sessions");
      } catch { }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async () => {
    if (!email || !password) {
      alert("Please enter email and password");
      return;
    }

    try {
      setLoading(true);

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        alert(error.message);
        return;
      }

      navigate("/sessions");
    } catch (error: any) {
      alert(error?.message || "Failed to log in");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const cleanEmail = email.trim();

    if (!cleanEmail) {
      alert("Enter your email first, then press Forgot Password.");
      return;
    }

    try {
      setResetLoading(true);
      setResetSent("");

      const redirectTo = `${window.location.origin}/update-password`;

      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo,
      });

      if (error) {
        alert(error.message);
        return;
      }

      setResetSent("Password reset email sent. Please check your inbox.");
    } catch (error: any) {
      alert(error?.message || "Failed to send password reset email");
    } finally {
      setResetLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    try {
      setOauthLoading("google");

      const redirectTo = `${window.location.origin}/auth/callback`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
        },
      });

      if (error) {
        console.log("[auth] google oauth error:", error);
        alert(error.message);
      }
    } catch (error: any) {
      console.log("[auth] google oauth unexpected error:", error);
      alert(error?.message || "Failed to start Google login. Please try again.");
    } finally {
      setOauthLoading(null);
    }
  };

  const loginWithFacebook = async () => {
    try {
      setOauthLoading("facebook");

      const redirectTo = `${window.location.origin}/auth/callback`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "facebook",
        options: {
          redirectTo,
        },
      });

      if (error) {
        console.log("[auth] facebook oauth error:", error);
        alert(error.message);
      }
    } catch (error: any) {
      console.log("[auth] facebook oauth unexpected error:", error);
      alert(error?.message || "Failed to start Facebook login. Please try again.");
    } finally {
      setOauthLoading(null);
    }
  };

  const openInBrowserHint = () => {
    const url = window.location.href;
    try {
      navigator.clipboard?.writeText(url);
      alert("Link copied. Open it in Chrome/Safari and try again.");
    } catch {
      alert("Open this page in Chrome/Safari and try again.");
    }
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 flex flex-col font-inter">
      <HeaderLite />

      <div className="flex flex-col items-center w-full pt-16 px-4">
        <div className="w-full max-w-md mx-auto">
          <h2 className="text-center text-[32px] font-bold mb-6">Log in</h2>

          {inApp && (
            <div className="mb-6 rounded-[16px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="font-semibold mb-1">Social login can be blocked here</div>
              <div className="opacity-90">
                You’re likely in an in-app browser (Discord/Telegram/etc). Open this page in Chrome/Safari to log in.
              </div>
              <button
                onClick={openInBrowserHint}
                className="mt-3 inline-flex items-center gap-2 text-amber-900 font-semibold hover:underline"
                type="button"
              >
                <ExternalLink size={16} /> Copy link / open in browser
              </button>
            </div>
          )}

          <label className="block text-sm mb-1">Email address</label>
          <input
            type="email"
            placeholder="Enter your email"
            className="w-full border border-gray-300 rounded-[16px] px-4 py-3 mb-4 bg-white focus:ring-2 focus:ring-[#2F2F2F] outline-none"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (resetSent) setResetSent("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && password) handleLogin();
            }}
          />

          <label className="block text-sm mb-1">Your password</label>
          <div className="relative mb-3">
            <input
              type={showPass ? "text" : "password"}
              placeholder="Enter your password here"
              className="w-full border border-gray-300 rounded-[16px] px-4 py-3 bg-white focus:ring-2 focus:ring-[#2F2F2F] outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLogin();
              }}
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
              onClick={() => setShowPass(!showPass)}
            >
              {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <div className="mb-6 flex items-center justify-center">
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={resetLoading}
              className="text-center text-sm text-gray-500 hover:text-gray-700 hover:underline disabled:opacity-60"
            >
              {resetLoading ? "Sending reset email…" : "Forgot Password?"}
            </button>
          </div>

          {resetSent && (
            <div className="mb-4 rounded-[16px] border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              {resetSent}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-[#2F2F2F] text-white py-3 rounded-[16px] text-[18px] font-semibold hover:bg-[#1F1F1F] transition mb-3 disabled:opacity-60"
          >
            {loading ? "Loading…" : "Login"}
          </button>

          <button
            onClick={loginWithGoogle}
            disabled={oauthLoading !== null}
            className="w-full py-3 border border-gray-300 rounded-[16px] flex items-center justify-center gap-3 mb-3 hover:bg-gray-50 transition text-[18px] font-semibold disabled:opacity-60"
          >
            <img
              src="https://www.svgrepo.com/show/475656/google-color.svg"
              className="w-5"
              alt="Google icon"
            />
            {oauthLoading === "google" ? "Opening Google…" : "Continue with Google"}
          </button>

          <button
            onClick={loginWithFacebook}
            disabled={oauthLoading !== null}
            className="w-full py-3 rounded-[16px] flex items-center justify-center gap-3 mb-3 bg-[#1877F2] text-white hover:bg-[#0f66d3] transition text-[18px] font-semibold disabled:opacity-60"
          >
            <img
              src="/icons/facebook.svg"
              className="w-5 h-5"
              alt="Facebook icon"
            />
            {oauthLoading === "facebook" ? "Opening Facebook…" : "Continue with Facebook"}
          </button>

          <p className="text-center text-sm text-gray-700 mt-6">
            You don’t have an account?{" "}
            <span
              className="text-blue-600 cursor-pointer hover:underline"
              onClick={() => navigate("/register")}
            >
              Sign up
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}