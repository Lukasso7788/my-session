import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import RoomPageLiveKit from "./RoomPageLiveKit";

type PublicSlugRow = {
  slug: string;
  owner_type: "system" | "profile" | "session" | string;
  owner_id: string | null;
};

type SessionRow = {
  id: string;
  host_id: string | null;
  title?: string | null;
  start_time?: string | null;
  duration_minutes?: number | null;
  session_format_type?: string | null;
  format?: string | null;
  schedule?: any;
  status?: string | null;
  created_at?: string | null;
};

function normalizeSlug(raw?: string | null) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "");
}

function parseSchedule(raw: any) {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function isInfiniteSession(session: SessionRow) {
  const type = String(session.session_format_type || "").toLowerCase();
  if (type === "infinite") return true;

  const format = String(session.format || "").toLowerCase();
  if (format === "infinite") return true;

  const schedule = parseSchedule(session.schedule);
  if (!schedule || typeof schedule !== "object") return false;

  if ((schedule as any).kind === "infinite_room") return true;
  if ((schedule as any)?.timer?.phases) return true;
  if ((schedule as any)?.phases) return true;

  return false;
}

function getStartMs(session: SessionRow) {
  if (!session.start_time) return null;
  const ms = new Date(session.start_time).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function getEndMs(session: SessionRow) {
  const startMs = getStartMs(session);
  if (startMs == null) return null;

  const durationMinutes = Number(session.duration_minutes || 0);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;

  return startMs + durationMinutes * 60 * 1000;
}

function pickBestHostSession(sessions: SessionRow[]) {
  const now = Date.now();
  const usable = (sessions || []).filter((s) => s?.id);

  const liveScheduled = usable
    .filter((s) => {
      if (isInfiniteSession(s)) return false;
      const startMs = getStartMs(s);
      const endMs = getEndMs(s);
      if (startMs == null || endMs == null) return false;
      return startMs <= now && endMs >= now;
    })
    .sort((a, b) => (getStartMs(a) || 0) - (getStartMs(b) || 0));

  if (liveScheduled[0]) return liveScheduled[0];

  const upcoming = usable
    .filter((s) => {
      if (isInfiniteSession(s)) return false;
      const startMs = getStartMs(s);
      return startMs != null && startMs >= now;
    })
    .sort((a, b) => (getStartMs(a) || 0) - (getStartMs(b) || 0));

  if (upcoming[0]) return upcoming[0];

  const infinite = usable
    .filter(isInfiniteSession)
    .sort((a, b) => {
      const at = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bt - at;
    });

  if (infinite[0]) return infinite[0];

  const latest = usable.sort((a, b) => {
    const at = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bt - at;
  });

  return latest[0] || null;
}

export default function PublicSlugRedirectPage() {
  const params = useParams();
  const slug = useMemo(() => normalizeSlug(params.slug), [params.slug]);

  const [state, setState] = useState<"loading" | "ready" | "not_found" | "no_session" | "error">("loading");
  const [resolvedSessionId, setResolvedSessionId] = useState<string>("");

  useEffect(() => {
    if (!slug) {
      setResolvedSessionId("");
      setState("not_found");
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setResolvedSessionId("");
        setState("loading");

        const { data: slugRow, error: slugError } = await supabase
          .from("public_url_slugs")
          .select("slug, owner_type, owner_id")
          .eq("slug", slug)
          .maybeSingle();

        if (slugError) throw slugError;

        const row = slugRow as PublicSlugRow | null;
        if (!row || !row.owner_type) {
          if (!cancelled) setState("not_found");
          return;
        }

        if (row.owner_type === "session") {
          if (!row.owner_id) {
            if (!cancelled) setState("not_found");
            return;
          }

          if (!cancelled) {
            setResolvedSessionId(row.owner_id);
            setState("ready");
          }
          return;
        }

        if (row.owner_type === "profile") {
          if (!row.owner_id) {
            if (!cancelled) setState("not_found");
            return;
          }

          const { data: sessions, error: sessionsError } = await supabase
            .from("sessions")
            .select(
              "id, host_id, title, start_time, duration_minutes, session_format_type, format, schedule, status, created_at"
            )
            .eq("host_id", row.owner_id)
            .or("is_hidden.is.null,is_hidden.eq.false")
            .order("start_time", { ascending: true });

          if (sessionsError) throw sessionsError;

          const best = pickBestHostSession((sessions || []) as SessionRow[]);
          if (!best?.id) {
            if (!cancelled) setState("no_session");
            return;
          }

          if (!cancelled) {
            setResolvedSessionId(best.id);
            setState("ready");
          }
          return;
        }

        if (!cancelled) setState("not_found");
      } catch (e) {
        console.error("[PublicSlugRedirectPage] failed:", e);
        if (!cancelled) setState("error");
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state === "ready" && resolvedSessionId) {
    return <RoomPageLiveKit sessionIdOverride={resolvedSessionId} />;
  }

  return (
    <div className="min-h-screen bg-white px-4 py-16 text-[#2F2F2F] font-inter">
      <div className="mx-auto max-w-[560px] rounded-[28px] border border-[#EAEAEA] bg-white p-6 text-center shadow-sm">
        {state === "loading" ? (
          <>
            <div className="text-[20px] font-semibold">Opening MySession…</div>
            <p className="mt-2 text-[14px] leading-6 text-[#606060]">
              Finding the right focus room for this link.
            </p>
          </>
        ) : state === "no_session" ? (
          <>
            <div className="text-[20px] font-semibold">No active session found</div>
            <p className="mt-2 text-[14px] leading-6 text-[#606060]">
              This host does not have an available session right now.
            </p>
            <Link className="mt-5 inline-flex rounded-full bg-[#2F2F2F] px-5 py-3 text-[14px] font-semibold text-white" to="/sessions">
              Browse sessions
            </Link>
          </>
        ) : state === "error" ? (
          <>
            <div className="text-[20px] font-semibold">Could not open this link</div>
            <p className="mt-2 text-[14px] leading-6 text-[#606060]">
              Something went wrong while loading this MySession link.
            </p>
            <Link className="mt-5 inline-flex rounded-full bg-[#2F2F2F] px-5 py-3 text-[14px] font-semibold text-white" to="/sessions">
              Go to sessions
            </Link>
          </>
        ) : (
          <>
            <div className="text-[20px] font-semibold">Link not found</div>
            <p className="mt-2 text-[14px] leading-6 text-[#606060]">
              This MySession link does not exist or is no longer available.
            </p>
            <Link className="mt-5 inline-flex rounded-full bg-[#2F2F2F] px-5 py-3 text-[14px] font-semibold text-white" to="/sessions">
              Go to sessions
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
