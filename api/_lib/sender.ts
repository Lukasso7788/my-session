import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

export const SENDER_EVENT_TYPES = [
  "user_registered", "registration_stalled", "session_booked", "session_cancelled",
  "session_no_show", "first_session_completed", "second_session_completed",
  "session_completed", "weekly_recap_ready", "inactive_seven_days",
  "inactive_fourteen_days", "inactive_thirty_days", "free_limit_warning",
  "free_limit_reached", "pricing_viewed", "checkout_started", "subscription_started",
  "trial_started", "trial_ending_forty_eight_hours",
  "trial_ended", "payment_failed", "payment_recovered", "subscription_cancelled",
  "subscription_reactivated", "host_candidate_detected", "referral_candidate",
  "referral_signup", "testimonial_candidate", "technical_issue_resolved",
] as const;

export type SenderEventType = (typeof SENDER_EVENT_TYPES)[number];
export type SenderProperty = string | number | boolean;

type OutboxRow = {
  id: string;
  user_id: string | null;
  email: string;
  event_type: SenderEventType | "subscriber_preferences_updated";
  properties: Record<string, unknown> | null;
  attempts: number;
};

const MAX_PROPERTIES_BYTES = 8 * 1024;
const MAX_TEXT_BYTES = 2 * 1024;
const API_BASE = "https://api.sender.net/v2";

function isEnabled() {
  return String(process.env.SENDER_INTEGRATION_ENABLED || "false").toLowerCase() === "true";
}

function apiToken() {
  const token = String(process.env.SENDER_API_TOKEN || "").trim();
  if (!token) throw new Error("sender_api_token_missing");
  return token;
}

function utf8Bytes(value: string) {
  return Buffer.byteLength(value, "utf8");
}

export function sanitizeSenderProperties(input: Record<string, unknown> | null | undefined) {
  const output: Record<string, SenderProperty> = {};
  for (const [rawKey, rawValue] of Object.entries(input || {})) {
    const key = rawKey.trim().replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 80);
    if (!key || rawValue == null || typeof rawValue === "object") continue;
    let value: SenderProperty;
    if (typeof rawValue === "boolean") value = rawValue;
    else if (typeof rawValue === "number" && Number.isFinite(rawValue)) value = rawValue;
    else value = String(rawValue);
    if (typeof value === "string" && utf8Bytes(value) > MAX_TEXT_BYTES) {
      value = Buffer.from(value).subarray(0, MAX_TEXT_BYTES - 3).toString("utf8") + "...";
    }
    output[key] = value;
    if (utf8Bytes(JSON.stringify(output)) > MAX_PROPERTIES_BYTES) {
      delete output[key];
      break;
    }
  }
  return output;
}

async function senderFetch(path: string, init: RequestInit, maxAttempts = 3) {
  let lastError = "sender_request_failed";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${apiToken()}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(init.headers || {}),
        },
      });
      const text = await response.text();
      if (response.ok) return { response, body: text };
      lastError = `sender_http_${response.status}:${text.slice(0, 500)}`;
      if (response.status !== 429 && response.status < 500) throw new Error(lastError);
      const retryAfter = Number(response.headers.get("retry-after") || 0) * 1000;
      await new Promise((resolve) => setTimeout(resolve, retryAfter || 250 * 2 ** (attempt - 1)));
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (!/^sender_http_(429|5\d\d)/.test(lastError) || attempt === maxAttempts) break;
    }
  }
  throw new Error(lastError);
}

function configuredGroups(properties: Record<string, SenderProperty>) {
  if (properties.lifecycle_email_enabled === false) return [];
  const groups = [String(process.env.SENDER_DEFAULT_GROUP_ID || "").trim()];
  if (properties.marketing_email_enabled === true) groups.push(String(process.env.SENDER_MARKETING_GROUP_ID || "").trim());
  const plan = String(properties.plan || "free");
  if (plan === "free") groups.push(String(process.env.SENDER_FREE_GROUP_ID || "").trim());
  if (plan === "trial") groups.push(String(process.env.SENDER_TRIAL_GROUP_ID || "").trim());
  if (["pro_monthly", "pro_yearly", "lifetime", "founding_free"].includes(plan)) {
    groups.push(String(process.env.SENDER_PRO_GROUP_ID || "").trim());
  }
  return [...new Set(groups.filter(Boolean))];
}

function managedGroups() {
  return [...new Set([
    process.env.SENDER_DEFAULT_GROUP_ID,
    process.env.SENDER_MARKETING_GROUP_ID,
    process.env.SENDER_FREE_GROUP_ID,
    process.env.SENDER_TRIAL_GROUP_ID,
    process.env.SENDER_PRO_GROUP_ID,
  ].map((value) => String(value || "").trim()).filter(Boolean))];
}

async function syncSubscriber(email: string, properties: Record<string, SenderProperty>) {
  const firstname = String(properties.first_name || "").trim().slice(0, 100);
  const fields = {
    "{$user_id}": String(properties.user_id || "").slice(0, 200),
    "{$timezone}": String(properties.timezone || "UTC").slice(0, 100),
    "{$plan}": String(properties.plan || "free").slice(0, 100),
    "{$signup_date}": String(properties.signup_date || "").slice(0, 100),
  };
  try {
    await senderFetch(`/subscribers/${encodeURIComponent(email)}`, {
      method: "PATCH",
      body: JSON.stringify({ firstname, fields, trigger_automation: false }),
    }, 1);
  } catch (error) {
    if (!String(error).includes("sender_http_404")) throw error;
    // An explicit full opt-out must not create a new Sender contact merely to
    // synchronize the opt-out state.
    if (properties.lifecycle_email_enabled === false) return;
    await senderFetch("/subscribers", {
      method: "POST",
      body: JSON.stringify({ email, firstname, fields, trigger_automation: false }),
    });
  }
  const targetGroups = new Set(configuredGroups(properties));
  for (const groupId of managedGroups()) {
    const shouldBelong = targetGroups.has(groupId);
    await senderFetch(`/subscribers/groups/${encodeURIComponent(groupId)}`, {
      method: shouldBelong ? "POST" : "DELETE",
      body: JSON.stringify(
        shouldBelong
          ? { subscribers: [email], trigger_automation: false }
          : { subscribers: [email] },
      ),
    });
  }
}

export async function emitSenderEvent(params: {
  email: string;
  type: SenderEventType;
  properties?: Record<string, unknown>;
}) {
  if (!isEnabled()) return { skipped: true, reason: "sender_disabled" };
  if (!SENDER_EVENT_TYPES.includes(params.type)) throw new Error("unsupported_sender_event");
  const email = String(params.email || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("invalid_email");
  const properties = sanitizeSenderProperties(params.properties);
  await syncSubscriber(email, properties);
  await senderFetch("/events", {
    method: "POST",
    body: JSON.stringify({ subscriber: { email }, type: params.type, properties }),
  });
  return { skipped: false };
}

function senderTestProperties(type: SenderEventType, suiteId: string) {
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

  return sanitizeSenderProperties({
    test_mode: true,
    test_suite_id: suiteId,
    test_event_type: type,
    first_name: "MySession Test",
    timezone: "UTC",
    plan: "trial",
    signup_date: iso(-2 * 86_400_000),
    session_id: `test-${suiteId}`,
    session_title: "MySession automation test session",
    session_start: iso(2 * 60 * 60_000),
    duration_minutes: 50,
    session_format: "group",
    session_url: "https://mysession.club/sessions",
    sessions_url: "https://mysession.club/sessions",
    focused_minutes: 420,
    session_count: 14,
    free_sessions_remaining: 1,
    week_start: iso(-7 * 86_400_000).slice(0, 10),
    last_active_at: iso(-7 * 86_400_000),
    trial_ends_at: iso(48 * 60 * 60_000),
    upgrade_url: "https://mysession.club/pricing",
    checkout_url: "https://mysession.club/pricing",
    referral_url: "https://mysession.club/referral",
    referral_code: "TEST-SUITE",
    payment_failure_reason: "Test payment failure",
    technical_issue: "Test issue resolved",
    lifecycle_email_enabled: true,
    marketing_email_enabled: true,
    weekly_recap_enabled: true,
    session_reminders_enabled: true,
    reactivation_email_enabled: true,
  });
}

export async function emitSenderTestSuite(params: {
  email: string;
  eventTypes?: SenderEventType[];
}) {
  if (!isEnabled()) {
    return {
      disabled: true,
      reason: "sender_disabled",
      suiteId: null,
      sent: 0,
      failed: 0,
      results: [],
    };
  }

  const email = String(params.email || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("invalid_email");

  const requestedTypes = params.eventTypes?.length
    ? params.eventTypes
    : [...SENDER_EVENT_TYPES];
  const eventTypes = [...new Set(requestedTypes)].filter((type) =>
    SENDER_EVENT_TYPES.includes(type),
  );
  if (!eventTypes.length) throw new Error("no_sender_test_events");

  const suiteId = randomUUID();
  const subscriberProperties = senderTestProperties(eventTypes[0], suiteId);
  await syncSubscriber(email, subscriberProperties);

  const results: Array<{
    eventType: SenderEventType;
    ok: boolean;
    error: string | null;
  }> = new Array(eventTypes.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < eventTypes.length) {
      const index = nextIndex;
      nextIndex += 1;
      const type = eventTypes[index];
      try {
        await senderFetch("/events", {
          method: "POST",
          body: JSON.stringify({
            subscriber: { email },
            type,
            properties: senderTestProperties(type, suiteId),
          }),
        });
        results[index] = { eventType: type, ok: true, error: null };
      } catch (error) {
        results[index] = {
          eventType: type,
          ok: false,
          error: (error instanceof Error ? error.message : String(error)).slice(
            0,
            500,
          ),
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(4, eventTypes.length) }, () => runWorker()),
  );

  return {
    disabled: false,
    suiteId,
    sent: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
}

function retryAt(attempts: number) {
  const minutes = Math.min(24 * 60, 2 ** Math.min(10, Math.max(1, attempts)));
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function isPermanentFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message === "invalid_email" ||
    message === "unsupported_sender_event" ||
    /^sender_http_4\d\d/.test(message) && !message.startsWith("sender_http_429")
  );
}

function paywallEventsEnabled() {
  const raw = process.env.PAYWALL_ENABLED ?? process.env.VITE_PAYWALL_ENABLED ?? "false";
  return String(raw).toLowerCase() === "true";
}

export async function processSenderOutbox(supabase: SupabaseClient, limit = 25) {
  if (!isEnabled()) return { disabled: true, claimed: 0, sent: 0, failed: 0 };
  const { data, error } = await supabase.rpc("claim_email_event_outbox", { p_limit: Math.min(100, Math.max(1, limit)) });
  if (error) throw error;
  const rows = (Array.isArray(data) ? data : []) as OutboxRow[];
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const properties = sanitizeSenderProperties({
        ...(row.properties || {}),
        user_id: row.user_id || "",
      });

      if (["free_limit_warning", "free_limit_reached"].includes(row.event_type) && !paywallEventsEnabled()) {
        const { error: cancelError } = await supabase
          .from("email_event_outbox")
          .update({ status: "cancelled", claimed_at: null, last_error: "paywall_disabled" })
          .eq("id", row.id);
        if (cancelError) throw cancelError;
        continue;
      }

      if (row.event_type === "subscriber_preferences_updated") {
        await syncSubscriber(row.email, properties);
      } else {
        await emitSenderEvent({ email: row.email, type: row.event_type, properties });
      }

      const { error: updateError } = await supabase.from("email_event_outbox").update({ status: "sent", sent_at: new Date().toISOString(), claimed_at: null, last_error: null }).eq("id", row.id);
      if (updateError) throw updateError;
      sent += 1;
    } catch (error) {
      failed += 1;
      const attempts = Number(row.attempts || 0) + 1;
      const permanent = isPermanentFailure(error);
      await supabase.from("email_event_outbox").update({
        status: permanent || attempts >= 8 ? "dead" : "failed",
        attempts,
        next_attempt_at: retryAt(attempts),
        claimed_at: null,
        last_error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      }).eq("id", row.id);
    }
  }
  return { disabled: false, claimed: rows.length, sent, failed };
}
