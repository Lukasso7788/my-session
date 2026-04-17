import { supabase } from "./supabase";

export type WeeklyUsageRow = {
  id: string;
  user_id: string;
  week_start: string;
  sessions_count: number;
  minutes_total: number;
  created_at: string;
  updated_at: string;
};

export function getWeekStartDate(input = new Date()): string {
  const d = new Date(input);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ...
  const diffFromMonday = day === 0 ? 6 : day - 1;

  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - diffFromMonday);

  return d.toISOString().slice(0, 10);
}

export async function getWeeklyUsage(userId: string, weekStart = getWeekStartDate()) {
  const { data, error } = await supabase
    .from("user_weekly_usage")
    .select("*")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();

  if (error) throw error;

  return (data as WeeklyUsageRow | null) ?? null;
}

export async function ensureWeeklyUsageRow(userId: string, weekStart = getWeekStartDate()) {
  const existing = await getWeeklyUsage(userId, weekStart);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("user_weekly_usage")
    .insert({
      user_id: userId,
      week_start: weekStart,
      sessions_count: 0,
      minutes_total: 0,
    })
    .select("*")
    .single();

  if (error) throw error;

  return data as WeeklyUsageRow;
}

export async function incrementWeeklyUsage(args: {
  userId: string;
  addSessions?: number;
  addMinutes?: number;
  weekStart?: string;
}) {
  const userId = String(args.userId || "").trim();
  if (!userId) throw new Error("userId is required");

  const addSessions = Math.max(0, Number(args.addSessions || 0));
  const addMinutes = Math.max(0, Number(args.addMinutes || 0));
  const weekStart = args.weekStart || getWeekStartDate();

  const current = await ensureWeeklyUsageRow(userId, weekStart);

  const nextSessions = Math.max(0, Number(current.sessions_count || 0) + addSessions);
  const nextMinutes = Math.max(0, Number(current.minutes_total || 0) + addMinutes);

  const { data, error } = await supabase
    .from("user_weekly_usage")
    .update({
      sessions_count: nextSessions,
      minutes_total: nextMinutes,
    })
    .eq("id", current.id)
    .select("*")
    .single();

  if (error) throw error;

  return data as WeeklyUsageRow;
}