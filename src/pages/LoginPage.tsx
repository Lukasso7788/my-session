import { supabase } from "../lib/supabase";

export default function LoginPage() {
  const handleLogin = async (provider: "google" | "facebook") => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/sessions`, // ✅ сразу вернёт на sessions
      },
    });
    if (error) alert(error.message);
  };

  return (
    <div className="flex h-screen items-center justify-center bg-slate-900 text-white">
      <div className="bg-slate-800 rounded-2xl p-10 shadow-lg w-[400px] text-center space-y-6">
        <h1 className="text-3xl font-bold">Welcome to MySession</h1>
        <p className="text-slate-400">Sign in to continue</p>

        <div className="space-y-3">
          <button
            onClick={() => handleLogin("google")}
            className="w-full bg-white text-slate-800 py-3 rounded-lg font-medium hover:bg-slate-100"
          >
            Continue with Google
          </button>

          <button
            onClick={() => handleLogin("facebook")}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700"
          >
            Continue with Facebook
          </button>
        </div>
      </div>
    </div>
  );
}
