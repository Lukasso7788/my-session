import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import HeaderLite from "../components/HeaderLite";

export default function LoginPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
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

      if (error) {
        alert(error.message);
        return;
      }

      navigate("/sessions");
    } finally {
      setLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    const redirect = `${window.location.origin}/auth/callback/`;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirect },
    });
  };

  const loginWithFacebook = async () => {
    const redirect = `${window.location.origin}/auth/callback/`;
    await supabase.auth.signInWithOAuth({
      provider: "facebook",
      options: { redirectTo: redirect },
    });
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 flex flex-col font-inter">

      <HeaderLite />

      <div className="flex flex-col items-center w-full pt-16 px-4">

        <div className="w-full max-w-md mx-auto">

          <h2 className="text-center text-2xl font-semibold mb-8">Log in</h2>

          {/* Email */}
          <label className="block text-sm mb-1">Email address</label>
          <input
            type="email"
            placeholder="Enter your email"
            className="w-full border border-gray-300 rounded-xl px-4 py-3 mb-4 bg-white focus:ring-2 focus:ring-black outline-none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          {/* Password */}
          <label className="block text-sm mb-1">Your password</label>
          <div className="relative mb-6">
            <input
              type={showPass ? "text" : "password"}
              placeholder="Enter your password here"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 bg-white focus:ring-2 focus:ring-black outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
              onClick={() => setShowPass(!showPass)}
            >
              {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-black text-white py-3 rounded-full font-medium hover:bg-gray-800 transition mb-3"
          >
            {loading ? "Loading…" : "Login"}
          </button>

          <p className="text-center text-sm text-gray-500 mb-8 cursor-pointer">
            Forgot Password?
          </p>

          {/* Google */}
          <button
            onClick={loginWithGoogle}
            className="w-full py-3 border border-gray-300 rounded-full flex items-center justify-center gap-3 mb-3 hover:bg-gray-50 transition"
          >
            <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-5" />
            Continue with Google
          </button>

          {/* Facebook */}
          <button
            onClick={loginWithFacebook}
            className="w-full py-3 rounded-full flex items-center justify-center gap-3 mb-3 bg-[#1877F2] text-white hover:bg-[#0f66d3] transition"
          >
            <img src="https://www.svgrepo.com/show/475647/facebook-color.svg" className="w-5" />
            Continue with Facebook
          </button>

          {/* Apple */}
          <button
            className="w-full py-3 rounded-full flex items-center justify-center gap-3 bg-black text-white hover:bg-gray-900 transition"
          >
            <img src="https://www.svgrepo.com/show/303128/apple-logo.svg" className="w-5 invert" />
            Continue with Apple
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
