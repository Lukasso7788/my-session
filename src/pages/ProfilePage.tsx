import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Header from "../components/Header";
import { useAuth } from "../context/AuthContext";

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, profile, loading, reloadProfile } = useAuth();

  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Redirect if not logged in
  useEffect(() => {
    if (!loading && !user) navigate("/login", { replace: true });
  }, [loading, user, navigate]);

  // Load profile data
  useEffect(() => {
    if (!user) return;

    if (profile) {
      setFullName(profile.full_name || "");
      setAvatarUrl(profile.avatar_url || null);
    }

    const loadBio = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, bio, avatar_url")
        .eq("id", user.id)
        .single();

      if (!error && data) {
        setFullName(data.full_name || "");
        setBio(data.bio || "");
        setAvatarUrl(data.avatar_url || null);
      }
    };

    loadBio();
  }, [user, profile]);

  // Avatar upload
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0];
      if (!file || !user) return;

      setUploading(true);

      const ext = file.name.split(".").pop();
      const filePath = `${user.id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("avatars").getPublicUrl(filePath);
      const publicUrl = data.publicUrl;

      await Promise.all([
        supabase.auth.updateUser({ data: { avatar_url: publicUrl } }),
        supabase
          .from("profiles")
          .update({
            avatar_url: publicUrl,
            updated_at: new Date().toISOString(),
          })
          .eq("id", user.id),
      ]);

      setAvatarUrl(publicUrl);
      await reloadProfile();
    } catch (err: any) {
      console.error("Avatar upload error:", err);
      alert("Error uploading avatar. Check console.");
    } finally {
      setUploading(false);
    }
  };

  // Save profile
  const handleSave = async () => {
    if (!user) return;
    setSaving(true);

    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: fullName,
          bio,
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (error) throw error;

      await supabase.auth.updateUser({
        data: { full_name: fullName, avatar_url: avatarUrl },
      });

      setEditMode(false);
      await reloadProfile();
    } catch (err) {
      console.error("Save profile error:", err);
      alert("Failed to save profile.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <>
        <Header />
        <div className="flex justify-center pt-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black" />
        </div>
      </>
    );
  }

  if (!user) return null;

  const displayName = fullName || profile?.full_name || "New user";

  return (
    <>
      <Header />

      {/* MAIN PAGE WRAPPER — consistent with other pages */}
      <main className="w-full max-w-4xl mx-auto px-6 py-12 font-inter text-gray-900">

        {/* Back button */}
        <button
          onClick={() => navigate(-1)}
          className="text-sm flex items-center gap-2 text-gray-500 hover:text-black mb-6 transition"
        >
          ← Back
        </button>

        {/* Avatar */}
        <div className="flex flex-col items-center gap-4">
          <div className="relative group">
            <img
              src={
                avatarUrl ||
                `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}`
              }
              className={`w-32 h-32 rounded-full object-cover border border-gray-200 shadow-sm ${uploading ? "opacity-50" : ""
                }`}
            />

            {uploading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="animate-spin h-8 w-8 border-b-2 border-black rounded-full"></div>
              </div>
            )}
          </div>

          {editMode && (
            <label className="text-sm text-blue-600 cursor-pointer hover:underline font-medium">
              {uploading ? "Uploading..." : "Change avatar"}
              <input
                type="file"
                className="hidden"
                accept="image/*"
                onChange={handleAvatarUpload}
              />
            </label>
          )}
        </div>

        {/* Name */}
        {editMode ? (
          <div className="mt-6 flex justify-center">
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="text-3xl font-bold text-center border-b-2 border-gray-200 focus:border-black outline-none pb-2 w-full max-w-md transition"
              placeholder="Your Name"
            />
          </div>
        ) : (
          <h1 className="text-3xl font-bold text-center mt-6 font-inter">
            {displayName}
          </h1>
        )}

        {/* Edit button */}
        <div className="flex justify-center mt-6">
          <button
            onClick={() => setEditMode(!editMode)}
            className="px-5 py-2.5 border border-gray-300 rounded-full hover:bg-gray-50 transition text-sm font-medium"
          >
            {editMode ? "Cancel Editing" : "Edit Profile"}
          </button>
        </div>

        {/* About */}
        <section className="mt-12 border-t border-gray-100 pt-8 max-w-2xl mx-auto">
          <h2 className="text-lg font-semibold mb-3">About</h2>

          {editMode ? (
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full border border-gray-300 p-4 rounded-xl focus:ring-2 focus:ring-black outline-none transition"
              rows={5}
              placeholder="Tell us about yourself..."
            />
          ) : (
            <p className="text-gray-600 whitespace-pre-wrap leading-relaxed">
              {bio || (
                <span className="text-gray-400 italic">No bio added yet.</span>
              )}
            </p>
          )}
        </section>

        {/* Save */}
        {editMode && (
          <div className="mt-8 flex justify-center">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-8 py-3 bg-black text-white rounded-full hover:bg-gray-800 disabled:opacity-50 transition font-medium shadow-md"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        )}

        {/* Session history */}
        <section className="mt-16 pt-8 border-t border-gray-100">
          <h2 className="text-xl font-bold mb-6">Hosted Sessions History</h2>

          <div className="bg-gray-50 rounded-xl p-8 text-center border border-gray-100 border-dashed">
            <p className="text-gray-500 text-sm">
              No sessions history available yet.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}
