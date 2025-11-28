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

  // 1. Защита маршрута
  useEffect(() => {
    if (!loading && !user) {
      navigate("/login", { replace: true });
    }
  }, [loading, user, navigate]);

  // 2. Загрузка данных (РОВНО КАК БЫЛО)
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
  }, [user, profile, reloadProfile]);

  // 3. Загрузка аватара (КАК БЫЛО)
  const handleAvatarUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
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

      // Обновляем всё параллельно
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

      if (err.message && err.message.includes("Bucket not found")) {
        alert(
          "Ошибка: В Supabase не создан Storage Bucket 'avatars'. Создайте его в панели управления и сделайте Public.",
        );
      } else {
        alert("Ошибка загрузки. Проверьте консоль.");
      }
    } finally {
      setUploading(false);
    }
  };

  // 4. Сохранение профиля (КАК БЫЛО)
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
      alert("Не удалось сохранить профиль.");
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

      <main className="min-h-screen bg-white font-inter text-gray-900">
        <div className="w-full max-w-4xl mx-auto px-6 py-12">
          {/* Верхняя строка: Back слева, Edit справа */}
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => navigate(-1)}
              className="text-sm flex items-center gap-2 text-gray-500 hover:text-black transition-colors"
            >
              ← Back
            </button>

            <button
              onClick={() => setEditMode(!editMode)}
              className="px-5 py-2.5 border border-gray-300 rounded-full hover:bg-gray-50 transition text-sm font-medium"
            >
              {editMode ? "Cancel editing" : "Edit profile"}
            </button>
          </div>

          {/* Аватар + имя */}
          <div className="flex flex-col items-center gap-4">
            <div className="relative group">
              <img
                src={
                  avatarUrl ||
                  `https://ui-avatars.com/api/?name=${encodeURIComponent(
                    displayName,
                  )}`
                }
                className={`w-32 h-32 rounded-full object-cover border border-gray-200 shadow-sm ${uploading ? "opacity-50" : ""
                  }`}
              />
              {uploading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="animate-spin h-8 w-8 border-b-2 border-black rounded-full" />
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
                  disabled={uploading}
                />
              </label>
            )}
          </div>

          {/* Имя */}
          {editMode ? (
            <div className="mt-6 flex justify-center">
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="text-3xl font-bold text-center border-b-2 border-gray-200 focus:border-black outline-none pb-2 w-full max-w-md transition-colors"
                placeholder="Your Name"
              />
            </div>
          ) : (
            <h1 className="text-3xl font-bold text-center mt-6">
              {displayName}
            </h1>
          )}

          {/* ABOUT / BIO */}
          <div className="mt-12 border-t border-gray-100 pt-8 max-w-2xl mx-auto">
            <h2 className="text-lg font-semibold mb-3">About</h2>

            {editMode ? (
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="w-full border border-gray-300 p-4 rounded-xl focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
                rows={5}
                placeholder="Tell us about yourself..."
              />
            ) : (
              <p className="text-gray-600 whitespace-pre-wrap leading-relaxed">
                {bio || (
                  <span className="text-gray-400 italic">
                    No bio added yet.
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Кнопка Save */}
          {editMode && (
            <div className="mt-8 flex justify-center">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-8 py-3 bg-black text-white rounded-full hover:bg-gray-800 disabled:opacity-50 transition font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 active:translate-y-0"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          )}

          {/* Hosted sessions */}
          <div className="mt-16 pt-8 border-t border-gray-100">
            <h2 className="text-xl font-bold mb-6">
              Hosted Sessions History
            </h2>
            <div className="bg-gray-50 rounded-xl p-8 text-center">
              <p className="text-gray-500 text-sm">
                No sessions history available yet.
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
