// api/_lib/ics.ts

function pad(n: number) {
    return String(n).padStart(2, "0");
}

function formatUtc(dt: Date) {
    // YYYYMMDDTHHMMSSZ
    return (
        dt.getUTCFullYear() +
        pad(dt.getUTCMonth() + 1) +
        pad(dt.getUTCDate()) +
        "T" +
        pad(dt.getUTCHours()) +
        pad(dt.getUTCMinutes()) +
        pad(dt.getUTCSeconds()) +
        "Z"
    );
}

function escapeText(s: string) {
    // iCalendar TEXT escaping: \, ; , and newlines
    return s
        .replace(/\\/g, "\\\\")
        .replace(/\n/g, "\\n")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,");
}

function escapeParam(s: string) {
    // param value escaping (good enough for CN)
    return s.replace(/"/g, '\\"');
}

export function buildIcsInvite(args: {
    uid: string;
    title: string;
    description: string;
    startUtc: Date;
    endUtc: Date;
    joinUrl: string;

    organizerEmail: string;
    organizerName: string;

    attendeeEmail: string;
    attendeeName?: string;

    location?: string;

    // optional: reminders inside calendar
    alarms?: Array<{ trigger: string; description: string }>; // trigger like -PT30M, -PT24H
}) {
    const {
        uid,
        title,
        description,
        startUtc,
        endUtc,
        joinUrl,
        organizerEmail,
        organizerName,
        attendeeEmail,
        attendeeName,
        location = "Online",
        alarms = [
            { trigger: "-PT24H", description: "Session starts in 24 hours" },
            { trigger: "-PT30M", description: "Session starts in 30 minutes" },
        ],
    } = args;

    const lines: string[] = [
        "BEGIN:VCALENDAR",
        "PRODID:-//MySession//Calendar Invite//EN",
        "VERSION:2.0",
        "CALSCALE:GREGORIAN",
        "METHOD:REQUEST",
        "BEGIN:VEVENT",
        `UID:${escapeText(uid)}`,
        `DTSTAMP:${formatUtc(new Date())}`,
        `DTSTART:${formatUtc(startUtc)}`,
        `DTEND:${formatUtc(endUtc)}`,
        `SUMMARY:${escapeText(title)}`,
        `DESCRIPTION:${escapeText(description + "\n\nJoin: " + joinUrl)}`,
        `LOCATION:${escapeText(location)}`,
        `ORGANIZER;CN="${escapeParam(organizerName)}":mailto:${organizerEmail}`,
        // RSVP=TRUE => Gmail покажет invite UI; даже если юзер не кликает, оно часто добавляется
        `ATTENDEE;CN="${escapeParam(attendeeName || attendeeEmail)}";RSVP=TRUE:mailto:${attendeeEmail}`,
        "STATUS:CONFIRMED",
        "SEQUENCE:0",
        "TRANSP:OPAQUE",
    ];

    for (const a of alarms) {
        lines.push(
            "BEGIN:VALARM",
            `TRIGGER:${a.trigger}`,
            "ACTION:DISPLAY",
            `DESCRIPTION:${escapeText(a.description)}`,
            "END:VALARM"
        );
    }

    lines.push("END:VEVENT", "END:VCALENDAR");

    // CRLF важен для некоторых клиентов
    return lines.join("\r\n");
}
