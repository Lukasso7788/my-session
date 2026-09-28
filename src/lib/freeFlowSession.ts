/** Free Flow is identified by its persisted schedule, not its editable title. */
export function isFreeFlowSchedule(schedule: unknown): boolean {
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) return false;

  const { variant, free_flow } = schedule as Record<string, unknown>;
  return String(variant ?? "").trim().toLowerCase() === "free_flow" || free_flow === true;
}
