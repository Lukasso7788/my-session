// src/components/CreateSessionModal.tsx
import { useState, useEffect, useMemo } from "react";
import { X, Plus, Trash2, ChevronUp, ChevronDown, Layers, Wand2 } from "lucide-react";
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
  let tz = "";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    tz = "";
  }

  const t = tz.toLowerCase();

  if (t.startsWith("america/")) {
    return { domain: "meet-us-east.mysession.club", reason: `timezone=${tz}` };
  }

  if (t.startsWith("asia/") || t.startsWith("australia/") || t.startsWith("pacific/")) {
    return { domain: "meet-apac.mysession.club", reason: `timezone=${tz}` };
  }

  return {
    domain: "meet-eu.mysession.club",
    reason: tz ? `timezone=${tz}` : "timezone=unknown",
  };
}

function nowLocalForDatetimeInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function makeId() {
  // best effort for older browsers too
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = typeof crypto !== "undefined" ? crypto : null;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function clampMinutes(n: number) {
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(8 * 60, Math.round(n)));
}

// ===============================
// Session Studio (custom schedule)
// ===============================
type StudioBlockType =
  | "welcome"
  | "intentions"
  | "focus"
  | "break"
  | "checkin"
  | "recap"
  | "celebrate"
  | "custom";

type StudioBlock = {
  id: string;
  type: StudioBlockType;
  title: string;
  minutes: number;
};

const STUDIO_LIBRARY: Array<{
  type: StudioBlockType;
  title: string;
  desc: string;
  defaultMinutes: number;
}> = [
    { type: "welcome", title: "Welcome", desc: "Quick intro / rules / vibe", defaultMinutes: 3 },
    { type: "intentions", title: "Intentions", desc: "Say what you’ll finish", defaultMinutes: 5 },
    { type: "focus", title: "Focus", desc: "Deep work block", defaultMinutes: 50 },
    { type: "break", title: "Break", desc: "Recharge / stretch", defaultMinutes: 10 },
    { type: "checkin", title: "Check-in", desc: "Short accountability checkpoint", defaultMinutes: 3 },
    { type: "recap", title: "Recap", desc: "What got done / what’s next", defaultMinutes: 5 },
    { type: "celebrate", title: "Celebrate", desc: "Closure + positive finish", defaultMinutes: 3 },
    { type: "custom", title: "Custom", desc: "Any special block", defaultMinutes: 5 },
  ];

// Try to adapt template.blocks (unknown schema) -> StudioBlock[]
function toStudioBlocks(rawBlocks: any): StudioBlock[] {
  if (!rawBlocks) return [];

  let blocks = rawBlocks;

  if (typeof rawBlocks === "string") {
    try {
      blocks = JSON.parse(rawBlocks);
    } catch {
      blocks = [];
    }
  }

  if (!Array.isArray(blocks)) return [];

  const getTitle = (b: any) =>
    String(b?.title ?? b?.label ?? b?.name ?? b?.activity ?? b?.text ?? "").trim();

  const getType = (b: any): StudioBlockType => {
    const t = String(b?.type ?? b?.block_type ?? b?.category ?? b?.kind ?? "").toLowerCase();

    if (t.includes("welcome")) return "welcome";
    if (t.includes("intention")) return "intentions";
    if (t.includes("focus") || t.includes("deep")) return "focus";
    if (t.includes("break") || t.includes("recharge")) return "break";
    if (t.includes("check")) return "checkin";
    if (t.includes("recap")) return "recap";
    if (t.includes("celebrate") || t.includes("farewell") || t.includes("social")) return "celebrate";

    // fallback: guess from title
    const title = getTitle(b).toLowerCase();
    if (title.includes("welcome")) return "welcome";
    if (title.includes("intention")) return "intentions";
    if (title.includes("focus") || title.includes("deep")) return "focus";
    if (title.includes("break") || title.includes("recharge")) return "break";
    if (title.includes("check")) return "checkin";
    if (title.includes("recap")) return "recap";
    if (title.includes("celebrate") || title.includes("farewell")) return "celebrate";

    return "custom";
  };

  const getMinutes = (b: any) => {
    const v =
      b?.minutes ??
      b?.duration ??
      b?.duration_minutes ??
      b?.length ??
      b?.mins ??
      b?.time ??
      0;
    const n = Number(v);
    return clampMinutes(n || 5);
  };

  return blocks.map((b: any) => {
    const type = getType(b);
    const title = getTitle(b) || STUDIO_LIBRARY.find((x) => x.type === type)?.title || "Block";
    const minutes = getMinutes(b);
    return { id: makeId(), type, title, minutes };
  });
}

// Studio blocks -> schedule payload to store in sessions.schedule
function studioToSchedule(blocks: StudioBlock[]) {
  // Store both minutes + duration to maximize compatibility.
  return blocks.map((b) => ({
    kind: "block",
    type: b.type,
    title: b.title,
    label: b.title,
    minutes: b.minutes,
    duration: b.minutes,
  }));
}

function studioTotalMinutes(blocks: StudioBlock[]) {
  return blocks.reduce((sum, b) => sum + (Number(b.minutes) || 0), 0);
}

export function CreateSessionModal({ isOpen, onClose, onSessionCreated }: CreateSessionModalProps) {
  const { user, profile, loading } = useAuth();

  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---------- Session Studio ----------
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioEnabled, setStudioEnabled] = useState(false);
  const [studioBlocks, setStudioBlocks] = useState<StudioBlock[]>([]);

  const totalStudioMinutes = useMemo(() => studioTotalMinutes(studioBlocks), [studioBlocks]);

  // ---------- JITSI DOMAIN (AUTO + OPTIONAL MANUAL) ----------
  const autoGuess = useMemo(() => guessJitsiDomainByTimezone(), [isOpen]);
  const [useAutoDomain, setUseAutoDomain] = useState(true);
  const [manualDomain, setManualDomain] = useState<JitsiDomain>("meet-eu.mysession.club");

  useEffect(() => {
    if (!isOpen) return;
    setUseAutoDomain(true);
    setManualDomain(autoGuess.domain);
  }, [isOpen, autoGuess.domain]);

  const effectiveDomain: JitsiDomain = useAutoDomain ? autoGuess.domain : manualDomain;

  // ---------- RESET ON OPEN ----------
  useEffect(() => {
    if (!isOpen) return;
    setTitle("");
    setScheduledAt("");
    setSelectedTemplate("");
    setError(null);

    setStudioOpen(false);
    setStudioEnabled(false);
    setStudioBlocks([]);
  }, [isOpen]);

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

  const selectedTemplateObj = useMemo(
    () => templates.find((t) => t.id === selectedTemplate),
    [templates, selectedTemplate]
  );

  const importFromTemplate = () => {
    const t = selectedTemplateObj;
    const imported = toStudioBlocks((t as any)?.blocks || []);
    if (!imported.length) {
      // fallback default script if template empty
      setStudioBlocks([
        { id: makeId(), type: "welcome", title: "Welcome", minutes: 3 },
        { id: makeId(), type: "intentions", title: "Intentions", minutes: 5 },
        { id: makeId(), type: "focus", title: "Focus", minutes: 50 },
        { id: makeId(), type: "break", title: "Break", minutes: 10 },
        { id: makeId(), type: "focus", title: "Focus", minutes: 50 },
        { id: makeId(), type: "recap", title: "Recap", minutes: 5 },
        { id: makeId(), type: "celebrate", title: "Celebrate & Farewell", minutes: 3 },
      ]);
      return;
    }
    setStudioBlocks(imported);
  };

  const resetStudioToDefault = () => {
    setStudioBlocks([
      { id: makeId(), type: "welcome", title: "Welcome", minutes: 3 },
      { id: makeId(), type: "intentions", title: "Intentions", minutes: 5 },
      { id: makeId(), type: "focus", title: "Deep Work", minutes: 50 },
      { id: makeId(), type: "break", title: "Break", minutes: 10 },
      { id: makeId(), type: "focus", title: "Deep Work", minutes: 50 },
      { id: makeId(), type: "recap", title: "Recap", minutes: 5 },
      { id: makeId(), type: "celebrate", title: "Celebrate & Farewell", minutes: 3 },
    ]);
  };

  const addStudioBlock = (type: StudioBlockType) => {
    const meta = STUDIO_LIBRARY.find((x) => x.type === type);
    const title = meta?.title || "Block";
    const minutes = meta?.defaultMinutes || 5;
    setStudioBlocks((prev) => [...prev, { id: makeId(), type, title, minutes }]);
  };

  const moveBlock = (id: string, dir: -1 | 1) => {
    setStudioBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx < 0) return prev;
      const nextIdx = idx + dir;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const copy = [...prev];
      const tmp = copy[idx];
      copy[idx] = copy[nextIdx];
      copy[nextIdx] = tmp;
      return copy;
    });
  };

  const updateBlock = (id: string, patch: Partial<StudioBlock>) => {
    setStudioBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const removeBlock = (id: string) => {
    setStudioBlocks((prev) => prev.filter((b) => b.id !== id));
  };

  // When user enables studio for first time: auto-import from selected template (if any)
  useEffect(() => {
    if (!studioEnabled) return;
    if (studioBlocks.length) return;

    // if we have selected template, import it; else use default
    if (selectedTemplateObj) importFromTemplate();
    else resetStudioToDefault();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioEnabled]);

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

    if (studioEnabled && studioBlocks.length === 0) {
      setError("Session Studio: please add at least one block.");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const scheduledISO = new Date(scheduledAt).toISOString();
      const template = selectedTemplateObj;

      // 1) Create Daily room via Supabase Edge Function
      const { data: fnData, error: fnError } = await supabase.functions.invoke("create-daily-room", {
        body: {},
      });

      if (fnError || !fnData?.url) {
        console.error("❌ Daily room creation failed:", fnData, fnError);
        throw new Error("Failed to create Daily room");
      }

      const dailyUrl = fnData.url as string;

      // 2) schedule + duration
      const scheduleToSave = studioEnabled
        ? studioToSchedule(studioBlocks)
        : ((template as any)?.blocks || []);

      const durationToSave = studioEnabled
        ? totalStudioMinutes || 60
        : (template?.total_duration ?? 60);

      const formatToSave = studioEnabled ? "Session Studio" : (template?.name || "Unspecified");

      // 3) Insert session into "sessions"
      const { error } = await supabase.from("sessions").insert([
        {
          title,
          host_id: profile.id,
          host_name: profile.full_name,
          template_id: selectedTemplate,
          start_time: scheduledISO,
          duration_minutes: durationToSave,
          format: formatToSave,
          schedule: scheduleToSave,
          daily_room_url: dailyUrl,
          status: "planned",
          created_at: new Date().toISOString(),

          // all participants must join same Jitsi domain
          jitsi_domain: effectiveDomain,
        },
      ]);

      if (error) throw error;

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

  const modalWidthClass = studioOpen ? "max-w-3xl" : "max-w-md";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        className={`bg-white rounded-[16px] p-6 w-full ${modalWidthClass} shadow-xl max-h-[86vh] overflow-y-auto`}
      >
        {/* HEADER */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-[20px] font-bold text-brandBlack font-inter">
            Create focus session
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 transition">
            <X size={22} />
          </button>
        </div>

        {loading || !user ? (
          <p className="text-sm text-gray-500 mb-4">
            {loading ? "Checking your account..." : "You must be logged in to create a session."}
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

            {/* JITSI REGION */}
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

                      <img src={`/icons/${t.icon || t.name.toLowerCase()}.svg`} className="w-4 h-4" />

                      <span className="text-[16px] text-brandBlack font-inter">
                        {t.name} ({t.total_duration} min)
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="text-sm text-gray-500">Loading templates...</p>
                )}
              </div>

              {/* Session Studio trigger */}
              <div className="mt-4 border border-[#DBD8D8] rounded-[16px] p-4 bg-[#FAFAFA]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-[14px] bg-[#111827] text-white flex items-center justify-center">
                        <Layers size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[14px] font-semibold text-brandBlack font-inter">
                          Session Studio
                        </div>
                        <div className="text-[12px] text-gray-600 font-inter">
                          Build a custom session script (different UI than FlowN).
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={studioEnabled}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setStudioEnabled(v);
                            setStudioOpen(v ? true : false);
                            if (!v) setError(null);
                          }}
                          className="w-4 h-4"
                        />
                        <span className="text-[13px] text-brandBlack font-inter">
                          Use Session Studio for this session
                        </span>
                      </label>

                      {studioEnabled && (
                        <span className="text-[12px] text-gray-500 font-inter">
                          Length: <span className="font-medium text-brandBlack">{totalStudioMinutes} min</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setStudioOpen((p) => !p)}
                    className={`shrink-0 px-3 py-2 rounded-[14px] border font-inter text-[13px] transition ${studioOpen ? "bg-[#111827] text-white border-[#111827]" : "bg-white text-brandBlack border-[#DBD8D8]"
                      }`}
                    disabled={!studioEnabled}
                    title={!studioEnabled ? "Enable Session Studio first" : "Toggle Studio"}
                  >
                    {studioOpen ? "Close" : "Open"}
                  </button>
                </div>

                {studioEnabled && studioOpen && (
                  <div className="mt-4">
                    {/* top controls */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-[12px] text-gray-600 font-inter">
                        Script saved into <span className="font-medium text-brandBlack">sessions.schedule</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => importFromTemplate()}
                          className="px-3 py-2 rounded-[14px] border border-[#DBD8D8] bg-white text-[13px] font-inter hover:bg-[#F4F4F4] transition inline-flex items-center gap-2"
                          disabled={!selectedTemplateObj}
                          title={!selectedTemplateObj ? "Pick a template first" : "Import blocks from selected template"}
                        >
                          <Wand2 size={16} />
                          Import from format
                        </button>

                        <button
                          type="button"
                          onClick={() => resetStudioToDefault()}
                          className="px-3 py-2 rounded-[14px] border border-[#DBD8D8] bg-white text-[13px] font-inter hover:bg-[#F4F4F4] transition"
                        >
                          Reset default
                        </button>

                        <button
                          type="button"
                          onClick={() => setStudioBlocks([])}
                          className="px-3 py-2 rounded-[14px] border border-[#DBD8D8] bg-white text-[13px] font-inter hover:bg-[#F4F4F4] transition"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    {/* studio layout (NOT a table) */}
                    <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Library */}
                      <div className="border border-[#DBD8D8] rounded-[16px] bg-white p-4">
                        <div className="text-[13px] font-semibold text-brandBlack font-inter">
                          Block Library
                        </div>
                        <div className="mt-1 text-[12px] text-gray-500 font-inter">
                          Add blocks to the script (cards, not rows).
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-2">
                          {STUDIO_LIBRARY.map((b) => (
                            <button
                              key={b.type}
                              type="button"
                              onClick={() => addStudioBlock(b.type)}
                              className="text-left border border-[#DBD8D8] rounded-[14px] p-3 bg-[#FAFAFA] hover:bg-[#F2F2F2] transition"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-[13px] font-semibold text-brandBlack font-inter">
                                  {b.title}
                                </div>
                                <div className="text-[12px] text-gray-500 font-inter">
                                  {b.defaultMinutes}m
                                </div>
                              </div>
                              <div className="mt-1 text-[12px] text-gray-600 font-inter leading-snug">
                                {b.desc}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Canvas */}
                      <div className="border border-[#DBD8D8] rounded-[16px] bg-white p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[13px] font-semibold text-brandBlack font-inter">
                              Script
                            </div>
                            <div className="text-[12px] text-gray-500 font-inter">
                              Reorder with arrows. Edit titles & durations.
                            </div>
                          </div>

                          <div className="text-[12px] text-gray-600 font-inter">
                            Total:{" "}
                            <span className="font-semibold text-brandBlack">
                              {totalStudioMinutes} min
                            </span>
                          </div>
                        </div>

                        {studioBlocks.length === 0 ? (
                          <div className="mt-4 border border-dashed border-[#DBD8D8] rounded-[14px] p-4 text-center text-[13px] text-gray-500 font-inter">
                            No blocks yet. Add from the library.
                          </div>
                        ) : (
                          <div className="mt-4 space-y-3">
                            {studioBlocks.map((b, idx) => (
                              <div
                                key={b.id}
                                className="border border-[#EAEAEA] rounded-[16px] p-4 bg-[#FAFAFA]"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[11px] px-2 py-[2px] rounded-full border border-[#DBD8D8] bg-white text-gray-600 font-inter">
                                        {b.type}
                                      </span>
                                      <span className="text-[11px] text-gray-500 font-inter">
                                        Block {idx + 1}
                                      </span>
                                    </div>

                                    <input
                                      value={b.title}
                                      onChange={(e) => updateBlock(b.id, { title: e.target.value })}
                                      className="mt-2 w-full px-3 py-2 border border-[#DBD8D8] rounded-[12px] bg-white text-[13px] font-inter"
                                      placeholder="Block title"
                                    />
                                  </div>

                                  <div className="shrink-0 flex flex-col items-end gap-2">
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => updateBlock(b.id, { minutes: clampMinutes(b.minutes - 1) })}
                                        className="w-9 h-9 rounded-[12px] border border-[#DBD8D8] bg-white hover:bg-[#F2F2F2] transition text-brandBlack"
                                        title="-1 minute"
                                      >
                                        −
                                      </button>

                                      <input
                                        type="number"
                                        value={b.minutes}
                                        min={1}
                                        max={480}
                                        onChange={(e) => updateBlock(b.id, { minutes: clampMinutes(Number(e.target.value)) })}
                                        className="w-16 h-9 text-center rounded-[12px] border border-[#DBD8D8] bg-white text-[13px] font-inter"
                                      />

                                      <button
                                        type="button"
                                        onClick={() => updateBlock(b.id, { minutes: clampMinutes(b.minutes + 1) })}
                                        className="w-9 h-9 rounded-[12px] border border-[#DBD8D8] bg-white hover:bg-[#F2F2F2] transition text-brandBlack"
                                        title="+1 minute"
                                      >
                                        +
                                      </button>

                                      <span className="text-[12px] text-gray-500 font-inter">min</span>
                                    </div>

                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => moveBlock(b.id, -1)}
                                        disabled={idx === 0}
                                        className="w-9 h-9 rounded-[12px] border border-[#DBD8D8] bg-white hover:bg-[#F2F2F2] transition disabled:opacity-40"
                                        title="Move up"
                                      >
                                        <ChevronUp size={18} className="mx-auto" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => moveBlock(b.id, 1)}
                                        disabled={idx === studioBlocks.length - 1}
                                        className="w-9 h-9 rounded-[12px] border border-[#DBD8D8] bg-white hover:bg-[#F2F2F2] transition disabled:opacity-40"
                                        title="Move down"
                                      >
                                        <ChevronDown size={18} className="mx-auto" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => removeBlock(b.id)}
                                        className="w-9 h-9 rounded-[12px] border border-[#DBD8D8] bg-white hover:bg-[#F2F2F2] transition"
                                        title="Delete block"
                                      >
                                        <Trash2 size={18} className="mx-auto text-gray-700" />
                                      </button>
                                    </div>
                                  </div>
                                </div>

                                {/* quick durations */}
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {[3, 5, 10, 15, 25, 50].map((m) => (
                                    <button
                                      key={m}
                                      type="button"
                                      onClick={() => updateBlock(b.id, { minutes: m })}
                                      className="px-2 py-1 rounded-full border border-[#DBD8D8] bg-white text-[12px] font-inter hover:bg-[#F2F2F2] transition"
                                    >
                                      {m}m
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 text-[12px] text-gray-500 font-inter">
                      Tip: keep “FlowN-like table” out — we’re doing cards + library to be distinct.
                    </div>
                  </div>
                )}
              </div>
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}

            <button
              onClick={handleCreate}
              disabled={
                !title ||
                !selectedTemplate ||
                !scheduledAt ||
                isCreating ||
                (studioEnabled && studioBlocks.length === 0)
              }
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
