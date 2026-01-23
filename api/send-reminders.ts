import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

function mustEnv(name: string) {
    const v = process.env[name];
    if (!v) throw new Error(`Missing env: ${name}`);
    return v;
}

const SUPABASE_URL = mustEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
const PUBLIC_SITE_URL = mustEnv("PUBLIC_SITE_URL");
const RESEND_API_KEY = mustEnv("RESEND_API_KEY");
const EMAIL_FROM = mustEnv("EMAIL_FROM");
const CRON_SECRET = mustEnv("CRON_SECRET");

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});
const resend = new Resend(RESEND_API_KEY);

function minutesFromNow(min: number) {
    return new Date(Date.now() + min * 60 * 1000);
}

async function sendReminder(kind: "24h" | "30m") {
    const now = new Date();

    // Cron runs every 5 min — берём окно ±7 минут, чтобы гарантированно поймать.
    const window = 7;

    const targetMin = kind === "24h" ? 24 * 60 : 30;
    const from = minutesFromNow(targetMin - window);
    const to = minutesFromNow(targetMin + window);

    const flagCol = kind === "24h" ? "reminder_24h_sent_at" : "reminder_30m_sent_at";

    const { data: rows, error } = await supabaseAdmin
        .from("session_bookings")
        .select(
            `
      id,
      user_id,
      session_id,
      ${flagCol},
      sessions!inner(id,title,start_time,duration_minutes)
    `
        )
        .is(flagCol as any, null)
        .gte("sessions.start_time", from.toISOString())
        .lte("sessions.start_time", to.toISOString())
        .limit(200);

    if (error) throw error;
    if (!rows?.length) return { kind, processed: 0 };

    let processed = 0;

    for (const r of rows) {
        const sess: any = (r as any).sessions;
        if (!sess?.start_time) continue;

        const start = new Date(sess.start_time);
        const startLocal = start.toLocaleString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });

        const joinUrl = `${PUBLIC_SITE_URL.replace(/\/$/, "")}/room-iframe/${r.session_id}`;

        const { data: u, error: uerr } = await supabaseAdmin.auth.admin.getUserById(r.user_id);
        const email = u?.user?.email;
        if (uerr || !email) continue;

        const subject =
            kind === "24h"
                ? `Reminder: tomorrow — ${sess.title}`
                : `Reminder: starting soon — ${sess.title}`;

        const text =
            kind === "24h"
                ? `Heads up — you have a MySession tomorrow.\n\nSession: ${sess.title}\nStarts: ${startLocal}\nJoin: ${joinUrl}`
                : `Starting soon.\n\nSession: ${sess.title}\nStarts: ${startLocal}\nJoin: ${joinUrl}`;

        await resend.emails.send({
            from: EMAIL_FROM,
            to: [email],
            subject,
            text,
        });

        await supabaseAdmin
            .from("session_bookings")
            .update({ [flagCol]: now.toISOString() })
            .eq("id", r.id);

        processed++;
    }

    return { kind, processed };
}

export default async function handler(req: any, res: any) {
    try {
        // Protect endpoint
        const auth = req.headers?.authorization || "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
        const qSecret = req.query?.secret;
        if (token !== CRON_SECRET && qSecret !== CRON_SECRET) {
            return res.status(401).json({ ok: false, error: "Unauthorized" });
        }

        const a = await sendReminder("24h");
        const b = await sendReminder("30m");

        return res.status(200).json({ ok: true, a, b });
    } catch (e: any) {
        console.error(e);
        return res.status(500).json({ ok: false, error: e?.message || "Server error" });
    }
}
