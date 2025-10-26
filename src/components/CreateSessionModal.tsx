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
  const [host, setHost] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    async function loadTemplates() {
      const { data, error } = await supabase
        .from("session_templates")
        .select("*")
        .order("total_duration", { ascending: true });
      if (error) setError("Failed to load templates.");
      else setTemplates(data || []);
    }
    loadTemplates();
  }, [isOpen]);

  const handleCreate = async () => {
    if (!title || !host || !selectedTemplate || !scheduledAt) {
      setError("Please fill out all fields.");
      return;
    }
    setIsCreating(true);
    setError(null);
    try {
      const scheduledISO = new Date(scheduledAt).toISOString();
      const template = templates.find((t) => t.id === selectedTemplate);

      // 🟩 create Daily.co room ONCE
      const roomRes = await fetch("https://api.daily.co/v1/rooms", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_DAILY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: {
            enable_chat: true,
            enable_screenshare: true,
            enable_network_ui: false,
            exp: Math.round(Date.now() / 1000) + 60 * 60 * 6,
          },
          privacy: "public",
        }),
      });
      const roomData = await roomRes.json();
      if (!roomRes.ok || !roomData.url) throw new Error("Daily room creation failed");
      const dailyUrl = roomData.url;

      // 🟩 insert session with saved daily_room_url
      const { error } = await supabase.from("sessions").insert([
        {
          title,
          host,
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
      setHost("");
      setScheduledAt("");
      setSelectedTemplate("");
      onSessionCreated();
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to create session");
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800">Create Focus Session</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 transition">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Session Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Deep Work Session"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="Host name"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Session Format</label>
            <div className="max-h-40 overflow-y-auto pr-2 space-y-2">
              {templates.length > 0 ? (
                templates.map((t) => (
                  <label key={t.id} className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="radio"
                      name="session-template"
                      value={t.id}
                      checked={selectedTemplate === t.id}
                      onChange={(e) => setSelectedTemplate(e.target.value)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-sm text-gray-800">
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
            disabled={!title || !host || !selectedTemplate || !scheduledAt || isCreating}
            className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-300 transition"
          >
            {isCreating ? "Creating..." : "Create Session"}
          </button>
        </div>
      </div>
    </div>
  );
}
