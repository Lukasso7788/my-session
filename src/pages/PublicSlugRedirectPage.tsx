import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { RoomEntryGate } from "../components/RoomEntryGate";
import { supabase } from "../lib/supabase";
import RoomPageLiveKit from "./RoomPageLiveKit";
import { pickHostLinkSession } from "../lib/hostLink";

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
  description?: string | null;
  is_private?: boolean | null;
  is_hidden?: boolean | null;
};

function normalizeSlug(raw?: string | null) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "");
}

export default function PublicSlugRedirectPage() {
  const params = useParams();
  const slug = useMemo(() => normalizeSlug(params.slug), [params.slug]);

  const [state, setState] = useState<"loading" | "ready" | "not_found" | "no_session" | "error">("loading");
  const [resolvedSessionId, setResolvedSessionId] = useState<string>("");
  const [hostProfileId, setHostProfileId] = useState<string>("");

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
        setHostProfileId("");
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

          // A host link opens the group session this host runs now, else
          // their next one (see pickHostLinkSession).
          const { data: sessions, error: sessionsError } = await supabase
            .from("sessions")
            .select(
              "id, host_id, title, start_time, duration_minutes, session_format_type, format, schedule, status, created_at, description, is_private, is_hidden"
            )
            .eq("host_id", row.owner_id)
            .or("is_hidden.is.null,is_hidden.eq.false")
            .or("is_private.is.null,is_private.eq.false")
            .gte("start_time", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .order("start_time", { ascending: true })
            .limit(50);

          if (sessionsError) throw sessionsError;

          const best = pickHostLinkSession((sessions || []) as SessionRow[]);
          if (!best?.id) {
            if (!cancelled) {
              setHostProfileId(row.owner_id);
              setState("no_session");
            }
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
    return (
      <RoomEntryGate sessionId={resolvedSessionId}>
        <RoomPageLiveKit sessionIdOverride={resolvedSessionId} />
      </RoomEntryGate>
    );
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
            <div className="text-[20px] font-semibold">Not hosting right now</div>
            <p className="mt-2 text-[14px] leading-6 text-[#606060]">
              This host has no group session running or scheduled at the moment. This link opens their session as soon as they schedule one.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {hostProfileId ? (
                <Link className="inline-flex rounded-full border border-[#2F2F2F] px-5 py-3 text-[14px] font-semibold text-[#2F2F2F]" to={`/profile/${hostProfileId}`}>
                  View host profile
                </Link>
              ) : null}
              <Link className="inline-flex rounded-full bg-[#2F2F2F] px-5 py-3 text-[14px] font-semibold text-white" to="/sessions">
                Browse sessions
              </Link>
            </div>
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
