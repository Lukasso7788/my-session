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
  const [createdAt, setCreatedAt] = useState<string>("—");

  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [editButtonHover, setEditButtonHover] = useState(false);

  const brandBlack = "#2F2F2F";

  // Redirect
  useEffect(() => {
    if (!loading && !user) navigate("/login", { replace: true });
  }, [loading, user, navigate]);

  // Load profile
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

  // Load created_at
  useEffect(() => {
    if (!user) return;

    const loadCreatedAt = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("created_at")
        .eq("id", user.id)
        .single();

      if (!error && data?.created_at) {
        setCreatedAt(new Date(data.created_at).toLocaleDateString());
      }
    };

    loadCreatedAt();
  }, [user]);

  // Upload avatar
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
    } catch (error: any) {
      console.error("Avatar upload error:", error);
      alert("Upload failed. Check console.");
    } finally {
      setUploading(false);
    }
  };

  // Save
  const handleSave = async () => {
    if (!user) return;
    setSaving(true);

    try {
      await supabase
        .from("profiles")
        .update({
          full_name: fullName,
          bio,
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      await supabase.auth.updateUser({
        data: { full_name: fullName, avatar_url: avatarUrl },
      });

      setEditMode(false);
      await reloadProfile();
    } catch (error) {
      console.error("Save profile error:", error);
      alert("Failed to save profile.");
    } finally {
      setSaving(false);
    }
  };

  // Loading
  if (loading) {
    return (
      <>
        <Header />
        <div className="flex justify-center pt-20">
          <div className="animate-spin h-8 w-8 rounded-full border-b-2 border-black" />
        </div>
      </>
    );
  }

  if (!user) return null;

  const displayName = fullName || "User";
  const totalSessions = profile?.total_sessions ?? 0;

  const actionIconSrc = !editMode
    ? editButtonHover
      ? "/icons/edit_profile_hover.svg"
      : "/icons/edit_profile.svg"
    : editButtonHover
      ? "/icons/save_changes_hover.svg"
      : "/icons/save_changes.svg";

  const actionLabel = editMode
    ? saving
      ? "Saving..."
      : "Save changes"
    : "Edit profile";

  return (
    <>
      <Header />

      <main className="w-full px-8 pt-10 pb-24 font-inter text-gray-900">
        {/* Header buttons */}
        <div className="flex items-center justify-between mb-10">
          <button
            onClick={() => navigate(-1)}
            className="text-[16px] text-[#2F2F2F] hover:text-black flex items-center gap-2"
          >
            ← Back
          </button>

          <button
            onClick={editMode ? handleSave : () => setEditMode(true)}
            onMouseEnter={() => setEditButtonHover(true)}
            onMouseLeave={() => setEditButtonHover(false)}
            disabled={saving}
            className="
            inline-flex items-center gap-2 px-6 py-2 rounded-full
            border border-[#2F2F2F]
            text-[16px] font-normal text-[#2F2F2F]
            hover:bg-[#2F2F2F] hover:text-white
            hover:border-[#2F2F2F]
            transition disabled:opacity-60 disabled:cursor-not-allowed
          "
          >
            <img
              src={actionIconSrc}
              alt={editMode ? "Save changes" : "Edit profile"}
              className="w-6 h-6"
            />
            <span>{actionLabel}</span>
          </button>
        </div>

        {/* Avatar + Name */}
        <div className="flex flex-col items-center">
          <div className="relative">
            <img
              src={
                avatarUrl ||
                `https://ui-avatars.com/api/?name=${encodeURIComponent(
                  displayName
                )}`
              }
              className="w-28 h-28 rounded-full object-cover border border-gray-200 shadow-sm"
            />

            {editMode && (
              <label className="absolute -bottom-2 right-0 bg-white px-3 py-1 border rounded-full text-xs cursor-pointer shadow-sm hover:bg-gray-50">
                Change
                <input
                  type="file"
                  className="hidden"
                  onChange={handleAvatarUpload}
                  accept="image/*"
                  disabled={uploading}
                />
              </label>
            )}
          </div>

          {/* NAME */}
          <h1 className="font-inter font-bold text-[32px] text-[#2F2F2F] mt-4">
            {displayName}
          </h1>

          <div className="flex items-center gap-6 mt-2 text-sm">
            {/* Created date */}
            <span className="flex items-center gap-2">
              <img
                src="/icons/date_profile.svg"
                alt="Account creation date"
                className="w-[24px] h-[24px]"
              />
              <span className="text-[14px] font-light text-[#2F2F2F]">
                Since {createdAt}
              </span>
            </span>

            {/* Session count */}
            <span className="flex items-center gap-2">
              <img
                src="/icons/session_count.svg"
                alt="Total hosted sessions"
                className="w-[24px] h-[24px]"
              />
              <span className="text-[14px] font-medium text-[#2F2F2F]">
                {totalSessions} sessions
              </span>
            </span>
          </div>
        </div>

        {/* Divider */}
        <div className="mt-10 border-t border-gray-200" />

        {/* BIO */}
        <section className="mt-8">
          <h2 className="font-semibold mb-2">Bio:</h2>

          {editMode ? (
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="
              w-full border border-gray-300 p-4 rounded-xl
              focus:ring-2 focus:ring-black outline-none transition
            "
              rows={4}
              placeholder="Tell us about yourself..."
            />
          ) : (
            <p className="text-gray-800 text-lg">
              {bio || (
                <span className="text-gray-400 italic">No bio added yet.</span>
              )}
            </p>
          )}
        </section>

        {/* Divider */}
        <div className="mt-16 border-t border-gray-200" />

        {/* Hosted sessions */}
        <section className="mt-10">
          <h2 className="text-xl font-bold mb-6">
            Current hosted & upcoming sessions:
          </h2>

          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-gray-50 rounded-xl px-5 py-3 flex items-center justify-between"
              >
                <span className="text-gray-800 text-sm">
                  ☕ 25/5 pomodoro – 2 hour focus session
                </span>

                <span className="text-gray-500 text-xs">12.11.2025</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
