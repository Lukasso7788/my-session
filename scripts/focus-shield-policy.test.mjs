import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  collectBlockTargets,
  createActivePolicy,
  formatShieldRemaining,
  isShieldLocked,
  isShieldRunning,
  normalizeDomain,
  parseCustomBlockList,
  previewSiteLabel,
} from "../src/components/focusshield/policy.ts";
import { buildLocalAiPreview } from "../src/components/session-ai/reply.ts";
import { FOCUS_SHIELD_PAGE_RESULT, FOCUS_SHIELD_PAGE_SOURCE } from "../src/components/focusshield/policy.ts";

test("custom block list separates whole sites from one page", () => {
  const parsed = parseCustomBlockList("youtube.com\nhttps://www.youtube.com/shorts\nreddit.com/r/all\n");
  assert.deepEqual(parsed.domains, ["youtube.com"]);
  assert.deepEqual(parsed.urls, [
    "https://www.youtube.com/shorts",
    "https://reddit.com/r/all",
  ]);
});

test("shield policy locks until the timer and then expires", () => {
  const now = 1_700_000_000_000;
  const policy = createActivePolicy({
    domains: ["YouTube.com", "youtube.com"],
    urls: ["https://www.youtube.com/shorts"],
    minutes: 25,
    locked: true,
    now,
  });
  assert.deepEqual(policy.web.domains, ["youtube.com"]);
  assert.equal(normalizeDomain("https://www.YouTube.com/feed"), "youtube.com");
  assert.equal(isShieldRunning(policy, now + 60_000), true);
  assert.equal(isShieldLocked(policy, now + 60_000), true);
  assert.equal(isShieldRunning(policy, now + 25 * 60_000), false);
  assert.equal(formatShieldRemaining(policy.endAt, now + 65_000), "23:55");
});

test("preview names the first chosen site", () => {
  const targets = collectBlockTargets(["reddit.com"], "https://news.ycombinator.com/news");
  assert.equal(previewSiteLabel(targets.domains, targets.urls), "reddit.com");
  assert.equal(previewSiteLabel([], targets.urls), "news.ycombinator.com/news");
});

test("AI preview stays local and private until the person posts it", () => {
  const preview = buildLocalAiPreview({
    phase: "next",
    name: "Ada",
    text: "Finish the outline.",
  });
  assert.match(preview.publicSpoken, /Ada/);
  assert.equal(preview.taskText, "Finish the outline");
  assert.equal(preview.privateAdvice[0], "Finish the outline");
  assert.equal(preview.source, "fallback");
});

test("session page and extension use the same preview bridge", () => {
  const bridge = readFileSync(new URL("../focusshield/extension/content_bridge.js", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../focusshield/extension/service_worker.js", import.meta.url), "utf8");
  const room = readFileSync(new URL("../src/pages/RoomPageLiveKit.tsx", import.meta.url), "utf8");
  const bar = readFileSync(new URL("../src/pages/livekit/LiveKitBottomBarLegacy.tsx", import.meta.url), "utf8");
  assert.match(bridge, new RegExp(FOCUS_SHIELD_PAGE_SOURCE));
  assert.match(bridge, new RegExp(FOCUS_SHIELD_PAGE_RESULT));
  assert.match(worker, /APPLY_POLICY/);
  assert.match(worker, /SAVE_LIST/);
  assert.match(worker, /savedLists: normalizeSavedLists\(currentPolicy\?\.savedLists\)/);
  assert.match(room, /onOpenAi=\{\(\) => openRightTab\("ai"\)\}/);
  assert.match(room, /onOpenFocusShield=\{\(\) => openRightTab\("focus"\)\}/);
  assert.match(readFileSync(new URL("../src/components/focusshield/FocusShieldPanel.tsx", import.meta.url), "utf8"), /Blocked page preview/);
  assert.match(readFileSync(new URL("../src/components/session-ai/SessionAiPanel.tsx", import.meta.url), "utf8"), /AI reply preview/);
  assert.match(bar, /title=\{focusShieldActive \? "Focus Shield is on" : "Focus Shield"\}/);
});
