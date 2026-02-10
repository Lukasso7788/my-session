import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

type RoomTheme = "light" | "dark";

// UUID matcher (same as in IntentionsPanel)
const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SessionLite = {
    id: string;
    title?: string | null;
    start_time?: string | null;
    duration_minutes?: number | null;
    session_format_type?: string | null;
    custom_slug?: string | null;
};

type IntentionRow = {
    id: string;
    text: string;
    user_id: string;
    session_id: string;
    created_at?: string;
    completed?: boolean;
    profiles?: {
        full_name?: string;
        avatar_url?: string;
    };
};

function safeLower(x: any) {
    return String(x || "").toLowerCase();
}

function fmtWhen(iso?: string | null) {
    if (!iso) return "";
    const ms = Date.parse(String(iso));
    if (!Number.isFinite(ms)) return "";
    try {
        return new Date(ms).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return "";
    }
}

function buildLoginNext(urlPath: string) {
    const next = urlPath || "/sessions";
    return `/login?next=${encodeURIComponent(next)}`;
}

export default function FocusPlanPage() {
    const navigate = useNavigate();
    const [sp, setSp] = useSearchParams();

    const initialParam = (sp.get("sessionId") || "").trim();

    const [user, setUser] = useState<any>(null);

    const [sessions, setSessions] = useState<SessionLite[]>([]);
    const [sessionsLoading, setSessionsLoading] = useState(true);

    // raw may be uuid or slug
    const [rawSelected, setRawSelected] = useState<string>(initialParam);

    // resolved UUID (what we actually use for queries)
    const [sessionId, setSessionId] = useState<string | null>(null);

    // intentions for selected session
    const [intentions, setIntentions] = useState<IntentionRow[]>([]);
    const [loadingIntentions, setLoadingIntentions] = useState(false);

    // small “library” = your recent unique intentions from any session (MVP)
    const [library, setLibrary] = useState<IntentionRow[]>([]);
    const [loadingLibrary, setLoadingLibrary] = useState(false);

    const [tab, setTab] = useState<"my" | "team">("my");

    // edit
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingText, setEditingText] = useState("");

    // add
    const [newText, setNewText] = useState("");

    const loadSeqRef = useRef(0);

    // ===== auth =====
    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => setUser(data.user || null));
    }, []);

    // ===== sessions list =====
    useEffect(() => {
        let cancelled = false;

        (async () => {
            setSessionsLoading(true);
            try {
                // Keep it simple (MVP): load some sessions to attach intentions to
                const { data, error } = await supabase
                    .from("sessions")
                    .select("id, title, start_time, duration_minutes, session_format_type, custom_slug")
                    .order("start_time", { ascending: true })
                    .limit(120);

                if (!cancelled) {
                    if (!error && Array.isArray(data)) setSessions(data as any);
                    else setSessions([]);
                }
            } catch {
                if (!cancelled) setSessions([]);
            } finally {
                if (!cancelled) setSessionsLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    // If no param provided, auto-select first session once loaded
    useEffect(() => {
        if (rawSelected) return;
        if (sessionsLoading) return;
        if (!sessions.length) return;

        const first = sessions[0];
        if (first?.id) setRawSelected(String(first.id));
    }, [rawSelected, sessionsLoading, sessions]);

    // Resolve uuid from uuid/slug
    useEffect(() => {
        let cancelled = false;

        (async () => {
            const raw = String(rawSelected || "").trim();
            if (!raw) {
                if (!cancelled) setSessionId(null);
                return;
            }

            // uuid already
            if (UUID_RE.test(raw)) {
                if (!cancelled) setSessionId(raw);
                return;
            }

            const slug = raw.toLowerCase();

            // try local list first
            const fromList = sessions.find((s) => safeLower(s.custom_slug) === slug);
            if (fromList?.id) {
                if (!cancelled) setSessionId(String(fromList.id));
                return;
            }

            // fallback fetch
            try {
                const { data, error } = await supabase
                    .from("sessions")
                    .select("id")
                    .eq("custom_slug", slug)
                    .maybeSingle();

                if (!cancelled) {
                    if (!error && data?.id) setSessionId(String(data.id));
                    else setSessionId(null);
                }
            } catch {
                if (!cancelled) setSessionId(null);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [rawSelected, sessions]);

    // Keep query param in sync (nice UX)
    useEffect(() => {
        const raw = String(rawSelected || "").trim();
        if (!raw) return;

        const cur = (sp.get("sessionId") || "").trim();
        if (cur === raw) return;

        sp.set("sessionId", raw);
        setSp(sp, { replace: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rawSelected]);

    // ===== load intentions for selected session =====
    const loadIntentions = async (sid: string) => {
        const seq = ++loadSeqRef.current;
        setLoadingIntentions(true);

        try {
            const { data, error } = await supabase
                .from("intentions")
                .select(
                    `id, text, user_id, session_id, created_at, completed,
           profiles ( full_name, avatar_url )`
                )
                .eq("session_id", sid)
                .order("created_at", { ascending: false });

            if (seq !== loadSeqRef.current) return;

            if (!error && Array.isArray(data)) setIntentions(data as any);
            else setIntentions([]);
        } finally {
            if (seq === loadSeqRef.current) setLoadingIntentions(false);
        }
    };

    // ===== load library (your recent unique intentions) =====
    const loadLibrary = async () => {
        if (!user?.id) return;

        setLoadingLibrary(true);
        try {
            const { data, error } = await supabase
                .from("intentions")
                .select("id, text, user_id, session_id, created_at, completed")
                .eq("user_id", user.id)
                .order("created_at", { ascending: false })
                .limit(80);

            if (error || !Array.isArray(data)) {
                setLibrary([]);
                return;
            }

            // unique by text (MVP “library”)
            const seen = new Set<string>();
            const out: IntentionRow[] = [];
            for (const row of data as any[]) {
                const t = String(row?.text || "").trim();
                if (!t) continue;
                const k = t.toLowerCase();
                if (seen.has(k)) continue;
                seen.add(k);
                out.push(row as any);
                if (out.length >= 20) break;
            }
            setLibrary(out);
        } finally {
            setLoadingLibrary(false);
        }
    };

    // initial loads when sessionId resolved
    useEffect(() => {
        if (!sessionId) return;
        loadIntentions(sessionId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    // load library after user known
    useEffect(() => {
        if (!user?.id) return;
        loadLibrary();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]);

    const selectedSession = useMemo(() => {
        if (!sessionId) return null;
        return sessions.find((s) => String(s.id) === String(sessionId)) || null;
    }, [sessions, sessionId]);

    const myIntentions = useMemo(() => {
        if (!user?.id) return [];
        return intentions.filter((i) => i.user_id === user.id);
    }, [intentions, user?.id]);

    const visibleIntentions = tab === "my" ? myIntentions : intentions;

    const myTextSet = useMemo(() => {
        const set = new Set<string>();
        for (const i of myIntentions) {
            const k = String(i?.text || "").trim().toLowerCase();
            if (k) set.add(k);
        }
        return set;
    }, [myIntentions]);

    const requireAuth = () => {
        if (user?.id) return true;
        navigate(buildLoginNext("/focus-plan"));
        return false;
    };

    const handleAdd = async () => {
        if (!requireAuth()) return;
        if (!sessionId) return;

        const text = newText.trim();
        if (!text) return;

        setNewText("");

        const optimisticId = `optimistic-${Date.now()}`;
        setIntentions((prev) => [
            {
                id: optimisticId,
                text,
                user_id: user.id,
                session_id: sessionId,
                completed: false,
                created_at: new Date().toISOString(),
                profiles: { full_name: "You", avatar_url: undefined },
            },
            ...prev,
        ]);

        const { error } = await supabase
            .from("intentions")
            .insert([{ user_id: user.id, session_id: sessionId, text, completed: false }]);

        if (error) {
            setIntentions((prev) => prev.filter((i) => i.id !== optimisticId));
            return;
        }

        await loadIntentions(sessionId);
        await loadLibrary();
    };

    const attachFromLibrary = async (text: string) => {
        if (!requireAuth()) return;
        if (!sessionId) return;

        const t = String(text || "").trim();
        if (!t) return;

        // avoid duplicates (MVP)
        if (myTextSet.has(t.toLowerCase())) return;

        const { error } = await supabase
            .from("intentions")
            .insert([{ user_id: user.id, session_id: sessionId, text: t, completed: false }]);

        if (!error) {
            await loadIntentions(sessionId);
            await loadLibrary();
        }
    };

    const toggleCompleted = async (row: IntentionRow) => {
        if (!requireAuth()) return;
        if (editingId === row.id) return;

        const next = !Boolean(row.completed);

        setIntentions((prev) => prev.map((i) => (i.id === row.id ? { ...i, completed: next } : i)));

        const { error } = await supabase.from("intentions").update({ completed: next }).eq("id", row.id);

        if (error) {
            setIntentions((prev) => prev.map((i) => (i.id === row.id ? { ...i, completed: !next } : i)));
        }
    };

    const startEdit = (row: IntentionRow) => {
        setEditingId(row.id);
        setEditingText(row.text || "");
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditingText("");
    };

    const saveEdit = async () => {
        if (!requireAuth()) return;
        if (!editingId) return;

        const text = editingText.trim();
        if (!text) return;

        const old = intentions.find((i) => i.id === editingId)?.text || "";
        setIntentions((prev) => prev.map((i) => (i.id === editingId ? { ...i, text } : i)));

        const { error } = await supabase.from("intentions").update({ text }).eq("id", editingId);

        if (error) {
            setIntentions((prev) => prev.map((i) => (i.id === editingId ? { ...i, text: old } : i)));
            return;
        }

        setEditingId(null);
        setEditingText("");
        await loadLibrary();
    };

    const detach = async (id: string) => {
        if (!requireAuth()) return;
        if (!sessionId) return;

        const prev = intentions;
        setIntentions((p) => p.filter((i) => i.id !== id));

        const { error } = await supabase.from("intentions").delete().eq("id", id);
        if (error) setIntentions(prev);
        else await loadLibrary();
    };

    const pageWrap = "w-full max-w-[1200px] mx-auto px-4 md:px-6 py-8";
    const card =
        "border border-borderGray rounded-[42px] bg-white p-6 md:p-7 transition-all duration-200";
    const softCard =
        "border border-[#E5E7EB] rounded-[24px] bg-white p-4 md:p-5";

    const pill =
        "h-11 rounded-full px-4 text-[13px] font-semibold border transition flex items-center justify-center";
    const pillActive = "border-[#111827] bg-[#111827] text-white";
    const pillIdle = "border-[#E5E7EB] bg-white text-[#111827] hover:bg-[#F3F4F6]";

    const btnPrimary =
        "h-11 rounded-full px-5 text-[13px] font-semibold border border-[#111827] bg-[#111827] text-white hover:opacity-90 transition";
    const btnGhost =
        "h-11 rounded-full px-5 text-[13px] font-semibold border border-[#E5E7EB] hover:bg-[#F3F4F6] transition";

    if (!user?.id) {
        // optional: allow read-only, but MVP проще — логин обязателен
        return (
            <div className={pageWrap}>
                <div className={card}>
                    <div className="text-[28px] md:text-[34px] font-bold text-[#111827] leading-tight">
                        Focus plan
                    </div>
                    <div className="mt-2 text-[13px] text-[#606060]">
                        Create intentions and attach them to a session.
                    </div>

                    <div className="mt-6 flex flex-col sm:flex-row gap-3">
                        <button className={btnPrimary} onClick={() => navigate(buildLoginNext("/focus-plan"))}>
                            Log in
                        </button>
                        <Link to="/sessions" className={btnGhost + " inline-flex items-center justify-center"}>
                            Back to sessions
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={pageWrap}>
            <div className={card}>
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                        <div className="text-[28px] md:text-[34px] font-bold text-[#111827] leading-tight">
                            Focus plan
                        </div>
                        <div className="mt-2 text-[13px] text-[#606060]">
                            Pick a session → add/attach intentions → they appear inside the room.
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Link
                            to="/sessions"
                            className="h-11 rounded-full px-5 text-[13px] font-semibold border border-[#E5E7EB] hover:bg-[#F3F4F6] transition inline-flex items-center justify-center"
                        >
                            Sessions
                        </Link>

                        <button
                            className={btnPrimary}
                            onClick={() => {
                                if (!sessionId) return;
                                // RoomPageIFrame uses /room-iframe/:id (uuid preferred)
                                navigate(`/room-iframe/${sessionId}`);
                            }}
                            disabled={!sessionId}
                            title={!sessionId ? "Select a session first" : "Open the room"}
                            style={{ opacity: sessionId ? 1 : 0.5 }}
                        >
                            Open room
                        </button>
                    </div>
                </div>

                {/* session selector */}
                <div className="mt-6">
                    <div className={softCard}>
                        <div className="text-[12px] font-semibold text-[#111827] mb-2">Selected session</div>

                        <div className="flex flex-col md:flex-row gap-3 md:items-center">
                            <div className="flex-1">
                                <select
                                    value={rawSelected}
                                    onChange={(e) => setRawSelected(e.target.value)}
                                    className="
                    w-full h-11 px-4 rounded-full
                    border border-[#E5E7EB]
                    text-[13px] font-semibold text-[#111827]
                    bg-white outline-none
                    focus:border-[#111827]
                  "
                                >
                                    {sessionsLoading ? (
                                        <option value="">Loading sessions…</option>
                                    ) : sessions.length === 0 ? (
                                        <option value="">No sessions found</option>
                                    ) : (
                                        sessions.map((s) => {
                                            const when = fmtWhen(s.start_time);
                                            const isInf = safeLower(s.session_format_type) === "infinite";
                                            const label = `${s.title || "Session"}${isInf ? " · ∞" : when ? ` · ${when}` : ""}`;
                                            return (
                                                <option key={s.id} value={s.id}>
                                                    {label}
                                                </option>
                                            );
                                        })
                                    )}
                                </select>

                                {selectedSession && (
                                    <div className="mt-2 text-[12px] text-[#606060]">
                                        {safeLower(selectedSession.session_format_type) === "infinite"
                                            ? "Infinite session"
                                            : selectedSession.start_time
                                                ? `Starts: ${fmtWhen(selectedSession.start_time)}`
                                                : "Scheduled session"}
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    className={btnGhost}
                                    onClick={() => {
                                        if (!sessionId) return;
                                        loadIntentions(sessionId);
                                    }}
                                    disabled={!sessionId}
                                    style={{ opacity: sessionId ? 1 : 0.5 }}
                                >
                                    Refresh
                                </button>

                                <button
                                    className={btnGhost}
                                    onClick={() => loadLibrary()}
                                    title="Refresh your library"
                                >
                                    Refresh library
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* main grid */}
                <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* left: intentions for this session */}
                    <div className={softCard}>
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-[16px] font-bold text-[#111827]">Intentions for this session</div>

                            <div className="flex items-center gap-2">
                                <button
                                    className={[pill, tab === "my" ? pillActive : pillIdle].join(" ")}
                                    onClick={() => setTab("my")}
                                    type="button"
                                >
                                    My
                                </button>
                                <button
                                    className={[pill, tab === "team" ? pillActive : pillIdle].join(" ")}
                                    onClick={() => setTab("team")}
                                    type="button"
                                >
                                    Team
                                </button>
                            </div>
                        </div>

                        <div className="mt-4 flex items-center gap-2">
                            <input
                                value={newText}
                                onChange={(e) => setNewText(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                                placeholder="Add an intention…"
                                className="
                  flex-1 h-11 px-4 rounded-full
                  border border-[#E5E7EB]
                  text-[13px] text-[#111827]
                  outline-none focus:border-[#111827]
                "
                            />
                            <button className={btnPrimary} onClick={handleAdd} type="button" disabled={!sessionId}>
                                Add
                            </button>
                        </div>

                        <div className="mt-4">
                            {loadingIntentions ? (
                                <div className="text-[13px] text-[#606060] italic">Loading…</div>
                            ) : visibleIntentions.length === 0 ? (
                                <div className="text-[13px] text-[#606060] italic">
                                    {tab === "my" ? "No intentions yet." : "No team intentions yet."}
                                </div>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {visibleIntentions.map((i) => {
                                        const isEditing = editingId === i.id;
                                        const isDone = Boolean(i.completed);

                                        const who =
                                            i.user_id === user.id
                                                ? "You"
                                                : i.profiles?.full_name || "Participant";

                                        return (
                                            <div
                                                key={i.id}
                                                className="
                          rounded-[18px] border border-[#F0F0F0]
                          hover:bg-[#F6F6F6] hover:border-[#E5E7EB]
                          transition px-4 py-3
                        "
                                                onClick={() => toggleCompleted(i)}
                                                role="button"
                                                tabIndex={0}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div
                                                        className="
                              mt-[2px] h-5 w-5 rounded-full border
                              flex items-center justify-center
                            "
                                                        style={{
                                                            borderColor: isDone ? "#65D46C" : "#D1D5DB",
                                                            background: isDone ? "rgba(101,212,108,0.15)" : "transparent",
                                                        }}
                                                    >
                                                        {isDone ? (
                                                            <div className="h-2.5 w-2.5 rounded-full" style={{ background: "#65D46C" }} />
                                                        ) : null}
                                                    </div>

                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-[11px] text-[#606060] mb-1">{who}</div>

                                                        {!isEditing ? (
                                                            <div
                                                                className={[
                                                                    "text-[13px] leading-5 break-words",
                                                                    isDone ? "text-[#606060] line-through" : "text-[#111827]",
                                                                ].join(" ")}
                                                            >
                                                                {i.text}
                                                            </div>
                                                        ) : (
                                                            <input
                                                                value={editingText}
                                                                onChange={(e) => setEditingText(e.target.value)}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === "Enter") saveEdit();
                                                                    if (e.key === "Escape") cancelEdit();
                                                                }}
                                                                className="
                                  w-full h-10 px-3 rounded-[14px]
                                  border border-[#E5E7EB]
                                  text-[13px] text-[#111827]
                                  outline-none focus:border-[#111827]
                                "
                                                                autoFocus
                                                                onClick={(e) => e.stopPropagation()}
                                                            />
                                                        )}
                                                    </div>

                                                    {/* actions (only for my items in MVP) */}
                                                    {i.user_id === user.id && (
                                                        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                                                            {!isEditing ? (
                                                                <>
                                                                    <button
                                                                        className="h-10 px-3 rounded-full border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[12px] font-semibold"
                                                                        onClick={() => startEdit(i)}
                                                                        type="button"
                                                                    >
                                                                        Edit
                                                                    </button>
                                                                    <button
                                                                        className="h-10 px-3 rounded-full border border-[#F65252] bg-[#F65252]/5 text-[#F65252] hover:bg-[#F65252]/10 text-[12px] font-semibold"
                                                                        onClick={() => detach(i.id)}
                                                                        type="button"
                                                                    >
                                                                        Detach
                                                                    </button>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <button
                                                                        className="h-10 px-3 rounded-full border border-[#111827] bg-[#111827] text-white hover:opacity-90 text-[12px] font-semibold"
                                                                        onClick={saveEdit}
                                                                        type="button"
                                                                    >
                                                                        Save
                                                                    </button>
                                                                    <button
                                                                        className="h-10 px-3 rounded-full border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[12px] font-semibold"
                                                                        onClick={cancelEdit}
                                                                        type="button"
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                </>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* right: library */}
                    <div className={softCard}>
                        <div className="text-[16px] font-bold text-[#111827]">My library</div>
                        <div className="mt-1 text-[13px] text-[#606060]">
                            Quick-attach your recent intentions to the selected session.
                        </div>

                        <div className="mt-4">
                            {loadingLibrary ? (
                                <div className="text-[13px] text-[#606060] italic">Loading…</div>
                            ) : library.length === 0 ? (
                                <div className="text-[13px] text-[#606060] italic">
                                    No recent intentions yet. Create one on the left.
                                </div>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {library.map((it) => {
                                        const text = String(it.text || "").trim();
                                        const already = myTextSet.has(text.toLowerCase());

                                        return (
                                            <div
                                                key={it.id}
                                                className="
                          rounded-[18px] border border-[#F0F0F0]
                          hover:bg-[#F6F6F6] hover:border-[#E5E7EB]
                          transition px-4 py-3
                          flex items-center gap-3
                        "
                                            >
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-[13px] text-[#111827] break-words leading-5">{text}</div>
                                                    <div className="mt-1 text-[11px] text-[#606060]">
                                                        {it.created_at ? `Last used: ${fmtWhen(it.created_at)}` : ""}
                                                    </div>
                                                </div>

                                                {already ? (
                                                    <div className="text-[12px] font-semibold text-[#65D46C] whitespace-nowrap">
                                                        Attached
                                                    </div>
                                                ) : (
                                                    <button
                                                        className="h-10 px-4 rounded-full border border-[#111827] text-[#111827] hover:bg-[#111827] hover:text-white transition text-[12px] font-semibold whitespace-nowrap"
                                                        onClick={() => attachFromLibrary(text)}
                                                        type="button"
                                                        disabled={!sessionId}
                                                        style={{ opacity: sessionId ? 1 : 0.5 }}
                                                    >
                                                        Attach
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="mt-5 text-[12px] text-[#606060]">
                            MVP note: library is built from your recent intentions (unique by text).
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
