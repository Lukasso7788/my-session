import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function ProfilePage() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });
  }, []);

  if (!user)
    return (
      <div className="flex items-center justify-center h-screen text-white bg-slate-900">
        <p>Loading...</p>
      </div>
    );

  return (
    <div className="min-h-screen bg-slate-900 text-white flex justify-center py-20">
      <div className="bg-slate-800 rounded-2xl p-10 shadow-lg w-[500px] text-center space-y-6">
        <h1 className="text-3xl font-bold mb-2">Your Profile</h1>
        <p className="text-slate-300">{user.email}</p>

        <button
          onClick={() => supabase.auth.signOut()}
          className="mt-4 bg-red-600 px-6 py-2 rounded-lg font-medium hover:bg-red-700"
        >
          Log out
        </button>
      </div>
    </div>
  );
}
