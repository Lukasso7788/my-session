import { useState, useEffect, useMemo } from "react";
import { X } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { SessionTemplate } from "../types/session";
import { useAuth } from "../context/AuthContext";

interface CreateSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionCreated: () => void;
}

// ===============================
// JITSI REGIONAL DOMAINS
// ===============================
const JITSI_DOMAINS = [
  { value: "meet-eu.mysession.club", label: "EU (Europe)" },
  { value: "meet-us-east.mysession.club", label: "US East" },
  { value: "meet-apac.mysession.club", label: "APAC (Asia-Pacific)" },
] as const;

type JitsiDomain = (typeof JITSI_DOMAINS)[number]["value"];

function guessJitsiDomainByTimezone(): { domain: JitsiDomain; reason: string } {
  // Best-effort. Надёжнее делать это на сервере по IP,
  // но для MVP это ок.
  let tz = "";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    tz = "";
  }

  const t = tz.toLowerCase();

  // US / Americas
  if (t.startsWith("america/")) {
    return { domain: "meet-us-east.mysession.club", reason: `timezone=${tz}` };
  }

  // APAC
  if (
    t.startsWith("asia/") ||
    t.startsWith("australia/") ||
    t.startsWith("pacific/")
  ) {
    return { domain: "meet-apac.mysession.club", reason: `timezone=${tz}` };
  }

  // Default: EU
  return { domain: "meet-eu.mysession.club", reason: tz ? `timezone=${tz}` : "timezone=unknown" };
}

function nowLocalForDatetimeInput(): string {
  // input[type=datetime-local] expects LOCAL time string "YYYY-MM-DDTHH:mm"
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function CreateSessionModal({
  isOpen,
  onClose,
  onSessionCreated,
}: CreateSessionModalProps) {
  const { user, profile, loading } = useAuth();

  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---------- JITSI DOMAIN (AUTO + OPTIONAL MANUAL) ----------
  const autoGuess = useMemo(() => guessJitsiDomainByTimezone(), [isOpen]);
  const [useAutoDomain, setUseAutoDomain] = useState(true);
  const [manualDomain, setManualDomain] = useState<JitsiDomain>("meet-eu.mysession.club");

  // On open: reset auto/manual to sensible defaults
  useEffect(() => {
    if (!isOpen) return;
    setUseAutoDomain(true);
    setManualDomain(autoGuess.domain);
  }, [isOpen, autoGuess.domain]);

  const effectiveDomain: JitsiDomain = useAutoDomain ? autoGuess.domain : manualDomain;

  // ---------- LOAD TEMPLATES ----------
  useEffect(() => {
    if (!isOpen) return;

    async function loadTemplates() {
      setError(null);

      const { data, error } = await supabase
        .from("session_templates")
        .select("*")
        .order("total_duration", { ascending: true });

      if (error) {
        console.error("❌ Error loading templates:", error);
        setError("Failed to load templates.");
        return;
      }

      setTemplates(data || []);
    }

    loadTemplates();
  }, [isOpen]);

  // ---------- CREATE SESSION ----------
  const handleCreate = async () => {
    if (!title || !selectedTemplate || !scheduledAt) {
      setError("Please fill out all fields.");
      return;
    }

    if (!user || !profile?.id) {
      setError("You must be logged in to create a session.");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const scheduledISO = new Date(scheduledAt).toISOString();
      const template = templates.find((t) => t.id === selectedTemplate);

      // 1) Create Daily room via Supabase Edge Function (оставляю как есть)
      const { data: fnData, error: fnError } = await supabase.functions.invoke(
        "create-daily-room",
        { body: {} }
      );

      if (fnError || !fnData?.url) {
        console.error("❌ Daily room creation failed:", fnData, fnError);
        throw new Error("Failed to create Daily room");
      }

      const dailyUrl = fnData.url as string;

      // 2) Insert session into "sessions"
      const { error } = await supabase.from("sessions").insert([
        {
          title,
          host_id: profile.id,
          host_name: profile.full_name,
          template_id: selectedTemplate,
          start_time: scheduledISO,
          duration_minutes: template?.total_duration ?? 60,
          format: template?.name || "Unspecified",
          schedule: template?.blocks || [],
          daily_room_url: dailyUrl,
          status: "planned",
          created_at: new Date().toISOString(),

          // ✅ IMPORTANT: all participants must join same Jitsi domain for the room
          jitsi_domain: effectiveDomain,
        },
      ]);

      if (error) throw error;

      setTitle("");
      setScheduledAt("");
      setSelectedTemplate("");

      onSessionCreated();
      onClose();
    } catch (err: any) {
      console.error("❌ Error creating session:", err);
      setError(err.message || "Failed to create session");
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  const hostName = profile?.full_name || user?.email || "Unknown host";
  const minDateTime = nowLocalForDatetimeInput();

  const effectiveDomainLabel =
    JITSI_DOMAINS.find((d) => d.value === effectiveDomain)?.label || effectiveDomain;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-[16px] p-6 w-full max-w-md shadow-xl">
        {/* HEADER */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-[20px] font-bold text-brandBlack font-inter">
            Create focus session
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 transition"
          >
            <X size={22} />
          </button>
        </div>

        {loading || !user ? (
          <p className="text-sm text-gray-500 mb-4">
            {loading
              ? "Checking your account..."
              : "You must be logged in to create a session."}
          </p>
        ) : (
          <div className="space-y-5">
            {/* Title */}
            <div>
              <label className="block text-[14px] font-medium text-brandBlack mb-1 font-inter">
                Session title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Deep Work Session"
                className="w-full px-3 py-3 border border-gray-300 rounded-[16px] font-inter"
              />
            </div>

            {/* Start Time */}
            <div>
              <label className="block text-[14px] font-medium text-brandBlack mb-1 font-inter">
                Start time
              </label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                min={minDateTime}
                className="w-full px-3 py-3 border border-gray-300 rounded-[16px] font-inter"
              />
            </div>

            {/* JITSI REGION (AUTO by default, dropdown only if host wants) */}
            <div>
              <label className="block text-[14px] font-medium text-brandBlack mb-2 font-inter">
                Video server region
              </label>

              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={useAutoDomain}
                    onChange={(e) => setUseAutoDomain(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-[14px] text-brandBlack font-inter">
                    Auto (recommended)
                  </span>
                </label>

                <span className="text-[12px] text-gray-500 font-inter">
                  {useAutoDomain ? `Picked: ${effectiveDomainLabel}` : `Manual: ${effectiveDomainLabel}`}
                </span>
              </div>

              {!useAutoDomain && (
                <select
                  value={manualDomain}
                  onChange={(e) => setManualDomain(e.target.value as JitsiDomain)}
                  className="mt-3 w-full px-3 py-3 border border-gray-300 rounded-[16px] font-inter bg-white"
                >
                  {JITSI_DOMAINS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label} — {d.value}
                    </option>
                  ))}
                </select>
              )}

              <p className="mt-2 text-[12px] text-gray-500 font-inter">
                All participants will join the same Jitsi domain saved in the session.
              </p>
            </div>

            {/* Templates */}
            <div>
              <label className="block text-[14px] font-medium text-brandBlack mb-2 font-inter">
                Session format
              </label>

              <div className="max-h-48 overflow-y-auto pr-2 space-y-3">
                {templates.length > 0 ? (
                  templates.map((t) => (
                    <label
                      key={t.id}
                      className="flex items-center gap-3 cursor-pointer"
                      onClick={() => {
                        setSelectedTemplate(t.id);
                        if (!title) setTitle(t.name);
                      }}
                    >
                      <input
                        type="radio"
                        name="session-template"
                        value={t.id}
                        checked={selectedTemplate === t.id}
                        onChange={() => { }}
                        className="w-4 h-4 text-brandBlack"
                      />

                      <img
                        src={`/icons/${t.icon || t.name.toLowerCase()}.svg`}
                        className="w-4 h-4"
                      />

                      <span className="text-[16px] text-brandBlack font-inter">
                        {t.name} ({t.total_duration} min)
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="text-sm text-gray-500">Loading templates...</p>
                )}
              </div>
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}

            <button
              onClick={handleCreate}
              disabled={!title || !selectedTemplate || !scheduledAt || isCreating}
              className="w-full bg-brandBlack text-white py-3 rounded-[42px] font-medium text-[15px] font-inter hover:bg-black disabled:bg-gray-300 transition"
            >
              {isCreating ? "Creating..." : "Create session"}
            </button>
          </div>
        )}

        {user && (
          <p className="text-xs text-gray-400 mt-4 text-center font-inter">
            Hosted by <span className="font-medium">{hostName}</span>
          </p>
        )}
      </div>
    </div>
  );
}
