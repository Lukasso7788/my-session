// src/pages/ProfilePage.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, profile, loading, reloadProfile } = useAuth();

  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // ✅ Since: Month + Year
  const [createdAt, setCreatedAt] = useState<string>("—");

  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [editButtonHover, setEditButtonHover] = useState(false);

  // Sessions hosted by this user
  const [sessions, setSessions] = useState<any[]>([]);

  // ✅ comes from `profiles.attended_sessions_count`
  const [attendedCount, setAttendedCount] = useState<number>(0);

  const displayName = useMemo(() => fullName || "User", [fullName]);

  const avatarFallback = useMemo(() => {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}`;
  }, [displayName]);

  // === STATUS BADGES ===
  const getSessionStatus = (session: any) => {
    if (!session.start_time) return null;

    const now = Date.now();
    const start = new Date(session.start_time).getTime();

    let durationMinutes = 0;

    if (session.schedule) {
      try {
        const parsed =
          typeof session.schedule === "string"
            ? JSON.parse(session.schedule)
            : session.schedule;

        durationMinutes = parsed.reduce(
          (sum: number, block: any) => sum + (block.minutes || 0),
          0
        );
      } catch { }
    }

    const end = start + durationMinutes * 60 * 1000;

    if (now < start) return "Upcoming";
    if (now >= start && now <= end) return "Live";
    return "Finished";
  };

  const getBadgeClass = (status: string) => {
    switch (status) {
      case "Upcoming":
        return "px-2 py-0.5 text-[11px] rounded-full bg-[#DBEAFE] text-[#1D4ED8]";
      case "Live":
        return "px-2 py-0.5 text-[11px] rounded-full bg-[#DCFCE7] text-[#15803D]";
      case "Finished":
        return "px-2 py-0.5 text-[11px] rounded-full bg-[#E5E7EB] text-[#374151]";
      default:
        return "";
    }
  };

  // ✅ Month Year formatter (English UI)
  const formatSince = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
    }).format(d);
  };

  // Redirect
  useEffect(() => {
    if (!loading && !user) navigate("/login", { replace: true });
  }, [loading, user, navigate]);

  // ✅ Prefill quickly from context (if exists)
  useEffect(() => {
    if (!profile) return;

    setFullName(profile.full_name || "");
    setAvatarUrl(profile.avatar_url || null);

    const p: any = profile as any;

    // ✅ correct column name
    if (typeof p.attended_sessions_count === "number") {
      setAttendedCount(p.attended_sessions_count);
    }

    // optional: if your context already has created_at
    if (typeof p.created_at === "string" && p.created_at) {
      setCreatedAt(formatSince(p.created_at));
    }
  }, [profile]);

  // ✅ Load profile fields from supabase (BIO + attendedCount + created_at)
  useEffect(() => {
    if (!user) return;

    const loadProfile = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, bio, avatar_url, created_at, attended_sessions_count")
        .eq("id", user.id)
        .single();

      if (error) {
        console.warn("Failed to load profile:", error);
        return;
      }

      if (!data) return;

      setFullName(data.full_name || "");
      setBio(data.bio || "");
      setAvatarUrl(data.avatar_url || null);

      // ✅ attended_sessions_count from profiles
      if (typeof (data as any).attended_sessions_count === "number") {
        setAttendedCount((data as any).attended_sessions_count);
      } else {
        setAttendedCount(0);
      }

      // ✅ created_at from profiles -> Month Year
      if (data.created_at) setCreatedAt(formatSince(data.created_at));
      else setCreatedAt("—");
    };

    loadProfile();
  }, [user]);

  // Load hosted sessions
  useEffect(() => {
    if (!user?.id) return;

    const loadSessions = async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("id, title, start_time, schedule, created_at")
        .eq("host_id", user.id)
        .order("created_at", { ascending: false });

      if (!error && data) setSessions(data);
    };

    loadSessions();
  }, [user?.id]);

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

  // Save profile (НЕ трогаем attended_sessions_count и created_at)
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

  // Loading state
  if (loading) {
    return (
      <div className="flex justify-center pt-20">
        <div className="animate-spin h-8 w-8 rounded-full border-b-2 border-black" />
      </div>
    );
  }

  if (!user) return null;

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
    <main className="w-full px-8 pt-10 pb-24 font-inter text-gray-900">
      {/* Header buttons */}
      <div className="flex items-center justify-between mb-10">
        <button
          onClick={() => navigate(-1)}
          className="text-[16px] text-[#2F2F2F] hover:text-black flex items-center gap-2"
        >
          ← Back
        </button>

        {/* ✅ CHANGED: right side actions (preview icon + edit button) */}
        <div className="flex items-center gap-3">
          {/* ✅ ADDED: Profile preview icon (public) */}
          <button
            type="button"
            onClick={() => navigate(`/profile/${user.id}`)}
            className="
              h-10 w-10 rounded-full
              border border-[#2F2F2F]
              flex items-center justify-center
              text-[#2F2F2F]
              hover:bg-[#2F2F2F] hover:text-white
              transition
            "
            aria-label="Profile preview"
            title="Profile preview"
          >
            {/* inline eye icon */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path
                d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
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
      </div>

      {/* Avatar + Name */}
      <div className="flex flex-col items-center">
        <div className="relative">
          <img
            src={avatarUrl || avatarFallback}
            className="w-28 h-28 rounded-full object-cover border border-gray-200 shadow-sm"
            alt="avatar"
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

        {/* ✅ ADDED: editable name input (only in edit mode) */}
        {editMode && (
          <div className="mt-3 w-full max-w-[520px]">
            <label className="block text-sm font-medium text-[#2F2F2F] mb-2">
              Name
            </label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="
                w-full border border-gray-300 px-4 py-3 rounded-xl
                focus:ring-2 focus:ring-black outline-none transition
              "
              placeholder="Your name"
              disabled={saving}
              autoComplete="name"
            />
            <p className="text-xs text-gray-500 mt-2">
              This name will be saved when you click “Save changes”.
            </p>
          </div>
        )}

        <div className="flex items-center gap-6 mt-2 text-sm">
          {/* Created date */}
          <span className="flex items-center gap-2">
            <img
              src="/icons/date_profile.svg"
              alt="Account creation date"
              className="w-[24px] h-[24px]"
            />
            <span className="text-[14px] font-light text-[#2F2F2F]">
              Since: {createdAt}
            </span>
          </span>

          {/* Sessions attended (from profiles.attended_sessions_count) */}
          <span className="flex items-center gap-2">
            <img
              src="/icons/session_count.svg"
              alt="Total sessions attended"
              className="w-[24px] h-[24px]"
            />
            <span className="text-[14px] font-medium text-[#2F2F2F]">
              {attendedCount} sessions
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

      {/* ==== Hosted Sessions ==== */}
      <section className="mt-10">
        <h2 className="text-xl font-bold mb-6 text-[#2F2F2F]">
          Hosted Sessions
        </h2>

        {sessions.length === 0 ? (
          <p className="text-slate-500 text-sm text-center">
            No sessions hosted yet.
          </p>
        ) : (
          <div className="space-y-3">
            {sessions.map((s) => {
              const status = getSessionStatus(s);

              return (
                <div
                  key={s.id}
                  onClick={() => navigate(`/room/${s.id}`)}
                  className="
                      bg-gray-50 rounded-xl px-5 py-3
                      flex items-center justify-between
                      hover:bg-gray-100 transition cursor-pointer
                    "
                >
                  <span className="text-[14px] text-gray-800">{s.title}</span>

                  <div className="flex items-center gap-3">
                    <span className="text-[12px] text-gray-500">
                      {new Date(s.created_at).toLocaleDateString()}
                    </span>

                    {status && (
                      <span className={getBadgeClass(status)}>{status}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
