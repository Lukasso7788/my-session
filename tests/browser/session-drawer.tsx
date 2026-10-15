import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import SessionCard from "../../src/components/SessionCard";
import ProfileHoverLayer from "../../src/components/ProfileHoverLayer";
import { buildSessionSeries } from "../../src/lib/sessionSeries";
import "../../src/index.css";

// Dev-only preview of the session drawer with a week-long daily series.
// Supabase points at a dead local port, so bookings live in local state.
const ME = "user-me";
const HOST = "host-anna";
const people = ["Maya Chen", "Jonas Weber", "Priya Nair", "Leo Martins", "Sara Kim", "Tom Novak", "Ines Duarte", "Ravi Patel"];

const now = new Date();
const startAt = (dayOffset: number) => {
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
};

function makeSessions(booked: Set<string>) {
  return Array.from({ length: 7 }, (_, day) => {
    const id = `daily-${day + 1}`;
    const others = people.slice(0, day === 0 ? 8 : 2 + (day % 3)).map((name, index) => ({
      user_id: `p-${index}`,
      profiles: { full_name: name, avatar_url: null },
    }));
    return {
      id,
      title: "Morning Deep Work",
      host_id: HOST,
      host_name: "Anna Fischer",
      start_time: startAt(day + 1),
      duration_minutes: 60,
      max_participants: 16,
      session_format_type: "group",
      description: "Two focused 25-minute blocks with a short check-in. Cameras on, mics muted during focus.",
      camera_required: true,
      session_bookings: [
        { user_id: HOST, profiles: { full_name: "Anna Fischer" }, booking_role: "host" },
        ...others,
        ...(booked.has(id) ? [{ user_id: ME, profiles: { full_name: "You" } }] : []),
      ],
    };
  });
}

function Preview() {
  const [booked, setBooked] = useState(() => new Set(["daily-3"]));
  const sessions = useMemo(() => makeSessions(booked), [booked]);
  const series = useMemo(() => buildSessionSeries(sessions, { userId: ME }), [sessions]);
  const wait = () => new Promise((resolve) => window.setTimeout(resolve, 350));
  const update = (ids: string[], value: boolean) =>
    setBooked((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (value ? next.add(id) : next.delete(id)));
      return next;
    });

  // ?infinite=1 shows a 24/7 room with a host who booked several days.
  const infinite = new URLSearchParams(window.location.search).get("infinite") === "1";
  const [hostSlots, setHostSlots] = useState<Array<{ starts_at: string; ends_at: string }>>([]);
  const infiniteRoom = useMemo(() => {
    const at = (day: number, hour: number) => {
      const d = new Date();
      d.setDate(d.getDate() + day);
      d.setHours(hour, 0, 0, 0);
      return d.toISOString();
    };
    return {
      id: "room-247",
      title: "Deep Work 24/7",
      host_id: HOST,
      session_format_type: "infinite",
      start_time: at(-30, 0),
      duration_minutes: 0,
      max_participants: 30,
      description: "An always-open room for quiet focus. Hosts keep it company at set times.",
      session_bookings: [
        { user_id: "p-1", profiles: { full_name: "Maya Chen" }, booking_role: "host", booked_start_time: at(0, 18), booked_end_time: at(0, 20) },
      ],
      host_slots: [
        { user_id: "p-1", starts_at: at(1, 18), ends_at: at(1, 20), profiles: { full_name: "Maya Chen" } },
        { user_id: "p-1", starts_at: at(2, 18), ends_at: at(2, 20), profiles: { full_name: "Maya Chen" } },
        ...hostSlots.map((slot) => ({ user_id: ME, ...slot, profiles: { full_name: "You" } })),
      ],
    };
  }, [hostSlots]);

  if (infinite) {
    return (
      <div style={{ maxWidth: 1100, margin: "40px auto", padding: 16 }}>
        <SessionCard
          session={infiniteRoom}
          userId={ME}
          currentUser={{ id: ME, full_name: "You" }}
          onBook={async () => { await wait(); return true; }}
          onBookHostSlots={async (_id, slots) => { await wait(); setHostSlots(slots); return "ok"; }}
          onCancelBooking={async () => { await wait(); setHostSlots([]); }}
          onJoin={() => {}}
          onDelete={() => {}}
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: "40px auto", padding: 16 }}>
      <SessionCard
        session={sessions[0]}
        userId={ME}
        currentUser={{ id: ME, full_name: "You" }}
        seriesOccurrences={series.get(sessions[0].id)}
        onBook={async (id) => { await wait(); update([id], true); return true; }}
        onCancelBooking={async (id) => { await wait(); update([id], false); }}
        onBookSeries={async (ids) => { await wait(); update(ids, true); return ids; }}
        onCancelSeries={async (ids) => { await wait(); update(ids, false); return true; }}
        onJoin={() => {}}
        onDelete={() => {}}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <Preview />
    <ProfileHoverLayer />
  </MemoryRouter>
);

// Profile hover cards: answer the two profile-stats requests with sample data.
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/rest/v1/host_followers")) {
    return new Response(null, { status: 200, headers: { "content-range": "0-0/128" } });
  }
  if (url.includes("/rest/v1/profiles")) {
    const profile = {
      full_name: null,
      bio: "Designer in Berlin. Mornings are for deep work, afternoons for calls.",
      timezone: "Europe/Berlin",
      avatar_url: null,
      attended_sessions_count: 214,
      created_at: "2025-03-02T10:00:00Z",
    };
    const accept = new Headers(init?.headers).get("accept") || "";
    const body = accept.includes("vnd.pgrst.object") ? profile : [profile];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
};

// ?open=1 opens the details modal right away (for headless screenshots).
if (new URLSearchParams(window.location.search).get("open") === "1") {
  window.setTimeout(() => {
    document.querySelector<HTMLButtonElement>('button[aria-label="Session details"]')?.click();
    // ?hover=<name> also opens that person's profile card.
    const hover = new URLSearchParams(window.location.search).get("hover");
    if (hover) {
      window.setTimeout(() => {
        const chip = [...document.querySelectorAll<HTMLElement>('[role="dialog"] a[data-profile-id]')].find((el) => el.textContent?.includes(hover));
        chip?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
      }, 600);
    }
  }, 600);
}
