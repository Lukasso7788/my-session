import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  CalendarDays,
  Check,
  GripVertical,
  ListChecks,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { isInfiniteTaskSession, type TaskSessionOption } from "../lib/taskSessionEligibility";
import { useSessionTasks, type SessionTask } from "../hooks/useSessionTasks";

// A movable Tasks pill that floats over the Sessions page. Drag it anywhere;
// click it to open a small Tasks window (drag that by its header). Position
// and open state are remembered per browser.

type Tab = "todo" | "planned" | "done";
type Position = { x: number; y: number };

const STORAGE_KEY = "mysession:tasks-widget:v1";
const EDGE = 12;
const CARD_WIDTH = 368;
const DRAG_THRESHOLD = 4;

function readStored(): { pos: Position | null; open: boolean } {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      return { pos: { x: parsed.x, y: parsed.y }, open: Boolean(parsed.open) };
    }
  } catch {
    // Storage blocked or malformed: fall back to the default spot.
  }
  return { pos: null, open: false };
}

function writeStored(pos: Position, open: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...pos, open }));
  } catch {
    // Not remembered; the widget still works.
  }
}

function formatSessionTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function sessionLabel(session: TaskSessionOption) {
  return session.title || (isInfiniteTaskSession(session) ? "24/7 room" : "Session");
}

function sessionMeta(session: TaskSessionOption) {
  return isInfiniteTaskSession(session) ? "24/7 room · always open" : formatSessionTime(session.start_time);
}

export default function FloatingTasksWidget({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const stored = useRef(readStored()).current;
  const [open, setOpen] = useState(stored.open);
  const [pos, setPos] = useState<Position | null>(stored.pos);
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [pillSize, setPillSize] = useState({ w: 180, h: 36 });
  const [tab, setTab] = useState<Tab>("todo");
  const [draft, setDraft] = useState("");
  const [assigningId, setAssigningId] = useState("");
  const [actionsId, setActionsId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingText, setEditingText] = useState("");
  const [dragging, setDragging] = useState(false);
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origin: Position; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const tasks = useSessionTasks(userId, open);
  const openItems = tasks.items.filter((task) => !task.completed);
  const doneItems = tasks.items.filter((task) => task.completed);
  const plannedItems = openItems.filter((task) => task.session_id && tasks.sessionById.has(String(task.session_id)));
  // The pill shows the task at the top of the to-do list (the newest unless reordered).
  const currentTask = openItems[0] || null;

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    const node = pillRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (rect.width && rect.height) setPillSize({ w: rect.width, h: rect.height });
  }, [open, openItems.length, currentTask?.text]);

  // Until the pill is dragged, it sits where the page reserves a spot for it
  // (the Sessions toolbar), falling back to the bottom right corner.
  const [anchorPos, setAnchorPos] = useState<Position | null>(null);
  useEffect(() => {
    if (pos) return;
    let attempts = 0;
    let timer = 0;
    const locate = () => {
      const anchor = document.querySelector("[data-tasks-pill-anchor]");
      if (anchor) {
        const rect = anchor.getBoundingClientRect();
        setAnchorPos({ x: rect.right - pillSize.w, y: rect.top });
      } else if (attempts++ < 40) {
        timer = window.setTimeout(locate, 100);
      }
    };
    locate();
    return () => window.clearTimeout(timer);
  }, [pos, pillSize.w, viewport.w, viewport.h]);

  const basePos = pos ?? anchorPos ?? { x: viewport.w - pillSize.w - 20, y: viewport.h - pillSize.h - 76 };
  const clampPos = (next: Position): Position => ({
    x: Math.min(Math.max(EDGE, next.x), Math.max(EDGE, viewport.w - pillSize.w - EDGE)),
    y: Math.min(Math.max(EDGE, next.y), Math.max(EDGE, viewport.h - pillSize.h - EDGE)),
  });
  const current = clampPos(basePos);

  useEffect(() => {
    if (pos) writeStored(pos, open);
  }, [pos, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) return;
    setAssigningId("");
    setActionsId("");
    setEditingId("");
  }, [open]);

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { startX: event.clientX, startY: event.clientY, origin: current, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!drag.moved) setDragging(true);
    drag.moved = true;
    setPos(clampPos({ x: drag.origin.x + dx, y: drag.origin.y + dy }));
  };

  const endDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (drag?.moved) suppressClickRef.current = true;
  };

  const dragHandlers = {
    onPointerDown: startDrag,
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };

  if (!userId) return null;

  // The window opens from the pill's corner that faces the middle of the screen.
  const cardWidth = Math.min(CARD_WIDTH, viewport.w - EDGE * 2);
  const opensUp = current.y + pillSize.h / 2 > viewport.h / 2;
  const alignsRight = current.x + pillSize.w / 2 > viewport.w / 2;
  const cardLeft = Math.min(
    Math.max(EDGE, alignsRight ? current.x + pillSize.w - cardWidth : current.x),
    viewport.w - cardWidth - EDGE,
  );
  const cardMaxHeight = Math.min(600, opensUp ? current.y + pillSize.h - EDGE : viewport.h - current.y - EDGE);
  const cardStyle = opensUp
    ? { left: cardLeft, bottom: viewport.h - (current.y + pillSize.h), width: cardWidth, maxHeight: cardMaxHeight }
    : { left: cardLeft, top: current.y, width: cardWidth, maxHeight: cardMaxHeight };

  const assigningTask = tasks.items.find((task) => task.id === assigningId) || null;
  const visibleItems = tab === "done" ? doneItems : tab === "planned" ? plannedItems : openItems;

  const submitDraft = async () => {
    if (await tasks.addTask(draft)) {
      setDraft("");
      setTab("todo");
    }
  };

  const saveEdit = (item: SessionTask) => {
    setEditingId("");
    void tasks.renameTask(item, editingText);
  };

  const renderRow = (item: SessionTask, inSessionGroup = false) => {
    const assigned = item.session_id ? tasks.sessionById.get(String(item.session_id)) : null;
    const assignmentEnded = !!item.session_id && !assigned;
    const peers = tasks.items.filter((task) => task.completed === item.completed);
    const peerIndex = peers.findIndex((task) => task.id === item.id);
    const busy = tasks.busyId === item.id;

    return (
      <li key={item.id} className="rounded-[16px] px-2 py-2.5 hover:bg-[#F7F7F7]">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => void tasks.toggleTask(item)}
            disabled={busy}
            aria-label={item.completed ? "Mark task as not done" : "Mark task as done"}
            className={[
              "mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px]",
              item.completed
                ? "border-[#5286F6] bg-[#5286F6] text-white"
                : "border-[#BDBDBD] bg-white text-transparent hover:border-[#2F2F2F] hover:text-[#BDBDBD]",
            ].join(" ")}
          >
            <Check size={12} strokeWidth={3} />
          </button>

          <div className="min-w-0 flex-1">
            {editingId === item.id ? (
              <input
                autoFocus
                value={editingText}
                onChange={(event) => setEditingText(event.target.value)}
                onBlur={() => saveEdit(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveEdit(item);
                  if (event.key === "Escape") setEditingId("");
                }}
                className="h-8 w-full rounded-[10px] border border-[#2F2F2F] px-2 text-[13px] outline-none"
              />
            ) : (
              <p
                className={[
                  "break-words text-[13.5px] leading-5",
                  item.completed ? "text-[#9A9A9A] line-through decoration-[#C4C4C4]" : "text-[#2F2F2F]",
                ].join(" ")}
              >
                {item.text}
              </p>
            )}

            {!item.completed && !inSessionGroup ? (
              assigned ? (
                <button
                  type="button"
                  onClick={() => setAssigningId(item.id)}
                  className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#F1F1F1] px-2.5 py-1 text-[11.5px] font-medium text-[#2F2F2F] hover:bg-[#E8E8E8]"
                  title="Change session"
                >
                  {isInfiniteTaskSession(assigned) ? <span aria-hidden>∞</span> : <CalendarDays size={12} />}
                  <span className="truncate">{sessionLabel(assigned)}</span>
                  {!isInfiniteTaskSession(assigned) ? (
                    <span className="shrink-0 text-[#8A8A8A]">· {formatSessionTime(assigned.start_time)}</span>
                  ) : null}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setAssigningId(item.id)}
                  className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-[#8A8A8A] hover:text-[#2F2F2F]"
                >
                  <Plus size={13} />
                  {assignmentEnded ? "Session ended · add to another" : "Add to a session"}
                </button>
              )
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setActionsId((value) => (value === item.id ? "" : item.id))}
            disabled={busy}
            aria-label={`More actions for ${item.text}`}
            aria-expanded={actionsId === item.id}
            className={[
              "-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#8A8A8A] hover:bg-[#EAEAEA] hover:text-[#2F2F2F] disabled:opacity-50",
              actionsId === item.id ? "bg-[#EAEAEA] text-[#2F2F2F]" : "",
            ].join(" ")}
          >
            <MoreHorizontal size={16} />
          </button>
        </div>

        {actionsId === item.id ? (
          <div className="ml-8 mt-2 flex flex-wrap gap-1.5">
            {[
              { label: "Edit", icon: <Pencil size={12} />, onClick: () => { setEditingId(item.id); setEditingText(item.text); setActionsId(""); } },
              { label: "Up", icon: <ArrowUp size={12} />, disabled: peerIndex <= 0, onClick: () => void tasks.moveTask(item, -1) },
              { label: "Down", icon: <ArrowDown size={12} />, disabled: peerIndex < 0 || peerIndex >= peers.length - 1, onClick: () => void tasks.moveTask(item, 1) },
            ].map((action) => (
              <button
                key={action.label}
                type="button"
                disabled={action.disabled}
                onClick={action.onClick}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#E5E5E5] bg-white px-3 text-[12px] font-medium text-[#2F2F2F] hover:border-[#2F2F2F] disabled:opacity-35"
              >
                {action.icon}
                {action.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setActionsId("");
                void tasks.deleteTask(item);
              }}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#F2D4D4] bg-white px-3 text-[12px] font-medium text-[#C93C3C] hover:bg-red-50"
            >
              <Trash2 size={12} />
              Delete
            </button>
          </div>
        ) : null}
      </li>
    );
  };

  const renderPlanned = () => {
    const groups = new Map<string, SessionTask[]>();
    for (const item of plannedItems) {
      const key = String(item.session_id);
      groups.set(key, [...(groups.get(key) || []), item]);
    }
    return tasks.sessions
      .filter((session) => groups.has(String(session.id)))
      .map((session) => (
        <div key={session.id} className="mb-3 last:mb-0">
          <div className="flex items-center gap-2 px-2 pb-1 pt-1">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#2F2F2F] text-[11px] text-white">
              {isInfiniteTaskSession(session) ? "∞" : <CalendarDays size={12} />}
            </span>
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-semibold text-[#2F2F2F]">{sessionLabel(session)}</div>
              <div className="truncate text-[11px] text-[#8A8A8A]">{sessionMeta(session)}</div>
            </div>
          </div>
          <ul>{(groups.get(String(session.id)) || []).map((item) => renderRow(item, true))}</ul>
        </div>
      ));
  };

  const emptyText =
    tab === "done"
      ? "Tasks you finish show up here."
      : tab === "planned"
        ? "Nothing planned yet. Add a task to a session and it shows up here."
        : "Nothing to do yet. Add your first task above.";

  return (
    <>
      {!open ? (
        <button
          ref={pillRef}
          type="button"
          {...dragHandlers}
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            if (!pos) setPos(current);
            setOpen(true);
          }}
          style={{ left: current.x, top: current.y, touchAction: "none" }}
          className={[
            // Styled like the "Deep work" label on session cards: a soft blue tint, not a solid button.
            "fixed z-[45] inline-flex h-9 select-none items-center gap-1.5 rounded-full border border-[#D3E0FC] bg-[#EEF3FE]/95 pl-2 pr-3 font-inter text-[12.5px] font-medium text-[#3F6FD8] shadow-[0_4px_14px_rgba(82,134,246,0.12)] backdrop-blur hover:bg-[#E4EDFF]",
            dragging ? "cursor-grabbing" : "cursor-grab",
          ].join(" ")}
          aria-label={`Tasks, ${openItems.length} to do${currentTask ? `, current: ${currentTask.text}` : ""}. Drag to move.`}
          title={currentTask?.text}
        >
          <GripVertical size={13} className="shrink-0 text-[#5286F6]/50" />
          <ListChecks size={15} className="shrink-0 text-[#5286F6]" />
          <span className="max-w-[min(200px,calc(100vw-130px))] truncate">
            {currentTask ? currentTask.text : tasks.loading ? "Tasks" : "Add your first task"}
          </span>
          {openItems.length > 1 ? (
            <span className="inline-flex h-5 shrink-0 items-center justify-center rounded-full bg-white px-1.5 text-[11px] font-semibold text-[#5286F6]">
              +{openItems.length - 1}
            </span>
          ) : null}
        </button>
      ) : (
        <section
          role="dialog"
          aria-label="Tasks"
          style={cardStyle}
          className="fixed z-[45] flex flex-col overflow-hidden rounded-[24px] border border-[#DBD8D8] bg-white font-inter text-[#2F2F2F] shadow-[0_24px_60px_rgba(0,0,0,0.18)]"
        >
          <header
            {...dragHandlers}
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest("button,input,a")) return;
              startDrag(event);
            }}
            style={{ touchAction: "none" }}
            className={[
              "flex shrink-0 select-none items-center gap-3 px-4 pb-3 pt-4",
              dragging ? "cursor-grabbing" : "cursor-grab",
            ].join(" ")}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2F2F2F] text-white">
              <ListChecks size={17} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold leading-5">Tasks</div>
              <div className="text-[12px] text-[#606060]">
                {openItems.length} to do · {doneItems.length} done
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate("/tasks")}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F1F1F1] hover:bg-[#E8E8E8]"
              aria-label="Open the full task plan"
              title="Open the full task plan"
            >
              <ArrowUpRight size={16} />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F1F1F1] hover:bg-[#E8E8E8]"
              aria-label="Minimize tasks"
              title="Minimize"
            >
              <Minus size={16} />
            </button>
          </header>

          {assigningTask ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-start gap-2 border-t border-[#EFEFEF] px-4 pb-3 pt-3">
                <button
                  type="button"
                  onClick={() => setAssigningId("")}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F1F1F1] hover:bg-[#E8E8E8]"
                  aria-label="Back to tasks"
                >
                  <ArrowLeft size={16} />
                </button>
                <div className="min-w-0 pt-0.5">
                  <div className="text-[13.5px] font-semibold">Add to a session</div>
                  <div className="truncate text-[12px] text-[#606060]">{assigningTask.text}</div>
                </div>
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {[null, ...tasks.sessions].map((session) => {
                  const id = session ? String(session.id) : "";
                  const selected = String(assigningTask.session_id || "") === id;
                  return (
                    <li key={id || "none"}>
                      <button
                        type="button"
                        onClick={() => {
                          setAssigningId("");
                          if (!selected) void tasks.assignTask(assigningTask, id);
                        }}
                        className={[
                          "flex w-full items-center gap-3 rounded-[14px] px-2.5 py-2.5 text-left",
                          selected ? "bg-[#F1F1F1]" : "hover:bg-[#F7F7F7]",
                        ].join(" ")}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E5E5E5] text-[13px]">
                          {!session ? <Minus size={14} /> : isInfiniteTaskSession(session) ? "∞" : <CalendarDays size={14} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{session ? sessionLabel(session) : "No session"}</span>
                          <span className="block truncate text-[11.5px] text-[#8A8A8A]">
                            {session ? sessionMeta(session) : "Keep it on your list for later"}
                          </span>
                        </span>
                        {selected ? <Check size={16} className="shrink-0" /> : null}
                      </button>
                    </li>
                  );
                })}
                {tasks.sessions.length === 0 ? (
                  <li className="px-3 py-4 text-center text-[12px] leading-5 text-[#606060]">
                    No upcoming sessions yet. Book or host a session, or join a 24/7 room, to plan tasks for it.
                  </li>
                ) : null}
              </ul>
            </div>
          ) : (
            <>
              <div className="shrink-0 px-4">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitDraft();
                  }}
                  className="flex items-center gap-2 rounded-full border border-[#DBD8D8] bg-white py-1 pl-4 pr-1 focus-within:border-[#2F2F2F]"
                >
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Add a task"
                    aria-label="New task"
                    className="h-9 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-[#A3A3A3]"
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim() || !!tasks.busyId}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2F2F2F] text-white hover:bg-[#1F1F1F] disabled:opacity-25"
                    aria-label="Add task"
                  >
                    <Plus size={18} />
                  </button>
                </form>

                <div role="tablist" aria-label="Task lists" className="mt-3 grid grid-cols-3 rounded-full bg-[#F1F1F1] p-1">
                  {([
                    ["todo", "To do", openItems.length],
                    ["planned", "Planned", plannedItems.length],
                    ["done", "Done", doneItems.length],
                  ] as const).map(([key, label, count]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={tab === key}
                      onClick={() => {
                        setTab(key);
                        setActionsId("");
                      }}
                      className={[
                        "inline-flex h-8 items-center justify-center gap-1.5 rounded-full text-[12.5px] font-semibold",
                        tab === key ? "bg-[#2F2F2F] text-white" : "text-[#606060] hover:text-[#2F2F2F]",
                      ].join(" ")}
                    >
                      {label}
                      <span className={tab === key ? "text-white/60" : "text-[#A3A3A3]"}>{count}</span>
                    </button>
                  ))}
                </div>
              </div>

              {tasks.error ? (
                <div className="mx-4 mt-3 flex items-start justify-between gap-2 rounded-[14px] bg-red-50 px-3 py-2 text-[12px] text-red-700">
                  <span>{tasks.error}</span>
                  <button type="button" onClick={tasks.clearError} className="font-semibold">OK</button>
                </div>
              ) : null}

              <div className="mt-2 min-h-[120px] flex-1 overflow-y-auto px-2 pb-3">
                {tasks.loading ? (
                  <div className="space-y-2 px-2 pt-2">
                    {[0, 1, 2].map((index) => (
                      <div key={index} className="h-10 rounded-[14px] bg-[#F4F4F4]" />
                    ))}
                  </div>
                ) : visibleItems.length === 0 ? (
                  <p className="px-6 py-8 text-center text-[12.5px] leading-5 text-[#8A8A8A]">{emptyText}</p>
                ) : tab === "planned" ? (
                  renderPlanned()
                ) : (
                  <ul>{visibleItems.map((item) => renderRow(item))}</ul>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
