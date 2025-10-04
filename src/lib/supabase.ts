import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Session {
  id: string;
  title: string;
  host: string;
  duration_minutes: number;
  format: 'uninterrupted' | 'pomodoro_25_5' | 'pomodoro_15_3';
  focus_blocks: FocusBlock[];
  daily_room_url: string | null;
  participant_count: number;
  scheduled_at: string;
  created_at: string;
  status: 'scheduled' | 'active' | 'completed';
}

export interface FocusBlock {
  type: 'focus' | 'break';
  duration_minutes: number;
  start_offset_minutes: number;
}
