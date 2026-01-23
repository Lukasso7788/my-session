// api/send-session-invite.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    try {
        // 1) ENV checks
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ ok: false, error: "RESEND_API_KEY is not set (check Production env + redeploy)" });
        }

        const from = process.env.EMAIL_FROM;
        if (!from) {
            return res.status(500).json({ ok: false, error: "EMAIL_FROM is not set" });
        }

        // 2) Parse body
        const {
            attendeeEmail,
            attendeeName,
            sessionTitle,
            sessionDescription,
            startIso,
            endIso,
            joinUrl,
            bookingId,
        } = req.body || {};

        if (!attendeeEmail || !sessionTitle || !startIso || !endIso || !joinUrl || !bookingId) {
            return res.status(400).json({ ok: false, error: "Missing required fields" });
        }

        // 3) Import ICS builder safely (prevents import-time crash)
        const mod = await import("./_lib/ics");
        const buildIcsInvite = mod.buildIcsInvite as any;

        const resend = new Resend(apiKey);

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

        const icsBase64 = Buffer.from(ics, "utf8").toString("base64");

        const result = await resend.emails.send({
            from,
            to: attendeeEmail,
            subject: `Booked: ${sessionTitle}`,
            html: `
        <div style="font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;">
          <h2 style="margin:0 0 12px;">You're booked 🎯</h2>
          <p style="margin:0 0 12px;">Session: <b>${sessionTitle}</b></p>
          <p style="margin:0 0 12px;">Join link: <a href="${joinUrl}">${joinUrl}</a></p>
          <p style="margin:0;">A calendar invite (.ics) is attached.</p>
        </div>
      `,
            attachments: [{ filename: "mysession-invite.ics", content: icsBase64 }],
        });

        return res.status(200).json({ ok: true, id: result.data?.id });
    } catch (e: any) {
        return res.status(500).json({
            ok: false,
            error: e?.message || "Unknown error",
            // временно для дебага:
            stack: e?.stack ? String(e.stack).slice(0, 2000) : undefined,
        });
    }
}
