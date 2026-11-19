export function publicDesktopAuthConfig(env) {
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  let publicKey = anonKey?.startsWith("sb_publishable_");
  try {
    publicKey ||= JSON.parse(Buffer.from(anonKey?.split(".")[1] || "", "base64url").toString()).role === "anon";
  } catch { /* Never publish unknown/server keys. */ }
  return url === "https://cxqgzcjsjyszcbcbdusp.supabase.co" && publicKey
    ? { url, anonKey } : { error: "Desktop sign-in is not configured." };
}
