// Runs before profile-page-auth: the people in the host guide walkthrough and
// an (initially empty) room chat. The walkthrough swaps the chat rows per scene.
export const GUIDE_SESSION_ID = "6f1c2a7e-3b9d-4c1e-9a5f-2d8b7e4c1a90";
export const GUIDE_ME = "00000000-0000-4000-8000-000000000001";

// Portraits are placeholder stock photos (randomuser.me) for the local concept;
// a published guide needs licensed photos or real members who agreed to it.
// Their spoken lines are recorded with host-guide-tts.mjs (OpenAI TTS).
export const GUIDE_PEOPLE = [
  { id: GUIDE_ME, name: "Anna", tz: "Europe/Berlin", task: "Finish the onboarding email", avatar: "https://randomuser.me/api/portraits/women/44.jpg", voice: "female" },
  { id: "11111111-1111-4111-8111-111111111111", name: "Maya", tz: "Europe/Kyiv", task: "Draft the Q4 roadmap intro", avatar: "https://randomuser.me/api/portraits/women/68.jpg", voice: "female" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Alex", tz: "America/New_York", task: "Outline the body doubling guide", avatar: "https://randomuser.me/api/portraits/men/32.jpg", voice: "male" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Jo", tz: "Asia/Kolkata", task: "Send the client deck", status: "skip", avatar: "https://randomuser.me/api/portraits/men/75.jpg", voice: "male" },
];

const tables = (globalThis as any).__harnessTables || ((globalThis as any).__harnessTables = {});
tables.profiles = GUIDE_PEOPLE.map((p) => ({ id: p.id, full_name: p.name, avatar_url: p.avatar, timezone: p.tz }));
// ?as=Name[&avatar=url]: preview the guide as another signed-in visitor (they play the host).
const params = new URLSearchParams(location.search);
if (params.get("as")) Object.assign(tables.profiles[0], { full_name: params.get("as"), avatar_url: params.get("avatar") || null });
tables.session_chat_messages = [];
tables.session_chat_reactions = [];
(globalThis as any).__harnessRpc = { ...((globalThis as any).__harnessRpc || {}) };
