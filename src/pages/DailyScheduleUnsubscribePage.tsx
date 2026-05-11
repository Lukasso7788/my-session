import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

type Status = "idle" | "loading" | "success" | "error";

export default function DailyScheduleUnsubscribePage() {
  const [params] = useSearchParams();
  const token = useMemo(() => String(params.get("token") || "").trim(), [params]);

  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!token) {
        setStatus("error");
        setMessage("Missing unsubscribe token.");
        return;
      }

      try {
        setStatus("loading");
        setMessage("");

        const { data, error } = await supabase.rpc("unsubscribe_daily_schedule_email", {
          token,
        });

        if (error) throw error;

        if (!data?.ok) {
          throw new Error(data?.error || "Could not unsubscribe this email.");
        }

        if (!cancelled) {
          setStatus("success");
          setMessage("You have been unsubscribed from daily schedule emails.");
        }
      } catch (e: any) {
        console.error("[unsubscribe] failed:", e);

        if (!cancelled) {
          setStatus("error");
          setMessage(String(e?.message || e || "Failed to unsubscribe."));
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className="min-h-screen bg-white px-6 py-16 font-inter text-[#2F2F2F]">
      <div className="mx-auto max-w-[560px] rounded-[28px] border border-black/10 bg-white p-8 text-center shadow-[0_12px_40px_rgba(0,0,0,0.08)]">
        <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#777]">
          MySession
        </div>

        <h1 className="mt-4 text-[30px] font-bold">
          {status === "success"
            ? "You’re unsubscribed"
            : status === "loading"
              ? "Unsubscribing…"
              : "Unsubscribe"}
        </h1>

        <p className="mt-4 text-[15px] leading-7 text-[#666]">
          {status === "loading"
            ? "Please wait a moment."
            : message || "We’ll stop sending daily schedule emails to this address."}
        </p>

        {status === "success" ? (
          <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[14px] text-emerald-800">
            You can still use MySession normally. This only turns off daily schedule emails.
          </div>
        ) : null}

        {status === "error" ? (
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-700">
            {message}
          </div>
        ) : null}

        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/sessions"
            className="rounded-full bg-[#2F2F2F] px-5 py-3 text-[14px] font-semibold text-white hover:opacity-90"
          >
            Back to sessions
          </Link>

          <a
            href="mailto:support@mysession.club"
            className="rounded-full border border-black/10 bg-white px-5 py-3 text-[14px] font-semibold text-[#2F2F2F] hover:bg-black/[0.04]"
          >
            Contact support
          </a>
        </div>
      </div>
    </main>
  );
}
