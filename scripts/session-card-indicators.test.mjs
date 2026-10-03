import assert from "node:assert/strict";
import { test } from "node:test";
import { getSessionCardPolicyState } from "../src/lib/sessionCardIndicators.ts";

const policy = (overrides = {}) => ({
  cameraRequired: false,
  screenShareRequired: false,
  publicChatDisabled: false,
  cameraOrScreenShareRequired: false,
  ...overrides,
});

test("zero to three required policy icons appear only for enabled settings", () => {
  assert.equal(getSessionCardPolicyState(policy()).count, 0);
  assert.deepEqual(
    getSessionCardPolicyState(policy({ cameraRequired: true })),
    { camera: true, screen: false, chat: false, either: false, label: "Camera required", count: 1 },
  );
  const two = getSessionCardPolicyState(policy({ screenShareRequired: true, publicChatDisabled: true }));
  assert.equal(two.count, 2);
  assert.equal(two.label, "Screen share required · Public chat off");
  const three = getSessionCardPolicyState(policy({ cameraRequired: true, screenShareRequired: true, publicChatDisabled: true }));
  assert.equal(three.count, 3);
  assert.equal(three.label, "Camera required · Screen share required · Public chat off");
});

test("camera-or-screen-share remains an alternative requirement", () => {
  const either = getSessionCardPolicyState(policy({ cameraOrScreenShareRequired: true }));
  assert.equal(either.count, 2);
  assert.equal(either.label, "Camera or screen share required");
  const contradictory = getSessionCardPolicyState(policy({ cameraRequired: true, cameraOrScreenShareRequired: true }));
  assert.equal(contradictory.count, 1);
  assert.equal(contradictory.label, "Camera required");
});
