// Per-device video quality choices from room settings. "auto" always means
// the room's built-in behaviour, unchanged: the device-tier camera preset when
// sending, and the room-size cap when receiving.

export type VideoQualityChoice = "auto" | "high" | "medium" | "low";

export const VIDEO_QUALITY_CHOICES: readonly VideoQualityChoice[] = ["auto", "high", "medium", "low"];

const SEND_KEY = "mysession_video_quality_send";
const RECEIVE_KEY = "mysession_video_quality_receive";

export type CameraCapturePreset = { width: number; height: number; fps: number };
export type VideoDimensions = { width: number; height: number };

/** Camera capture when the person picks a quality instead of Auto. */
export const SEND_VIDEO_PRESETS: Record<Exclude<VideoQualityChoice, "auto">, CameraCapturePreset> = {
  high: { width: 960, height: 540, fps: 24 },
  medium: { width: 640, height: 360, fps: 15 },
  low: { width: 320, height: 180, fps: 10 },
};

/** Largest camera size requested from each other participant. */
export const RECEIVE_VIDEO_CAPS: Record<Exclude<VideoQualityChoice, "auto">, VideoDimensions> = {
  high: { width: 1280, height: 720 },
  medium: { width: 640, height: 360 },
  low: { width: 320, height: 180 },
};

/** The room's own cap by size (unchanged): what "auto" receives. */
export function autoReceiveCap(participantsCount: number): VideoDimensions {
  return participantsCount <= 2
    ? { width: 1280, height: 720 }
    : participantsCount <= 4
      ? { width: 854, height: 480 }
      : { width: 640, height: 360 };
}

export function receiveCapFor(choice: VideoQualityChoice, participantsCount: number): VideoDimensions {
  return choice === "auto" ? autoReceiveCap(participantsCount) : RECEIVE_VIDEO_CAPS[choice];
}

/** Null for Auto, so callers keep their existing device-based preset. */
export function sendPresetOverride(choice: VideoQualityChoice): CameraCapturePreset | null {
  return choice === "auto" ? null : SEND_VIDEO_PRESETS[choice];
}

export function normalizeVideoQualityChoice(value: unknown): VideoQualityChoice {
  return VIDEO_QUALITY_CHOICES.includes(value as VideoQualityChoice) ? (value as VideoQualityChoice) : "auto";
}

function read(key: string): VideoQualityChoice {
  try {
    return normalizeVideoQualityChoice(window.localStorage.getItem(key));
  } catch {
    return "auto";
  }
}

function write(key: string, value: VideoQualityChoice) {
  try {
    if (value === "auto") window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in strict privacy modes; the choice still
    // applies for this visit.
  }
}

export const readSendVideoQuality = () => read(SEND_KEY);
export const readReceiveVideoQuality = () => read(RECEIVE_KEY);
export const writeSendVideoQuality = (value: VideoQualityChoice) => write(SEND_KEY, value);
export const writeReceiveVideoQuality = (value: VideoQualityChoice) => write(RECEIVE_KEY, value);
