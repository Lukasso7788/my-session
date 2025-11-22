import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import Header from "../components/Header";

export default function ProfilePage() {
  const navigate = useNavigate();

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // 📌 LOAD USER + PROFILE (через getSession + onAuthStateChange)
  useEffect(() => {
    let isMounted = true;

    const loadProfile = async (currentUser: User) => {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("full_name,bio,avatar_url")
        .eq("id", currentUser.id)
        .single();

      if (!isMounted) return;

      if (error) {
        console.error("Error loading profile:", error);
      }

      if (profile) {
        setFullName(profile.full_name || "");
        setBio(profile.bio || "");
        setAvatarUrl(profile.avatar_url || null);
      }

      setLoading(false);
    };

    const init = async () => {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        console.error("getSession error:", error);
      }

      const currentUser = session?.user;
      if (!currentUser) {
        if (!isMounted) return;
        navigate("/login", { replace: true });
        return;
      }

      if (!isMounted) return;

      setUser(currentUser);
      await loadProfile(currentUser);
    };

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ?? null;

      if (!isMounted) return;

      if (!currentUser) {
        setUser(null);
        navigate("/login", { replace: true });
        return;
      }

      setUser(currentUser);
      // профиль перезагрузим при смене юзера
      loadProfile(currentUser);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [navigate]);

  // 📌 UPLOAD AVATAR
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

      // auth metadata
      const { error: updateUserError } = await supabase.auth.updateUser({
        data: { avatar_url: publicUrl },
      });
      if (updateUserError) {
        console.error("updateUser error:", updateUserError);
      }

      // profile row
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
    } catch (err) {
      console.error("avatar upload error:", err);
    } finally {
      setUploading(false);
    }
  };

  // 📌 SAVE PROFILE
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
        console.error("updateUser error:", updateUserError);
      }

      setEditMode(false);
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

  return (
    <>
      <Header />

      <div className="w-full max-w-4xl mx-auto px-6 py-12">
        {/* BACK BUTTON */}
        <button
          onClick={() => navigate(-1)}
          className="text-sm flex items-center gap-2 text-gray-500 hover:text-black mb-6"
        >
          ← Back
        </button>

        {/* AVATAR */}
        <div className="flex flex-col items-center gap-4">
          <img
            src={
              avatarUrl ||
              `https://ui-avatars.com/api/?name=${encodeURIComponent(
                fullName || "User"
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

        {/* NAME */}
        <h1 className="text-3xl font-semibold text-center mt-4">
          {fullName || "New user"}
        </h1>

        {/* META */}
        <p className="text-center text-gray-500 mt-2">
          Since 12.11.2025 • 120 sessions
        </p>

        {/* EDIT BUTTON */}
        <div className="flex justify-center mt-4">
          <button
            onClick={() => setEditMode(!editMode)}
            className="px-4 py-2 border rounded-lg hover:bg-gray-100 transition"
          >
            {editMode ? "Cancel" : "Edit profile"}
          </button>
        </div>

        {/* BIO */}
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

        {/* SAVE BUTTON */}
        {editMode && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-6 px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        )}

        {/* FUTURE SESSIONS LIST PLACEHOLDER */}
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
