// api/send-session-invite.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import { buildIcsInvite } from "./_lib/ics";

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    try {
        const {
            attendeeEmail,
            attendeeName,
            sessionTitle,
            sessionDescription,
            startIso, // ISO string
            endIso,   // ISO string
            joinUrl,
            bookingId, // stable id from DB
        } = req.body || {};

        if (!attendeeEmail || !sessionTitle || !startIso || !endIso || !joinUrl || !bookingId) {
            return res.status(400).json({ ok: false, error: "Missing required fields" });
        }

        const from = process.env.EMAIL_FROM;
        if (!from) {
            return res.status(500).json({ ok: false, error: "EMAIL_FROM is not set" });
        }

        // IMPORTANT: uid должен быть стабильным для update/cancel
        const uid = `mysession-booking-${bookingId}@mysession.club`;

        const ics = buildIcsInvite({
            uid,
            title: sessionTitle,
            description: sessionDescription || "MySession focus session",
            startUtc: new Date(startIso),
            endUtc: new Date(endIso),
            joinUrl,
            organizerEmail: "calendar@mysession.club",
            organizerName: "MySession",
            attendeeEmail,
            attendeeName,
            location: "Online (MySession)",
            alarms: [
                { trigger: "-PT24H", description: "Your session is in 24 hours" },
                { trigger: "-PT30M", description: "Your session starts in 30 minutes" },
            ],
        });

        // Resend attachment expects base64
        const icsBase64 = Buffer.from(ics, "utf8").toString("base64");

        const subject = `Booked: ${sessionTitle}`;

        const html = `
      <div style="font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;">
        <h2 style="margin:0 0 12px;">You're booked 🎯</h2>
        <p style="margin:0 0 12px;">Session: <b>${sessionTitle}</b></p>
        <p style="margin:0 0 12px;">Join link: <a href="${joinUrl}">${joinUrl}</a></p>
        <p style="margin:0;">A calendar invite (.ics) is attached.</p>
      </div>
    `;

        const result = await resend.emails.send({
            from,
            to: attendeeEmail,
            subject,
            html,
            attachments: [
                {
                    filename: "mysession-invite.ics",
                    content: icsBase64,
                    // Resend understands common content types; if needed, keep filename .ics
                },
            ],
            headers: {
                // helps some clients treat it as calendar message
                "Content-Type": "text/calendar; charset=utf-8; method=REQUEST",
            },
        });

        return res.status(200).json({ ok: true, id: result.data?.id });
    } catch (e: any) {
        return res.status(500).json({ ok: false, error: e?.message || "Unknown error" });
    }
}
