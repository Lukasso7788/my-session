import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

type PreviewRecipient = {
  userId: string;
  email: string;
  name: string;
  score: number;
  reasons: string[];
  lastSentAt: string | null;
};

type PreviewSession = {
  id: string;
  title?: string | null;
  start_time?: string | null;
  host_name?: string | null;
  host_profile?: {
    full_name?: string | null;
  } | null;
};

type AdminEmailUser = {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string | null;
  emailConfirmed: boolean;
  enabled: boolean;
  lastSentAt: string | null;
  priorityOverride: number;
};

const DAILY_SCHEDULE_ADMIN_API = "/api/livekit/admin";

function todayYMD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(raw?: string | null) {
  if (!raw) return "Time TBD";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "Time TBD";

  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(raw?: string | null) {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getHostName(session: PreviewSession) {
  return (
    String(session.host_profile?.full_name || "").trim() ||
    String(session.host_name || "").trim() ||
    "Host"
  );
}

function normalizeSelectedIds(ids: string[]) {
  return Array.from(
    new Set(
      ids
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    )
  );
}

function getInitial(name: string) {
  return (String(name || "").trim()[0] || "U").toUpperCase();
}

export default function DailyScheduleEmailAdminPage() {
  const navigate = useNavigate();

  const [scheduleDate, setScheduleDate] = useState(todayYMD());
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [lastSendResult, setLastSendResult] = useState<any>(null);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState<"auto" | "manual">("auto");

  const [allUsers, setAllUsers] = useState<AdminEmailUser[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [columns, setColumns] = useState(4);
  const [showOnly, setShowOnly] = useState<"all" | "enabled" | "selected" | "unconfirmed">("all");

  const sessions = useMemo<PreviewSession[]>(() => preview?.sessions || [], [preview]);
  const selected = useMemo<PreviewRecipient[]>(() => preview?.selected || [], [preview]);

  const selectedIdSet = useMemo(() => new Set(selectedRecipientIds), [selectedRecipientIds]);

  const filteredAllUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();

    return allUsers.filter((u) => {
      if (showOnly === "enabled" && !u.enabled) return false;
      if (showOnly === "selected" && !selectedIdSet.has(u.userId)) return false;
      if (showOnly === "unconfirmed" && u.emailConfirmed) return false;

      if (!q) return true;

      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.userId.toLowerCase().includes(q)
      );
    });
  }, [allUsers, userSearch, showOnly, selectedIdSet]);

  const gridClass = useMemo(() => {
    if (columns <= 2) return "grid-cols-1 md:grid-cols-2";
    if (columns === 3) return "grid-cols-1 md:grid-cols-2 xl:grid-cols-3";
    if (columns === 4) return "grid-cols-1 md:grid-cols-2 xl:grid-cols-4";
    if (columns === 5) return "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5";
    return "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6";
  }, [columns]);

  const effectiveSendLabel =
    selectionMode === "manual" && selectedRecipientIds.length > 0
      ? `Send selected (${selectedRecipientIds.length})`
      : `Send auto top ${limit}`;

  const callEndpoint = async (
    action: "daily_schedule_preview" | "daily_schedule_send" | "daily_schedule_all_users",
    options?: {
      selectedUserIds?: string[];
      limitOverride?: number;
    }
  ) => {
    const { data } = await supabase.auth.getSession();
    const token = String(data.session?.access_token || "").trim();

    if (!token) {
      navigate("/login?next=/admin/daily-schedule-email");
      return null;
    }

    const ids = normalizeSelectedIds(options?.selectedUserIds || []);
    const finalLimit =
      typeof options?.limitOverride === "number"
        ? Math.max(1, Math.min(100, Math.round(options.limitOverride)))
        : limit;

    const res = await fetch(DAILY_SCHEDULE_ADMIN_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action,
        scheduleDate,
        limit: finalLimit,
        selectedUserIds: ids,
      }),
    });

    const rawText = await res.text();
    let json: any = {};

    try {
      json = rawText ? JSON.parse(rawText) : {};
    } catch {
      json = { message: rawText };
    }

    if (!res.ok) {
      const details =
        json?.error ||
        json?.message ||
        json?.details ||
        json?.details?.message ||
        rawText ||
        `Request failed: ${res.status}`;

      throw new Error(`${details} (${res.status})`);
    }

    return json;
  };

  const loadAllUsers = async () => {
    try {
      setUsersLoading(true);
      setError("");

      const json = await callEndpoint("daily_schedule_all_users");
      if (json?.users) setAllUsers(json.users);
    } catch (e: any) {
      console.error("[daily-schedule-email] all users failed:", e);
      setError(String(e?.message || e || "Failed to load all users."));
    } finally {
      setUsersLoading(false);
    }
  };

  const loadPreview = async () => {
    try {
      setLoading(true);
      setError("");
      setLastSendResult(null);

      const json = await callEndpoint("daily_schedule_preview");
      if (json) setPreview(json);
    } catch (e: any) {
      console.error("[daily-schedule-email] preview failed:", e);
      setError(String(e?.message || e || "Preview failed."));
    } finally {
      setLoading(false);
    }
  };

  const loadManualPreview = async () => {
    try {
      setLoading(true);
      setError("");
      setLastSendResult(null);

      const ids = normalizeSelectedIds(selectedRecipientIds);

      if (ids.length === 0) {
        setError("Select at least one recipient first.");
        return;
      }

      const json = await callEndpoint("daily_schedule_preview", {
        selectedUserIds: ids,
        limitOverride: ids.length,
      });

      if (json) setPreview(json);
    } catch (e: any) {
      console.error("[daily-schedule-email] selected preview failed:", e);
      setError(String(e?.message || e || "Selected preview failed."));
    } finally {
      setLoading(false);
    }
  };

  const toggleRecipient = (userId: string) => {
    const id = String(userId || "").trim();
    if (!id) return;

    setSelectionMode("manual");
    setSelectedRecipientIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
  };

  const selectAllFilteredUsers = () => {
    setSelectionMode("manual");
    setSelectedRecipientIds(normalizeSelectedIds(filteredAllUsers.map((u) => u.userId)));
  };

  const addFilteredUsersToSelection = () => {
    setSelectionMode("manual");
    setSelectedRecipientIds((prev) =>
      normalizeSelectedIds([...prev, ...filteredAllUsers.map((u) => u.userId)])
    );
  };

  const clearSelection = () => {
    setSelectionMode("auto");
    setSelectedRecipientIds([]);
  };

  const selectOnlyMe = async () => {
    try {
      setError("");

      const { data } = await supabase.auth.getSession();
      const userId = String(data.session?.user?.id || "").trim();

      if (!userId) {
        navigate("/login?next=/admin/daily-schedule-email");
        return;
      }

      setSelectionMode("manual");
      setSelectedRecipientIds([userId]);

      const json = await callEndpoint("daily_schedule_preview", {
        selectedUserIds: [userId],
        limitOverride: 1,
      });

      if (json) setPreview(json);
    } catch (e: any) {
      console.error("[daily-schedule-email] select me failed:", e);
      setError(String(e?.message || e || "Could not select current user."));
    }
  };

  const sendTestToMe = async () => {
    const ok = window.confirm(
      `Send one test daily schedule email to your current account for ${scheduleDate}?`
    );

    if (!ok) return;

    try {
      setTestSending(true);
      setError("");

      const { data } = await supabase.auth.getSession();
      const userId = String(data.session?.user?.id || "").trim();

      if (!userId) {
        navigate("/login?next=/admin/daily-schedule-email");
        return;
      }

      const json = await callEndpoint("daily_schedule_send", {
        selectedUserIds: [userId],
        limitOverride: 1,
      });

      if (json) {
        setLastSendResult(json);
        setSelectionMode("manual");
        setSelectedRecipientIds([userId]);
      }

      const previewJson = await callEndpoint("daily_schedule_preview", {
        selectedUserIds: [userId],
        limitOverride: 1,
      });
      if (previewJson) setPreview(previewJson);
    } catch (e: any) {
      console.error("[daily-schedule-email] test send failed:", e);
      setError(String(e?.message || e || "Test send failed."));
    } finally {
      setTestSending(false);
    }
  };

  const sendNow = async () => {
    const ids =
      selectionMode === "manual" && selectedRecipientIds.length > 0
        ? normalizeSelectedIds(selectedRecipientIds)
        : [];

    const targetLabel = ids.length > 0 ? `${ids.length} selected people` : `auto top ${limit} people`;

    const ok = window.confirm(
      `Send daily schedule email to ${targetLabel} for ${scheduleDate}?`
    );

    if (!ok) return;

    try {
      setSending(true);
      setError("");

      const json = await callEndpoint("daily_schedule_send", {
        selectedUserIds: ids,
        limitOverride: ids.length > 0 ? ids.length : limit,
      });

      if (json) setLastSendResult(json);

      if (ids.length > 0) {
        const previewJson = await callEndpoint("daily_schedule_preview", {
          selectedUserIds: ids,
          limitOverride: ids.length,
        });
        if (previewJson) setPreview(previewJson);
      } else {
        await loadPreview();
      }
    } catch (e: any) {
      console.error("[daily-schedule-email] send failed:", e);
      setError(String(e?.message || e || "Send failed."));
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="min-h-screen bg-white px-6 py-10 font-inter text-[#2F2F2F]">
      <div className="mx-auto max-w-[1600px]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#666]">
              MySession Admin
            </div>
            <h1 className="mt-2 text-[34px] font-bold">Daily schedule email</h1>
            <p className="mt-2 max-w-3xl text-[14px] leading-6 text-[#666]">
              Preview auto top 100, load all registered users, select recipients manually, or send a test to yourself.
            </p>
          </div>

          <button
            type="button"
            onClick={() => navigate("/admin")}
            className="rounded-full border border-[#2F2F2F] px-5 py-2.5 text-[14px] font-semibold hover:bg-[#2F2F2F] hover:text-white"
          >
            Back to admin
          </button>
        </div>

        <section className="mt-8 rounded-[28px] border border-black/10 bg-gray-50 p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_180px_auto_auto_auto] md:items-end">
            <label className="block">
              <span className="text-[13px] font-semibold">Schedule date</span>
              <input
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                className="mt-2 h-12 w-full rounded-2xl border border-black/10 bg-white px-4 text-[14px] outline-none focus:ring-2 focus:ring-black/15"
              />
            </label>

            <label className="block">
              <span className="text-[13px] font-semibold">Auto limit</span>
              <input
                type="number"
                min={1}
                max={100}
                value={limit}
                onChange={(e) =>
                  setLimit(Math.max(1, Math.min(100, Math.round(Number(e.target.value) || 100))))
                }
                className="mt-2 h-12 w-full rounded-2xl border border-black/10 bg-white px-4 text-[14px] outline-none focus:ring-2 focus:ring-black/15"
              />
            </label>

            <button
              type="button"
              disabled={loading}
              onClick={() => void loadPreview()}
              className="h-12 rounded-2xl border border-[#2F2F2F] bg-white px-5 text-[14px] font-semibold text-[#2F2F2F] hover:bg-black/[0.04] disabled:opacity-60"
            >
              {loading ? "Loading..." : "Preview auto"}
            </button>

            <button
              type="button"
              disabled={usersLoading}
              onClick={() => void loadAllUsers()}
              className="h-12 rounded-2xl border border-[#2F2F2F] bg-white px-5 text-[14px] font-semibold text-[#2F2F2F] hover:bg-black/[0.04] disabled:opacity-60"
            >
              {usersLoading ? "Loading users..." : "Load all users"}
            </button>

            <button
              type="button"
              disabled={sending || (!preview && selectedRecipientIds.length === 0)}
              onClick={() => void sendNow()}
              className="h-12 rounded-2xl bg-[#2F2F2F] px-5 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {sending ? "Sending..." : effectiveSendLabel}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={loading} onClick={() => void selectOnlyMe()} className="rounded-full border border-black/10 bg-white px-4 py-2 text-[13px] font-semibold hover:bg-black/[0.04] disabled:opacity-60">
              Select only me
            </button>

            <button type="button" disabled={testSending} onClick={() => void sendTestToMe()} className="rounded-full border border-emerald-600 bg-emerald-50 px-4 py-2 text-[13px] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60">
              {testSending ? "Sending test..." : "Send test to me"}
            </button>

            <button type="button" disabled={filteredAllUsers.length === 0} onClick={selectAllFilteredUsers} className="rounded-full border border-black/10 bg-white px-4 py-2 text-[13px] font-semibold hover:bg-black/[0.04] disabled:opacity-60">
              Replace with filtered users
            </button>

            <button type="button" disabled={filteredAllUsers.length === 0} onClick={addFilteredUsersToSelection} className="rounded-full border border-black/10 bg-white px-4 py-2 text-[13px] font-semibold hover:bg-black/[0.04] disabled:opacity-60">
              Add filtered users
            </button>

            <button type="button" disabled={selectedRecipientIds.length === 0} onClick={clearSelection} className="rounded-full border border-black/10 bg-white px-4 py-2 text-[13px] font-semibold hover:bg-black/[0.04] disabled:opacity-60">
              Clear selection
            </button>

            <button type="button" disabled={loading || selectedRecipientIds.length === 0} onClick={() => void loadManualPreview()} className="rounded-full border border-black/10 bg-white px-4 py-2 text-[13px] font-semibold hover:bg-black/[0.04] disabled:opacity-60">
              Preview selected only
            </button>
          </div>

          <div className="mt-3 rounded-2xl border border-black/10 bg-white px-4 py-3 text-[12px] leading-5 text-[#666]">
            <div>
              Mode:{" "}
              <strong>
                {selectionMode === "manual" && selectedRecipientIds.length > 0
                  ? `manual — ${selectedRecipientIds.length} selected`
                  : `auto — top ${limit}`}
              </strong>
            </div>
            <div>
              Loaded users: <strong>{allUsers.length}</strong> · Filtered:{" "}
              <strong>{filteredAllUsers.length}</strong> · Preview recipients:{" "}
              <strong>{selected.length}</strong>
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
              {error}
            </div>
          ) : null}

          {lastSendResult ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
              Sent: {lastSendResult.sentCount || 0}. Failed: {lastSendResult.failedCount || 0}.
            </div>
          ) : null}
        </section>

        <section className="mt-8 rounded-[28px] border border-black/10 bg-white p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="text-[22px] font-bold">All registered users</h2>
              <p className="mt-1 text-[13px] text-[#666]">
                Load everyone, search by name/email/id, then choose manually. Disabled/unsubscribed users are shown but marked.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(240px,420px)_160px_160px]">
              <input
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search name, email, or user id"
                className="h-11 rounded-2xl border border-black/10 bg-white px-4 text-[14px] outline-none focus:ring-2 focus:ring-black/15"
              />

              <select
                value={showOnly}
                onChange={(e) => setShowOnly(e.target.value as any)}
                className="h-11 rounded-2xl border border-black/10 bg-white px-4 text-[14px] outline-none focus:ring-2 focus:ring-black/15"
              >
                <option value="all">All users</option>
                <option value="enabled">Enabled only</option>
                <option value="selected">Selected only</option>
                <option value="unconfirmed">Unconfirmed email</option>
              </select>

              <select
                value={columns}
                onChange={(e) => setColumns(Math.max(2, Math.min(6, Number(e.target.value) || 4)))}
                className="h-11 rounded-2xl border border-black/10 bg-white px-4 text-[14px] outline-none focus:ring-2 focus:ring-black/15"
              >
                <option value={2}>2 columns</option>
                <option value={3}>3 columns</option>
                <option value={4}>4 columns</option>
                <option value={5}>5 columns</option>
                <option value={6}>6 columns</option>
              </select>
            </div>
          </div>

          <div className={`mt-5 grid ${gridClass} gap-3`}>
            {filteredAllUsers.length === 0 ? (
              <div className="rounded-2xl border border-black/10 bg-gray-50 px-4 py-4 text-[14px] text-[#666]">
                {allUsers.length === 0
                  ? "Click “Load all users” first."
                  : "No users match this filter."}
              </div>
            ) : (
              filteredAllUsers.map((u) => {
                const checked = selectedIdSet.has(u.userId);

                return (
                  <label
                    key={u.userId}
                    className={`group block cursor-pointer rounded-2xl border px-3 py-3 transition ${checked
                        ? "border-[#2F2F2F] bg-[#2F2F2F] text-white"
                        : u.enabled
                          ? "border-black/10 bg-gray-50 hover:bg-gray-100"
                          : "border-red-200 bg-red-50 text-red-950 hover:bg-red-100"
                      }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRecipient(u.userId)}
                        className="mt-1 h-4 w-4 shrink-0"
                      />

                      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/80 text-[13px] font-bold text-[#2F2F2F]">
                        {u.avatarUrl ? (
                          <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          getInitial(u.name || u.email)
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-bold">
                          {u.name || "User"}
                        </div>
                        <div className={`truncate text-[12px] ${checked ? "text-white/75" : "text-[#666]"}`}>
                          {u.email}
                        </div>
                        <div className={`mt-1 truncate text-[11px] ${checked ? "text-white/60" : "text-[#888]"}`}>
                          Joined {formatDate(u.createdAt)}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {!u.enabled ? (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${checked ? "bg-white/15 text-white" : "bg-red-100 text-red-700"}`}>
                              unsubscribed
                            </span>
                          ) : null}

                          {!u.emailConfirmed ? (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${checked ? "bg-white/15 text-white" : "bg-amber-100 text-amber-700"}`}>
                              unconfirmed
                            </span>
                          ) : null}

                          {u.lastSentAt ? (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${checked ? "bg-white/15 text-white" : "bg-white text-[#666]"}`}>
                              sent {formatDate(u.lastSentAt)}
                            </span>
                          ) : (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${checked ? "bg-white/15 text-white" : "bg-white text-[#666]"}`}>
                              never sent
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </section>

        {preview ? (
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="rounded-[28px] border border-black/10 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[20px] font-bold">Today’s sessions</h2>
                <span className="rounded-full bg-gray-100 px-3 py-1 text-[12px] font-semibold">
                  {sessions.length}
                </span>
              </div>

              <div className="mt-5 space-y-3">
                {sessions.length === 0 ? (
                  <div className="rounded-2xl border border-black/10 bg-gray-50 px-4 py-4 text-[14px] text-[#666]">
                    No sessions for this date.
                  </div>
                ) : (
                  sessions.map((s) => (
                    <div key={s.id} className="rounded-2xl border border-black/10 bg-gray-50 px-4 py-3">
                      <div className="text-[14px] font-semibold">{s.title || "Focus session"}</div>
                      <div className="mt-1 text-[12px] text-[#666]">
                        {formatTime(s.start_time)} · {getHostName(s)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-[28px] border border-black/10 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-[20px] font-bold">Preview recipients</h2>
                  <p className="mt-1 text-[12px] text-[#777]">
                    This panel shows recipients returned by preview, not necessarily all loaded users.
                  </p>
                </div>

                <span className="rounded-full bg-gray-100 px-3 py-1 text-[12px] font-semibold">
                  preview {selected.length} · picked {selectedRecipientIds.length}
                </span>
              </div>

              <div className="mt-5 max-h-[640px] space-y-3 overflow-auto pr-1">
                {selected.length === 0 ? (
                  <div className="rounded-2xl border border-black/10 bg-gray-50 px-4 py-4 text-[14px] text-[#666]">
                    No preview recipients.
                  </div>
                ) : (
                  selected.map((r, idx) => {
                    const checked = selectedIdSet.has(r.userId);

                    return (
                      <label
                        key={r.userId}
                        className={`block cursor-pointer rounded-2xl border px-4 py-3 transition ${checked
                            ? "border-[#2F2F2F] bg-[#2F2F2F] text-white"
                            : "border-black/10 bg-gray-50 hover:bg-gray-100"
                          }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleRecipient(r.userId)}
                              className="mt-1 h-4 w-4 shrink-0"
                            />

                            <div className="min-w-0">
                              <div className="truncate text-[14px] font-semibold">
                                #{idx + 1} · {r.name}
                              </div>
                              <div className={`truncate text-[12px] ${checked ? "text-white/75" : "text-[#666]"}`}>
                                {r.email}
                              </div>
                            </div>
                          </div>

                          <div className={`rounded-full px-2.5 py-1 text-[12px] font-bold ${checked ? "bg-white text-[#2F2F2F]" : "bg-white"}`}>
                            {r.score}
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-1.5 pl-7">
                          {(r.reasons || []).slice(0, 4).map((reason) => (
                            <span
                              key={reason}
                              className={`rounded-full px-2 py-1 text-[11px] ${checked ? "bg-white/15 text-white/80" : "bg-white text-[#666]"
                                }`}
                            >
                              {reason}
                            </span>
                          ))}
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
