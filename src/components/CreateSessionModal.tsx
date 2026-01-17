// src/components/CreateSessionModal.tsx
// Full file replacement (adds Custom link slug + Max participants + keeps Session Timeline + fixes Create button logic for Studio)

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  X,
  Layers,
  ArrowUp,
  ArrowDown,
  Trash2,
  Wand2,
  RotateCcw,
  Eraser,
  Link2,
  Users,
} from "lucide-react";
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

  if (
    t.startsWith("asia/") ||
    t.startsWith("australia/") ||
    t.startsWith("pacific/")
  ) {
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

// ===============================
// Custom slug helpers
// ===============================
const SLUG_MIN = 3;
const SLUG_MAX = 40;

// allowed: a-z 0-9 - _
function sanitizeSlug(input: string) {
  const raw = String(input || "").trim().toLowerCase();
  // replace spaces with dash, then drop disallowed chars
  const spaced = raw.replace(/\s+/g, "-");
  const clean = spaced.replace(/[^a-z0-9-_]/g, "");
  return clean;
}

function isValidSlug(slug: string) {
  if (!slug) return true; // empty = not used
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) return false;
  // must start with alnum, then alnum/_/-
  return /^[a-z0-9][a-z0-9-_]*$/.test(slug);
}

// ===============================
// participants limit helpers
// ===============================
const DEFAULT_MAX_PARTICIPANTS = 16;
const MIN_PARTICIPANTS = 3;
const MAX_PARTICIPANTS = 64;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// ===============================
// SESSION STUDIO (builder) types
// ===============================
type StudioBlockKind =
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
  kind: StudioBlockKind;
  title: string;
  note?: string;
  minutes: number;
};

function uid() {
  // crypto.randomUUID if available, else fallback
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = (globalThis as any)?.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `b_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function safeJson(raw: any) {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function normalizeTemplateBlocks(rawBlocks: any): StudioBlock[] {
  const parsed = safeJson(rawBlocks);
  if (!parsed) return [];

  const arr = Array.isArray(parsed) ? parsed : [];
  return arr.map((b: any) => {
    const title = String(
      b?.title || b?.name || b?.label || b?.kind || b?.type || "Block"
    ).trim();

    const minutesRaw =
      b?.minutes ?? b?.duration_minutes ?? b?.duration ?? b?.len ?? b?.time ?? 5;

    const minutes = clamp(Number(minutesRaw) || 5, 1, 24 * 60);

    const k = String(b?.kind || b?.type || "").toLowerCase();
    const kind: StudioBlockKind =
      k === "welcome"
        ? "welcome"
        : k === "intentions"
          ? "intentions"
          : k === "focus"
            ? "focus"
            : k === "break"
              ? "break"
              : k === "checkin"
                ? "checkin"
                : k === "recap"
                  ? "recap"
                  : k === "celebrate"
                    ? "celebrate"
                    : "custom";

    return {
      id: uid(),
      kind,
      title,
      note: String(b?.note || b?.description || "").trim() || undefined,
      minutes,
    };
  });
}

function exportStudioToSchedule(blocks: StudioBlock[]) {
  return blocks.map((b, idx) => ({
    kind: b.kind,
    title: b.title,
    minutes: b.minutes,
    note: b.note || null,
    order: idx,
    v: 1,
  }));
}

const STUDIO_LIBRARY: StudioBlock[] = [
  {
    id: "lib_welcome",
    kind: "welcome",
    title: "Welcome",
    note: "Quick intro / rules / vibe",
    minutes: 3,
  },
  {
    id: "lib_intentions",
    kind: "intentions",
    title: "Intentions",
    note: "Say what you’ll finish",
    minutes: 5,
  },
  {
    id: "lib_focus",
    kind: "focus",
    title: "Focus",
    note: "Deep work block",
    minutes: 50,
  },
  {
    id: "lib_break",
    kind: "break",
    title: "Break",
    note: "Recharge / stretch",
    minutes: 10,
  },
  {
    id: "lib_checkin",
    kind: "checkin",
    title: "Check-in",
    note: "Short accountability checkpoint",
    minutes: 3,
  },
  {
    id: "lib_recap",
    kind: "recap",
    title: "Recap",
    note: "What got done / what’s next",
    minutes: 5,
  },
  {
    id: "lib_celebrate",
    kind: "celebrate",
    title: "Celebrate",
    note: "Closure + positive finish",
    minutes: 3,
  },
  {
    id: "lib_custom",
    kind: "custom",
    title: "Custom",
    note: "Any special block",
    minutes: 5,
  },
];

const QUICK_MINUTES = [3, 5, 10, 15, 25, 50];

// ===============================
// SESSION TIMELINE (visual)
// ===============================
function kindBg(kind: StudioBlockKind) {
  // deliberately NOT FlowN-like: calmer palette
  switch (kind) {
    case "welcome":
      return "bg-slate-200";
    case "intentions":
      return "bg-indigo-200";
    case "focus":
      return "bg-emerald-200";
    case "break":
      return "bg-amber-200";
    case "checkin":
      return "bg-cyan-200";
    case "recap":
      return "bg-violet-200";
    case "celebrate":
      return "bg-pink-200";
    default:
      return "bg-gray-200";
  }
}

function formatMinutes(min: number) {
  const m = Math.max(0, Math.floor(min || 0));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h <= 0) return `${mm}m`;
  if (mm === 0) return `${h}h`;
  return `${h}h ${mm}m`;
}

function SessionTimeline({ blocks }: { blocks: StudioBlock[] }) {
  const total = blocks.reduce((s, b) => s + (Number(b.minutes) || 0), 0);

  const rows = useMemo(() => {
    let acc = 0;
    return blocks.map((b) => {
      const start = acc;
      const end = acc + (Number(b.minutes) || 0);
      acc = end;
      return { ...b, start, end };
    });
  }, [blocks]);

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <div className="font-inter text-[12px] text-gray-600">
          Session timeline
        </div>
        <div className="font-inter text-[12px] text-gray-600">
          Total:{" "}
          <span className="font-semibold text-brandBlack">
            {formatMinutes(total)}
          </span>
        </div>
      </div>

      {/* pill bar */}
      <div className="mt-2 border border-gray-200 rounded-[999px] overflow-hidden bg-gray-50">
        <div className="flex h-3">
          {blocks.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center text-[12px] text-gray-500 font-inter">
              Add blocks to build a timeline
            </div>
          ) : (
            blocks.map((b) => {
              const mins = clamp(Number(b.minutes) || 1, 1, 24 * 60);
              const showText = mins >= 10;
              return (
                <div
                  key={b.id}
                  className={`h-full ${kindBg(
                    b.kind
                  )} border-r border-white/70 flex items-center justify-center`}
                  style={{ flexGrow: mins, flexBasis: 0, minWidth: 6 }}
                  title={`${b.title} • ${mins} min`}
                >
                  {showText ? (
                    <span className="px-2 text-[11px] font-inter text-gray-800 truncate">
                      {b.title} · {mins}m
                    </span>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      {blocks.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer select-none text-[12px] text-gray-600 font-inter hover:text-gray-800">
            Show breakdown
          </summary>

          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
            {rows.map((r) => (
              <div
                key={r.id}
                className="border border-gray-200 rounded-[14px] px-3 py-2 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${kindBg(r.kind)}`} />
                  <span className="text-[12px] font-inter text-brandBlack truncate">
                    {r.title}
                  </span>
                </div>

                <div className="text-[12px] font-inter text-gray-600 whitespace-nowrap">
                  {r.start}–{r.end}m · {r.minutes}m
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
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

  // ---------- Custom link slug ----------
  const [customSlugInput, setCustomSlugInput] = useState("");
  const sanitizedSlug = useMemo(
    () => sanitizeSlug(customSlugInput),
    [customSlugInput]
  );
  const slugValid = useMemo(() => isValidSlug(sanitizedSlug), [sanitizedSlug]);
  const [slugStatus, setSlugStatus] = useState<
    "idle" | "invalid" | "checking" | "taken" | "available"
  >("idle");

  // ---------- JITSI DOMAIN (AUTO + OPTIONAL MANUAL) ----------
  const autoGuess = useMemo(() => guessJitsiDomainByTimezone(), [isOpen]);
  const [useAutoDomain, setUseAutoDomain] = useState(true);
  const [manualDomain, setManualDomain] =
    useState<JitsiDomain>("meet-eu.mysession.club");

  useEffect(() => {
    if (!isOpen) return;
    setUseAutoDomain(true);
    setManualDomain(autoGuess.domain);
  }, [isOpen, autoGuess.domain]);

  const effectiveDomain: JitsiDomain = useAutoDomain
    ? autoGuess.domain
    : manualDomain;

  // ---------- SESSION STUDIO ----------
  const [studioEnabled, setStudioEnabled] = useState(false);
  const [studioBlocks, setStudioBlocks] = useState<StudioBlock[]>([]);

  // ✅ max participants (Studio can customize)
  const [maxParticipants, setMaxParticipants] = useState<number>(
    DEFAULT_MAX_PARTICIPANTS
  );

  useEffect(() => {
    if (!isOpen) return;
    // reset every time modal opens
    setMaxParticipants(DEFAULT_MAX_PARTICIPANTS);
    setCustomSlugInput("");
    setSlugStatus("idle");
  }, [isOpen]);

  useEffect(() => {
    // when Studio OFF: force default 16
    if (!studioEnabled) setMaxParticipants(DEFAULT_MAX_PARTICIPANTS);
  }, [studioEnabled]);

  // slug availability check (best-effort)
  useEffect(() => {
    if (!isOpen) return;

    const s = sanitizedSlug;

    if (!s) {
      setSlugStatus("idle");
      return;
    }

    if (!slugValid) {
      setSlugStatus("invalid");
      return;
    }

    setSlugStatus("checking");
    const t = window.setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from("sessions")
          .select("id")
          .eq("custom_slug", s)
          .limit(1);

        if (error) {
          console.log("[slug] availability check error:", error);
          setSlugStatus("idle");
          return;
        }

        setSlugStatus(data && data.length > 0 ? "taken" : "available");
      } catch (e) {
        console.log("[slug] availability check exception:", e);
        setSlugStatus("idle");
      }
    }, 450);

    return () => window.clearTimeout(t);
  }, [sanitizedSlug, slugValid, isOpen]);

  const studioTotal = useMemo(
    () => studioBlocks.reduce((sum, b) => sum + (Number(b.minutes) || 0), 0),
    [studioBlocks]
  );

  const selectedTemplateObj = useMemo(
    () => templates.find((t) => t.id === selectedTemplate),
    [templates, selectedTemplate]
  );

  const importFromTemplate = useCallback(() => {
    const tpl = selectedTemplateObj;
    const blocks = normalizeTemplateBlocks((tpl as any)?.blocks);
    if (blocks.length) {
      setStudioBlocks(blocks);
    } else {
      setStudioBlocks([
        {
          id: uid(),
          kind: "welcome",
          title: "Welcome",
          note: "Quick intro / rules / vibe",
          minutes: 3,
        },
        {
          id: uid(),
          kind: "intentions",
          title: "Intentions",
          note: "Say what you’ll finish",
          minutes: 5,
        },
        { id: uid(), kind: "focus", title: "Focus", note: "Deep work block", minutes: 50 },
        { id: uid(), kind: "recap", title: "Recap", note: "What got done / what’s next", minutes: 5 },
        { id: uid(), kind: "celebrate", title: "Celebrate", note: "Closure + positive finish", minutes: 3 },
      ]);
    }
  }, [selectedTemplateObj]);

  const resetDefaultStudio = useCallback(() => {
    setStudioBlocks([
      { id: uid(), kind: "welcome", title: "Welcome", note: "Quick intro / rules / vibe", minutes: 3 },
      { id: uid(), kind: "intentions", title: "Intentions", note: "Say what you’ll finish", minutes: 5 },
      { id: uid(), kind: "focus", title: "Focus", note: "Deep work block", minutes: 50 },
      { id: uid(), kind: "break", title: "Break", note: "Recharge / stretch", minutes: 10 },
      { id: uid(), kind: "focus", title: "Focus", note: "Second focus block", minutes: 50 },
      { id: uid(), kind: "recap", title: "Recap", note: "What got done / what’s next", minutes: 5 },
      { id: uid(), kind: "celebrate", title: "Celebrate", note: "Closure + positive finish", minutes: 3 },
    ]);
  }, []);

  const clearStudio = useCallback(() => setStudioBlocks([]), []);

  const addFromLibrary = useCallback((b: StudioBlock) => {
    setStudioBlocks((prev) => [
      ...prev,
      { id: uid(), kind: b.kind, title: b.title, note: b.note, minutes: b.minutes },
    ]);
  }, []);

  const moveBlock = useCallback((id: string, dir: -1 | 1) => {
    setStudioBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx < 0) return prev;
      const nextIdx = idx + dir;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, item);
      return copy;
    });
  }, []);

  const updateBlock = useCallback((id: string, patch: Partial<StudioBlock>) => {
    setStudioBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const removeBlock = useCallback((id: string) => {
    setStudioBlocks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (!studioEnabled) return;

    if (studioBlocks.length === 0) {
      const hasTplBlocks =
        normalizeTemplateBlocks((selectedTemplateObj as any)?.blocks).length > 0;
      if (hasTplBlocks) importFromTemplate();
      else resetDefaultStudio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioEnabled, isOpen]);

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

  // ---------- Prevent background scroll when modal open ----------
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // ---------- CREATE SESSION ----------
  const handleCreate = async () => {
    if (!title || !scheduledAt) {
      setError("Please fill out session title and start time.");
      return;
    }

    // ✅ FIX: template is required ONLY when Studio is OFF
    if (!studioEnabled && !selectedTemplate) {
      setError("Please select a session format (template).");
      return;
    }

    if (studioEnabled && studioBlocks.length === 0) {
      setError("Session Studio is enabled, but your script is empty. Add at least one block.");
      return;
    }

    if (!user || !profile?.id) {
      setError("You must be logged in to create a session.");
      return;
    }

    // slug validate
    const finalSlug = sanitizedSlug;
    if (finalSlug && !isValidSlug(finalSlug)) {
      setError(`Custom link is invalid. Use ${SLUG_MIN}-${SLUG_MAX} chars: a-z, 0-9, - or _.`);
      return;
    }
    if (finalSlug && slugStatus === "taken") {
      setError("This custom link is already taken. Pick another one.");
      return;
    }
    if (finalSlug && slugStatus === "checking") {
      setError("Checking custom link… please wait 1 second and try again.");
      return;
    }

    // If Studio is ON and template isn't selected, silently pick a base template id (for DB compatibility).
    const baseTemplateId =
      selectedTemplate || (studioEnabled ? (templates[0]?.id ?? "") : "");

    if (studioEnabled && !baseTemplateId) {
      setError("No templates found in database. Create at least one template first.");
      return;
    }

    // max participants
    const effectiveMaxParticipants = studioEnabled
      ? clamp(Number(maxParticipants) || DEFAULT_MAX_PARTICIPANTS, MIN_PARTICIPANTS, MAX_PARTICIPANTS)
      : DEFAULT_MAX_PARTICIPANTS;

    setIsCreating(true);
    setError(null);

    try {
      const scheduledISO = new Date(scheduledAt).toISOString();
      const template = templates.find((t) => t.id === baseTemplateId);

      const durationMinutes = studioEnabled
        ? studioTotal
        : (template as any)?.total_duration ?? 60;

      const schedulePayload = studioEnabled
        ? exportStudioToSchedule(studioBlocks)
        : (template as any)?.blocks || [];

      const formatLabel = studioEnabled
        ? template?.name
          ? `${template.name} (Studio)`
          : "Session Studio"
        : (template?.name || "Unspecified");

      // 1) Create Daily room via Supabase Edge Function
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

          template_id: baseTemplateId,

          start_time: scheduledISO,
          duration_minutes: durationMinutes,
          format: formatLabel,
          schedule: schedulePayload,
          daily_room_url: dailyUrl,
          status: "planned",
          created_at: new Date().toISOString(),
          jitsi_domain: effectiveDomain,

          // ✅ NEW:
          max_participants: effectiveMaxParticipants,
          custom_slug: finalSlug || null,
        },
      ]);

      if (error) throw error;

      setTitle("");
      setScheduledAt("");
      setSelectedTemplate("");
      setStudioEnabled(false);
      setStudioBlocks([]);
      setMaxParticipants(DEFAULT_MAX_PARTICIPANTS);
      setCustomSlugInput("");
      setSlugStatus("idle");

      onSessionCreated();
      onClose();
    } catch (err: any) {
      console.error("❌ Error creating session:", err);

      // optional: friendly message for unique constraint
      const msg = String(err?.message || "");
      if (msg.toLowerCase().includes("custom_slug") && msg.toLowerCase().includes("duplicate")) {
        setError("This custom link is already taken. Pick another one.");
      } else {
        setError(err.message || "Failed to create session");
      }
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  const hostName = profile?.full_name || user?.email || "Unknown host";
  const minDateTime = nowLocalForDatetimeInput();

  const effectiveDomainLabel =
    JITSI_DOMAINS.find((d) => d.value === effectiveDomain)?.label || effectiveDomain;

  const panelClass = studioEnabled
    ? "bg-white w-[calc(100vw-24px)] h-[calc(100vh-24px)] max-w-none max-h-none rounded-[20px] shadow-2xl flex flex-col overflow-hidden"
    : "bg-white rounded-[16px] p-6 w-full max-w-md shadow-xl";

  const overlayClass = studioEnabled
    ? "fixed inset-0 bg-black/50 z-50 p-3 md:p-4 flex items-center justify-center"
    : "fixed inset-0 bg-black/50 flex items-center justify-center z-50";

  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";

  const linkPreview = sanitizedSlug
    ? `${origin}/room/${sanitizedSlug}`
    : `${origin}/room/<your-link>`;

  const slugHint = !customSlugInput
    ? "Optional. Your own short link instead of UUID."
    : slugStatus === "invalid"
      ? `Invalid. Use ${SLUG_MIN}-${SLUG_MAX} chars: a-z, 0-9, - or _.`
      : slugStatus === "checking"
        ? "Checking availability…"
        : slugStatus === "taken"
          ? "Taken. Pick another."
          : slugStatus === "available"
            ? "Available ✓"
            : "";

  const slugHintColor =
    slugStatus === "taken" || slugStatus === "invalid"
      ? "text-red-600"
      : slugStatus === "available"
        ? "text-emerald-600"
        : "text-gray-500";

  return (
    <div className={overlayClass}>
      <div className={panelClass}>
        {/* HEADER */}
        <div className={studioEnabled ? "px-6 pt-6" : ""}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-[20px] font-bold text-brandBlack font-inter">
              Create focus session
            </h2>

            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 transition"
              aria-label="Close"
            >
              <X size={22} />
            </button>
          </div>
        </div>

        {/* BODY (scrolls) */}
        <div className={studioEnabled ? "px-6 pb-4 flex-1 overflow-y-auto" : ""}>
          {loading || !user ? (
            <p className="text-sm text-gray-500 mb-4 font-inter px-6">
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

              {/* Custom link */}
              <div className="border border-gray-200 rounded-[18px] bg-white p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-[14px] bg-[#111827] text-white flex items-center justify-center">
                    <Link2 size={18} />
                  </div>

                  <div className="flex-1">
                    <div className="font-inter font-semibold text-[14px] text-brandBlack">
                      Custom session link
                    </div>
                    <div className="font-inter text-[12px] text-gray-500">
                      {slugHint || "Optional. Your own short link instead of UUID."}
                    </div>

                    <div className="mt-3">
                      <input
                        value={customSlugInput}
                        onChange={(e) => setCustomSlugInput(e.target.value)}
                        placeholder="e.g., yaro-deep-work"
                        className="w-full px-3 py-3 border border-gray-300 rounded-[16px] font-inter"
                      />

                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className={`text-[12px] font-inter ${slugHintColor}`}>
                          {customSlugInput ? slugHint : "Allowed: a-z, 0-9, - or _. Lowercase."}
                        </div>
                        <div className="text-[12px] font-inter text-gray-500 truncate">
                          {linkPreview}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
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
                    {useAutoDomain
                      ? `Picked: ${effectiveDomainLabel}`
                      : `Manual: ${effectiveDomainLabel}`}
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
                          src={`/icons/${(t as any).icon || t.name.toLowerCase()}.svg`}
                          className="w-4 h-4"
                          alt=""
                          draggable={false}
                        />

                        <span className="text-[16px] text-brandBlack font-inter">
                          {t.name} ({(t as any).total_duration} min)
                        </span>
                      </label>
                    ))
                  ) : (
                    <p className="text-sm text-gray-500 font-inter">
                      Loading templates...
                    </p>
                  )}
                </div>

                {studioEnabled && (
                  <p className="mt-2 text-[12px] text-gray-500 font-inter">
                    Tip: when Session Studio is enabled, selecting a format is optional.
                  </p>
                )}
              </div>

              {/* =======================
                  SESSION STUDIO (builder)
                  ======================= */}
              <div className="border border-[#DBD8D8] rounded-[18px] bg-white p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-[14px] bg-[#111827] text-white flex items-center justify-center">
                      <Layers size={18} />
                    </div>

                    <div>
                      <div className="font-inter font-semibold text-[14px] text-brandBlack">
                        Session Studio
                      </div>
                      <div className="font-inter text-[12px] text-gray-500">
                        Build a custom session script (different UI than FlowN).
                      </div>
                    </div>
                  </div>

                  {studioEnabled && (
                    <button
                      onClick={() => setStudioEnabled(false)}
                      className="px-4 py-2 rounded-full bg-brandBlack text-white text-[12px] font-inter hover:bg-black transition"
                    >
                      Close
                    </button>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={studioEnabled}
                      onChange={(e) => setStudioEnabled(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className="text-[13px] text-brandBlack font-inter">
                      Use Session Studio for this session
                    </span>
                  </label>

                  <div className="text-[12px] text-gray-600 font-inter">
                    Length: <span className="font-semibold">{studioTotal}</span> min
                  </div>
                </div>

                <div className="mt-2 text-[12px] text-gray-500 font-inter">
                  Script saved into{" "}
                  <span className="font-medium">sessions.schedule</span>
                </div>

                {/* ✅ Participant limit */}
                <div className="mt-4 border border-gray-200 rounded-[16px] p-3">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-[12px] bg-black/5 flex items-center justify-center">
                      <Users size={16} />
                    </div>
                    <div className="flex-1">
                      <div className="font-inter font-semibold text-[13px] text-brandBlack">
                        Participant limit
                      </div>
                      <div className="font-inter text-[12px] text-gray-500">
                        Default for all templates is {DEFAULT_MAX_PARTICIPANTS}. Studio can set {MIN_PARTICIPANTS}–{MAX_PARTICIPANTS}.
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="number"
                      min={MIN_PARTICIPANTS}
                      max={MAX_PARTICIPANTS}
                      value={maxParticipants}
                      disabled={!studioEnabled}
                      onChange={(e) =>
                        setMaxParticipants(
                          clamp(
                            Number(e.target.value) || DEFAULT_MAX_PARTICIPANTS,
                            MIN_PARTICIPANTS,
                            MAX_PARTICIPANTS
                          )
                        )
                      }
                      className={
                        "w-28 px-3 py-2 border rounded-[14px] font-inter text-center " +
                        (studioEnabled
                          ? "border-gray-300"
                          : "border-gray-200 bg-gray-50 text-gray-500")
                      }
                    />
                    <span className="font-inter text-[12px] text-gray-600">people</span>

                    {!studioEnabled && (
                      <span className="ml-auto font-inter text-[12px] text-gray-500">
                        (Locked at {DEFAULT_MAX_PARTICIPANTS} when Studio is off)
                      </span>
                    )}
                  </div>
                </div>

                {/* ✅ Timeline appears only when Studio enabled */}
                {studioEnabled && <SessionTimeline blocks={studioBlocks} />}

                {studioEnabled && (
                  <div className="mt-3">
                    {/* actions row */}
                    <div className="flex items-center justify-end gap-2 flex-wrap">
                      <button
                        onClick={importFromTemplate}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-gray-200 text-[12px] font-inter hover:bg-gray-50 transition"
                        title="Import blocks from selected format/template"
                        type="button"
                      >
                        <Wand2 size={14} />
                        Import from format
                      </button>

                      <button
                        onClick={resetDefaultStudio}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-gray-200 text-[12px] font-inter hover:bg-gray-50 transition"
                        title="Reset to default script"
                        type="button"
                      >
                        <RotateCcw size={14} />
                        Reset default
                      </button>

                      <button
                        onClick={clearStudio}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-gray-200 text-[12px] font-inter hover:bg-gray-50 transition"
                        title="Clear script"
                        type="button"
                      >
                        <Eraser size={14} />
                        Clear
                      </button>
                    </div>

                    {/* two panels */}
                    <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Library */}
                      <div className="border border-gray-200 rounded-[18px] p-4">
                        <div>
                          <div className="font-inter font-semibold text-[13px] text-brandBlack">
                            Block Library
                          </div>
                          <div className="font-inter text-[12px] text-gray-500">
                            Add blocks to the script (cards, not rows).
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-3">
                          {STUDIO_LIBRARY.map((b) => (
                            <button
                              key={b.id}
                              onClick={() => addFromLibrary(b)}
                              className="text-left border border-gray-200 rounded-[14px] p-3 hover:bg-gray-50 transition"
                              type="button"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="font-inter font-semibold text-[12px] text-brandBlack">
                                  {b.title}
                                </div>
                                <div className="font-inter text-[12px] text-gray-500">
                                  {b.minutes}m
                                </div>
                              </div>
                              <div className="mt-1 font-inter text-[12px] text-gray-500 leading-snug">
                                {b.note}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Script */}
                      <div className="border border-gray-200 rounded-[18px] p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-inter font-semibold text-[13px] text-brandBlack">
                              Script
                            </div>
                            <div className="font-inter text-[12px] text-gray-500">
                              Reorder with arrows. Edit titles & durations.
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="font-inter text-[12px] text-gray-500">Total:</div>
                            <div className="font-inter font-semibold text-[12px] text-brandBlack">
                              {studioTotal} min
                            </div>
                          </div>
                        </div>

                        {studioBlocks.length === 0 ? (
                          <div className="mt-4 text-[12px] text-gray-500 font-inter">
                            No blocks yet. Add from the library on the left.
                          </div>
                        ) : (
                          <div className="mt-3 space-y-3">
                            {studioBlocks.map((b, idx) => (
                              <div key={b.id} className="border border-gray-200 rounded-[16px] p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="px-2 py-1 rounded-full border border-gray-200 text-[11px] font-inter text-gray-600">
                                      {b.kind}
                                    </span>

                                    <input
                                      value={b.title}
                                      onChange={(e) =>
                                        updateBlock(b.id, { title: e.target.value })
                                      }
                                      className="min-w-0 flex-1 px-2 py-1 border border-gray-200 rounded-[12px] text-[13px] font-inter"
                                    />
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => moveBlock(b.id, -1)}
                                      disabled={idx === 0}
                                      className="w-9 h-9 rounded-[12px] border border-gray-200 flex items-center justify-center disabled:opacity-40 hover:bg-gray-50 transition"
                                      type="button"
                                      title="Move up"
                                    >
                                      <ArrowUp size={16} />
                                    </button>

                                    <button
                                      onClick={() => moveBlock(b.id, 1)}
                                      disabled={idx === studioBlocks.length - 1}
                                      className="w-9 h-9 rounded-[12px] border border-gray-200 flex items-center justify-center disabled:opacity-40 hover:bg-gray-50 transition"
                                      type="button"
                                      title="Move down"
                                    >
                                      <ArrowDown size={16} />
                                    </button>

                                    <button
                                      onClick={() => removeBlock(b.id)}
                                      className="w-9 h-9 rounded-[12px] border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition"
                                      type="button"
                                      title="Remove"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </div>
                                </div>

                                <div className="mt-3 flex items-center gap-2 flex-wrap">
                                  <span className="text-[12px] text-gray-500 font-inter">
                                    Minutes
                                  </span>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateBlock(b.id, {
                                        minutes: clamp(b.minutes - 1, 1, 24 * 60),
                                      })
                                    }
                                    className="w-9 h-9 rounded-[12px] border border-gray-200 hover:bg-gray-50 transition"
                                  >
                                    –
                                  </button>

                                  <input
                                    type="number"
                                    value={b.minutes}
                                    onChange={(e) =>
                                      updateBlock(b.id, {
                                        minutes: clamp(
                                          Number(e.target.value) || 1,
                                          1,
                                          24 * 60
                                        ),
                                      })
                                    }
                                    className="w-16 h-9 px-2 border border-gray-200 rounded-[12px] text-[13px] font-inter text-center"
                                  />

                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateBlock(b.id, {
                                        minutes: clamp(b.minutes + 1, 1, 24 * 60),
                                      })
                                    }
                                    className="w-9 h-9 rounded-[12px] border border-gray-200 hover:bg-gray-50 transition"
                                  >
                                    +
                                  </button>

                                  <span className="text-[12px] text-gray-500 font-inter">
                                    min
                                  </span>
                                </div>

                                <div className="mt-2 flex items-center gap-2 flex-wrap">
                                  {QUICK_MINUTES.map((m) => (
                                    <button
                                      key={m}
                                      type="button"
                                      onClick={() => updateBlock(b.id, { minutes: m })}
                                      className="px-3 py-2 rounded-full border border-gray-200 text-[12px] font-inter hover:bg-gray-50 transition"
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
                  </div>
                )}
              </div>

              {error && <p className="text-red-600 text-sm font-inter">{error}</p>}
            </div>
          )}
        </div>

        {/* FOOTER (sticky in studio mode) */}
        {!loading && user && (
          <div
            className={
              studioEnabled
                ? "px-6 pb-6 pt-3 border-t border-gray-100 bg-white"
                : "mt-4"
            }
          >
            <button
              onClick={handleCreate}
              disabled={
                !title ||
                !scheduledAt ||
                (!studioEnabled && !selectedTemplate) ||
                (studioEnabled && studioBlocks.length === 0) ||
                (sanitizedSlug ? !slugValid || slugStatus === "taken" || slugStatus === "checking" : false) ||
                isCreating
              }
              className="w-full bg-brandBlack text-white py-3 rounded-[42px] font-medium text-[15px] font-inter hover:bg-black disabled:bg-gray-300 transition"
            >
              {isCreating ? "Creating..." : "Create session"}
            </button>

            <p className="text-xs text-gray-400 mt-3 text-center font-inter">
              Hosted by <span className="font-medium">{hostName}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
