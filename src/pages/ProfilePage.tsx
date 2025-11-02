import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function ProfilePage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        navigate("/login");
        return;
      }
      setUser(data.user);

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", data.user.id)
        .single();

      if (profile) {
        setFullName(profile.full_name || "");
        setBio(profile.bio || "");
      }
      setLoading(false);
    }

    loadProfile();
  }, [navigate]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);

    const updates = {
      id: user.id,
      full_name: fullName,
      bio,
      updated_at: new Date(),
    };

    const { error } = await supabase
      .from("profiles")
      .upsert(updates, { onConflict: "id" });

    setSaving(false);
    if (error) alert(error.message);
    else alert("Profile updated!");
  };

  if (loading)
    return (
      <div className="flex items-center justify-center h-screen text-white bg-slate-900">
        <p>Loading...</p>
      </div>
    );

  return (
    <div className="min-h-screen bg-slate-900 text-white flex justify-center py-20">
      <div className="bg-slate-800 rounded-2xl p-10 shadow-lg w-[480px] text-center space-y-6">
        <h1 className="text-3xl font-bold mb-2">Your Profile</h1>
        <p className="text-slate-400">{user.email}</p>

        <div className="space-y-4 text-left mt-6">
          <label className="block text-sm text-slate-300">Full name</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-slate-700 text-white border border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <label className="block text-sm text-slate-300 mt-3">Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-md bg-slate-700 text-white border border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-4 bg-blue-600 px-6 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>

        <div className="flex justify-between mt-8">
          <button
            onClick={() => navigate("/sessions")}
            className="text-slate-400 hover:text-white underline"
          >
            ← Back to Sessions
          </button>

          <button
            onClick={async () => {
              await supabase.auth.signOut();
              navigate("/login");
            }}
            className="text-red-400 hover:text-red-500"
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
