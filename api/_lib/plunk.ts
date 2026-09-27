type PlunkSendRequest = {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
  headers?: Record<string, string>;
  idempotencyKey: string;
};

type PlunkSendResponse = {
  success?: boolean;
  data?: { emails?: Array<{ email?: string }> };
  error?: { code?: string; message?: string; requestId?: string };
};

const REQUIRED_PLUNK_ENV = [
  "PLUNK_API_URL",
  "PLUNK_SECRET_KEY",
  "PLUNK_FROM_EMAIL",
  "PLUNK_FROM_NAME",
] as const;

export function missingPlunkEnvironment(): string[] {
  return REQUIRED_PLUNK_ENV.filter((name) => !String(process.env[name] || "").trim());
}

export async function sendPlunkEmail(request: PlunkSendRequest): Promise<{ id: string | null }> {
  const missing = missingPlunkEnvironment();
  if (missing.length) throw new Error(`missing_plunk_env:${missing.join(",")}`);

  const apiUrl = String(process.env.PLUNK_API_URL).trim().replace(/\/+$/, "");
  const secretKey = String(process.env.PLUNK_SECRET_KEY).trim();
  const fromEmail = String(process.env.PLUNK_FROM_EMAIL).trim();
  const fromName = String(process.env.PLUNK_FROM_NAME).trim();
  const safeDetail = (value: unknown) => String(value || "")
    .replaceAll(secretKey, "[redacted]")
    .slice(0, 300);

  // The key identifies the logical email, not this HTTP attempt. Reusing it
  // lets Plunk refuse a retry after delivery succeeded but our process died.
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/v1/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": request.idempotencyKey,
      },
      body: JSON.stringify({
        to: request.to,
        from: { name: fromName, email: fromEmail },
        subject: request.subject,
        body: request.body,
        ...(request.replyTo ? { reply: request.replyTo } : {}),
        ...(request.headers ? { headers: request.headers } : {}),
      }),
    });
  } catch (error) {
    const detail = safeDetail(error instanceof Error ? error.message : error);
    console.error("[plunk] email transport failed", {
      idempotencyKey: request.idempotencyKey,
      detail,
    });
    throw new Error(`plunk_transport_failed:${detail}`);
  }

  const result = (await response.json().catch(() => null)) as PlunkSendResponse | null;
  if (!response.ok || result?.success !== true) {
    const code = safeDetail(result?.error?.code || "UNKNOWN");
    const message = safeDetail(result?.error?.message);
    const requestId = safeDetail(result?.error?.requestId);
    // Never log raw response bodies or headers: they could echo credentials.
    console.error("[plunk] email send failed", {
      status: response.status,
      code,
      message,
      requestId,
      idempotencyKey: request.idempotencyKey,
    });
    throw new Error(`plunk_send_failed:${response.status}:${code}${requestId ? `:${requestId}` : ""}`);
  }

  const id = result.data?.emails?.[0]?.email;
  return { id: typeof id === "string" ? id : null };
}
