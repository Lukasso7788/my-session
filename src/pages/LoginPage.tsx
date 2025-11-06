import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      alert("Please enter email and password");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    navigate("/sessions");
  };

  const loginWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/sessions" }
    });
  };

  const loginWithFacebook = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "facebook",
      options: { redirectTo: window.location.origin + "/sessions" }
    });
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex justify-center items-center px-4">
      <div className="bg-slate-800 rounded-2xl p-10 w-full max-w-md shadow-xl space-y-6">

        <h1 className="text-2xl font-bold text-center">Log In</h1>

        <input
          type="email"
          placeholder="Email"
          className="w-full px-3 py-2 rounded bg-slate-700 border border-slate-600"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          type="password"
          placeholder="Password"
          className="w-full px-3 py-2 rounded bg-slate-700 border border-slate-600"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full bg-blue-600 py-2 rounded-lg hover:bg-blue-700"
        >
          {loading ? "Loading..." : "Login"}
        </button>

        <div className="h-px bg-slate-600 my-4"></div>

        <button
          onClick={loginWithGoogle}
          className="w-full bg-white text-black py-2 rounded-lg hover:bg-gray-200"
        >
          Continue with Google
        </button>

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
