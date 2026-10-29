// The people in the /host-guide walkthrough. The first one is the host and is
// replaced by the signed-in visitor (see visitor.ts). The others are fictional
// and show initials until licensed stock photos are added under
// public/host-guide/people/ (set `avatar` to that path).
// Their spoken lines are AI voices recorded with scripts/host-guide-tts.mjs.
export const GUIDE_SESSION_ID = "6f1c2a7e-3b9d-4c1e-9a5f-2d8b7e4c1a90";
export const GUIDE_ME = "00000000-0000-4000-8000-000000000001";

export type GuidePerson = {
  id: string;
  name: string;
  tz: string;
  task: string;
  avatar: string;
  voice: "female" | "male";
  status?: string;
};

export const GUIDE_PEOPLE: GuidePerson[] = [
  { id: GUIDE_ME, name: "Anna", tz: "Europe/Berlin", task: "Finish the onboarding email", avatar: "", voice: "female" },
  { id: "11111111-1111-4111-8111-111111111111", name: "Maya", tz: "Europe/Kyiv", task: "Draft the Q4 roadmap intro", avatar: "", voice: "female" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Alex", tz: "America/New_York", task: "Outline the body doubling guide", avatar: "", voice: "male" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Jo", tz: "Asia/Kolkata", task: "Send the client deck", status: "skip", avatar: "", voice: "male" },
];
