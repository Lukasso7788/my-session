import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { SessionTemplate } from "../types/session";

interface CreateSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionCreated: () => void;
}

export function CreateSessionModal({
  isOpen,
  onClose,
  onSessionCreated,
}: CreateSessionModalProps) {
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);

  // Load user profile
  useEffect(() => {
    async function loadProfile() {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        setError("You must be logged in to create a session.");
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("id", user.id)
        .single();

      if (error) console.error("❌ Error loading profile:", error);
      setProfile(data);
    }

    if (isOpen) loadProfile();
  }, [isOpen]);

  // Load templates
  useEffect(() => {
    if (!isOpen) return;

    async function loadTemplates() {
      const { data, error } = await supabase
        .from("session_templates")
        .select("*")
        .order("total_duration", { ascending: true });

      if (error) {
        console.error("Error loading templates:", error);
        setError("Failed to load templates.");
      } else {
        setTemplates(data || []);
      }
    }

    loadTemplates();
  }, [isOpen]);

  // Create session
  const handleCreate = async () => {
    if (!title || !selectedTemplate || !scheduledAt) {
      setError("Please fill out all fields.");
      return;
    }

    if (!profile?.id) {
      setError("Unable to load your profile info.");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const scheduledISO = new Date(scheduledAt).toISOString();
      const template = templates.find((t) => t.id === selectedTemplate);

      // Create Daily room
      const roomRes = await fetch(
        "https://cxqgzcjsjyszcbcbdusp.supabase.co/functions/v1/create-daily-room",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
        }
      );

      const roomData = await roomRes.json();
      if (!roomRes.ok || !roomData.url) {
        console.error("❌ Daily room creation failed:", roomData);
        throw new Error("Failed to create Daily room");
      }

      const dailyUrl = roomData.url;

      // Save session
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
        },
      ]);

      if (error) throw error;

      setTitle("");
      setScheduledAt("");
      setSelectedTemplate("");
      onSessionCreated();
      onClose();
    } catch (err: any) {
      console.error("Error creating session:", err);
      setError(err.message || "Failed to create session");
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

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
              min={new Date().toISOString().slice(0, 16)}
              className="w-full px-3 py-3 border border-gray-300 rounded-[16px] font-inter"
            />
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

          {/* Submit button */}
          <button
            onClick={handleCreate}
            disabled={!title || !selectedTemplate || !scheduledAt || isCreating}
            className="w-full bg-brandBlack text-white py-3 rounded-[42px] font-medium text-[15px] font-inter hover:bg-black disabled:bg-gray-300 transition"
          >
            {isCreating ? "Creating..." : "Create session"}
          </button>
        </div>

        {profile && (
          <p className="text-xs text-gray-500 mt-4 text-center font-inter">
            Hosted by <span className="font-medium">{profile.full_name}</span>
          </p>
        )}
      </div>
    </div>
  );
}
