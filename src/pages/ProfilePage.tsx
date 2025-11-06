import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function ProfilePage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
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
        setAvatarUrl(profile.avatar_url || null);
      }
      setLoading(false);
    }

    loadProfile();
  }, [navigate]);

  // ✅ Загрузка аватара в storage/avatars (bucket уже должен существовать)
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      setUploading(true);
      const file = e.target.files?.[0];
      if (!file || !user) return;

      const ext = file.name.split(".").pop();
      const filePath = `${user.id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath);

      const publicUrl = data.publicUrl;

      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          avatar_url: publicUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (updateError) throw updateError;

      setAvatarUrl(publicUrl);
      alert("✅ Avatar updated!");
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Avatar upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);

    try {
      const { error: authErr } = await supabase.auth.updateUser({
        data: { full_name: fullName, bio, avatar_url: avatarUrl },
      });
      if (authErr) throw authErr;

      const { error: profileErr } = await supabase
        .from("profiles")
        .upsert(
          {
            id: user.id,
            full_name: fullName,
            bio,
            avatar_url: avatarUrl,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        );

      if (profileErr) throw profileErr;

      alert("✅ Profile updated!");
    } catch (err: any) {
      alert(err.message || "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center h-screen text-white bg-slate-900">
        <p>Loading...</p>
      </div>
    );

  return (
    <div className="min-h-screen bg-slate-900 text-white flex justify-center py-20 px-4">
      <div className="bg-slate-800 rounded-2xl p-10 shadow-lg w-[480px] text-center space-y-6">
        <h1 className="text-3xl font-bold mb-2">Your Profile</h1>
        <p className="text-slate-400">{user.email}</p>

        {/* ==== Avatar Upload ==== */}
        <div className="flex flex-col items-center mt-4 space-y-3">
          <img
            src={
              avatarUrl ||
              `https://ui-avatars.com/api/?name=${encodeURIComponent(
                fullName || "User"
              )}`
            }
            alt="avatar"
            className="w-28 h-28 rounded-full border border-slate-600 object-cover"
          />
          <label className="text-sm text-blue-400 hover:text-blue-300 cursor-pointer">
            {uploading ? "Uploading..." : "Change Avatar"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
              disabled={uploading}
            />
          </label>
        </div>

        {/* ==== Profile Form ==== */}
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

        {/* ==== Navigation Buttons ==== */}
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
