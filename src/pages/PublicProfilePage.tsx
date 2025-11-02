import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function PublicProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProfile() {
      if (!id) return;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, bio, updated_at")
        .eq("id", id)
        .single();

      if (error) console.error("❌ Error loading profile:", error);
      else setProfile(data);
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
        <p>User not found.</p>
      </div>
    );

  return (
    <div className="min-h-screen bg-slate-900 text-white flex justify-center py-20">
      <div className="bg-slate-800 rounded-2xl p-10 shadow-lg w-[480px] text-center space-y-6">
        <img
          src={
            profile.avatar_url ||
            `https://ui-avatars.com/api/?name=${encodeURIComponent(
              profile.full_name || "User"
            )}`
          }
          alt="avatar"
          className="w-28 h-28 rounded-full mx-auto border border-slate-600 object-cover"
        />

        <h1 className="text-3xl font-bold mt-4">{profile.full_name}</h1>
        <p className="text-slate-400 text-sm">
          {profile.bio || "This user has not added a bio yet."}
        </p>

        <p className="text-xs text-slate-500 mt-6">
          Last updated:{" "}
          {new Date(profile.updated_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </div>
    </div>
  );
}
