export interface Env {
  MYSESSION_DAILY_EMAIL_CRON_URL: string;
  DAILY_SCHEDULE_CRON_SECRET: string;
  DAILY_SCHEDULE_CRON_LIMIT?: string;
  DAILY_SCHEDULE_AUDIENCE_NAME?: string;
  SENDER_LIFECYCLE_URL?: string;
  SENDER_CRON_SECRET?: string;
}

async function runSenderLifecycleCron(
  env: Env,
  trigger: "scheduled" | "manual",
  action: "evaluate" | "process" = "process",
) {
  const url = String(env.SENDER_LIFECYCLE_URL || "").trim();
  const secret = String(env.SENDER_CRON_SECRET || "").trim();
  if (!url || !secret) return { skipped: true, reason: "sender_cron_not_configured" };
  const startedAt = Date.now();
  const target = new URL(url);
  target.searchParams.set("senderAction", action);
  const response = await fetch(target.toString(), {
    method: "POST",
    headers: { "x-cron-secret": secret, "user-agent": `mysession-cloudflare-sender-cron/${trigger}`, accept: "application/json" },
  });
  const text = await response.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  return { skipped: false, ok: response.ok, status: response.status, durationMs: Date.now() - startedAt, body };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function buildCronUrl(env: Env) {
  const base = String(env.MYSESSION_DAILY_EMAIL_CRON_URL || "").trim();
  if (!base) throw new Error("MYSESSION_DAILY_EMAIL_CRON_URL_missing");

  const url = new URL(base);
  url.searchParams.set("cronAction", "daily_schedule_send_saved_audience");
  url.searchParams.set(
    "audienceName",
    String(env.DAILY_SCHEDULE_AUDIENCE_NAME || "default").trim() || "default"
  );
  url.searchParams.set(
    "limit",
    String(env.DAILY_SCHEDULE_CRON_LIMIT || "100").trim() || "100"
  );

  return url.toString();
}

async function runDailyScheduleEmailCron(env: Env, trigger: "scheduled" | "manual") {
  const secret = String(env.DAILY_SCHEDULE_CRON_SECRET || "").trim();
  if (!secret) throw new Error("DAILY_SCHEDULE_CRON_SECRET_missing");

  const url = buildCronUrl(env);
  const startedAt = Date.now();

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "x-cron-secret": secret,
      "user-agent": `mysession-cloudflare-daily-email-cron/${trigger}`,
      accept: "application/json",
    },
  });

  const text = await response.text();
  let body: unknown = text;

  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    durationMs: Date.now() - startedAt,
    url,
    body,
  };
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const jobs = event.cron === "0 4 * * *"
      ? [
          runDailyScheduleEmailCron(env, "scheduled").then((result) => console.log("[daily-email-cron] result", result)),
          runSenderLifecycleCron(env, "scheduled", "evaluate").then((result) => console.log("[sender-lifecycle-evaluate] result", result)),
        ]
      : [
          runSenderLifecycleCron(env, "scheduled", "process").then((result) => console.log("[sender-outbox-process] result", result)),
        ];

    ctx.waitUntil(Promise.allSettled(jobs).then((results) => {
      for (const result of results) if (result.status === "rejected") console.error("[cron] failed", result.reason);
    }));
  },

  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "mysession-daily-email-cron" });
    }

    if (url.pathname === "/run") {
      const supplied =
        request.headers.get("x-cron-secret") ||
        url.searchParams.get("secret") ||
        "";

      const expected = String(env.DAILY_SCHEDULE_CRON_SECRET || "").trim();

      if (!expected || supplied !== expected) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }

      try {
        const result = await runDailyScheduleEmailCron(env, "manual");
        return json(result, result.ok ? 200 : 502);
      } catch (error: any) {
        return json(
          {
            ok: false,
            error: error?.message || String(error),
          },
          500
        );
      }
    }

    if (url.pathname === "/run-sender") {
      const supplied = request.headers.get("x-cron-secret") || url.searchParams.get("secret") || "";
      const expected = String(env.SENDER_CRON_SECRET || "").trim();
      if (!expected || supplied !== expected) return json({ ok: false, error: "unauthorized" }, 401);
      try {
        const action = url.searchParams.get("action") === "process" ? "process" : "evaluate";
        const result = await runSenderLifecycleCron(env, "manual", action);
        return json(result, (result as any).ok || (result as any).skipped ? 200 : 502);
      } catch (error: any) {
        return json({ ok: false, error: error?.message || String(error) }, 500);
      }
    }

    return json(
      {
        ok: false,
        error: "not_found",
        routes: ["/health", "/run", "/run-sender"],
      },
      404
    );
  },
};
