import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Header from "../components/Header";

export default function ProfilePage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);

  const [profile, setProfile] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);

  const [editMode, setEditMode] = useState(false);
  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load profile
  useEffect(() => {
    async function load() {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        navigate("/login");
        return;
      }

      setUser(data.user);

      // profile
      const { data: prof } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", data.user.id)
        .single();

      setProfile(prof);
      setFullName(prof.full_name || "");
      setBio(prof.bio || "");
      setAvatarUrl(prof.avatar_url || null);

      // sessions
      const { data: sess } = await supabase
        .from("sessions")
        .select("id, title, start_time, format")
        .eq("host_id", data.user.id)
        .order("start_time", { ascending: false });

      setSessions(sess || []);
    }

    load();
  }, []);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const ext = file.name.split(".").pop();
    const filePath = `${user.id}/${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(filePath, file, { upsert: true });

    if (upErr) {
      alert("Failed to upload avatar");
      return;
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(filePath);
    setAvatarUrl(data.publicUrl);
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);

    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        bio,
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    setSaving(false);

    if (error) {
      alert("Failed to save");
      return;
    }

    setProfile((p: any) => ({
      ...p,
      full_name: fullName,
      bio,
      avatar_url: avatarUrl,
    }));

    setEditMode(false);
  };

  if (!profile) return <div />;

  return (
    <div className="bg-white min-h-screen">
      <Header />

      <div className="max-w-[1000px] mx-auto px-8 py-10">
        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          className="text-[15px] flex items-center gap-2 text-black/70 hover:text-black"
        >
          ← Back
        </button>

        {/* Avatar + Info */}
        <div className="flex flex-col items-center mt-10 space-y-3">
          <label className="cursor-pointer relative">
            <img
              src={
                avatarUrl ||
                `https://ui-avatars.com/api/?name=${encodeURIComponent(
                  fullName || "User"
                )}`
              }
              alt="avatar"
              className="w-28 h-28 rounded-full object-cover"
            />
            {editMode && (
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
              />
            )}
          </label>

          {editMode ? (
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="text-[28px] font-semibold text-center border-b border-black/20 pb-1"
            />
          ) : (
            <h1 className="text-[32px] font-semibold">{profile.full_name}</h1>
          )}

          {/* Meta */}
          <div className="flex items-center gap-3 text-[15px] text-black/60">
            <span>📅 Since {profile.created_at?.slice(0, 10)}</span>
            <span>•</span>
            <span>📊 {sessions.length} sessions</span>
          </div>

          {/* Edit or Save */}
          {!editMode ? (
            <button
              onClick={() => setEditMode(true)}
              className="mt-3 px-4 py-2 border rounded-xl text-[14px] hover:bg-black hover:text-white transition"
            >
              Edit profile
            </button>
          ) : (
            <div className="flex gap-3 mt-3">
              <button
                onClick={handleSave}
                className="px-5 py-2 bg-black text-white rounded-xl text-[14px]"
                disabled={saving}
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
              <button
                onClick={() => {
                  setEditMode(false);
                  setFullName(profile.full_name);
                  setBio(profile.bio);
                  setAvatarUrl(profile.avatar_url);
                }}
                className="px-5 py-2 rounded-xl border text-[14px]"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Bio */}
        <div className="mt-8 border-t pt-6">
          <h2 className="text-[17px] font-medium mb-2">Bio:</h2>

          {editMode ? (
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              className="w-full border rounded-xl p-3 text-[15px]"
            />
          ) : (
            <p className="text-[16px] text-black/80">
              {bio || "No bio provided."}
            </p>
          )}
        </div>

        {/* Sessions List */}
        <div className="mt-12">
          <h2 className="text-[22px] font-semibold mb-4">
            Current hosted & upcoming sessions:
          </h2>

          <div className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="flex justify-between items-center px-4 py-3 bg-black/5 rounded-xl"
              >
                <span className="text-[15px]">{s.title}</span>
                <span className="text-[14px] text-black/60">
                  {s.start_time?.slice(0, 10)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
