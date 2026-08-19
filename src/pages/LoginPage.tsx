import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, ExternalLink } from "lucide-react";
import HeaderLite from "../components/HeaderLite";
import { startOAuthRedirect } from "../lib/oauthRedirect";
import { withTimeout } from "../lib/promiseTimeout";
import { useAuth } from "../context/AuthContext";

function isInAppBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /FBAN|FBAV|Instagram|Line|Telegram|Twitter|Discord|TikTok|Snapchat|Pinterest/i.test(
    ua
  );
}

function getPasswordResetRedirectUrl() {
  if (typeof window === "undefined") return "";

  return `${window.location.origin}/update-password`;
}

function getOauthRedirectUrl(redirectPath?: string) {
  const safeRedirect =
    redirectPath && redirectPath.startsWith("/") && !redirectPath.startsWith("//")
      ? redirectPath
      : "/sessions";

  if (typeof window === "undefined") {
    return `https://www.mysession.club/auth/callback?redirect=${encodeURIComponent(
      safeRedirect
    )}`;
  }

  const base = window.location.origin;
  return `${base}/auth/callback?redirect=${encodeURIComponent(safeRedirect)}`;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState("");
  const [oauthLoading, setOauthLoading] = useState<null | "google" | "discord" | "facebook">(null);

  const inApp = useMemo(() => isInAppBrowser(), []);

  const redirectAfterLogin = useMemo(() => {
    const raw = String(
      searchParams.get("redirect") || searchParams.get("next") || ""
    ).trim();

    if (!raw) return "/sessions";
    if (!raw.startsWith("/")) return "/sessions";
    if (raw.startsWith("//")) return "/sessions";

    return raw;
  }, [searchParams]);

  useEffect(() => {
    if (!authLoading && user) {
      navigate(redirectAfterLogin, { replace: true });
    }
  }, [authLoading, navigate, redirectAfterLogin, user]);

  const handleLogin = async () => {
    const cleanEmail = email.trim();

    if (!cleanEmail || !password) {
      alert("Please enter email and password");
      return;
    }

    try {
      setLoading(true);

      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        }),
        15_000,
        "Login is taking longer than expected. Please try again."
      );

      if (error) {
        alert(error.message);
        return;
      }

      if (!data.session) {
        alert("Login succeeded, but the session was not stored. Please try again.");
        return;
      }

      navigate(redirectAfterLogin, { replace: true });
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

      const redirectTo = getPasswordResetRedirectUrl();

      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo,
      });

      if (error) {
        alert(error.message);
        return;
      }

      setResetSent(
        "Password reset email sent. Please check your inbox and use the newest email."
      );
    } catch (error: any) {
      alert(error?.message || "Failed to send password reset email");
    } finally {
      setResetLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    try {
      setOauthLoading("google");

      const redirectTo = getOauthRedirectUrl(redirectAfterLogin);

      await startOAuthRedirect({
        provider: "google",
        redirectTo,
      });
    } catch (error: any) {
      console.log("[auth] google oauth unexpected error:", error);
      alert(error?.message || "Failed to start Google login. Please try again.");
    } finally {
      setOauthLoading(null);
    }
  };

  const loginWithDiscord = async () => {
    try {
      setOauthLoading("discord");

      const redirectTo = getOauthRedirectUrl(redirectAfterLogin);

      await startOAuthRedirect({
        provider: "discord",
        redirectTo,
        scopes: "identify email",
      });
    } catch (error: any) {
      console.log("[auth] discord oauth unexpected error:", error);
      alert(error?.message || "Failed to start Discord login. Please try again.");
    } finally {
      setOauthLoading(null);
    }
  };

  const loginWithFacebook = async () => {
    try {
      setOauthLoading("facebook");

      const redirectTo = getOauthRedirectUrl(redirectAfterLogin);

      await startOAuthRedirect({
        provider: "facebook",
        redirectTo,
      });
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
    <div className="flex min-h-screen flex-col bg-white font-inter text-gray-900">
      <HeaderLite />

      <div className="flex w-full flex-col items-center px-4 pt-16">
        <div className="mx-auto w-full max-w-md">
          <h2 className="mb-6 text-center text-[32px] font-bold">Log in</h2>

          {inApp && (
            <div className="mb-6 rounded-[16px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="mb-1 font-semibold">Social login can be blocked here</div>
              <div className="opacity-90">
                You’re likely in an in-app browser (Discord/Telegram/etc). Open this
                page in Chrome/Safari to log in.
              </div>
              <button
                onClick={openInBrowserHint}
                className="mt-3 inline-flex items-center gap-2 font-semibold text-amber-900 hover:underline"
                type="button"
              >
                <ExternalLink size={16} /> Copy link / open in browser
              </button>
            </div>
          )}

          <label className="mb-1 block text-sm">Email address</label>
          <input
            type="email"
            placeholder="Enter your email"
            className="mb-4 w-full rounded-[16px] border border-gray-300 bg-white px-4 py-3 outline-none focus:ring-2 focus:ring-[#2F2F2F]"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (resetSent) setResetSent("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && password) handleLogin();
            }}
          />

          <label className="mb-1 block text-sm">Your password</label>
          <div className="relative mb-3">
            <input
              type={showPass ? "text" : "password"}
              placeholder="Enter your password here"
              className="w-full rounded-[16px] border border-gray-300 bg-white px-4 py-3 outline-none focus:ring-2 focus:ring-[#2F2F2F]"
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
            className="mb-3 w-full rounded-[16px] bg-[#2F2F2F] py-3 text-[18px] font-semibold text-white transition hover:bg-[#1F1F1F] disabled:opacity-60"
          >
            {loading ? "Loading…" : "Login"}
          </button>

          <button
            onClick={loginWithGoogle}
            disabled={oauthLoading !== null}
            className="mb-3 flex w-full items-center justify-center gap-3 rounded-[16px] border border-gray-300 py-3 text-[18px] font-semibold transition hover:bg-gray-50 disabled:opacity-60"
          >
            <img
              src="https://www.svgrepo.com/show/475656/google-color.svg"
              className="w-5"
              alt="Google icon"
            />
            {oauthLoading === "google" ? "Opening Google…" : "Continue with Google"}
          </button>

          <button
            onClick={loginWithDiscord}
            disabled={oauthLoading !== null}
            className="mb-3 flex w-full items-center justify-center gap-3 rounded-[16px] bg-[#5865F2] py-3 text-[18px] font-semibold text-white transition hover:bg-[#4752C4] disabled:opacity-60"
          >
            <span
              aria-hidden="true"
              className="flex h-5 w-5 items-center justify-center rounded-md bg-white text-[13px] font-black text-[#5865F2]"
            >
              D
            </span>
            {oauthLoading === "discord"
              ? "Opening Discord…"
              : "Continue with Discord"}
          </button>

          <button
            onClick={loginWithFacebook}
            disabled={oauthLoading !== null}
            className="mb-3 flex w-full items-center justify-center gap-3 rounded-[16px] bg-[#1877F2] py-3 text-[18px] font-semibold text-white transition hover:bg-[#0f66d3] disabled:opacity-60"
          >
            <img
              src="/icons/facebook.svg"
              className="h-5 w-5"
              alt="Facebook icon"
            />
            {oauthLoading === "facebook"
              ? "Opening Facebook…"
              : "Continue with Facebook"}
          </button>

          <p className="mt-6 text-center text-sm text-gray-700">
            You don’t have an account?{" "}
            <span
              className="cursor-pointer text-blue-600 hover:underline"
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
