export interface Env {
  MYSESSION_DAILY_EMAIL_CRON_URL: string;
  DAILY_SCHEDULE_CRON_SECRET: string;
  DAILY_SCHEDULE_CRON_LIMIT?: string;
  DAILY_SCHEDULE_AUDIENCE_NAME?: string;
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
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runDailyScheduleEmailCron(env, "scheduled")
        .then((result) => {
          console.log("[daily-email-cron] result", result);
        })
        .catch((error) => {
          console.error("[daily-email-cron] failed", {
            message: error?.message || String(error),
          });
        })
    );
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

    return json(
      {
        ok: false,
        error: "not_found",
        routes: ["/health", "/run"],
      },
      404
    );
  },
};