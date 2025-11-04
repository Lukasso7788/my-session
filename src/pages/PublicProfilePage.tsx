import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function PublicProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProfile() {
      if (!id) return;

      const [{ data: profileData, error: profileError }, { data: sessionData }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id, full_name, avatar_url, bio, updated_at")
            .eq("id", id)
            .single(),
          supabase
            .from("sessions")
            .select("id, title, created_at")
            .eq("host_id", id)
            .order("created_at", { ascending: false }),
        ]);

      if (profileError) console.error("❌ Error loading profile:", profileError);
      setProfile(profileData);
      setSessions(sessionData || []);
      setLoading(false);
    }

    loadProfile();
  }, [id]);

  if (loading)
    return (
      <div className="flex h-screen items-center justify-center text-white bg-slate-900">
        <p>Loading...</p>
      </div>
    );

  if (!profile)
    return (
      <div className="flex h-screen items-center justify-center text-white bg-slate-900">
        <div className="text-center">
          <p className="text-lg font-medium mb-3">User not found.</p>
          <button
            onClick={() => navigate("/sessions")}
            className="text-blue-400 hover:text-blue-300 underline text-sm"
          >
            Back to sessions
          </button>
        </div>
      </div>
    );

  const avatar =
    profile.avatar_url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(
      profile.full_name || "User"
    )}`;

  return (
    <div className="min-h-screen bg-slate-900 text-white flex justify-center py-20">
      <div className="bg-slate-800 rounded-2xl p-10 shadow-lg w-full max-w-[720px] space-y-10">
        {/* ==== Header / Avatar ==== */}
        <div className="text-center space-y-5">
          <img
            src={avatar}
            alt="avatar"
            className="w-28 h-28 rounded-full mx-auto border border-slate-600 object-cover"
          />
          <h1 className="text-3xl font-bold">{profile.full_name}</h1>
          <p className="text-slate-400 text-sm max-w-md mx-auto">
            {profile.bio || "This user has not added a bio yet."}
          </p>
          <p className="text-xs text-slate-500">
            Last updated:{" "}
            {new Date(profile.updated_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>

        {/* ==== Hosted Sessions ==== */}
        <div>
          <h2 className="text-lg font-semibold text-slate-300 mb-4">
            Hosted Sessions
          </h2>

          {sessions.length === 0 ? (
            <p className="text-slate-500 text-sm text-center">
              No sessions hosted yet.
            </p>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => navigate(`/room/${s.id}`)}
                  className="flex justify-between items-center bg-slate-700/50 hover:bg-slate-700 transition p-3 rounded-xl cursor-pointer"
                >
                  <span>{s.title}</span>
                  <span className="text-xs text-slate-400">
                    {new Date(s.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
