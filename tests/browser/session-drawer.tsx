import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import SessionCard from "../../src/components/SessionCard";
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
  </MemoryRouter>
);
