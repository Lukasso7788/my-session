// Which focus block of the current session each of my tasks is planned for.
// Panel tasks belong to the person, not to a session, and "Focus 2" only
// means something inside one session, so the plan is kept per session and
// per person on this device (like task timers), and never leaks into the
// next session.

export type FocusBlock = { stageIndex: number; label: string };

const STORAGE_PREFIX = "mysession_task_blocks_v1";
export const TASK_BLOCKS_EVENT = "mysession:task-blocks-updated";

export function taskBlocksStorageKey(sessionId: string | null | undefined, userId: string | null | undefined) {
  return `${STORAGE_PREFIX}:${String(sessionId || "").trim()}:${String(userId || "").trim()}`;
}

export function readTaskBlocks(key: string): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    const out: Record<string, number> = {};
    for (const [taskId, value] of Object.entries(parsed || {})) {
      const index = Number(value);
      if (taskId && Number.isInteger(index) && index >= 0) out[taskId] = index;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeTaskBlocks(key: string, blocks: Record<string, number>) {
  try {
    window.localStorage.setItem(key, JSON.stringify(blocks));
    window.dispatchEvent(new CustomEvent(TASK_BLOCKS_EVENT, { detail: { key } }));
  } catch {
    // Storage can be unavailable (private mode); the chip simply resets.
  }
}

type StageLike = { name?: string | null; kind?: string | null; type?: string | null };

/**
 * Focus blocks of a session, numbered in order ("Focus 1", "Focus 2", …).
 * A focus block the host named themselves keeps that name.
 */
export function focusBlocksFromStages(
  stages: StageLike[],
  resolveKind: (stage: StageLike) => { kind: string; name: string },
): FocusBlock[] {
  const blocks: FocusBlock[] = [];
  stages.forEach((stage, stageIndex) => {
    const { kind, name } = resolveKind(stage);
    if (kind !== "focus") return;
    const number = blocks.length + 1;
    const custom = String(name || "").trim();
    const label = custom && !/^focus(\s*(block|time|session))?\s*\d*$/i.test(custom) ? custom : `Focus ${number}`;
    blocks.push({ stageIndex, label });
  });
  return blocks;
}
