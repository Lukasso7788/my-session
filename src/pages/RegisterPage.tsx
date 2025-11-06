import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

export default function RegisterPage() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        options: {
          data: { full_name: fullName }
        }
      });

      if (error) throw error;

      const user = data.user;

      if (user) {
        await supabase.from("profiles").insert([
          {
            id: user.id,
            full_name: fullName,
            avatar_url: null,
            bio: ""
          }
        ]);
      }

      alert("Account created!");
      navigate("/login");
    } catch (err: any) {
      alert(err.message);
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex justify-center items-center px-4">
      <div className="bg-slate-800 rounded-2xl p-10 w-full max-w-md shadow-xl space-y-6">

        <h1 className="text-2xl font-bold text-center">Create an Account</h1>

        <input
          type="text"
          placeholder="Full name"
          className="w-full px-3 py-2 rounded bg-slate-700 border border-slate-600"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />

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
          onClick={handleRegister}
          disabled={loading}
          className="w-full bg-blue-600 py-2 rounded-lg hover:bg-blue-700"
        >
          {loading ? "Creating..." : "Sign Up"}
        </button>

        <p
          className="text-sm text-blue-300 text-center cursor-pointer hover:underline"
          onClick={() => navigate("/login")}
        >
          Already have an account? Log in
        </p>
      </div>
    </div>
  );
}
