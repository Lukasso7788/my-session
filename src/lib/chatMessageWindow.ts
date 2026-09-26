export const CHAT_PAGE_SIZE = 50;
export const CHAT_WINDOW_LIMIT = 300;

type Message = { id: string; created_at: string };

export function boundChatMessages<T extends Message>(messages: T[]): T[] {
  const unique = new Map(messages.map((message) => [message.id, message]));
  return [...unique.values()].sort((a, b) =>
    a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  ).slice(-CHAT_WINDOW_LIMIT);
}

// A SELECT that started before a realtime/local mutation cannot undo that
// mutation, including DELETE. Preserve older pages across reconnect catch-up.
export function reconcileChatSnapshot<T extends Message>(
  snapshot: T[], current: T[], changedIds: Set<string>,
): T[] {
  const oldest = snapshot[0]?.created_at;
  const merged = new Map(current.filter((message) =>
    (oldest && message.created_at < oldest) || message.id.startsWith("optimistic-"),
  ).map((message) => [message.id, message]));
  for (const message of snapshot) merged.set(message.id, message);
  const currentById = new Map(current.map((message) => [message.id, message]));
  for (const id of changedIds) {
    const message = currentById.get(id);
    if (message) merged.set(id, message);
    else merged.delete(id);
  }
  return boundChatMessages([...merged.values()]);
}
