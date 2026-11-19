import assert from "node:assert/strict";
import test from "node:test";
import {
  accountUrl,
  authWindowDecision,
} from "./oauth-protocol.cjs";

test("login and registration stay on the MySession origin already open in the app", () => {
  assert.equal(accountUrl("https://www.mysession.club/sessions", "login"), "https://www.mysession.club/login");
  assert.equal(accountUrl("https://mysession.club/rooms", "register"), "https://mysession.club/register");
  assert.equal(accountUrl("https://evil.example/sessions", "login"), "https://mysession.club/login");
  assert.equal(authWindowDecision("https://mysession.club/login"), "app");
  assert.equal(authWindowDecision("https://www.mysession.club/register"), "app");
  assert.equal(authWindowDecision("https://mysession.club/auth/callback?code=one-time"), "app");
  assert.throws(() => accountUrl("https://mysession.club/sessions", "sessions"));
});

test("provider pages open inside the app window and other sites stay blocked", () => {
  assert.equal(authWindowDecision("https://cxqgzcjsjyszcbcbdusp.supabase.co/auth/v1/authorize?provider=google"), "provider");
  assert.equal(authWindowDecision("https://cxqgzcjsjyszcbcbdusp.supabase.co/auth/v1/callback?code=example"), "provider");
  assert.equal(authWindowDecision("https://untrusted.supabase.co/auth/v1/authorize?provider=google"), "block");
  assert.equal(authWindowDecision("https://accounts.google.com/o/oauth2/v2/auth?client_id=1"), "provider");
  assert.equal(authWindowDecision("https://discord.com/api/oauth2/authorize?client_id=1"), "provider");
  assert.equal(authWindowDecision("https://www.facebook.com/v18.0/dialog/oauth?client_id=1"), "provider");
  assert.equal(authWindowDecision("https://example.com/help"), "block");
  assert.equal(authWindowDecision("https://project.supabase.co/auth/v1/authorize?provider=apple"), "block");
  assert.equal(authWindowDecision("https://user:pass@mysession.club/login"), "block");
});
