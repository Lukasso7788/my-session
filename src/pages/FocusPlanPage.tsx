// src/pages/FocusPlanPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Check, Trash2, Plus, ExternalLink, RefreshCw } from "lucide-react";

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

type PlanItem = {
    id: string;
    text: string;
    due_at?: string | null; // ISO
    session_id?: string | null; // UUID
    done?: boolean;

    // local UX flags (MVP)
    attached?: boolean; // user clicked "Attach to session"
    attached_at?: string | null; // ISO
};

type Plan = {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
    items: PlanItem[];
};

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function fmtDue(iso?: string | null) {
    if (!iso) return "";
    const ms = Date.parse(String(iso));
    if (!Number.isFinite(ms)) return "";
    try {
        return new Date(ms).toLocaleString("en-US", {
            weekday: "short",
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

function uid(prefix = "id") {
    return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

function storageKey(userId: string) {
    return `mysession_focus_plans_v1_${userId}`;
}

function safeParsePlans(raw: string | null): Plan[] {
    if (!raw) return [];
    try {
        const v = JSON.parse(raw);
        if (!Array.isArray(v)) return [];
        // very light validation
        return v
            .filter((p) => p && typeof p === "object" && typeof p.id === "string")
            .map((p) => ({
                id: String(p.id),
                title: String(p.title || "Plan"),
                created_at: String(p.created_at || new Date().toISOString()),
                updated_at: String(p.updated_at || new Date().toISOString()),
                items: Array.isArray(p.items)
                    ? p.items.map((it: any) => ({
                        id: String(it.id || uid("item")),
                        text: String(it.text || "").trim(),
                        due_at: it.due_at ? String(it.due_at) : null,
                        session_id: it.session_id ? String(it.session_id) : null,
                        done: Boolean(it.done),
                        attached: Boolean(it.attached),
                        attached_at: it.attached_at ? String(it.attached_at) : null,
                    }))
                    : [],
            }));
    } catch {
        return [];
    }
}

export default function FocusPlanPage() {
    const navigate = useNavigate();
    const [sp, setSp] = useSearchParams();

    // optional: deep-link from room: /focus-plan?sessionId=...
    const initialParam = (sp.get("sessionId") || "").trim();

    const [user, setUser] = useState<any>(null);

    // sessions
    const [sessions, setSessions] = useState<SessionLite[]>([]);
    const [sessionsLoading, setSessionsLoading] = useState(true);

    // default session for "new item" (raw may be uuid or slug)
    const [rawDefaultSession, setRawDefaultSession] = useState<string>(initialParam);
    const [defaultSessionId, setDefaultSessionId] = useState<string | null>(null);

    // library (recent unique intentions)
    const [library, setLibrary] = useState<IntentionRow[]>([]);
    const [loadingLibrary, setLoadingLibrary] = useState(false);

    // plans
    const [plans, setPlans] = useState<Plan[]>([]);
    const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

    // plan create/rename
    const [newPlanTitle, setNewPlanTitle] = useState("");
    const [editingPlanTitle, setEditingPlanTitle] = useState(false);
    const [planTitleDraft, setPlanTitleDraft] = useState("");

    // item add form
    const [newItemText, setNewItemText] = useState("");
    const [newItemDueLocal, setNewItemDueLocal] = useState(""); // "YYYY-MM-DDTHH:mm" local
    const [newItemSessionId, setNewItemSessionId] = useState<string>("");

    // item edit
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [editingItemText, setEditingItemText] = useState("");
    const [editingItemDueLocal, setEditingItemDueLocal] = useState("");
    const [editingItemSessionId, setEditingItemSessionId] = useState<string>("");

    // attach loading
    const [attachingItemId, setAttachingItemId] = useState<string | null>(null);

    // seq guards
    const libSeqRef = useRef(0);

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
                const { data, error } = await supabase
                    .from("sessions")
                    .select("id, title, start_time, duration_minutes, session_format_type, custom_slug")
                    .order("start_time", { ascending: true })
                    .limit(150);

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

    // resolve default session uuid from uuid/slug
    useEffect(() => {
        let cancelled = false;

        (async () => {
            const raw = String(rawDefaultSession || "").trim();
            if (!raw) {
                if (!cancelled) setDefaultSessionId(null);
                return;
            }

            if (UUID_RE.test(raw)) {
                if (!cancelled) setDefaultSessionId(raw);
                return;
            }

            const slug = raw.toLowerCase();

            const fromList = sessions.find((s) => safeLower(s.custom_slug) === slug);
            if (fromList?.id) {
                if (!cancelled) setDefaultSessionId(String(fromList.id));
                return;
            }

            try {
                const { data, error } = await supabase
                    .from("sessions")
                    .select("id")
                    .eq("custom_slug", slug)
                    .maybeSingle();

                if (!cancelled) {
                    if (!error && data?.id) setDefaultSessionId(String(data.id));
                    else setDefaultSessionId(null);
                }
            } catch {
                if (!cancelled) setDefaultSessionId(null);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [rawDefaultSession, sessions]);

    // keep query param in sync (nice UX)
    useEffect(() => {
        const raw = String(rawDefaultSession || "").trim();
        if (!raw) return;
        const cur = (sp.get("sessionId") || "").trim();
        if (cur === raw) return;

        sp.set("sessionId", raw);
        setSp(sp, { replace: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rawDefaultSession]);

    // default session flows into "new item"
    useEffect(() => {
        if (!defaultSessionId) return;
        if (newItemSessionId) return;
        setNewItemSessionId(defaultSessionId);
    }, [defaultSessionId, newItemSessionId]);

    const defaultSession = useMemo(() => {
        if (!defaultSessionId) return null;
        return sessions.find((s) => String(s.id) === String(defaultSessionId)) || null;
    }, [sessions, defaultSessionId]);

    // ===== plans persistence (localStorage MVP) =====
    useEffect(() => {
        if (!user?.id) return;

        const key = storageKey(user.id);
        const loaded = safeParsePlans(localStorage.getItem(key));

        if (loaded.length === 0) {
            const now = new Date().toISOString();
            const starter: Plan = {
                id: uid("plan"),
                title: "My plan",
                created_at: now,
                updated_at: now,
                items: [],
            };
            setPlans([starter]);
            setSelectedPlanId(starter.id);
            localStorage.setItem(key, JSON.stringify([starter]));
            return;
        }

        setPlans(loaded);
        setSelectedPlanId(loaded[0]?.id || null);
    }, [user?.id]);

    const persistPlans = (next: Plan[]) => {
        if (!user?.id) return;
        setPlans(next);
        localStorage.setItem(storageKey(user.id), JSON.stringify(next));
    };

    const selectedPlan = useMemo(() => {
        if (!selectedPlanId) return null;
        return plans.find((p) => p.id === selectedPlanId) || null;
    }, [plans, selectedPlanId]);

    // ===== library (recent unique intentions) =====
    const loadLibrary = async () => {
        if (!user?.id) return;

        const seq = ++libSeqRef.current;
        setLoadingLibrary(true);

        try {
            const { data, error } = await supabase
                .from("intentions")
                .select("id, text, user_id, session_id, created_at, completed")
                .eq("user_id", user.id)
                .order("created_at", { ascending: false })
                .limit(120);

            if (seq !== libSeqRef.current) return;

            if (error || !Array.isArray(data)) {
                setLibrary([]);
                return;
            }

            const seen = new Set<string>();
            const out: IntentionRow[] = [];
            for (const row of data as any[]) {
                const t = String(row?.text || "").trim();
                if (!t) continue;
                const k = t.toLowerCase();
                if (seen.has(k)) continue;
                seen.add(k);
                out.push(row as any);
                if (out.length >= 24) break;
            }
            setLibrary(out);
        } finally {
            if (seq === libSeqRef.current) setLoadingLibrary(false);
        }
    };

    useEffect(() => {
        if (!user?.id) return;
        loadLibrary();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]);

    // ===== auth guard =====
    const requireAuth = () => {
        if (user?.id) return true;
        navigate(buildLoginNext("/focus-plan"));
        return false;
    };

    // ===== plan actions =====
    const createPlan = () => {
        if (!requireAuth()) return;

        const t = newPlanTitle.trim();
        if (!t) return;

        const now = new Date().toISOString();
        const p: Plan = {
            id: uid("plan"),
            title: t,
            created_at: now,
            updated_at: now,
            items: [],
        };

        const next = [p, ...plans];
        persistPlans(next);
        setSelectedPlanId(p.id);
        setNewPlanTitle("");
        setEditingPlanTitle(false);
    };

    const deletePlan = (id: string) => {
        if (!requireAuth()) return;
        const next = plans.filter((p) => p.id !== id);
        persistPlans(next);

        if (selectedPlanId === id) {
            setSelectedPlanId(next[0]?.id || null);
            setEditingPlanTitle(false);
        }
    };

    const beginRenamePlan = () => {
        if (!selectedPlan) return;
        setEditingPlanTitle(true);
        setPlanTitleDraft(selectedPlan.title || "");
    };

    const saveRenamePlan = () => {
        if (!requireAuth()) return;
        if (!selectedPlan) return;

        const t = planTitleDraft.trim();
        if (!t) return;

        const now = new Date().toISOString();
        const next = plans.map((p) =>
            p.id === selectedPlan.id ? { ...p, title: t, updated_at: now } : p
        );
        persistPlans(next);
        setEditingPlanTitle(false);
    };

    const cancelRenamePlan = () => {
        setEditingPlanTitle(false);
        setPlanTitleDraft("");
    };

    // ===== item actions =====
    const addItemToPlan = () => {
        if (!requireAuth()) return;
        if (!selectedPlan) return;

        const text = newItemText.trim();
        if (!text) return;

        const dueIso = newItemDueLocal ? new Date(newItemDueLocal).toISOString() : null;
        const sid = newItemSessionId ? String(newItemSessionId) : null;

        const now = new Date().toISOString();
        const item: PlanItem = {
            id: uid("item"),
            text,
            due_at: dueIso,
            session_id: sid,
            done: false,
            attached: false,
            attached_at: null,
        };

        const next = plans.map((p) =>
            p.id === selectedPlan.id ? { ...p, items: [item, ...p.items], updated_at: now } : p
        );
        persistPlans(next);

        setNewItemText("");
        setNewItemDueLocal("");
        // keep session selection as-is (good UX)
    };

    const deleteItem = (itemId: string) => {
        if (!requireAuth()) return;
        if (!selectedPlan) return;

        const now = new Date().toISOString();
        const next = plans.map((p) =>
            p.id === selectedPlan.id
                ? { ...p, items: p.items.filter((it) => it.id !== itemId), updated_at: now }
                : p
        );
        persistPlans(next);

        if (editingItemId === itemId) {
            setEditingItemId(null);
            setEditingItemText("");
            setEditingItemDueLocal("");
            setEditingItemSessionId("");
        }
    };

    const toggleItemDone = (itemId: string) => {
        if (!requireAuth()) return;
        if (!selectedPlan) return;

        const now = new Date().toISOString();
        const next = plans.map((p) =>
            p.id === selectedPlan.id
                ? {
                    ...p,
                    updated_at: now,
                    items: p.items.map((it) =>
                        it.id === itemId ? { ...it, done: !Boolean(it.done) } : it
                    ),
                }
                : p
        );
        persistPlans(next);
    };

    const startEditItem = (it: PlanItem) => {
        setEditingItemId(it.id);
        setEditingItemText(it.text || "");
        setEditingItemSessionId(it.session_id || "");
        setEditingItemDueLocal(it.due_at ? new Date(it.due_at).toISOString().slice(0, 16) : "");
    };

    const cancelEditItem = () => {
        setEditingItemId(null);
        setEditingItemText("");
        setEditingItemDueLocal("");
        setEditingItemSessionId("");
    };

    const saveEditItem = () => {
        if (!requireAuth()) return;
        if (!selectedPlan) return;
        if (!editingItemId) return;

        const text = editingItemText.trim();
        if (!text) return;

        const dueIso = editingItemDueLocal ? new Date(editingItemDueLocal).toISOString() : null;
        const sid = editingItemSessionId ? String(editingItemSessionId) : null;

        const now = new Date().toISOString();
        const next = plans.map((p) =>
            p.id === selectedPlan.id
                ? {
                    ...p,
                    updated_at: now,
                    items: p.items.map((it) =>
                        it.id === editingItemId
                            ? {
                                ...it,
                                text,
                                due_at: dueIso,
                                session_id: sid,
                                // editing changes may invalidate "attached" meaning
                                attached: it.attached && it.session_id === sid ? it.attached : false,
                                attached_at: it.attached && it.session_id === sid ? it.attached_at : null,
                            }
                            : it
                    ),
                }
                : p
        );
        persistPlans(next);
        cancelEditItem();
    };

    const addLibraryTextToPlan = (text: string) => {
        if (!requireAuth()) return;
        if (!selectedPlan) return;

        const t = String(text || "").trim();
        if (!t) return;

        setNewItemText(t);
    };

    // attach = create real intention row (so it appears in room panel)
    const attachItemToSession = async (item: PlanItem) => {
        if (!requireAuth()) return;
        if (!selectedPlan) return;

        const sid = String(item.session_id || "").trim();
        const text = String(item.text || "").trim();
        if (!sid || !UUID_RE.test(sid) || !text) return;

        setAttachingItemId(item.id);

        try {
            // avoid obvious duplicates for this user/session/text
            const { data: existing } = await supabase
                .from("intentions")
                .select("id")
                .eq("user_id", user.id)
                .eq("session_id", sid)
                .eq("text", text)
                .limit(1);

            if (!existing || existing.length === 0) {
                const { error } = await supabase
                    .from("intentions")
                    .insert([{ user_id: user.id, session_id: sid, text, completed: false }]);

                // if insert fails, just keep UI untouched
                if (error) return;
            }

            const now = new Date().toISOString();
            const next = plans.map((p) =>
                p.id === selectedPlan.id
                    ? {
                        ...p,
                        updated_at: now,
                        items: p.items.map((it) =>
                            it.id === item.id ? { ...it, attached: true, attached_at: now } : it
                        ),
                    }
                    : p
            );
            persistPlans(next);
            loadLibrary();
        } finally {
            setAttachingItemId(null);
        }
    };

    const openRoom = (sessionId?: string | null) => {
        const sid = String(sessionId || "").trim();
        if (!sid) return;
        navigate(`/room-iframe/${sid}`);
    };

    const pageWrap = "w-full max-w-[1200px] mx-auto px-4 md:px-6 py-8";
    const card =
        "border border-borderGray rounded-[42px] bg-white p-6 md:p-7 transition-all duration-200";
    const softCard =
        "border border-[#E5E7EB] rounded-[24px] bg-white p-4 md:p-5";

    const btnPrimary =
        "h-11 rounded-full px-5 text-[13px] font-semibold border border-[#111827] bg-[#111827] text-white hover:opacity-90 transition";
    const btnGhost =
        "h-11 rounded-full px-5 text-[13px] font-semibold border border-[#E5E7EB] hover:bg-[#F3F4F6] transition";

    const inputPill =
        "h-11 px-4 rounded-full border border-[#E5E7EB] text-[13px] text-[#111827] outline-none focus:border-[#111827] bg-white";

    if (!user?.id) {
        return (
            <div className={pageWrap}>
                <div className={card}>
                    <div className="text-[28px] md:text-[34px] font-bold text-[#111827] leading-tight">
                        Focus plan
                    </div>
                    <div className="mt-2 text-[13px] text-[#606060]">
                        Build your plan: intentions + due dates + session links.
                    </div>

                    <div className="mt-6 flex flex-col sm:flex-row gap-3">
                        <button
                            className={btnPrimary}
                            onClick={() => navigate(buildLoginNext("/focus-plan"))}
                            type="button"
                        >
                            Log in
                        </button>
                        <Link
                            to="/sessions"
                            className={btnGhost + " inline-flex items-center justify-center"}
                        >
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
                {/* header */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                        <div className="text-[28px] md:text-[34px] font-bold text-[#111827] leading-tight">
                            Focus plan
                        </div>
                        <div className="mt-2 text-[13px] text-[#606060]">
                            Plans → items (intentions) → due date → session link → attach to room.
                        </div>

                        {defaultSession ? (
                            <div className="mt-2 text-[12px] text-[#606060]">
                                Default session for new items:{" "}
                                <span className="font-semibold text-[#111827]">
                                    {defaultSession.title || "Session"}
                                </span>
                                {safeLower(defaultSession.session_format_type) === "infinite"
                                    ? " · ∞"
                                    : defaultSession.start_time
                                        ? ` · ${fmtWhen(defaultSession.start_time)}`
                                        : ""}
                            </div>
                        ) : rawDefaultSession ? (
                            <div className="mt-2 text-[12px] text-[#606060]">
                                Default session: resolving…
                            </div>
                        ) : null}
                    </div>

                    <div className="flex items-center gap-3">
                        <Link
                            to="/sessions"
                            className={btnGhost + " inline-flex items-center justify-center"}
                        >
                            Sessions
                        </Link>

                        <button
                            className={btnGhost}
                            onClick={() => loadLibrary()}
                            type="button"
                            title="Refresh library"
                        >
                            <span className="inline-flex items-center gap-2">
                                <RefreshCw size={16} />
                                Refresh
                            </span>
                        </button>
                    </div>
                </div>

                {/* default session picker (optional) */}
                <div className="mt-6">
                    <div className={softCard}>
                        <div className="text-[12px] font-semibold text-[#111827] mb-2">
                            Default session (optional)
                        </div>

                        <div className="flex flex-col md:flex-row gap-3 md:items-center">
                            <div className="flex-1">
                                <select
                                    value={rawDefaultSession}
                                    onChange={(e) => setRawDefaultSession(e.target.value)}
                                    className="w-full h-11 px-4 rounded-full border border-[#E5E7EB] text-[13px] font-semibold text-[#111827] bg-white outline-none focus:border-[#111827]"
                                >
                                    <option value="">— none —</option>
                                    {sessionsLoading ? (
                                        <option value="" disabled>
                                            Loading sessions…
                                        </option>
                                    ) : sessions.length === 0 ? (
                                        <option value="" disabled>
                                            No sessions found
                                        </option>
                                    ) : (
                                        sessions.map((s) => {
                                            const when = fmtWhen(s.start_time);
                                            const isInf = safeLower(s.session_format_type) === "infinite";
                                            const label = `${s.title || "Session"}${isInf ? " · ∞" : when ? ` · ${when}` : ""
                                                }`;
                                            return (
                                                <option key={s.id} value={s.id}>
                                                    {label}
                                                </option>
                                            );
                                        })
                                    )}
                                </select>

                                <div className="mt-2 text-[12px] text-[#606060]">
                                    If you open this page from the room later, we can auto-set this.
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    className={btnGhost}
                                    onClick={() => {
                                        sp.delete("sessionId");
                                        setSp(sp, { replace: true });
                                        setRawDefaultSession("");
                                        setDefaultSessionId(null);
                                        setNewItemSessionId("");
                                    }}
                                    type="button"
                                >
                                    Clear
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* main grid */}
                <div className="mt-6 grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
                    {/* left: plans */}
                    <div className={softCard}>
                        <div className="text-[16px] font-bold text-[#111827]">Plans</div>
                        <div className="mt-1 text-[13px] text-[#606060]">
                            Create a plan, then add items.
                        </div>

                        {/* create plan */}
                        <div className="mt-4 flex items-center gap-2">
                            <input
                                value={newPlanTitle}
                                onChange={(e) => setNewPlanTitle(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && createPlan()}
                                placeholder="New plan title…"
                                className={"flex-1 " + inputPill}
                            />
                            <button className={btnPrimary} onClick={createPlan} type="button" title="Create plan">
                                <span className="inline-flex items-center gap-2">
                                    <Plus size={16} />
                                    Create
                                </span>
                            </button>
                        </div>

                        {/* plan list */}
                        <div className="mt-4 flex flex-col gap-2">
                            {plans.length === 0 ? (
                                <div className="text-[13px] text-[#606060] italic">No plans yet.</div>
                            ) : (
                                plans.map((p) => {
                                    const active = p.id === selectedPlanId;
                                    return (
                                        <button
                                            key={p.id}
                                            onClick={() => {
                                                setSelectedPlanId(p.id);
                                                setEditingPlanTitle(false);
                                            }}
                                            className={[
                                                "w-full text-left rounded-[18px] px-4 py-3 border transition",
                                                active
                                                    ? "border-[#111827] bg-[#111827] text-white"
                                                    : "border-[#F0F0F0] hover:bg-[#F6F6F6] hover:border-[#E5E7EB] text-[#111827]",
                                            ].join(" ")}
                                            type="button"
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div
                                                        className={[
                                                            "text-[13px] font-semibold truncate",
                                                            active ? "text-white" : "text-[#111827]",
                                                        ].join(" ")}
                                                    >
                                                        {p.title}
                                                    </div>
                                                    <div
                                                        className={[
                                                            "text-[11px] mt-1",
                                                            active ? "text-white/70" : "text-[#606060]",
                                                        ].join(" ")}
                                                    >
                                                        {p.items.length} items
                                                    </div>
                                                </div>

                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        deletePlan(p.id);
                                                    }}
                                                    className={[
                                                        "h-10 w-10 rounded-full border flex items-center justify-center transition",
                                                        active
                                                            ? "border-white/25 hover:bg-white/10"
                                                            : "border-[#E5E7EB] hover:bg-[#F3F4F6]",
                                                    ].join(" ")}
                                                    type="button"
                                                    title="Delete plan"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* right: plan builder */}
                    <div className={softCard}>
                        {!selectedPlan ? (
                            <div className="text-[13px] text-[#606060] italic">
                                Select or create a plan.
                            </div>
                        ) : (
                            <>
                                {/* plan title row */}
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        {!editingPlanTitle ? (
                                            <div className="flex items-center gap-2">
                                                <div className="text-[18px] font-bold text-[#111827] truncate">
                                                    {selectedPlan.title}
                                                </div>
                                                <button
                                                    onClick={beginRenamePlan}
                                                    className="h-10 px-4 rounded-full border border-[#E5E7EB] hover:bg-[#F3F4F6] transition text-[12px] font-semibold"
                                                    type="button"
                                                >
                                                    Rename
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                                                <input
                                                    value={planTitleDraft}
                                                    onChange={(e) => setPlanTitleDraft(e.target.value)}
                                                    onKeyDown={(e) => e.key === "Enter" && saveRenamePlan()}
                                                    className={"flex-1 " + inputPill}
                                                    placeholder="Plan title…"
                                                />
                                                <div className="flex items-center gap-2">
                                                    <button className={btnPrimary} onClick={saveRenamePlan} type="button">
                                                        Save
                                                    </button>
                                                    <button className={btnGhost} onClick={cancelRenamePlan} type="button">
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        <div className="mt-1 text-[12px] text-[#606060]">
                                            Updated: {fmtWhen(selectedPlan.updated_at)}
                                        </div>
                                    </div>
                                </div>

                                {/* add item */}
                                <div className="mt-5 border border-[#F0F0F0] rounded-[22px] p-4 md:p-5">
                                    <div className="text-[14px] font-bold text-[#111827]">
                                        Add item
                                    </div>
                                    <div className="mt-1 text-[12px] text-[#606060]">
                                        Each item = intention + due date + session link.
                                    </div>

                                    <div className="mt-4 flex flex-col gap-3">
                                        <input
                                            value={newItemText}
                                            onChange={(e) => setNewItemText(e.target.value)}
                                            onKeyDown={(e) => e.key === "Enter" && addItemToPlan()}
                                            placeholder="What will you work on? (intention)…"
                                            className={inputPill}
                                        />

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div>
                                                <div className="text-[11px] font-semibold text-[#606060] mb-2">
                                                    Due date (optional)
                                                </div>
                                                <input
                                                    type="datetime-local"
                                                    value={newItemDueLocal}
                                                    onChange={(e) => setNewItemDueLocal(e.target.value)}
                                                    className={inputPill}
                                                />
                                            </div>

                                            <div>
                                                <div className="text-[11px] font-semibold text-[#606060] mb-2">
                                                    Session (optional)
                                                </div>
                                                <select
                                                    value={newItemSessionId}
                                                    onChange={(e) => setNewItemSessionId(e.target.value)}
                                                    className="w-full h-11 px-4 rounded-full border border-[#E5E7EB] text-[13px] font-semibold text-[#111827] bg-white outline-none focus:border-[#111827]"
                                                >
                                                    <option value="">— none —</option>
                                                    {sessionsLoading ? (
                                                        <option value="" disabled>
                                                            Loading sessions…
                                                        </option>
                                                    ) : sessions.length === 0 ? (
                                                        <option value="" disabled>
                                                            No sessions found
                                                        </option>
                                                    ) : (
                                                        sessions.map((s) => {
                                                            const when = fmtWhen(s.start_time);
                                                            const isInf = safeLower(s.session_format_type) === "infinite";
                                                            const label = `${s.title || "Session"}${isInf ? " · ∞" : when ? ` · ${when}` : ""
                                                                }`;
                                                            return (
                                                                <option key={s.id} value={s.id}>
                                                                    {label}
                                                                </option>
                                                            );
                                                        })
                                                    )}
                                                </select>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <button className={btnPrimary} onClick={addItemToPlan} type="button">
                                                <span className="inline-flex items-center gap-2">
                                                    <Plus size={16} />
                                                    Add to plan
                                                </span>
                                            </button>
                                            <button
                                                className={btnGhost}
                                                onClick={() => {
                                                    setNewItemText("");
                                                    setNewItemDueLocal("");
                                                }}
                                                type="button"
                                            >
                                                Clear
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* items list */}
                                <div className="mt-5">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="text-[16px] font-bold text-[#111827]">
                                            Items
                                        </div>
                                        <div className="text-[12px] text-[#606060]">
                                            {selectedPlan.items.length} total
                                        </div>
                                    </div>

                                    <div className="mt-3 flex flex-col gap-2">
                                        {selectedPlan.items.length === 0 ? (
                                            <div className="text-[13px] text-[#606060] italic">
                                                Add your first item above.
                                            </div>
                                        ) : (
                                            selectedPlan.items.map((it) => {
                                                const isEditing = editingItemId === it.id;
                                                const done = Boolean(it.done);

                                                const session =
                                                    it.session_id
                                                        ? sessions.find((s) => String(s.id) === String(it.session_id))
                                                        : null;

                                                const canAttach =
                                                    Boolean(it.session_id) &&
                                                    UUID_RE.test(String(it.session_id)) &&
                                                    String(it.text || "").trim().length > 0;

                                                const attached = Boolean(it.attached);

                                                return (
                                                    <div
                                                        key={it.id}
                                                        className="rounded-[18px] border border-[#F0F0F0] hover:bg-[#F6F6F6] hover:border-[#E5E7EB] transition px-4 py-3"
                                                    >
                                                        {!isEditing ? (
                                                            <div className="flex items-start gap-3">
                                                                <button
                                                                    className="mt-[2px] h-6 w-6 rounded-full border border-[#D1D5DB] flex items-center justify-center hover:bg-white transition"
                                                                    onClick={() => toggleItemDone(it.id)}
                                                                    type="button"
                                                                    title={done ? "Mark as not done" : "Mark as done"}
                                                                    style={{
                                                                        borderColor: done ? "#65D46C" : "#D1D5DB",
                                                                        background: done ? "rgba(101,212,108,0.15)" : "transparent",
                                                                    }}
                                                                >
                                                                    {done ? <Check size={14} color="#2F2F2F" /> : null}
                                                                </button>

                                                                <div className="flex-1 min-w-0">
                                                                    <div
                                                                        className={[
                                                                            "text-[13px] leading-5 break-words",
                                                                            done ? "text-[#606060] line-through" : "text-[#111827]",
                                                                        ].join(" ")}
                                                                    >
                                                                        {it.text}
                                                                    </div>

                                                                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-[#606060]">
                                                                        {it.due_at ? (
                                                                            <span className="px-3 py-1 rounded-full border border-[#E5E7EB] bg-white">
                                                                                Due: <span className="font-semibold text-[#111827]">{fmtDue(it.due_at)}</span>
                                                                            </span>
                                                                        ) : null}

                                                                        {session ? (
                                                                            <span className="px-3 py-1 rounded-full border border-[#E5E7EB] bg-white">
                                                                                Session:{" "}
                                                                                <span className="font-semibold text-[#111827]">
                                                                                    {session.title || "Session"}
                                                                                </span>
                                                                                {safeLower(session.session_format_type) === "infinite"
                                                                                    ? " · ∞"
                                                                                    : session.start_time
                                                                                        ? ` · ${fmtWhen(session.start_time)}`
                                                                                        : ""}
                                                                            </span>
                                                                        ) : it.session_id ? (
                                                                            <span className="px-3 py-1 rounded-full border border-[#E5E7EB] bg-white">
                                                                                Session: <span className="font-semibold text-[#111827]">resolving…</span>
                                                                            </span>
                                                                        ) : (
                                                                            <span className="px-3 py-1 rounded-full border border-[#E5E7EB] bg-white">
                                                                                Session: <span className="font-semibold text-[#111827]">—</span>
                                                                            </span>
                                                                        )}

                                                                        {attached ? (
                                                                            <span className="px-3 py-1 rounded-full border border-[#65D46C] bg-[#65D46C]/10 text-[#2F2F2F] font-semibold">
                                                                                Attached to room
                                                                            </span>
                                                                        ) : null}
                                                                    </div>
                                                                </div>

                                                                {/* actions */}
                                                                <div className="flex items-center gap-2 shrink-0">
                                                                    <button
                                                                        className="h-10 px-4 rounded-full border border-[#E5E7EB] hover:bg-[#F3F4F6] transition text-[12px] font-semibold"
                                                                        onClick={() => startEditItem(it)}
                                                                        type="button"
                                                                    >
                                                                        Edit
                                                                    </button>

                                                                    <button
                                                                        className="h-10 w-10 rounded-full border border-[#E5E7EB] hover:bg-[#F3F4F6] transition flex items-center justify-center"
                                                                        onClick={() => deleteItem(it.id)}
                                                                        type="button"
                                                                        title="Delete item"
                                                                    >
                                                                        <Trash2 size={16} />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="flex flex-col gap-3">
                                                                <div className="text-[12px] font-semibold text-[#606060]">
                                                                    Edit item
                                                                </div>

                                                                <input
                                                                    value={editingItemText}
                                                                    onChange={(e) => setEditingItemText(e.target.value)}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === "Enter") saveEditItem();
                                                                        if (e.key === "Escape") cancelEditItem();
                                                                    }}
                                                                    className={inputPill}
                                                                    placeholder="Intention…"
                                                                    autoFocus
                                                                />

                                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                                    <div>
                                                                        <div className="text-[11px] font-semibold text-[#606060] mb-2">
                                                                            Due date (optional)
                                                                        </div>
                                                                        <input
                                                                            type="datetime-local"
                                                                            value={editingItemDueLocal}
                                                                            onChange={(e) => setEditingItemDueLocal(e.target.value)}
                                                                            className={inputPill}
                                                                        />
                                                                    </div>

                                                                    <div>
                                                                        <div className="text-[11px] font-semibold text-[#606060] mb-2">
                                                                            Session (optional)
                                                                        </div>
                                                                        <select
                                                                            value={editingItemSessionId}
                                                                            onChange={(e) => setEditingItemSessionId(e.target.value)}
                                                                            className="w-full h-11 px-4 rounded-full border border-[#E5E7EB] text-[13px] font-semibold text-[#111827] bg-white outline-none focus:border-[#111827]"
                                                                        >
                                                                            <option value="">— none —</option>
                                                                            {sessions.map((s) => {
                                                                                const when = fmtWhen(s.start_time);
                                                                                const isInf = safeLower(s.session_format_type) === "infinite";
                                                                                const label = `${s.title || "Session"}${isInf ? " · ∞" : when ? ` · ${when}` : ""
                                                                                    }`;
                                                                                return (
                                                                                    <option key={s.id} value={s.id}>
                                                                                        {label}
                                                                                    </option>
                                                                                );
                                                                            })}
                                                                        </select>
                                                                    </div>
                                                                </div>

                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <button className={btnPrimary} onClick={saveEditItem} type="button">
                                                                        Save
                                                                    </button>
                                                                    <button className={btnGhost} onClick={cancelEditItem} type="button">
                                                                        Cancel
                                                                    </button>
                                                                    <button
                                                                        className="h-11 rounded-full px-5 text-[13px] font-semibold border border-[#F65252] bg-[#F65252]/5 text-[#F65252] hover:bg-[#F65252]/10 transition"
                                                                        onClick={() => deleteItem(it.id)}
                                                                        type="button"
                                                                    >
                                                                        Delete
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* secondary actions row */}
                                                        {!isEditing ? (
                                                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                                                <button
                                                                    className={btnGhost}
                                                                    onClick={() => {
                                                                        if (!it.session_id) return;
                                                                        openRoom(it.session_id);
                                                                    }}
                                                                    type="button"
                                                                    disabled={!it.session_id}
                                                                    style={{ opacity: it.session_id ? 1 : 0.5 }}
                                                                    title={!it.session_id ? "Select a session first" : "Open room"}
                                                                >
                                                                    <span className="inline-flex items-center gap-2">
                                                                        <ExternalLink size={16} />
                                                                        Open room
                                                                    </span>
                                                                </button>

                                                                <button
                                                                    className={btnPrimary}
                                                                    onClick={() => attachItemToSession(it)}
                                                                    type="button"
                                                                    disabled={!canAttach || attachingItemId === it.id}
                                                                    style={{
                                                                        opacity: canAttach ? 1 : 0.5,
                                                                    }}
                                                                    title={
                                                                        !canAttach
                                                                            ? "Set session + intention text first"
                                                                            : attached
                                                                                ? "Already attached (will still be safe)"
                                                                                : "Attach intention to the session (shows in room)"
                                                                    }
                                                                >
                                                                    {attachingItemId === it.id ? "Attaching…" : attached ? "Attached" : "Attach to session"}
                                                                </button>

                                                                <div className="text-[11px] text-[#606060]">
                                                                    Attach = create real intention row for that session.
                                                                </div>
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>

                                {/* library */}
                                <div className="mt-6 border border-[#F0F0F0] rounded-[22px] p-4 md:p-5">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-[14px] font-bold text-[#111827]">
                                                My library
                                            </div>
                                            <div className="mt-1 text-[12px] text-[#606060]">
                                                Your recent intentions (unique by text). Click to fill “Add item”.
                                            </div>
                                        </div>

                                        <button
                                            className={btnGhost}
                                            onClick={() => loadLibrary()}
                                            type="button"
                                            title="Refresh library"
                                        >
                                            <span className="inline-flex items-center gap-2">
                                                <RefreshCw size={16} />
                                                Refresh
                                            </span>
                                        </button>
                                    </div>

                                    <div className="mt-4">
                                        {loadingLibrary ? (
                                            <div className="text-[13px] text-[#606060] italic">Loading…</div>
                                        ) : library.length === 0 ? (
                                            <div className="text-[13px] text-[#606060] italic">
                                                No recent intentions yet. Attach some intentions in rooms first, or create items above.
                                            </div>
                                        ) : (
                                            <div className="flex flex-col gap-2">
                                                {library.map((it) => {
                                                    const text = String(it.text || "").trim();
                                                    return (
                                                        <div
                                                            key={it.id}
                                                            className="rounded-[18px] border border-[#F0F0F0] hover:bg-[#F6F6F6] hover:border-[#E5E7EB] transition px-4 py-3 flex items-center gap-3"
                                                        >
                                                            <div className="flex-1 min-w-0">
                                                                <div className="text-[13px] text-[#111827] break-words leading-5">
                                                                    {text}
                                                                </div>
                                                                <div className="mt-1 text-[11px] text-[#606060]">
                                                                    {it.created_at ? `Last used: ${fmtWhen(it.created_at)}` : ""}
                                                                </div>
                                                            </div>

                                                            <button
                                                                className="h-10 px-4 rounded-full border border-[#111827] text-[#111827] hover:bg-[#111827] hover:text-white transition text-[12px] font-semibold whitespace-nowrap"
                                                                onClick={() => addLibraryTextToPlan(text)}
                                                                type="button"
                                                            >
                                                                Use
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    <div className="mt-4 text-[12px] text-[#606060]">
                                        MVP storage: plans are saved locally in your browser (per user). Next step can be sync to Supabase.
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
