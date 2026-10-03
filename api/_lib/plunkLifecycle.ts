import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { SENDER_EVENT_TYPES, sanitizeSenderProperties, senderTestProperties } from "./sender.js";

// Keep the persisted event names during the transport cutover. Plunk workflows
// subscribe to these exact names; the old Sender module is not called to send.
export const PLUNK_LIFECYCLE_EVENT_TYPES = SENDER_EVENT_TYPES;
export type PlunkLifecycleEventType = (typeof PLUNK_LIFECYCLE_EVENT_TYPES)[number];

type OutboxRow = {
  id: string;
  user_id: string | null;
  email: string;
  event_type: PlunkLifecycleEventType | "subscriber_preferences_updated";
  properties: Record<string, unknown> | null;
  idempotency_key: string;
  attempts: number;
  created_at: string;
};

type PlunkError = {
  success?: boolean;
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
    details?: { originalRequest?: string; originalStatusCode?: number };
  };
};

// Plunk's default idempotency retention is 24 hours. Stop retries before a
// reused key could expire and trigger a second workflow execution.
const MAX_EVENT_AGE_MS = 20 * 60 * 60 * 1000;

export function plunkLifecycleStatus() {
  if (String(process.env.PLUNK_LIFECYCLE_ENABLED || "false").toLowerCase() !== "true") {
    return { enabled: false, reason: "plunk_lifecycle_disabled", cutoverAt: null };
  }
  if (String(process.env.SENDER_INTEGRATION_ENABLED || "false").toLowerCase() === "true") {
    return { enabled: false, reason: "dual_provider_enabled", cutoverAt: null };
  }
  const required = ["PLUNK_API_URL", "PLUNK_SECRET_KEY", "PLUNK_PUBLIC_KEY", "PLUNK_LIFECYCLE_CUTOVER_AT"];
  const missing = required.filter((key) => !String(process.env[key] || "").trim());
  if (missing.length) return { enabled: false, reason: `missing_plunk_env:${missing.join(",")}`, cutoverAt: null };
  const value = String(process.env.PLUNK_LIFECYCLE_CUTOVER_AT).trim();
  const cutover = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
      !Number.isFinite(cutover.getTime()) || cutover.getTime() > Date.now()) {
    return { enabled: false, reason: "invalid_plunk_cutover", cutoverAt: null };
  }
  return { enabled: true, reason: null, cutoverAt: cutover.toISOString() };
}

function apiUrl() {
  const url = new URL(String(process.env.PLUNK_API_URL).trim());
  if (url.protocol !== "https:") throw new Error("plunk_https_required");
  return url.toString().replace(/\/+$/, "");
}

function safeError(value: unknown) {
  let detail = String(value || "");
  for (const key of ["PLUNK_SECRET_KEY", "PLUNK_PUBLIC_KEY"]) {
    const secret = String(process.env[key] || "");
    if (secret) detail = detail.replaceAll(secret, "[redacted]");
  }
  return detail.slice(0, 300);
}

async function plunkRequest(path: string, method: "GET" | "POST" | "PATCH", body?: unknown, idempotencyKey?: string) {
  const secret = path === "/v1/track"
    ? String(process.env.PLUNK_PUBLIC_KEY || "").trim()
    : String(process.env.PLUNK_SECRET_KEY || "").trim();
  let response: Response;
  try {
    response = await fetch(`${apiUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    throw new Error(`plunk_transport_failed:${safeError(error instanceof Error ? error.message : error)}`);
  }
  const json = (await response.json().catch(() => null)) as PlunkError | null;
  if (response.status === 409 && path === "/v1/track" &&
      json?.error?.code === "IDEMPOTENCY_KEY_REUSED" &&
      json.error.details?.originalRequest === "POST /v1/track" &&
      json.error.details.originalStatusCode === 200) {
    return { success: true, alreadyAccepted: true };
  }
  if (!response.ok || (path === "/v1/track" && json?.success !== true)) {
    const code = safeError(json?.error?.code || "UNKNOWN");
    const requestId = safeError(json?.error?.requestId);
    console.error("[plunk-lifecycle] request failed", { path, status: response.status, code, requestId });
    throw new Error(`plunk_http_${response.status}:${code}${requestId ? `:${requestId}` : ""}`);
  }
  return json;
}

// /v1/track creates a NEW contact as subscribed by default. Never let a
// lifecycle event silently grant marketing consent. Create absent contacts as
// unsubscribed first; existing Plunk unsubscribes are never reset here.
async function ensureContact(email: string) {
  let cursor = "";
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ search: email, limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const result = await plunkRequest(`/contacts?${query}`, "GET") as {
      data?: Array<{ id?: string; email?: string }>;
      hasMore?: boolean;
      cursor?: string;
    };
    const existing = result.data?.find((item) => item.email?.toLowerCase() === email);
    if (existing) {
      if (!existing.id) throw new Error("plunk_contact_id_missing");
      return existing.id;
    }
    if (!result.hasMore) {
      const created = await plunkRequest("/contacts", "POST", {
        email,
        subscribed: false,
        data: { marketing_email_enabled: false },
      }) as { id?: string; email?: string; subscribed?: boolean };
      if (!created.id || created.email?.toLowerCase() !== email || created.subscribed !== false) {
        throw new Error("plunk_contact_create_unconfirmed");
      }
      return created.id;
    }
    if (!result.cursor || result.cursor === cursor) throw new Error("plunk_contact_lookup_incomplete");
    cursor = result.cursor;
  }
  throw new Error("plunk_contact_lookup_too_many_pages");
}

async function syncPreferences(supabase: SupabaseClient, row: OutboxRow) {
  if (!row.user_id) throw new Error("plunk_preference_user_missing");
  const { data, error } = await supabase.from("email_automation_preferences")
    .select("marketing_email_enabled,timezone")
    .eq("user_id", row.user_id).maybeSingle();
  if (error) throw error;
  const subscribed = data?.marketing_email_enabled === true;
  const consentChanged = row.properties?.marketing_consent_changed === true;
  const contactId = await ensureContact(row.email);
  const result = await plunkRequest(`/contacts/${encodeURIComponent(contactId)}`, "PATCH", {
    ...(consentChanged ? { subscribed } : {}),
    data: {
      marketing_email_enabled: subscribed,
      timezone: String(data?.timezone || "UTC").slice(0, 100),
      user_id: row.user_id,
      first_name: String(row.properties?.first_name || "Friend").slice(0, 100),
    },
  }) as { email?: string; subscribed?: boolean };
  if (result.email?.toLowerCase() !== row.email) throw new Error("plunk_contact_sync_unconfirmed");
  if (consentChanged && result.subscribed !== subscribed) throw new Error("plunk_subscription_sync_unconfirmed");
}

async function trackEvent(row: OutboxRow) {
  if (!PLUNK_LIFECYCLE_EVENT_TYPES.includes(row.event_type as PlunkLifecycleEventType)) {
    throw new Error("unsupported_plunk_event");
  }
  const email = row.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("invalid_email");
  await ensureContact(email);
  const properties = sanitizeSenderProperties(row.properties);
  // Contact marketing state is changed only by a preference-sync event, not by
  // a potentially old booking/attendance event's captured properties.
  delete properties.marketing_email_enabled;
  delete properties.marketing_consent_changed;
  await plunkRequest("/v1/track", "POST", {
    email,
    event: row.event_type,
    data: oneShotEventData(properties),
  }, row.idempotency_key);
}

function retryAt(attempts: number) {
  const minutes = Math.min(24 * 60, 2 ** Math.min(10, Math.max(1, attempts)));
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function permanent(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message === "invalid_email" || message === "unsupported_plunk_event" ||
    /^plunk_http_4\d\d/.test(message) && !/^plunk_http_429/.test(message);
}

function paywallEventsEnabled() {
  const raw = process.env.PAYWALL_ENABLED ?? process.env.VITE_PAYWALL_ENABLED ?? "false";
  return String(raw).toLowerCase() === "true";
}

function oneShotEventData(properties: Record<string, string | number | boolean>) {
  // Plunk otherwise persists each event's fields on the contact. A delayed
  // booking/recap workflow must render its own event, not a later session's.
  return Object.fromEntries(Object.entries(properties).map(([key, value]) => [
    key, { value, persistent: false },
  ]));
}

export async function processPlunkOutbox(supabase: SupabaseClient, limit = 25) {
  const status = plunkLifecycleStatus();
  if (!status.enabled) return { disabled: true, reason: status.reason, cutoverAt: null, claimed: 0, sent: 0, failed: 0, cancelled: 0 };
  const safeLimit = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : 25;
  const { data, error } = await supabase.rpc("claim_plunk_email_event_outbox", {
    p_limit: safeLimit, p_cutover_at: status.cutoverAt,
  });
  if (error) throw error;
  const rows = (Array.isArray(data) ? data : []) as OutboxRow[];
  let sent = 0;
  let failed = 0;
  let cancelled = 0;
  for (const row of rows) {
    try {
      const tooOld = !Number.isFinite(new Date(row.created_at).getTime()) ||
        Date.now() - new Date(row.created_at).getTime() > MAX_EVENT_AGE_MS;
      const paywallDisabled = ["free_limit_warning", "free_limit_reached"].includes(row.event_type) &&
        !paywallEventsEnabled();
      if (tooOld || paywallDisabled) {
        const { error: cancelError } = await supabase.from("email_event_outbox")
          .update({ status: "cancelled", claimed_at: null,
            last_error: tooOld ? "plunk_event_expired" : "paywall_disabled" })
          .eq("id", row.id).eq("status", "processing");
        if (cancelError) throw cancelError;
        cancelled += 1;
        continue;
      }

      if (row.event_type === "subscriber_preferences_updated") await syncPreferences(supabase, row);
      else await trackEvent(row);

      const { error: updateError } = await supabase.from("email_event_outbox")
        .update({ status: "sent", sent_at: new Date().toISOString(), claimed_at: null, last_error: null })
        .eq("id", row.id).eq("status", "processing");
      if (updateError) throw updateError;
      sent += 1;
    } catch (caught) {
      failed += 1;
      const attempts = Number(row.attempts || 0) + 1;
      const message = safeError(caught instanceof Error ? caught.message : caught);
      const { error: updateError } = await supabase.from("email_event_outbox").update({
        status: permanent(caught) || attempts >= 8 ? "dead" : "failed",
        attempts, next_attempt_at: retryAt(attempts), claimed_at: null,
        last_error: message,
      }).eq("id", row.id).eq("status", "processing");
      if (updateError) console.error("[plunk-lifecycle] outbox status update failed", { id: row.id, code: updateError.code });
    }
  }
  return { disabled: false, reason: null, cutoverAt: status.cutoverAt, claimed: rows.length, sent, failed, cancelled };
}

export async function emitPlunkTestSuite(email: string) {
  // Tests are intentionally usable while production outbox delivery is OFF.
  const missing = ["PLUNK_API_URL", "PLUNK_SECRET_KEY", "PLUNK_PUBLIC_KEY"]
    .filter((key) => !String(process.env[key] || "").trim());
  if (missing.length) return { disabled: true, reason: `missing_plunk_env:${missing.join(",")}`,
    suiteId: null, sent: 0, failed: 0, results: [] };
  const normalized = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new Error("invalid_email");
  const suiteId = randomUUID();
  await ensureContact(normalized);
  const results: Array<{ eventType: string; ok: boolean; error: string | null }> = [];
  for (const type of PLUNK_LIFECYCLE_EVENT_TYPES) {
    try {
      const data = senderTestProperties(type, suiteId);
      delete data.marketing_email_enabled;
      delete data.lifecycle_email_enabled;
      await plunkRequest("/v1/track", "POST", {
        email: normalized, event: type,
        data: oneShotEventData(data),
      }, `plunk-test:${suiteId}:${type}`);
      results.push({ eventType: type, ok: true, error: null });
    } catch (error) {
      results.push({ eventType: type, ok: false, error: safeError(error instanceof Error ? error.message : error) });
    }
  }
  return { disabled: false, reason: null, suiteId,
    sent: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results };
}
