import type { MutableRefObject } from "react";
import { Check, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import {
  addDays,
  formatDayHeading,
  formatMonthHeading,
  monthGrid,
  shiftMonth,
  toIsoDate,
} from "../lib/taskCalendar";

export type CalendarTask = {
  id: string;
  text: string;
  target_date: string | null;
  completed: boolean;
  listTitle: string;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayNumber(iso: string) {
  return Number(iso.slice(-2));
}

export default function TasksCalendarView({
  tasks,
  selectedDay,
  onSelectDay,
  draft,
  onDraftChange,
  onAdd,
  adding,
  error,
  onToggle,
  onDelete,
  onSchedule,
  inputRef,
}: {
  tasks: CalendarTask[];
  selectedDay: string;
  onSelectDay: (iso: string) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  adding: boolean;
  error: string | null;
  onToggle: (task: CalendarTask) => void;
  onDelete: (task: CalendarTask) => void;
  onSchedule: (task: CalendarTask, targetDate: string | null) => void;
  inputRef: MutableRefObject<HTMLInputElement | null>;
}) {
  const today = toIsoDate(new Date());
  const cells = monthGrid(selectedDay);
  const counts = new Map<string, number>();
  tasks.forEach((task) => {
    if (!task.target_date) return;
    counts.set(task.target_date, (counts.get(task.target_date) || 0) + 1);
  });
  const dayTasks = tasks.filter((task) => task.target_date === selectedDay);
  const unscheduled = tasks.filter((task) => !task.target_date && !task.completed);
  const openCount = dayTasks.filter((task) => !task.completed).length;

  return (
    <section className="mt-6 grid items-start gap-5 min-[1180px]:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
      <div className="rounded-[16px] border border-[#DCDCDC] bg-white p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onSelectDay(shiftMonth(selectedDay, -1))}
            className="flex h-11 w-11 items-center justify-center rounded-[12px] border border-[#D8D8D8] text-[#2F2F2F] hover:bg-[#F7F7F7]"
            aria-label="Previous month"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="min-w-0 text-center">
            <h2 className="truncate text-[22px] font-semibold tracking-[-0.03em] text-[#2F2F2F] sm:text-[26px]">
              {formatMonthHeading(selectedDay)}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onSelectDay(shiftMonth(selectedDay, 1))}
            className="flex h-11 w-11 items-center justify-center rounded-[12px] border border-[#D8D8D8] text-[#2F2F2F] hover:bg-[#F7F7F7]"
            aria-label="Next month"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((label) => (
            <div key={label} className="py-1 text-center text-[12px] font-medium text-[#8A8A8A]">
              {label}
            </div>
          ))}
          {cells.map((cell) => {
            const count = counts.get(cell.iso) || 0;
            const selected = cell.iso === selectedDay;
            const isToday = cell.iso === today;
            return (
              <button
                key={cell.iso}
                type="button"
                onClick={() => onSelectDay(cell.iso)}
                aria-pressed={selected}
                aria-label={`${formatDayHeading(cell.iso)}${count ? `, ${count} tasks` : ""}`}
                className={[
                  "flex min-h-[58px] flex-col items-center justify-center rounded-[12px] border px-1 py-1.5 transition min-[1180px]:min-h-[72px]",
                  selected
                    ? "border-[#2F2F2F] bg-[#2F2F2F] text-white"
                    : isToday
                      ? "border-[#2F2F2F] bg-white text-[#2F2F2F] hover:bg-[#F7F7F7]"
                      : "border-transparent bg-[#FAFAFA] hover:bg-[#F2F2F2]",
                  !selected && !cell.inMonth ? "text-[#C5C5C5]" : "",
                ].join(" ")}
              >
                <span className="text-[15px] font-medium leading-none">{dayNumber(cell.iso)}</span>
                <span
                  aria-hidden="true"
                  className={[
                    "mt-1.5 min-h-[16px] text-[11px] font-medium leading-none",
                    count === 0 ? "opacity-0" : selected ? "text-white/80" : "text-[#5E8ED6]",
                  ].join(" ")}
                >
                  {count > 0 ? String(count) : "0"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-[16px] border border-[#DCDCDC] bg-white">
        <div className="flex items-center gap-2 border-b border-[#EFEFEF] px-4 py-4 sm:px-5">
          <button
            type="button"
            onClick={() => onSelectDay(addDays(selectedDay, -1))}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-[#D8D8D8] hover:bg-[#F7F7F7]"
            aria-label="Previous day"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-[#8A8A8A]">
              {selectedDay === today ? "Today" : "Selected day"}
            </div>
            <h2 className="mt-1 truncate text-[20px] font-semibold tracking-[-0.03em] sm:text-[24px]">
              {formatDayHeading(selectedDay)}
            </h2>
            <div className="mt-1 text-[13px] text-[#717680]">
              {dayTasks.length === 0
                ? "No tasks on this day"
                : `${openCount} open${dayTasks.length === openCount ? "" : ` · ${dayTasks.length - openCount} done`}`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSelectDay(addDays(selectedDay, 1))}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-[#D8D8D8] hover:bg-[#F7F7F7]"
            aria-label="Next day"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {selectedDay !== today ? (
          <div className="border-b border-[#EFEFEF] px-4 py-2 text-center sm:px-5">
            <button
              type="button"
              onClick={() => onSelectDay(today)}
              className="text-[13px] font-medium text-[#5E8ED6] hover:underline"
            >
              Back to today
            </button>
          </div>
        ) : null}

        <div className="px-4 py-3 sm:px-5">
          {dayTasks.length === 0 ? (
            <p className="py-6 text-center text-[14px] leading-6 text-[#717680]">
              This day is clear. Add a task and it stays on this date only.
            </p>
          ) : (
            <div className="divide-y divide-[#EFEFEF]">
              {dayTasks.map((task) => (
                <div key={task.id} className="flex min-h-[56px] items-center gap-3 py-2">
                  <button
                    type="button"
                    onClick={() => onToggle(task)}
                    className={[
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                      task.completed ? "border-[#65D46C] bg-[#65D46C] text-white" : "border-[#C9C9C9] bg-white",
                    ].join(" ")}
                    aria-label={task.completed ? "Mark task active" : "Mark task complete"}
                  >
                    {task.completed ? <Check size={13} strokeWidth={2.4} /> : null}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className={[
                      "truncate text-[15px] text-[#2F2F2F]",
                      task.completed ? "line-through opacity-55" : "",
                    ].join(" ")}>{task.text}</div>
                    <div className="mt-0.5 truncate text-[12px] text-[#8A8A8A]">{task.listTitle}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSchedule(task, null)}
                    className="inline-flex h-9 shrink-0 items-center rounded-full border border-[#E3E3E3] px-3 text-[12px] text-[#717680] hover:bg-[#F7F7F7]"
                  >
                    Unschedule
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(task)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-[#E07A7A] hover:bg-[#FFF1F1]"
                    title="Delete task"
                    aria-label="Delete task"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <form
            className="mt-2 border-t border-[#EFEFEF] pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              onAdd();
            }}
          >
            <label htmlFor="calendar-task-input" className="sr-only">Task for this day</label>
            <input
              id="calendar-task-input"
              ref={(node) => { inputRef.current = node; }}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              maxLength={300}
              placeholder="Add a task for this day..."
              className="h-12 w-full rounded-[12px] border border-[#D8D8D8] px-4 text-[15px] outline-none placeholder:text-[#A9A9A9] focus:border-[#2F2F2F]"
            />
            <button
              type="submit"
              disabled={!draft.trim() || adding}
              className="mt-3 inline-flex h-11 items-center gap-1.5 rounded-full bg-[#2F2F2F] px-5 text-[14px] font-medium text-white disabled:opacity-40"
            >
              <Plus size={14} /> {adding ? "Adding…" : "Add to this day"}
            </button>
            {error ? <p role="alert" className="mt-2 text-[13px] text-red-700">{error}</p> : null}
          </form>
        </div>

        {unscheduled.length > 0 ? (
          <div className="border-t border-[#EFEFEF] px-4 py-4 sm:px-5">
            <h3 className="text-[13px] font-semibold text-[#2F2F2F]">Not on a day yet</h3>
            <div className="mt-2 flex flex-col gap-2">
              {unscheduled.map((task) => (
                <div key={task.id} className="flex items-center gap-3 rounded-[12px] bg-[#FAFAFA] px-3 py-2.5">
                  <div className="min-w-0 flex-1 truncate text-[14px]">{task.text}</div>
                  <button
                    type="button"
                    onClick={() => onSchedule(task, selectedDay)}
                    className="h-9 shrink-0 rounded-full border border-[#D8D8D8] bg-white px-3 text-[12px] font-medium text-[#2F2F2F] hover:bg-[#F7F7F7]"
                  >
                    Put on this day
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
