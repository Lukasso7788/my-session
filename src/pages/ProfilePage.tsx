import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Header from "../components/Header";
import { useAuth } from "../context/AuthContext";
import { Calendar, Users } from "lucide-react";

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
        .select("full_name, bio, avatar_url, created_at")
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

  const joinedDate = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString()
    : "—";

  const totalSessions = profile?.total_sessions ?? 0;

  // Save profile
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

  const displayName = fullName || profile?.full_name || "User";

  return (
    <>
      <Header />

      <main className="w-full max-w-4xl mx-auto px-6 pt-10 pb-24 font-inter text-gray-900">

        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-gray-600 hover:text-black mb-6 flex items-center gap-2"
        >
          ← Back
        </button>

        {/* Avatar + Name */}
        <div className="flex flex-col items-center">
          <img
            src={
              avatarUrl ||
              `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}`
            }
            className="w-28 h-28 rounded-full border border-gray-200 shadow-sm object-cover"
          />

          <h1 className="text-3xl font-bold mt-4">{displayName}</h1>

          <div className="flex items-center gap-4 mt-2 text-gray-600 text-sm">
            <span className="flex items-center gap-1">
              <Calendar size={16} /> Since {joinedDate}
            </span>

            <span className="flex items-center gap-1">
              <Users size={16} /> {totalSessions} sessions
            </span>
          </div>

          <button
            onClick={() => setEditMode(!editMode)}
            className="mt-5 px-5 py-2 border border-gray-300 rounded-full hover:bg-gray-50 transition text-sm font-medium flex items-center gap-2"
          >
            ✏️ Edit profile
          </button>
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
              className="w-full border border-gray-300 p-4 rounded-xl focus:ring-2 focus:ring-black outline-none transition"
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

        {/* Save */}
        {editMode && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-8 py-3 bg-black text-white rounded-full hover:bg-gray-800 disabled:opacity-50 transition font-medium shadow"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        )}

        {/* Divider */}
        <div className="mt-16 border-t border-gray-200" />

        {/* Sessions */}
        <section className="mt-10">
          <h2 className="text-xl font-bold mb-6">
            Current hosted & upcoming sessions:
          </h2>

          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-3 flex items-center justify-between shadow-sm"
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