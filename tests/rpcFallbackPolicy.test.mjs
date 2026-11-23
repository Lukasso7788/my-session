import test from "node:test";
import assert from "node:assert/strict";
import { isMissingSupabaseRpc } from "../src/lib/rpcFallbackPolicy.ts";

test("legacy fallback runs only when the RPC is absent", () => {
  assert.equal(isMissingSupabaseRpc({ code: "PGRST202" }), true);
  assert.equal(isMissingSupabaseRpc({ code: "42883" }), true);
  for (const code of ["57014", "PGRST003", "PGRST500", "PGRST301", "42501", "53300", "503", "504", ""]) {
    assert.equal(isMissingSupabaseRpc({ code }), false, code);
  }
  assert.equal(isMissingSupabaseRpc(null), false);
});
