import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

type Preferences = {
  lifecycle_email_enabled: boolean;
  marketing_email_enabled: boolean;
  weekly_recap_enabled: boolean;
  session_reminders_enabled: boolean;
  reactivation_email_enabled: boolean;
  timezone: string;
};

const defaults: Preferences = {
  lifecycle_email_enabled: true,
  marketing_email_enabled: false,
  weekly_recap_enabled: true,
  session_reminders_enabled: true,
  reactivation_email_enabled: true,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
};

const options: Array<{ key: keyof Preferences; title: string; description: string }> = [
  { key: "lifecycle_email_enabled", title: "Account and lifecycle emails", description: "Milestones, plan status, and important MySession account updates." },
  { key: "session_reminders_enabled", title: "Session reminders", description: "Booking confirmations, upcoming-session reminders, and gentle no-show recovery." },
  { key: "weekly_recap_enabled", title: "Weekly focus recap", description: "Your sessions, focused minutes, and progress from the previous week." },
  { key: "reactivation_email_enabled", title: "Reactivation emails", description: "Occasional suggestions after 7, 14, or 30 days away." },
  { key: "marketing_email_enabled", title: "Product and marketing emails", description: "Feature announcements, referral invitations, offers, and host opportunities. Off by default." },
];

export default function EmailPreferencesPage() {
  const navigate = useNavigate();
  const [value, setValue] = useState<Preferences>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function loadPreferences() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) throw new Error("Please sign in first.");
    const { data, error } = await supabase
      .from("email_automation_preferences")
      .select("lifecycle_email_enabled,marketing_email_enabled,weekly_recap_enabled,session_reminders_enabled,reactivation_email_enabled,timezone")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (error) throw error;
    return data as Preferences | null;
  }

  async function savePreferences(preferences: Preferences) {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) throw new Error("Please sign in first.");
    const { data, error } = await supabase
      .from("email_automation_preferences")
      .upsert(
        {
          user_id: authData.user.id,
          ...preferences,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select("lifecycle_email_enabled,marketing_email_enabled,weekly_recap_enabled,session_reminders_enabled,reactivation_email_enabled,timezone")
      .single();
    if (error) throw error;
    return data as Preferences;
  }

  useEffect(() => {
    void loadPreferences()
      .then((preferences) => setValue({ ...defaults, ...(preferences || {}) }))
      .catch((error) => setMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const saved = await savePreferences(value);
      if (saved) setValue({ ...defaults, ...saved });
      setMessage("Email preferences saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-4 py-10 text-[#2F2F2F] sm:px-6">
      <div className="mx-auto max-w-3xl">
        <button onClick={() => navigate(-1)} className="text-sm text-black/60 hover:text-black">← Back</button>
        <div className="mt-5 rounded-[28px] border border-black/10 bg-white p-6 shadow-sm sm:p-8">
          <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#4AAE55]">Email settings</div>
          <h1 className="mt-2 text-3xl font-bold">Choose what reaches your inbox</h1>
          <p className="mt-2 text-sm leading-6 text-black/60">These controls apply to MySession lifecycle and marketing automation in Sender. Authentication and security emails remain enabled.</p>
          {loading ? <div className="mt-8 text-sm text-black/50">Loading preferences…</div> : (
            <div className="mt-8 space-y-3">
              {options.map((option) => (
                <label key={option.key} className="flex cursor-pointer items-start justify-between gap-5 rounded-2xl border border-black/10 p-4 hover:bg-black/[0.02]">
                  <span><span className="block text-[15px] font-semibold">{option.title}</span><span className="mt-1 block text-[13px] leading-5 text-black/55">{option.description}</span></span>
                  <input type="checkbox" className="mt-1 h-5 w-5 accent-[#57C964]" checked={Boolean(value[option.key])} onChange={(event) => setValue((current) => ({ ...current, [option.key]: event.target.checked }))} />
                </label>
              ))}
              <label className="block rounded-2xl border border-black/10 p-4">
                <span className="text-[15px] font-semibold">Timezone</span>
                <p className="mt-1 text-[13px] text-black/55">Used to schedule reminders and recaps at useful local times.</p>
                <input value={value.timezone} onChange={(event) => setValue((current) => ({ ...current, timezone: event.target.value }))} className="mt-3 w-full rounded-xl border border-black/10 px-4 py-3 text-sm outline-none focus:border-[#57C964]" />
              </label>
            </div>
          )}
          {message ? <p className="mt-4 text-sm text-black/65">{message}</p> : null}
          <div className="mt-6 flex justify-end"><button onClick={() => void save()} disabled={loading || saving} className="rounded-full bg-[#2F2F2F] px-6 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save preferences"}</button></div>
        </div>
      </div>
    </main>
  );
}
