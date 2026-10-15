import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildFoundingThanksEmail, FOUNDING_THANKS_CAMPAIGN, foundingThanksFirstName } from "./foundingThanksEmail.ts";

test("greets by first name and falls back politely", () => {
  assert.equal(foundingThanksFirstName("Anna Fischer"), "Anna");
  assert.equal(foundingThanksFirstName("  "), null);
  assert.equal(foundingThanksFirstName("someone@example.com"), null);
  assert.match(buildFoundingThanksEmail({ fullName: "Anna Fischer", appUrl: "https://www.mysession.club" }).html, /Thank you, Anna\./);
  assert.match(buildFoundingThanksEmail({ fullName: null, appUrl: "https://www.mysession.club" }).html, />Thank you\.</);
});

test("thanks, invites to a session and links to the sessions page", () => {
  const email = buildFoundingThanksEmail({ fullName: "Anna", appUrl: "https://www.mysession.club/" });
  assert.equal(email.subject, "Thank you for being a MySession Founding Member");
  assert.match(email.html, /you kept showing up/);
  assert.match(email.html, /Founding Member Pro: full access to MySession, free and permanent/);
  assert.match(email.html, />Find a session</);
  assert.ok(email.sessionsUrl.startsWith("https://www.mysession.club/sessions?"));
  assert.ok(email.sessionsUrl.includes(`utm_campaign=${FOUNDING_THANKS_CAMPAIGN}`));
  assert.match(email.text, /Find a session: https:\/\/www\.mysession\.club\/sessions/);
});

test("names are escaped in the HTML", () => {
  const email = buildFoundingThanksEmail({ fullName: "<b>Eve</b>", appUrl: "https://www.mysession.club" });
  assert.doesNotMatch(email.html, /<b>Eve<\/b>/);
  assert.match(email.html, /&lt;b&gt;Eve&lt;\/b&gt;/);
});

test("the admin send is guarded, batched and logged once per person", () => {
  const admin = readFileSync(new URL("../livekit/admin.ts", import.meta.url), "utf8");
  // Audience: active Founding Member Pro, minus lifecycle opt-outs.
  assert.match(admin, /\.eq\("plan", "founding_free"\)\s*\.in\("status", \["active", "trialing"\]\)/);
  assert.match(admin, /\.eq\("lifecycle_email_enabled", false\)/);
  // A typed confirm phrase, the send log, small batches and a per-person idempotency key.
  assert.match(admin, /String\(body\.confirmPhrase \|\| ""\)\.trim\(\) !== FOUNDING_THANKS_CONFIRM/);
  assert.match(admin, /error: "one_time_email_ledger_missing"/);
  assert.match(admin, /const FOUNDING_THANKS_BATCH_MAX = 25;/);
  assert.match(admin, /idempotencyKey: `\$\{FOUNDING_THANKS_CAMPAIGN\}:\$\{recipient\.userId\}`/);
  // Someone already sent is never claimed again.
  assert.match(admin, /if \(!row \|\| row\.status === "sent"\) return false;/);
  const migration = readFileSync(new URL("../../supabase/migrations/20261015090000_one_time_email_sends.sql", import.meta.url), "utf8");
  assert.match(migration, /primary key \(campaign, user_id\)/);
  assert.match(migration, /revoke all on public\.one_time_email_sends from anon, authenticated;/);
});
