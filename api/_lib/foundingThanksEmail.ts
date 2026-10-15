// One-time thank-you email for Founding Member Pro accounts.
//
// Sent once per person (ledger: public.one_time_email_sends, campaign below)
// from the admin email page. Pure builder: no I/O, so it can be previewed
// and tested without sending anything.

export const FOUNDING_THANKS_CAMPAIGN = "founding_thanks_2026_10";
export const FOUNDING_THANKS_SUBJECT = "Thank you for being a MySession Founding Member";

function escapeHtml(input: unknown) {
  return String(input ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** First word of the profile name, or null when there is nothing usable. */
export function foundingThanksFirstName(fullName: unknown): string | null {
  const first = String(fullName ?? "").trim().split(/\s+/)[0] || "";
  if (!first || first.includes("@") || first.length > 40) return null;
  return first;
}

export function buildFoundingThanksEmail(params: { fullName?: string | null; appUrl: string }) {
  const firstName = foundingThanksFirstName(params.fullName);
  const appUrl = params.appUrl.replace(/\/+$/, "");
  const sessionsUrl = `${appUrl}/sessions?utm_source=email&utm_medium=founding_thanks&utm_campaign=${FOUNDING_THANKS_CAMPAIGN}`;
  const greeting = firstName ? `Thank you, ${firstName}.` : "Thank you.";
  const subject = FOUNDING_THANKS_SUBJECT;
  const preheader = "You kept showing up while we rebuilt MySession. Come focus with us again this week.";

  const paragraphs = [
    "While MySession was being rebuilt, you kept showing up. You joined sessions, set your tasks and worked alongside other people, and you chose MySession while it was still finding its feet. That meant more to us than we can say.",
    "As a thank-you, your account has Founding Member Pro: full access to MySession, free and permanent. There is nothing to set up and nothing to pay.",
    "We would love to see you in a session again. Pick a time that suits you; even one focused hour makes a difference, and it is always easier together.",
  ];

  const text = [
    greeting,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    `Find a session: ${sessionsUrl}`,
    "",
    "With gratitude,",
    "The MySession team",
    "",
    "You are receiving this one-time note because you are a MySession Founding Member. You were not added to a marketing list. Questions? Just reply to this email.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f3;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<div style="background:#f5f5f3;padding:36px 16px;font-family:Inter,Arial,sans-serif;color:#2f2f2f;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:24px;padding:32px;border:1px solid #e7e7e4;">
    <div style="font-size:24px;font-weight:800;letter-spacing:-0.04em;margin-bottom:24px;">MySession</div>
    <div style="display:inline-block;border-radius:999px;background:#1c2640;border:1px solid #e2bc4f;color:#f2cb55;padding:7px 14px;font-size:12px;font-weight:700;letter-spacing:0.02em;margin-bottom:18px;">&#9733; Founding Member</div>
    <h1 style="font-size:28px;line-height:1.2;margin:0 0 16px;letter-spacing:-0.025em;">${escapeHtml(greeting)}</h1>
    ${paragraphs
      .map((p) => `<p style="font-size:15px;line-height:1.65;color:#4a4a4a;margin:0 0 16px;">${escapeHtml(p)}</p>`)
      .join("\n    ")}
    <div style="background:#f4f4f2;border-radius:16px;padding:16px 18px;margin:8px 0 24px;">
      <div style="font-size:13px;font-weight:700;color:#2f2f2f;margin-bottom:8px;">Waiting for you</div>
      <div style="font-size:14px;line-height:1.7;color:#4a4a4a;">Scheduled group sessions through the day<br>24/7 focus rooms you can drop into any time<br>Your tasks, timer and music right in the room</div>
    </div>
    <a href="${escapeHtml(sessionsUrl)}" style="display:block;text-align:center;background:#2f2f2f;color:#ffffff;text-decoration:none;border-radius:14px;padding:14px 18px;font-size:15px;font-weight:700;">Find a session</a>
    <p style="font-size:15px;line-height:1.65;color:#4a4a4a;margin:24px 0 0;">With gratitude,<br><strong style="color:#2f2f2f;">The MySession team</strong></p>
    <p style="font-size:12px;line-height:1.55;color:#8a8a8a;margin:24px 0 0;border-top:1px solid #eeeeec;padding-top:16px;">You are receiving this one-time note because you are a MySession Founding Member. You were not added to a marketing list. Questions? Just reply to this email.</p>
  </div>
</div>
</body></html>`;

  return { subject, html, text, sessionsUrl };
}
