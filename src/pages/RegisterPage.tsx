import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import HeaderLite from "../components/HeaderLite";

export default function RegisterPage() {
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

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
        await supabase.from("profiles").insert([
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
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/sessions" },
    });
  };

  const signupWithFacebook = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "facebook",
      options: { redirectTo: window.location.origin + "/sessions" },
    });
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 flex flex-col font-inter">

      <HeaderLite />

      <div className="flex flex-col items-center w-full pt-16 px-4">

        <div className="w-full max-w-md mx-auto">

          <h2 className="text-center text-2xl font-semibold mb-8">
            Create an Account
          </h2>

          {/* Name */}
          <label className="block text-sm mb-1">Name</label>
          <input
            type="text"
            placeholder="Enter your name"
            className="w-full border border-gray-300 rounded-xl px-4 py-3 mb-4 bg-white focus:ring-2 focus:ring-black outline-none"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />

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

          {/* MAIN SIGN UP BUTTON */}
          <button
            onClick={handleRegister}
            disabled={loading}
            className="w-full bg-black text-white py-3 rounded-[16px] text-[18px] font-semibold hover:bg-gray-800 transition mb-6"
          >
            {loading ? "Creating…" : "Sign Up"}
          </button>

          {/* Google */}
          <button
            onClick={signupWithGoogle}
            className="w-full py-3 border border-gray-300 rounded-[16px] text-[18px] font-semibold flex items-center justify-center gap-3 mb-3 hover:bg-gray-50 transition"
          >
            <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-5" />
            Continue with Google
          </button>

          {/* Facebook */}
          <button
            onClick={signupWithFacebook}
            className="w-full py-3 rounded-[16px] text-[18px] font-semibold flex items-center justify-center gap-3 mb-3 bg-[#1877F2] text-white hover:bg-[#0f66d3] transition"
          >
            <img src="https://www.svgrepo.com/show/475647/facebook-color.svg" className="w-5" />
            Continue with Facebook
          </button>

          {/* Apple */}
          <button
            className="w-full py-3 rounded-[16px] text-[18px] font-semibold flex items-center justify-center gap-3 bg-black text-white hover:bg-gray-900 transition"
          >
            <img src="https://www.svgrepo.com/show/303128/apple-logo.svg" className="w-5 invert" />
            Continue with Apple
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
