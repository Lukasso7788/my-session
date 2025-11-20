import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useCreateSessionModal } from "../hooks/useCreateSessionModal";

export function CreateSessionModal() {
  const { isOpen, close, onCreatedCallback } = useCreateSessionModal();

  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [templates, setTemplates] = useState([]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);

  // Load profile
  useEffect(() => {
    if (!isOpen) return;

    async function load() {
      setError(null);
      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.user) {
        setError("You must be logged in to create a session");
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("id", session.user.id)
        .single();

      setProfile(data);
    }

    load();
  }, [isOpen]);

  // Load templates
  useEffect(() => {
    if (!isOpen) return;

    supabase
      .from("session_templates")
      .select("*")
      .order("total_duration", { ascending: true })
      .then(({ data }) => {
        setTemplates(data || []);
      });
  }, [isOpen]);

  // Create session
  const handleCreate = async () => {
    if (!title || !selectedTemplate || !scheduledAt) {
      setError("Fill all fields");
      return;
    }
    if (!profile?.id) {
      setError("Profile not loaded");
      return;
    }

    setIsCreating(true);

    try {
      const scheduledISO = new Date(scheduledAt).toISOString();
      const template = templates.find((t: any) => t.id === selectedTemplate);

      // Create Daily room
      const { data: fnData } = await supabase.functions.invoke(
        "create-daily-room",
        { body: {} }
      );

      if (!fnData?.url) throw new Error("Daily room creation failed");

      const dailyUrl = fnData.url;

      // Insert session
      const { error } = await supabase.from("sessions").insert({
        title,
        host_id: profile.id,
        host_name: profile.full_name,
        template_id: selectedTemplate,
        start_time: scheduledISO,
        duration_minutes: template.total_duration,
        format: template.name,
        schedule: template.blocks,
        daily_room_url: dailyUrl,
        status: "planned",
        created_at: new Date().toISOString(),
      });

      if (error) throw error;

      // Reset form
      setTitle("");
      setScheduledAt("");
      setSelectedTemplate("");

      onCreatedCallback?.();   // ← теперь работает правильно
      close();
    } catch (e: any) {
      console.error(e);
      setError(e.message);
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
          <h2 className="text-[20px] font-bold">Create focus session</h2>
          <button onClick={close}>
            <X size={22} />
          </button>
        </div>

        {/* FORM */}
        {/* ... оставляем весь JSX как есть ... */}

        <button
          onClick={handleCreate}
          disabled={!title || !selectedTemplate || !scheduledAt || isCreating}
          className="w-full bg-brandBlack text-white py-3 rounded-[42px]"
        >
          {isCreating ? "Creating..." : "Create session"}
        </button>
      </div>
    </div>
  );
}
