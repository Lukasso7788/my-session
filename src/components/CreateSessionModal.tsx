import { useState, useEffect } from "react";
import { X } from "lucide-react";
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

  // Загружаем шаблоны сессий
  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/templates")
      .then((res) => res.json())
      .then((data) => setTemplates(data))
      .catch((err) => console.error("Error loading templates:", err));
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

      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          host,
          templateId: selectedTemplate,
          scheduled_at: scheduledISO,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to create session");
      }

      const session = await res.json();
      console.log("✅ Session created:", session);

      setTitle("");
      setHost("");
      setScheduledAt("");
      setSelectedTemplate("");

      onSessionCreated();
      onClose();
    } catch (err: any) {
      console.error("Error creating session:", err);
      setError(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800">
            Create Focus Session
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Session Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Deep Work Session"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Host */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Your Name
            </label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="Host name"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Start time */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Start Time
            </label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Template selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Session Format
            </label>
            <div className="max-h-40 overflow-y-auto pr-2 space-y-2">
              {templates.length > 0 ? (
                templates.map((t) => (
                  <label
                    key={t.id}
                    className="flex items-center space-x-3 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="session-template"
                      value={t.id}
                      checked={selectedTemplate === t.id}
                      onChange={(e) => setSelectedTemplate(e.target.value)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-sm text-gray-800">
                      {t.name} ({t.totalDuration} min)
                    </span>
                  </label>
                ))
              ) : (
                <p className="text-sm text-gray-500">Loading templates...</p>
              )}
            </div>
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          {/* Button */}
          <button
            onClick={handleCreate}
            disabled={
              !title || !host || !selectedTemplate || !scheduledAt || isCreating
            }
            className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-300 transition"
          >
            {isCreating ? "Creating..." : "Create Session"}
          </button>
        </div>
      </div>
    </div>
  );
}
