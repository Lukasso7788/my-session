// Every scheduled session opens with a phase where people say their goals and
// closes with one where they share their progress. Both last at least
// MIN_BOOKEND_MINUTES; a session can't be created without them.

export const MIN_BOOKEND_MINUTES = 2;
export const DEFAULT_BOOKEND_MINUTES = 5;

export const GOALS_PHASE_TITLE = "Share your goals";
export const PROGRESS_PHASE_TITLE = "Share your progress";
export const GOALS_PHASE_COLOR = "#ADD3FF";
export const PROGRESS_PHASE_COLOR = "#A78BFA";

const OPENING_KINDS = new Set(["welcome", "intentions"]);
const CLOSING_KINDS = new Set(["recap", "celebrate"]);

export type BookendBlock = {
  id: string;
  kind: string;
  title: string;
  note?: string;
  minutes: number;
  color?: string;
};

const minutesOf = (block: BookendBlock) => Number(block.minutes) || 0;

// The opening phase sits before the first focus block, the closing phase after the last one.
function phaseIndexes(blocks: BookendBlock[]) {
  const focusIndexes = blocks
    .map((block, index) => (block.kind === "focus" ? index : -1))
    .filter((index) => index >= 0);
  const firstFocus = focusIndexes.length ? focusIndexes[0] : blocks.length;
  const lastFocus = focusIndexes.length ? focusIndexes[focusIndexes.length - 1] : -1;

  const opening = blocks.findIndex(
    (block, index) => index < firstFocus && OPENING_KINDS.has(block.kind),
  );
  let closing = -1;
  for (let index = blocks.length - 1; index > lastFocus; index -= 1) {
    if (CLOSING_KINDS.has(blocks[index].kind)) {
      closing = index;
      break;
    }
  }
  return { opening, closing };
}

export type BookendIssue = "goals-missing" | "goals-short" | "progress-missing" | "progress-short";

export function bookendIssues(blocks: BookendBlock[]): BookendIssue[] {
  const { opening, closing } = phaseIndexes(blocks);
  const issues: BookendIssue[] = [];
  if (opening < 0) issues.push("goals-missing");
  else if (minutesOf(blocks[opening]) < MIN_BOOKEND_MINUTES) issues.push("goals-short");
  if (closing < 0) issues.push("progress-missing");
  else if (minutesOf(blocks[closing]) < MIN_BOOKEND_MINUTES) issues.push("progress-short");
  return issues;
}

export function bookendIssueMessage(issues: BookendIssue[]): string | null {
  if (!issues.length) return null;
  const goals = issues.find((issue) => issue.startsWith("goals"));
  const progress = issues.find((issue) => issue.startsWith("progress"));
  const parts: string[] = [];
  if (goals === "goals-missing") parts.push(`a phase where people share their goals at the start (${MIN_BOOKEND_MINUTES}+ min)`);
  if (goals === "goals-short") parts.push(`at least ${MIN_BOOKEND_MINUTES} minutes for sharing goals at the start`);
  if (progress === "progress-missing") parts.push(`a phase where people share their progress at the end (${MIN_BOOKEND_MINUTES}+ min)`);
  if (progress === "progress-short") parts.push(`at least ${MIN_BOOKEND_MINUTES} minutes for sharing progress at the end`);
  return `Every session needs ${parts.join(" and ")}.`;
}

// Adds the missing phases (or stretches too-short ones to the minimum).
export function withBookendPhases<T extends BookendBlock>(
  blocks: T[],
  makeId: () => string,
): T[] {
  const next = blocks.map((block) => ({ ...block }));
  const { opening, closing } = phaseIndexes(next);

  if (opening >= 0) {
    next[opening].minutes = Math.max(minutesOf(next[opening]), MIN_BOOKEND_MINUTES);
  } else {
    next.unshift({
      id: makeId(),
      kind: "intentions",
      title: GOALS_PHASE_TITLE,
      note: "Everyone says what they'll work on",
      minutes: DEFAULT_BOOKEND_MINUTES,
      color: GOALS_PHASE_COLOR,
    } as T);
  }

  if (closing >= 0) {
    const index = opening >= 0 ? closing : closing + 1;
    next[index].minutes = Math.max(minutesOf(next[index]), MIN_BOOKEND_MINUTES);
  } else {
    next.push({
      id: makeId(),
      kind: "recap",
      title: PROGRESS_PHASE_TITLE,
      note: "Everyone shares what they got done",
      minutes: DEFAULT_BOOKEND_MINUTES,
      color: PROGRESS_PHASE_COLOR,
    } as T);
  }

  return next;
}
