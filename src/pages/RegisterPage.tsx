import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, ExternalLink } from "lucide-react";
import HeaderLite from "../components/HeaderLite";
import { attachReferralToNewUser } from "../lib/referrals";
import { OperationTimeoutError, withTimeout } from "../lib/promiseTimeout";
import { startOAuthRedirect } from "../lib/oauthRedirect";
import { captureProductEvent } from "../lib/analytics";

const AUTH_REQUEST_TIMEOUT_MS = 15_000;

function isInAppBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /FBAN|FBAV|Instagram|Line|Telegram|Twitter|Discord|TikTok|Snapchat|Pinterest/i.test(
    ua
  );
}

function getOauthRedirectUrl() {
  if (typeof window === "undefined") {
    return "https://www.mysession.club/auth/callback?redirect=%2Fsessions";
  }

  const base = window.location.origin;
  return `${base}/auth/callback?redirect=%2Fsessions`;
}

function getEmailSignupRedirectUrl() {
  if (typeof window === "undefined") {
    return "https://www.mysession.club/auth/callback?redirect=%2Fsessions";
  }

  const base = window.location.origin;
  return `${base}/auth/callback?redirect=%2Fsessions`;
}

async function createProfileOnlyIfMissing(params: {
  userId: string;
  fullName: string;
}) {
  const { userId, fullName } = params;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id || session.user.id !== userId) {
    // With email confirmation enabled, signUp returns a user before it returns
    // an authenticated session. Profile RLS must not be queried until the
    // confirmation callback has established that session.
    return;
  }

  const { data: existing, error: existingError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (existingError) {
    console.warn("[register] profile existence check failed:", existingError);
    return;
  }

  if (existing?.id) return;

  const { error: insertError } = await supabase.from("profiles").insert({
    id: userId,
    full_name: fullName,
    avatar_url: null,
    bio: "",
  });

  if (insertError) {
    console.warn("[register] profile insert failed:", insertError);
  }
}

export default function RegisterPage() {
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [formError, setFormError] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [oauthLoading, setOauthLoading] = useState<null | "google" | "discord" | "facebook">(null);

  const inApp = useMemo(() => isInAppBrowser(), []);

  const handleRegister = async () => {
    const cleanFullName = fullName.trim();
    const cleanEmail = email.trim();

    if (!cleanEmail || !password || !cleanFullName) {
      setFormError("Please fill out all fields.");
      return;
    }

    captureProductEvent("registration_started", { provider: "email" });

    try {
      setLoading(true);
      setFormError("");
      setFormMessage("");

      const emailRedirectTo = getEmailSignupRedirectUrl();

      const { data, error } = await withTimeout(
        supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            emailRedirectTo,
            data: { full_name: cleanFullName },
          },
        }),
        AUTH_REQUEST_TIMEOUT_MS,
        "Registration is taking longer than expected. Please check your inbox before trying again."
      );

      if (error) {
        setFormError(error.message);
        return;
      }

      captureProductEvent("registration_completed", {
        provider: "email",
        confirmation_required: !data.session,
      });

      if (data.user && data.session) {
        navigate("/sessions", { replace: true });
        void Promise.allSettled([
          createProfileOnlyIfMissing({
            userId: data.user.id,
            fullName: cleanFullName,
          }),
          attachReferralToNewUser(data.user.id),
        ]);
        return;
      }

      setPendingEmail(cleanEmail);
      setFormMessage(
        "Account created. Check your inbox and open the newest MySession confirmation email. You can resend it below if it does not arrive."
      );
    } catch (error: any) {
      setFormError(
        error instanceof OperationTimeoutError
          ? error.message
          : error?.message || "Failed to create account."
      );
    } finally {
      setLoading(false);
    }
  };

  const resendConfirmation = async () => {
    const cleanEmail = pendingEmail.trim().toLowerCase();
    if (!cleanEmail) return;

    try {
      setResending(true);
      setFormError("");
      setFormMessage("");
      const { error } = await withTimeout(
        supabase.auth.resend({
          type: "signup",
          email: cleanEmail,
          options: { emailRedirectTo: getEmailSignupRedirectUrl() },
        }),
        AUTH_REQUEST_TIMEOUT_MS,
        "Sending the confirmation email is taking too long. Please try again."
      );
      if (error) throw error;
      setFormMessage(
        "Confirmation email sent again. Please use the newest link in your inbox."
      );
    } catch (error: any) {
      setFormError(
        error?.message || "Could not resend the confirmation email."
      );
    } finally {
      setResending(false);
    }
  };

  const signupWithGoogle = async () => {
    try {
      setOauthLoading("google");

      const redirectTo = getOauthRedirectUrl();

      captureProductEvent("registration_started", { provider: "google" });

      await startOAuthRedirect({
        provider: "google",
        redirectTo,
      });
    } catch (error: any) {
      console.log("[auth] google oauth unexpected error:", error);
      alert(error?.message || "Failed to start Google signup. Please try again.");
    } finally {
      setOauthLoading(null);
    }
  };

  const signupWithDiscord = async () => {
    try {
      setOauthLoading("discord");

      const redirectTo = getOauthRedirectUrl();

      captureProductEvent("registration_started", { provider: "discord" });

      await startOAuthRedirect({
        provider: "discord",
        redirectTo,
        scopes: "identify email",
      });
    } catch (error: any) {
      console.log("[auth] discord oauth unexpected error:", error);
      alert(error?.message || "Failed to start Discord signup. Please try again.");
    } finally {
      setOauthLoading(null);
    }
  };

  const signupWithFacebook = async () => {
    try {
      setOauthLoading("facebook");

      const redirectTo = getOauthRedirectUrl();

      captureProductEvent("registration_started", { provider: "facebook" });

      await startOAuthRedirect({
        provider: "facebook",
        redirectTo,
      });
    } catch (error: any) {
      console.log("[auth] facebook oauth unexpected error:", error);
      alert(error?.message || "Failed to start Facebook signup. Please try again.");
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
          <h2 className="mb-6 text-center text-[32px] font-bold">
            Create an Account
          </h2>

          {inApp && (
            <div className="mb-6 rounded-[16px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="mb-1 font-semibold">Social login can be blocked here</div>
              <div className="opacity-90">
                You’re likely in an in-app browser (Discord/Telegram/etc). Open this
                page in Chrome/Safari to continue.
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

          <label className="mb-1 block text-sm">Name</label>
          <input
            type="text"
            placeholder="Enter your name"
            className="mb-4 w-full rounded-[16px] border border-gray-300 bg-white px-4 py-3 outline-none focus:ring-2 focus:ring-[#2F2F2F]"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && email && password) handleRegister();
            }}
          />

          <label className="mb-1 block text-sm">Email address</label>
          <input
            type="email"
            placeholder="Enter your email"
            className="mb-4 w-full rounded-[16px] border border-gray-300 bg-white px-4 py-3 outline-none focus:ring-2 focus:ring-[#2F2F2F]"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && password && fullName) handleRegister();
            }}
          />

          <label className="mb-1 block text-sm">Your password</label>
          <div className="relative mb-6">
            <input
              type={showPass ? "text" : "password"}
              placeholder="Enter your password here"
              className="w-full rounded-[16px] border border-gray-300 bg-white px-4 py-3 outline-none focus:ring-2 focus:ring-[#2F2F2F]"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRegister();
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

          <button
            onClick={handleRegister}
            disabled={loading}
            className="mb-6 w-full rounded-[16px] bg-[#2F2F2F] py-3 text-[18px] font-semibold text-white transition hover:bg-[#1F1F1F] disabled:opacity-60"
          >
            {loading ? "Creating…" : "Sign Up"}
          </button>

          {formError ? (
            <div className="mb-4 rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700">
              {formError}
            </div>
          ) : null}

          {formMessage ? (
            <div className="mb-4 rounded-[16px] border border-green-200 bg-green-50 px-4 py-3 text-sm leading-5 text-green-800">
              {formMessage}
            </div>
          ) : null}

          {pendingEmail ? (
            <button
              type="button"
              onClick={() => void resendConfirmation()}
              disabled={resending}
              className="mb-6 w-full rounded-[16px] border border-gray-300 bg-white py-3 text-[15px] font-semibold transition hover:bg-gray-50 disabled:opacity-60"
            >
              {resending ? "Sending…" : "Resend confirmation email"}
            </button>
          ) : null}

          <button
            onClick={signupWithGoogle}
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
            onClick={signupWithDiscord}
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
            onClick={signupWithFacebook}
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
            Already have an account?{" "}
            <span
              className="cursor-pointer text-blue-600 hover:underline"
              onClick={() => navigate("/login")}
            >
              Login
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
