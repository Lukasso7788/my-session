import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readRoomPolicies,
  readSessionRoomPolicies,
  shouldEnforceMediaPolicyForRole,
  withRoomPolicies,
} from '../src/lib/roomPolicies.ts';

test('legacy rooms leave staff exempt by default', () => {
  const policies = readSessionRoomPolicies({
    camera_required: true,
    schedule: { blocks: [], room_policies: { camera_required: true } },
  });
  assert.equal(policies.mediaRequirementsApplyToStaff, false);
  assert.equal(shouldEnforceMediaPolicyForRole(policies, false), true);
  assert.equal(shouldEnforceMediaPolicyForRole(policies, true), false);
});

test('staff enforcement survives schedule serialization and session policy reads', () => {
  const schedule = withRoomPolicies(
    { blocks: [{ type: 'focus', duration: 25 }], free_flow: true },
    {
      cameraRequired: false,
      screenShareRequired: false,
      cameraOrScreenShareRequired: true,
      mediaRequirementsApplyToStaff: true,
      publicChatDisabled: false,
    },
  );
  assert.equal(schedule.free_flow, true);
  assert.deepEqual(schedule.blocks, [{ type: 'focus', duration: 25 }]);
  assert.equal(schedule.room_policies.media_requirements_apply_to_staff, true);

  const policies = readSessionRoomPolicies({ schedule });
  assert.equal(policies.cameraOrScreenShareRequired, true);
  assert.equal(policies.mediaRequirementsApplyToStaff, true);
  assert.equal(shouldEnforceMediaPolicyForRole(policies, true), true);
  assert.equal(shouldEnforceMediaPolicyForRole(policies, false), true);
  assert.equal(readRoomPolicies(JSON.stringify(schedule)).mediaRequirementsApplyToStaff, true);
});

test('turning staff enforcement off does not change the media rule', () => {
  const schedule = withRoomPolicies([], {
    cameraRequired: true,
    screenShareRequired: false,
    cameraOrScreenShareRequired: false,
    mediaRequirementsApplyToStaff: false,
    publicChatDisabled: false,
  });
  const policies = readSessionRoomPolicies({ schedule, camera_required: true });
  assert.equal(policies.cameraRequired, true);
  assert.equal(shouldEnforceMediaPolicyForRole(policies, true), false);
  assert.equal(shouldEnforceMediaPolicyForRole(policies, false), true);
});
