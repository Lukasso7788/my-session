export type RoomPolicies = {
  cameraRequired: boolean;
  publicChatDisabled: boolean;
  screenShareRequired?: boolean;
  cameraOrScreenShareRequired?: boolean;
  microphoneLocked?: boolean;
};

export const DEFAULT_ROOM_POLICIES: RoomPolicies = {
  cameraRequired: false,
  publicChatDisabled: false,
  screenShareRequired: false,
  cameraOrScreenShareRequired: false,
  microphoneLocked: false,
};

function parseSchedule(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readRoomPolicies(schedule: unknown): RoomPolicies {
  const parsed = parseSchedule(schedule);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...DEFAULT_ROOM_POLICIES };
  }

  const raw = (parsed as Record<string, any>).room_policies;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_ROOM_POLICIES };
  }

  return {
    cameraRequired: raw.camera_required === true,
    publicChatDisabled: raw.public_chat_disabled === true,
    screenShareRequired: raw.screen_share_required === true,
    cameraOrScreenShareRequired: raw.camera_or_screen_share_required === true,
    microphoneLocked: raw.microphone_locked === true,
  };
}

export function readSessionRoomPolicies(
  session:
    | {
        camera_required?: boolean | null;
        public_chat_disabled?: boolean | null;
        screen_share_required?: boolean | null;
        microphone_locked?: boolean | null;
        schedule?: unknown;
      }
    | null
    | undefined,
): RoomPolicies {
  const legacy = readRoomPolicies(session?.schedule);

  return {
    cameraRequired:
      typeof session?.camera_required === "boolean"
        ? session.camera_required
        : legacy.cameraRequired,
    publicChatDisabled:
      typeof session?.public_chat_disabled === "boolean"
        ? session.public_chat_disabled
        : legacy.publicChatDisabled,
    screenShareRequired:
      typeof session?.screen_share_required === "boolean"
        ? session.screen_share_required
        : legacy.screenShareRequired === true,
    cameraOrScreenShareRequired: legacy.cameraOrScreenShareRequired === true,
    microphoneLocked:
      typeof session?.microphone_locked === "boolean"
        ? session.microphone_locked
        : legacy.microphoneLocked,
  };
}

export function withRoomPolicies(
  schedule: unknown,
  policies: RoomPolicies,
): Record<string, unknown> {
  const parsed = parseSchedule(schedule);
  const roomPolicies = {
    camera_required: policies.cameraRequired === true,
    public_chat_disabled: policies.publicChatDisabled === true,
    screen_share_required: policies.screenShareRequired === true,
    camera_or_screen_share_required: policies.cameraOrScreenShareRequired === true,
    microphone_locked: policies.microphoneLocked === true,
  };

  if (Array.isArray(parsed)) {
    return { blocks: parsed, room_policies: roomPolicies };
  }

  if (parsed && typeof parsed === "object") {
    return {
      ...(parsed as Record<string, unknown>),
      room_policies: roomPolicies,
    };
  }

  return { blocks: [], room_policies: roomPolicies };
}
