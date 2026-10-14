import { createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "../../src/index.css";

// Dev-only preview of the Tasks sidebar with fixture tasks, to check the
// "Added …" line that appears on hover. Supabase points at a dead local port;
// the two task tables are answered here and everything else returns [].
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const plan = { id: "plan-1", user_id: "me", title: "My tasks", created_at: minutesAgo(60 * 24 * 40), updated_at: minutesAgo(5) };
const items = [
  ["Draft the Q4 roadmap intro", 25],
  ["Review Pramish's PR on room reconnects", 60 * 5],
  ["Reply to the hosting partnership email", 60 * 26],
  ["Outline the body doubling guide", 60 * 24 * 3],
  ["Clean up old focus plans", 60 * 24 * 20],
].map(([text, ago], index) => ({
  id: `item-${index}`,
  plan_id: plan.id,
  user_id: "me",
  text,
  session_id: index === 1 ? "s-future" : index === 2 ? "s-infinite" : null,
  completed: index >= 3,
  created_at: minutesAgo(ago as number),
  sort_order: index,
}));

const sessions = [
  { id: "s-infinite", title: "Deep Work Room", start_time: minutesAgo(60 * 24 * 30), duration_minutes: 60, session_format_type: "infinite", custom_slug: null, host_id: "me" },
  { id: "s-future", title: "Morning Deep Work", start_time: new Date(Date.now() + 18 * 3_600_000).toISOString(), duration_minutes: 60, session_format_type: "group", custom_slug: null, host_id: "me" },
];

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  if (url.includes("/rest/v1/focus_plans")) return json([plan]);
  if (url.includes("/rest/v1/focus_plan_items")) return json(items);
  if (url.includes("/rest/v1/sessions")) return json(sessions);
  if (url.startsWith("http://127.0.0.1:9")) return json([]);
  return realFetch(input, init);
};

const { default: SessionsTasksSidebar } = await import("../../src/components/SessionsTasksSidebar");
const Sidebar = SessionsTasksSidebar as ComponentType<{ open: boolean; userId: string; onClose: () => void }>;

createRoot(document.getElementById("root")!).render(
  createElement(MemoryRouter, null, createElement(Sidebar, { open: true, userId: "me", onClose: () => {} }))
);
