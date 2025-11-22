import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl) console.error("❌ Missing VITE_SUPABASE_URL");
if (!supabaseAnonKey) console.error("❌ Missing VITE_SUPABASE_ANON_KEY");

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // ❗ УДАЛЯЕМ storageKey! Пусть Supabase сам хранит session в cookie
  },
  global: {
    headers: {
      "x-client-info": "mysession-client",
    },
  },
});

// Debug
if (typeof window !== "undefined") {
  // @ts-ignore
  window.supabase = supabase;
}
