import { createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "../../src/index.css";

// Dev-only preview of /hosts and /leaderboard with fixture data. Supabase
// points at a dead local port; the two community RPCs are answered here.
// ?page=hosts|leaderboard, ?empty=1 for empty lists, ?slow=1 to see loading.
const params = new URLSearchParams(location.search);
const names = [
  ["Anna Fischer", "DE"], ["Pramish Shrestha", "NP"], ["Maya Chen", "CA"], ["Jonas Weber", "AT"],
  ["Priya Nair", "IN"], ["Leo Martins", "BR"], ["Sara Kim", "KR"], ["Tom Novak", "CZ"],
  ["Ines Duarte", "PT"], ["Ravi Patel", "GB"], ["Olena Koval", "UA"], ["Sam Taylor", "US"],
];
const bios = [
  "Morning deep work for writers and researchers. Cameras on, quiet focus, a short check-in at the end.",
  "I host 50/10 blocks for developers. Bring one ticket, leave with it closed.",
  null,
  "Study sessions for exam season. Pomodoro, no small talk during focus.",
  "Late-night focus for night owls in Asia and Europe.",
  null,
];
const now = Date.now();
const hosts = names.slice(0, 9).map(([full_name, country_code], index) => ({
  user_id: `host-${index}`,
  full_name,
  avatar_url: null,
  bio: bios[index % bios.length],
  country_code,
  hosted_sessions: [212, 148, 96, 61, 40, 23, 12, 5, 1][index],
  attended_sessions: [340, 260, 180, 90, 75, 44, 30, 9, 3][index],
  focus_rate: index === 7 ? null : [86.4, 91.2, 78, 88.5, 82, 95, 70, null, 100][index],
  focus_feedback_count: [412, 230, 120, 64, 33, 12, 6, 0, 1][index],
  last_hosted_at: new Date(now - index * 86_400_000).toISOString(),
  next_session_id: index % 3 === 2 ? null : `s-${index}`,
  next_session_title: index % 3 === 2 ? null : ["Morning Deep Work", "Code Sprint 50/10", "", "Exam Prep Pomodoro", "Night Owls Focus", "Writers' Room"][index % 6] || null,
  next_session_start: index % 3 === 2 ? null : new Date(now + (index + 1) * 5 * 3_600_000).toISOString(),
}));
const members = Array.from({ length: 140 }, (_, index) => {
  const [full_name, country_code] = names[index % names.length];
  return {
    user_id: `member-${index}`,
    full_name: index < names.length ? full_name : `${full_name.split(" ")[0]} ${String.fromCharCode(65 + (index % 26))}.`,
    avatar_url: null,
    country_code: index % 5 === 4 ? null : country_code,
    sessions_count: Math.max(1, Math.round(420 / (1 + index * 0.35))),
    focus_hours: Math.max(0.4, Math.round((610 / (1 + index * 0.33)) * 10) / 10),
    last_seen_at: null,
  };
});

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const empty = params.get("empty") === "1";
  const respond = async (body: unknown) => {
    if (params.get("slow") === "1") await new Promise((resolve) => setTimeout(resolve, 60_000));
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  if (url.includes("/rpc/community_hosts")) return respond(empty ? [] : hosts);
  if (url.includes("/rpc/community_user_leaderboard")) return respond(empty ? [] : members);
  if (url.startsWith("http://127.0.0.1:9")) return new Response("{}", { status: 503 });
  return realFetch(input, init);
};

const [{ AuthProvider }, { CreateSessionModalProvider }, header, page] = await Promise.all([
  import("../../src/context/AuthContext"),
  import("../../src/context/CreateSessionModalContext"),
  import("../../src/components/Header"),
  params.get("page") === "leaderboard"
    ? import("../../src/pages/LeaderboardPage")
    : import("../../src/pages/HostsPage"),
]);
const Header = header.default as ComponentType;
const Page = page.default as ComponentType;

createRoot(document.getElementById("root")!).render(
  createElement(
    AuthProvider,
    null,
    createElement(
      MemoryRouter,
      null,
      createElement(CreateSessionModalProvider, null, createElement(Header), createElement(Page))
    )
  )
);
