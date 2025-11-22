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

  useEffect(() => {
    if (!loading && !user) {
      navigate("/login", { replace: true });
    }
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return;

    const loadProfileData = async () => {
      const { data: prof, error } = await supabase
        .from("profiles")
        .select("full_name,bio,avatar_url")
        .eq("id", user.id)
        .single();

      if (error) {
        console.error("Error loading profile:", error);
        return;
      }

      setFullName(prof.full_name || "");
      setBio(prof.bio || "");
      setAvatarUrl(prof.avatar_url || null);
    };

    loadProfileData();
  }, [user]);

  const handleAvatarUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
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

      const { error: updateUserError } = await supabase.auth.updateUser({
        data: { avatar_url: publicUrl },
      });
      if (updateUserError) {
        console.error("updateUser metadata error:", updateUserError);
      }

      const { error: updateProfileError } = await supabase
        .from("profiles")
        .update({
          avatar_url: publicUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (updateProfileError) {
        console.error("update profile error:", updateProfileError);
      }

      setAvatarUrl(publicUrl);
      await reloadProfile();
    } catch (err) {
      console.error("avatar upload error:", err);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;

    setSaving(true);

    try {
      const { error: updateProfileError } = await supabase
        .from("profiles")
        .update({
          full_name: fullName,
          bio,
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (updateProfileError) {
        console.error("update profile error:", updateProfileError);
      }

      const { error: updateUserError } = await supabase.auth.updateUser({
        data: { full_name: fullName, avatar_url: avatarUrl },
      });

      if (updateUserError) {
        console.error("updateUser metadata error:", updateUserError);
      }

      setEditMode(false);
      await reloadProfile();
    } catch (err) {
      console.error("save profile error:", err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <>
        <Header />
        <div className="p-10">Loading profile...</div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <Header />
        <div className="p-10">Redirecting to login...</div>
      </>
    );
  }

  const displayName = fullName || profile?.full_name || "New user";

  return (
    <>
      <Header />

      <div className="w-full max-w-4xl mx-auto px-6 py-12">
        <button
          onClick={() => navigate(-1)}
          className="text-sm flex items-center gap-2 text-gray-500 hover:text-black mb-6"
        >
          ← Back
        </button>

        <div className="flex flex-col items-center gap-4">
          <img
            src={
              avatarUrl ||
              `https://ui-avatars.com/api/?name=${encodeURIComponent(
                displayName || "User"
              )}`
            }
            className="w-28 h-28 rounded-full object-cover border border-gray-200"
          />

          {editMode && (
            <label className="text-sm text-blue-600 cursor-pointer">
              {uploading ? "Uploading..." : "Change avatar"}
              <input
                type="file"
                className="hidden"
                onChange={handleAvatarUpload}
                disabled={uploading}
              />
            </label>
          )}
        </div>

        <h1 className="text-3xl font-semibold text-center mt-4">
          {displayName}
        </h1>

        <p className="text-center text-gray-500 mt-2">
          Since 12.11.2025 • 120 sessions
        </p>

        <div className="flex justify-center mt-4">
          <button
            onClick={() => setEditMode(!editMode)}
            className="px-4 py-2 border rounded-lg hover:bg-gray-100 transition"
          >
            {editMode ? "Cancel" : "Edit profile"}
          </button>
        </div>

        <div className="mt-10 border-t pt-8">
          <h2 className="text-lg font-semibold mb-2">Bio</h2>

          {editMode ? (
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full border p-3 rounded-lg"
              rows={3}
            />
          ) : (
            <p className="text-gray-700">{bio || "No bio yet."}</p>
          )}
        </div>

        {editMode && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-6 px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        )}

        <div className="mt-12">
          <h2 className="text-xl font-semibold mb-4">
            Current hosted & upcoming sessions:
          </h2>

          <div className="text-gray-600">TODO: sessions list</div>
        </div>
      </div>
    </>
  );
}
