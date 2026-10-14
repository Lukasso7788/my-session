import { createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "../../src/index.css";

// Dev-only preview of the in-room task panel with fixture tasks, to check the
// "Added …" line on hover. Supabase points at a dead local port; the task
// tables are answered here and everything else returns [].
const SESSION_ID = "6f1c2a7e-3b9d-4c1e-9a5f-2d8b7e4c1a90";
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const mine = [
  ["Write the intro for the roadmap", 12],
  ["Fix the reconnect toast copy", 60 * 3],
  ["Reply to Anna about Thursday", 60 * 27],
  ["Outline the hosts page copy", 60 * 24 * 3],
].map(([text, ago], index) => ({
  id: `0000000${index}-aaaa-4aaa-8aaa-00000000000${index}`,
  user_id: "me",
  text,
  focus_plan_item_id: null,
  completed: index === 3,
  created_at: minutesAgo(ago as number),
  updated_at: minutesAgo(ago as number),
  visibility: index === 0 ? "public" : "private",
  sort_order: index,
}));
const team = [
  ["Finish chapter 3 notes", "Maya Chen", 40],
  ["Ship the pricing page fix", "Jonas Weber", 60 * 2],
].map(([text, name, ago], index) => ({
  id: `t-${index}`,
  text,
  user_id: `u-${index}`,
  session_id: SESSION_ID,
  created_at: minutesAgo(ago as number),
  completed: false,
  profiles: { full_name: name, avatar_url: null },
}));

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
  // .single()/.maybeSingle() ask for one object instead of an array.
  const wantsObject = (headers.get("Accept") || "").includes("vnd.pgrst.object");
  const json = (body: unknown) => {
    const value = wantsObject && Array.isArray(body) ? body[0] ?? null : body;
    return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  if (url.includes("/rest/v1/panel_intentions")) return json(mine);
  if (url.includes("/rest/v1/intentions")) return json(team);
  if (url.includes("/rest/v1/sessions")) return json([{ id: SESSION_ID, custom_slug: null, title: "Deep Work" }]);
  if (url.startsWith("http://127.0.0.1:9")) return json([]);
  return realFetch(input, init);
};

const { default: TasksPanel } = await import("../../src/components/TasksPanel");
const Panel = TasksPanel as ComponentType<{ sessionId: string; currentUserId: string; theme: "light" | "dark" }>;

createRoot(document.getElementById("root")!).render(
  createElement(
    MemoryRouter,
    null,
    createElement(
      "div",
      { style: { width: 380, height: "100vh", margin: "0 auto", background: "#F3F1F1" } },
      createElement(Panel, { sessionId: SESSION_ID, currentUserId: "me", theme: "light" })
    )
  )
);
