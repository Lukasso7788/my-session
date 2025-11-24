import { createClient } from '@supabase/supabase-js';

// Используем безопасное чтение переменных (без !), чтобы сборка не падала, если переменные не подтянулись
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''; // Вернул _KEY как в твоем исходнике

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // ЭТО ВАЖНО: Supabase сам парсит URL
    storage: localStorage,
    storageKey: "mysession-auth",
  }
});

// Хелпер для дебага в консоли браузера (оставил из твоего кода)
if (typeof window !== "undefined") {
  // @ts-ignore
  window.supabase = supabase;
}