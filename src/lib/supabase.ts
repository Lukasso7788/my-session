// src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  console.error("❌ Missing VITE_SUPABASE_URL");
}
if (!supabaseAnonKey) {
  console.error("❌ Missing VITE_SUPABASE_ANON_KEY");
}

export const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
  auth: {
    persistSession: true,          // хранить сессию в localStorage
    autoRefreshToken: true,        // автообновление токенов
    detectSessionInUrl: true,      // ВАЖНО для OAuth
    storageKey: "mysession-auth",  // свой ключ, чтобы не конфликтовать
  },
});

// debug
if (typeof window !== "undefined") {
  // @ts-ignore
  window.supabase = supabase;
  // небольшая отладка в консоли
  supabase.auth.getSession().then(({ data }) => {
    console.log("🔎 initial session from supabase.ts:", data);
  });
}
