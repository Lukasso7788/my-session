// src/pages/RegisterPage.tsx

import { useMemo, useState } from "react";
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

export default function RegisterPage() {
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const [oauthLoading, setOauthLoading] = useState<null | "google" | "facebook">(null);

  const inApp = useMemo(() => isInAppBrowser(), []);

  const handleRegister = async () => {
    if (!email || !password || !fullName) {
      alert("Please fill out all fields");
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });

      if (error) throw error;

      if (data.user) {
        // best-effort profile row
        await supabase.from("profiles").upsert([
          {
            id: data.user.id,
            full_name: fullName,
            avatar_url: null,
            bio: "",
          },
        ]);
      }

      navigate("/login");
    } catch (error: any) {
      alert(error.message);
    }

    setLoading(false);
  };

  const signupWithGoogle = async () => {
    try {
      setOauthLoading("google");

      const redirectTo = `${window.location.origin}/auth/callback/`;

      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
        },
      });

      if (error) {
        console.log("[auth] google oauth error:", error);
        alert(error.message);
        return;
      }

      if (data?.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      } else {
        alert("Failed to start Google signup. Please try again.");
      }
    } finally {
      setOauthLoading(null);
    }
  };

  const signupWithFacebook = async () => {
    try {
      setOauthLoading("facebook");

      const redirectTo = `${window.location.origin}/auth/callback/`;

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "facebook",
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        console.log("[auth] facebook oauth error:", error);
        alert(error.message);
        return;
      }

      if (data?.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      } else {
        alert("Failed to start Facebook signup. Please try again.");
      }
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
          <h2 className="text-center text-[32px] font-bold mb-6">
            Create an Account
          </h2>

          {/* In-app browser warning */}
          {inApp && (
            <div className="mb-6 rounded-[16px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="font-semibold mb-1">Google signup can be blocked here</div>
              <div className="opacity-90">
                You’re likely in an in-app browser (Discord/Telegram/etc). Open this page in Chrome/Safari to continue.
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

          {/* Name */}
          <label className="block text-sm mb-1">Name</label>
          <input
            type="text"
            placeholder="Enter your name"
            className="w-full border border-gray-300 rounded-[16px] px-4 py-3 mb-4 bg-white focus:ring-2 focus:ring-[#2F2F2F] outline-none"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />

          {/* Email */}
          <label className="block text-sm mb-1">Email address</label>
          <input
            type="email"
            placeholder="Enter your email"
            className="w-full border border-gray-300 rounded-[16px] px-4 py-3 mb-4 bg-white focus:ring-2 focus:ring-[#2F2F2F] outline-none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          {/* Password */}
          <label className="block text-sm mb-1">Your password</label>
          <div className="relative mb-6">
            <input
              type={showPass ? "text" : "password"}
              placeholder="Enter your password here"
              className="w-full border border-gray-300 rounded-[16px] px-4 py-3 bg-white focus:ring-2 focus:ring-[#2F2F2F] outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
              onClick={() => setShowPass(!showPass)}
            >
              {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {/* Sign Up button */}
          <button
            onClick={handleRegister}
            disabled={loading}
            className="w-full bg-[#2F2F2F] text-white py-3 rounded-[16px] text-[18px] font-semibold hover:bg-[#1F1F1F] transition mb-6 disabled:opacity-60"
          >
            {loading ? "Creating…" : "Sign Up"}
          </button>

          {/* Google */}
          <button
            onClick={signupWithGoogle}
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

          {/* Facebook */}
          <button
            onClick={signupWithFacebook}
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
            Already have an account?{" "}
            <span
              className="text-blue-600 cursor-pointer hover:underline"
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
