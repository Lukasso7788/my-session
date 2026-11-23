/** Legacy REST fallbacks are only valid when the RPC does not exist.
 * Timeout, pool exhaustion and gateway errors must not cause extra SQL load.
 */
export function isMissingSupabaseRpc(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "42883" || error?.code === "PGRST202";
}
