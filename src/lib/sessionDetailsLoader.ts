import { supabase } from "./supabase";

// One session shaped like a Sessions page row, so SessionCard can show its
// details modal anywhere (e.g. the hosts page). Only the base row is
// required; room rules, link, bookings and host profile are best effort,
// the same way the Sessions page enriches its cards.
export async function loadSessionForDetails(sessionId: string): Promise<any | null> {
  const id = String(sessionId || "").trim();
  if (!id) return null;

  const { data, error } = await supabase
    .from("sessions")
    .select(
      "id, title, host_id, host_name, duration_minutes, format, start_time, status, created_at, custom_slug, session_format_type, is_silent, is_private, is_hidden, max_participants, description, schedule",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;

  const session: any = { ...data, session_bookings: [], live_count: 0 };

  const [policies, slug, bookings, host] = await Promise.all([
    supabase
      .from("sessions")
      .select("id, camera_required, screen_share_required, public_chat_disabled, is_pinned")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("public_url_slugs")
      .select("slug")
      .eq("owner_type", "session")
      .eq("owner_id", id)
      .maybeSingle(),
    supabase.rpc("get_public_session_bookings_with_times", { p_session_ids: [id] }),
    session.host_id
      ? supabase.from("profiles").select("id, full_name, avatar_url").eq("id", session.host_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (!policies.error && policies.data) Object.assign(session, policies.data);

  const publicSlug = !slug.error ? String((slug.data as any)?.slug || "").trim() : "";
  if (publicSlug) {
    session.public_slug = publicSlug;
    session.public_url_slug = { slug: publicSlug };
    session.public_url_slugs = [{ slug: publicSlug, owner_type: "session", owner_id: id }];
  }

  if (!bookings.error && Array.isArray(bookings.data)) {
    session.session_bookings = (bookings.data as any[]).map((row) => ({
      user_id: String(row?.user_id || ""),
      created_at: row?.created_at || null,
      booked_start_time: row?.booked_start_time || null,
      booked_end_time: row?.booked_end_time || null,
      booking_role: row?.booking_role === "host" ? "host" : "participant",
      profiles: {
        id: String(row?.user_id || ""),
        full_name: row?.full_name || null,
        avatar_url: row?.avatar_url || null,
      },
    }));
  }

  const hostProfile = (host as any)?.data;
  if (hostProfile) {
    session.host_name = hostProfile.full_name || session.host_name;
    session.host_avatar_url = hostProfile.avatar_url || null;
    session.host_profile = hostProfile;
  }

  return session;
}
