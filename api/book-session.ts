import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

function mustEnv(name: string) {
    const v = process.env[name];
    if (!v) throw new Error(`Missing env: ${name}`);
    return v;
}

const SUPABASE_URL = mustEnv("SUPABASE_URL");
const SUPABASE_ANON_KEY = mustEnv("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
const PUBLIC_SITE_URL = mustEnv("PUBLIC_SITE_URL");
const RESEND_API_KEY = mustEnv("RESEND_API_KEY");
const EMAIL_FROM = mustEnv("EMAIL_FROM");

const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

const resend = new Resend(RESEND_API_KEY);

function pad2(n: number) {
    return String(n).padStart(2, "0");
}

function toIcsUtc(dt: Date) {
    // YYYYMMDDTHHMMSSZ
    return (
        dt.getUTCFullYear() +
        pad2(dt.getUTCMonth() + 1) +
        pad2(dt.getUTCDate()) +
        "T" +
        pad2(dt.getUTCHours()) +
        pad2(dt.getUTCMinutes()) +
        pad2(dt.getUTCSeconds()) +
        "Z"
    );
}

function icsEscape(s: string) {
    return String(s || "")
        .replace(/\\/g, "\\\\")
        .replace(/\n/g, "\\n")
        .replace(/,/g, "\\,")
        .replace(/;/g, "\\;");
}

function buildIcsInvite(args: {
    uid: string;
    title: string;
    description: string;
    location?: string;
    start: Date;
    end: Date;
    attendeeEmail: string;
    organizerEmail: string;
}) {
    const dtstamp = toIcsUtc(new Date());
    const dtstart = toIcsUtc(args.start);
    const dtend = toIcsUtc(args.end);

    // VALARM: многие клиенты уважают, но Gmail может жить своей логикой.
    // Мы всё равно делаем отдельные email-reminders кроном (см. ниже).
    return [
        "BEGIN:VCALENDAR",
        "PRODID:-//MySession//EN",
        "VERSION:2.0",
        "CALSCALE:GREGORIAN",
        "METHOD:REQUEST",
        "BEGIN:VEVENT",
        `UID:${args.uid}`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART:${dtstart}`,
        `DTEND:${dtend}`,
        `SUMMARY:${icsEscape(args.title)}`,
        `DESCRIPTION:${icsEscape(args.description)}`,
        `LOCATION:${icsEscape(args.location || "")}`,
        `ORGANIZER;CN=MySession:mailto:${args.organizerEmail}`,
        `ATTENDEE;CN=${icsEscape(args.attendeeEmail)};RSVP=FALSE:mailto:${args.attendeeEmail}`,
        "STATUS:CONFIRMED",
        "TRANSP:OPAQUE",
        "SEQUENCE:0",
        "BEGIN:VALARM",
        "TRIGGER:-PT24H",
        "ACTION:DISPLAY",
        "DESCRIPTION:MySession reminder",
        "END:VALARM",
        "BEGIN:VALARM",
        "TRIGGER:-PT30M",
        "ACTION:DISPLAY",
        "DESCRIPTION:MySession reminder",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
    ].join("\r\n");
}

export default async function handler(req: any, res: any) {
    try {
        if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

        const auth = req.headers?.authorization || "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
        if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

        const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
        const sessionId = body?.sessionId;
        if (!sessionId) return res.status(400).json({ ok: false, error: "Missing sessionId" });

        // 1) Verify user
        const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(token);
        if (userErr || !userData?.user) return res.status(401).json({ ok: false, error: "Invalid token" });
        const userId = userData.user.id;

        // 2) Load session (must be scheduled; infinite rooms we don't invite)
        const { data: session, error: sessErr } = await supabaseAdmin
            .from("sessions")
            .select("id,title,start_time,duration_minutes")
            .eq("id", sessionId)
            .single();

        if (sessErr || !session) return res.status(404).json({ ok: false, error: "Session not found" });
        if (!session.start_time) {
            return res.status(400).json({ ok: false, error: "This session has no start_time (skip calendar invite)." });
        }

        const start = new Date(session.start_time);
        const durationMin = Number(session.duration_minutes || 0);
        const end = new Date(start.getTime() + Math.max(1, durationMin) * 60 * 1000);

        // 3) Upsert booking
        const { data: booking, error: bookErr } = await supabaseAdmin
            .from("session_bookings")
            .upsert(
                { session_id: sessionId, user_id: userId },
                { onConflict: "session_id,user_id" }
            )
            .select("id, invite_sent_at, invite_uid")
            .single();

        if (bookErr || !booking) return res.status(500).json({ ok: false, error: "Booking failed" });

        // If already sent — don’t spam
        if (booking.invite_sent_at) {
            return res.status(200).json({ ok: true, alreadySent: true });
        }

        // 4) Get user's email from auth.users via admin API
        const { data: u, error: uerr } = await supabaseAdmin.auth.admin.getUserById(userId);
        const email = u?.user?.email;
        if (uerr || !email) return res.status(400).json({ ok: false, error: "User email not found" });

        const joinUrl = `${PUBLIC_SITE_URL.replace(/\/$/, "")}/room-iframe/${sessionId}`;
        const uid = booking.invite_uid || `${sessionId}-${userId}@mysession`;

        const ics = buildIcsInvite({
            uid,
            title: `MySession — ${session.title}`,
            description: `Join link: ${joinUrl}`,
            location: joinUrl,
            start,
            end,
            attendeeEmail: email,
            organizerEmail: EMAIL_FROM.match(/<([^>]+)>/)?.[1] || "noreply@mysession.club",
        });

        const startLocal = start.toLocaleString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });

        // 5) Send invite email with .ics attachment (base64)
        await resend.emails.send({
            from: EMAIL_FROM,
            to: [email],
            subject: `Booked: ${session.title} (${startLocal})`,
            text: `You're booked!\n\nSession: ${session.title}\nStarts: ${startLocal}\nJoin: ${joinUrl}\n\nCalendar invite is attached.`,
            attachments: [
                {
                    filename: "invite.ics",
                    content: Buffer.from(ics).toString("base64"),
                },
            ],
        });

        // 6) Mark sent
        await supabaseAdmin
            .from("session_bookings")
            .update({ invite_sent_at: new Date().toISOString(), invite_uid: uid })
            .eq("id", booking.id);

        return res.status(200).json({ ok: true });
    } catch (e: any) {
        console.error(e);
        return res.status(500).json({ ok: false, error: e?.message || "Server error" });
    }
}
