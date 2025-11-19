// src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

// ---- Load env ----
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  console.error("❌ Missing VITE_SUPABASE_URL");
}

if (!supabaseAnonKey) {
  console.error("❌ Missing VITE_SUPABASE_ANON_KEY");
}

// ---- Create client ----
export const supabase = createClient(supabaseUrl!, supabaseAnonKey!);

// ---- Debug: expose in browser ----
if (typeof window !== "undefined") {
  // @ts-ignore
  window.supabase = supabase;
}
