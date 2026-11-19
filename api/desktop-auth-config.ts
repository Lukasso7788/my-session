import type { VercelRequest, VercelResponse } from "@vercel/node";

// These are the same PUBLIC values shipped to every website visitor. Never
// substitute a service-role/server key here.
export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).end();
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  let publicKey = anonKey?.startsWith("sb_publishable_");
  try {
    publicKey ||= JSON.parse(Buffer.from(anonKey?.split(".")[1] || "", "base64url").toString()).role === "anon";
  } catch { /* invalid configuration */ }
  if (url !== "https://cxqgzcjsjyszcbcbdusp.supabase.co" || !publicKey) {
    return res.status(503).json({ error: "Desktop sign-in is not configured." });
  }
  return res.status(200).json({ url, anonKey });
}
