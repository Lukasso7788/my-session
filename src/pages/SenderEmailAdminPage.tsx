import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

type EventRow = {
  id: string;
  event_type: string;
  status: string;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
};

type TestResult = {
  disabled: boolean;
  reason?: string;
  suiteId: string | null;
  sent: number;
  failed: number;
  results: Array<{
    eventType: string;
    ok: boolean;
    error: string | null;
  }>;
};

type SenderResponse = {
  events?: EventRow[];
  supportedEventTypes?: string[];
  delivery?: {
    disabled: boolean;
    claimed: number;
    sent: number;
    failed: number;
  };
  test?: TestResult;
  error?: string;
};

export default function SenderEmailAdminPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<EventRow[]>([]);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [testEmail, setTestEmail] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  const request = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) {
        navigate("/login?next=/admin/sender-email");
        throw new Error("Please sign in first.");
      }

      setTestEmail((current) => current || data.session?.user.email || "");

      const response = await fetch("/api/livekit/admin", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action, ...extra }),
      });
      const payload = (await response.json()) as SenderResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Sender admin request failed.");
      }
      if (payload.events) setRows(payload.events);
      if (payload.supportedEventTypes) {
        setEventTypes(payload.supportedEventTypes);
      }
      return payload;
    },
    [navigate],
  );

  const load = useCallback(async () => {
    await request("sender_outbox_list");
  }, [request]);

  useEffect(() => {
    void load()
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : String(caught)),
      )
      .finally(() => setLoading(false));
  }, [load]);

  async function retry(id: string) {
    setError("");
    setMessage("");
    try {
      await request("sender_outbox_retry", { senderEventId: id });
      setMessage("Event returned to the delivery queue.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function processOutbox() {
    setProcessing(true);
    setError("");
    setMessage("");
    try {
      const payload = await request("sender_outbox_process");
      const delivery = payload.delivery;
      setMessage(
        delivery?.disabled
          ? "Sender integration is disabled. Set SENDER_INTEGRATION_ENABLED=true before testing."
          : `Processed ${delivery?.claimed || 0}: ${delivery?.sent || 0} sent, ${delivery?.failed || 0} failed.`,
      );
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setProcessing(false);
    }
  }

  async function sendTestSuite() {
    const email = testEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError("Enter a valid test inbox.");
      return;
    }

    const confirmed = window.confirm(
      `Send ${eventTypes.length || "all"} Sender test events to ${email}? This can trigger one email per published Sender automation.`,
    );
    if (!confirmed) return;

    setTesting(true);
    setError("");
    setMessage("");
    setTestResult(null);
    try {
      const payload = await request("sender_test_all", {
        senderTestEmail: email,
        senderTestConfirmation: "SEND_ALL_TEST_EMAILS",
      });
      if (!payload.test) throw new Error("Sender returned no test result.");
      setTestResult(payload.test);
      setMessage(
        payload.test.disabled
          ? "Sender integration is disabled. No events were sent."
          : `Test suite finished: ${payload.test.sent} accepted, ${payload.test.failed} failed.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setTesting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-5 py-10 text-[#2F2F2F]">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-[#4AAE55]">
              MySession Admin
            </div>
            <h1 className="mt-2 text-3xl font-bold">Sender lifecycle email</h1>
            <p className="mt-2 text-sm text-black/55">
              Test every automation and inspect the delivery outbox without
              exposing production recipient data.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              to="/admin/daily-schedule-email"
              className="rounded-full border border-black/15 bg-white px-4 py-2 text-sm"
            >
              Daily schedule test
            </Link>
            <Link
              to="/admin"
              className="rounded-full border border-black/15 px-4 py-2 text-sm"
            >
              Admin
            </Link>
            <button
              onClick={() => void load()}
              className="rounded-full bg-[#2F2F2F] px-4 py-2 text-sm text-white"
            >
              Refresh
            </button>
          </div>
        </div>

        <section className="mt-7 rounded-[24px] border border-black/10 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-2xl">
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-[#4AAE55]">
                Automation test suite
              </div>
              <h2 className="mt-2 text-xl font-bold">Trigger every Sender event</h2>
              <p className="mt-2 text-sm leading-6 text-black/55">
                Use a dedicated test inbox. The run creates or updates that
                subscriber in Sender and can generate one email for every
                published automation below.
              </p>
            </div>
            <span className="rounded-full bg-[#ECF8EE] px-3 py-1.5 text-xs font-semibold text-[#31843B]">
              {eventTypes.length} events
            </span>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <input
              type="email"
              value={testEmail}
              onChange={(event) => setTestEmail(event.target.value)}
              placeholder="test@example.com"
              className="min-w-0 flex-1 rounded-2xl border border-black/10 px-4 py-3 text-sm outline-none focus:border-[#57C964]"
            />
            <button
              type="button"
              onClick={() => void sendTestSuite()}
              disabled={testing || loading || !eventTypes.length}
              className="rounded-2xl bg-[#57C964] px-5 py-3 text-sm font-bold text-[#152517] transition hover:bg-[#49B856] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {testing ? "Sending tests…" : "Send all test events"}
            </button>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {eventTypes.map((eventType) => {
              const result = testResult?.results.find(
                (item) => item.eventType === eventType,
              );
              return (
                <span
                  key={eventType}
                  title={result?.error || eventType}
                  className={`rounded-full border px-2.5 py-1 text-[11px] ${
                    result?.ok
                      ? "border-green-200 bg-green-50 text-green-700"
                      : result
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-black/10 bg-black/[0.025] text-black/55"
                  }`}
                >
                  {result ? (result.ok ? "✓ " : "× ") : ""}
                  {eventType}
                </span>
              );
            })}
          </div>

          {testResult?.suiteId ? (
            <p className="mt-4 text-xs text-black/45">
              Test suite ID: {testResult.suiteId}
            </p>
          ) : null}
        </section>

        {error ? (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
            {message}
          </div>
        ) : null}

        <div className="mt-7 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">Delivery outbox</h2>
            <p className="mt-1 text-sm text-black/50">
              Manually process pending items or retry failed deliveries.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void processOutbox()}
            disabled={processing}
            className="rounded-full border border-black/15 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {processing ? "Processing…" : "Process pending"}
          </button>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-black/10 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-black/[0.03] text-xs uppercase tracking-wide text-black/50">
              <tr>
                <th className="p-4">Event</th>
                <th className="p-4">Status</th>
                <th className="p-4">Attempts</th>
                <th className="p-4">Created</th>
                <th className="p-4">Last error</th>
                <th className="p-4" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="p-5" colSpan={6}>
                    Loading…
                  </td>
                </tr>
              ) : rows.length ? (
                rows.map((row) => (
                  <tr key={row.id} className="border-t border-black/5">
                    <td className="p-4 font-medium">{row.event_type}</td>
                    <td className="p-4">
                      <span className="rounded-full bg-black/[0.05] px-2 py-1 text-xs">
                        {row.status}
                      </span>
                    </td>
                    <td className="p-4">{row.attempts}</td>
                    <td className="p-4 text-xs text-black/55">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td
                      className="max-w-sm truncate p-4 text-xs text-red-700"
                      title={row.last_error || ""}
                    >
                      {row.last_error || "—"}
                    </td>
                    <td className="p-4">
                      {["failed", "dead"].includes(row.status) ? (
                        <button
                          onClick={() => void retry(row.id)}
                          className="rounded-full border border-black/15 px-3 py-1.5 text-xs"
                        >
                          Retry
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="p-5 text-black/50" colSpan={6}>
                    The outbox is empty.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
