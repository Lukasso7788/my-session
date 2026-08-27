// src/pages/RoomPageLiveKit.tsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  Clock3,
  Users,
  X,
} from "lucide-react";
import {
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  RemoteParticipant,
  LocalVideoTrack,
  LocalAudioTrack,
  RemoteAudioTrack,
  LocalTrackPublication,
  RemoteTrackPublication,
  createLocalVideoTrack,
} from "livekit-client";

import {
  supportsBackgroundProcessors,
  supportsModernBackgroundProcessors,
} from "@livekit/track-processors";

import { supabase } from "../lib/supabase";
import { withTimeout } from "../lib/promiseTimeout";
import { readSessionRoomPolicies, withRoomPolicies, type RoomPolicies } from "../lib/roomPolicies";
import { captureProductEvent } from "../lib/analytics";
import { USAGE_TRACKING_ENABLED } from "../lib/flags";
import { incrementWeeklyUsage } from "../lib/usage";
import {
  loadEntitlementState,
  isPersonalPaywallForced,
  type EntitlementState,
} from "../lib/entitlements";
import { getPaywallDecision } from "../lib/paywall";
import {
  getCurrentUserActiveBan,
  isCurrentUserAdmin,
  type ActiveBan,
} from "../lib/bans";
import {
  ROOM_SOUNDSCAPE_OPTIONS,
  RoomSoundscapeEngine,
  type RoomSoundscapeId,
} from "../lib/roomSoundscapes";
import PaywallModal from "../components/PaywallModal";
import ActiveBanModal from "../components/ActiveBanModal";
import BugReportModal from "../components/BugReportModal";

import ChatPanel from "../components/ChatPanel";
import { TasksPanel } from "../components/TasksPanel";
import AIHostedRoomController from "../components/ai-host/AIHostedRoomController";
import JoinGateModal, {
  type JoinGateHostSession,
} from "../components/JoinGateModal";
import { UserProfileModal } from "../components/UserProfileModal";
import RoomTopBar from "../components/RoomTopBar";
import RoomTimelineEditor, {
  type RoomTimelineBlock,
  timelineBlocksFromSchedule,
  timelineBlocksToSchedulePayload,
  getTimelineTotalMinutes,
  makeDefaultTimelineBlocks,
  makeFreeFlowTimelineBlocks,
  FREE_FLOW_TIMELINE_PRESETS,
} from "../components/RoomTimelineEditor";
import { resolveStageVisual } from "../components/SessionStageBar";
import { LiveKitBottomBar } from "./livekit/LiveKitBottomBar";
import RoomSoundscapePanel from "./livekit/RoomSoundscapePanel";
import {
  Icon,
  reactionEmoji as REACTION_EMOJI,
  type ReactionType,
  type RoomTheme,
} from "./livekit/LiveKitUI";

import { PreJoinModal } from "./livekit/PreJoinModalLiveKit";
import { RoomSettingsModalLiveKit } from "./livekit/RoomSettingsModalLiveKit";
import { SkipMeMutedStatusIcon, VideoTile } from "./livekit/VideoTileLiveKit";
import type { CameraFramingMode } from "./livekit/VideoTileLiveKit";
import {
  RoomAudioRenderer,
  StartAudio,
  useTrackToggle,
} from "@livekit/components-react";
import ReportParticipantModalLiveKit from "./livekit/ReportParticipantModalLiveKit";
import { buildScreenShareTiles } from "./livekit/screenShareHelpers";
import LiveKitPiPPortal from "./livekit/LiveKitPiPPortal";
import {
  createPersonColorBackgroundProcessor,
  createPublishedColorCorrectionProcessor,
  isPublishedColorCorrectionIdentity,
  publishedColorCorrectionSignature,
  type PublishedColorCorrection,
} from "./livekit/PersonColorCorrectionProcessor";

import {
  useElementSize,
  GridLayoutSizing,
  P2PLayoutSizing,
  MobileFillLayoutSizing,
  MobileStackLayoutSizing,
  type MobileVideoLayoutMode,
  type VideoTileLayoutPreset,
} from "./livekit/sizing";

type FxMode = "off" | "blur" | "bg";

const PARTICIPANT_CONTROL_TOPIC = "mysession.participant-control.v1";

type VoiceUiCommand =
  | "camera_on"
  | "camera_off"
  | "microphone_on"
  | "microphone_off"
  | "tasks_open"
  | "tasks_close"
  | "chat_open"
  | "chat_close"
  | "theme_light"
  | "theme_dark"
  | "participants_open"
  | "participants_close"
  | "settings_open"
  | "settings_close"
  | "background_change"
  | "background_upload"
  | "background_ocean"
  | "background_forest"
  | "background_violet"
  | "background_sunset"
  | `custom_background_${string}`
  | "blur_apply"
  | `blur_strength_${number}`
  | "effects_off"
  | "background_reset"
  | "mirror_on"
  | "mirror_off"
  | "panels_close_all"
  | "voice_restart"
  | "task_add"
  | "task_complete"
  | "message_compose"
  | "message_send"
  | "message_confirm"
  | "message_cancel"
  | "dictate_example"
  | "task_text_example"
  | "message_text_example"
  | "message_send_text_example"
  | "click_control_example"
  | `dictate_${string}`
  | `task_text_${string}`
  | `message_text_${string}`
  | `message_send_text_${string}`
  | `layout_columns_${number}`
  | `layout_rows_${number}`
  | `brightness_${number}`
  | `contrast_${number}`
  | `saturation_${number}`
  | `stage_volume_${number}`
  | `participant_volume_${number}`
  | `participant_pin_${string}`
  | `participant_unpin_${string}`
  | `participant_report_${string}`
  | `participant_manage_${string}`
  | `click_control_${string}`
  | "status_afk"
  | "status_skip"
  | "status_skip_deafened"
  | "status_call"
  | "status_break"
  | "status_eating"
  | "status_private"
  | "status_clear"
  | "screen_share_on"
  | "screen_share_off"
  | "pip_open"
  | "pip_close"
  | "accountability_open"
  | "accountability_close"
  | "layout_auto"
  | "layout_one"
  | "layout_two"
  | "layout_three"
  | "layout_four"
  | "ai_host_open"
  | "ai_host_close"
  | "bug_report_open"
  | "bug_report_close"
  | "host_profile_open"
  | "profile_close"
  | "timeline_open"
  | "timeline_close"
  | "timeline_save"
  | "edit_name_open"
  | "edit_name_close"
  | "edit_name_save"
  | "modal_close"
  | "chat_general"
  | "chat_direct"
  | "color_correction_on"
  | "color_correction_off"
  | "color_correction_reset"
  | "echo_cancellation_on"
  | "echo_cancellation_off"
  | "noise_suppression_on"
  | "noise_suppression_off"
  | "auto_gain_on"
  | "auto_gain_off"
  | "join_sound_on"
  | "join_sound_off"
  | "leave_sound_on"
  | "leave_sound_off"
  | "stage_sounds_on"
  | "stage_sounds_off"
  | "task_timers_on"
  | "task_timers_off"
  | "mobile_layout_switcher_on"
  | "mobile_layout_switcher_off"
  | "audio_resume"
  | "mobile_media_restore"
  | "leave_room"
  | "reaction_fire"
  | "reaction_laugh"
  | "reaction_thumbs_up"
  | "reaction_thumbs_down"
  | "reaction_heart"
  | "reaction_clap"
  | "reaction_ok"
  | "reaction_wave"
  | "reaction_celebrate"
  | "reaction_clover";

type VoiceUiStatus =
  | "idle"
  | "starting"
  | "listening"
  | "blocked"
  | "unsupported";

type SpeechRecognitionErrorLike = { error?: string };
type SpeechRecognitionAlternativeLike = { transcript?: string };
type SpeechRecognitionResultLike = {
  isFinal?: boolean;
  length?: number;
  [index: number]: SpeechRecognitionAlternativeLike;
};
type SpeechRecognitionEventLike = {
  resultIndex?: number;
  results?: {
    length?: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: null | (() => void);
  onend: null | (() => void);
  onerror: null | ((event: SpeechRecognitionErrorLike) => void);
  onresult: null | ((event: SpeechRecognitionEventLike) => void);
};

type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructorLike | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructorLike;
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
  };
  return (
    speechWindow.SpeechRecognition ||
    speechWindow.webkitSpeechRecognition ||
    null
  );
}

function normalizeVoiceUiTranscript(raw: string) {
  return String(raw || "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^(?:(?:please|hey mysession|hey my session|mysession|my session|can you|could you|would you|will you|i want you to|let s|go ahead and)\s+)+/, "")
    .replace(/\s+(?:please|for me|right now)$/g, "")
    .replace(/\b(?:cam|web cam|webcam|video)\s+of$/g, "camera off")
    .replace(/\b(?:mic|mike|microphone|sound|audio|voice)\s+of$/g, "microphone off")
    .replace(/\b(?:cam|web cam|webcam|video)\s+one$/g, "camera on")
    .replace(/\b(?:mic|mike|microphone|sound|audio|voice)\s+one$/g, "microphone on")
    .trim();
}

function getVoiceUiPhraseVariants(rawPhrase: string): string[] {
  const normalized = normalizeVoiceUiTranscript(rawPhrase);
  if (!normalized || rawPhrase.includes("[")) return normalized ? [normalized] : [];

  const variants = new Set<string>([normalized]);
  const substitutions: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
    [/\bcamera\b/g, ["cam", "webcam", "web cam", "video"]],
    [/\bmicrophone\b/g, ["mic", "mike", "sound", "audio", "voice"]],
    [/\bscreen share\b/g, ["screen sharing", "share my screen", "display sharing"]],
    [/\bopen\b/g, ["show", "display", "bring up"]],
    [/\bclose\b/g, ["hide", "dismiss"]],
    [/\benable\b/g, ["turn on", "switch on", "start"]],
    [/\bdisable\b/g, ["turn off", "switch off", "stop"]],
    [/\bstart\b/g, ["begin", "enable", "turn on"]],
    [/\bstop\b/g, ["end", "disable", "turn off"]],
    [/\bparticipants\b/g, ["people", "members"]],
    [/\bdirect messages\b/g, ["dms", "private messages"]],
    [/\bsettings\b/g, ["preferences", "options"]],
    [/\bbackground\b/g, ["backdrop", "video background"]],
    [/\bpicture in picture\b/g, ["pip", "picture over picture"]],
    [/\btasks\b/g, ["task panel", "to do list", "todo list"]],
    [/\btask\b/g, ["todo", "to do", "intention"]],
    [/\bchat\b/g, ["messages", "message panel"]],
    [/\bmessage\b/g, ["chat message", "text"]],
    [/\baccountability wall\b/g, ["accountability view", "task wall", "focus wall"]],
    [/\btimeline\b/g, ["session timeline", "schedule"]],
    [/\blayout\b/g, ["grid", "view layout"]],
    [/\bbug report\b/g, ["issue report", "report a problem"]],
    [/\bcolor correction\b/g, ["video colors", "color adjustment"]],
    [/\bnoise suppression\b/g, ["noise reduction", "background noise reduction"]],
    [/\bauto gain\b/g, ["automatic gain", "gain control"]],
    [/\bjoin sound\b/g, ["entrance sound", "entry sound"]],
    [/\bleave sound\b/g, ["exit sound", "departure sound"]],
    [/\bstage sounds\b/g, ["timeline sounds", "session sounds"]],
    [/\broom audio\b/g, ["room sound", "audio playback"]],
  ];

  const queue: Array<{ phrase: string; usedSubstitutions: ReadonlySet<number> }> = [
    { phrase: normalized, usedSubstitutions: new Set<number>() },
  ];
  while (queue.length > 0 && variants.size < 96) {
    const current = queue.shift();
    if (!current) break;
    substitutions.forEach(([pattern, replacements], substitutionIndex) => {
      if (current.usedSubstitutions.has(substitutionIndex)) return;
      pattern.lastIndex = 0;
      if (!pattern.test(current.phrase)) return;
      pattern.lastIndex = 0;
      for (const replacement of replacements) {
        const candidate = current.phrase.replace(pattern, replacement).replace(/\s+/g, " ").trim();
        pattern.lastIndex = 0;
        if (!candidate || variants.has(candidate)) continue;
        variants.add(candidate);
        queue.push({
          phrase: candidate,
          usedSubstitutions: new Set([...current.usedSubstitutions, substitutionIndex]),
        });
        if (variants.size >= 96) break;
      }
    });
  }

  for (const phrase of [...variants]) {
    const withoutArticles = phrase.replace(/\b(?:a|the|my)\b/g, " ").replace(/\s+/g, " ").trim();
    if (withoutArticles) variants.add(withoutArticles);
  }

  if (/\boff$/.test(normalized)) variants.add(normalized.replace(/\boff$/, "of"));
  if (/\bon$/.test(normalized)) variants.add(normalized.replace(/\bon$/, "one"));
  return [...variants];
}

function parseVoiceUiSpokenNumber(raw: string): number | null {
  const cleaned = normalizeVoiceUiTranscript(raw)
    .replace(/\s+(?:percent|per cent)$/, "")
    .replace(/\band\b/g, " ")
    .trim();
  if (/^\d{1,3}$/.test(cleaned)) return Number(cleaned);

  const values: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
    twenty: 20, thirty: 30, forty: 40, fifty: 50,
    sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  };
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  let value = 0;
  let matched = false;
  for (const token of tokens) {
    if (token === "hundred") {
      value = Math.max(1, value) * 100;
      matched = true;
      continue;
    }
    const part = values[token];
    if (part == null) return null;
    value += part;
    matched = true;
  }
  return matched ? value : null;
}
function getVoiceUiCommandHint(definition: VoiceUiCommandDefinition): string {
  if (definition.hint) return definition.hint;
  const examples = [definition.phrase, ...(definition.aliases || [])]
    .filter((phrase) => !phrase.includes("["))
    .filter((phrase, index, phrases) => phrases.indexOf(phrase) === index)
    .slice(0, 3);
  return examples.join(" / ") || definition.phrase;
}

type VoiceUiCommandGroupId = "media" | "status" | "panels" | "views" | "tools" | "reactions";

type VoiceUiCommandDefinition = {
  command: VoiceUiCommand;
  group: VoiceUiCommandGroupId;
  phrase: string;
  aliases?: readonly string[];
  hint?: string;
};

const VOICE_UI_COMMAND_DEFINITIONS: readonly VoiceUiCommandDefinition[] = [
  { command: "camera_on", group: "media", phrase: "Cam-on", aliases: ["Cam on", "Cam one", "Camon", "Camp on", "Come on", "Came on", "Cameron", "Camera on", "Webcam on", "Web cam on", "Video on", "Turn on camera", "Turn on the camera", "Turn camera on", "Turn the camera on", "Switch camera on", "Switch the camera on", "Enable camera", "Enable the camera", "Start camera", "Start the camera"], hint: "Cam on / Video on / Camera on" },
  { command: "camera_off", group: "media", phrase: "Cam-off", aliases: ["Cam off", "Cam of", "Camoff", "Camp off", "Come off", "Came off", "Camera off", "Webcam off", "Web cam off", "Video off", "Turn off camera", "Turn off the camera", "Turn of camera", "Turn of the camera", "Turn camera off", "Turn the camera off", "Switch camera off", "Switch the camera off", "Disable camera", "Disable the camera", "Stop camera", "Stop the camera"], hint: "Cam off / Video off / Camera off" },
  { command: "microphone_on", group: "media", phrase: "Unmute", aliases: ["Mic on", "Microphone on", "Unmute mic", "Unmute the mic", "Unmute microphone", "Unmute the microphone", "Turn on mic", "Turn on the mic", "Turn on microphone", "Turn on the microphone", "Turn mic on", "Turn microphone on", "Switch mic on", "Switch microphone on", "Enable mic", "Enable microphone", "Start mic", "Start microphone"], hint: "Unmute / Mic on / Sound on" },
  { command: "microphone_off", group: "media", phrase: "Mute", aliases: ["Mic off", "Microphone off", "Mute mic", "Mute the mic", "Mute microphone", "Mute the microphone", "Turn off mic", "Turn off the mic", "Turn off microphone", "Turn off the microphone", "Turn of microphone", "Turn of the microphone", "Turn mic off", "Turn microphone off", "Switch mic off", "Switch microphone off", "Disable mic", "Disable microphone", "Stop mic", "Stop microphone"], hint: "Mute / Mic off / Sound off" },
  { command: "screen_share_on", group: "media", phrase: "Share screen", aliases: ["Share my screen", "Start screen share", "Start screen sharing", "Enable screen sharing"] },
  { command: "screen_share_off", group: "media", phrase: "Stop sharing screen", aliases: ["Stop screen share", "Stop screen sharing", "Turn off screen sharing"] },

  { command: "status_skip", group: "status", phrase: "Skip me", aliases: ["Set skip me", "Mark me as skip me"] },
  { command: "status_skip_deafened", group: "status", phrase: "Skip me muted", aliases: ["Skip me deafen", "Skip me deafened", "Skip me muted", "Skip me with mute", "Silent skip me"] },
  { command: "status_call", group: "status", phrase: "On a call", aliases: ["I'm on a call", "I am on a call", "Set on a call"] },
  { command: "status_afk", group: "status", phrase: "AFK", aliases: ["I'm AFK", "I am AFK", "Set AFK"] },
  { command: "status_break", group: "status", phrase: "Taking a break", aliases: ["Take a break", "On a break", "I'm taking a break", "I am taking a break", "Set taking a break"] },
  { command: "status_eating", group: "status", phrase: "Eating", aliases: ["I'm eating", "I am eating", "Set eating"] },
  { command: "status_private", group: "status", phrase: "Private", aliases: ["Set private", "I'm private", "I am private", "Private status"] },
  { command: "status_clear", group: "status", phrase: "I'm back", aliases: ["I am back", "Clear my status", "Remove my badge", "Clear badge"] },

  { command: "tasks_open", group: "panels", phrase: "Open tasks", aliases: ["Open task", "Open task panel", "Open tasks panel", "Open intentions", "Show tasks"] },
  { command: "tasks_close", group: "panels", phrase: "Close tasks", aliases: ["Close task", "Close task panel", "Close tasks panel", "Close intentions", "Hide tasks"] },
  { command: "chat_open", group: "panels", phrase: "Open chat", aliases: ["Open chat panel"] },
  { command: "chat_close", group: "panels", phrase: "Close chat", aliases: ["Close chat panel"] },
  { command: "participants_open", group: "panels", phrase: "Open participants", aliases: ["Open participants panel", "Show participants", "Show people"] },
  { command: "participants_close", group: "panels", phrase: "Close participants", aliases: ["Close participants panel", "Hide participants", "Hide people"] },
  { command: "settings_open", group: "panels", phrase: "Open settings", aliases: ["Open room settings"] },
  { command: "settings_close", group: "panels", phrase: "Close settings", aliases: ["Close room settings"] },
  { command: "background_change", group: "panels", phrase: "Change background", aliases: ["Change image background", "Choose background", "Choose a background", "Open background settings"] },
  { command: "blur_apply", group: "panels", phrase: "Apply blur", aliases: ["Blur background", "Use blur"] },
  { command: "blur_strength_18", group: "panels", phrase: "Blur strength 18", aliases: ["Set blur to 18", "Blur 18"] },
  { command: "background_upload", group: "panels", phrase: "Upload image", aliases: ["Upload background", "Upload background image"] },
  { command: "background_ocean", group: "panels", phrase: "Ocean background", aliases: ["Ocean", "Choose Ocean", "Apply Ocean"] },
  { command: "background_forest", group: "panels", phrase: "Forest background", aliases: ["Forest", "Choose Forest", "Apply Forest"] },
  { command: "background_violet", group: "panels", phrase: "Violet background", aliases: ["Violet", "Choose Violet", "Apply Violet"] },
  { command: "background_sunset", group: "panels", phrase: "Sunset background", aliases: ["Sunset", "Choose Sunset", "Apply Sunset"] },
  { command: "custom_background_one", group: "panels", phrase: "1", aliases: ["One", "BG 1", "BG one", "Background 1", "Background one"], hint: "1 / bg 1" },
  { command: "custom_background_two", group: "panels", phrase: "2", aliases: ["Two", "BG 2", "BG two", "Background 2", "Background two"], hint: "2 / bg 2" },
  { command: "custom_background_three", group: "panels", phrase: "3", aliases: ["Three", "BG 3", "BG three", "Background 3", "Background three"], hint: "3 / bg 3" },
  { command: "effects_off", group: "panels", phrase: "Turn off effects", aliases: ["Remove background", "Effects off", "Disable background"] },
  { command: "background_reset", group: "panels", phrase: "Reset background", aliases: ["Default background"] },
  { command: "mirror_on", group: "panels", phrase: "Mirror camera", aliases: ["Mirror my camera"] },
  { command: "mirror_off", group: "panels", phrase: "Unmirror camera", aliases: ["Unmirror my camera"] },
  { command: "panels_close_all", group: "panels", phrase: "Close all panels", aliases: ["Close panels"] },
  { command: "task_add", group: "panels", phrase: "Add task", aliases: ["Create task", "New task"] },
  { command: "task_complete", group: "panels", phrase: "Complete task", aliases: ["Finish task"] },
  { command: "message_compose", group: "panels", phrase: "Compose message", aliases: ["Write message", "Focus message box"] },
  { command: "message_send", group: "panels", phrase: "Send message", aliases: ["Send current message", "Submit message"] },
  { command: "message_confirm", group: "panels", phrase: "Confirm", aliases: ["Confirm message", "Send it"] },
  { command: "message_cancel", group: "panels", phrase: "Cancel message", aliases: ["Discard message", "Clear message"] },
  { command: "chat_general", group: "panels", phrase: "Open all chat", aliases: ["General chat", "All chat", "Switch to all chat"] },
  { command: "chat_direct", group: "panels", phrase: "Open direct messages", aliases: ["Direct messages", "Open DMs", "Switch to DMs"] },
  { command: "dictate_example", group: "panels", phrase: "Type [text]" },
  { command: "task_text_example", group: "panels", phrase: "Add task [text]" },
  { command: "message_text_example", group: "panels", phrase: "Write message [text]" },
  { command: "message_send_text_example", group: "panels", phrase: "Send message [text]" },

  { command: "pip_open", group: "views", phrase: "Open picture in picture", aliases: ["Open PIP", "Enable picture in picture", "Start picture in picture"] },
  { command: "pip_close", group: "views", phrase: "Close picture in picture", aliases: ["Close PIP", "Disable picture in picture", "Stop picture in picture"] },
  { command: "accountability_open", group: "views", phrase: "Open accountability wall", aliases: ["Open accountability view", "Show accountability", "Switch to accountability"] },
  { command: "accountability_close", group: "views", phrase: "Show video view", aliases: ["Close accountability wall", "Close accountability view", "Switch to video", "Switch to video view"] },
  { command: "layout_auto", group: "views", phrase: "Auto layout", aliases: ["Automatic layout", "Use auto layout", "Set auto layout", "Switch to auto layout"] },
  { command: "layout_one", group: "views", phrase: "One column", aliases: ["One column layout", "Set one column layout", "Use one column layout", "1 column layout"] },
  { command: "layout_two", group: "views", phrase: "Two columns", aliases: ["Two column layout", "Set two column layout", "Use two column layout", "2 column layout"] },
  { command: "layout_three", group: "views", phrase: "Three columns", aliases: ["Three column layout", "Set three column layout", "Use three column layout", "3 column layout"] },
  { command: "layout_four", group: "views", phrase: "Four columns", aliases: ["Four column layout", "Set four column layout", "Use four column layout", "4 column layout"] },
  { command: "layout_columns_3", group: "views", phrase: "Set columns to 3" },
  { command: "layout_rows_3", group: "views", phrase: "Set rows to 3" },
  { command: "mobile_layout_switcher_on", group: "views", phrase: "Show layout switcher", aliases: ["Show mobile layout controls"] },
  { command: "mobile_layout_switcher_off", group: "views", phrase: "Hide layout switcher", aliases: ["Hide mobile layout controls"] },
  { command: "task_timers_on", group: "views", phrase: "Show task timers", aliases: ["Enable task timers", "Turn on task timers"] },
  { command: "task_timers_off", group: "views", phrase: "Hide task timers", aliases: ["Disable task timers", "Turn off task timers"] },

  { command: "theme_light", group: "tools", phrase: "Light mode", aliases: ["Light theme", "Enable light mode", "Use light mode", "Switch to light mode"] },
  { command: "theme_dark", group: "tools", phrase: "Dark mode", aliases: ["Dark theme", "Enable dark mode", "Use dark mode", "Switch to dark mode"] },
  { command: "ai_host_open", group: "tools", phrase: "Open AI host" },
  { command: "ai_host_close", group: "tools", phrase: "Close AI host" },
  { command: "bug_report_open", group: "tools", phrase: "Open bug report", aliases: ["Open report a problem"] },
  { command: "bug_report_close", group: "tools", phrase: "Close bug report", aliases: ["Close report a problem"] },
  { command: "host_profile_open", group: "tools", phrase: "Open host profile" },
  { command: "profile_close", group: "tools", phrase: "Close profile", aliases: ["Close host profile"] },
  { command: "timeline_open", group: "tools", phrase: "Open timeline", aliases: ["Open timeline editor"] },
  { command: "timeline_close", group: "tools", phrase: "Close timeline", aliases: ["Close timeline editor"] },
  { command: "timeline_save", group: "tools", phrase: "Save timeline", aliases: ["Save timeline editor"] },
  { command: "edit_name_open", group: "tools", phrase: "Edit my name", aliases: ["Open name editor", "Change my name"] },
  { command: "edit_name_close", group: "tools", phrase: "Cancel", aliases: ["Close name editor", "Close edit name", "Cancel name edit"] },
  { command: "edit_name_save", group: "tools", phrase: "Save", aliases: ["Save name", "Save my name", "Confirm name"] },
  { command: "modal_close", group: "tools", phrase: "Close", aliases: ["Close modal", "Close window", "Close popup", "Dismiss modal", "Click close"] },
  { command: "voice_restart", group: "tools", phrase: "Restart voice control", aliases: ["Restart voice", "Restart listener"] },
  { command: "color_correction_on", group: "tools", phrase: "Enable color correction", aliases: ["Color correction on", "Turn on color correction"] },
  { command: "color_correction_off", group: "tools", phrase: "Disable color correction", aliases: ["Color correction off", "Turn off color correction"] },
  { command: "color_correction_reset", group: "tools", phrase: "Reset color correction", aliases: ["Reset video colors"] },
  { command: "brightness_100", group: "tools", phrase: "Brightness 100" },
  { command: "contrast_100", group: "tools", phrase: "Contrast 100" },
  { command: "saturation_100", group: "tools", phrase: "Saturation 100" },
  { command: "echo_cancellation_on", group: "tools", phrase: "Enable echo cancellation", aliases: ["Echo cancellation on"] },
  { command: "echo_cancellation_off", group: "tools", phrase: "Disable echo cancellation", aliases: ["Echo cancellation off"] },
  { command: "noise_suppression_on", group: "tools", phrase: "Enable noise suppression", aliases: ["Noise suppression on"] },
  { command: "noise_suppression_off", group: "tools", phrase: "Disable noise suppression", aliases: ["Noise suppression off"] },
  { command: "auto_gain_on", group: "tools", phrase: "Enable auto gain", aliases: ["Auto gain on", "Enable automatic gain control"] },
  { command: "auto_gain_off", group: "tools", phrase: "Disable auto gain", aliases: ["Auto gain off", "Disable automatic gain control"] },
  { command: "join_sound_on", group: "tools", phrase: "Enable join sound", aliases: ["Join sound on"] },
  { command: "join_sound_off", group: "tools", phrase: "Disable join sound", aliases: ["Join sound off"] },
  { command: "leave_sound_on", group: "tools", phrase: "Enable leave sound", aliases: ["Leave sound on"] },
  { command: "leave_sound_off", group: "tools", phrase: "Disable leave sound", aliases: ["Leave sound off"] },
  { command: "stage_sounds_on", group: "tools", phrase: "Enable stage sounds", aliases: ["Stage sounds on"] },
  { command: "stage_sounds_off", group: "tools", phrase: "Disable stage sounds", aliases: ["Stage sounds off"] },
  { command: "stage_volume_50", group: "tools", phrase: "Stage volume 50" },
  { command: "participant_volume_100", group: "tools", phrase: "Participant volume 100" },
  { command: "audio_resume", group: "tools", phrase: "Enable room audio", aliases: ["Resume room audio", "Play room audio"] },
  { command: "mobile_media_restore", group: "tools", phrase: "Restore camera and microphone", aliases: ["Restore room media", "Reconnect camera and microphone"] },
  { command: "participant_pin_person", group: "tools", phrase: "Pin [name]" },
  { command: "participant_report_person", group: "tools", phrase: "Report [name]" },
  { command: "participant_manage_person", group: "tools", phrase: "Manage [name]", aliases: ["Mute [name]", "Kick [name]"] },
  { command: "click_control_example", group: "tools", phrase: "Click [button label]" },
  { command: "leave_room", group: "tools", phrase: "Leave room", aliases: ["Exit room", "Leave session"] },

  { command: "reaction_fire", group: "reactions", phrase: "Fire", aliases: ["Fire reaction", "Send fire", "React with fire", "That's fire", "This is fire", "Hot", "Amazing", "Awesome", "Incredible", "Fantastic", "Impressive"], hint: "Fire / That's fire / Hot" },
  { command: "reaction_laugh", group: "reactions", phrase: "Laugh", aliases: ["Laughter", "Laugh reaction", "Send laugh", "React with laugh", "Funny", "That's funny", "So funny", "LOL", "Ha ha", "Hilarious", "That is hilarious", "So hilarious"], hint: "Laugh / Funny / LOL" },
  { command: "reaction_thumbs_up", group: "reactions", phrase: "Thumbs up", aliases: ["Thumbs up reaction", "Send thumbs up", "React with thumbs up", "Like", "Nice", "Great", "Well done", "Good job", "Approve", "Approved", "Excellent", "Nice work", "Great work"], hint: "Thumbs up / Nice / Good job" },
  { command: "reaction_thumbs_down", group: "reactions", phrase: "Thumbs down", aliases: ["Thumbs down reaction", "Dislike"], hint: "Thumbs down / Dislike" },
  { command: "reaction_heart", group: "reactions", phrase: "Heart", aliases: ["Love", "Heart reaction", "Send heart", "React with heart", "Love it", "I love it", "Much love", "Send love", "Lovely", "Sending love", "Love this"], hint: "Heart / Love / Love it" },
  { command: "reaction_clap", group: "reactions", phrase: "Clap", aliases: ["Applause", "Clap reaction", "Send clap", "React with clap", "Bravo", "Well played", "Give applause", "Round of applause", "Clapping", "Big applause", "Take a bow"], hint: "Clap / Applause / Bravo" },
  { command: "reaction_ok", group: "reactions", phrase: "OK", aliases: ["Okay", "OK reaction", "Send OK", "React with OK", "Sounds good", "All good", "Got it", "Deal", "Perfect", "Understood", "Works for me", "Sure"], hint: "OK / Sounds good / Got it" },
  { command: "reaction_wave", group: "reactions", phrase: "Wave", aliases: ["Wave reaction", "Send wave", "React with wave", "Hello", "Hi everyone", "Hey everyone", "Bye", "Goodbye", "See you", "Greetings", "See ya", "Hello there"], hint: "Wave / Hello / Goodbye" },
  { command: "reaction_celebrate", group: "reactions", phrase: "Celebrate", aliases: ["Celebration", "Celebrate reaction", "Send celebrate", "React with celebrate", "Congrats", "Congratulations", "Hooray", "We did it", "Party", "Victory", "Cheers", "Woohoo", "We made it"], hint: "Celebrate / Congrats / Hooray" },
  { command: "reaction_clover", group: "reactions", phrase: "Clover", aliases: ["Luck", "Good luck", "Best of luck", "Lucky", "Send luck", "Wish me luck", "Wishing you luck", "Clover reaction", "Send clover", "React with clover", "Four leaf clover", "Four-leaf clover", "Fingers crossed", "Sending luck", "Wish you luck", "All the best", "You got this", "Good lock", "Good look", "God luck", "Gud luck", "Best of lock"], hint: "Clover / Luck / Good luck" },
];

const VOICE_UI_COMMAND_GROUPS: readonly {
  id: VoiceUiCommandGroupId;
  title: string;
}[] = [
  { id: "media", title: "Camera, microphone & sharing" },
  { id: "status", title: "My status" },
  { id: "panels", title: "Room panels" },
  { id: "views", title: "Views & layout" },
  { id: "tools", title: "Tools & appearance" },
  { id: "reactions", title: "Reactions" },
];

const VOICE_UI_COMMAND_LOOKUP = new Map<string, VoiceUiCommand>();
for (const definition of VOICE_UI_COMMAND_DEFINITIONS) {
  for (const phrase of [definition.phrase, ...(definition.aliases || [])]) {
    for (const variant of getVoiceUiPhraseVariants(phrase)) {
      VOICE_UI_COMMAND_LOOKUP.set(variant, definition.command);
    }
  }
}

const VOICE_UI_AMBIGUOUS_INTERIM_PHRASES = new Set<string>();
for (const [longerPhrase, longerCommand] of VOICE_UI_COMMAND_LOOKUP) {
  const words = longerPhrase.split(" ");
  for (let wordCount = 1; wordCount < words.length; wordCount += 1) {
    const prefix = words.slice(0, wordCount).join(" ");
    const prefixCommand = VOICE_UI_COMMAND_LOOKUP.get(prefix);
    if (prefixCommand && prefixCommand !== longerCommand) {
      VOICE_UI_AMBIGUOUS_INTERIM_PHRASES.add(prefix);
    }
  }
}

function parseVoiceUiCommand(raw: string): VoiceUiCommand | null {
  const normalized = normalizeVoiceUiTranscript(raw);
  if (!normalized) return null;
  // Room controls intentionally accept English commands only.
  if (/[^\x00-\x7F]/.test(normalized)) return null;
  const rawCommandText = String(raw || "")
    .trim()
    .replace(
      /^(?:(?:please|hey mysession|hey my session|mysession|my session|can you|could you|would you|will you|i want you to|let s|go ahead and)\s+)+/i,
      "",
    )
    .trim();
  const textCommands: Array<[RegExp, string]> = [
    [/^(?:type|dictate|enter|input|write down)\s+(.+)$/i, "dictate_"],
    [/^(?:add|create|make|new)\s+(?:a\s+)?task\s+(.+)$/i, "task_text_"],
    [/^(?:send|post)\s+(?:a\s+)?message\s+(.+)$/i, "message_send_text_"],
    [/^(?:write|compose|type|draft)\s+(?:a\s+)?message\s+(.+)$/i, "message_text_"],
  ];
  for (const [pattern, prefix] of textCommands) {
    const match = rawCommandText.match(pattern);
    const payload = String(match?.[1] || "").trim();
    if (payload) return `${prefix}${encodeURIComponent(payload)}` as VoiceUiCommand;
  }
  const clickControlMatch = rawCommandText.match(
    /^(?:click|press|tap|activate|select|choose)\s+(.+)$/i,
  );
  const clickControlLabel = String(clickControlMatch?.[1] || "").trim();
  if (clickControlLabel) {
    if (/^(?:close|close button|x|cross)$/i.test(clickControlLabel)) {
      return "modal_close";
    }
    return `click_control_${encodeURIComponent(clickControlLabel)}` as VoiceUiCommand;
  }
  const namedBlurStrengths: Record<string, number> = {
    "soft blur": 8,
    "medium blur": 16,
    "strong blur": 26,
  };
  if (namedBlurStrengths[normalized]) {
    return `blur_strength_${namedBlurStrengths[normalized]}`;
  }
  const blurStrengthMatch = normalized.match(/^(?:set )?blur(?: strength)?(?: to)? (.+)$/);
  if (blurStrengthMatch) {
    const requested = parseVoiceUiSpokenNumber(blurStrengthMatch[1]);
    if (requested == null) return null;
    const strength = Math.max(4, Math.min(30, requested));
    return `blur_strength_${strength}`;
  }
  const numericCommands: Array<[RegExp, string, number, number]> = [
    [/^(?:set )?(?:layout )?columns?(?: to)? (.+)$/, "layout_columns_", 1, 6],
    [/^(?:set )?(?:layout )?rows?(?: to)? (.+)$/, "layout_rows_", 1, 6],
    [/^(?:set )?brightness(?: to)? (.+)$/, "brightness_", 50, 150],
    [/^(?:set )?contrast(?: to)? (.+)$/, "contrast_", 50, 150],
    [/^(?:set )?saturation(?: to)? (.+)$/, "saturation_", 0, 200],
    [/^(?:set )?(?:stage|timeline|sound) volume(?: to)? (.+)$/, "stage_volume_", 0, 100],
    [/^(?:set )?(?:participant|room|people) volume(?: to)? (.+)$/, "participant_volume_", 0, 300],
  ];
  for (const [pattern, prefix, min, max] of numericCommands) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const requested = parseVoiceUiSpokenNumber(match[1]);
    if (requested == null) continue;
    const value = Math.max(min, Math.min(max, requested));
    return `${prefix}${value}` as VoiceUiCommand;
  }
  const participantCommands: Array<[RegExp, string]> = [
    [/^pin (.+)$/, "participant_pin_"],
    [/^unpin (.+)$/, "participant_unpin_"],
    [/^report (.+)$/, "participant_report_"],
    [/^(?:manage|mute|turn off camera for|kick|make moderator|remove moderator from) (.+)$/, "participant_manage_"],
  ];
  for (const [pattern, prefix] of participantCommands) {
    const match = normalized.match(pattern);
    if (match?.[1]) return `${prefix}${encodeURIComponent(match[1])}` as VoiceUiCommand;
  }
  return VOICE_UI_COMMAND_LOOKUP.get(normalized) || null;
}

// Versioned opt-in key: the previous setting defaulted to true and therefore
// wrote "true" for users who never explicitly enabled voice control.
const VOICE_UI_ENABLED_STORAGE_KEY = "room_voice_ui_enabled_opt_in_v2";
const VOICE_UI_MODE_STORAGE_KEY = "room_voice_ui_mode_v1";
const VOICE_UI_HOTKEY_STORAGE_KEY = "room_voice_ui_hotkey_v1";
type VoiceUiMode = "off" | "always" | "hotkey";

function voiceUiHotkeyFromEvent(event: KeyboardEvent, usePhysicalKey = true): string {
  const physicalKey = /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(3)
    : /^Digit[0-9]$/.test(event.code)
      ? event.code.slice(5)
      : "";
  const logicalKey = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const key = usePhysicalKey && physicalKey ? physicalKey : logicalKey;
  if (["Control", "Alt", "Shift", "Meta"].includes(key)) return "";
  return [event.ctrlKey ? "Ctrl" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : "", event.metaKey ? "Meta" : "", key === " " ? "Space" : key]
    .filter(Boolean)
    .join("+");
}

function matchesVoiceUiHotkey(event: KeyboardEvent, hotkey: string): boolean {
  const expected = String(hotkey || "").toLowerCase();
  return voiceUiHotkeyFromEvent(event, true).toLowerCase() === expected
    || voiceUiHotkeyFromEvent(event, false).toLowerCase() === expected;
}

type HostProfile = {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  bio?: string | null;
};

type InfiniteRoomHostLease = {
  session_id: string;
  user_id: string;
  claimed_at: string;
  heartbeat_at: string;
  expires_at: string;
  active_host_profile?: HostProfile | null;
};

type SessionTemplate = {
  name?: string | null;
  title?: string | null;
  key?: string | null;
  slug?: string | null;
  type?: string | null;
  format?: string | null;
  session_format_type?: string | null;
};

type SessionRow = {
  id: string;
  title: string;
  description?: string | null;
  schedule: unknown;
  format?: string | null;
  session_format_type?: string | null;
  start_time?: string | null;
  created_at?: string | null;
  duration_minutes?: number | null;
  ai_hosted?: boolean | null;
  host_profile?: HostProfile | null;
  session_templates?: SessionTemplate | SessionTemplate[] | null;
  session_bookings?: Array<{
    user_id: string;
    session_id?: string;
  }> | null;
  max_participants?: number | null;
  host_id?: string | null;
  camera_required?: boolean | null;
  public_chat_disabled?: boolean | null;
};

type Stage = {
  name: string;
  duration: number;
  color: string;
  type: "intro" | "intentions" | "focus" | "break" | "outro" | string;
  durationSeconds?: number;
};

type MediaDevicesResult = {
  videoInputs: MediaDeviceInfo[];
  audioInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
};

type PreJoinSettings = {
  displayName: string;
  audioInputId: string;
  videoInputId: string;
  audioOutputId: string;

  audioEnabled: boolean;
  videoEnabled: boolean;

  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
};

type ClosedSessionRecommendation = JoinGateHostSession & {
  hostName: string;
  hostAvatarUrl: string | null;
  sameHost: boolean;
  isBooked: boolean;
};

type AudioProcessingPreferences = Pick<
  PreJoinSettings,
  "echoCancellation" | "noiseSuppression" | "autoGainControl"
>;

type TileModel = {
  id: string;
  kind?: "camera" | "screen";
  label: string;
  metadataDisplayName?: string;
  status?: string | null;
  isLocal: boolean;

  videoTrack?: Track;
  audioTrack?: LocalAudioTrack | RemoteAudioTrack;
  audioLevel?: number;
  isSpeaking?: boolean;

  participantIdentity?: string;
  participantUserId?: string;

  micTrackSid?: string;
  camTrackSid?: string;

  micMuted?: boolean;

  camPubExists?: boolean;
  camPubMuted?: boolean;
  camPubHasTrack?: boolean;

  remoteMicPubSid?: string;
};

function areTileListsEqual(prev: TileModel[], next: TileModel[]) {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;

  return prev.every((a, index) => {
    const b = next[index];
    return (
      a.id === b.id &&
      a.kind === b.kind &&
      a.label === b.label &&
      a.metadataDisplayName === b.metadataDisplayName &&
      a.status === b.status &&
      a.isLocal === b.isLocal &&
      a.videoTrack === b.videoTrack &&
      a.audioTrack === b.audioTrack &&
      a.audioLevel === b.audioLevel &&
      a.isSpeaking === b.isSpeaking &&
      a.participantIdentity === b.participantIdentity &&
      a.participantUserId === b.participantUserId &&
      a.micTrackSid === b.micTrackSid &&
      a.camTrackSid === b.camTrackSid &&
      a.micMuted === b.micMuted &&
      a.camPubExists === b.camPubExists &&
      a.camPubMuted === b.camPubMuted &&
      a.camPubHasTrack === b.camPubHasTrack &&
      a.remoteMicPubSid === b.remoteMicPubSid
    );
  });
}

type SessionRole = "moderator";
type SessionRoleAssignmentRow = {
  id?: string;
  session_id: string;
  user_id: string;
  role: SessionRole;
  granted_by?: string | null;
  created_at?: string;
};

type RightPanelTab = "participants" | "chat" | "tasks" | "music" | null;
type PiPMode = "gallery" | "chat";
type RoomMainViewMode = "video" | "accountability";

type FloatingReaction = {
  id: number;
  type: ReactionType;
  fromUserId: string;
  fromName: string;
};

type RoomSystemNotice = {
  open: boolean;
  kind: "info" | "error" | "kick";
  presentation?: "camera-reminder";
  title: string;
  body: string;
  actionLabel?: string;
  action?: () => void;
};

type RoomSoundtrackState = {
  trackId: RoomSoundscapeId;
  trackUrl?: string;
  trackLabel?: string;
  duration?: number;
  volume?: number;
  playing: boolean;
  position: number;
  updatedAt: number;
};

type RoomSoundtrackPacket =
  | { type: "soundtrack_state"; state: RoomSoundtrackState }
  | { type: "soundtrack_request"; requestedAt: number };

type SoundscapeListeningMode = "room" | "personal";

type KickBroadcastPayload = {
  type?: "participant_kicked";
  targetIdentity?: string | null;
  targetUserId?: string | null;
  kickedByUserId?: string | null;
  kickedByName?: string | null;
  roomName?: string | null;
  sessionId?: string | null;
  at?: number;
};

type ColorCorrectionState = {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
};

const DEFAULT_COLOR_CORRECTION: ColorCorrectionState = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  warmth: 0,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function safeRoomName(raw: string) {
  const base = (raw || "").toLowerCase();
  const cleaned = base.replace(/[^a-z0-9-_]/g, "");
  return cleaned || "room";
}
function safeIdentity(raw: string) {
  return (raw || "guest").toLowerCase().replace(/[^a-z0-9-_]/g, "") || "guest";
}
function normalizeTemplates(
  t: SessionTemplate | SessionTemplate[] | null | undefined,
): SessionTemplate[] {
  if (!t) return [];
  return Array.isArray(t) ? t : [t];
}
function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function safeParseJson(raw: unknown): unknown | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s || s === "undefined" || s === "null") return null;
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return null;
    }
  }
  return raw;
}
function parse50505(
  raw: unknown,
): { focus: number; break: number; intentions: number } | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  const m1 = s.match(/^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)$/);
  const m2 = s.match(/^(\d+)\s*-\s*(\d+)\s*-\s*(\d+)$/);
  const m = m1 || m2;
  if (!m) return null;

  const focus = Number(m[1]);
  const br = Number(m[2]);
  const intentions = Number(m[3]);

  if (
    !Number.isFinite(focus) ||
    !Number.isFinite(br) ||
    !Number.isFinite(intentions)
  )
    return null;
  if (focus <= 0 || br <= 0 || intentions <= 0) return null;

  return { focus, break: br, intentions };
}
function normalizeKey(v: unknown): string {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
function inferStageTypeFromLabel(raw: string): Stage["type"] {
  const k = normalizeKey(raw);

  if (!k) return "focus";
  if (k.includes("welcome") || k.includes("intro")) return "intro";
  if (
    k.includes("outro") ||
    k.includes("farewell") ||
    k.includes("celebrat") ||
    k.includes("finish") ||
    k.includes("end")
  )
    return "outro";
  if (
    k.includes("checkin") ||
    k.includes("intention") ||
    k.includes("checkinspoken")
  )
    return "intentions";
  if (k.includes("break") || k.includes("rest") || k.includes("pause"))
    return "break";
  if (
    k.includes("focus") ||
    k.includes("work") ||
    k.includes("deepwork") ||
    k.includes("pomodoro")
  )
    return "focus";
  return "focus";
}
function isCheckInLikeLabel(raw: string): boolean {
  const k = normalizeKey(raw);
  return k.includes("checkin");
}
function normalizeInfinitePhases(
  anyPhases: unknown,
): { name: string; seconds: number }[] {
  if (!anyPhases) return [];

  const toSeconds = (raw: unknown): number => {
    if (isRecord(raw)) {
      const explicitSeconds =
        num((raw as any).seconds) ||
        num((raw as any).duration_seconds) ||
        num((raw as any).durationSeconds);
      if (explicitSeconds > 0) return explicitSeconds;

      const explicitMinutes =
        num((raw as any).minutes) ||
        num((raw as any).mins) ||
        num((raw as any).duration_minutes) ||
        num((raw as any).durationMinutes);
      if (explicitMinutes > 0) return explicitMinutes * 60;

      const n = num((raw as any).duration ?? (raw as any).value ?? raw);
      if (!Number.isFinite(n) || n <= 0) return 0;

      if (n <= 180) return n * 60;
      return n;
    }

    const n = num(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (n <= 180) return n * 60;
    return n;
  };

  if (Array.isArray(anyPhases)) {
    return anyPhases
      .map((p) => {
        const name = isRecord(p)
          ? str((p as any).name || (p as any).key || (p as any).type)
          : "";
        const seconds = toSeconds(p);
        return { name, seconds };
      })
      .filter((x) => x.seconds > 0);
  }

  if (isRecord(anyPhases)) {
    return Object.entries(anyPhases)
      .map(([k, v]) => {
        const name = String(k || "");
        const seconds =
          typeof v === "number"
            ? v <= 180
              ? Number(v) * 60
              : Number(v)
            : toSeconds(v);
        return { name, seconds };
      })
      .filter((x) => x.seconds > 0);
  }

  return [];
}
function phaseToStageType(phaseName: string): Stage["type"] {
  const k = normalizeKey(phaseName);

  if (k.includes("welcome") || k.includes("intro")) return "intro";
  if (
    k.includes("outro") ||
    k.includes("farewell") ||
    k.includes("celebrat") ||
    k.includes("finish") ||
    k.includes("end")
  )
    return "outro";
  if (k.includes("checkin") || k.includes("intention")) return "intentions";
  if (k.includes("break") || k.includes("rest") || k.includes("pause"))
    return "break";
  if (
    k.includes("focus") ||
    k.includes("work") ||
    k.includes("deepwork") ||
    k.includes("pomodoro")
  )
    return "focus";
  return "focus";
}

const STAGE_COLORS: Record<string, string> = {
  intro: "#81DB86",
  intentions: "#ADD3FF",
  focus: "#5286F6",
  break: "#F65252",
  outro: "#81DB86",
};

function getTemplateFirst(
  tpl: SessionRow["session_templates"],
): SessionTemplate | null {
  if (!tpl) return null;
  return Array.isArray(tpl) ? (tpl[0] ?? null) : tpl;
}
function looksLikeUuid(v: string) {
  const s = String(v || "")
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    s,
  );
}
function uniqStrings(xs: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const k = String(x || "").toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}
function extractBaseUserIdFromIdentity(identity: string) {
  const s = String(identity || "")
    .trim()
    .toLowerCase();
  const m = s.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:--.*)?$/,
  );
  if (m && m[1]) return m[1];
  return s;
}
function getQueryInt(name: string, def = 0) {
  try {
    const u = new URL(window.location.href);
    const raw = u.searchParams.get(name);
    if (raw === null) return def;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.floor(n) : def;
  } catch {
    return def;
  }
}
function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function isFirefoxLike() {
  if (typeof navigator === "undefined") return false;
  return /firefox|fxios/i.test(String(navigator.userAgent || ""));
}

function isSafariLike() {
  if (typeof navigator === "undefined") return false;
  const ua = String(navigator.userAgent || "");
  return /safari/i.test(ua) && !/chrome|chromium|crios|android|edg/i.test(ua);
}

function normalizeFxBlurStrength(raw: number, firefoxSafe = false) {
  const n = Math.max(4, Math.min(30, Math.round(Number(raw || 12))));

  // Firefox дешевле и стабильнее, если не пересоздавать processor
  // на каждый 1px движения ползунка, но max 30 должен быть достижим.
  if (firefoxSafe) {
    if (n <= 4) return 4;
    if (n >= 30) return 30;
    return Math.max(4, Math.min(30, Math.round(n / 4) * 4));
  }

  if (n <= 4) return 4;
  if (n >= 30) return 30;
  return Math.max(4, Math.min(30, Math.round(n / 2) * 2));
}

function normalizeMediaWarningMessage(raw: unknown) {
  const s = String(raw || "").trim();
  if (!s) return "A device action failed.";

  const low = s.toLowerCase();

  if (
    low.includes("notreadableerror") ||
    low.includes("trackstarterror") ||
    low.includes("could not start video source") ||
    low.includes("device is in use") ||
    low.includes("device in use")
  ) {
    return "The physical camera is already in use or could not be shared by Chrome. MySession also tried the camera without resolution or frame-rate requirements.";
  }

  if (low.includes("permission denied") || low.includes("notallowederror")) {
    return "A camera or microphone permission step failed.";
  }

  return s;
}

function getMediaErrorDiagnostic(raw: unknown) {
  const error = raw as {
    name?: unknown;
    message?: unknown;
    constraint?: unknown;
  } | null;

  return {
    name: String(error?.name || ""),
    message: String(error?.message || raw || ""),
    constraint: String(error?.constraint || ""),
  };
}

function findLocalCameraPublication(localParticipant: any) {
  return Array.from(
    localParticipant?.videoTrackPublications?.values?.() || [],
  ).find(
    (publication: any) => publication?.source === Track.Source.Camera,
  ) as LocalTrackPublication | undefined;
}

function getCameraMediaTrackFromPublication(
  publication: LocalTrackPublication | undefined,
) {
  return getMediaStreamTrackFromLiveKitTrack(publication?.track);
}

async function waitForLocalCameraTrackLive(
  localParticipant: any,
  timeoutMs = 3200,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const publication = findLocalCameraPublication(localParticipant);
    const mediaTrack = getCameraMediaTrackFromPublication(publication);

    if (
      publication?.track &&
      !publication.isMuted &&
      mediaTrack?.readyState === "live"
    ) {
      return { publication, mediaTrack };
    }

    await delay(100);
  }

  return null;
}

function getPiPIconSrc(name: string, isLight: boolean) {
  const themeSuffix = isLight ? "light" : "dark";
  return `/icons/${name}-${themeSuffix}.svg`;
}

function PiPIcon({
  name,
  isLight,
  alt,
  className = "w-4 h-4",
}: {
  name: string;
  isLight: boolean;
  alt: string;
  className?: string;
}) {
  return (
    <img
      src={getPiPIconSrc(name, isLight)}
      alt={alt}
      className={className}
      draggable={false}
    />
  );
}

function canUseSetSinkId() {
  if (typeof window === "undefined") return false;
  try {
    const audio = document.createElement("audio") as HTMLAudioElement & {
      setSinkId?: (id: string) => Promise<void>;
    };
    return typeof audio.setSinkId === "function";
  } catch {
    return false;
  }
}

function supportsScreenShareCapture() {
  if (typeof navigator === "undefined") return false;
  return typeof (navigator.mediaDevices as any)?.getDisplayMedia === "function";
}

function getBrowserDetails() {
  if (typeof navigator === "undefined") {
    return { browser: "unknown", browserVersion: "", os: "unknown" };
  }

  const ua = String(navigator.userAgent || "");
  const uaLower = ua.toLowerCase();

  const matchVersion = (re: RegExp) => {
    const m = ua.match(re);
    return m?.[1] || "";
  };

  let browser = "unknown";
  let browserVersion = "";

  if (uaLower.includes("samsungbrowser")) {
    browser = "Samsung Internet";
    browserVersion = matchVersion(/SamsungBrowser\/([\d.]+)/i);
  } else if (
    uaLower.includes("edg/") ||
    uaLower.includes("edga/") ||
    uaLower.includes("edgios/")
  ) {
    browser = "Microsoft Edge";
    browserVersion =
      matchVersion(/EdgA?\/([\d.]+)/i) || matchVersion(/EdgiOS\/([\d.]+)/i);
  } else if (uaLower.includes("crios")) {
    browser = "Chrome iOS";
    browserVersion = matchVersion(/CriOS\/([\d.]+)/i);
  } else if (uaLower.includes("chrome") || uaLower.includes("chromium")) {
    browser = "Chrome";
    browserVersion = matchVersion(/(?:Chrome|Chromium)\/([\d.]+)/i);
  } else if (uaLower.includes("firefox") || uaLower.includes("fxios")) {
    browser = "Firefox";
    browserVersion = matchVersion(/(?:Firefox|FxiOS)\/([\d.]+)/i);
  } else if (uaLower.includes("safari")) {
    browser = "Safari";
    browserVersion = matchVersion(/Version\/([\d.]+)/i);
  }

  let os = "unknown";
  if (/ipad|iphone|ipod/i.test(ua)) os = "iOS/iPadOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/cros/i.test(ua)) os = "ChromeOS";
  else if (/windows/i.test(ua)) os = "Windows";
  else if (/mac os x|macintosh/i.test(ua)) os = "macOS";
  else if (/linux/i.test(ua)) os = "Linux";

  return { browser, browserVersion, os };
}

function inferDeviceTypeFromRuntime(args: {
  isMobileQuery?: boolean;
  isTabletQuery?: boolean;
}) {
  if (args.isMobileQuery) return "mobile";
  if (args.isTabletQuery) return "tablet";

  if (typeof navigator === "undefined" || typeof window === "undefined")
    return "unknown";

  const ua = String(navigator.userAgent || "").toLowerCase();
  const platform = String(
    (navigator as any).userAgentData?.platform || navigator.platform || "",
  ).toLowerCase();
  const isWindowsRuntime = /windows/i.test(ua) || platform.includes("win");
  const maxTouchPoints = Number((navigator as any).maxTouchPoints || 0);
  const minSide = Math.min(
    window.screen?.width || window.innerWidth || 0,
    window.screen?.height || window.innerHeight || 0,
  );
  const maxSide = Math.max(
    window.screen?.width || window.innerWidth || 0,
    window.screen?.height || window.innerHeight || 0,
  );

  if (/ipad|tablet|playbook|silk/i.test(ua)) return "tablet";
  if (/android/i.test(ua) && !/mobile/i.test(ua)) return "tablet";
  if (platform.includes("mac") && maxTouchPoints > 1 && minSide >= 700)
    return "tablet";
  if (/mobi|iphone|ipod|android.*mobile/i.test(ua)) return "mobile";
  // Touch-enabled Windows laptops report multiple touch points and large screen
  // dimensions too. They still need the desktop side-panel layout; otherwise
  // chat/tasks/music incorrectly cover the entire room like on a tablet.
  if (
    !isWindowsRuntime &&
    maxTouchPoints > 1 &&
    minSide >= 700 &&
    maxSide >= 900
  )
    return "tablet";

  return "desktop";
}

function getScreenShareDiagnosticSnapshot(room: Room | null) {
  try {
    const lp: any = room?.localParticipant;
    const localPubs: any[] = Array.from(
      (lp?.trackPublications as any)?.values?.() || [],
    );
    const remoteParticipants: any[] = Array.from(
      (room as any)?.remoteParticipants?.values?.() || [],
    );

    const localScreenPubs = localPubs.filter((pub) =>
      isScreenShareVideoPublication(pub),
    );

    let remoteScreenPublicationCount = 0;
    let remoteScreenSubscribedCount = 0;
    let remoteScreenLiveTrackCount = 0;

    remoteParticipants.forEach((participant) => {
      const pubs: any[] = Array.from(
        participant?.trackPublications?.values?.() || [],
      );
      pubs.forEach((pub) => {
        if (!isScreenShareVideoPublication(pub)) return;
        remoteScreenPublicationCount += 1;
        if (pub.isSubscribed) remoteScreenSubscribedCount += 1;
        if (isLiveScreenShareTrack(pub.track)) remoteScreenLiveTrackCount += 1;
      });
    });

    return {
      localScreenPublicationCount: localScreenPubs.length,
      localScreenLiveTrackCount: localScreenPubs.filter((pub) =>
        isLiveScreenShareTrack(pub.track),
      ).length,
      localScreenTrackReadyStates: localScreenPubs.map((pub) => {
        const track: any = pub?.track;
        const mediaTrack = track?.mediaStreamTrack || track?.mediaTrack || null;
        return {
          sid: String(pub?.trackSid || pub?.sid || track?.sid || ""),
          source: String(pub?.source || ""),
          kind: String(pub?.kind || track?.kind || ""),
          muted: !!pub?.isMuted,
          subscribed: !!pub?.isSubscribed,
          hasTrack: !!track,
          hasMediaTrack: !!mediaTrack,
          readyState: String(mediaTrack?.readyState || ""),
        };
      }),
      remoteScreenPublicationCount,
      remoteScreenSubscribedCount,
      remoteScreenLiveTrackCount,
    };
  } catch (e: any) {
    return {
      diagnosticsError: String(
        e?.message || e || "screen_share_snapshot_failed",
      ),
    };
  }
}

function getPublicationSourceName(pub: any) {
  return String(pub?.source || "").toLowerCase();
}

function isScreenShareVideoPublication(pub: any) {
  const source = getPublicationSourceName(pub);
  const kind = String(pub?.kind || pub?.track?.kind || "").toLowerCase();

  return (
    (source === String(Track.Source.ScreenShare).toLowerCase() ||
      source.includes("screen") ||
      source.includes("display")) &&
    (kind === "video" ||
      kind === String(Track.Kind.Video).toLowerCase() ||
      !kind)
  );
}

function isLiveScreenShareTrack(track: any) {
  if (!track) return false;

  const mediaTrack = track.mediaStreamTrack || track.mediaTrack || null;
  if (mediaTrack && mediaTrack.readyState && mediaTrack.readyState !== "live")
    return false;

  // Some browsers/tablets briefly publish a screen-share publication before the
  // actual MediaStreamTrack is attached. That phantom publication used to create
  // an empty "video tile" with no visible screen.
  if (!mediaTrack && !track.attachedElements?.length && !track.sid)
    return false;

  return true;
}

function getMediaStreamTrackFromLiveKitTrack(
  track: any,
): MediaStreamTrack | null {
  return (track?.mediaStreamTrack ||
    track?.mediaTrack ||
    null) as MediaStreamTrack | null;
}

async function waitForMediaTrackRenderableFrame(
  mediaTrack: MediaStreamTrack | null,
  timeoutMs = 2400,
) {
  if (!mediaTrack || mediaTrack.readyState !== "live") return false;
  if (typeof document === "undefined") return true;

  const startedAt = Date.now();
  const video = document.createElement("video");

  try {
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.style.position = "fixed";
    video.style.left = "-9999px";
    video.style.top = "-9999px";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.srcObject = new MediaStream([mediaTrack]);
    document.body.appendChild(video);

    try {
      await video.play();
    } catch {
      // Some tablet browsers only allow play after metadata. Continue polling.
    }

    while (Date.now() - startedAt < timeoutMs) {
      if (mediaTrack.readyState !== "live") return false;
      if (video.videoWidth > 0 && video.videoHeight > 0) return true;
      await delay(120);
    }

    return video.videoWidth > 0 && video.videoHeight > 0;
  } catch {
    return false;
  } finally {
    try {
      video.pause();
      video.srcObject = null;
      video.remove();
    } catch {
      // ignore cleanup failure
    }
  }
}

function getFirstLocalScreenShareMediaTrack(
  room: Room | null,
): MediaStreamTrack | null {
  try {
    const lp: any = room?.localParticipant;
    const pubs: any[] = Array.from(
      (lp?.trackPublications as any)?.values?.() || [],
    );
    const pub = pubs.find(
      (p) =>
        isScreenShareVideoPublication(p) && isLiveScreenShareTrack(p.track),
    );
    return getMediaStreamTrackFromLiveKitTrack(pub?.track);
  } catch {
    return null;
  }
}

async function waitForLocalRenderableScreenShareTrack(
  room: Room | null,
  timeoutMs = 3600,
) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (!hasLocalLiveScreenShare(room)) {
      await delay(120);
      continue;
    }

    const mediaTrack = getFirstLocalScreenShareMediaTrack(room);
    if (!mediaTrack) {
      await delay(120);
      continue;
    }

    const remaining = Math.max(250, timeoutMs - (Date.now() - started));
    const hasFrame = await waitForMediaTrackRenderableFrame(
      mediaTrack,
      Math.min(remaining, 1200),
    );
    if (hasFrame) return true;

    await delay(120);
  }

  return false;
}

function shouldPreferManualTabletScreenShare(args: {
  isMobileQuery?: boolean;
  isTabletQuery?: boolean;
}) {
  const deviceType = inferDeviceTypeFromRuntime(args);
  if (deviceType !== "tablet") return false;

  if (typeof navigator === "undefined") return true;
  const ua = String(navigator.userAgent || "").toLowerCase();

  // Android/Samsung tablets are the main problem case: LiveKit's convenience
  // toggle can create a screen-share publication before the real display track
  // is renderable, which leaves an empty second tile. Manual capture lets us
  // validate the MediaStreamTrack before publishing it into the room.
  return (
    ua.includes("android") ||
    ua.includes("samsungbrowser") ||
    args.isTabletQuery
  );
}

async function captureDisplayMediaForTablet() {
  if (!supportsScreenShareCapture()) {
    throw new Error("screen_share_not_supported");
  }

  const stream = await (navigator.mediaDevices as any).getDisplayMedia({
    audio: false,
    video: {
      frameRate: { ideal: 15, max: 20 },
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 },
    },
  });

  const mediaTrack = stream?.getVideoTracks?.()[0] as
    | MediaStreamTrack
    | undefined;
  if (!mediaTrack) {
    try {
      stream?.getTracks?.().forEach((track: MediaStreamTrack) => track.stop());
    } catch {
      // ignore cleanup failure
    }
    throw new Error("display_media_returned_no_video_track");
  }

  return { stream, mediaTrack };
}

function filterRenderableScreenShareTiles(tiles: TileModel[]) {
  return (tiles || []).filter((tile) => {
    if (tile.kind !== "screen") return true;
    return isLiveScreenShareTrack((tile as any).videoTrack);
  });
}

function hasLocalLiveScreenShare(room: Room | null) {
  const lp: any = room?.localParticipant;
  if (!lp) return false;

  const pubs: any[] = Array.from(
    (lp.trackPublications as any)?.values?.() || [],
  );
  return pubs.some(
    (pub) =>
      isScreenShareVideoPublication(pub) && isLiveScreenShareTrack(pub.track),
  );
}

function requestRemoteScreenShareSubscriptions(room: Room | null) {
  try {
    const participants = Array.from(
      (room as any)?.remoteParticipants?.values?.() || [],
    );

    participants.forEach((participant: any) => {
      const pubs: any[] = Array.from(
        participant?.trackPublications?.values?.() || [],
      );

      pubs.forEach((pub) => {
        if (!isScreenShareVideoPublication(pub)) return;

        // Tablet/Chrome/Safari can publish the screen-share publication first and
        // attach the real track a moment later. Explicitly requesting subscription
        // prevents our UI from getting stuck with an empty screen tile.
        if (typeof pub.setSubscribed === "function" && !pub.isSubscribed) {
          void pub.setSubscribed(true).catch(() => { });
        }
      });
    });
  } catch {
    // best effort only
  }
}

async function waitForLocalScreenShareTrack(
  room: Room | null,
  timeoutMs = 2600,
) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (hasLocalLiveScreenShare(room)) return true;
    await delay(120);
  }

  return hasLocalLiveScreenShare(room);
}

function getScreenShareErrorMessage(error: any) {
  const name = String(error?.name || "").toLowerCase();
  const message = String(error?.message || error || "").trim();

  if (
    name.includes("notallowed") ||
    name.includes("abort") ||
    message.toLowerCase().includes("permission")
  ) {
    return "Screen sharing was cancelled or blocked by the browser.";
  }

  if (name.includes("notfound") || name.includes("notreadable")) {
    return "Screen sharing could not start from this device or browser.";
  }

  return message || "Screen sharing could not start.";
}

function pickExistingDeviceId(
  wantedId: string,
  list: MediaDeviceInfo[],
  fallback = "",
) {
  const wanted = String(wantedId || "").trim();
  if (wanted && list.some((d) => d.deviceId === wanted)) return wanted;
  if (fallback && list.some((d) => d.deviceId === fallback)) return fallback;
  return list[0]?.deviceId || "";
}

type DeviceTier = "weak" | "normal" | "strong";

function detectDeviceTier(args: {
  isMobile: boolean;
  isTablet: boolean;
}): DeviceTier {
  if (typeof window === "undefined") return "normal";

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    hardwareConcurrency?: number;
  };

  const mem = Number(nav.deviceMemory || 0);
  const cores = Number(nav.hardwareConcurrency || 0);

  if (args.isMobile) return "weak";
  if (args.isTablet && (mem <= 4 || cores <= 4)) return "weak";
  if ((mem > 0 && mem <= 4) || (cores > 0 && cores <= 4)) return "weak";
  if (mem >= 8 && cores >= 8 && !args.isMobile) return "strong";

  return "normal";
}

function getCapturePresetForTier(tier: DeviceTier) {
  if (tier === "weak") {
    return {
      width: 320,
      height: 180,
      fps: 10,
    };
  }

  if (tier === "strong") {
    return {
      width: 960,
      height: 540,
      fps: 24,
    };
  }

  return {
    width: 640,
    height: 360,
    fps: 15,
  };
}

function isChromeOSLike() {
  if (typeof navigator === "undefined") return false;

  const nav = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };

  const ua = String(nav.userAgent || "").toLowerCase();
  const platform = String(
    nav.userAgentData?.platform || nav.platform || "",
  ).toLowerCase();

  return (
    ua.includes("cros") ||
    ua.includes("chromebook") ||
    platform.includes("cros") ||
    platform.includes("chrome os")
  );
}

function isMobileOrTabletDeviceLike() {
  if (typeof navigator === "undefined") return false;

  const nav = navigator as Navigator & {
    userAgentData?: {
      mobile?: boolean;
      platform?: string;
    };
  };
  const ua = String(nav.userAgent || "").toLowerCase();
  const platform = String(
    nav.userAgentData?.platform || nav.platform || "",
  ).toLowerCase();
  const maxTouchPoints = Number(nav.maxTouchPoints || 0);

  // iPadOS can identify itself as macOS when "Request Desktop Website" is on.
  // Android tablets can likewise expose a desktop-sized viewport, so device
  // recovery must never depend on CSS width alone.
  const isDesktopModeIPad =
    platform.includes("mac") && maxTouchPoints > 1;
  const hasMobileUa =
    /android|iphone|ipad|ipod|mobile|tablet|silk|kindle|playbook/.test(ua);

  return !!nav.userAgentData?.mobile || isDesktopModeIPad || hasMobileUa;
}

function getInitials(name: string) {
  const s = String(name || "").trim();
  if (!s) return "U";
  const parts = s.split(/\s+/).filter(Boolean).slice(0, 2);
  const out = parts.map((p) => p[0]?.toUpperCase()).join("");
  return out || "U";
}

function getParticipantVolumeKey(
  tile: Pick<TileModel, "id" | "participantUserId" | "participantIdentity">,
) {
  const userId = String(tile.participantUserId || "").toLowerCase();
  if (userId && looksLikeUuid(userId)) return `user:${userId}`;

  const identity = String(tile.participantIdentity || "")
    .trim()
    .toLowerCase();
  if (identity) return `identity:${identity}`;

  return `tile:${String(tile.id || "")}`;
}

// realtime cleanup safe
function safeRemoveRealtimeChannel(ch: any) {
  if (!ch) return;

  try {
    if (typeof ch.unsubscribe === "function") {
      void ch.unsubscribe();
      return;
    }
  } catch { }

  const sb: any = supabase as any;

  try {
    if (typeof sb.removeChannel === "function") {
      void sb.removeChannel(ch);
      return;
    }
  } catch { }

  try {
    if (typeof sb.removeSubscription === "function") {
      void sb.removeSubscription(ch);
      return;
    }
  } catch { }

  try {
    if (sb.realtime && typeof sb.realtime.removeChannel === "function") {
      void sb.realtime.removeChannel(ch);
      return;
    }
  } catch { }
}

// avatars
const AVATARS_BUCKET = "avatars";
function isProbablyUrl(s: string) {
  return /^https?:\/\//i.test(String(s || "").trim());
}
function normalizeAvatarCandidate(raw: any): string {
  const s = String(raw || "").trim();
  if (!s || s === "null" || s === "undefined") return "";
  return s;
}
async function resolveAvatarUrlFromProfilesField(
  avatarUrlOrPath: string,
): Promise<string> {
  const v = normalizeAvatarCandidate(avatarUrlOrPath);
  if (!v) return "";
  if (isProbablyUrl(v)) return v;

  try {
    const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(v);
    const u = String((data as any)?.publicUrl || "").trim();
    if (u) return u;
  } catch { }

  return "";
}

// reports / kick events / sounds
const KICK_EVENTS_CHANNEL_PREFIX = "mysession_lk_kick_events";

const ROOM_SOUNDS_PREF_KEY = "mysession_lk_room_sounds";
const JOIN_SOUND_PREF_KEY = "mysession_lk_join_sound";
const LEAVE_SOUND_PREF_KEY = "mysession_lk_leave_sound";
const STAGE_SOUNDS_PREF_KEY = "mysession_lk_stage_sounds";
const ROOM_SOUNDS_VOLUME_PREF_KEY = "mysession_lk_room_sounds_volume";
const BACKGROUND_SOUNDSCAPE_PREF_KEY = "mysession_lk_background_soundscape";
const BACKGROUND_SOUNDSCAPE_VOLUME_PREF_KEY =
  "mysession_lk_background_soundscape_volume";
const BACKGROUND_SOUNDSCAPE_MUTED_PREF_KEY =
  "mysession_lk_background_soundscape_muted";
const ROOM_SOUNDTRACK_TOPIC = "mysession_room_soundtrack_v1";
const PREVIEW_MIRROR_PREF_KEY = "mysession_lk_preview_mirror";
const CAMERA_FRAMING_PREF_KEY = "mysession_lk_camera_framing_v1";
const AUDIO_PROCESSING_PREF_KEY = "mysession_lk_audio_processing_v1";
const DEFAULT_AUDIO_PROCESSING: AudioProcessingPreferences = {
  echoCancellation: true,
  noiseSuppression: false,
  autoGainControl: false,
};
const JOIN_SOUND_CANDIDATES = [
  "/sounds/jitsi/joined.mp3",
  "/sounds/joined.mp3",
  "/sounds/user_joined.mp3",
];
const LEAVE_SOUND_CANDIDATES = [
  "/sounds/jitsi/left.mp3",
  "/sounds/left.mp3",
  "/sounds/user_left.mp3",
];

function readAudioProcessingPreferences(): AudioProcessingPreferences {
  if (typeof window === "undefined") return DEFAULT_AUDIO_PROCESSING;

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(AUDIO_PROCESSING_PREF_KEY) || "null",
    ) as Partial<AudioProcessingPreferences> | null;

    if (!parsed || typeof parsed !== "object") {
      return DEFAULT_AUDIO_PROCESSING;
    }

    return {
      echoCancellation:
        typeof parsed.echoCancellation === "boolean"
          ? parsed.echoCancellation
          : DEFAULT_AUDIO_PROCESSING.echoCancellation,
      noiseSuppression:
        typeof parsed.noiseSuppression === "boolean"
          ? parsed.noiseSuppression
          : DEFAULT_AUDIO_PROCESSING.noiseSuppression,
      autoGainControl:
        typeof parsed.autoGainControl === "boolean"
          ? parsed.autoGainControl
          : DEFAULT_AUDIO_PROCESSING.autoGainControl,
    };
  } catch {
    return DEFAULT_AUDIO_PROCESSING;
  }
}

function saveAudioProcessingPreferences(next: AudioProcessingPreferences) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      AUDIO_PROCESSING_PREF_KEY,
      JSON.stringify(next),
    );
  } catch { }
}

function makeKickBroadcastChannelName(sessionId: string) {
  return `${KICK_EVENTS_CHANNEL_PREFIX}:${String(sessionId || "").trim()}`;
}

function normalizeIdentityKey(v: unknown) {
  return String(v || "")
    .trim()
    .toLowerCase();
}

function matchesKickPayload(args: {
  payload: KickBroadcastPayload | null | undefined;
  localIdentity: string;
  authUserId: string;
  baseUserId: string;
}) {
  const payload = args.payload;
  if (!payload) return false;

  const targetIdentity = normalizeIdentityKey(payload.targetIdentity);
  const targetUserId = normalizeIdentityKey(payload.targetUserId);

  const localIdentity = normalizeIdentityKey(args.localIdentity);
  const authUserId = normalizeIdentityKey(args.authUserId);
  const baseUserId = normalizeIdentityKey(args.baseUserId);

  if (targetIdentity && localIdentity && targetIdentity === localIdentity)
    return true;
  if (targetUserId && authUserId && targetUserId === authUserId) return true;
  if (targetUserId && baseUserId && targetUserId === baseUserId) return true;

  return false;
}

function playOneShotFromCandidates(urls: string[], volume = 0.9) {
  const list = Array.from(
    new Set((urls || []).map((u) => String(u || "").trim()).filter(Boolean)),
  );

  if (!list.length) return;

  const tryIndex = (index: number) => {
    if (index >= list.length) return;

    const a = new Audio(list[index]);
    a.preload = "auto";
    a.volume = volume;

    let advanced = false;
    const next = () => {
      if (advanced) return;
      advanced = true;
      tryIndex(index + 1);
    };

    try {
      a.addEventListener("error", next, { once: true });
    } catch { }

    a.play().catch(() => next());
  };

  tryIndex(0);
}

function buildColorCorrectionFilter(state: ColorCorrectionState) {
  const brightness = Math.max(
    50,
    Math.min(150, Math.round(state.brightness || 100)),
  );
  const contrast = Math.max(
    50,
    Math.min(150, Math.round(state.contrast || 100)),
  );
  const saturation = Math.max(
    0,
    Math.min(200, Math.round(state.saturation || 100)),
  );
  const warmth = Math.max(-100, Math.min(100, Math.round(state.warmth || 0)));

  const sepia = warmth > 0 ? Math.min(0.32, warmth / 1000 + warmth / 500) : 0;
  const hueRotate = warmth < 0 ? Math.round((Math.abs(warmth) / 100) * 16) : 0;

  return [
    `brightness(${brightness}%)`,
    `contrast(${contrast}%)`,
    `saturate(${saturation}%)`,
    `sepia(${sepia})`,
    hueRotate ? `hue-rotate(${hueRotate}deg)` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function parseParticipantMetadata(
  raw: unknown,
): Record<string, unknown> | null {
  const s = String(raw || "").trim();
  if (!s) return null;

  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getStatusFromMetadata(raw: unknown): string | null {
  const meta = parseParticipantMetadata(raw);
  if (!meta) return null;

  const status = String(meta.status || "").trim();
  return status || null;
}

function getDisplayNameFromParticipantMetadata(raw: unknown): string {
  const meta = parseParticipantMetadata(raw);
  if (!meta) return "";

  const direct = String(meta.displayName || "").trim();
  if (direct) return direct;

  const nestedProfileName = String(
    (meta.profile && typeof meta.profile === "object"
      ? (meta.profile as Record<string, unknown>).displayName
      : "") || "",
  ).trim();

  if (nestedProfileName) return nestedProfileName;

  return "";
}

const STATUS_LABELS: Record<string, string> = {
  afk: "AFK",
  break: "Break",
  skip: "Skip me",
  skip_deafened: "Skip me",
  call: "On a call",
  eating: "Eating",
  private: "Private",
};

function getStatusLabel(status: unknown): string {
  const key = String(status || "")
    .trim()
    .toLowerCase();
  return STATUS_LABELS[key] || "";
}

// tab presence
const LK_TAB_PREFIX = "mysession_lk_tabs";
const LK_TAB_TTL_MS = 18_000;
const LK_TAB_HEARTBEAT_MS = 5_000;
const LK_MAX_TABS_DEFAULT = 20;
const MOBILE_ROOM_LEASE_MS = 50 * 60 * 1000;
const MOBILE_PIP_ROOM_LEASE_MS = 4 * 60 * 60 * 1000;
const ROOM_LIVEKIT_RECONNECT_WINDOW_MS = 45_000;
const ROOM_AUTO_RECOVERY_MANUAL_THRESHOLD = 3;
const ROOM_CONNECT_TIMEOUT_MS = 20_000;
const ROOM_TOKEN_TIMEOUT_MS = 15_000;

type MobileRoomLease = {
  lastSeenAt: number;
  audioEnabled: boolean;
  videoEnabled: boolean;
  pictureInPictureActive?: boolean;
};

function mobileRoomLeaseKey(sessionId: string, userId: string) {
  return `mysession_mobile_room_lease:${sessionId}:${userId}`;
}

function readMobileRoomLease(
  sessionId: string,
  userId: string | null | undefined,
): MobileRoomLease | null {
  if (!sessionId || !userId) return null;

  try {
    const key = mobileRoomLeaseKey(sessionId, userId);
    const parsed = JSON.parse(localStorage.getItem(key) || "null") as MobileRoomLease | null;
    const lastSeenAt = Number(parsed?.lastSeenAt || 0);

    const pictureInPictureActive = parsed?.pictureInPictureActive === true;
    const leaseLifetime = pictureInPictureActive
      ? MOBILE_PIP_ROOM_LEASE_MS
      : MOBILE_ROOM_LEASE_MS;

    if (!lastSeenAt || Date.now() - lastSeenAt > leaseLifetime) {
      localStorage.removeItem(key);
      return null;
    }

    return {
      lastSeenAt,
      audioEnabled: !!parsed?.audioEnabled,
      videoEnabled: !!parsed?.videoEnabled,
      pictureInPictureActive,
    };
  } catch {
    return null;
  }
}

function writeMobileRoomLease(
  sessionId: string,
  userId: string | null | undefined,
  media: {
    audioEnabled: boolean;
    videoEnabled: boolean;
    pictureInPictureActive?: boolean;
  },
) {
  if (!sessionId || !userId) return;

  try {
    const key = mobileRoomLeaseKey(sessionId, userId);
    let previousPiPState = false;
    if (media.pictureInPictureActive === undefined) {
      try {
        previousPiPState =
          JSON.parse(localStorage.getItem(key) || "null")
            ?.pictureInPictureActive === true;
      } catch { }
    }

    localStorage.setItem(
      key,
      JSON.stringify({
        lastSeenAt: Date.now(),
        audioEnabled: !!media.audioEnabled,
        videoEnabled: !!media.videoEnabled,
        pictureInPictureActive:
          media.pictureInPictureActive ?? previousPiPState,
      } satisfies MobileRoomLease),
    );
  } catch { }
}

function clearMobileRoomLease(
  sessionId: string,
  userId: string | null | undefined,
) {
  if (!sessionId || !userId) return;
  try {
    localStorage.removeItem(mobileRoomLeaseKey(sessionId, userId));
  } catch { }
}

function createMobileReconnectPolicy() {
  return {
    nextRetryDelayInMs(context: { retryCount: number; elapsedMs: number }) {
      // Let LiveKit perform its fast in-place reconnect first. If signalling is
      // still unavailable, finish this cycle so the controlled recovery path can
      // refresh the token instead of spinning on a stale connection for 50 min.
      if (
        context.elapsedMs >= ROOM_LIVEKIT_RECONNECT_WINDOW_MS ||
        context.retryCount >= 7
      ) {
        return null;
      }
      if (context.retryCount === 0) return 0;
      if (context.retryCount === 1) return 300;
      return Math.min(7_000, context.retryCount * context.retryCount * 300);
    },
  };
}

type TabPresence = { v: number; tabs: { id: string; ts: number }[] };

function nowMs() {
  return Date.now();
}
function randId(len = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++)
    out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function getOrCreateTabId(storageKey = "mysession_lk_tab_id") {
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing && existing.length >= 6) return existing;
  } catch { }

  let id = "";
  try {
    const c: any = crypto as any;
    if (c?.randomUUID)
      id = String(c.randomUUID())
        .replace(/[^a-z0-9]/gi, "")
        .slice(0, 12)
        .toLowerCase();
  } catch { }
  if (!id) id = randId(12);

  try {
    sessionStorage.setItem(storageKey, id);
  } catch { }

  return id;
}

function makeLiveKitPageTabId() {
  let id = "";

  try {
    const c: any = crypto as any;
    if (c?.randomUUID) {
      id = String(c.randomUUID())
        .replace(/[^a-z0-9]/gi, "")
        .slice(0, 12)
        .toLowerCase();
    }
  } catch { }

  if (!id) {
    id = `${randId(8)}${Date.now().toString(36).slice(-4)}`.slice(0, 12);
  }

  return id;
}

function readPresence(key: string): TabPresence {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { v: 1, tabs: [] };
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object") return { v: 1, tabs: [] };
    const tabs = Array.isArray((j as any).tabs) ? (j as any).tabs : [];
    const norm = tabs
      .map((t: any) => ({ id: String(t?.id || ""), ts: Number(t?.ts || 0) }))
      .filter((t: any) => !!t.id && Number.isFinite(t.ts) && t.ts > 0);
    return { v: Number((j as any).v || 1) || 1, tabs: norm };
  } catch {
    return { v: 1, tabs: [] };
  }
}
function writePresence(key: string, p: TabPresence) {
  try {
    localStorage.setItem(key, JSON.stringify(p));
  } catch { }
}
function prunePresence(p: TabPresence): TabPresence {
  const t = nowMs();
  const tabs = (p.tabs || []).filter(
    (x) => t - (Number(x.ts) || 0) <= LK_TAB_TTL_MS,
  );
  return { v: p.v || 1, tabs };
}
function acquireTabSlot(key: string, tabId: string, maxTabs: number) {
  const p0 = prunePresence(readPresence(key));
  const t = nowMs();

  const tabs = [...(p0.tabs || [])];
  const idx = tabs.findIndex((x) => x.id === tabId);

  if (idx >= 0) {
    tabs[idx] = { id: tabId, ts: t };
    const p1 = { v: (p0.v || 1) + 1, tabs };
    writePresence(key, p1);
    return { ok: true, count: tabs.length, max: maxTabs };
  }

  if (tabs.length >= maxTabs) {
    const p1 = { v: (p0.v || 1) + 1, tabs };
    writePresence(key, p1);
    return { ok: false, count: tabs.length, max: maxTabs };
  }

  tabs.push({ id: tabId, ts: t });
  const p1 = { v: (p0.v || 1) + 1, tabs };
  writePresence(key, p1);
  return { ok: true, count: tabs.length, max: maxTabs };
}
function refreshTabSlot(key: string, tabId: string) {
  const p0 = prunePresence(readPresence(key));
  const t = nowMs();
  const tabs = [...(p0.tabs || [])];
  const idx = tabs.findIndex((x) => x.id === tabId);
  if (idx >= 0) tabs[idx] = { id: tabId, ts: t };
  const p1 = { v: (p0.v || 1) + 1, tabs };
  writePresence(key, p1);
}
function releaseTabSlot(key: string, tabId: string) {
  const p0 = prunePresence(readPresence(key));
  const tabs = (p0.tabs || []).filter((x) => x.id !== tabId);
  const p1 = { v: (p0.v || 1) + 1, tabs };
  writePresence(key, p1);
}
function makeTabPresenceKey(sessionId: string, baseUserId: string) {
  return `${LK_TAB_PREFIX}:${String(sessionId || "").trim()}:${String(
    baseUserId || "",
  )
    .trim()
    .toLowerCase()}`;
}

// default background
const DEFAULT_BG_DATA_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1B1B1B"/>
      <stop offset="0.5" stop-color="#0b3b6f"/>
      <stop offset="1" stop-color="#041018"/>
    </linearGradient>
    <radialGradient id="r" cx="30%" cy="30%" r="70%">
      <stop offset="0" stop-color="#38bdf8" stop-opacity="0.25"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#g)"/>
  <rect width="1280" height="720" fill="url(#r)"/>
  <circle cx="980" cy="210" r="240" fill="#22c55e" opacity="0.08"/>
  <circle cx="420" cy="520" r="320" fill="#a78bfa" opacity="0.07"/>
</svg>
`);

function makeBgPresetDataUrl(a: string, b: string, c: string, d: string) {
  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/>
      <stop offset="0.5" stop-color="${b}"/>
      <stop offset="1" stop-color="${c}"/>
    </linearGradient>
    <radialGradient id="r" cx="25%" cy="25%" r="80%">
      <stop offset="0" stop-color="${d}" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#g)"/>
  <rect width="1280" height="720" fill="url(#r)"/>
  <circle cx="1030" cy="170" r="230" fill="#F3F3F3" opacity="0.04"/>
  <circle cx="360" cy="520" r="310" fill="#F3F3F3" opacity="0.03"/>
</svg>
`)
  );
}

const FX_BG_PRESETS = [
  {
    id: "ocean",
    label: "Ocean",
    url: makeBgPresetDataUrl("#DCEBFF", "#83B8F4", "#EAF4FF", "#FFFFFF"),
  },
  {
    id: "forest",
    label: "Forest",
    url: makeBgPresetDataUrl("#E0F5E8", "#87CCA1", "#F1FAF4", "#FFFFFF"),
  },
  {
    id: "violet",
    label: "Violet",
    url: makeBgPresetDataUrl("#EEE8FF", "#B7A4ED", "#F8F5FF", "#FFFFFF"),
  },
  {
    id: "sunset",
    label: "Sunset",
    url: makeBgPresetDataUrl("#FFF0E5", "#F4AAA4", "#FFF8F3", "#FFFFFF"),
  },
];

type CustomBackgroundSlotId = "one" | "two" | "three";
type CustomBackgroundSlot = {
  id: CustomBackgroundSlotId;
  label: string;
  command: string;
  dataUrl: string;
};

const CUSTOM_BACKGROUND_DB_NAME = "mysession-room-backgrounds";
const CUSTOM_BACKGROUND_STORE_NAME = "settings";
const CUSTOM_BACKGROUND_STORE_KEY = "custom-background-slots-v1";
const CUSTOM_BACKGROUND_MAX_FILE_BYTES = 8 * 1024 * 1024;
const VIDEO_FX_PREFERENCE_KEY = "mysession-room-video-fx-v1";

type StoredVideoFxBackground =
  | { kind: "default" }
  | { kind: "preset"; id: string }
  | { kind: "custom"; id: CustomBackgroundSlotId };

type StoredVideoFxPreference = {
  mode: FxMode;
  blurStrength: number;
  background: StoredVideoFxBackground;
};

function normalizeStoredBlurStrength(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(4, Math.min(30, parsed)) : 12;
}

function readStoredVideoFxPreference(): StoredVideoFxPreference {
  const fallback: StoredVideoFxPreference = {
    mode: "off",
    blurStrength: 12,
    background: { kind: "default" },
  };

  try {
    const parsed = JSON.parse(
      localStorage.getItem(VIDEO_FX_PREFERENCE_KEY) || "null",
    ) as Partial<StoredVideoFxPreference> | null;
    if (!parsed) return fallback;

    const mode: FxMode =
      parsed.mode === "blur" || parsed.mode === "bg" ? parsed.mode : "off";
    const background = parsed.background;
    if (
      background?.kind === "preset" &&
      typeof background.id === "string" &&
      FX_BG_PRESETS.some((preset) => preset.id === background.id)
    ) {
      return {
        mode,
        blurStrength: normalizeStoredBlurStrength(parsed.blurStrength),
        background: { kind: "preset", id: background.id },
      };
    }
    if (
      background?.kind === "custom" &&
      (background.id === "one" ||
        background.id === "two" ||
        background.id === "three")
    ) {
      return {
        mode,
        blurStrength: normalizeStoredBlurStrength(parsed.blurStrength),
        background: { kind: "custom", id: background.id },
      };
    }

    return {
      mode,
      blurStrength: normalizeStoredBlurStrength(parsed.blurStrength),
      background: { kind: "default" },
    };
  } catch {
    return fallback;
  }
}

function writeStoredVideoFxPreference(preference: StoredVideoFxPreference) {
  try {
    localStorage.setItem(VIDEO_FX_PREFERENCE_KEY, JSON.stringify(preference));
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}
const DEFAULT_CUSTOM_BACKGROUND_SLOTS: CustomBackgroundSlot[] = [
  { id: "one", label: "Custom 1", command: "1", dataUrl: "" },
  { id: "two", label: "Custom 2", command: "2", dataUrl: "" },
  { id: "three", label: "Custom 3", command: "3", dataUrl: "" },
];

function normalizeCustomBackgroundSlots(value: unknown): CustomBackgroundSlot[] {
  const saved = Array.isArray(value) ? value : [];
  return DEFAULT_CUSTOM_BACKGROUND_SLOTS.map((fallback) => {
    const candidate = saved.find((item: any) => item?.id === fallback.id);
    return {
      ...fallback,
      command: fallback.command,
      dataUrl: typeof candidate?.dataUrl === "string" ? candidate.dataUrl : "",
    };
  });
}

function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("background_file_read_failed"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

function openCustomBackgroundDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CUSTOM_BACKGROUND_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CUSTOM_BACKGROUND_STORE_NAME)) {
        database.createObjectStore(CUSTOM_BACKGROUND_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("background_db_open_failed"));
  });
}

async function loadCustomBackgroundSlots(): Promise<CustomBackgroundSlot[]> {
  try {
    const database = await openCustomBackgroundDb();
    if (!database) return DEFAULT_CUSTOM_BACKGROUND_SLOTS;
    const value = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(CUSTOM_BACKGROUND_STORE_NAME, "readonly");
      const request = transaction.objectStore(CUSTOM_BACKGROUND_STORE_NAME).get(CUSTOM_BACKGROUND_STORE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("background_db_read_failed"));
    });
    database.close();
    return normalizeCustomBackgroundSlots(value);
  } catch (error) {
    console.warn("custom background slots could not be loaded", error);
    return DEFAULT_CUSTOM_BACKGROUND_SLOTS;
  }
}

async function saveCustomBackgroundSlots(slots: CustomBackgroundSlot[]) {
  const database = await openCustomBackgroundDb();
  if (!database) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(CUSTOM_BACKGROUND_STORE_NAME, "readwrite");
    transaction.objectStore(CUSTOM_BACKGROUND_STORE_NAME).put(slots, CUSTOM_BACKGROUND_STORE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("background_db_write_failed"));
    transaction.onabort = () => reject(transaction.error || new Error("background_db_write_aborted"));
  });
  database.close();
}

const LK_CAPTURE_WIDTH = 960;
const LK_CAPTURE_HEIGHT = 540;
const LK_CAPTURE_FPS = 24;

const VIDEO_TILE_LAYOUT_PRESET_KEY = "mysession_video_tile_layout_preset";
const VIDEO_TILE_LAYOUT_COLUMNS_KEY = "mysession_video_tile_layout_columns";
const VIDEO_TILE_LAYOUT_ROWS_KEY = "mysession_video_tile_layout_rows";
const MOBILE_LAYOUT_SWITCHER_VISIBLE_KEY =
  "mysession_mobile_layout_switcher_visible";
const CONNECTION_DIAGNOSTICS_TABLE = "connection_diagnostics";
const CONNECTION_DIAGNOSTICS_LOCAL_KEY =
  "mysession_connection_diagnostics_buffer_v1";
const CONNECTION_DIAGNOSTICS_LOCAL_MAX = 120;
const connectionDiagnosticsMemoryBuffer: Record<string, unknown>[] = [];
const CONNECTION_DIAGNOSTICS_DEDUP_MS = 30_000;
const CONNECTION_DIAGNOSTICS_REMOTE_SAMPLE_RATE = 1 / 100;
const ROOM_RECOVERY_REQUEST_EVENT = "mysession:room-recovery-request";
const CONNECTION_DIAGNOSTICS_CRITICAL_EVENTS = new Set([
  "livekit.connected",
  "livekit.disconnected",
  "livekit.reconnecting",
  "livekit.signal_reconnecting",
  "livekit.reconnected",
  "livekit.controlled_reconnect_started",
  "livekit.controlled_reconnect_failed",
  "attendance.leave_started",
  "window.offline",
]);

function normalizeVideoTileLayoutPreset(raw: unknown): VideoTileLayoutPreset {
  const s = String(raw || "").trim();

  if (
    s === "auto" ||
    s === "one" ||
    s === "two" ||
    s === "three" ||
    s === "four" ||
    s === "five" ||
    s === "six" ||
    s === "strip"
  ) {
    return s;
  }

  return "auto";
}

function readStoredLayoutNumber(key: string) {
  if (typeof window === "undefined") return 0;
  const n = Math.round(Number(window.localStorage.getItem(key) || 0));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(6, n));
}

function getNetworkDiagnosticSnapshot() {
  if (typeof navigator === "undefined") {
    return {
      online: null,
      effectiveType: "",
      connectionType: "",
      downlink: null,
      rtt: null,
      saveData: null,
    };
  }

  const connection =
    (navigator as any).connection ||
    (navigator as any).mozConnection ||
    (navigator as any).webkitConnection ||
    null;

  return {
    online: typeof navigator.onLine === "boolean" ? navigator.onLine : null,
    effectiveType: String(connection?.effectiveType || ""),
    connectionType: String(connection?.type || ""),
    downlink: Number.isFinite(Number(connection?.downlink))
      ? Number(connection.downlink)
      : null,
    rtt: Number.isFinite(Number(connection?.rtt))
      ? Number(connection.rtt)
      : null,
    saveData:
      typeof connection?.saveData === "boolean" ? connection.saveData : null,
  };
}

function pushConnectionDiagnosticToLocalBuffer(entry: Record<string, unknown>) {
  connectionDiagnosticsMemoryBuffer.push(entry);
  if (
    connectionDiagnosticsMemoryBuffer.length >
    CONNECTION_DIAGNOSTICS_LOCAL_MAX
  ) {
    connectionDiagnosticsMemoryBuffer.splice(
      0,
      connectionDiagnosticsMemoryBuffer.length -
      CONNECTION_DIAGNOSTICS_LOCAL_MAX,
    );
  }

  if (typeof window === "undefined") return;

  try {
    const raw = window.sessionStorage.getItem(CONNECTION_DIAGNOSTICS_LOCAL_KEY);
    const prev = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(prev) ? prev : [];

    window.sessionStorage.setItem(
      CONNECTION_DIAGNOSTICS_LOCAL_KEY,
      JSON.stringify([...list, entry].slice(-CONNECTION_DIAGNOSTICS_LOCAL_MAX)),
    );
  } catch {
    // local diagnostics are best-effort only
  }
}

function readConnectionDiagnosticLocalBuffer() {
  if (typeof window === "undefined") {
    return [...connectionDiagnosticsMemoryBuffer];
  }
  try {
    const raw = window.sessionStorage.getItem(CONNECTION_DIAGNOSTICS_LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed
      : [...connectionDiagnosticsMemoryBuffer];
  } catch {
    return [...connectionDiagnosticsMemoryBuffer];
  }
}

function createRoomLifecycleAttemptId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `room-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function getDisconnectReasonLabel(reason: unknown) {
  const numericReason = Number(reason);
  if (Number.isFinite(numericReason)) {
    const labels = DisconnectReason as unknown as Record<number, string>;
    return String(labels[numericReason] || numericReason);
  }
  return String(reason ?? "UNKNOWN") || "UNKNOWN";
}

function getUnknownErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || "");
  }
  return String(error || "");
}

function isTerminalRoomDisconnect(reason: unknown) {
  const numericReason = Number(reason);
  return new Set<number>([
    DisconnectReason.DUPLICATE_IDENTITY,
    DisconnectReason.PARTICIPANT_REMOVED,
    DisconnectReason.ROOM_DELETED,
    DisconnectReason.ROOM_CLOSED,
  ]).has(numericReason);
}

function getJwtTimingWithoutToken(token: string) {
  try {
    const encoded = String(token || "").split(".")[1] || "";
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(window.atob(padded));
    const issuedAt = Number(payload?.iat || 0);
    const expiresAt = Number(payload?.exp || 0);
    const nowSeconds = Math.floor(Date.now() / 1000);
    return {
      issued_at: issuedAt || null,
      expires_at: expiresAt || null,
      age_seconds: issuedAt ? Math.max(0, nowSeconds - issuedAt) : null,
      remaining_seconds: expiresAt ? expiresAt - nowSeconds : null,
    };
  } catch {
    return {
      issued_at: null,
      expires_at: null,
      age_seconds: null,
      remaining_seconds: null,
    };
  }
}

const CHAT_MSG_TABLE = "session_chat_messages";
const REACTION_TTL_MS = 2750;
const REACTION_RATE_WINDOW_MS = 5_000;
const REACTION_SEND_MAX_PER_WINDOW = 10;
const REACTION_SEND_MIN_INTERVAL_MS = 240;
const REACTION_RECEIVE_MAX_PER_USER_WINDOW = 12;
const REACTION_RECEIVE_MAX_TOTAL_WINDOW = 40;
const SESSION_SELECT_STR =
  "*, host_profile:profiles!sessions_host_id_fkey(id, full_name, avatar_url, bio), session_templates(*), session_bookings(user_id)";

const JOIN_EARLY_WINDOW_MINUTES = 10;
const SESSION_CLOSE_GRACE_MINUTES = 10;

type ChatUnreadMessageRow = Record<string, any>;

function normalizeChatUserId(raw: unknown) {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

function getChatRowSenderId(row: ChatUnreadMessageRow) {
  return normalizeChatUserId(
    row.user_id ??
    row.sender_user_id ??
    row.sender_id ??
    row.from_user_id ??
    row.author_id ??
    row.created_by,
  );
}

function getChatRowCreatedMs(row: ChatUnreadMessageRow) {
  const raw = row.created_at ?? row.inserted_at ?? row.sent_at ?? row.at;
  const ts = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(ts) ? ts : Date.now();
}

function getChatRowModeText(row: ChatUnreadMessageRow) {
  return String(
    row.chat_mode ??
    row.mode ??
    row.message_mode ??
    row.message_type ??
    row.type ??
    row.kind ??
    row.scope ??
    "",
  )
    .trim()
    .toLowerCase();
}

function getChatRowRecipientId(row: ChatUnreadMessageRow) {
  // IMPORTANT:
  // Do NOT fall back to host_user_id here.
  // host_user_id is room/session metadata, not a DM recipient.
  // Falling back to host_user_id makes unrelated DMs look "addressed" to normal users.
  return normalizeChatUserId(
    row.recipient_user_id ??
    row.receiver_user_id ??
    row.to_user_id ??
    row.target_user_id ??
    row.dm_peer_user_id ??
    row.direct_peer_user_id ??
    row.peer_user_id,
  );
}

function chatRowHasDirectMarker(row: ChatUnreadMessageRow) {
  const mode = getChatRowModeText(row);

  if (
    mode.includes("direct") ||
    mode.includes("dm") ||
    mode.includes("private")
  ) {
    return true;
  }

  return !!(
    row.dm_peer_user_id ||
    row.direct_peer_user_id ||
    row.peer_user_id ||
    row.to_user_id ||
    row.recipient_user_id ||
    row.receiver_user_id ||
    row.target_user_id
  );
}

function getChatRowDirectPeerId(
  row: ChatUnreadMessageRow,
  myUserId: string,
  hostUserId: string,
) {
  const me = normalizeChatUserId(myUserId);
  const host = normalizeChatUserId(hostUserId);
  const sender = getChatRowSenderId(row);
  const recipient = getChatRowRecipientId(row);

  const explicitPeer = normalizeChatUserId(
    row.dm_peer_user_id ??
    row.direct_peer_user_id ??
    row.peer_user_id ??
    row.other_user_id,
  );

  if (!me) return "";

  // Fallback for future schemas where there is a recipient, but host is not loaded yet.
  if (!host) {
    if (recipient === me && sender && sender !== me) return sender;
    if (sender === me && recipient && recipient !== me) return recipient;
    return "";
  }

  // Host view: count only DMs where the host is one side of the conversation.
  // Peer = the non-host participant.
  if (me === host) {
    if (sender === host && recipient && recipient !== host) return recipient;
    if (recipient === host && sender && sender !== host) return sender;

    if (sender === host && explicitPeer && explicitPeer !== host)
      return explicitPeer;
    if (recipient === host && explicitPeer && explicitPeer !== host)
      return explicitPeer;

    return "";
  }

  // Normal participant view:
  // Count ONLY direct messages between this user and the session host.
  // Do not count other users' DMs with the host.
  if (sender === host && recipient === me) return host;
  if (sender === me && recipient === host) return host;

  if (sender === host && explicitPeer === me) return host;
  if (sender === me && explicitPeer === host) return host;

  return "";
}

function isChatRowDirectMessage(
  row: ChatUnreadMessageRow,
  myUserId: string,
  hostUserId: string,
) {
  // This answers only: "is this row direct-like?"
  // Whether it is addressed to the current user is decided by getChatRowDirectPeerId().
  // That way unrelated DMs are skipped, not accidentally counted as general chat.
  return chatRowHasDirectMarker(row);
}

function clampUnreadCount(n: number) {
  return Math.max(0, Math.min(99, Math.round(Number(n || 0))));
}

function formatLocalDateTime(ms: number) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

function formatCountdown(msUntil: number) {
  const ms = Math.max(0, Number(msUntil) || 0);
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getFixedSessionTotalSecondsFromSchedule(rawSchedule: unknown): number {
  const directInfinite = parse50505(rawSchedule);
  if (directInfinite) return 0;

  let parsed: unknown = safeParseJson(rawSchedule);
  if (!parsed) return 0;

  if (isRecord(parsed)) {
    const kind = str((parsed as any).kind).toLowerCase();
    if (kind.includes("infinite")) return 0;

    if (
      isRecord((parsed as any).timer) &&
      (((parsed as any).timer as any).phases ||
        ((parsed as any).timer as any).segments)
    ) {
      return 0;
    }

    if ((parsed as any).phases || (parsed as any).segments) return 0;

    const maybeBlocks =
      (parsed as any).blocks ||
      (parsed as any).script ||
      (parsed as any).agenda ||
      (parsed as any).items ||
      (parsed as any).stages;

    if (Array.isArray(maybeBlocks)) parsed = maybeBlocks;
  }

  if (!Array.isArray(parsed)) return 0;

  return parsed.reduce((acc, b) => {
    const blk = isRecord(b) ? b : null;
    if (!blk) return acc;

    const seconds =
      num((blk as any).seconds) ||
      num((blk as any).durationSeconds) ||
      num((blk as any).duration_seconds) ||
      0;

    if (seconds > 0) return acc + seconds;

    const minutes =
      num((blk as any).minutes) ||
      num((blk as any).mins) ||
      num((blk as any).duration_minutes) ||
      num((blk as any).durationMinutes) ||
      num((blk as any).durationMin) ||
      num((blk as any).duration) ||
      0;

    return minutes > 0 ? acc + minutes * 60 : acc;
  }, 0);
}

type DocumentPiPApi = {
  window?: Window | null;
  requestWindow(options?: {
    width?: number;
    height?: number;
    disallowReturnToOpener?: boolean;
    preferInitialWindowPlacement?: boolean;
  }): Promise<Window>;
  addEventListener?: (type: string, listener: (event: any) => void) => void;
  removeEventListener?: (type: string, listener: (event: any) => void) => void;
};

type WindowWithDocumentPiP = Window & {
  documentPictureInPicture?: DocumentPiPApi;
};


type MobilePiPVideoElement = HTMLVideoElement & {
  disablePictureInPicture?: boolean;
  requestPictureInPicture?: () => Promise<unknown>;
  webkitSupportsPresentationMode?: (mode: "picture-in-picture") => boolean;
  webkitSetPresentationMode?: (mode: "picture-in-picture" | "inline") => void;
  webkitPresentationMode?: string;
  autoPictureInPicture?: boolean;
  requestVideoFrameCallback?: (
    callback: (now: DOMHighResTimeStamp, metadata: unknown) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

type MobileVideoPiPDocument = Document & {
  pictureInPictureEnabled?: boolean;
  pictureInPictureElement?: Element | null;
  exitPictureInPicture?: () => Promise<void>;
};

type MobilePiPMediaSession = {
  setActionHandler?: (
    action: string,
    handler: (() => void | Promise<void>) | null,
  ) => void;
};

type MobileCanvasCaptureTrack = MediaStreamTrack & {
  requestFrame?: () => void;
};

type MobileCaptureStreamCanvas = HTMLCanvasElement & {
  captureStream?: (frameRate?: number) => MediaStream;
};

type MobilePiPMediaRecorderConstructor = typeof MediaRecorder;

type MobileCachedVideoFrame = {
  canvas: HTMLCanvasElement;
  updatedAt: number;
};

type MobilePiPRoomTile = {
  video: MobilePiPVideoElement | null;
  label: string;
  avatarUrl: string;
};

const MOBILE_PIP_CANVAS_WIDTH = 960;
const MOBILE_PIP_CANVAS_HEIGHT = 540;
const MOBILE_PIP_COLLAGE_FPS = 8;
const MOBILE_PIP_SNAPSHOT_REFRESH_MS = 500;
const MOBILE_PIP_APPLE_LOOP_DURATION_MS = 900;
const MOBILE_PIP_HINT_DISMISSED_KEY = "mysession_mobile_pip_hint_dismissed_v1";

const mobilePiPVideoFrameCache = new WeakMap<
  HTMLVideoElement,
  MobileCachedVideoFrame
>();
const mobilePiPAvatarCache = new Map<string, HTMLImageElement | null>();

function isTabletOrMobilePiPRuntime(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent.toLowerCase();
  const touchPoints = navigator.maxTouchPoints || 0;
  const iPadUsingDesktopUserAgent =
    /macintosh/.test(userAgent) && touchPoints > 1;

  return (
    /android|iphone|ipad|ipod|mobile|tablet/.test(userAgent) ||
    iPadUsingDesktopUserAgent
  );
}

function isAppleMobilePiPRuntime(): boolean {
  if (typeof navigator === "undefined") return false;

  const userAgent = navigator.userAgent.toLowerCase();
  const touchPoints = navigator.maxTouchPoints || 0;

  return (
    /iphone|ipad|ipod/.test(userAgent) ||
    (/macintosh/.test(userAgent) && touchPoints > 1)
  );
}
function getMobilePiPRoomVideos(
  root: HTMLElement | null,
): MobilePiPVideoElement[] {
  if (!root) return [];

  return Array.from(
    root.querySelectorAll<HTMLVideoElement>("video"),
  ).filter((video) => video.dataset.mobilePipStage !== "true") as MobilePiPVideoElement[];
}

function getMobilePiPRoomTiles(root: HTMLElement | null): MobilePiPRoomTile[] {
  if (!root) return [];

  return Array.from(
    root.querySelectorAll<HTMLElement>('[data-mobile-pip-tile="true"]'),
  ).map((element) => ({
    video: element.querySelector<HTMLVideoElement>("video") as MobilePiPVideoElement | null,
    label: String(element.dataset.mobilePipLabel || "Participant").trim(),
    avatarUrl: String(element.dataset.mobilePipAvatarUrl || "").trim(),
  }));
}

function getMobilePiPAvatar(avatarUrl: string): HTMLImageElement | null {
  if (!avatarUrl) return null;
  const cached = mobilePiPAvatarCache.get(avatarUrl);
  if (cached !== undefined) {
    return cached?.complete && cached.naturalWidth > 0 ? cached : null;
  }

  const image = new Image();
  image.crossOrigin = "anonymous";
  image.referrerPolicy = "no-referrer";
  image.onerror = () => mobilePiPAvatarCache.set(avatarUrl, null);
  mobilePiPAvatarCache.set(avatarUrl, image);
  image.src = avatarUrl;
  return null;
}

function getPreferredMobilePiPSourceVideo(
  root: HTMLElement | null,
): MobilePiPVideoElement | null {
  const candidates = getMobilePiPRoomVideos(root).filter(
    isMobilePiPSourceRenderable,
  );

  if (candidates.length === 0) return null;

  return candidates.sort((left, right) => {
    const score = (video: HTMLVideoElement): number => {
      const rect = video.getBoundingClientRect();
      const visibleArea =
        Math.max(0, rect.width) * Math.max(0, rect.height);
      const remoteVideoPreference = video.muted ? 0 : 1_000_000;
      const playingPreference = video.paused ? 0 : 100_000;
      return remoteVideoPreference + playingPreference + visibleArea;
    };

    return score(right) - score(left);
  })[0] ?? null;
}

function supportsWebKitVideoPiP(
  video: MobilePiPVideoElement | null,
): boolean {
  return !!(
    video?.webkitSetPresentationMode &&
    video.webkitSupportsPresentationMode?.("picture-in-picture")
  );
}

function isMobilePiPCameraTrackActive(video: HTMLVideoElement): boolean {
  const stream = video.srcObject;
  if (!(stream instanceof MediaStream)) return false;

  return stream.getVideoTracks().some(
    (track) =>
      track.readyState === "live" &&
      track.enabled !== false &&
      track.muted === false,
  );
}

function isMobilePiPSourceRenderable(video: HTMLVideoElement): boolean {
  return (
    !video.ended &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0 &&
    isMobilePiPCameraTrackActive(video)
  );
}

function updateMobilePiPCachedFrame(video: HTMLVideoElement): void {
  if (!isMobilePiPSourceRenderable(video)) return;

  let cached = mobilePiPVideoFrameCache.get(video);
  if (!cached) {
    cached = {
      canvas: document.createElement("canvas"),
      updatedAt: 0,
    };
    mobilePiPVideoFrameCache.set(video, cached);
  }

  if (
    cached.canvas.width !== video.videoWidth ||
    cached.canvas.height !== video.videoHeight
  ) {
    cached.canvas.width = video.videoWidth;
    cached.canvas.height = video.videoHeight;
  }

  const context = cached.canvas.getContext("2d", { alpha: false });
  if (!context) return;

  try {
    context.drawImage(video, 0, 0, cached.canvas.width, cached.canvas.height);
    cached.updatedAt = Date.now();
  } catch {
    // Preserve the last valid frame.
  }
}

function getMobilePiPCachedFrame(
  video: HTMLVideoElement,
): HTMLCanvasElement | null {
  return mobilePiPVideoFrameCache.get(video)?.canvas ?? null;
}

function drawMobilePiPContainedSource(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (sourceWidth <= 0 || sourceHeight <= 0) return;

  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;

  context.drawImage(source, drawX, drawY, drawWidth, drawHeight);
}

function drawMobilePiPAvatarFallback(
  context: CanvasRenderingContext2D,
  tile: MobilePiPRoomTile,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const label = tile.label || "Participant";
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "?";
  const radius = Math.max(28, Math.min(width, height) * 0.19);
  const centerX = x + width / 2;
  const centerY = y + height / 2 - 12;
  const avatar = getMobilePiPAvatar(tile.avatarUrl);

  context.save();
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.clip();

  if (avatar) {
    const sourceSize = Math.min(avatar.naturalWidth, avatar.naturalHeight);
    const sourceX = (avatar.naturalWidth - sourceSize) / 2;
    const sourceY = (avatar.naturalHeight - sourceSize) / 2;
    context.drawImage(
      avatar,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      centerX - radius,
      centerY - radius,
      radius * 2,
      radius * 2,
    );
  } else {
    context.fillStyle = "#334155";
    context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
    context.fillStyle = "#ffffff";
    context.font = `700 ${Math.round(radius * 0.72)}px Inter, system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(initials, centerX, centerY + 1);
  }
  context.restore();

  context.fillStyle = "rgba(255,255,255,0.92)";
  context.font = "600 20px Inter, system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const safeLabel = label.length > 28 ? `${label.slice(0, 27)}…` : label;
  context.fillText(safeLabel, centerX, centerY + radius + 27);
}

function drawMobilePiPCollage(
  canvas: HTMLCanvasElement,
  roomRoot: HTMLElement | null,
): void {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return;

  if (canvas.width !== MOBILE_PIP_CANVAS_WIDTH) {
    canvas.width = MOBILE_PIP_CANVAS_WIDTH;
  }
  if (canvas.height !== MOBILE_PIP_CANVAS_HEIGHT) {
    canvas.height = MOBILE_PIP_CANVAS_HEIGHT;
  }

  context.fillStyle = "#0d0d0d";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const tiles = getMobilePiPRoomTiles(roomRoot);
  if (tiles.length === 0) {
    context.fillStyle = "rgba(255,255,255,0.72)";
    context.font = "600 30px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      "Waiting for participants…",
      canvas.width / 2,
      canvas.height / 2,
    );
    return;
  }

  const count = tiles.length;
  const columns = Math.ceil(Math.sqrt(count * (16 / 9)));
  const rows = Math.ceil(count / columns);
  const gap = 8;
  const cellWidth = (canvas.width - gap * (columns + 1)) / columns;
  const cellHeight = (canvas.height - gap * (rows + 1)) / rows;

  tiles.forEach((tile, index) => {
    const video = tile.video;
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = gap + column * (cellWidth + gap);
    const y = gap + row * (cellHeight + gap);

    context.fillStyle = "#171717";
    context.fillRect(x, y, cellWidth, cellHeight);

    if (video && isMobilePiPSourceRenderable(video)) {
      updateMobilePiPCachedFrame(video);

      try {
        drawMobilePiPContainedSource(
          context,
          video,
          video.videoWidth,
          video.videoHeight,
          x,
          y,
          cellWidth,
          cellHeight,
        );
      } catch {
        const cached = video ? getMobilePiPCachedFrame(video) : null;
        if (cached) {
          drawMobilePiPContainedSource(
            context,
            cached,
            cached.width,
            cached.height,
            x,
            y,
            cellWidth,
            cellHeight,
          );
        }
      }
    } else {
      const cached =
        video && isMobilePiPCameraTrackActive(video)
          ? getMobilePiPCachedFrame(video)
          : null;

      if (cached) {
        drawMobilePiPContainedSource(
          context,
          cached,
          cached.width,
          cached.height,
          x,
          y,
          cellWidth,
          cellHeight,
        );
      } else {
        drawMobilePiPAvatarFallback(
          context,
          tile,
          x,
          y,
          cellWidth,
          cellHeight,
        );
      }
    }

    context.strokeStyle = "rgba(255,255,255,0.16)";
    context.lineWidth = 2;
    context.strokeRect(x, y, cellWidth, cellHeight);
  });
}

async function waitForMobilePiPDecodedFrame(
  video: MobilePiPVideoElement,
  timeoutMs = 1800,
): Promise<boolean> {
  if (
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
  ) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let frameCallbackHandle: number | null = null;

    const finish = (ready: boolean): void => {
      if (settled) return;
      settled = true;

      window.clearTimeout(timeoutId);
      video.removeEventListener("loadeddata", checkReady);
      video.removeEventListener("playing", checkReady);
      video.removeEventListener("resize", checkReady);

      if (
        frameCallbackHandle !== null &&
        typeof video.cancelVideoFrameCallback === "function"
      ) {
        video.cancelVideoFrameCallback(frameCallbackHandle);
      }

      resolve(ready);
    };

    const checkReady = (): void => {
      finish(
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.videoWidth > 0 &&
          video.videoHeight > 0,
      );
    };

    const timeoutId = window.setTimeout(() => finish(false), timeoutMs);

    video.addEventListener("loadeddata", checkReady);
    video.addEventListener("playing", checkReady);
    video.addEventListener("resize", checkReady);

    if (typeof video.requestVideoFrameCallback === "function") {
      frameCallbackHandle = video.requestVideoFrameCallback(() => {
        checkReady();
      });
    }

    checkReady();
  });
}

function isMobilePiPStageReady(
  video: MobilePiPVideoElement | null,
): boolean {
  if (!video) return false;

  const stream = video.srcObject;
  const track =
    stream instanceof MediaStream ? stream.getVideoTracks()[0] : undefined;

  const readinessFlag =
    video.dataset.mobilePipStage !== "true" ||
    video.dataset.pipReady === "true";

  const fileBackedStage =
    video.dataset.mobilePipFileStage === "true" &&
    Boolean(video.currentSrc || video.src);

  return (
    readinessFlag &&
    !video.paused &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0 &&
    (fileBackedStage ||
      (track?.readyState === "live" && track.muted === false))
  );
}

function configureMobilePiPVideo(
  video: MobilePiPVideoElement,
): void {
  video.disablePictureInPicture = false;
  video.autoPictureInPicture = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("autoplay", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("autopictureinpicture", "");
  video.removeAttribute("disablepictureinpicture");

  // The generated collage has no audio. Preserve the actual LiveKit element's
  // existing mute state so Safari PiP does not unexpectedly change room audio.
  if (video.dataset.mobilePipStage === "true") {
    video.muted = true;
    video.setAttribute("muted", "");
  }
}

async function enterMobileVideoPictureInPicture(
  video: MobilePiPVideoElement | null,
  options: { skipPlay?: boolean; requireReady?: boolean } = {},
): Promise<boolean> {
  if (!video) return false;

  configureMobilePiPVideo(video);

  try {
    if (options.requireReady && !isMobilePiPStageReady(video)) {
      return false;
    }

    // iPadOS Safari requires this call to remain inside the original tap.
    // Do it before awaiting play() so transient user activation is preserved.
    if (supportsWebKitVideoPiP(video)) {
      if (video.paused && options.skipPlay) return false;
      video.webkitSetPresentationMode?.("picture-in-picture");
      return true;
    }

    if (!options.skipPlay) {
      await video.play();
    } else if (video.paused) {
      return false;
    }

    const pipDocument = document as MobileVideoPiPDocument;
    if (
      pipDocument.pictureInPictureEnabled === true &&
      !pipDocument.pictureInPictureElement &&
      typeof video.requestPictureInPicture === "function"
    ) {
      await video.requestPictureInPicture();
      return true;
    }


  } catch (error) {
    console.warn("[room-mobile-pip] Unable to enter PiP", error);
  }

  return false;
}

function useMobilePiPCollage(
  roomRootRef: React.RefObject<HTMLElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  stageRef: React.RefObject<MobilePiPVideoElement | null>,
  enabled: boolean,
): () => Promise<MobilePiPVideoElement | null> {
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const snapshotIntervalRef = useRef<number | null>(null);

  const pushCollageFrame = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    drawMobilePiPCollage(canvas, roomRootRef.current);

    const captureTrack = streamRef.current?.getVideoTracks()[0] as
      | MobileCanvasCaptureTrack
      | undefined;
    captureTrack?.requestFrame?.();
  }, [canvasRef, roomRootRef]);

  const ensureCollageStream = useCallback(
    async (): Promise<MobilePiPVideoElement | null> => {
      if (!enabled) return null;

      const canvas = canvasRef.current as MobileCaptureStreamCanvas | null;
      const stage = stageRef.current;

      if (!canvas || !stage || typeof canvas.captureStream !== "function") {
        return null;
      }

      pushCollageFrame();

      const existingTrack = streamRef.current?.getVideoTracks()[0];
      if (!existingTrack || existingTrack.readyState !== "live") {
        streamRef.current?.getTracks().forEach((track) => track.stop());

        stage.dataset.pipReady = "false";
        streamRef.current = canvas.captureStream(MOBILE_PIP_COLLAGE_FPS);
        stage.srcObject = streamRef.current;
      }

      stage.disablePictureInPicture = false;
      stage.autoPictureInPicture = true;
      stage.autoplay = true;
      stage.muted = true;
      stage.playsInline = true;
      stage.setAttribute("autoplay", "");
      stage.setAttribute("muted", "");
      stage.setAttribute("playsinline", "");
      stage.setAttribute("autopictureinpicture", "");
      stage.removeAttribute("disablepictureinpicture");

      stage.dataset.pipReady = "false";
      pushCollageFrame();
      await stage.play().catch(() => undefined);

      const decoded = await waitForMobilePiPDecodedFrame(stage);
      pushCollageFrame();

      if (decoded) {
        stage.dataset.pipReady = "true";

        try {
          stage.poster = canvas.toDataURL("image/jpeg", 0.82);
        } catch {
          // Poster is only a fallback for a short Android transition stall.
        }
      }

      return decoded ? stage : null;
    },
    [canvasRef, enabled, pushCollageFrame, stageRef],
  );

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    void ensureCollageStream().then(() => {
      if (!cancelled) pushCollageFrame();
    });

    const animate = (): void => {
      pushCollageFrame();
      animationFrameRef.current = window.requestAnimationFrame(animate);
    };

    animationFrameRef.current = window.requestAnimationFrame(animate);

    intervalRef.current = window.setInterval(
      pushCollageFrame,
      Math.max(125, Math.round(1000 / MOBILE_PIP_COLLAGE_FPS)),
    );

    snapshotIntervalRef.current = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      getMobilePiPRoomVideos(roomRootRef.current).forEach(
        updateMobilePiPCachedFrame,
      );
    }, MOBILE_PIP_SNAPSHOT_REFRESH_MS);

    const handleVisibilityChange = (): void => {
      pushCollageFrame();

      if (document.visibilityState === "visible") {
        getMobilePiPRoomVideos(roomRootRef.current).forEach((video) => {
          void video.play().catch(() => undefined);
        });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
      }
      if (snapshotIntervalRef.current !== null) {
        window.clearInterval(snapshotIntervalRef.current);
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      if (stageRef.current) {
        stageRef.current.dataset.pipReady = "false";
        stageRef.current.srcObject = null;
      }
    };
  }, [
    enabled,
    ensureCollageStream,
    pushCollageFrame,
    roomRootRef,
    stageRef,
  ]);

  return ensureCollageStream;
}

function getApplePiPRecorderMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function useAppleMobilePiPPosterLoop(
  roomRootRef: React.RefObject<HTMLElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  stageRef: React.RefObject<MobilePiPVideoElement | null>,
  enabled: boolean,
): () => Promise<MobilePiPVideoElement | null> {
  const objectUrlRef = useRef<string>("");
  const preparedForSignatureRef = useRef<string>("");
  const preparationRef = useRef<Promise<MobilePiPVideoElement | null> | null>(null);

  const preparePosterLoop = useCallback(async () => {
    if (!enabled || !isAppleMobilePiPRuntime()) return null;
    const root = roomRootRef.current;
    const canvas = canvasRef.current as MobileCaptureStreamCanvas | null;
    const stage = stageRef.current;
    const mimeType = getApplePiPRecorderMimeType();
    if (!root || !canvas || !stage || !mimeType || !canvas.captureStream) return null;

    const signature = getMobilePiPRoomTiles(root)
      .map((tile) => `${tile.label}|${tile.avatarUrl}|${Boolean(tile.video)}`)
      .join("::");
    if (
      signature &&
      signature === preparedForSignatureRef.current &&
      isMobilePiPStageReady(stage)
    ) return stage;
    if (preparationRef.current) return preparationRef.current;

    preparationRef.current = (async () => {
      drawMobilePiPCollage(canvas, root);
      const stream = canvas.captureStream(MOBILE_PIP_COLLAGE_FPS);
      const chunks: BlobPart[] = [];
      try {
        const Recorder = MediaRecorder as MobilePiPMediaRecorderConstructor;
        const recorder = new Recorder(stream, {
          mimeType,
          videoBitsPerSecond: 900_000,
        });
        const recorded = new Promise<Blob | null>((resolve) => {
          recorder.addEventListener("dataavailable", (event) => {
            if (event.data?.size) chunks.push(event.data);
          });
          recorder.addEventListener("stop", () => {
            resolve(chunks.length ? new Blob(chunks, { type: mimeType }) : null);
          });
          recorder.addEventListener("error", () => resolve(null));
        });

        recorder.start(120);
        const startedAt = performance.now();
        while (performance.now() - startedAt < MOBILE_PIP_APPLE_LOOP_DURATION_MS) {
          drawMobilePiPCollage(canvas, root);
          await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
        }
        recorder.stop();
        const blob = await recorded;
        if (!blob?.size) return null;

        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = URL.createObjectURL(blob);
        stage.pause();
        stage.srcObject = null;
        stage.dataset.mobilePipFileStage = "true";
        stage.dataset.pipReady = "false";
        stage.src = objectUrlRef.current;
        stage.loop = true;
        configureMobilePiPVideo(stage);
        await stage.play();
        const decoded = await waitForMobilePiPDecodedFrame(stage, 2400);
        stage.dataset.pipReady = decoded ? "true" : "false";
        if (!decoded) return null;
        preparedForSignatureRef.current = signature;
        return stage;
      } catch (error) {
        console.debug("[room-mobile-pip] Apple poster loop unavailable", error);
        return null;
      } finally {
        stream.getTracks().forEach((track) => track.stop());
      }
    })();

    try {
      return await preparationRef.current;
    } finally {
      preparationRef.current = null;
    }
  }, [canvasRef, enabled, roomRootRef, stageRef]);

  useEffect(() => {
    if (!enabled || !isAppleMobilePiPRuntime()) return;
    void preparePosterLoop();
    return () => {
      const stage = stageRef.current;
      if (stage?.dataset.mobilePipFileStage === "true") {
        stage.pause();
        stage.removeAttribute("src");
        stage.load();
        delete stage.dataset.mobilePipFileStage;
        stage.dataset.pipReady = "false";
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = "";
      }
    };
  }, [enabled, preparePosterLoop, stageRef]);

  return preparePosterLoop;
}

function useMobileBrowserInitiatedPiP(
  enabled: boolean,
  preparePreferredVideo: () => Promise<MobilePiPVideoElement | null>,
  stageRef: React.RefObject<MobilePiPVideoElement | null>,
  onOpened: (video: MobilePiPVideoElement) => void,
): void {
  useEffect(() => {
    if (!enabled || !isTabletOrMobilePiPRuntime()) return;

    const mediaSession = navigator.mediaSession as unknown as
      | MobilePiPMediaSession
      | undefined;

    let preparedStage: MobilePiPVideoElement | null = null;
    let autoPiPRequested = false;

    const prewarm = async (): Promise<void> => {
      const stage = await preparePreferredVideo();
      if (stage && isMobilePiPStageReady(stage)) {
        preparedStage = stage;
      }
    };

    void prewarm();

    const requestBrowserPiP = async (): Promise<void> => {
      const stage =
        preparedStage ??
        (isMobilePiPStageReady(stageRef.current)
          ? stageRef.current
          : null) ??
        (await preparePreferredVideo());

      if (!isMobilePiPStageReady(stage)) return;

      preparedStage = stage;
      const opened = await enterMobileVideoPictureInPicture(stage, {
        requireReady: true,
      });
      if (opened) onOpened(stage);
    };

    try {
      if (navigator.mediaSession) {
        navigator.mediaSession.playbackState = "playing";
      }

      mediaSession?.setActionHandler?.(
        "enterpictureinpicture",
        requestBrowserPiP,
      );
    } catch (error) {
      console.debug(
        "[room-mobile-pip] Browser auto-PiP handler unavailable",
        error,
      );
    }

    const handleVisibilityChange = (): void => {
      if (
        document.visibilityState !== "hidden" ||
        autoPiPRequested
      ) {
        return;
      }

      const stage =
        preparedStage ??
        (isMobilePiPStageReady(stageRef.current)
          ? stageRef.current
          : null);

      if (!stage || !isMobilePiPStageReady(stage)) return;

      autoPiPRequested = true;
      void enterMobileVideoPictureInPicture(stage, {
        skipPlay: true,
        requireReady: true,
      }).then((opened) => {
        if (opened) onOpened(stage);
      });
    };

    const resetAutoAttempt = (): void => {
      if (document.visibilityState === "visible") {
        autoPiPRequested = false;
        void prewarm();
      }
    };

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
      { capture: true },
    );
    window.addEventListener("pageshow", resetAutoAttempt);

    return () => {
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
        { capture: true },
      );
      window.removeEventListener("pageshow", resetAutoAttempt);

      try {
        if (navigator.mediaSession) {
          navigator.mediaSession.playbackState = "none";
        }
        mediaSession?.setActionHandler?.("enterpictureinpicture", null);
      } catch {
        // Ignore unsupported cleanup.
      }
    };
  }, [enabled, onOpened, preparePreferredVideo, stageRef]);
}

function getRoomAuthCallbackUrl(redirectPath: string) {
  const safeRedirect =
    redirectPath &&
      redirectPath.startsWith("/") &&
      !redirectPath.startsWith("//")
      ? redirectPath
      : "/sessions";

  if (typeof window === "undefined") {
    return `https://www.mysession.club/auth/callback?redirect=${encodeURIComponent(safeRedirect)}`;
  }

  const url = new URL("/auth/callback", window.location.origin);
  url.searchParams.set("redirect", safeRedirect);
  return url.toString();
}

function RoomAuthModal({
  open,
  theme,
  sessionTitle,
  redirectPath,
  onEmailAuthSuccess,
}: {
  open: boolean;
  theme: RoomTheme;
  sessionTitle: string;
  redirectPath: string;
  onEmailAuthSuccess: () => Promise<void>;
}) {
  const isLight = theme === "light";
  const [mode, setMode] = useState<"login" | "register">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [oauthLoading, setOauthLoading] = useState<
    null | "google" | "discord" | "facebook"
  >(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const oauthPopupRef = useRef<Window | null>(null);
  const oauthPollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;

    const cleanupPopupWatch = () => {
      if (oauthPollTimerRef.current) {
        window.clearInterval(oauthPollTimerRef.current);
        oauthPollTimerRef.current = null;
      }
    };

    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      const payload = event.data as any;
      if (!payload || payload.type !== "mysession-auth-callback") return;

      cleanupPopupWatch();

      try {
        oauthPopupRef.current?.close?.();
      } catch {
        // ignore
      }

      oauthPopupRef.current = null;
      setOauthLoading(null);
      setError("");
      setMessage("Signed in. Preparing your room…");

      try {
        await onEmailAuthSuccess();
      } catch (e: any) {
        setError(
          e?.message ||
          "Signed in, but failed to refresh the room. Please reload.",
        );
      }
    };

    window.addEventListener("message", onMessage);

    return () => {
      window.removeEventListener("message", onMessage);
      cleanupPopupWatch();
      try {
        oauthPopupRef.current?.close?.();
      } catch {
        // ignore
      }
      oauthPopupRef.current = null;
    };
  }, [open, onEmailAuthSuccess]);

  if (!open) return null;

  const redirectTo = getRoomAuthCallbackUrl(redirectPath);

  const startOAuth = async (provider: "google" | "discord" | "facebook") => {
    try {
      setError("");
      setMessage("");
      setOauthLoading(provider);

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          ...(provider === "discord" ? { scopes: "identify email" } : {}),
        } as any,
      });

      if (error) {
        console.log(`[room-auth] ${provider} oauth error:`, error);
        setError(error.message);
        setOauthLoading(null);
        return;
      }

      const providerUrl = String((data as any)?.url || "").trim();

      if (!providerUrl) {
        setError("Could not start social login. Please try again.");
        setOauthLoading(null);
        return;
      }

      const popupWidth = 520;
      const popupHeight = 720;
      const left =
        typeof window !== "undefined"
          ? Math.max(
            0,
            Math.round(window.screenX + (window.outerWidth - popupWidth) / 2),
          )
          : 120;
      const top =
        typeof window !== "undefined"
          ? Math.max(
            0,
            Math.round(
              window.screenY + (window.outerHeight - popupHeight) / 2,
            ),
          )
          : 80;

      const popup = window.open(
        providerUrl,
        "mysession_oauth",
        [
          `width=${popupWidth}`,
          `height=${popupHeight}`,
          `left=${left}`,
          `top=${top}`,
          "resizable=yes",
          "scrollbars=yes",
          "status=no",
          "toolbar=no",
          "menubar=no",
          "location=yes",
        ].join(","),
      );

      // Popup can be blocked by the browser. In that case, fall back to a normal redirect.
      if (!popup) {
        window.location.assign(providerUrl);
        return;
      }

      oauthPopupRef.current = popup;
      try {
        popup.focus();
      } catch {
        // ignore
      }

      setMessage(
        "Finish signing in in the popup window. This room will stay open here.",
      );

      if (oauthPollTimerRef.current) {
        window.clearInterval(oauthPollTimerRef.current);
      }

      oauthPollTimerRef.current = window.setInterval(() => {
        const closed = !oauthPopupRef.current || oauthPopupRef.current.closed;

        if (closed) {
          if (oauthPollTimerRef.current) {
            window.clearInterval(oauthPollTimerRef.current);
            oauthPollTimerRef.current = null;
          }

          oauthPopupRef.current = null;
          setOauthLoading(null);
          setMessage((prev) =>
            prev.includes("Signed in")
              ? prev
              : "Popup closed. You can try signing in again.",
          );
        }
      }, 600);
    } catch (e: any) {
      console.log("[room-auth] oauth unexpected error:", e);
      setError(e?.message || "Failed to start social login. Please try again.");
      setOauthLoading(null);
    }
  };

  const handleEmailLogin = async () => {
    const cleanEmail = email.trim();

    if (!cleanEmail || !password) {
      setError("Please enter your email and password.");
      return;
    }

    try {
      setEmailLoading(true);
      setError("");
      setMessage("");

      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        setError(error.message);
        return;
      }

      await onEmailAuthSuccess();
      setMessage("Signed in. Preparing your room…");
    } catch (e: any) {
      setError(e?.message || "Failed to sign in. Please try again.");
    } finally {
      setEmailLoading(false);
    }
  };

  const handleEmailRegister = async () => {
    const cleanFullName = fullName.trim();
    const cleanEmail = email.trim();

    if (!cleanFullName || !cleanEmail || !password) {
      setError("Please enter your name, email, and password.");
      return;
    }

    try {
      setEmailLoading(true);
      setError("");
      setMessage("");

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          emailRedirectTo: redirectTo,
          data: { full_name: cleanFullName },
        },
      });

      if (error) {
        setError(error.message);
        return;
      }

      if (data.user && data.session) {
        try {
          await supabase.from("profiles").upsert([
            {
              id: data.user.id,
              full_name: cleanFullName,
              avatar_url: null,
              bio: "",
            },
          ]);
        } catch (profileError) {
          console.warn(
            "[room-auth] profile upsert after signup failed:",
            profileError,
          );
        }
      }

      if (data.session) {
        await onEmailAuthSuccess();
        setMessage("Account created. Preparing your room…");
        return;
      }

      setMessage(
        "Account created. Check your email and open the newest MySession confirmation link. You’ll return to this room automatically.",
      );
    } catch (e: any) {
      setError(e?.message || "Failed to create account. Please try again.");
    } finally {
      setEmailLoading(false);
    }
  };

  const inputClass = [
    "w-full rounded-2xl border px-4 py-3 text-[14px] outline-none transition",
    isLight
      ? "border-[#CFCFCF] bg-[#F3F3F3] text-black placeholder:text-black/35 focus:ring-2 focus:ring-black/15"
      : "border-[#2B2B2B] bg-[#252525] text-white placeholder:text-white/35 focus:ring-2 focus:ring-white/20",
  ].join(" ");

  const subtleText = isLight ? "text-black/55" : "text-white/55";
  const cardClass = isLight
    ? "border-[#CFCFCF] bg-[#F3F3F3] text-black shadow-[0_24px_80px_rgba(15,23,42,0.22)]"
    : "border-[#2B2B2B] bg-[#242424] text-white shadow-[0_24px_80px_rgba(0,0,0,0.55)]";

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-[#E6E6E6] backdrop-blur-[3px]" />
      <div
        className={`relative w-full max-w-[460px] rounded-[28px] border p-5 sm:p-6 ${cardClass}`}
      >
        <div className="mb-4">
          <div
            className={`text-[12px] font-semibold uppercase tracking-[0.16em] ${subtleText}`}
          >
            Join this session
          </div>
          <div className="mt-2 text-[24px] font-bold leading-tight">
            Sign in to enter the room
          </div>
          <div className={`mt-2 text-[14px] leading-6 ${subtleText}`}>
            You’re opening <span className="font-semibold">{sessionTitle}</span>
            . Sign in here and you’ll continue directly to pre-join.
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            disabled={oauthLoading !== null || emailLoading}
            onClick={() => void startOAuth("google")}
            className={[
              "flex h-12 w-full items-center justify-center gap-3 rounded-2xl border text-[15px] font-semibold transition disabled:opacity-60",
              isLight
                ? "border-[#CFCFCF] bg-[#F3F3F3] hover:bg-black/[0.03]"
                : "border-[#2B2B2B] bg-[#252525] hover:bg-[#424242]",
            ].join(" ")}
          >
            <img
              src="https://www.svgrepo.com/show/475656/google-color.svg"
              className="h-5 w-5"
              alt=""
            />
            {oauthLoading === "google"
              ? "Opening Google…"
              : "Continue with Google"}
          </button>

          <button
            type="button"
            disabled={oauthLoading !== null || emailLoading}
            onClick={() => void startOAuth("discord")}
            className="flex h-12 w-full items-center justify-center gap-3 rounded-2xl bg-[#5865F2] text-[15px] font-semibold text-white transition hover:bg-[#4752C4] disabled:opacity-60"
          >
            <span
              aria-hidden="true"
              className="flex h-5 w-5 items-center justify-center rounded-md bg-[#F3F3F3] text-[13px] font-black text-[#5865F2]"
            >
              D
            </span>
            {oauthLoading === "discord"
              ? "Opening Discord…"
              : "Continue with Discord"}
          </button>

          <button
            type="button"
            disabled={oauthLoading !== null || emailLoading}
            onClick={() => void startOAuth("facebook")}
            className="flex h-12 w-full items-center justify-center gap-3 rounded-2xl bg-[#1877F2] text-[15px] font-semibold text-white transition hover:bg-[#0f66d3] disabled:opacity-60"
          >
            <img src="/icons/facebook.svg" className="h-5 w-5" alt="" />
            {oauthLoading === "facebook"
              ? "Opening Facebook…"
              : "Continue with Facebook"}
          </button>
        </div>

        <div className="my-5 flex items-center gap-3">
          <div
            className={`h-px flex-1 ${isLight ? "bg-[#DCDCDC]" : "bg-[#303030]"}`}
          />
          <div className={`text-[12px] ${subtleText}`}>or use email</div>
          <div
            className={`h-px flex-1 ${isLight ? "bg-[#DCDCDC]" : "bg-[#303030]"}`}
          />
        </div>

        <div
          className={`mb-3 grid grid-cols-2 rounded-2xl p-1 ${isLight ? "bg-black/[0.04]" : "bg-[#252525]"}`}
        >
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError("");
              setMessage("");
            }}
            className={[
              "h-9 rounded-xl text-[13px] font-semibold transition",
              mode === "login"
                ? isLight
                  ? "bg-[#F3F3F3] text-black shadow-sm"
                  : "bg-[#F3F3F3] text-black"
                : subtleText,
            ].join(" ")}
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError("");
              setMessage("");
            }}
            className={[
              "h-9 rounded-xl text-[13px] font-semibold transition",
              mode === "register"
                ? isLight
                  ? "bg-[#F3F3F3] text-black shadow-sm"
                  : "bg-[#F3F3F3] text-black"
                : subtleText,
            ].join(" ")}
          >
            Create account
          </button>
        </div>

        <div className="space-y-3">
          {mode === "register" ? (
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={inputClass}
              placeholder="Your name"
              autoComplete="name"
            />
          ) : null}

          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="Email address"
            type="email"
            autoComplete="email"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (mode === "login") void handleEmailLogin();
                else void handleEmailRegister();
              }
            }}
          />

          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            placeholder="Password"
            type="password"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (mode === "login") void handleEmailLogin();
                else void handleEmailRegister();
              }
            }}
          />

          <button
            type="button"
            disabled={emailLoading || oauthLoading !== null}
            onClick={() => {
              if (mode === "login") void handleEmailLogin();
              else void handleEmailRegister();
            }}
            className={[
              "h-12 w-full rounded-2xl text-[15px] font-semibold transition disabled:opacity-60",
              isLight
                ? "bg-black text-white hover:bg-black/85"
                : "bg-[#F3F3F3] text-black hover:bg-[#F1F1F1]/90",
            ].join(" ")}
          >
            {emailLoading
              ? mode === "login"
                ? "Signing in…"
                : "Creating account…"
              : mode === "login"
                ? "Log in and join"
                : "Create account"}
          </button>
        </div>

        {error ? (
          <div
            className={`mt-4 rounded-2xl border px-4 py-3 text-[13px] leading-5 ${isLight
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-red-500/20 bg-red-500/10 text-red-200"
              }`}
          >
            {error}
          </div>
        ) : null}

        {message ? (
          <div
            className={`mt-4 rounded-2xl border px-4 py-3 text-[13px] leading-5 ${isLight
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-emerald-500/20 bg-[#81DB86]/10 text-emerald-200"
              }`}
          >
            {message}
          </div>
        ) : null}

        <div className={`mt-4 text-center text-[12px] leading-5 ${subtleText}`}>
          Social login opens in a small popup. Keep this room open — it will
          continue automatically after sign-in.
        </div>
      </div>
    </div>
  );
}


type AccountabilityWallTask = {
  id: string;
  text: string;
  user_id: string;
  session_id: string;
  created_at?: string | null;
  completed?: boolean | null;
  profiles?: {
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
};


type TaskTimerState = {
  elapsed_ms: number;
  running_since_ms: number | null;
  updated_at?: string;
};

type TaskTimerMap = Record<string, TaskTimerState>;

const TASK_TIMER_EVENT = "mysession:task-timers-updated";
const TASK_TIMER_VISIBILITY_EVENT = "mysession:task-timer-visibility-changed";
const TASK_TIMER_ENABLED_STORAGE_PREFIX = "mysession_task_timer_enabled_v1";
const TASK_TIMER_STORAGE_PREFIX = "mysession_task_timers_v1";
const TASKS_SYNC_EVENT = "mysession:tasks-synced";

function emitRoomTasksSync(detail: Record<string, unknown> = {}) {
  try {
    const payload = { ...detail, at: Date.now() };

    window.dispatchEvent(
      new CustomEvent(TASKS_SYNC_EVENT, {
        detail: payload,
      }),
    );

    window.dispatchEvent(
      new CustomEvent("mysession:tasks-updated", {
        detail: payload,
      }),
    );
  } catch {
    // best effort only
  }
}

function makeTaskTimerStorageKey(sessionId: string | null | undefined, userId: string | null | undefined) {
  const sid = String(sessionId || "global").trim() || "global";
  const uid = String(userId || "anon").trim().toLowerCase() || "anon";
  return `${TASK_TIMER_STORAGE_PREFIX}:${sid}:${uid}`;
}

function makeTaskTimerId(ownerUserId: unknown, text: unknown, fallbackId?: unknown) {
  const owner = String(ownerUserId || "")
    .trim()
    .toLowerCase();
  const normalizedText = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const textKey = normalizedText ? encodeURIComponent(normalizedText).slice(0, 240) : "";
  const fallback = String(fallbackId || "")
    .trim()
    .toLowerCase();
  return `${owner || "unknown"}:${textKey || `id:${fallback || "unknown"}`}`;
}

function sanitizeTaskTimerState(raw: unknown): TaskTimerState {
  const value = raw && typeof raw === "object" ? (raw as any) : {};
  const elapsed = Math.max(0, Math.round(Number(value.elapsed_ms || 0)));
  const runningSinceRaw = Number(value.running_since_ms || 0);
  const runningSince = Number.isFinite(runningSinceRaw) && runningSinceRaw > 0 ? runningSinceRaw : null;

  return {
    elapsed_ms: elapsed,
    running_since_ms: runningSince,
    updated_at: typeof value.updated_at === "string" ? value.updated_at : undefined,
  };
}

function readTaskTimers(storageKey: string): TaskTimerMap {
  if (!storageKey || typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const out: TaskTimerMap = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
      if (!key) return;
      out[key] = sanitizeTaskTimerState(value);
    });

    return out;
  } catch {
    return {};
  }
}

function writeTaskTimers(storageKey: string, timers: TaskTimerMap) {
  if (!storageKey || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(timers || {}));
  } catch { }
}

function getTaskTimerDisplayMs(timer: TaskTimerState | null | undefined, nowMs: number) {
  if (!timer) return 0;

  const base = Math.max(0, Math.round(Number(timer.elapsed_ms || 0)));
  const runningSince = Number(timer.running_since_ms || 0);

  if (!runningSince || !Number.isFinite(runningSince)) return base;

  return Math.max(0, base + Math.max(0, nowMs - runningSince));
}

function formatTaskTimer(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function isTaskTimerRunning(timer: TaskTimerState | null | undefined) {
  return !!timer?.running_since_ms;
}

function getTilePersonKey(tile: TileModel) {
  const userId = String(tile.participantUserId || "")
    .trim()
    .toLowerCase();
  if (userId) return userId;

  const identityBase = extractBaseUserIdFromIdentity(
    String(tile.participantIdentity || ""),
  )
    .trim()
    .toLowerCase();
  if (identityBase) return identityBase;

  return String(tile.id || "").trim().toLowerCase();
}

function AccountabilityWall({
  sessionId,
  tiles,
  profilesById,
  authUserId,
  theme,
  isLight,
  onOpenTasks,
  onSwitchBackToVideo,
}: {
  sessionId?: string | null;
  tiles: TileModel[];
  profilesById: Record<string, HostProfile>;
  authUserId?: string | null;
  theme: RoomTheme;
  isLight: boolean;
  onOpenTasks: () => void;
  onSwitchBackToVideo: () => void;
}) {
  const [wallTasks, setWallTasks] = useState<AccountabilityWallTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [newWallTask, setNewWallTask] = useState("");
  const [wallTaskBusy, setWallTaskBusy] = useState<string | null>(null);
  const localTasksSyncTimerRef = useRef<number | null>(null);


  const taskTimerStorageKey = useMemo(
    () => makeTaskTimerStorageKey(sessionId || "global", authUserId || ""),
    [authUserId, sessionId],
  );
  const [taskTimers, setTaskTimers] = useState<TaskTimerMap>({});
  const [taskTimerTickMs, setTaskTimerTickMs] = useState(() => Date.now());
  const [taskTimersEnabled, setTaskTimersEnabled] = useState(false);

  const taskTimerEnabledStorageKey = useMemo(
    () => `${TASK_TIMER_ENABLED_STORAGE_PREFIX}:${String(authUserId || "anonymous")}`,
    [authUserId],
  );

  useEffect(() => {
    const refreshVisibility = () => {
      try {
        setTaskTimersEnabled(
          window.localStorage.getItem(taskTimerEnabledStorageKey) === "true",
        );
      } catch {
        setTaskTimersEnabled(false);
      }
    };

    const onVisibilityChanged = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      const eventUserId = String(detail?.userId || "").trim().toLowerCase();
      const currentUserId = String(authUserId || "").trim().toLowerCase();
      if (eventUserId && currentUserId && eventUserId !== currentUserId) return;
      setTaskTimersEnabled(detail?.enabled === true);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === taskTimerEnabledStorageKey) refreshVisibility();
    };

    refreshVisibility();
    window.addEventListener(
      TASK_TIMER_VISIBILITY_EVENT,
      onVisibilityChanged as EventListener,
    );
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(
        TASK_TIMER_VISIBILITY_EVENT,
        onVisibilityChanged as EventListener,
      );
      window.removeEventListener("storage", onStorage);
    };
  }, [authUserId, taskTimerEnabledStorageKey]);

  useEffect(() => {
    setTaskTimers(readTaskTimers(taskTimerStorageKey));
  }, [taskTimerStorageKey]);

  useEffect(() => {
    const refresh = () => setTaskTimers(readTaskTimers(taskTimerStorageKey));

    const onTimerEvent = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      if (!detail?.storageKey || detail.storageKey === taskTimerStorageKey) refresh();
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === taskTimerStorageKey) refresh();
    };

    window.addEventListener(TASK_TIMER_EVENT, onTimerEvent as EventListener);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(TASK_TIMER_EVENT, onTimerEvent as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, [taskTimerStorageKey]);

  useEffect(() => {
    const id = window.setInterval(() => setTaskTimerTickMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const persistTaskTimers = useCallback(
    (next: TaskTimerMap) => {
      setTaskTimers(next);
      writeTaskTimers(taskTimerStorageKey, next);
      try {
        window.dispatchEvent(
          new CustomEvent(TASK_TIMER_EVENT, {
            detail: { storageKey: taskTimerStorageKey, sessionId, userId: authUserId || "" },
          }),
        );
      } catch { }
    },
    [authUserId, sessionId, taskTimerStorageKey],
  );

  const updateTaskTimer = useCallback(
    (timerId: string, updater: (prev: TaskTimerState | null) => TaskTimerState | null) => {
      if (!timerId) return;

      const prevMap = readTaskTimers(taskTimerStorageKey);
      const nextValue = updater(prevMap[timerId] || null);
      const nextMap = { ...prevMap };

      if (nextValue) nextMap[timerId] = nextValue;
      else delete nextMap[timerId];

      persistTaskTimers(nextMap);
    },
    [persistTaskTimers, taskTimerStorageKey],
  );

  const toggleTaskTimer = useCallback(
    (item: AccountabilityWallTask) => {
      const uid = String(authUserId || "").trim();
      if (!uid || String(item.user_id || "").trim().toLowerCase() !== uid.toLowerCase()) return;

      const timerId = makeTaskTimerId(item.user_id, item.text, item.id);
      const now = Date.now();

      updateTaskTimer(timerId, (prev) => {
        const safePrev = sanitizeTaskTimerState(prev || {});

        if (safePrev.running_since_ms) {
          return {
            elapsed_ms: getTaskTimerDisplayMs(safePrev, now),
            running_since_ms: null,
            updated_at: new Date(now).toISOString(),
          };
        }

        return {
          elapsed_ms: safePrev.elapsed_ms,
          running_since_ms: now,
          updated_at: new Date(now).toISOString(),
        };
      });
    },
    [authUserId, updateTaskTimer],
  );

  const pauseTaskTimer = useCallback(
    (item: AccountabilityWallTask) => {
      const timerId = makeTaskTimerId(item.user_id, item.text, item.id);
      const now = Date.now();

      updateTaskTimer(timerId, (prev) => {
        const safePrev = sanitizeTaskTimerState(prev || {});
        if (!safePrev.running_since_ms) return safePrev.elapsed_ms > 0 ? safePrev : null;
        return {
          elapsed_ms: getTaskTimerDisplayMs(safePrev, now),
          running_since_ms: null,
          updated_at: new Date(now).toISOString(),
        };
      });
    },
    [updateTaskTimer],
  );

  const resetTaskTimer = useCallback(
    (item: AccountabilityWallTask) => {
      const uid = String(authUserId || "").trim();
      if (!uid || String(item.user_id || "").trim().toLowerCase() !== uid.toLowerCase()) return;
      const timerId = makeTaskTimerId(item.user_id, item.text, item.id);
      updateTaskTimer(timerId, () => null);
    },
    [authUserId, updateTaskTimer],
  );

  const loadTasks = useCallback(async () => {
    const sid = String(sessionId || "").trim();
    if (!sid) {
      setWallTasks([]);
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase
        .from("intentions")
        .select("id,text,user_id,session_id,created_at,completed")
        .eq("session_id", sid)
        .order("created_at", { ascending: false })
        .limit(160);

      if (error || !Array.isArray(data)) {
        setWallTasks([]);
        return;
      }

      const rows = data as AccountabilityWallTask[];
      const userIds = Array.from(
        new Set(rows.map((r) => String(r.user_id || "").trim()).filter(Boolean)),
      );

      let profileMap = new Map<string, HostProfile>();
      if (userIds.length) {
        try {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id,full_name,avatar_url,bio")
            .in("id", userIds);

          if (Array.isArray(profiles)) {
            profileMap = new Map(
              profiles.map((p: any) => [String(p.id || "").toLowerCase(), p as HostProfile]),
            );
          }
        } catch {
          // best effort only
        }
      }

      setWallTasks(
        rows.map((row) => ({
          ...row,
          profiles: profileMap.get(String(row.user_id || "").toLowerCase()) || null,
        })),
      );
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    const sid = String(sessionId || "").trim();
    if (!sid) return;

    const ch = supabase
      .channel(`accountability-wall-intentions:${sid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "intentions", filter: `session_id=eq.${sid}` },
        () => void loadTasks(),
      )
      .subscribe();

    return () => {
      safeRemoveRealtimeChannel(ch);
    };
  }, [sessionId, loadTasks]);

  useEffect(() => {
    const sid = String(sessionId || "").trim();
    if (!sid) return;

    const refreshFromTasksPanel = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      const eventSessionId = String(detail?.sessionId || "").trim();

      if (eventSessionId && eventSessionId !== sid) return;

      if (localTasksSyncTimerRef.current) {
        window.clearTimeout(localTasksSyncTimerRef.current);
      }

      localTasksSyncTimerRef.current = window.setTimeout(() => {
        localTasksSyncTimerRef.current = null;
        void loadTasks();
      }, 40);
    };

    window.addEventListener(
      TASKS_SYNC_EVENT,
      refreshFromTasksPanel as EventListener,
    );
    window.addEventListener(
      "mysession:tasks-updated",
      refreshFromTasksPanel as EventListener,
    );

    return () => {
      if (localTasksSyncTimerRef.current) {
        window.clearTimeout(localTasksSyncTimerRef.current);
        localTasksSyncTimerRef.current = null;
      }

      window.removeEventListener(
        TASKS_SYNC_EVENT,
        refreshFromTasksPanel as EventListener,
      );
      window.removeEventListener(
        "mysession:tasks-updated",
        refreshFromTasksPanel as EventListener,
      );
    };
  }, [sessionId, loadTasks]);

  const participantTiles = useMemo(() => {
    const out: TileModel[] = [];
    const seen = new Set<string>();

    for (const tile of tiles || []) {
      if (tile.kind === "screen") continue;
      const key = getTilePersonKey(tile);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(tile);
    }

    return out;
  }, [tiles]);

  const tasksByUserId = useMemo(() => {
    const map = new Map<string, AccountabilityWallTask[]>();

    for (const item of wallTasks || []) {
      const userId = String(item.user_id || "").trim().toLowerCase();
      if (!userId) continue;
      const list = map.get(userId) || [];
      list.push(item);
      map.set(userId, list);
    }

    return map;
  }, [wallTasks]);

  const cardBg = isLight
    ? "border-[#D8D0D0] bg-[#F7F5F5] text-black"
    : "border-[#2B2B2B] bg-[#1B1B1B] text-white";
  const mutedText = isLight ? "text-black/55" : "text-white/55";
  const taskIconSrc = isLight
    ? "/icons/tasks-light.svg"
    : "/icons/tasks-dark.svg";

  const syncOwnWallTaskToPanelTasks = async (args: {
    userId: string;
    text: string;
    completed?: boolean;
  }) => {
    const userId = String(args.userId || "").trim();
    const text = String(args.text || "").trim();
    if (!userId || !text) return;

    try {
      const { data: existingRows } = await supabase
        .from("panel_intentions")
        .select("id,text,user_id,completed,visibility")
        .eq("user_id", userId)
        .ilike("text", text)
        .limit(1);

      const existing = Array.isArray(existingRows) ? existingRows[0] : null;
      if (existing?.id) {
        await supabase
          .from("panel_intentions")
          .update({
            completed: typeof args.completed === "boolean" ? args.completed : Boolean(existing.completed),
            visibility: "public",
          } as any)
          .eq("id", existing.id)
          .eq("user_id", userId);
        return;
      }

      await supabase.from("panel_intentions").insert({
        user_id: userId,
        text,
        completed: typeof args.completed === "boolean" ? args.completed : false,
        visibility: "public",
      } as any);
    } catch (e) {
      console.warn("syncOwnWallTaskToPanelTasks failed:", e);
    }
  };

  const addOwnWallTask = async () => {
    const uid = String(authUserId || "").trim();
    const sid = String(sessionId || "").trim();
    const text = String(newWallTask || "").trim();

    if (!uid || !sid || !text || wallTaskBusy) return;

    const optimisticId = `wall-optimistic-${Date.now()}`;
    const optimistic: AccountabilityWallTask = {
      id: optimisticId,
      text,
      user_id: uid,
      session_id: sid,
      created_at: new Date().toISOString(),
      completed: false,
      profiles: null,
    };

    setWallTaskBusy("add");
    setNewWallTask("");
    setWallTasks((prev) => [optimistic, ...prev].slice(0, 160));

    try {
      const { data, error } = await supabase
        .from("intentions")
        .insert({
          user_id: uid,
          session_id: sid,
          text,
          completed: false,
        })
        .select("id,text,user_id,session_id,created_at,completed")
        .single();

      if (error || !data) throw error || new Error("No task returned");

      setWallTasks((prev) =>
        [data as AccountabilityWallTask, ...prev.filter((x) => x.id !== optimisticId)].slice(0, 160),
      );

      void syncOwnWallTaskToPanelTasks({
        userId: uid,
        text,
        completed: false,
      });

      emitRoomTasksSync({
        action: "insert",
        sessionId: sid,
        userId: uid,
        taskId: String((data as any)?.id || ""),
      });
    } catch (e) {
      console.warn("addOwnWallTask failed:", e);
      setWallTasks((prev) => prev.filter((x) => x.id !== optimisticId));
      void loadTasks();
    } finally {
      setWallTaskBusy(null);
    }
  };

  const toggleOwnWallTask = async (item: AccountabilityWallTask) => {
    const uid = String(authUserId || "").trim();
    const sid = String(sessionId || "").trim();
    if (!uid || !sid || String(item.user_id || "").trim().toLowerCase() !== uid.toLowerCase() || wallTaskBusy) return;

    const nextCompleted = !Boolean(item.completed);
    setWallTaskBusy(item.id);
    setWallTasks((prev) =>
      prev.map((x) => (x.id === item.id ? { ...x, completed: nextCompleted } : x)),
    );

    try {
      const { error } = await supabase
        .from("intentions")
        .update({ completed: nextCompleted })
        .eq("id", item.id)
        .eq("user_id", uid)
        .eq("session_id", sid);

      if (error) throw error;

      if (nextCompleted) {
        pauseTaskTimer(item);
      }

      void syncOwnWallTaskToPanelTasks({
        userId: uid,
        text: item.text,
        completed: nextCompleted,
      });

      emitRoomTasksSync({
        action: "update",
        sessionId: sid,
        userId: uid,
        taskId: item.id,
      });
    } catch (e) {
      console.warn("toggleOwnWallTask failed:", e);
      void loadTasks();
    } finally {
      setWallTaskBusy(null);
    }
  };

  return (
    <div className="h-full w-full min-h-0 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className={`font-inter text-[15px] font-bold ${isLight ? "text-black/85" : "text-white/90"}`}>
            Accountability Wall
          </div>
          <div className={`mt-1 font-inter text-[14px] font-normal ${mutedText}`}>
            Everyone’s current tasks, visible while you work.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenTasks}
            className={[
              "inline-flex h-9 items-center justify-center rounded-2xl px-3 font-inter text-[12px] font-normal leading-none transition",
              isLight
                ? "bg-[#242424] text-white hover:bg-[#303030]"
                : "bg-[#81DB86] text-black hover:brightness-95",
            ].join(" ")}
          >
            Add / edit tasks
          </button>

          <button
            type="button"
            onClick={onSwitchBackToVideo}
            className={[
              "inline-flex h-9 items-center justify-center gap-1.5 rounded-2xl border px-3 font-inter text-[12px] font-normal leading-none transition",
              isLight
                ? "border-[#CFC6C6] bg-[#F7F5F5] text-black/70 hover:bg-[#ECEAEA]"
                : "border-[#2B2B2B] bg-[#242424] text-white/80 hover:bg-white/[0.06]",
            ].join(" ")}
            title="Switch back to videos"
          >
            <img
              src={isLight ? "/icons/pip-intentions-light.svg" : "/icons/pip-intentions-dark.svg"}
              alt=""
              className="h-3.5 w-3.5 opacity-85"
              draggable={false}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <span>Switch back to videos</span>
          </button>
        </div>
      </div>

      {participantTiles.length === 0 ? (
        <div
          className={[
            "flex min-h-[260px] items-center justify-center rounded-[28px] border text-[14px]",
            cardBg,
          ].join(" ")}
        >
          No participants yet
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {participantTiles.map((tile) => {
            const userId = getTilePersonKey(tile);
            const profile =
              profilesById[userId] ||
              profilesById[String(tile.participantIdentity || "").toLowerCase()] ||
              null;
            const name =
              String(tile.metadataDisplayName || profile?.full_name || tile.label || "Participant").trim() ||
              "Participant";
            const avatarUrl = String(profile?.avatar_url || "").trim();
            const userTasks = (tasksByUserId.get(userId) || []).slice(0, 4);
            const activeCount = userTasks.filter((x) => !x.completed).length;
            const completedCount = userTasks.filter((x) => !!x.completed).length;
            const isLocalCard = String(userId).toLowerCase() === String(authUserId || "").toLowerCase();

            return (
              <div
                key={`accountability-${tile.id}`}
                className={[
                  "min-h-[220px] rounded-[28px] border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg",
                  cardBg,
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-2xl object-cover"
                      />
                    ) : (
                      <div
                        className={[
                          "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-[16px] font-black",
                          isLight ? "bg-black/5 text-black/75" : "bg-white/10 text-white/85",
                        ].join(" ")}
                      >
                        {getInitials(name)}
                      </div>
                    )}

                    <div className="min-w-0">
                      <div className="truncate font-inter text-[15px] font-bold leading-tight">
                        {name}
                      </div>
                      <div className={`mt-1 flex items-center gap-1 text-[12px] ${mutedText}`}>
                        <span>
                          {tile.status ? getStatusLabel(tile.status) || tile.status : tile.isLocal ? "You" : "In room"}
                        </span>
                        {tile.isLocal && tile.status === "skip_deafened" ? (
                          <SkipMeMutedStatusIcon theme={theme} className="h-3 w-3 shrink-0" />
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div
                    className={[
                      "shrink-0 rounded-2xl border px-2.5 py-1 font-inter text-[11px] font-medium",
                      activeCount > 0
                        ? "border-[#81DB86]/55 bg-[#81DB86]/10 text-[#2FA84F]"
                        : isLight
                          ? "border-black/10 bg-black/5 text-black/45"
                          : "border-white/10 bg-white/10 text-white/45",
                    ].join(" ")}
                  >
                    {activeCount > 0 ? `${activeCount} active` : completedCount > 0 ? "Done" : "No task"}
                  </div>
                </div>

                <div className="mt-5 space-y-2">
                  {isLocalCard ? (
                    <div className="mb-3 flex items-center gap-2">
                      <input
                        type="text"
                        value={newWallTask}
                        onChange={(e) => setNewWallTask(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void addOwnWallTask();
                        }}
                        placeholder="Add a task"
                        className={[
                          "h-11 min-w-0 flex-1 rounded-2xl border px-3 font-inter text-[13px] outline-none transition",
                          isLight
                            ? "border-[#CFC6C6] bg-[#F7F5F5] text-black/85 placeholder:text-black/35 focus:border-[#81DB86] focus:ring-1 focus:ring-[#81DB86]"
                            : "border-white/10 bg-white/[0.05] text-white/90 placeholder:text-white/35 focus:border-[#81DB86]/70 focus:ring-1 focus:ring-[#81DB86]/50",
                        ].join(" ")}
                      />
                      <button
                        type="button"
                        onClick={() => void addOwnWallTask()}
                        disabled={!newWallTask.trim() || !!wallTaskBusy}
                        className="h-11 rounded-2xl bg-[#81DB86] px-4 font-inter text-[13px] font-bold text-black transition hover:brightness-95 disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
                  ) : null}

                  {loading && !userTasks.length ? (
                    <div className={`rounded-2xl border border-dashed px-4 py-3 font-inter text-[13px] ${mutedText}`}>
                      Loading tasks…
                    </div>
                  ) : userTasks.length ? (
                    userTasks.map((item) => {
                      const timerId = makeTaskTimerId(item.user_id, item.text, item.id);
                      const timer = taskTimers[timerId] || null;
                      const elapsedMs = getTaskTimerDisplayMs(timer, taskTimerTickMs);
                      const timerRunning = isTaskTimerRunning(timer);
                      const shouldShowTimer =
                        taskTimersEnabled && (isLocalCard || elapsedMs > 0);

                      return (
                        <div
                          key={item.id}
                          className={[
                            "flex items-start gap-2 rounded-2xl border px-3 py-3 font-inter text-[14px] font-normal leading-5",
                            item.completed
                              ? isLight
                                ? "border-black/10 bg-black/[0.02] text-black/35"
                                : "border-white/10 bg-white/[0.04] text-white/35"
                              : isLight
                                ? "border-[#CFC6C6] bg-white text-black/85"
                                : "border-white/10 bg-white/[0.06] text-white/90",
                          ].join(" ")}
                        >
                          <button
                            type="button"
                            onClick={() => void toggleOwnWallTask(item)}
                            disabled={!isLocalCard || !!wallTaskBusy}
                            className={[
                              "mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border transition",
                              isLocalCard ? "pointer-events-auto" : "pointer-events-none",
                              item.completed
                                ? "border-[#81DB86]/70 bg-[#81DB86]/15"
                                : isLight
                                  ? "border-black/15 bg-black/[0.02]"
                                  : "border-white/15 bg-white/[0.04]",
                            ].join(" ")}
                            title={isLocalCard ? "Toggle task" : "Task"}
                          >
                            {item.completed ? (
                              <span className="text-[11px] leading-none text-[#2FA84F]">✓</span>
                            ) : (
                              <img src={taskIconSrc} alt="" className="h-3.5 w-3.5 opacity-55" draggable={false} />
                            )}
                          </button>

                          <div className="min-w-0 flex-1">
                            <div className={item.completed ? "line-through" : ""}>{item.text}</div>

                            {shouldShowTimer ? (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <div
                                  className={[
                                    "inline-flex h-7 items-center rounded-full border px-2.5 text-[11px] font-bold tabular-nums",
                                    timerRunning
                                      ? "border-[#81DB86] bg-[#81DB86]/15 text-[#248A3D]"
                                      : isLight
                                        ? "border-[#CFC6C6] bg-[#F7F5F5] text-black/60"
                                        : "border-white/10 bg-white/[0.05] text-white/65",
                                  ].join(" ")}
                                  title="Time spent on this task"
                                >
                                  {formatTaskTimer(elapsedMs)}
                                </div>

                                {isLocalCard ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleTaskTimer(item);
                                      }}
                                      className={[
                                        "h-7 rounded-full border px-2 text-[11px] font-bold transition",
                                        timerRunning
                                          ? "border-[#F65252]/50 bg-[#F65252]/10 text-[#C73535] hover:bg-[#F65252]/15"
                                          : "border-[#81DB86] bg-[#81DB86]/15 text-[#248A3D] hover:bg-[#81DB86]/25",
                                      ].join(" ")}
                                      title={timerRunning ? "Pause timer" : "Start timer"}
                                    >
                                      {timerRunning ? "Pause" : "Start"}
                                    </button>

                                    {elapsedMs > 0 ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          resetTaskTimer(item);
                                        }}
                                        className={[
                                          "h-7 rounded-full border px-2 text-[11px] font-bold transition",
                                          isLight
                                            ? "border-[#CFC6C6] bg-[#F7F5F5] text-black/55 hover:bg-[#ECEAEA]"
                                            : "border-white/10 bg-white/[0.04] text-white/55 hover:bg-white/[0.08]",
                                        ].join(" ")}
                                        title="Reset timer"
                                      >
                                        Reset
                                      </button>
                                    ) : null}
                                  </>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <button
                      type="button"
                      onClick={isLocalCard ? undefined : onOpenTasks}
                      className={[
                        "w-full rounded-2xl border border-dashed px-4 py-4 text-left font-inter text-[14px] font-normal transition",
                        isLight
                          ? "border-black/15 text-black/45 hover:bg-black/[0.03]"
                          : "border-white/15 text-white/45 hover:bg-white/[0.05]",
                      ].join(" ")}
                    >
                      No task yet{isLocalCard ? " — add yours above" : ""}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type RoomPageLiveKitProps = {
  /**
   * Lets pretty public URLs like /yaroslav render the real room without
   * changing the browser address to /room-livekit/:id.
   */
  sessionIdOverride?: string | null;
};

export function RoomPageLiveKit({
  sessionIdOverride = null,
}: RoomPageLiveKitProps = {}) {
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const roomDebugEnabled = useMemo(() => {
    const queryEnabled =
      new URLSearchParams(location.search).get("roomDebug") === "1";
    return Boolean(import.meta.env.DEV) || queryEnabled;
  }, [location.search]);
  const roomLifecycleAttemptIdRef = useRef(createRoomLifecycleAttemptId());
  const roomLifecycleDiagnosticRef = useRef<
    (eventType: string, payload?: Record<string, unknown>) => void
  >((eventType, payload = {}) => {
    pushConnectionDiagnosticToLocalBuffer({
      at: new Date().toISOString(),
      attempt_id: roomLifecycleAttemptIdRef.current,
      event_type: eventType,
      payload,
    });
  });

  const effectiveSessionParam = useMemo(
    () => String(sessionIdOverride || routeId || "").trim(),
    [sessionIdOverride, routeId],
  );

  const [entitlementState, setEntitlementState] =
    useState<EntitlementState | null>(null);
  const [entitlementCheckedForUserId, setEntitlementCheckedForUserId] =
    useState<string | null>(null);
  const [paywallModalOpen, setPaywallModalOpen] = useState(false);
  const [aiHostInputOpen, setAiHostInputOpen] = useState(true);
  const [videoTileLayoutPreset, setVideoTileLayoutPreset] =
    useState<VideoTileLayoutPreset>(() => {
      if (typeof window === "undefined") return "one";
      return normalizeVideoTileLayoutPreset(
        window.localStorage.getItem(VIDEO_TILE_LAYOUT_PRESET_KEY) ||
        window.localStorage.getItem("mysession_mobile_video_layout_mode"),
      );
    });
  const [showMobileLayoutSwitcher, setShowMobileLayoutSwitcher] = useState(
    () => {
      try {
        return localStorage.getItem(MOBILE_LAYOUT_SWITCHER_VISIBLE_KEY) !== "0";
      } catch {
        return true;
      }
    },
  );
  const updateShowMobileLayoutSwitcher = useCallback((next: boolean) => {
    setShowMobileLayoutSwitcher(next);

    try {
      localStorage.setItem(
        MOBILE_LAYOUT_SWITCHER_VISIBLE_KEY,
        next ? "1" : "0",
      );
    } catch {
      // ignore
    }
  }, []);
  const [videoTileLayoutColumns, setVideoTileLayoutColumns] = useState<number>(
    () => readStoredLayoutNumber(VIDEO_TILE_LAYOUT_COLUMNS_KEY),
  );
  const [videoTileLayoutRows, setVideoTileLayoutRows] = useState<number>(() =>
    readStoredLayoutNumber(VIDEO_TILE_LAYOUT_ROWS_KEY),
  );

  const mobileVideoLayoutMode = videoTileLayoutPreset as MobileVideoLayoutMode;

  useEffect(() => {
    try {
      window.localStorage.setItem(
        VIDEO_TILE_LAYOUT_PRESET_KEY,
        videoTileLayoutPreset,
      );
      window.localStorage.setItem(
        "mysession_mobile_video_layout_mode",
        videoTileLayoutPreset,
      );
      window.localStorage.setItem(
        VIDEO_TILE_LAYOUT_COLUMNS_KEY,
        String(videoTileLayoutColumns || 0),
      );
      window.localStorage.setItem(
        VIDEO_TILE_LAYOUT_ROWS_KEY,
        String(videoTileLayoutRows || 0),
      );
    } catch {
      // ignore
    }
  }, [videoTileLayoutPreset, videoTileLayoutColumns, videoTileLayoutRows]);

  const tabId = useMemo(() => makeLiveKitPageTabId(), []);
  const devClones = useMemo(
    () => Math.max(0, Math.min(24, getQueryInt("devClones", 0))),
    [],
  );
  const paywallDecision = useMemo(() => {
    if (!entitlementState) return null;

    return getPaywallDecision({
      entitlement: entitlementState.entitlement,
      usage: entitlementState.usage,
      lifetimeSessionsCount: entitlementState.lifetimeSessionsCount,
    });
  }, [entitlementState]);

  const forcePaywall = isPersonalPaywallForced(entitlementState);

  const paywallBlocked = !!paywallDecision?.blocked;

  const paywallRuntimeBlocked = forcePaywall
    ? true
    : paywallBlocked;

  // theme
  const [theme, setTheme] = useState<RoomTheme>(() => {
    try {
      const v = String(localStorage.getItem("room_theme") || "").toLowerCase();
      return v === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  const isLight = theme === "light";

  useEffect(() => {
    try {
      localStorage.setItem("room_theme", theme);
    } catch { }
  }, [theme]);

  useEffect(() => {
    try {
      const root = document.documentElement;
      const body = document.body;

      const prevRootDark = root.classList.contains("dark");
      const prevBodyDark = body.classList.contains("dark");
      const prevRootTheme = root.getAttribute("data-theme");
      const prevBodyTheme = body.getAttribute("data-theme");
      const prevRootColorScheme = (root.style as any).colorScheme;
      const prevBodyColorScheme = (body.style as any).colorScheme;

      const isDark = theme === "dark";

      root.classList.toggle("dark", isDark);
      body.classList.toggle("dark", isDark);

      root.setAttribute("data-theme", theme);
      body.setAttribute("data-theme", theme);

      (root.style as any).colorScheme = theme;
      (body.style as any).colorScheme = theme;

      return () => {
        root.classList.toggle("dark", prevRootDark);
        body.classList.toggle("dark", prevBodyDark);

        if (prevRootTheme === null) root.removeAttribute("data-theme");
        else root.setAttribute("data-theme", prevRootTheme);

        if (prevBodyTheme === null) body.removeAttribute("data-theme");
        else body.setAttribute("data-theme", prevBodyTheme);

        (root.style as any).colorScheme = prevRootColorScheme || "";
        (body.style as any).colorScheme = prevBodyColorScheme || "";
      };
    } catch {
      return;
    }
  }, [theme]);

  const [isLgUp, setIsLgUp] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return true;
    return window.matchMedia("(min-width: 1024px)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsLgUp(!!mql.matches);
    try {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    } catch {
      // @ts-ignore
      mql.addListener(onChange);
      // @ts-ignore
      return () => mql.removeListener(onChange);
    }
  }, []);

  const [isMobileQuery, setIsMobileQuery] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(max-width: 767px)").matches;
  });
  const [isTabletQuery, setIsTabletQuery] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(min-width: 768px) and (max-width: 1023px)")
      .matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const m1 = window.matchMedia("(max-width: 767px)");
    const m2 = window.matchMedia("(min-width: 768px) and (max-width: 1023px)");
    const on1 = () => setIsMobileQuery(!!m1.matches);
    const on2 = () => setIsTabletQuery(!!m2.matches);
    on1();
    on2();
    try {
      m1.addEventListener("change", on1);
      m2.addEventListener("change", on2);
      return () => {
        m1.removeEventListener("change", on1);
        m2.removeEventListener("change", on2);
      };
    } catch {
      // @ts-ignore
      m1.addListener(on1);
      // @ts-ignore
      m2.addListener(on2);
      // @ts-ignore
      return () => {
        // @ts-ignore
        m1.removeListener(on1);
        // @ts-ignore
        m2.removeListener(on2);
      };
    }
  }, []);

  // session
  const [session, setSession] = useState<SessionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionLoadError, setSessionLoadError] = useState<string>("");

  const [joinGateBookingBusy, setJoinGateBookingBusy] = useState(false);
  const [joinGateBooked, setJoinGateBooked] = useState(false);

  // auth + profile
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;

    if (!authUserId) {
      setEntitlementState(null);
      setEntitlementCheckedForUserId(null);
      return () => {
        cancelled = true;
      };
    }

    setEntitlementCheckedForUserId(null);

    void withTimeout(
      loadEntitlementState(),
      8_000,
      "Access check timed out. Continuing with safe defaults.",
    )
      .then((state) => {
        if (!cancelled) setEntitlementState(state);
      })
      .catch((e) => {
        console.error("[RoomPageLiveKit] entitlement load failed:", e);
        if (!cancelled) setEntitlementState(null);
      })
      .finally(() => {
        if (!cancelled) setEntitlementCheckedForUserId(authUserId);
      });

    return () => {
      cancelled = true;
    };
  }, [authUserId]);

  useEffect(() => {
    const booked =
      !!authUserId &&
      !!(session as any)?.session_bookings?.some(
        (b: any) => String(b?.user_id || "") === String(authUserId),
      );

    setJoinGateBooked(booked);
  }, [(session as any)?.session_bookings, authUserId]);
  const [authReady, setAuthReady] = useState(false);
  const [activeBan, setActiveBan] = useState<ActiveBan | null>(null);
  const [banLoading, setBanLoading] = useState(false);
  const [authGateStatus, setAuthGateStatus] = useState<
    "checking" | "authed" | "guest"
  >("checking");
  const [userName, setUserName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const localRoomDisplayNameOverrideRef = useRef<string>("");
  const [localRoomDisplayNameVersion, setLocalRoomDisplayNameVersion] =
    useState(0);
  const applyRoomDisplayNameLocally = (nextRaw: string) => {
    const next = String(nextRaw || "").trim();
    if (!next) return;

    // 1) локальный source of truth для local tile
    localRoomDisplayNameOverrideRef.current = next;
    setLocalRoomDisplayNameVersion((v) => v + 1);

    // 2) основной state
    setDisplayName(next);

    // 3) prejoin state
    setPrejoin((prev) => ({
      ...prev,
      displayName: next,
    }));

    // 4) prejoin ref
    prejoinRef.current = {
      ...prejoinRef.current,
      displayName: next,
    };
  };

  const setMyStatus = async (status: string | null) => {
    const room = roomRef.current;
    const me = room?.localParticipant;
    if (!me) return;

    let currentMeta = {};
    try {
      currentMeta = JSON.parse(me.metadata || "{}");
    } catch { }

    const nextMeta = {
      ...currentMeta,
      status, // 👈 ВОТ ЭТО
    };

    const wasSelfDeafened =
      String((currentMeta as { status?: unknown })?.status || "") ===
      "skip_deafened";
    const shouldSelfDeafen = status === "skip_deafened";

    // Apply locally before the metadata round-trip. Disabling the remote
    // publications is persistent, unlike a one-off setVolume(0), which can be
    // overwritten by the participant-volume refresh path.
    applySelfDeafenToRoom(room, shouldSelfDeafen);
    setSelfDeafened(shouldSelfDeafen);

    try {
      await me.setMetadata(JSON.stringify(nextMeta));
    } catch (e) {
      applySelfDeafenToRoom(room, wasSelfDeafened);
      setSelfDeafened(wasSelfDeafened);
      console.error("setMetadata failed", e);
    }
  };

  const [localAvatarUrl, setLocalAvatarUrl] = useState<string>("");
  const accessTokenRef = useRef<string>("");
  const currentAuthUserIdRef = useRef<string | null>(null);
  const sessionJoinStartedAtRef = useRef<number | null>(null);
  const usageTrackedRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const applyAuthSession = (event: string, session: any) => {
      if (!mounted) return;

      const nextAccessToken = String(session?.access_token || "").trim();
      const nextUserId = String(session?.user?.id || "").trim();

      accessTokenRef.current = nextAccessToken;

      if (nextUserId) {
        const sameUser = currentAuthUserIdRef.current === nextUserId;

        currentAuthUserIdRef.current = nextUserId;

        // Token refresh must NOT behave like a room auth transition.
        // It should update accessTokenRef only, without retriggering room/session/join state.
        if (
          sameUser &&
          (event === "TOKEN_REFRESHED" ||
            event === "USER_UPDATED" ||
            event === "INITIAL_SESSION")
        ) {
          setAuthReady((prev) => (prev ? prev : true));
          return;
        }

        setAuthUserId((prev) => (prev === nextUserId ? prev : nextUserId));
        setAuthGateStatus((prev) => (prev === "authed" ? prev : "authed"));
        setAuthReady((prev) => (prev ? prev : true));
        return;
      }

      if (event === "SIGNED_OUT") {
        currentAuthUserIdRef.current = null;
        accessTokenRef.current = "";

        setAuthUserId((prev) => (prev === null ? prev : null));
        setAuthGateStatus((prev) => (prev === "guest" ? prev : "guest"));
        setAuthReady((prev) => (prev ? prev : true));
        return;
      }

      setAuthReady((prev) => (prev ? prev : true));
    };

    void withTimeout(
      supabase.auth.getSession(),
      8_000,
      "Room authentication check timed out.",
    )
      .then(({ data, error }) => {
        if (error) throw error;
        applyAuthSession("INITIAL_SESSION", data?.session || null);
      })
      .catch((error) => {
        console.warn("[room-auth] session restore failed; continuing as guest", error);
        applyAuthSession("INITIAL_SESSION", null);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      applyAuthSession(event, session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const [selectedUser, setSelectedUser] = useState<HostProfile | null>(null);
  const [tileMenuAnchor, setTileMenuAnchor] = useState<{
    tileId: string;
    x: number;
    y: number;
    viewportWidth: number;
    viewportHeight: number;
    portalDocument: Document | null;
    tileElement: HTMLElement | null;
  } | null>(null);
  const [openTileAdminMenuId, setOpenTileAdminMenuId] = useState<string | null>(
    null,
  );
  const [screenSharePinned, setScreenSharePinned] = useState(false);
  const [pinnedScreenShareTileId, setPinnedScreenShareTileId] = useState<
    string | null
  >(null);
  const [timelineEditorOpen, setTimelineEditorOpen] = useState(false);
  const [timelineDraftBlocks, setTimelineDraftBlocks] = useState<
    RoomTimelineBlock[]
  >([]);
  const [timelineSaving, setTimelineSaving] = useState(false);
  const [freeFlowIntroOpen, setFreeFlowIntroOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<TileModel | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState("");
  const [editNameOpen, setEditNameOpen] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");

  // LiveKit env + token routing state
  const defaultLivekitUrl = String(
    (import.meta as any)?.env?.VITE_LIVEKIT_URL || "",
  ).trim();
  const tokenEndpoint = String(
    (import.meta as any)?.env?.VITE_LIVEKIT_TOKEN_ENDPOINT ||
    "/api/livekit/token",
  ).trim();
  const adminEndpoint = String(
    (import.meta as any)?.env?.VITE_LIVEKIT_ADMIN_ENDPOINT ||
    "/api/livekit/admin",
  ).trim();

  const [lkServerUrl, setLkServerUrl] = useState<string>(defaultLivekitUrl);
  const [lkToken, setLkToken] = useState<string>("");
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState<string>("");
  const [assignedServerId, setAssignedServerId] = useState<string>("");
  const lkTokenRef = useRef("");
  const lkServerUrlRef = useRef(defaultLivekitUrl);
  const tokenRequestInFlightRef = useRef(false);

  useEffect(() => {
    lkTokenRef.current = lkToken;
    lkServerUrlRef.current = lkServerUrl;
  }, [lkToken, lkServerUrl]);

  const getFreshAccessToken = async () => {
    try {
      // Supabase keeps this ref current through onAuthStateChange. Avoid taking
      // its storage/session lock for every moderation click; that lock can be
      // noticeably delayed when another tab is refreshing the same session.
      const cachedToken = String(accessTokenRef.current || "").trim();
      if (cachedToken) return cachedToken;

      const { data } = await supabase.auth.getSession();
      let token = String(data?.session?.access_token || "").trim();

      if (token) {
        accessTokenRef.current = token;
        return token;
      }

      const { data: refreshed, error: refreshError } =
        await supabase.auth.refreshSession();
      if (refreshError) throw refreshError;

      token = String(refreshed?.session?.access_token || "").trim();
      if (token) {
        accessTokenRef.current = token;
        return token;
      }

      throw new Error("No active Supabase access token");
    } catch (e: any) {
      throw new Error(
        String(e?.message || e || "Failed to refresh auth session"),
      );
    }
  };

  const sessionId = useMemo(() => String(session?.id || ""), [session?.id]);
  const sessionTitle = useMemo(
    () => String(session?.title || "Session"),
    [session?.title],
  );

  // Profile cache for remote participants.
  //
  // LiveKit events can schedule a tile rebuild before React has committed the
  // latest profilesById state. Keep a synchronous ref as the source of truth so
  // names loaded from Supabase appear immediately, without waiting for a later
  // mute/unmute or track event to trigger another rebuild.
  const [profilesById, setProfilesById] = useState<Record<string, HostProfile>>(
    {},
  );
  const profilesByIdRef = useRef<Record<string, HostProfile>>({});

  useEffect(() => {
    profilesByIdRef.current = profilesById;
  }, [profilesById]);

  // prejoin
  const [prejoinOpen, setPrejoinOpen] = useState(false);
  const [joinRequested, setJoinRequested] = useState(false);
  useEffect(() => {
    if (prejoinOpen) captureProductEvent("prejoin_opened");
  }, [prejoinOpen]);
  useEffect(() => {
    joinRequestedRef.current = joinRequested;
  }, [joinRequested]);
  const prejoinBootstrappedSessionIdRef = useRef<string>("");
  const joinFlowStartedRef = useRef(false);
  const connectingFromPrejoinRef = useRef(false);

  const [devices, setDevices] = useState<MediaDevicesResult>({
    videoInputs: [],
    audioInputs: [],
    audioOutputs: [],
  });

  const [deviceError, setDeviceError] = useState<string>("");
  const [audioOutputSupported, setAudioOutputSupported] = useState<boolean>(
    () => canUseSetSinkId(),
  );

  const deviceTier = useMemo(
    () =>
      detectDeviceTier({
        isMobile: isMobileQuery,
        isTablet: isTabletQuery,
      }),
    [isMobileQuery, isTabletQuery],
  );

  const capturePreset = useMemo(
    () => getCapturePresetForTier(deviceTier),
    [deviceTier],
  );

  const isChromeOS = useMemo(() => isChromeOSLike(), []);
  const isMobileOrTabletDevice = useMemo(
    () => isMobileOrTabletDeviceLike(),
    [],
  );

  // Device identity is the primary signal. Viewport width remains a fallback
  // for older browsers, but landscape tablets and desktop-mode iPads must keep
  // their recovery lease even when their CSS viewport is wider than 1023px.
  // ChromeOS is intentionally excluded from the phone/tablet FX restrictions.
  const lowPowerMobileMode = useMemo(() => {
    return (
      (isMobileOrTabletDevice || isMobileQuery || isTabletQuery) &&
      !isChromeOS
    );
  }, [isMobileOrTabletDevice, isMobileQuery, isTabletQuery, isChromeOS]);

  // Background processors stay disabled only on actual phones/tablets.
  // ChromeOS devices can expose touch/tablet-like signals, so exclude them.
  const shouldDisableBackgroundFx = lowPowerMobileMode;

  const prejoinPreviewPreset = useMemo(() => {
    if (lowPowerMobileMode) {
      return {
        width: 320,
        height: 180,
        fps: 8,
      };
    }

    if (isChromeOS) {
      return {
        width: 640,
        height: 360,
        fps: 15,
      };
    }

    if (deviceTier === "weak") {
      return {
        width: 640,
        height: 360,
        fps: 12,
      };
    }

    return {
      width: capturePreset.width,
      height: capturePreset.height,
      fps: capturePreset.fps,
    };
  }, [lowPowerMobileMode, isChromeOS, deviceTier, capturePreset]);

  const [prejoin, setPrejoin] = useState<PreJoinSettings>(() => {
    const audioProcessing = readAudioProcessingPreferences();
    return {
      displayName: "",
      audioInputId: "",
      videoInputId: "",
      audioOutputId: "default",

      audioEnabled: false,
      videoEnabled: true,

      ...audioProcessing,
    };
  });
  const prejoinRef = useRef(prejoin);
  useEffect(() => {
    prejoinRef.current = prejoin;
  }, [prejoin]);

  useEffect(() => {
    const nm = String(displayName || userName || "").trim();
    if (!nm) return;

    setPrejoin((prev) => {
      if (String(prev.displayName || "").trim()) return prev;
      return { ...prev, displayName: nm };
    });

    if (!String(prejoinRef.current.displayName || "").trim()) {
      prejoinRef.current = {
        ...prejoinRef.current,
        displayName: nm,
      };
    }
  }, [displayName, userName]);

  const [selectedAudioOutputId, setSelectedAudioOutputId] =
    useState<string>("default");
  const [selectedAudioInputId, setSelectedAudioInputId] = useState<string>("");
  const [selectedVideoInputId, setSelectedVideoInputId] = useState<string>("");

  const [echoCancellationEnabled, setEchoCancellationEnabled] = useState(
    () => readAudioProcessingPreferences().echoCancellation,
  );
  const [noiseSuppressionEnabled, setNoiseSuppressionEnabled] = useState(
    () => readAudioProcessingPreferences().noiseSuppression,
  );
  const [autoGainControlEnabled, setAutoGainControlEnabled] = useState(
    () => readAudioProcessingPreferences().autoGainControl,
  );

  useEffect(() => {
    const next: AudioProcessingPreferences = {
      echoCancellation: echoCancellationEnabled,
      noiseSuppression: noiseSuppressionEnabled,
      autoGainControl: autoGainControlEnabled,
    };

    setPrejoin((prev) => ({
      ...prev,
      ...next,
    }));

    prejoinRef.current = {
      ...prejoinRef.current,
      ...next,
    };

    saveAudioProcessingPreferences(next);
  }, [
    echoCancellationEnabled,
    noiseSuppressionEnabled,
    autoGainControlEnabled,
  ]);

  // pre-join prepared preview track
  const prejoinPreparedVideoTrackRef = useRef<LocalVideoTrack | null>(null);
  const [prejoinPreviewVersion, setPrejoinPreviewVersion] = useState(0);
  const prejoinPreviewInitInFlightRef = useRef(false);
  const prejoinTrackCreationPromiseRef = useRef<
    Promise<LocalVideoTrack | null> | null
  >(null);
  const localCameraEndedCleanupRef = useRef<(() => void) | null>(null);
  const cameraStopExpectedRef = useRef(false);
  const deviceLabelsWarmupAttemptedRef = useRef(false);

  // roles
  const [moderatorUserIds, setModeratorUserIds] = useState<string[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [activeRoomHostLease, setActiveRoomHostLease] =
    useState<InfiniteRoomHostLease | null>(null);
  const [activeRoomHostBusy, setActiveRoomHostBusy] = useState(false);
  const [activeRoomHostError, setActiveRoomHostError] = useState("");
  const [activeRoomHostClock, setActiveRoomHostClock] = useState(() => Date.now());
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesError, setRolesError] = useState<string>("");
  const [roleBusyKey, setRoleBusyKey] = useState<string>("");
  const loadModeratorsInFlightRef = useRef(false);
  const lastModeratorsLoadAtRef = useRef(0);
  const lastModeratorsLoadSessionIdRef = useRef("");
  const participantControlSenderIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    if (!authUserId) {
      setIsSuperAdmin(false);
      return;
    }

    void isCurrentUserAdmin().then((allowed) => {
      if (!cancelled) setIsSuperAdmin(allowed);
    });

    return () => {
      cancelled = true;
    };
  }, [authUserId]);

  // right panel
  const [rightPanelOpen, setRightPanelOpen] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return true;
    return window.matchMedia("(min-width: 1024px)").matches;
  });

  const [viewportW, setViewportW] = useState<number>(() => {
    if (typeof window === "undefined") return 1440;
    return window.innerWidth || 1440;
  });

  const roomDeviceType = useMemo(
    () =>
      inferDeviceTypeFromRuntime({
        isMobileQuery,
        isTabletQuery,
      }),
    [isMobileQuery, isTabletQuery],
  );

  // Large iPads and Android tablets commonly expose a desktop-width viewport
  // in landscape. Width-only breakpoints would put the panel beside the video
  // and squeeze both surfaces. Keep every side panel as a full-stage overlay on
  // tablets, while preserving the split layout on actual desktop devices.
  const useOverlayRightPanel = !isLgUp || roomDeviceType === "tablet";

  useEffect(() => {
    if (typeof window === "undefined") return;

    let raf = 0;

    const update = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        setViewportW(window.innerWidth || 1440);
      });
    };

    update();

    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  const rightPanelWidthPx = useMemo(() => {
    if (!rightPanelOpen || useOverlayRightPanel) return 0;

    if (viewportW < 1100) return 320;
    if (viewportW < 1280) return 340;
    if (viewportW < 1440) return 360;
    if (viewportW < 1680) return 390;

    return 420;
  }, [rightPanelOpen, useOverlayRightPanel, viewportW]);

  const roomGridTemplateColumns = useMemo(() => {
    if (!rightPanelOpen || useOverlayRightPanel) return "minmax(0, 1fr)";
    return `minmax(0, 1fr) ${rightPanelWidthPx}px`;
  }, [rightPanelOpen, useOverlayRightPanel, rightPanelWidthPx]);

  const roomUiScale = useMemo(() => {
    if (!isLgUp) return "lg";
    if (viewportW < 1280) return "md";
    return "lg";
  }, [isLgUp, viewportW]);

  const roomPanelPaddingClass = roomUiScale === "md" ? "p-3" : "p-4";

  const roomPanelHeaderClass =
    roomUiScale === "md" ? "px-2.5 py-2" : "px-3 py-2";

  const roomPanelTitleClass =
    roomUiScale === "md" ? "text-[12px]" : "text-[13px]";

  const roomPanelPillClass =
    roomUiScale === "md" ? "h-7 px-2 text-[11px]" : "h-8 px-3 text-xs";

  const roomPanelIconClass = roomUiScale === "md" ? "w-3.5 h-3.5" : "w-4 h-4";

  const [rightTab, setRightTab] = useState<RightPanelTab>("tasks");
  const [chatViewMode, setChatViewMode] = useState<"general" | "host">(
    "general",
  );
  const [hostChatPeerIds, setHostChatPeerIds] = useState<string[]>([]);
  const [selectedHostChatPeerId, setSelectedHostChatPeerId] = useState<
    string | null
  >(null);
  const [hostDmDropdownOpen, setHostDmDropdownOpen] = useState(false);
  const hostDmDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostDmDropdownOpen) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (hostDmDropdownRef.current?.contains(target)) return;
      setHostDmDropdownOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHostDmDropdownOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("touchstart", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("touchstart", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [hostDmDropdownOpen]);

  useEffect(() => {
    setHostDmDropdownOpen(false);
  }, [chatViewMode, rightTab]);
  const openRightTab = (tab: RightPanelTab) => {
    if (!tab) {
      setRightPanelOpen(false);
      setRightTab(null);
      return;
    }

    const nextOpen = rightTab === tab ? !rightPanelOpen : true;
    setRightTab(tab);
    setRightPanelOpen(nextOpen);
    if (nextOpen) captureProductEvent("panel_opened", { panel: tab });
  };

  const openTileMenuAt = useCallback(
    (
      tileId: string,
      anchorEl: HTMLElement | null,
      point?: { x: number; y: number },
    ) => {
      if (!anchorEl) return;

      const r = anchorEl.getBoundingClientRect();
      const ownerDoc = anchorEl.ownerDocument || document;
      const ownerWin = ownerDoc.defaultView || window;
      const tileElement =
        anchorEl.closest<HTMLElement>('[data-mobile-pip-tile="true"]') ||
        anchorEl;

      setOpenTileAdminMenuId(tileId);
      setTileMenuAnchor({
        tileId,
        x: point?.x ?? r.right,
        y: point?.y ?? r.bottom,
        viewportWidth: ownerWin.innerWidth,
        viewportHeight: ownerWin.innerHeight,
        portalDocument: ownerDoc,
        tileElement,
      });
    },
    [],
  );

  const closeTileMenu = useCallback(() => {
    setOpenTileAdminMenuId(null);
    setTileMenuAnchor(null);
  }, []);

  useEffect(() => {
    if (!openTileAdminMenuId) return;

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const insideAnchor = !!target.closest(
        "[data-lk-admin-menu-anchor='true']",
      );
      const insideSurface = !!target.closest(
        "[data-lk-admin-menu-surface='true']",
      );

      if (insideAnchor || insideSurface) return;
      closeTileMenu();
    };

    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTileMenu();
    };

    const onWindowChange = () => {
      closeTileMenu();
    };

    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("touchstart", onPointerDown, true);
    document.addEventListener("keydown", onEscape, true);
    window.addEventListener("resize", onWindowChange);

    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("touchstart", onPointerDown, true);
      document.removeEventListener("keydown", onEscape, true);
      window.removeEventListener("resize", onWindowChange);
    };
  }, [openTileAdminMenuId, closeTileMenu]);

  useEffect(() => {
    const fire = () => {
      try {
        window.dispatchEvent(new Event("resize"));
      } catch { }
    };
    requestAnimationFrame(fire);
    const t1 = window.setTimeout(fire, 60);
    const t2 = window.setTimeout(fire, 220);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [rightPanelOpen, rightTab]);

  // stages
  const [stages, setStages] = useState<Stage[]>([]);
  const [, setHoveredStage] = useState<Stage | null>(null);
  const [currentStage, setCurrentStage] = useState(0);
  const [remainingTime, setRemainingTime] = useState<string>("");

  const [stagebarStartTime, setStagebarStartTime] = useState<string>("");
  const [stagebarCycleSeconds, setStagebarCycleSeconds] = useState<
    number | undefined
  >(undefined);

  const prevStageRef = useRef<number>(-1);
  const firstTickDoneRef = useRef<boolean>(false);
  const focusStageCycleRef = useRef<number>(0);
  const postSessionShownForSessionRef = useRef<string>("");
  const welcomeLoopRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef<boolean>(false);
  const pendingRoomAudioUnlockRef = useRef<boolean>(false);
  const audioUnlockInFlightRef = useRef(false);
  const pendingStageSoundRef = useRef<{ url: string; volume: number } | null>(
    null,
  );

  const FOCUS_GONG_SOUNDS = [
    "/sounds/focus_gong_1.mp3",
    "/sounds/focus_gong_2.mp3",
    "/sounds/focus_gong_3.mp3",
  ] as const;

  const STAGE_SOUND_MAP: Record<string, string> = {
    intentions: "/sounds/intentions.mp3",
    break: "/sounds/break_start.mp3",
    outro: "/sounds/outro.mp3",
  };

  const BREAK_END_SOUND = "/sounds/break_end.mp3";
  const WELCOME_LOOP_SOUND = "/sounds/welcome_loop.mp3";

  const readSoundPreference = (key: string) => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return raw === "true";

      const legacy = localStorage.getItem(ROOM_SOUNDS_PREF_KEY);
      return legacy === null ? true : legacy === "true";
    } catch {
      return true;
    }
  };

  const [joinSoundEnabled, setJoinSoundEnabled] = useState<boolean>(() =>
    readSoundPreference(JOIN_SOUND_PREF_KEY),
  );
  const joinSoundEnabledRef = useRef(joinSoundEnabled);

  const [leaveSoundEnabled, setLeaveSoundEnabled] = useState<boolean>(() =>
    readSoundPreference(LEAVE_SOUND_PREF_KEY),
  );
  const leaveSoundEnabledRef = useRef(leaveSoundEnabled);

  const [stageSoundsEnabled, setStageSoundsEnabled] = useState<boolean>(() =>
    readSoundPreference(STAGE_SOUNDS_PREF_KEY),
  );
  const stageSoundsEnabledRef = useRef(stageSoundsEnabled);
  const [selfDeafened, setSelfDeafened] = useState(false);
  const selfDeafenedRef = useRef(false);

  const applySelfDeafenToRoom = useCallback(
    (room: Room | null | undefined, deafened: boolean) => {
      selfDeafenedRef.current = deafened;
      if (!room) return;

      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.audioTrackPublications.values()) {
          try {
            // This only affects playback for the local listener. While
            // deafened it also prevents a newly published track from becoming
            // audible during the next tile refresh.
            publication.setEnabled(!deafened);
            if (deafened && publication.track instanceof RemoteAudioTrack) {
              publication.track.setVolume(0);
            }
          } catch (error) {
            console.warn("skip-me deafen audio update failed", error);
          }
        }
      }
    },
    [],
  );

  const [roomSoundsVolume, setRoomSoundsVolume] = useState<number>(() => {
    try {
      const raw = Number(
        localStorage.getItem(ROOM_SOUNDS_VOLUME_PREF_KEY) || "90",
      );
      if (!Number.isFinite(raw)) return 90;
      return Math.max(0, Math.min(100, Math.round(raw)));
    } catch {
      return 90;
    }
  });
  const roomSoundsVolumeRef = useRef(roomSoundsVolume);

  const [cameraFramingMode, setCameraFramingMode] = useState<CameraFramingMode>(() => {
    try {
      return localStorage.getItem(CAMERA_FRAMING_PREF_KEY) === "fill" ? "fill" : "full";
    } catch {
      return "full";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(CAMERA_FRAMING_PREF_KEY, cameraFramingMode);
    } catch { }
  }, [cameraFramingMode]);

  const [previewMirrored, setPreviewMirrored] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(PREVIEW_MIRROR_PREF_KEY);
      return raw === null ? true : raw === "true";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(PREVIEW_MIRROR_PREF_KEY, String(previewMirrored));
    } catch { }
  }, [previewMirrored]);

  useEffect(() => {
    joinSoundEnabledRef.current = joinSoundEnabled;
    try {
      localStorage.setItem(JOIN_SOUND_PREF_KEY, String(joinSoundEnabled));
    } catch { }
  }, [joinSoundEnabled]);

  useEffect(() => {
    leaveSoundEnabledRef.current = leaveSoundEnabled;
    try {
      localStorage.setItem(LEAVE_SOUND_PREF_KEY, String(leaveSoundEnabled));
    } catch { }
  }, [leaveSoundEnabled]);

  useEffect(() => {
    stageSoundsEnabledRef.current = stageSoundsEnabled;
    try {
      localStorage.setItem(STAGE_SOUNDS_PREF_KEY, String(stageSoundsEnabled));
    } catch { }
  }, [stageSoundsEnabled]);

  useEffect(() => {
    roomSoundsVolumeRef.current = roomSoundsVolume;
    try {
      localStorage.setItem(
        ROOM_SOUNDS_VOLUME_PREF_KEY,
        String(roomSoundsVolume),
      );
    } catch { }
  }, [roomSoundsVolume]);

  useEffect(() => {
    try {
      localStorage.setItem(PREVIEW_MIRROR_PREF_KEY, String(previewMirrored));
    } catch { }
  }, [previewMirrored]);

  const playOneShot = (url: string, volume = 1) => {
    if (!url) {
      console.warn("[room-sound] skipped: empty url");
      return;
    }

    if (!stageSoundsEnabledRef.current) {
      console.warn("[room-sound] skipped: stage sounds disabled", { url });
      return;
    }

    const baseVolume = Math.max(
      0,
      Math.min(1, roomSoundsVolumeRef.current / 100),
    );
    const finalVolume = Math.max(0, Math.min(1, baseVolume * volume));

    const a = new Audio(url);
    a.preload = "auto";
    a.volume = finalVolume;

    a.addEventListener(
      "error",
      () => {
        console.error("[room-sound] audio error", {
          url,
          currentSrc: a.currentSrc,
          networkState: a.networkState,
          readyState: a.readyState,
        });
      },
      { once: true },
    );

    void a.play().then(
      () => {
        console.log("[room-sound] playing", { url, finalVolume });
      },
      (err) => {
        console.error("[room-sound] play failed", { url, err });
      },
    );
  };

  const playStageSoundSafely = (url: string, volume = 1) => {
    if (!url) return;
    if (!stageSoundsEnabledRef.current) return;

    if (!audioUnlockedRef.current) {
      pendingStageSoundRef.current = { url, volume };
      console.log("[room-sound] queued until unlock", { url, volume });
      return;
    }

    playOneShot(url, volume);
  };

  const ensureRoomAudioPlaybackUnlocked = useCallback(
    async (reason: string) => {
      const room = roomRef.current;
      if (!room) return;

      if (audioUnlockInFlightRef.current) return;
      audioUnlockInFlightRef.current = true;

      try {
        const anyRoom = room as any;

        if (typeof anyRoom.startAudio === "function") {
          await anyRoom.startAudio();
        }

        try {
          const audioEls = Array.from(
            document.querySelectorAll("audio"),
          ) as HTMLAudioElement[];
          await Promise.allSettled(
            audioEls.map(async (el) => {
              try {
                el.muted = false;
                await el.play();
              } catch { }
            }),
          );
        } catch { }

        audioUnlockedRef.current = true;

        setRemoteAudioBlocked(false);
        setRemoteAudioBlockedReason("");
        setAudioResumeNonce((v) => v + 1);

        console.log("[lk-audio] playback unlock ok:", reason);

        const pending = pendingStageSoundRef.current;
        if (pending?.url) {
          pendingStageSoundRef.current = null;
          console.log(
            "[room-sound] replaying pending sound after unlock",
            pending,
          );
          playOneShot(pending.url, pending.volume);
        }
      } catch (e: any) {
        console.warn("[lk-audio] playback unlock failed:", reason, e);
        setRemoteAudioBlocked(true);
        setRemoteAudioBlockedReason(
          String(e?.message || e || "audio_playback_blocked"),
        );
      } finally {
        audioUnlockInFlightRef.current = false;
      }
    },
    [],
  );

  const startWelcomeLoop = () => {
    stopWelcomeLoop();
    if (!stageSoundsEnabledRef.current) return;

    const baseVolume = Math.max(
      0,
      Math.min(1, roomSoundsVolumeRef.current / 100),
    );

    const a = new Audio(WELCOME_LOOP_SOUND);
    a.loop = true;
    a.volume = Math.max(0, Math.min(1, baseVolume * 0.6));
    welcomeLoopRef.current = a;
    a.play().catch(() => { });
  };

  const stopWelcomeLoop = () => {
    try {
      if (welcomeLoopRef.current) {
        welcomeLoopRef.current.pause();
        welcomeLoopRef.current.currentTime = 0;
        welcomeLoopRef.current = null;
      }
    } catch { }
  };

  useEffect(() => {
    if (!stageSoundsEnabled) {
      pendingStageSoundRef.current = null;
      stopWelcomeLoop();
    }
  }, [stageSoundsEnabled]);

  useEffect(() => {
    const unlock = () => {
      if (audioUnlockedRef.current) return;

      const a = new Audio();
      a.play().catch(() => { });

      audioUnlockedRef.current = true;

      const pending = pendingStageSoundRef.current;
      if (pending?.url) {
        pendingStageSoundRef.current = null;
        console.log(
          "[room-sound] replaying pending sound after user gesture",
          pending,
        );
        playOneShot(pending.url, pending.volume);
      }

      window.removeEventListener("click", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      window.removeEventListener("touchstart", unlock, true);
    };

    window.addEventListener("click", unlock, true);
    window.addEventListener("keydown", unlock, true);
    window.addEventListener("touchstart", unlock, true);

    return () => {
      window.removeEventListener("click", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      window.removeEventListener("touchstart", unlock, true);
    };
  }, []);

  const isOneOnOneRoom = useMemo(() => {
    const queryMode = new URLSearchParams(location.search)
      .get("mode")
      ?.trim()
      .toLowerCase();
    const sessionMode = String(
      session?.session_format_type || session?.format || "",
    )
      .trim()
      .toLowerCase();

    return (
      queryMode === "one-on-one" ||
      queryMode === "one_on_one" ||
      sessionMode === "one_on_one" ||
      String(session?.description || "").startsWith("one-on-one:")
    );
  }, [location.search, session]);

  const maxParticipants = useMemo(() => {
    if (isOneOnOneRoom) return 2;
    const raw = num((session as any)?.max_participants);
    const v = raw > 0 ? raw : 16;
    return Math.max(2, Math.min(50, Math.round(v)));
  }, [isOneOnOneRoom, session]);

  const isInfiniteRoom = useMemo(() => {
    const raw = session?.schedule;
    if (parse50505(raw)) return true;

    const parsed = safeParseJson(raw);
    if (!isRecord(parsed)) return false;

    const kind = str((parsed as any).kind).toLowerCase();
    if (kind === "infinite_room") return true;
    if (kind.includes("infinite")) return true;

    if (
      isRecord((parsed as any).timer) &&
      (((parsed as any).timer as any).phases ||
        ((parsed as any).timer as any).segments)
    )
      return true;
    if ((parsed as any).phases || (parsed as any).segments) return true;

    return false;
  }, [session]);

  const isFreeFlowRoom = useMemo(() => {
    const parsed = safeParseJson(session?.schedule);
    return (
      isRecord(parsed) &&
      (str((parsed as any).variant).toLowerCase() === "free_flow" ||
        (parsed as any).free_flow === true)
    );
  }, [session?.schedule]);

  // Timeline/stage bar must be driven only by the actual schedule/stages.
  // Do not auto-hide or stop it based on session title/format/template text like "silent".
  const isSilentRoom = false;

  useEffect(() => {
    console.log("[LK SERVER ROUTING]", {
      sessionId,
      assignedServerId,
      lkServerUrl,
      hasToken: !!lkToken,
    });
  }, [sessionId, assignedServerId, lkServerUrl, lkToken]);

  useEffect(() => {
    prejoinBootstrappedSessionIdRef.current = "";
    joinFlowStartedRef.current = false;
    connectingFromPrejoinRef.current = false;
    sessionJoinStartedAtRef.current = null;
    usageTrackedRef.current = false;
    pendingStageSoundRef.current = null;
    audioUnlockedRef.current = false;
    postSessionShownForSessionRef.current = "";
    autoClosedSessionIdRef.current = "";
    setPrejoinOpen(false);
    setJoinRequested(false);
    setLkToken("");
    setLkServerUrl(defaultLivekitUrl);
    setAssignedServerId("");
  }, [sessionId, defaultLivekitUrl]);

  const [joinNowTickMs, setJoinNowTickMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const startIso = String(session?.start_time || "").trim();
    if (!startIso) return;

    const startMs = new Date(startIso).getTime();
    if (!Number.isFinite(startMs) || startMs <= 0) return;

    const allowMs = startMs - JOIN_EARLY_WINDOW_MINUTES * 60 * 1000;

    if (Date.now() >= allowMs) return;

    const t = window.setInterval(() => setJoinNowTickMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [session?.start_time]);

  const joinGateInfo = useMemo(() => {
    const startIso = String(session?.start_time || "").trim();

    if (!startIso) {
      return {
        enabled: false,
        canJoinNow: true,
        startMs: 0,
        allowMs: 0,
        msUntilAllowed: 0,
      };
    }

    const startMs = new Date(startIso).getTime();

    if (!Number.isFinite(startMs) || startMs <= 0) {
      return {
        enabled: false,
        canJoinNow: true,
        startMs: 0,
        allowMs: 0,
        msUntilAllowed: 0,
      };
    }

    const allowMs = startMs - JOIN_EARLY_WINDOW_MINUTES * 60 * 1000;

    return {
      enabled: true,
      canJoinNow: joinNowTickMs >= allowMs,
      startMs,
      allowMs,
      msUntilAllowed: Math.max(0, allowMs - joinNowTickMs),
    };
  }, [session?.start_time, joinNowTickMs]);

  const canJoinNow = joinGateInfo.canJoinNow;
  const joinBlocked = joinGateInfo.enabled && !joinGateInfo.canJoinNow;
  const [joinGateOtherSessions, setJoinGateOtherSessions] = useState<
    JoinGateHostSession[]
  >([]);
  const [joinGateOtherSessionsLoading, setJoinGateOtherSessionsLoading] =
    useState(false);
  const [closedSessionRecommendations, setClosedSessionRecommendations] =
    useState<ClosedSessionRecommendation[]>([]);
  const [closedSessionRecommendationsLoading, setClosedSessionRecommendationsLoading] =
    useState(false);
  const [closedSessionBookingBusyId, setClosedSessionBookingBusyId] =
    useState("");
  const [closedSessionBookedIds, setClosedSessionBookedIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    const hostId = String(session?.host_id || "").trim();
    const currentSessionId = String(session?.id || "").trim();

    if (!joinBlocked || !hostId || !currentSessionId) {
      setJoinGateOtherSessions([]);
      setJoinGateOtherSessionsLoading(false);
      return;
    }

    let cancelled = false;
    setJoinGateOtherSessionsLoading(true);

    const loadOtherHostSessions = async () => {
      try {
        const { data, error } = await supabase
          .from("sessions")
          .select(SESSION_SELECT_STR)
          .eq("host_id", hostId)
          .neq("id", currentSessionId)
          .gte("start_time", new Date().toISOString())
          .order("start_time", { ascending: true })
          .limit(3);

        if (cancelled) return;
        if (error) {
          console.warn("LiveKit join gate host sessions load failed:", error);
          setJoinGateOtherSessions([]);
          return;
        }

        const next = ((data || []) as SessionRow[])
          .map((row) => {
            const startMs = new Date(String(row.start_time || "")).getTime();
            if (!Number.isFinite(startMs) || startMs <= 0) return null;

            const rowMax = Math.max(
              2,
              Math.min(50, Math.round(num(row.max_participants) || 16)),
            );
            const rowBookings = Array.isArray(row.session_bookings)
              ? row.session_bookings.length
              : 0;

            return {
              id: String(row.id),
              title: String(row.title || "Session"),
              startMs,
              bookedCount: rowBookings,
              maxParticipants: rowMax,
            } satisfies JoinGateHostSession;
          })
          .filter((row): row is JoinGateHostSession => !!row);

        setJoinGateOtherSessions(next);
      } catch (error) {
        if (!cancelled) {
          console.warn("LiveKit join gate host sessions load failed:", error);
          setJoinGateOtherSessions([]);
        }
      } finally {
        if (!cancelled) setJoinGateOtherSessionsLoading(false);
      }
    };

    void loadOtherHostSessions();

    return () => {
      cancelled = true;
    };
  }, [joinBlocked, session?.host_id, session?.id]);

  const [sessionAccessTickMs, setSessionAccessTickMs] = useState<number>(() =>
    Date.now(),
  );

  useEffect(() => {
    if (!session?.id) return;

    setSessionAccessTickMs(Date.now());
    const t = window.setInterval(
      () => setSessionAccessTickMs(Date.now()),
      1000,
    );

    return () => window.clearInterval(t);
  }, [session?.id]);

  const sessionCloseInfo = useMemo(() => {
    if (!session || isInfiniteRoom) {
      return {
        enabled: false,
        ended: false,
        closed: false,
        startMs: 0,
        endMs: 0,
        closeMs: 0,
        msUntilClose: 0,
      };
    }

    const startIso = String(
      stagebarStartTime || session.start_time || session.created_at || "",
    ).trim();
    const startMs = new Date(startIso).getTime();

    if (!Number.isFinite(startMs) || startMs <= 0) {
      return {
        enabled: false,
        ended: false,
        closed: false,
        startMs: 0,
        endMs: 0,
        closeMs: 0,
        msUntilClose: 0,
      };
    }

    const stageTotalSeconds = stages.reduce((acc, s) => {
      const sec = Number(s.durationSeconds || 0);
      if (sec > 0) return acc + sec;

      const mins = Number(s.duration || 0);
      return mins > 0 ? acc + mins * 60 : acc;
    }, 0);

    const scheduleTotalSeconds = getFixedSessionTotalSecondsFromSchedule(
      session.schedule,
    );
    const fallbackDurationMinutes = Number(
      (session as any).duration_minutes || 0,
    );
    const totalMs =
      stageTotalSeconds > 0
        ? stageTotalSeconds * 1000
        : scheduleTotalSeconds > 0
          ? scheduleTotalSeconds * 1000
          : fallbackDurationMinutes > 0
            ? fallbackDurationMinutes * 60 * 1000
            : 0;

    if (!Number.isFinite(totalMs) || totalMs <= 0) {
      return {
        enabled: false,
        ended: false,
        closed: false,
        startMs,
        endMs: 0,
        closeMs: 0,
        msUntilClose: 0,
      };
    }

    const endMs = startMs + totalMs;
    const closeMs = endMs + SESSION_CLOSE_GRACE_MINUTES * 60 * 1000;

    return {
      enabled: true,
      ended: sessionAccessTickMs >= endMs,
      closed: sessionAccessTickMs >= closeMs,
      startMs,
      endMs,
      closeMs,
      msUntilClose: Math.max(0, closeMs - sessionAccessTickMs),
    };
  }, [session, stages, stagebarStartTime, isInfiniteRoom, sessionAccessTickMs]);

  useEffect(() => {
    const currentSessionId = String(session?.id || "").trim();
    const hostId = String(session?.host_id || "").trim();

    if (!sessionCloseInfo.closed || !currentSessionId) {
      setClosedSessionRecommendations([]);
      setClosedSessionRecommendationsLoading(false);
      setClosedSessionBookedIds(new Set());
      return;
    }

    let cancelled = false;
    setClosedSessionRecommendationsLoading(true);

    const normalizeRows = (
      rows: SessionRow[],
      sameHost: boolean,
    ): ClosedSessionRecommendation[] =>
      rows
        .map((row) => {
          const startMs = new Date(String(row.start_time || "")).getTime();
          if (!Number.isFinite(startMs) || startMs <= Date.now()) return null;

          const maxParticipants = Math.max(
            2,
            Math.min(50, Math.round(num(row.max_participants) || 16)),
          );
          const bookings = Array.isArray(row.session_bookings)
            ? row.session_bookings
            : [];
          const isBooked =
            !!authUserId &&
            bookings.some(
              (booking) => String(booking?.user_id || "") === String(authUserId),
            );

          return {
            id: String(row.id),
            title: String(row.title || "Session"),
            startMs,
            bookedCount: bookings.length,
            maxParticipants,
            hostName: String(row.host_profile?.full_name || "Session host"),
            hostAvatarUrl: row.host_profile?.avatar_url || null,
            sameHost,
            isBooked,
          } satisfies ClosedSessionRecommendation;
        })
        .filter(
          (row): row is ClosedSessionRecommendation => row !== null,
        );

    const loadRecommendations = async () => {
      try {
        let recommendations: ClosedSessionRecommendation[] = [];

        if (hostId) {
          const { data, error } = await supabase
            .from("sessions")
            .select(SESSION_SELECT_STR)
            .eq("host_id", hostId)
            .neq("id", currentSessionId)
            .gte("start_time", new Date().toISOString())
            .order("start_time", { ascending: true })
            .limit(2);

          if (error) throw error;
          recommendations = normalizeRows((data || []) as SessionRow[], true);
        }

        // The fallback intentionally runs only when this host has no upcoming
        // sessions, keeping the recommendation hierarchy easy to understand.
        if (!recommendations.length) {
          let query = supabase
            .from("sessions")
            .select(SESSION_SELECT_STR)
            .neq("id", currentSessionId)
            .gte("start_time", new Date().toISOString())
            .order("start_time", { ascending: true })
            .limit(2);

          if (hostId) query = query.neq("host_id", hostId);

          const { data, error } = await query;
          if (error) throw error;
          recommendations = normalizeRows((data || []) as SessionRow[], false);
        }

        if (cancelled) return;

        setClosedSessionRecommendations(recommendations.slice(0, 2));
        setClosedSessionBookedIds(
          new Set(
            recommendations
              .filter((row) => row.isBooked)
              .map((row) => row.id),
          ),
        );
      } catch (error) {
        if (!cancelled) {
          console.warn("Closed session recommendations load failed:", error);
          setClosedSessionRecommendations([]);
          setClosedSessionBookedIds(new Set());
        }
      } finally {
        if (!cancelled) setClosedSessionRecommendationsLoading(false);
      }
    };

    void loadRecommendations();

    return () => {
      cancelled = true;
    };
  }, [
    authUserId,
    session?.host_id,
    session?.id,
    sessionCloseInfo.closed,
  ]);

  const checkActiveBanForRoom = useCallback(async () => {
    if (!authUserId || !authReady) {
      setActiveBan(null);
      return;
    }

    try {
      setBanLoading(true);
      const ban = await getCurrentUserActiveBan();
      setActiveBan(ban);

      if (ban) {
        clearMobileRoomLease(sessionId, authUserId);
        setPrejoinOpen(false);
        setJoinRequested(false);
        setLkToken("");
        setClientError("");
        setMediaWarning("");
      }
    } catch (e) {
      console.warn("[ban] active ban check failed:", e);
      setActiveBan(null);
    } finally {
      setBanLoading(false);
    }
  }, [authUserId, authReady, sessionId]);

  useEffect(() => {
    void checkActiveBanForRoom();
  }, [checkActiveBanForRoom]);

  useEffect(() => {
    let cancelled = false;

    // Supabase restores the persisted auth session asynchronously. Waiting for
    // that once avoids an unauthenticated request followed by the same session
    // request again as soon as auth settles.
    if (!authReady) return;

    (async () => {
      const rawId = String(effectiveSessionParam || "").trim();

      if (!rawId) {
        setSession(null);
        setSessionLoadError("Missing session id.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setSessionLoadError("");

      try {
        let data: any = null;
        let error: any = null;

        // Main path: normal room-livekit/:uuid.
        if (looksLikeUuid(rawId)) {
          const res = await withTimeout(
            supabase
              .from("sessions")
              .select(SESSION_SELECT_STR)
              .eq("id", rawId)
              .maybeSingle(),
            12_000,
            "Loading this session timed out. Please retry.",
          );

          data = res.data;
          error = res.error;
        } else {
          // Fallback path: if a route ever passes a slug/custom room param.
          // This prevents the room from collapsing into the useless "Back" screen.
          const res = await withTimeout(
            supabase
              .from("sessions")
              .select(SESSION_SELECT_STR)
              .eq("custom_slug", rawId)
              .maybeSingle(),
            12_000,
            "Loading this session timed out. Please retry.",
          );

          data = res.data;
          error = res.error;
        }

        if (cancelled) return;

        if (data && !error) {
          const t = normalizeTemplates((data as any)?.session_templates);
          const norm = { ...(data as any), session_templates: t };
          setSession(norm as any);
          setSessionLoadError("");
          return;
        }

        console.warn("[room-session] failed to load session", {
          id: rawId,
          authReady,
          authUserId,
          error,
        });

        setSession(null);
        setSessionLoadError(
          String(
            error?.message ||
            (authUserId
              ? "Session was not found or is not available."
              : "Sign in to load this session."),
          ),
        );
      } catch (e: any) {
        if (cancelled) return;

        console.warn("[room-session] unexpected load error", e);
        setSession(null);
        setSessionLoadError(
          String(e?.message || e || "Failed to load session."),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveSessionParam, authReady, authUserId]);

  useEffect(() => {
    if (!session) return;

    setStages([]);
    setStagebarCycleSeconds(undefined);
    setStagebarStartTime("");

    const fallbackStart = String(
      session?.start_time || session?.created_at || new Date().toISOString(),
    );

    let parsed: unknown = safeParseJson(session.schedule);

    if (!parsed) {
      const t = parse50505(session.schedule);
      if (t) {
        parsed = {
          kind: "infinite_room",
          timer: {
            phases: {
              focus: t.focus,
              break: t.break,
              intentions: t.intentions,
            },
          },
          anchor_ts:
            session?.start_time || session?.created_at || fallbackStart,
        };
      }
    }

    if (isRecord(parsed)) {
      const maybeBlocks =
        (parsed as any).blocks ||
        (parsed as any).script ||
        (parsed as any).agenda ||
        (parsed as any).items ||
        (parsed as any).stages;
      if (Array.isArray(maybeBlocks)) parsed = maybeBlocks;
    }

    if (Array.isArray(parsed)) {
      const formatted: Stage[] = parsed
        .map((b): Stage | null => {
          const blk = isRecord(b) ? b : null;
          if (!blk) return null;

          const rawName =
            str((blk as any).name) ||
            str((blk as any).title) ||
            str((blk as any).label) ||
            str((blk as any).text) ||
            str((blk as any).key) ||
            "Stage";

          const rawType = str((blk as any).type) || str((blk as any).category);
          const inferredType: Stage["type"] = rawType
            ? inferStageTypeFromLabel(rawType)
            : inferStageTypeFromLabel(rawName);

          const minutes =
            num((blk as any).minutes) ||
            num((blk as any).mins) ||
            num((blk as any).duration_minutes) ||
            num((blk as any).durationMinutes) ||
            num((blk as any).durationMin) ||
            num((blk as any).duration) ||
            0;

          const seconds =
            num((blk as any).seconds) ||
            num((blk as any).durationSeconds) ||
            num((blk as any).duration_seconds) ||
            0;

          const durationSeconds =
            seconds > 0 ? seconds : minutes > 0 ? minutes * 60 : 0;
          const displayMinutes =
            minutes > 0
              ? minutes
              : seconds > 0
                ? Math.max(1, Math.round(seconds / 60))
                : 0;

          if (durationSeconds <= 0 || displayMinutes <= 0) return null;

          const color =
            str((blk as any).color) || STAGE_COLORS[inferredType] || "#F63135";
          return {
            name: rawName,
            duration: displayMinutes,
            color,
            type: inferredType,
            durationSeconds,
          };
        })
        .filter((x): x is Stage => !!x);

      setStages(formatted);
      setStagebarStartTime(String(session.start_time || fallbackStart));
      setStagebarCycleSeconds(undefined);
    }

    const isInfiniteScheduleObject =
      isRecord(parsed) &&
      (str((parsed as any).kind)
        .toLowerCase()
        .includes("infinite") ||
        (isRecord((parsed as any).timer) &&
          (((parsed as any).timer as any).phases ||
            ((parsed as any).timer as any).segments)) ||
        !!(parsed as any).phases ||
        !!(parsed as any).segments);

    if (isInfiniteScheduleObject && isRecord(parsed)) {
      const timer = isRecord((parsed as any).timer)
        ? ((parsed as any).timer as any)
        : null;

      const phasesRaw =
        timer?.phases ??
        timer?.segments ??
        (parsed as any).phases ??
        (parsed as any).segments ??
        null;
      const phases = normalizeInfinitePhases(phasesRaw);

      const formatted: Stage[] = phases.map((p) => {
        const rawPhaseName = String(p.name || "");
        const type = phaseToStageType(rawPhaseName);

        const displayName2 =
          type === "focus"
            ? "Focus"
            : type === "intentions"
              ? isCheckInLikeLabel(rawPhaseName)
                ? "Check-in"
                : "Tasks"
              : type === "break"
                ? "Break"
                : type === "intro"
                  ? "Intro"
                  : type === "outro"
                    ? "Outro"
                    : rawPhaseName || "Stage";

        const seconds = Number(p.seconds) || 0;
        const minutes = Math.max(1, Math.round(seconds / 60));

        return {
          name: displayName2,
          duration: minutes,
          color: STAGE_COLORS[type] || "#F63135",
          type,
          durationSeconds: seconds,
        };
      });

      setStages(formatted);

      const anchor = String(
        str((parsed as any).anchor_ts) ||
        str((parsed as any).anchorTs) ||
        str(session?.start_time) ||
        fallbackStart,
      );
      setStagebarStartTime(anchor);

      const sumSeconds = phases.reduce(
        (acc, p) => acc + (Number(p.seconds) || 0),
        0,
      );
      const timerCycle =
        timer && isRecord(timer)
          ? num((timer as any).cycle_seconds) ||
          num((timer as any).cycleSeconds)
          : 0;

      let cycleSeconds =
        timerCycle ||
        num((parsed as any).cycle_seconds) ||
        num((parsed as any).cycleSeconds) ||
        0;
      if (!cycleSeconds || cycleSeconds <= 0) cycleSeconds = sumSeconds;
      if (cycleSeconds < sumSeconds) cycleSeconds = sumSeconds;

      setStagebarCycleSeconds(Math.max(1, cycleSeconds));
    }

    if (!parsed) setStagebarStartTime(fallbackStart);
  }, [session]);

  const applySessionSnapshot = React.useCallback(
    (nextSession: SessionRow | any) => {
      if (!nextSession) return;

      setSession(nextSession);

      let parsed: unknown = safeParseJson(nextSession.schedule);

      if (!parsed) {
        const t = parse50505(nextSession.schedule);
        if (t) {
          parsed = {
            kind: "infinite_room",
            timer: {
              phases: {
                focus: t.focus,
                break: t.break,
                intentions: t.intentions,
              },
            },
            anchor_ts:
              nextSession?.start_time ||
              nextSession?.created_at ||
              new Date().toISOString(),
          };
        }
      }

      setStages([]);
      setStagebarCycleSeconds(undefined);
      setStagebarStartTime("");

      const fallbackStart = String(
        nextSession?.start_time ||
        nextSession?.created_at ||
        new Date().toISOString(),
      );

      if (isRecord(parsed)) {
        const maybeBlocks =
          (parsed as any).blocks ||
          (parsed as any).script ||
          (parsed as any).agenda ||
          (parsed as any).items ||
          (parsed as any).stages;

        if (Array.isArray(maybeBlocks)) parsed = maybeBlocks;
      }

      if (Array.isArray(parsed)) {
        const formatted: Stage[] = parsed
          .map((b): Stage | null => {
            const blk = isRecord(b) ? b : null;
            if (!blk) return null;

            const rawName =
              str((blk as any).name) ||
              str((blk as any).title) ||
              str((blk as any).label) ||
              str((blk as any).text) ||
              str((blk as any).key) ||
              "Stage";

            const rawType =
              str((blk as any).type) || str((blk as any).category);
            const inferredType: Stage["type"] = rawType
              ? inferStageTypeFromLabel(rawType)
              : inferStageTypeFromLabel(rawName);

            const minutes =
              num((blk as any).minutes) ||
              num((blk as any).mins) ||
              num((blk as any).duration_minutes) ||
              num((blk as any).durationMinutes) ||
              num((blk as any).durationMin) ||
              num((blk as any).duration) ||
              0;

            const seconds =
              num((blk as any).seconds) ||
              num((blk as any).durationSeconds) ||
              num((blk as any).duration_seconds) ||
              0;

            const durationSeconds =
              seconds > 0 ? seconds : minutes > 0 ? minutes * 60 : 0;
            const displayMinutes =
              minutes > 0
                ? minutes
                : seconds > 0
                  ? Math.max(1, Math.round(seconds / 60))
                  : 0;

            if (durationSeconds <= 0 || displayMinutes <= 0) return null;

            const color =
              str((blk as any).color) ||
              STAGE_COLORS[inferredType] ||
              "#F63135";
            return {
              name: rawName,
              duration: displayMinutes,
              color,
              type: inferredType,
              durationSeconds,
            };
          })
          .filter((x): x is Stage => !!x);

        setStages(formatted);
        setStagebarStartTime(String(nextSession.start_time || fallbackStart));
        setStagebarCycleSeconds(undefined);
        return;
      }

      const isInfiniteScheduleObject =
        isRecord(parsed) &&
        (str((parsed as any).kind)
          .toLowerCase()
          .includes("infinite") ||
          (isRecord((parsed as any).timer) &&
            (((parsed as any).timer as any).phases ||
              ((parsed as any).timer as any).segments)) ||
          !!(parsed as any).phases ||
          !!(parsed as any).segments);

      if (isInfiniteScheduleObject && isRecord(parsed)) {
        const timer = isRecord((parsed as any).timer)
          ? ((parsed as any).timer as any)
          : null;

        const phasesRaw =
          timer?.phases ??
          timer?.segments ??
          (parsed as any).phases ??
          (parsed as any).segments ??
          null;
        const phases = normalizeInfinitePhases(phasesRaw);

        const formatted: Stage[] = phases.map((p) => {
          const rawPhaseName = String(p.name || "");
          const type = phaseToStageType(rawPhaseName);

          const displayName2 =
            type === "focus"
              ? "Focus"
              : type === "intentions"
                ? isCheckInLikeLabel(rawPhaseName)
                  ? "Check-in"
                  : "Tasks"
                : type === "break"
                  ? "Break"
                  : type === "intro"
                    ? "Intro"
                    : type === "outro"
                      ? "Outro"
                      : rawPhaseName || "Stage";

          const seconds = Number(p.seconds) || 0;
          const minutes = Math.max(1, Math.round(seconds / 60));

          return {
            name: displayName2,
            duration: minutes,
            color: STAGE_COLORS[type] || "#F63135",
            type,
            durationSeconds: seconds,
          };
        });

        setStages(formatted);

        const anchor = String(
          str((parsed as any).anchor_ts) ||
          str((parsed as any).anchorTs) ||
          str(nextSession?.start_time) ||
          fallbackStart,
        );
        setStagebarStartTime(anchor);

        const sumSeconds = phases.reduce(
          (acc, p) => acc + (Number(p.seconds) || 0),
          0,
        );
        const timerCycle =
          timer && isRecord(timer)
            ? num((timer as any).cycle_seconds) ||
            num((timer as any).cycleSeconds)
            : 0;

        let cycleSeconds =
          timerCycle ||
          num((parsed as any).cycle_seconds) ||
          num((parsed as any).cycleSeconds) ||
          0;

        if (!cycleSeconds || cycleSeconds <= 0) cycleSeconds = sumSeconds;
        if (cycleSeconds < sumSeconds) cycleSeconds = sumSeconds;

        setStagebarCycleSeconds(Math.max(1, cycleSeconds));
        return;
      }

      if (!parsed) setStagebarStartTime(fallbackStart);
    },
    [],
  );

  const reloadSessionSnapshot = React.useCallback(async () => {
    if (!sessionId) return;

    try {
      const { data, error } = await supabase
        .from("sessions")
        .select(SESSION_SELECT_STR)
        .eq("id", sessionId)
        .single();

      if (error) throw error;
      if (!data) return;

      const t = normalizeTemplates((data as any)?.session_templates);
      const norm = { ...(data as any), session_templates: t };

      applySessionSnapshot(norm as any);
    } catch (e) {
      console.error("reloadSessionSnapshot failed:", e);
    }
  }, [sessionId, applySessionSnapshot]);

  useEffect(() => {
    if (!sessionId) return;

    const ch = supabase
      .channel(`livekit-session-sync:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sessions",
          filter: `id=eq.${sessionId}`,
        },
        () => {
          void reloadSessionSnapshot();
        },
      )
      .subscribe();

    return () => {
      safeRemoveRealtimeChannel(ch);
    };
  }, [sessionId, reloadSessionSnapshot]);

  useEffect(() => {
    if (isSilentRoom) {
      setRemainingTime("");
      setCurrentStage(0);
      firstTickDoneRef.current = false;
      prevStageRef.current = -1;
      focusStageCycleRef.current = 0;
      stopWelcomeLoop();
      return;
    }

    if (!stagebarStartTime || !stages.length) return;

    const startMs = new Date(stagebarStartTime).getTime();
    if (Number.isNaN(startMs)) return;

    const stageSeconds = stages.map((s) => {
      const sec = Number(s.durationSeconds || 0);
      if (sec > 0) return sec;
      const mins = Number(s.duration || 0);
      return mins > 0 ? mins * 60 : 0;
    });

    const sumStageSeconds = stageSeconds.reduce((acc, v) => acc + v, 0);
    const loopSeconds =
      (Number(stagebarCycleSeconds) || 0) > 0
        ? Number(stagebarCycleSeconds)
        : Math.max(1, sumStageSeconds);

    const timer = window.setInterval(() => {
      const now = Date.now();
      const diffSecRaw = (now - startMs) / 1000;
      const diffSec =
        loopSeconds > 0 && isInfiniteRoom
          ? ((diffSecRaw % loopSeconds) + loopSeconds) % loopSeconds
          : diffSecRaw;

      let total = 0;
      let active = 0;
      let found = false;

      for (let i = 0; i < stages.length; i++) {
        const dur = stageSeconds[i] || 0;
        const next = total + dur;

        if (dur <= 0) continue;

        if (diffSec < next) {
          active = i;
          const rem = next - diffSec;
          setRemainingTime(
            `${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(2, "0")}`,
          );
          found = true;
          break;
        }

        total = next;
        active = i;
      }

      if (!found && !isInfiniteRoom) setRemainingTime("0:00");

      setCurrentStage(active);

      const stage = stages[active];

      if (!firstTickDoneRef.current) {
        if (stage?.type === "intro") {
          startWelcomeLoop();
        } else {
          stopWelcomeLoop();
        }

        // IMPORTANT:
        // User entering the room is NOT the same thing as a stage starting.
        // So on first tick we only sync refs/state and do NOT play any stage sound.
        focusStageCycleRef.current = 0;

        prevStageRef.current = active;
        firstTickDoneRef.current = true;
        return;
      }

      if (prevStageRef.current !== active) {
        const prev = stages[prevStageRef.current];
        const prevType = prev?.type;
        const newType = stage?.type;

        if (prevType === "break" && newType !== "break") {
          void ensureRoomAudioPlaybackUnlocked("break-end");
          playStageSoundSafely(BREAK_END_SOUND);
        }

        if (newType === "intro") {
          startWelcomeLoop();
        } else {
          stopWelcomeLoop();

          if (newType) {
            const t = inferStageTypeFromLabel(String(newType));

            void ensureRoomAudioPlaybackUnlocked(`stage-change:${t}`);

            if (t === "focus") {
              const gongIndex =
                focusStageCycleRef.current % FOCUS_GONG_SOUNDS.length;
              const focusSound = FOCUS_GONG_SOUNDS[gongIndex];

              if (focusSound) {
                playStageSoundSafely(focusSound);
              }

              focusStageCycleRef.current += 1;
            } else {
              const sound = STAGE_SOUND_MAP[t];
              if (sound) {
                playStageSoundSafely(sound);
              }
            }
          }
        }

        prevStageRef.current = active;
      }

      if (stage?.type !== "intro" && welcomeLoopRef.current) stopWelcomeLoop();
    }, 1000);

    return () => window.clearInterval(timer);
  }, [
    stagebarStartTime,
    stages,
    isSilentRoom,
    isInfiniteRoom,
    stagebarCycleSeconds,
  ]);

  const refreshRoomAuth = useCallback(async () => {
    // Room auth must never redirect logged-out users away from the room.
    // It only decides:
    // - guest  -> render room shell + in-room auth modal
    // - authed -> render prejoin / room flow
    setAuthGateStatus("checking");
    setAuthReady(false);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const activeSession = sessionData?.session || null;
      const u = activeSession?.user || null;

      if (!u) {
        setAuthUserId(null);
        accessTokenRef.current = "";
        setAuthGateStatus("guest");
        setAuthReady(true);
        return;
      }

      setAuthUserId(u.id || null);
      accessTokenRef.current = String(activeSession?.access_token || "").trim();

      setAuthGateStatus("authed");
      setAuthReady(true);
    } catch (e) {
      console.warn("[room-auth] auth check failed:", e);
      setAuthUserId(null);
      accessTokenRef.current = "";
      setAuthGateStatus("guest");
      setAuthReady(true);
    }
  }, []);

  useEffect(() => {
    void refreshRoomAuth();
  }, [refreshRoomAuth]);

  useEffect(() => {
    const onRefresh = () => {
      void refreshRoomAuth();
    };

    window.addEventListener("mysession-room-auth-refresh", onRefresh);
    return () =>
      window.removeEventListener("mysession-room-auth-refresh", onRefresh);
  }, [refreshRoomAuth]);

  useEffect(() => {
    (async () => {
      if (!authUserId) return;

      try {
        const { data } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .eq("id", authUserId)
          .maybeSingle();

        const nm = String((data as any)?.full_name || "").trim();
        const avatar = await resolveAvatarUrlFromProfilesField(
          String((data as any)?.avatar_url || ""),
        );

        if (nm) {
          setUserName(nm);
          setDisplayName((prev) => String(prev || "").trim() || nm);
          setPrejoin((prev) => {
            if (String(prev.displayName || "").trim()) return prev;
            return { ...prev, displayName: nm };
          });
          prejoinRef.current = {
            ...prejoinRef.current,
            displayName:
              String(prejoinRef.current.displayName || "").trim() || nm,
          };
        }

        if (avatar) {
          setLocalAvatarUrl(avatar);
        }
      } catch (e) {
        console.warn("self profile fetch failed", e);
      }
    })();
  }, [authUserId]);

  const openTimelineEditor = () => {
    if (!canEditRoomTimeline) return;

    const parsedBlocks = timelineBlocksFromSchedule(session?.schedule);
    setTimelineDraftBlocks(
      parsedBlocks.length
        ? parsedBlocks
        : isFreeFlowRoom
          ? makeFreeFlowTimelineBlocks()
          : makeDefaultTimelineBlocks(),
    );
    setTimelineEditorOpen(true);
  };

  const closeTimelineEditor = () => {
    if (timelineSaving) return;
    setTimelineEditorOpen(false);
  };

  const saveTimelineEditor = async () => {
    if (!canEditRoomTimeline) return;
    if (!sessionId) return;

    if (!timelineDraftBlocks.length) {
      alert("Add at least one block before saving");
      return;
    }

    setTimelineSaving(true);

    try {
      const generatedSchedule = timelineBlocksToSchedulePayload(
        timelineDraftBlocks,
        {
          preserveInfinite: isInfiniteRoom,
          anchorTs:
            stagebarStartTime ||
            session?.start_time ||
            session?.created_at ||
            new Date().toISOString(),
        },
      );
      const nextSchedule = isFreeFlowRoom
        ? {
            ...generatedSchedule,
            kind: "infinite_room",
            variant: "free_flow",
            free_flow: true,
            max_timeline_blocks: 9,
            host_configured: true,
          }
        : generatedSchedule;

      const nextDurationMinutes = getTimelineTotalMinutes(timelineDraftBlocks);

      const { data: updated, error } = await supabase
        .from("sessions")
        .update({
          schedule: nextSchedule,
          duration_minutes: nextDurationMinutes,
        })
        .eq("id", sessionId)
        .select(SESSION_SELECT_STR)
        .single();

      if (error) throw error;

      const nextSession =
        updated ||
        ({
          ...session,
          schedule: nextSchedule,
          duration_minutes: nextDurationMinutes,
        } as SessionRow);

      applySessionSnapshot(nextSession);
      setTimelineEditorOpen(false);
    } catch (e: any) {
      console.error("Timeline save error:", e);
      alert(String(e?.message || e || "Failed to save timeline"));
    } finally {
      setTimelineSaving(false);
    }
  };

  const loadBrowserDevices = useCallback(
    async (opts?: { preserveSelection?: boolean }) => {
      console.time("lk:loadBrowserDevices");

      try {
        setDeviceError("");
        setAudioOutputSupported(canUseSetSinkId());

        if (!navigator.mediaDevices?.enumerateDevices) {
          setDeviceError(
            "This browser does not support media device enumeration.",
          );
          return;
        }

        let list = await navigator.mediaDevices.enumerateDevices();

        const labelsMissing = list.some((d) => {
          if (d.kind !== "videoinput" && d.kind !== "audioinput") return false;
          return !String(d.label || "").trim();
        });

        const shouldWarmupLabels = false;

        if (shouldWarmupLabels) {
          deviceLabelsWarmupAttemptedRef.current = true;

          try {
            const warmupStream = await navigator.mediaDevices.getUserMedia({
              video: prejoinRef.current.videoEnabled
                ? {
                  width: { ideal: 160 },
                  height: { ideal: 120 },
                  frameRate: { ideal: 5, max: 5 },
                }
                : false,
              audio: false,
            });

            warmupStream.getTracks().forEach((t) => t.stop());

            list = await navigator.mediaDevices.enumerateDevices();
          } catch {
            // labels may stay empty, but device list can still be available
          }
        }

        const videoInputs = list.filter((d) => d.kind === "videoinput");
        const audioInputs = list.filter((d) => d.kind === "audioinput");
        const audioOutputs = list.filter((d) => d.kind === "audiooutput");

        setDevices({ videoInputs, audioInputs, audioOutputs });

        const nextVideoInputId = pickExistingDeviceId(
          opts?.preserveSelection
            ? selectedVideoInputId || prejoinRef.current.videoInputId
            : prejoinRef.current.videoInputId,
          videoInputs,
        );

        const nextAudioInputId = pickExistingDeviceId(
          opts?.preserveSelection
            ? selectedAudioInputId || prejoinRef.current.audioInputId
            : prejoinRef.current.audioInputId,
          audioInputs,
        );

        const nextAudioOutputId = canUseSetSinkId()
          ? pickExistingDeviceId(
            opts?.preserveSelection
              ? selectedAudioOutputId || prejoinRef.current.audioOutputId
              : prejoinRef.current.audioOutputId,
            audioOutputs,
            "default",
          ) || "default"
          : "default";

        setPrejoin((prev) => ({
          ...prev,
          videoInputId: nextVideoInputId,
          audioInputId: nextAudioInputId,
          audioOutputId: nextAudioOutputId,
        }));

        prejoinRef.current = {
          ...prejoinRef.current,
          videoInputId: nextVideoInputId,
          audioInputId: nextAudioInputId,
          audioOutputId: nextAudioOutputId,
        };

        setSelectedVideoInputId(nextVideoInputId);
        setSelectedAudioInputId(nextAudioInputId);
        setSelectedAudioOutputId(nextAudioOutputId);
      } catch (e: any) {
        console.error("loadBrowserDevices error:", e);
        setDeviceError(String(e?.message || e || "device_enumeration_failed"));
      } finally {
        console.timeEnd("lk:loadBrowserDevices");
      }
    },
    [
      selectedVideoInputId,
      selectedAudioInputId,
      selectedAudioOutputId,
      isMobileQuery,
      isTabletQuery,
    ],
  );

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return;

    let timer: number | null = null;

    const onDeviceChange = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        loadBrowserDevices({ preserveSelection: true }).catch(() => { });
      }, 450);
    };

    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);

    return () => {
      if (timer) window.clearTimeout(timer);
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        onDeviceChange,
      );
    };
  }, [loadBrowserDevices]);

  // FX
  const restoredVideoFxPreference = useMemo(
    () => readStoredVideoFxPreference(),
    [],
  );
  const [videoFxMode, setVideoFxMode] = useState<FxMode>(() =>
    restoredVideoFxPreference.mode === "bg" &&
      restoredVideoFxPreference.background.kind === "custom"
      ? "off"
      : restoredVideoFxPreference.mode,
  );
  const [bgImageUrl, setBgImageUrl] = useState<string>(() => {
    if (restoredVideoFxPreference.background.kind === "preset") {
      return (
        FX_BG_PRESETS.find(
          (preset) => preset.id === restoredVideoFxPreference.background.id,
        )?.url || DEFAULT_BG_DATA_URL
      );
    }
    return DEFAULT_BG_DATA_URL;
  });
  const [customBackgroundSlots, setCustomBackgroundSlots] = useState<CustomBackgroundSlot[]>(
    DEFAULT_CUSTOM_BACKGROUND_SLOTS,
  );
  const [customBackgroundSlotsLoaded, setCustomBackgroundSlotsLoaded] = useState(false);
  const customBackgroundSlotsRef = useRef<CustomBackgroundSlot[]>(
    DEFAULT_CUSTOM_BACKGROUND_SLOTS,
  );
  const customBgUploadSlotRef = useRef<CustomBackgroundSlotId | null>(null);
  const [fxError, setFxError] = useState<string>("");
  const [fxApplying, setFxApplying] = useState(false);
  const [fxStatusText, setFxStatusText] = useState<string>("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSoundscapeId, setActiveSoundscapeId] =
    useState<RoomSoundscapeId | null>(null);
  const [soundscapePlaying, setSoundscapePlaying] = useState(false);
  const [soundscapePosition, setSoundscapePosition] = useState(0);
  const [soundscapeDuration, setSoundscapeDuration] = useState(0);
  const [roomSoundscapeVolume, setRoomSoundscapeVolume] = useState(35);
  const [soundscapeListeningMode, setSoundscapeListeningMode] =
    useState<SoundscapeListeningMode>("room");
  const [personalSoundscapeId, setPersonalSoundscapeId] =
    useState<RoomSoundscapeId | null>(null);
  const [personalSoundscapePlaying, setPersonalSoundscapePlaying] = useState(false);
  const [personalSoundscapePosition, setPersonalSoundscapePosition] = useState(0);
  const [personalSoundscapeDuration, setPersonalSoundscapeDuration] = useState(0);
  const [soundscapeBusy, setSoundscapeBusy] = useState(false);
  const [soundscapeUploading, setSoundscapeUploading] = useState(false);
  const [customSoundscapeLabel, setCustomSoundscapeLabel] = useState<string | null>(null);
  const [soundscapeError, setSoundscapeError] = useState<string | null>(null);
  const [soundscapeVolume, setSoundscapeVolume] = useState(() => {
    try {
      const stored = Number(
        localStorage.getItem(BACKGROUND_SOUNDSCAPE_VOLUME_PREF_KEY) || "35",
      );
      return Number.isFinite(stored)
        ? Math.max(0, Math.min(100, Math.round(stored)))
        : 35;
    } catch {
      return 35;
    }
  });
  const [soundscapeMuted, setSoundscapeMuted] = useState(() => {
    try {
      return (
        localStorage.getItem(BACKGROUND_SOUNDSCAPE_MUTED_PREF_KEY) === "true"
      );
    } catch {
      return false;
    }
  });
  const [personalSoundscapeMuted, setPersonalSoundscapeMuted] = useState(false);
  const soundscapeEngineRef = useRef<RoomSoundscapeEngine | null>(null);
  const personalSoundscapeEngineRef = useRef<RoomSoundscapeEngine | null>(null);
  const soundscapeStateRef = useRef<RoomSoundtrackState | null>(null);
  const soundscapeVolumePublishTimerRef = useRef<number | null>(null);
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [mainViewMode, setMainViewMode] =
    useState<RoomMainViewMode>("video");
  const [settingsPreviewVersion, setSettingsPreviewVersion] = useState(0);
  const [blurStrength, setBlurStrength] = useState<number>(
    restoredVideoFxPreference.blurStrength,
  );
  const firefoxSafeFx = useMemo(() => isFirefoxLike(), []);
  const [connected, setConnected] = useState(false);
  const [voiceUiStatus, setVoiceUiStatus] =
    useState<VoiceUiStatus>("idle");
  const [voiceUiMode, setVoiceUiMode] = useState<VoiceUiMode>(() => {
    try {
      const stored = localStorage.getItem(VOICE_UI_MODE_STORAGE_KEY);
      if (stored === "always" || stored === "hotkey" || stored === "off") return stored;
      return localStorage.getItem(VOICE_UI_ENABLED_STORAGE_KEY) === "true" ? "always" : "off";
    } catch {
      return "off";
    }
  });
  const [voiceUiHotkey, setVoiceUiHotkey] = useState(() => {
    try {
      return localStorage.getItem(VOICE_UI_HOTKEY_STORAGE_KEY) || "Alt+V";
    } catch {
      return "Alt+V";
    }
  });
  const [voiceUiHotkeyPressed, setVoiceUiHotkeyPressed] = useState(false);
  const voiceUiEnabled = voiceUiMode !== "off";
  const voiceUiActive = voiceUiMode === "always" || (voiceUiMode === "hotkey" && voiceUiHotkeyPressed);
  const [voiceUiLastCommand, setVoiceUiLastCommand] = useState("");
  const [voiceUiLastHeard, setVoiceUiLastHeard] = useState("");
  const [voiceUiHelpOpen, setVoiceUiHelpOpen] = useState(false);
  const [voiceFxPopupMounted, setVoiceFxPopupMounted] = useState(false);
  const [voiceFxPopupVisible, setVoiceFxPopupVisible] = useState(false);
  const [voiceFxUploadRequested, setVoiceFxUploadRequested] = useState(false);
  const voiceFxUploadInputRef = useRef<HTMLInputElement | null>(null);
  const voiceFxUploadButtonRef = useRef<HTMLButtonElement | null>(null);
  const voiceFxCloseTimerRef = useRef<number | null>(null);
  const voiceUiRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceUiShouldListenRef = useRef(false);
  const voiceUiSuspendedRef = useRef(false);
  const voiceUiRestartTimerRef = useRef<number | null>(null);
  const voiceUiLastExecutionRef = useRef({ command: "", at: 0 });
  const voiceUiCommandHandlerRef = useRef<
    (command: VoiceUiCommand) => Promise<void>
  >(async () => undefined);

  useEffect(() => {
    let cancelled = false;
    loadCustomBackgroundSlots().then((slots) => {
      if (cancelled) return;
      customBackgroundSlotsRef.current = slots;
      setCustomBackgroundSlots(slots);
      setCustomBackgroundSlotsLoaded(true);

      if (
        restoredVideoFxPreference.mode === "bg" &&
        restoredVideoFxPreference.background.kind === "custom"
      ) {
        const restoredSlot = slots.find(
          (slot) => slot.id === restoredVideoFxPreference.background.id,
        );
        if (restoredSlot?.dataUrl) {
          setBgImageUrl(restoredSlot.dataUrl);
          setVideoFxMode("bg");
        } else {
          writeStoredVideoFxPreference({
            ...restoredVideoFxPreference,
            mode: "off",
            background: { kind: "default" },
          });
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [restoredVideoFxPreference]);

  useEffect(() => {
    customBackgroundSlotsRef.current = customBackgroundSlots;
    if (!customBackgroundSlotsLoaded) return;
    void saveCustomBackgroundSlots(customBackgroundSlots).catch((error) => {
      console.warn("custom background slots could not be saved", error);
      setFxError("Custom background could not be saved on this device");
    });
  }, [customBackgroundSlots, customBackgroundSlotsLoaded]);

  useEffect(() => {
    if (
      !customBackgroundSlotsLoaded &&
      restoredVideoFxPreference.mode === "bg" &&
      restoredVideoFxPreference.background.kind === "custom"
    ) {
      return;
    }

    let background: StoredVideoFxBackground = { kind: "default" };
    const preset = FX_BG_PRESETS.find((item) => item.url === bgImageUrl);
    const custom = customBackgroundSlots.find(
      (item) => !!item.dataUrl && item.dataUrl === bgImageUrl,
    );

    if (preset) background = { kind: "preset", id: preset.id };
    else if (custom) background = { kind: "custom", id: custom.id };
    else if (bgImageUrl !== DEFAULT_BG_DATA_URL) {
      // A temporary blob URL cannot survive a page reload. Keep the live effect,
      // but restore to camera-only next time instead of persisting a broken URL.
      writeStoredVideoFxPreference({
        mode: "off",
        blurStrength,
        background: { kind: "default" },
      });
      return;
    }

    writeStoredVideoFxPreference({ mode: videoFxMode, blurStrength, background });
  }, [
    bgImageUrl,
    blurStrength,
    customBackgroundSlots,
    customBackgroundSlotsLoaded,
    restoredVideoFxPreference,
    videoFxMode,
  ]);

  const matchCustomBackgroundVoiceCommand = (raw: string): VoiceUiCommand | null => {
    const normalized = normalizeVoiceUiTranscript(raw);
    if (!normalized || /[^\x00-\x7F]/.test(normalized)) return null;
    const slot = customBackgroundSlotsRef.current.find((item) => {
      if (!item.dataUrl) return false;
      const slotNumber = item.id === "one" ? "1" : item.id === "two" ? "2" : "3";
      const slotWord = item.id;
      return (
        normalized === slotNumber ||
        normalized === slotWord ||
        normalized === `bg${slotNumber}` ||
        normalized === `bg ${slotNumber}` ||
        normalized === `bg ${slotWord}`
      );
    });
    return slot ? (`custom_background_${slot.id}` as VoiceUiCommand) : null;
  };

  const playSoundscapeLocally = async (
    id: RoomSoundscapeId,
    positionSeconds = 0,
    customUrl?: string,
    volumeOverride = roomSoundscapeVolume,
  ) => {
    try {
      setSoundscapeBusy(true);
      setSoundscapeError(null);
      if (!soundscapeEngineRef.current) {
        soundscapeEngineRef.current = new RoomSoundscapeEngine();
      }
      soundscapeEngineRef.current.setMuted(
        soundscapeMuted || soundscapeListeningMode === "personal",
      );
      await soundscapeEngineRef.current.play(
        id,
        volumeOverride / 100,
        positionSeconds,
        customUrl,
      );
      setSoundscapePosition(soundscapeEngineRef.current.currentTime());
      setSoundscapeDuration(soundscapeEngineRef.current.duration());
      setActiveSoundscapeId(id);
      setSoundscapePlaying(true);
      try {
        localStorage.setItem(BACKGROUND_SOUNDSCAPE_PREF_KEY, id);
      } catch {
        // Persistence is optional in browser privacy modes.
      }
    } catch (error) {
      setSoundscapeError(
        error instanceof Error
          ? error.message
          : "Background audio could not be started.",
      );
      throw error;
    } finally {
      setSoundscapeBusy(false);
    }
  };

  const pauseSoundscapeLocally = () => {
    const position = soundscapeEngineRef.current?.pause() || 0;
    setSoundscapePosition(position);
    setSoundscapePlaying(false);
    setSoundscapeError(null);
    return position;
  };

  useEffect(() => {
    soundscapeEngineRef.current?.setVolume(roomSoundscapeVolume / 100);
  }, [roomSoundscapeVolume]);

  useEffect(() => {
    personalSoundscapeEngineRef.current?.setVolume(soundscapeVolume / 100);
    try {
      localStorage.setItem(
        BACKGROUND_SOUNDSCAPE_VOLUME_PREF_KEY,
        String(soundscapeVolume),
      );
    } catch {
      // Persistence is optional in browser privacy modes.
    }
  }, [soundscapeVolume]);

  useEffect(() => {
    soundscapeEngineRef.current?.setMuted(
      soundscapeMuted || soundscapeListeningMode === "personal",
    );
    personalSoundscapeEngineRef.current?.setMuted(
      personalSoundscapeMuted || soundscapeListeningMode === "room",
    );
    try {
      localStorage.setItem(
        BACKGROUND_SOUNDSCAPE_MUTED_PREF_KEY,
        String(soundscapeMuted),
      );
    } catch {
      // Persistence is optional in browser privacy modes.
    }
  }, [personalSoundscapeMuted, soundscapeListeningMode, soundscapeMuted]);

  useEffect(() => {
    if (!activeSoundscapeId) return;
    const updateProgress = () => {
      const engine = soundscapeEngineRef.current;
      if (!engine) return;
      setSoundscapePosition(engine.currentTime());
      setSoundscapeDuration(engine.duration());
    };
    updateProgress();
    const timer = window.setInterval(updateProgress, 500);
    return () => window.clearInterval(timer);
  }, [activeSoundscapeId, soundscapePlaying]);

  useEffect(() => {
    if (!personalSoundscapeId) return;
    const updateProgress = () => {
      const engine = personalSoundscapeEngineRef.current;
      if (!engine) return;
      setPersonalSoundscapePosition(engine.currentTime());
      setPersonalSoundscapeDuration(engine.duration());
    };
    updateProgress();
    const timer = window.setInterval(updateProgress, 500);
    return () => window.clearInterval(timer);
  }, [personalSoundscapeId, personalSoundscapePlaying]);

  useEffect(() => {
    if (connected || !activeSoundscapeId) return;
    soundscapeEngineRef.current?.stop();
    soundscapeStateRef.current = null;
    setActiveSoundscapeId(null);
    setSoundscapePlaying(false);
    setSoundscapePosition(0);
    setSoundscapeDuration(0);
  }, [connected, activeSoundscapeId]);

  useEffect(() => {
    if (connected || !personalSoundscapeId) return;
    personalSoundscapeEngineRef.current?.stop();
    setPersonalSoundscapeId(null);
    setPersonalSoundscapePlaying(false);
    setPersonalSoundscapePosition(0);
    setPersonalSoundscapeDuration(0);
  }, [connected, personalSoundscapeId]);

  useEffect(
    () => () => {
      soundscapeEngineRef.current?.destroy();
      soundscapeEngineRef.current = null;
      personalSoundscapeEngineRef.current?.destroy();
      personalSoundscapeEngineRef.current = null;
      if (soundscapeVolumePublishTimerRef.current != null) {
        window.clearTimeout(soundscapeVolumePublishTimerRef.current);
        soundscapeVolumePublishTimerRef.current = null;
      }
    },
    [],
  );

  const openVoiceFxPopup = () => {
    if (voiceFxCloseTimerRef.current != null) {
      window.clearTimeout(voiceFxCloseTimerRef.current);
      voiceFxCloseTimerRef.current = null;
    }
    setVoiceFxPopupMounted(true);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setVoiceFxPopupVisible(true));
    });
  };

  const closeVoiceFxPopup = () => {
    setVoiceFxPopupVisible(false);
    setVoiceFxUploadRequested(false);
    if (voiceFxCloseTimerRef.current != null) {
      window.clearTimeout(voiceFxCloseTimerRef.current);
    }
    voiceFxCloseTimerRef.current = window.setTimeout(() => {
      setVoiceFxPopupMounted(false);
      voiceFxCloseTimerRef.current = null;
    }, 220);
  };

  useEffect(() => () => {
    if (voiceFxCloseTimerRef.current != null) {
      window.clearTimeout(voiceFxCloseTimerRef.current);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(VOICE_UI_ENABLED_STORAGE_KEY, String(voiceUiEnabled));
      localStorage.setItem(VOICE_UI_MODE_STORAGE_KEY, voiceUiMode);
      localStorage.setItem(VOICE_UI_HOTKEY_STORAGE_KEY, voiceUiHotkey);
    } catch {
      // Local storage can be unavailable in strict privacy modes.
    }
  }, [voiceUiEnabled, voiceUiHotkey, voiceUiMode]);

  useEffect(() => {
    if (voiceUiMode !== "hotkey") {
      setVoiceUiHotkeyPressed(false);
      return;
    }

    let releaseTimerId: number | null = null;
    const clearReleaseTimer = () => {
      if (releaseTimerId == null) return;
      window.clearTimeout(releaseTimerId);
      releaseTimerId = null;
    };
    const scheduleRelease = () => {
      clearReleaseTimer();
      // SpeechRecognition often needs a moment to start after the keyboard
      // gesture. Keep a short capture window so tapping the hotkey works too.
      releaseTimerId = window.setTimeout(() => {
        releaseTimerId = null;
        setVoiceUiHotkeyPressed(false);
      }, 3_200);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesVoiceUiHotkey(event, voiceUiHotkey)) return;
      event.preventDefault();
      event.stopPropagation();
      clearReleaseTimer();
      setVoiceUiHotkeyPressed(true);
    };
    const onKeyUp = () => scheduleRelease();
    const onWindowBlur = () => scheduleRelease();

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      clearReleaseTimer();
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [voiceUiHotkey, voiceUiMode]);

  useEffect(() => {
    if (!voiceUiHelpOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVoiceUiHelpOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [voiceUiHelpOpen]);

  const [mobileMediaRestoreOpen, setMobileMediaRestoreOpen] = useState(false);
  const [mobileMediaRestoreBusy, setMobileMediaRestoreBusy] = useState(false);
  const [mobileRestoreMode, setMobileRestoreMode] = useState<
    "restoring" | "needs_action"
  >("restoring");
  const mobileRestoreEscalationTimerRef = useRef<number | null>(null);
  const mobileMediaRestoreBusyRef = useRef(false);
  const mobileAutoRestoreInFlightRef = useRef(false);
  const mobileRecoveryRetryTimerRef = useRef<number | null>(null);
  const mobileRecoveryAttemptRef = useRef(0);
  const [frozenLocalVideoFrame, setFrozenLocalVideoFrame] =
    useState<string>("");

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  useEffect(() => {
    if (!connected) return;

    const room = roomRef.current;
    if (!room) return;

    const syncSkipMeDeafen = () => {
      try {
        const metadata = JSON.parse(room.localParticipant.metadata || "{}");
        const nextSelfDeafened = metadata?.status === "skip_deafened";
        applySelfDeafenToRoom(room, nextSelfDeafened);
        setSelfDeafened(nextSelfDeafened);
      } catch {
        applySelfDeafenToRoom(room, false);
        setSelfDeafened(false);
      }
    };

    syncSkipMeDeafen();

    const onParticipantMetadataChanged = () => {
      try {
        syncSkipMeDeafen();
        scheduleRebuildTiles();
        window.setTimeout(() => scheduleRebuildTiles(), 80);
        window.setTimeout(() => scheduleRebuildTiles(), 220);
      } catch (e) {
        console.error("metadata changed rebuild failed:", e);
      }
    };

    room.on(RoomEvent.ParticipantMetadataChanged, onParticipantMetadataChanged);

    return () => {
      room.off(
        RoomEvent.ParticipantMetadataChanged,
        onParticipantMetadataChanged,
      );
    };
  }, [applySelfDeafenToRoom, connected]);

  const trackWeeklyUsageOnLeave = useCallback(async () => {
    if (!USAGE_TRACKING_ENABLED) return;
    if (usageTrackedRef.current) return;

    const userId = String(authUserId || "").trim();
    if (!userId) return;

    const startedAt = sessionJoinStartedAtRef.current;
    if (!startedAt) return;

    usageTrackedRef.current = true;

    const minutes = Math.max(1, Math.ceil((Date.now() - startedAt) / 60000));

    try {
      await incrementWeeklyUsage({
        userId,
        addMinutes: minutes,
      });

      console.log("[usage] weekly minutes saved:", {
        userId,
        sessionId,
        minutes,
      });
    } catch (e) {
      usageTrackedRef.current = false;
      console.error("[usage] incrementWeeklyUsage failed:", e);
    }
  }, [authUserId, sessionId]);

  useEffect(() => {
    return () => {
      void trackWeeklyUsageOnLeave();
    };
  }, [trackWeeklyUsageOnLeave]);

  const [remoteAudioBlocked, setRemoteAudioBlocked] = useState(false);
  const [remoteAudioBlockedReason, setRemoteAudioBlockedReason] = useState("");
  const [remoteAudioHasAnyTracks, setRemoteAudioHasAnyTracks] = useState(false);
  const [audioResumeNonce, setAudioResumeNonce] = useState(0);
  const [audioResumeBusy, setAudioResumeBusy] = useState(false);

  const [colorCorrectionEnabled, setColorCorrectionEnabled] = useState(true);
  const [colorCorrection, setColorCorrection] =
    useState<ColorCorrectionState>(DEFAULT_COLOR_CORRECTION);

  const effectiveColorCorrection = useMemo(
    () =>
      colorCorrectionEnabled
        ? colorCorrection
        : DEFAULT_COLOR_CORRECTION,
    [colorCorrectionEnabled, colorCorrection],
  );

  const localVideoFilterCss = useMemo(
    () => buildColorCorrectionFilter(effectiveColorCorrection),
    [effectiveColorCorrection],
  );

  const uploadedBgUrlRef = useRef<string | null>(null);
  const lastPrejoinFxSignatureRef = useRef<string>("");
  const activeFxSignaturesRef = useRef(new WeakMap<LocalVideoTrack, string>());
  const pendingFxSignaturesRef = useRef(new WeakMap<LocalVideoTrack, string>());
  const pendingFxOperationsRef = useRef(
    new WeakMap<LocalVideoTrack, Promise<void>>(),
  );

  const ensureFxSupportedOrThrow = () => {
    if (!supportsBackgroundProcessors())
      throw new Error(
        "Background processors are not supported in this browser/device",
      );
    try {
      supportsModernBackgroundProcessors();
    } catch { }
  };

  const makeProcessorForMode = (
    mode: FxMode,
    blur: number,
    bgUrl: string,
    correction: PublishedColorCorrection,
  ): any | null => {
    if (mode === "off") {
      return isPublishedColorCorrectionIdentity(correction)
        ? null
        : createPublishedColorCorrectionProcessor(correction);
    }

    if (mode === "blur") {
      return createPersonColorBackgroundProcessor({
        mode: {
          mode: "background-blur",
          blurRadius: normalizeFxBlurStrength(blur, firefoxSafeFx),
        },
        correction,
      });
    }

    return createPersonColorBackgroundProcessor({
      mode: {
        mode: "virtual-background",
        imagePath: bgUrl || DEFAULT_BG_DATA_URL,
      },
      correction,
    });
  };

  const stopAnyProcessor = async (track: LocalVideoTrack) => {
    try {
      await (track as any).stopProcessor?.(true);
    } catch { }
  };

  const waitForBackgroundImage = async (url: string) => {
    if (!url || typeof Image === "undefined") return;

    await new Promise<void>((resolve, reject) => {
      const image = new Image();
      let settled = false;
      let timeoutId = 0;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        image.onload = null;
        image.onerror = null;
        if (error) reject(error);
        else resolve();
      };

      timeoutId = window.setTimeout(() => {
        finish(new Error("Background image loading timed out"));
      }, 12_000);

      image.onload = () => finish();
      image.onerror = () => finish(new Error("Selected background image could not be loaded"));
      image.src = url;

      if (image.complete && image.naturalWidth > 0) {
        finish();
        return;
      }

      if (typeof image.decode === "function") {
        image.decode().then(() => finish()).catch(() => {
          // Some ChromeOS image decoders reject decode() but still emit load.
        });
      }
    });
  };

  const safeApplyProcessor = async (
    track: LocalVideoTrack,
    mode: FxMode,
    blur: number,
    bgUrl: string,
    correction: PublishedColorCorrection = effectiveColorCorrection,
  ) => {
    // Color correction alone only needs LiveKit's generic video processor.
    // MediaPipe/WebGL background support is required only for blur/background.
    if (mode !== "off") ensureFxSupportedOrThrow();

    const normalizedBlur = normalizeFxBlurStrength(blur, firefoxSafeFx);
    const effectSignature =
      mode === "off"
        ? "off"
        : mode === "blur"
          ? `blur:${normalizedBlur}`
          : `bg:${String(bgUrl || DEFAULT_BG_DATA_URL)}`;
    const signature = `${effectSignature}:color:${publishedColorCorrectionSignature(correction)}`;
    if (activeFxSignaturesRef.current.get(track) === signature) return;

    const pendingOperation = pendingFxOperationsRef.current.get(track);
    if (
      pendingOperation &&
      pendingFxSignaturesRef.current.get(track) === signature
    ) {
      await pendingOperation;
      return;
    }

    const previousOperation = pendingOperation?.catch(() => { });
    const operation = (previousOperation || Promise.resolve()).then(async () => {
      if (activeFxSignaturesRef.current.get(track) === signature) return;

      // Decode the image while the current processor keeps rendering. The
      // processor is switched only after the next background is locally ready.
      if (mode === "bg") {
        await waitForBackgroundImage(bgUrl || DEFAULT_BG_DATA_URL);
      }

      const currentProcessor = (track as any).getProcessor?.() as
        | {
          name?: string;
          switchTo?: (options: Record<string, unknown>) => Promise<void>;
          setColorCorrection?: (
            correction: PublishedColorCorrection,
          ) => Promise<void>;
        }
        | undefined;

      // PersonColorBackgroundProcessor can update its transformer in place. This
      // keeps the old processed stream (and old image) visible until the new
      // image has loaded, so the raw camera never flashes between backgrounds.
      if (mode !== "off" && typeof currentProcessor?.switchTo === "function") {
        if (mode === "blur") {
          await currentProcessor.switchTo({
            mode: "background-blur",
            blurRadius: normalizedBlur,
          });
        } else {
          await currentProcessor.switchTo({
            mode: "virtual-background",
            imagePath: bgUrl || DEFAULT_BG_DATA_URL,
          });
        }
        await currentProcessor.setColorCorrection?.(correction);

        activeFxSignaturesRef.current.set(track, signature);
        return;
      }

      if (mode === "off") {
        if (
          !isPublishedColorCorrectionIdentity(correction) &&
          currentProcessor?.name === "published-color-correction" &&
          typeof currentProcessor.setColorCorrection === "function"
        ) {
          await currentProcessor.setColorCorrection(correction);
          activeFxSignaturesRef.current.set(track, signature);
          return;
        }

        await stopAnyProcessor(track);
        if (!isPublishedColorCorrectionIdentity(correction)) {
          const colorProcessor =
            createPublishedColorCorrectionProcessor(correction);
          await (track as any).setProcessor(colorProcessor, true);
        }
        activeFxSignaturesRef.current.set(track, signature);
        return;
      }

      if (firefoxSafeFx) {
        await delay(90);
      }

      const proc = makeProcessorForMode(
        mode,
        normalizedBlur,
        bgUrl,
        correction,
      );
      if (proc) {
        // LiveKit initializes the replacement before releasing the current
        // processor. Do not call stopProcessor() first: that exposes the raw
        // camera while the replacement pipeline is warming up.
        await (track as any).setProcessor(proc, true);
      }

      activeFxSignaturesRef.current.set(track, signature);
    });

    pendingFxSignaturesRef.current.set(track, signature);
    pendingFxOperationsRef.current.set(track, operation);

    try {
      await operation;
    } finally {
      if (pendingFxOperationsRef.current.get(track) === operation) {
        pendingFxOperationsRef.current.delete(track);
        pendingFxSignaturesRef.current.delete(track);
      }
    }
  };

  // pre-join helpers
  const cleanupPrejoinPreparedVideoTrack = async () => {
    const t = prejoinPreparedVideoTrackRef.current as any;
    prejoinPreparedVideoTrackRef.current = null;
    lastPrejoinFxSignatureRef.current = "";
    if (t) {
      activeFxSignaturesRef.current.delete(t);
      pendingFxSignaturesRef.current.delete(t);
      pendingFxOperationsRef.current.delete(t);
    }

    if (!t) return;

    try {
      await stopAnyProcessor(t);
    } catch { }

    try {
      t.stop?.();
    } catch { }

    setPrejoinPreviewVersion((v) => v + 1);
  };

  const createPrejoinPreparedVideoTrackNow = async (opts?: {
    force?: boolean;
  }) => {
    const pj = prejoinRef.current;
    const current = prejoinPreparedVideoTrackRef.current as any;

    if (!pj.videoEnabled) {
      if (current) {
        await cleanupPrejoinPreparedVideoTrack();
      }
      return null;
    }

    if (!opts?.force && current) {
      const currentDeviceId = String(
        current?.mediaStreamTrack?.getSettings?.().deviceId || "",
      ).trim();
      const wantedDeviceId = String(pj.videoInputId || "").trim();

      if (!wantedDeviceId || currentDeviceId === wantedDeviceId) {
        return current;
      }
    }

    await cleanupPrejoinPreparedVideoTrack();

    const isMobileOrTablet = lowPowerMobileMode;
    const safariCamera = isSafariLike();
    const wantedVideoDeviceId = String(pj.videoInputId || "").trim();

    const buildTrack = async (args: {
      width: number;
      height: number;
      fps: number;
      useExactDeviceId: boolean;
    }) => {
      return await createLocalVideoTrack({
        deviceId:
          args.useExactDeviceId && wantedVideoDeviceId
            ? wantedVideoDeviceId
            : undefined,
        resolution: {
          width: args.width,
          height: args.height,
        },
        frameRate: args.fps,
      } as any);
    };

    try {
      let track: LocalVideoTrack | null = null;

      try {
        track = await buildTrack({
          width: prejoinPreviewPreset.width,
          height: prejoinPreviewPreset.height,
          fps: prejoinPreviewPreset.fps,
          // WebKit can rotate camera deviceIds when permission is granted. The
          // browser default is substantially more reliable for Safari/iPad; the
          // picker can be refreshed after capture exposes stable device labels.
          useExactDeviceId: !isMobileOrTablet && !safariCamera,
        });
      } catch (firstError) {
        console.warn("prejoin preview primary create failed:", firstError);

        try {
          track = await buildTrack({
            width:
              isMobileOrTablet || safariCamera
                ? 480
                : prejoinPreviewPreset.width,
            height:
              isMobileOrTablet || safariCamera
                ? 270
                : prejoinPreviewPreset.height,
            fps: isMobileOrTablet || safariCamera ? 12 : prejoinPreviewPreset.fps,
            useExactDeviceId: false,
          });
        } catch (constrainedFallbackError) {
          // A physical camera already opened by another Chrome tab may be
          // shareable only in the capture format that tab negotiated. Let the
          // browser reuse that format instead of requiring our resolution/FPS.
          console.warn(
            "prejoin constrained fallback failed; retrying unconstrained camera:",
            constrainedFallbackError,
          );
          track = await createLocalVideoTrack({} as any);
        }
      }

      prejoinPreparedVideoTrackRef.current = track;
      const preparedMediaTrack = getMediaStreamTrackFromLiveKitTrack(track);
      if (preparedMediaTrack) {
        preparedMediaTrack.addEventListener(
          "ended",
          () => {
            // cleanupPrejoinPreparedVideoTrack clears the ref before stopping
            // the track, so only an unexpected browser/device stop reaches here.
            if (prejoinPreparedVideoTrackRef.current !== track) return;
            prejoinPreparedVideoTrackRef.current = null;
            lastPrejoinFxSignatureRef.current = "";
            setDeviceError(
              "The camera stopped unexpectedly. Select Camera on to reconnect it.",
            );
            setPrejoinPreviewVersion((v) => v + 1);
          },
          { once: true },
        );
      }
      setDeviceError("");
      setPrejoinPreviewVersion((v) => v + 1);
      return track;
    } catch (e: any) {
      console.warn("createPrejoinPreparedVideoTrack failed:", e);
      setDeviceError(String(e?.message || e || "camera_preview_failed"));
      return null;
    }
  };

  const createPrejoinPreparedVideoTrack = async (opts?: {
    force?: boolean;
  }) => {
    // ChromeOS may still be opening the camera when the user selects a
    // background. Reuse that creation instead of opening a second camera track.
    const pending = prejoinTrackCreationPromiseRef.current;
    if (pending) return await pending;

    const operation = createPrejoinPreparedVideoTrackNow(opts);
    prejoinTrackCreationPromiseRef.current = operation;

    try {
      return await operation;
    } finally {
      if (prejoinTrackCreationPromiseRef.current === operation) {
        prejoinTrackCreationPromiseRef.current = null;
      }
    }
  };

  const applyPrejoinVideoFx = async (mode: FxMode, backgroundUrl?: string) => {
    setFxError("");
    setFxApplying(true);
    setFxStatusText("");

    try {
      const pj = prejoinRef.current;
      if (shouldDisableBackgroundFx) {
        throw new Error("Background effects are disabled on mobile/tablet devices");
      }
      if (!pj.videoEnabled) throw new Error("Turn camera on in pre-join first");

      let track = prejoinPreparedVideoTrackRef.current;
      if (!track) track = await createPrejoinPreparedVideoTrack();
      if (!track) throw new Error("Pre-join camera track is not ready");
      const currentTrackId = String(
        (track as any)?.mediaStreamTrack?.id || "",
      ).trim();
      if (!currentTrackId) {
        throw new Error("Pre-join camera track id is missing");
      }

      const nextBgImageUrl = backgroundUrl || bgImageUrl;
      const sig = `${mode}|${blurStrength}|${nextBgImageUrl}|${String(
        (track as any)?.mediaStreamTrack?.id || "",
      )}`;

      if (lastPrejoinFxSignatureRef.current === sig) {
        setFxApplying(false);
        return;
      }

      await safeApplyProcessor(track, mode, blurStrength, nextBgImageUrl);
      lastPrejoinFxSignatureRef.current = sig;

      setVideoFxMode(mode);
      setFxStatusText(
        mode === "off"
          ? "FX disabled"
          : mode === "blur"
            ? `Blur applied (${blurStrength})`
            : "Virtual background applied",
      );
      setPrejoinPreviewVersion((v) => v + 1);
    } catch (e: any) {
      console.error("applyPrejoinVideoFx failed:", e);
      setFxError(String(e?.message || e || "prejoin_video_fx_failed"));
    } finally {
      setFxApplying(false);
    }
  };

  const initPrejoinPreview = async (opts?: {
    forceTrack?: boolean;
  }) => {
    if (prejoinPreviewInitInFlightRef.current) return;
    prejoinPreviewInitInFlightRef.current = true;

    try {
      const pj = prejoinRef.current;

      if (!pj.videoEnabled) return;

      await createPrejoinPreparedVideoTrack({ force: !!opts?.forceTrack });

      if (!shouldDisableBackgroundFx && videoFxMode !== "off") {
        await applyPrejoinVideoFx(videoFxMode);
      }
    } finally {
      prejoinPreviewInitInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (loading) return;
    if (!session) return;
    if (!sessionId) return;
    if (!authReady) return;
    if (!authUserId) return;
    if (activeBan) return;
    if (joinRequested) return;
    if (joinFlowStartedRef.current) return;
    if (prejoinBootstrappedSessionIdRef.current === sessionId) return;

    prejoinBootstrappedSessionIdRef.current = sessionId;

    // The recovery lease is intentionally device-agnostic. Desktop browsers can
    // suspend a background tab or lose the signalling socket during screen share
    // just as mobile browsers can.
    const mobileLease = readMobileRoomLease(sessionId, authUserId);

    if (mobileLease) {
      const restoredPrejoin = {
        ...prejoinRef.current,
        audioEnabled: mobileLease.audioEnabled,
        videoEnabled: mobileLease.videoEnabled,
      };

      prejoinRef.current = restoredPrejoin;
      setPrejoin(restoredPrejoin);
      joinFlowStartedRef.current = true;
      connectingFromPrejoinRef.current = false;
      returningFromBackgroundRef.current = true;
      pageHiddenAtRef.current = mobileLease.lastSeenAt;
      setPrejoinOpen(false);
      setJoinRequested(true);
      return;
    }

    setPrejoinOpen(true);
    setDeviceError("");

    let cancelled = false;

    (async () => {
      await loadBrowserDevices({ preserveSelection: true }).catch(() => { });

      if (cancelled) return;

      try {
        await initPrejoinPreview({
          forceTrack: false,
        });
      } catch (e) {
        console.warn("prejoin preview init failed", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    loading,
    session,
    sessionId,
    authReady,
    authUserId,
    activeBan,
    joinRequested,
    loadBrowserDevices,
    deviceTier,
    lowPowerMobileMode,
  ]);

  useEffect(() => {
    if (!prejoinOpen) return;

    const pj = prejoinRef.current;
    if (!pj.videoEnabled) return;

    const t = window.setTimeout(async () => {
      try {
        await initPrejoinPreview({
          forceTrack: true,
        });
      } catch (e) {
        console.warn("prejoin camera switch failed", e);
      }
    }, 180);

    return () => window.clearTimeout(t);
  }, [
    prejoin.videoInputId,
    prejoinOpen,
    deviceTier,
    isMobileQuery,
    isTabletQuery,
  ]);

  useEffect(() => {
    if (!prejoinOpen) return;

    if (!prejoin.videoEnabled) {
      cleanupPrejoinPreparedVideoTrack().catch(() => { });
      return;
    }

    (async () => {
      try {
        await initPrejoinPreview({
          forceTrack: false,
        });
      } catch (e) {
        console.warn("prejoin video enable failed", e);
      }
    })();
  }, [
    prejoin.videoEnabled,
    prejoinOpen,
    deviceTier,
    isMobileQuery,
    isTabletQuery,
  ]);

  useEffect(() => {
    if (!settingsOpen) return;
    if (!prejoinOpen) return;
    if (!prejoinRef.current.videoEnabled) return;

    if (prejoinPreparedVideoTrackRef.current) {
      setSettingsPreviewVersion((v) => v + 1);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        await initPrejoinPreview({
          forceTrack: false,
        });

        if (!cancelled) {
          setSettingsPreviewVersion((v) => v + 1);
        }
      } catch (e) {
        console.warn("settings preview init failed", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    settingsOpen,
    prejoinOpen,
    prejoin.videoEnabled,
    deviceTier,
    isMobileQuery,
    isTabletQuery,
  ]);

  useEffect(() => {
    if (!prejoinOpen) return;
    if (!prejoin.videoEnabled) return;
    if (shouldDisableBackgroundFx) return;
    if (videoFxMode === "off") return;
    if (!prejoinPreparedVideoTrackRef.current) return;

    applyPrejoinVideoFx(videoFxMode).catch((e) => {
      console.warn("prejoin fx refresh failed", e);
    });
  }, [
    videoFxMode,
    blurStrength,
    bgImageUrl,
    prejoinOpen,
    prejoin.videoEnabled,
    shouldDisableBackgroundFx,
  ]);

  const roomPolicies = useMemo(
    () => readSessionRoomPolicies(session),
    [
      session?.camera_required,
      session?.public_chat_disabled,
      session?.schedule,
    ],
  );

  const isHost = useMemo(() => {
    if (!authUserId) return false;
    const hostId =
      (session as any)?.host_profile?.id || (session as any)?.host_id;
    return !!hostId && String(hostId) === String(authUserId);
  }, [authUserId, session]);

  const hasValidActiveRoomHostLease = useMemo(() => {
    if (!activeRoomHostLease?.expires_at) return false;
    const expiresAt = new Date(activeRoomHostLease.expires_at).getTime();
    return Number.isFinite(expiresAt) && expiresAt > activeRoomHostClock;
  }, [activeRoomHostLease, activeRoomHostClock]);

  const isTemporaryRoomHost = useMemo(() => {
    if (!authUserId || !hasValidActiveRoomHostLease) return false;
    return (
      String(activeRoomHostLease?.user_id || "").toLowerCase() ===
      String(authUserId).toLowerCase()
    );
  }, [activeRoomHostLease?.user_id, authUserId, hasValidActiveRoomHostLease]);

  const canEditRoomTimeline = isHost || isTemporaryRoomHost;

  useEffect(() => {
    if (!isFreeFlowRoom || !canEditRoomTimeline || !sessionId) return;
    const key = `mysession:free-flow-intro:${sessionId}:${authUserId || "host"}`;
    if (window.localStorage.getItem(key) === "seen") return;
    setFreeFlowIntroOpen(true);
  }, [authUserId, canEditRoomTimeline, isFreeFlowRoom, sessionId]);

  const isSelfModerator = useMemo(() => {
    if (!authUserId) return false;
    if (isHost || isTemporaryRoomHost || isSuperAdmin) return true;
    return moderatorUserIds.includes(String(authUserId).toLowerCase());
  }, [
    authUserId,
    isHost,
    isSuperAdmin,
    isTemporaryRoomHost,
    moderatorUserIds,
  ]);

  const loadModerators = useCallback(
    async (sessionId: string, opts?: { force?: boolean }) => {
      const sid = String(sessionId || "").trim();
      if (!sid) return;

      const now = Date.now();
      const sameSession = lastModeratorsLoadSessionIdRef.current === sid;

      // This used to be polled every 3 seconds and was showing up heavily in
      // Supabase PostgREST egress. Keep an initial forced load, then rely on
      // Realtime/local optimistic updates. Non-forced reloads are deduped hard.
      if (
        !opts?.force &&
        sameSession &&
        now - lastModeratorsLoadAtRef.current < 60_000
      ) {
        return;
      }

      if (loadModeratorsInFlightRef.current) return;

      loadModeratorsInFlightRef.current = true;
      lastModeratorsLoadAtRef.current = now;
      lastModeratorsLoadSessionIdRef.current = sid;

      setRolesError("");
      setRolesLoading(true);

      try {
        const { data, error } = await supabase
          .from("session_role_assignments")
          .select("user_id, role")
          .eq("session_id", sid)
          .eq("role", "moderator");

        if (error) throw error;

        const ids = uniqStrings(
          (data || []).map((r: any) => String(r?.user_id || "")),
        );
        setModeratorUserIds(ids);
      } catch (e: any) {
        console.error("loadModerators failed:", e);
        setRolesError(String(e?.message || e || "failed_to_load_roles"));
        setModeratorUserIds([]);
      } finally {
        loadModeratorsInFlightRef.current = false;
        setRolesLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!session?.id) return;
    loadModerators(String(session.id), { force: true }).catch(() => { });
  }, [session?.id, loadModerators]);

  useEffect(() => {
    if (!session?.id) return;

    const sid = String(session.id);

    const ch = supabase
      .channel(`session-role-assignments:${sid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "session_role_assignments",
          filter: `session_id=eq.${sid}`,
        },
        (payload: any) => {
          const eventType = String(
            payload?.eventType || payload?.type || "",
          ).toUpperCase();
          const nextRow = payload?.new || {};
          const oldRow = payload?.old || {};

          const nextRole = String(nextRow?.role || "").toLowerCase();
          const oldRole = String(oldRow?.role || "").toLowerCase();
          const nextUserId = String(nextRow?.user_id || "").toLowerCase();
          const oldUserId = String(oldRow?.user_id || "").toLowerCase();

          if (
            (eventType === "INSERT" || eventType === "UPDATE") &&
            nextRole === "moderator" &&
            looksLikeUuid(nextUserId)
          ) {
            setModeratorUserIds((prev) => uniqStrings([...prev, nextUserId]));
            return;
          }

          if (
            eventType === "DELETE" &&
            oldRole === "moderator" &&
            looksLikeUuid(oldUserId)
          ) {
            setModeratorUserIds((prev) => prev.filter((x) => x !== oldUserId));
            return;
          }

          // Fallback for unexpected payload shapes, but throttled by loadModerators.
          void loadModerators(sid);
        },
      )
      .subscribe();

    return () => {
      safeRemoveRealtimeChannel(ch);
    };
  }, [session?.id, loadModerators]);

  const grantModerator = async (userId: string) => {
    if (!session?.id) return;
    if (!authUserId) return;
    const uid = String(userId || "").toLowerCase();
    if (!looksLikeUuid(uid)) return;

    setRolesError("");
    setRoleBusyKey(`mod:${uid}:grant`);
    try {
      const payload: SessionRoleAssignmentRow = {
        session_id: session.id,
        user_id: uid,
        role: "moderator",
        granted_by: authUserId,
      };
      const { error } = await supabase
        .from("session_role_assignments")
        .insert(payload as any);
      if (error) throw error;
      setModeratorUserIds((prev) => uniqStrings([...prev, uid]));
    } catch (e: any) {
      console.error("grantModerator failed:", e);
      setRolesError(String(e?.message || e || "grant_failed"));
      alert(String(e?.message || e || "grant_failed"));
    } finally {
      setRoleBusyKey("");
    }
  };

  const revokeModerator = async (userId: string) => {
    if (!session?.id) return;
    const uid = String(userId || "").toLowerCase();
    if (!looksLikeUuid(uid)) return;

    setRolesError("");
    setRoleBusyKey(`mod:${uid}:revoke`);
    try {
      const { error } = await supabase
        .from("session_role_assignments")
        .delete()
        .eq("session_id", session.id)
        .eq("user_id", uid)
        .eq("role", "moderator");
      if (error) throw error;
      setModeratorUserIds((prev) => prev.filter((x) => x !== uid));
    } catch (e: any) {
      console.error("revokeModerator failed:", e);
      setRolesError(String(e?.message || e || "revoke_failed"));
      alert(String(e?.message || e || "revoke_failed"));
    } finally {
      setRoleBusyKey("");
    }
  };

  // identity refs
  const baseUserIdRef = useRef<string>("");
  const livekitIdentityRef = useRef<string>("");

  // tab presence
  const tabPresenceKeyRef = useRef<string>("");
  const tabPresenceAcquiredRef = useRef<boolean>(false);
  const tabPresenceHeartbeatRef = useRef<number | null>(null);
  const tabPresenceChannelRef = useRef<any>(null);

  // kick / system notice
  const [systemNotice, setSystemNotice] = useState<RoomSystemNotice>({
    open: false,
    kind: "info",
    title: "",
    body: "",
  });
  const [kickRedirecting, setKickRedirecting] = useState(false);
  const kickEventChannelRef = useRef<any>(null);
  const kickedBySignalRef = useRef(false);
  const cameraPolicyTimerRef = useRef<number | null>(null);
  // Attendance is a TTL lease, not a realtime media signal. Thirty seconds is
  // well below the 90-second live-user window and avoids needless PostgREST
  // writes while preserving immediate heartbeats on join/background recovery.
  const ATT_HEARTBEAT_MS = 30_000;

  const attendanceHbTimerRef = useRef<number | null>(null);
  const attendanceHeartbeatGenerationRef = useRef(0);
  const attendanceHeartbeatPromiseRef = useRef<Promise<void> | null>(null);
  const attendanceLastSuccessAtRef = useRef<number | null>(null);
  const attendanceActiveRef = useRef(false);
  const leaveOnceRef = useRef(false);
  const leavePromiseRef = useRef<Promise<void> | null>(null);
  const unexpectedDisconnectRecoveryTimerRef = useRef<number | null>(null);

  // Browser/app-switch recovery. Backgrounding a tab is NOT the same as Leave.
  const explicitLeaveRequestedRef = useRef(false);
  const pageHiddenAtRef = useRef<number | null>(null);
  const returningFromBackgroundRef = useRef(false);
  const connectedRef = useRef(false);
  const joinRequestedRef = useRef(false);
  const autoClosedSessionIdRef = useRef<string>("");
  const mobileRoomRetentionRef = useRef({
    enabled: false,
    sessionId: "",
    userId: "",
  });
  mobileRoomRetentionRef.current = {
    enabled: !!sessionId && !!authUserId,
    sessionId,
    userId: String(authUserId || ""),
  };

  const stopTabPresenceHeartbeat = () => {
    if (tabPresenceHeartbeatRef.current) {
      window.clearInterval(tabPresenceHeartbeatRef.current);
      tabPresenceHeartbeatRef.current = null;
    }
  };

  const releaseTabPresence = () => {
    stopTabPresenceHeartbeat();
    const key = tabPresenceKeyRef.current;
    if (!key) return;
    if (!tabPresenceAcquiredRef.current) return;
    tabPresenceAcquiredRef.current = false;
    try {
      releaseTabSlot(key, tabId);
    } catch { }
    try {
      if (tabPresenceChannelRef.current)
        tabPresenceChannelRef.current.close?.();
    } catch { }
    tabPresenceChannelRef.current = null;
  };

  const startTabPresenceHeartbeat = () => {
    stopTabPresenceHeartbeat();
    const key = tabPresenceKeyRef.current;
    if (!key) return;
    if (!tabPresenceAcquiredRef.current) return;

    tabPresenceHeartbeatRef.current = window.setInterval(() => {
      try {
        refreshTabSlot(key, tabId);
        try {
          tabPresenceChannelRef.current?.postMessage?.({ t: nowMs(), tabId });
        } catch { }
      } catch { }
    }, LK_TAB_HEARTBEAT_MS);
  };

  useEffect(() => {
    const markMaybeBackgrounded = () => {
      // A browser cannot reliably distinguish closing a tab from switching
      // apps, especially on iOS/iPadOS. Neither pagehide nor beforeunload is an
      // explicit Leave action. Preserve room presence and let LiveKit recover.
      pageHiddenAtRef.current = Date.now();
      returningFromBackgroundRef.current = true;

      writeMobileRoomLease(sessionId, authUserId, {
        audioEnabled: prejoinRef.current.audioEnabled,
        videoEnabled: prejoinRef.current.videoEnabled,
      });

      try {
        void attendanceHeartbeat();
      } catch {
        // ignore
      }
    };

    const onBeforeUnload = () => {
      if (explicitLeaveRequestedRef.current) {
        releaseTabPresence();
        void leaveAttendanceOnce({ keepalive: true });
        return;
      }

      markMaybeBackgrounded();
    };

    const onPageHide = () => {
      if (explicitLeaveRequestedRef.current) {
        releaseTabPresence();
        void leaveAttendanceOnce({ keepalive: true });
        return;
      }

      markMaybeBackgrounded();
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [sessionId, authUserId]);

  const buildAuthHeaders = async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const cachedAccessToken = String(accessTokenRef.current || "").trim();
    if (cachedAccessToken) {
      headers.Authorization = `Bearer ${cachedAccessToken}`;
      return headers;
    }

    try {
      const { data } = await supabase.auth.getSession();
      const fallbackAccessToken = String(
        data.session?.access_token || "",
      ).trim();

      if (fallbackAccessToken) {
        accessTokenRef.current = fallbackAccessToken;
        headers.Authorization = `Bearer ${fallbackAccessToken}`;
      }
    } catch { }

    return headers;
  };

  const startAttendanceHeartbeat = () => {
    if (attendanceHbTimerRef.current) return;

    attendanceHeartbeatGenerationRef.current += 1;
    roomLifecycleDiagnosticRef.current("heartbeat.started", {
      interval_ms: ATT_HEARTBEAT_MS,
      generation: attendanceHeartbeatGenerationRef.current,
      last_success_at: attendanceLastSuccessAtRef.current
        ? new Date(attendanceLastSuccessAtRef.current).toISOString()
        : null,
    });
    attendanceHbTimerRef.current = window.setInterval(() => {
      void attendanceHeartbeat();
    }, ATT_HEARTBEAT_MS);
  };

  const stopAttendanceHeartbeat = () => {
    attendanceHeartbeatGenerationRef.current += 1;
    if (attendanceHbTimerRef.current) {
      window.clearInterval(attendanceHbTimerRef.current);
      attendanceHbTimerRef.current = null;
    }
    roomLifecycleDiagnosticRef.current("heartbeat.stopped", {
      generation: attendanceHeartbeatGenerationRef.current,
      last_success_at: attendanceLastSuccessAtRef.current
        ? new Date(attendanceLastSuccessAtRef.current).toISOString()
        : null,
    });
  };

  const recordInfiniteRoomDailyAttendance = async () => {
    if (!isInfiniteRoom || !session?.id || !authUserId) return;

    const timezone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    try {
      const { error } = await supabase.rpc(
        "record_infinite_room_daily_attendance",
        {
          p_session_id: session.id,
          p_timezone: timezone,
        },
      );

      if (error) {
        const code = String((error as any)?.code || "");
        // During rollout the frontend can safely ship before the SQL function.
        // Presence remains operational; daily counting starts once SQL is applied.
        if (code !== "42883" && code !== "PGRST202") {
          console.warn(
            "[attendance] infinite daily attendance was not recorded:",
            error,
          );
        }
      }
    } catch (error) {
      console.warn(
        "[attendance] infinite daily attendance request failed:",
        error,
      );
    }
  };

  const attendanceJoin = async () => {
    if (!session?.id || !authUserId) return;

    roomLifecycleDiagnosticRef.current("attendance.join_started");
    const nowIso = new Date().toISOString();

    // This RPC is idempotent for user + infinite room + local calendar day.
    // It is deliberately independent from the live-presence row below.
    void recordInfiniteRoomDailyAttendance();

    try {
      const { error } = await supabase.rpc("attendance_join", {
        p_session_id: session.id,
      });

      if (!error) {
        attendanceActiveRef.current = true;
        leaveOnceRef.current = false;
        roomLifecycleDiagnosticRef.current("attendance.join_succeeded", {
          method: "rpc",
        });
        return;
      }
    } catch { }

    try {
      const { error } = await supabase.from("session_attendance").upsert(
        {
          session_id: session.id,
          user_id: authUserId,
          joined_at: nowIso,
          left_at: null,
          last_seen_at: nowIso,
        },
        { onConflict: "session_id,user_id" },
      );

      if (!error) {
        attendanceActiveRef.current = true;
        leaveOnceRef.current = false;
        roomLifecycleDiagnosticRef.current("attendance.join_succeeded", {
          method: "upsert",
        });
      } else {
        roomLifecycleDiagnosticRef.current("attendance.join_failed", {
          method: "upsert",
          code: String(error?.code || ""),
        });
      }
    } catch (error) {
      roomLifecycleDiagnosticRef.current("attendance.join_failed", {
        method: "upsert",
        message: getUnknownErrorMessage(error),
      });
    }
  };

  const attendanceHeartbeat = (): Promise<void> => {
    if (!session?.id || !authUserId || !attendanceActiveRef.current) {
      return Promise.resolve();
    }
    if (attendanceHeartbeatPromiseRef.current) {
      return attendanceHeartbeatPromiseRef.current;
    }

    const generation = attendanceHeartbeatGenerationRef.current;
    const nowIso = new Date().toISOString();
    const heartbeatPromise = (async () => {
      try {
        const { error } = await supabase.rpc("attendance_heartbeat", {
          p_session_id: session.id,
        });

        if (!error) {
          attendanceLastSuccessAtRef.current = Date.now();
          roomLifecycleDiagnosticRef.current("heartbeat.succeeded", {
            generation,
            method: "rpc",
          });
          return;
        }

        if (
          generation !== attendanceHeartbeatGenerationRef.current ||
          !attendanceActiveRef.current
        ) {
          return;
        }

        const { error: fallbackError } = await supabase
          .from("session_attendance")
          .update({
            last_seen_at: nowIso,
            left_at: null,
          })
          .eq("session_id", session.id)
          .eq("user_id", authUserId);

        if (fallbackError) throw fallbackError;
        attendanceLastSuccessAtRef.current = Date.now();
        roomLifecycleDiagnosticRef.current("heartbeat.succeeded", {
          generation,
          method: "update",
        });
      } catch (error) {
        roomLifecycleDiagnosticRef.current("heartbeat.failed", {
          generation,
          message: getUnknownErrorMessage(error),
          last_success_at: attendanceLastSuccessAtRef.current
            ? new Date(attendanceLastSuccessAtRef.current).toISOString()
            : null,
        });
      }
    })().finally(() => {
      if (attendanceHeartbeatPromiseRef.current === heartbeatPromise) {
        attendanceHeartbeatPromiseRef.current = null;
      }
    });

    attendanceHeartbeatPromiseRef.current = heartbeatPromise;
    return heartbeatPromise;
  };

  const attendanceLeave = async () => {
    const wasActive = attendanceActiveRef.current;
    attendanceActiveRef.current = false;
    stopAttendanceHeartbeat();

    if (!session?.id || !authUserId || !wasActive) return;

    roomLifecycleDiagnosticRef.current("attendance.leave_started");
    await attendanceHeartbeatPromiseRef.current?.catch(() => { });
    const nowIso = new Date().toISOString();

    try {
      const { error } = await supabase.rpc("attendance_leave", {
        p_session_id: session.id,
      });

      if (!error) {
        roomLifecycleDiagnosticRef.current("attendance.leave_succeeded", {
          method: "rpc",
        });
        return;
      }
    } catch { }

    try {
      await supabase
        .from("session_attendance")
        .update({
          left_at: nowIso,
          last_seen_at: nowIso,
        })
        .eq("session_id", session.id)
        .eq("user_id", authUserId);
    } catch { }

    attendanceActiveRef.current = false;
    roomLifecycleDiagnosticRef.current("attendance.leave_succeeded", {
      method: "update",
    });
  };

  const keepaliveLeaveWrite = () => {
    try {
      if (!session?.id || !authUserId) return;
      if (!attendanceActiveRef.current) return;

      const supabaseUrl = String(
        (import.meta as any).env.VITE_SUPABASE_URL || "",
      ).trim();
      const anonKey = String(
        (import.meta as any).env.VITE_SUPABASE_ANON_KEY || "",
      ).trim();
      const token = String(accessTokenRef.current || "").trim();

      if (!supabaseUrl || !anonKey || !token) return;

      const nowIso = new Date().toISOString();
      const url =
        `${supabaseUrl}/rest/v1/session_attendance` +
        `?session_id=eq.${encodeURIComponent(session.id)}` +
        `&user_id=eq.${encodeURIComponent(authUserId)}`;

      void fetch(url, {
        method: "PATCH",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          left_at: nowIso,
          last_seen_at: nowIso,
        }),
        keepalive: true as any,
      }).catch(() => { });
    } catch { }
  };

  const leaveAttendanceOnce = (opts: { keepalive?: boolean } = {}) => {
    if (opts.keepalive) {
      keepaliveLeaveWrite();
    }

    if (leavePromiseRef.current) {
      return leavePromiseRef.current;
    }

    if (leaveOnceRef.current) {
      return Promise.resolve();
    }

    leaveOnceRef.current = true;

    const p = (async () => {
      try {
        await attendanceLeave();
      } catch { }
    })();

    leavePromiseRef.current = p;
    return p;
  };

  const tryAcquireTabGate = (sessionId: string, baseUserId: string) => {
    const maxTabs = Math.max(
      1,
      Math.min(
        20,
        Number(
          (import.meta as any)?.env?.VITE_LIVEKIT_MAX_TABS ||
          LK_MAX_TABS_DEFAULT,
        ) || LK_MAX_TABS_DEFAULT,
      ),
    );
    const key = makeTabPresenceKey(sessionId, baseUserId);

    tabPresenceKeyRef.current = key;

    try {
      if (typeof (window as any).BroadcastChannel === "function") {
        const ch = new (window as any).BroadcastChannel(key);
        tabPresenceChannelRef.current = ch;
        ch.onmessage = () => {
          try {
            const p = prunePresence(readPresence(key));
            writePresence(key, { v: (p.v || 1) + 1, tabs: p.tabs || [] });
          } catch { }
        };
      }
    } catch {
      tabPresenceChannelRef.current = null;
    }

    const res = acquireTabSlot(key, tabId, maxTabs);

    if (!res.ok) {
      tabPresenceAcquiredRef.current = false;
      try {
        if (tabPresenceChannelRef.current)
          tabPresenceChannelRef.current.close?.();
      } catch { }
      tabPresenceChannelRef.current = null;
      return { ok: false, max: res.max, count: res.count };
    }

    tabPresenceAcquiredRef.current = true;
    startTabPresenceHeartbeat();
    return { ok: true, max: res.max, count: res.count };
  };

  // ---- continue in chunk 2 ----
  const requestToken = async () => {
    if (!session) return;

    if (tokenRequestInFlightRef.current) {
      const deadline = Date.now() + 20_000;
      while (tokenRequestInFlightRef.current && Date.now() < deadline) {
        await delay(100);
      }

      const pendingToken = String(lkTokenRef.current || "").trim();
      const pendingUrl = String(lkServerUrlRef.current || "").trim();
      return pendingToken && pendingUrl
        ? { token: pendingToken, url: pendingUrl }
        : undefined;
    }

    tokenRequestInFlightRef.current = true;
    setTokenError("");
    setTokenLoading(true);
    const tokenRequestStartedAt = Date.now();
    roomLifecycleDiagnosticRef.current("token.fetch_started");

    try {
      const pj = prejoinRef.current;
      const nameToUse =
        (pj.displayName || displayName || userName || "User").trim() || "User";
      const roomName = safeRoomName(`session-${session.id}`);

      const baseUser = safeIdentity(
        (authUserId && looksLikeUuid(authUserId)
          ? authUserId
          : authUserId || nameToUse) as any,
      );
      baseUserIdRef.current = baseUser;

      const identity = safeIdentity(`${baseUser}--${tabId}`);
      livekitIdentityRef.current = identity;

      console.log("[LK TAB DEBUG]", {
        sessionId: session.id,
        baseUser,
        tabId,
        identity,
      });

      if (!tabPresenceAcquiredRef.current) {
        const g = tryAcquireTabGate(session.id, baseUser);
        if (!g.ok) {
          const msg = `Too many tabs open for this room (${g.count}/${g.max}). Close another tab and try again.`;
          setTokenError(msg);
          setTokenLoading(false);

          joinFlowStartedRef.current = false;
          connectingFromPrejoinRef.current = false;

          try {
            alert(msg);
          } catch { }

          setPrejoinOpen(true);
          setJoinRequested(false);
          return;
        }
      }

      const res = await withTimeout(
        fetch(tokenEndpoint, {
          method: "POST",
          headers: await buildAuthHeaders(),
          body: JSON.stringify({
            roomName,
            identity,
            name: nameToUse,
            isHost,
            sessionId: session.id,
            isModerator:
              !isHost && !!authUserId
                ? moderatorUserIds.includes(String(authUserId).toLowerCase())
                : false,
            baseUserId: baseUser,
            tabId,
            inviteToken:
              new URLSearchParams(window.location.search).get("invite") ||
              undefined,
          }),
        }),
        ROOM_TOKEN_TIMEOUT_MS,
        "Preparing the room timed out. Please try again.",
      );

      const json = (await res.json().catch(() => ({}))) as {
        token?: string;
        url?: string;
        assignedServerId?: string | null;
        error?: string;
        message?: string;
        opensAt?: string | null;
        bookedCount?: number | null;
        maxParticipants?: number | null;
      };

      if (!res.ok) {
        const code = String(json?.error || "").trim();
        roomLifecycleDiagnosticRef.current("token.fetch_failed", {
          status: res.status,
          code,
          duration_ms: Date.now() - tokenRequestStartedAt,
        });

        if (code.toUpperCase() === "USER_BANNED") {
          const banFromToken: ActiveBan = {
            id: "token-ban",
            banned_user_id: String(authUserId || baseUser || ""),
            reason: String(
              (json as any)?.reason || "You are banned from MySession.",
            ),
            starts_at: String(
              (json as any)?.starts_at || new Date().toISOString(),
            ),
            expires_at: ((json as any)?.expires_at as string | null) || null,
            revoked_at: null,
          };

          setActiveBan(banFromToken);
          setTokenError("");
          setTokenLoading(false);
          setJoinRequested(false);
          setPrejoinOpen(false);
          joinFlowStartedRef.current = false;
          connectingFromPrejoinRef.current = false;
          return;
        }

        if (
          code === "BOOKED_GRACE_WINDOW_ACTIVE" ||
          code === "ROOM_RESERVED_FOR_BOOKED_USERS"
        ) {
          const opensAtRaw = String(json?.opensAt || "").trim();
          const opensAtLabel = opensAtRaw
            ? new Date(opensAtRaw).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
            : "";

          const msg = String(
            json?.message ||
            (opensAtLabel
              ? `This session is reserved for booked participants until ${opensAtLabel}. Unclaimed seats open 3 minutes after the session starts.`
              : "This session is currently reserved for booked participants. Unclaimed seats open 3 minutes after the session starts."),
          ).trim();

          console.warn("[LK admission blocked]", json);
          setTokenError(msg);
          setMediaWarning(msg);
          setTokenLoading(false);

          joinFlowStartedRef.current = false;
          connectingFromPrejoinRef.current = false;
          setJoinRequested(false);
          setPrejoinOpen(true);
          return;
        }

        const msg = String(
          json?.message || json?.error || `Token endpoint error: ${res.status}`,
        ).trim();
        console.error(msg, json);
        setTokenError(msg);
        setTokenLoading(false);
        return;
      }

      const tok = String(json.token || "").trim();
      const nextUrl = String(json.url || defaultLivekitUrl || "").trim();
      const nextAssignedServerId = String(json.assignedServerId || "").trim();

      if (!tok) {
        setTokenError("Token endpoint returned empty token");
        setTokenLoading(false);
        return;
      }

      if (!nextUrl) {
        setTokenError("Token endpoint returned empty LiveKit URL");
        setTokenLoading(false);
        return;
      }

      setLkToken(tok);
      setLkServerUrl(nextUrl);
      lkTokenRef.current = tok;
      lkServerUrlRef.current = nextUrl;
      setAssignedServerId(nextAssignedServerId);
      setTokenLoading(false);
      roomLifecycleDiagnosticRef.current("token.fetch_succeeded", {
        duration_ms: Date.now() - tokenRequestStartedAt,
        assigned_server_id: nextAssignedServerId || null,
        ...getJwtTimingWithoutToken(tok),
      });
      return { token: tok, url: nextUrl };
    } catch (e: any) {
      console.error("requestToken exception:", e);
      roomLifecycleDiagnosticRef.current("token.fetch_failed", {
        duration_ms: Date.now() - tokenRequestStartedAt,
        message: String(e?.message || e || ""),
      });
      setTokenError(String(e?.message || e || "token_request_failed"));
      setTokenLoading(false);

      joinFlowStartedRef.current = false;
      connectingFromPrejoinRef.current = false;
      setJoinRequested(false);
      setPrejoinOpen(true);
    } finally {
      tokenRequestInFlightRef.current = false;
    }
  };

  useEffect(() => {
    (async () => {
      if (joinBlocked) return;
      if (!canJoinNow) return;
      if (!session) return;
      if (!joinRequested) return;
      if (!authReady) return;
      if (!authUserId) return;
      if (activeBan) return;
      if (lkToken) return;
      await requestToken();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session,
    joinRequested,
    authReady,
    authUserId,
    activeBan,
    isHost,
    moderatorUserIds.join("|"),
  ]);
  useEffect(() => {
    if (!lkToken) return;
    setPrejoinOpen(false);
  }, [lkToken]);

  // ---- livekit room
  const roomRef = useRef<Room | null>(null);
  const prewarmedRoomRef = useRef<Room | null>(null);
  const [roomState, setRoomState] = useState<Room | null>(null);

  // The shared soundtrack belongs to the operational host/moderators. Every
  // participant gets a separate local player through the "For me" mode.
  const canControlRoomSoundtrack =
    connected && (isHost || isSelfModerator || isTemporaryRoomHost);
  const canUploadRoomSoundtrack = isHost || isSelfModerator;

  const publishSoundtrackPacket = async (packet: RoomSoundtrackPacket) => {
    const room = roomRef.current;
    if (!room || !connected) return;
    const payload = new TextEncoder().encode(JSON.stringify(packet));
    await room.localParticipant.publishData(payload, {
      reliable: true,
      topic: ROOM_SOUNDTRACK_TOPIC,
    });
  };

  const selectRoomSoundtrack = async (id: RoomSoundscapeId) => {
    if (!canControlRoomSoundtrack) return;
    const previous = soundscapeStateRef.current;
    const resumePosition =
      previous?.trackId === id && !previous.playing
        ? Math.max(0, previous.position)
        : 0;
    await playSoundscapeLocally(id, resumePosition);
    const next: RoomSoundtrackState = {
      trackId: id,
      duration: soundscapeEngineRef.current?.duration() || 0,
      volume: roomSoundscapeVolume,
      playing: true,
      position: resumePosition,
      updatedAt: Date.now(),
    };
    soundscapeStateRef.current = next;
    setCustomSoundscapeLabel(null);
    setActiveSoundscapeId(id);
    setSoundscapePlaying(true);
    setSoundscapePosition(resumePosition);
    await publishSoundtrackPacket({ type: "soundtrack_state", state: next });
  };

  const selectPersonalSoundtrack = async (id: RoomSoundscapeId) => {
    if (!connected || id === "custom") return;
    try {
      setSoundscapeBusy(true);
      setSoundscapeError(null);
      if (!personalSoundscapeEngineRef.current) {
        personalSoundscapeEngineRef.current = new RoomSoundscapeEngine();
      }
      const engine = personalSoundscapeEngineRef.current;
      engine.setMuted(
        personalSoundscapeMuted || soundscapeListeningMode === "room",
      );
      const resumePosition =
        personalSoundscapeId === id && !personalSoundscapePlaying
          ? personalSoundscapePosition
          : 0;
      await engine.play(id, soundscapeVolume / 100, resumePosition);
      setPersonalSoundscapeId(id);
      setPersonalSoundscapePlaying(true);
      setPersonalSoundscapePosition(engine.currentTime());
      setPersonalSoundscapeDuration(engine.duration());
    } catch (error) {
      setSoundscapeError(
        error instanceof Error
          ? error.message
          : "Your personal soundtrack could not be started.",
      );
    } finally {
      setSoundscapeBusy(false);
    }
  };

  const adjustRoomSoundtrackVolume = (rawVolume: number) => {
    if (!canControlRoomSoundtrack) return;
    const volume = Math.max(0, Math.min(100, Math.round(rawVolume)));
    setRoomSoundscapeVolume(volume);
    soundscapeEngineRef.current?.setVolume(volume / 100);

    const current = soundscapeStateRef.current;
    if (!current) return;
    const position = current.playing
      ? soundscapeEngineRef.current?.currentTime() ?? current.position
      : current.position;
    const next: RoomSoundtrackState = {
      ...current,
      volume,
      position,
      updatedAt: Date.now(),
    };
    soundscapeStateRef.current = next;
    if (soundscapeVolumePublishTimerRef.current != null) {
      window.clearTimeout(soundscapeVolumePublishTimerRef.current);
    }
    soundscapeVolumePublishTimerRef.current = window.setTimeout(() => {
      soundscapeVolumePublishTimerRef.current = null;
      const latest = soundscapeStateRef.current;
      if (latest) {
        void publishSoundtrackPacket({
          type: "soundtrack_state",
          state: latest,
        }).catch(() => { });
      }
    }, 100);
  };

  const togglePersonalSoundtrack = async () => {
    if (!connected) return;
    const engine = personalSoundscapeEngineRef.current;
    if (personalSoundscapePlaying) {
      const position = engine?.pause() || 0;
      setPersonalSoundscapePosition(position);
      setPersonalSoundscapePlaying(false);
      return;
    }
    if (!personalSoundscapeId) return;
    await selectPersonalSoundtrack(personalSoundscapeId);
  };

  const seekPersonalSoundtrack = (requestedPosition: number) => {
    const position =
      personalSoundscapeEngineRef.current?.seek(requestedPosition) || 0;
    setPersonalSoundscapePosition(position);
  };

  const uploadRoomSoundtrack = async (file: File) => {
    if (!canUploadRoomSoundtrack) return;
    const maxBytes = 30 * 1024 * 1024;
    const allowedTypes = new Set([
      "audio/mpeg",
      "audio/mp3",
      "audio/mp4",
      "audio/x-m4a",
      "audio/ogg",
      "audio/webm",
    ]);
    if (!allowedTypes.has(String(file.type || "").toLowerCase())) {
      setSoundscapeError("Use an MP3, M4A, OGG or WebM audio file.");
      return;
    }
    if (!file.size || file.size > maxBytes) {
      setSoundscapeError("Custom tracks must be 30 MB or smaller.");
      return;
    }

    try {
      setSoundscapeUploading(true);
      setSoundscapeError(null);
      const { data: authData } = await supabase.auth.getSession();
      const accessToken = authData.session?.access_token;
      if (!accessToken) throw new Error("Sign in again before uploading audio.");

      const response = await fetch("/api/livekit/admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: "prepare_room_soundtrack_upload",
          sessionId,
          fileName: file.name,
          contentType: file.type,
          fileSize: file.size,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (
        !response.ok ||
        !payload?.bucket ||
        !payload?.path ||
        !payload?.token ||
        !payload?.url
      ) {
        throw new Error(
          payload?.error === "audio_file_too_large"
            ? "Custom tracks must be 30 MB or smaller."
            : String(payload?.details || payload?.error || "The track could not be uploaded."),
        );
      }

      const { error: directUploadError } = await supabase.storage
        .from(String(payload.bucket))
        .uploadToSignedUrl(String(payload.path), String(payload.token), file, {
          contentType: file.type,
        });
      if (directUploadError) throw directUploadError;

      const label = String(payload.label || file.name).slice(0, 60);
      await playSoundscapeLocally("custom", 0, String(payload.url));
      const next: RoomSoundtrackState = {
        trackId: "custom",
        trackUrl: String(payload.url),
        trackLabel: label,
        duration: soundscapeEngineRef.current?.duration() || 0,
        volume: roomSoundscapeVolume,
        playing: true,
        position: 0,
        updatedAt: Date.now(),
      };
      soundscapeStateRef.current = next;
      setCustomSoundscapeLabel(label);
      setActiveSoundscapeId("custom");
      setSoundscapePlaying(true);
      setSoundscapePosition(0);
      await publishSoundtrackPacket({ type: "soundtrack_state", state: next });
    } catch (error) {
      setSoundscapeError(error instanceof Error ? error.message : "The track could not be uploaded.");
    } finally {
      setSoundscapeUploading(false);
    }
  };

  const pauseRoomSoundtrack = async () => {
    if (!canControlRoomSoundtrack || !activeSoundscapeId) return;
    if (activeSoundscapeId === "custom" && !canUploadRoomSoundtrack) return;
    const position = pauseSoundscapeLocally();
    const next: RoomSoundtrackState = {
      trackId: activeSoundscapeId,
      trackUrl: soundscapeStateRef.current?.trackUrl,
      trackLabel: soundscapeStateRef.current?.trackLabel,
      volume: roomSoundscapeVolume,
      playing: false,
      position,
      updatedAt: Date.now(),
    };
    soundscapeStateRef.current = next;
    await publishSoundtrackPacket({ type: "soundtrack_state", state: next });
  };

  const seekRoomSoundtrack = async (requestedPosition: number) => {
    const current = soundscapeStateRef.current;
    if (!canControlRoomSoundtrack || !current) return;
    if (current.trackId === "custom" && !canUploadRoomSoundtrack) return;
    const position = soundscapeEngineRef.current?.seek(requestedPosition) || 0;
    setSoundscapePosition(position);
    const next: RoomSoundtrackState = {
      ...current,
      position,
      updatedAt: Date.now(),
    };
    soundscapeStateRef.current = next;
    await publishSoundtrackPacket({ type: "soundtrack_state", state: next });
  };

  useEffect(() => {
    const room = roomRef.current;
    if (!connected || !room) return;

    const applyRemoteState = (next: RoomSoundtrackState) => {
      const validTrack =
        ROOM_SOUNDSCAPE_OPTIONS.some((option) => option.id === next.trackId) ||
        (next.trackId === "custom" && /^https:\/\//i.test(String(next.trackUrl || "")));
      if (!validTrack || !Number.isFinite(next.updatedAt)) return;
      const current = soundscapeStateRef.current;
      if (current && next.updatedAt <= current.updatedAt) return;

      soundscapeStateRef.current = next;
      const nextVolume = Math.max(
        0,
        Math.min(100, Number.isFinite(Number(next.volume)) ? Number(next.volume) : 35),
      );
      setRoomSoundscapeVolume(nextVolume);
      soundscapeEngineRef.current?.setVolume(nextVolume / 100);
      setActiveSoundscapeId(next.trackId);
      setCustomSoundscapeLabel(next.trackId === "custom" ? next.trackLabel || "Custom track" : null);
      setSoundscapePlaying(next.playing);
      setSoundscapePosition(Math.max(0, Number(next.position || 0)));
      setSoundscapeDuration(
        Math.max(
          0,
          Number(
            next.duration ||
              ROOM_SOUNDSCAPE_OPTIONS.find((option) => option.id === next.trackId)
                ?.durationSeconds ||
              0,
          ),
        ),
      );
      setSoundscapeError(null);

      if (!next.playing) {
        soundscapeEngineRef.current?.pause();
        soundscapeEngineRef.current?.seek(next.position);
        return;
      }

      const elapsed = Math.max(0, (Date.now() - next.updatedAt) / 1000);
      const position = Math.max(0, Number(next.position || 0)) + elapsed;
      void playSoundscapeLocally(
        next.trackId,
        position,
        next.trackUrl,
        nextVolume,
      ).catch(() => { });
    };

    const onSoundtrackData = (
      payload: Uint8Array,
      sender?: RemoteParticipant,
      _kind?: unknown,
      topic?: string,
    ) => {
      if (topic !== ROOM_SOUNDTRACK_TOPIC) return;
      try {
        const packet = JSON.parse(
          new TextDecoder().decode(payload),
        ) as RoomSoundtrackPacket;
        if (packet.type === "soundtrack_state" && packet.state) {
          if (!sender) return;
          const senderUserId = extractBaseUserIdFromIdentity(
            String(sender.identity || ""),
          )
            .trim()
            .toLowerCase();
          const senderCanControl =
            (sender as any)?.permissions?.roomAdmin === true ||
            participantControlSenderIdsRef.current.has(senderUserId);
          if (!senderCanControl) return;
          applyRemoteState(packet.state);
          return;
        }
        if (packet.type === "soundtrack_request" && canControlRoomSoundtrack) {
          const current = soundscapeStateRef.current;
          if (current) {
            void publishSoundtrackPacket({
              type: "soundtrack_state",
              state: current,
            }).catch(() => { });
          }
        }
      } catch {
        // Ignore malformed or unrelated room data.
      }
    };

    room.on(RoomEvent.DataReceived, onSoundtrackData as any);
    const requestTimer = window.setTimeout(() => {
      void publishSoundtrackPacket({
        type: "soundtrack_request",
        requestedAt: Date.now(),
      }).catch(() => { });
    }, 500);

    return () => {
      window.clearTimeout(requestTimer);
      room.off(RoomEvent.DataReceived, onSoundtrackData as any);
    };
    // The listener is tied to the active LiveKit room. Personal volume/mute is
    // applied by separate effects and does not require a new data subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, roomState, canControlRoomSoundtrack, canUploadRoomSoundtrack]);

  useEffect(() => {
    if (!session?.id || !defaultLivekitUrl) return;

    const warmRoom = new Room({
      adaptiveStream: false,
      dynacast: true,
      disconnectOnPageLeave: false,
      reconnectPolicy: createMobileReconnectPolicy(),
      publishDefaults: {
        simulcast: !lowPowerMobileMode,
        videoCodec: "vp8",
      } as any,
    });

    prewarmedRoomRef.current = warmRoom;
    void warmRoom.prepareConnection(defaultLivekitUrl);

    return () => {
      if (prewarmedRoomRef.current !== warmRoom) return;
      prewarmedRoomRef.current = null;
      void warmRoom.disconnect().catch(() => { });
    };
  }, [session?.id, defaultLivekitUrl, lowPowerMobileMode]);

  useEffect(() => {
    if (!connected) return;
    if (!roomState) return;
    if (!pendingRoomAudioUnlockRef.current) return;

    pendingRoomAudioUnlockRef.current = false;

    window.setTimeout(() => {
      ensureRoomAudioPlaybackUnlocked("post-connect").catch(() => { });
    }, 120);
  }, [connected, roomState, ensureRoomAudioPlaybackUnlocked]);
  const [clientError, setClientError] = useState<string>("");
  const [mediaWarning, setMediaWarning] = useState<string>("");

  const getLiveKitRoomState = () => {
    const room: any = roomRef.current as any;
    return String(room?.state || "").toLowerCase();
  };

  const roomIsActuallyConnected = () => {
    return !!roomRef.current && getLiveKitRoomState() === "connected";
  };

  const roomIsRecovering = () => {
    const state = getLiveKitRoomState();
    return (
      !!roomRef.current &&
      (state === "connecting" ||
        state === "reconnecting" ||
        state === "signalreconnecting")
    );
  };

  const clearMobileRestoreEscalationTimer = () => {
    if (!mobileRestoreEscalationTimerRef.current) return;
    window.clearTimeout(mobileRestoreEscalationTimerRef.current);
    mobileRestoreEscalationTimerRef.current = null;
  };

  const openMobileRestoreState = (
    mode: "restoring" | "needs_action" = "restoring",
  ) => {
    clearMobileRestoreEscalationTimer();
    setMobileRestoreMode(mode);
    setMobileMediaRestoreOpen(true);
    setPrejoinOpen(false);

    if (mode === "restoring") {
      mobileRestoreEscalationTimerRef.current = window.setTimeout(() => {
        if (!roomIsActuallyConnected()) {
          setMobileRestoreMode("needs_action");
        }
      }, 12_000);
    }
  };

  const closeMobileRestoreState = () => {
    clearMobileRestoreEscalationTimer();
    setMobileMediaRestoreOpen(false);
    setMobileRestoreMode("restoring");
  };

  const logRoomDiagnostic = useCallback(
    async (eventType: string, payload: Record<string, unknown> = {}) => {
      try {
        const { browser, browserVersion, os } = getBrowserDetails();
        const deviceType = inferDeviceTypeFromRuntime({
          isMobileQuery,
          isTabletQuery,
        });
        const nav =
          typeof navigator !== "undefined" ? (navigator as any) : null;
        const win = typeof window !== "undefined" ? window : null;

        const screenWidth = win?.screen?.width || win?.innerWidth || null;
        const screenHeight = win?.screen?.height || win?.innerHeight || null;
        const viewportWidth = win?.innerWidth || null;
        const viewportHeight = win?.innerHeight || null;

        const screenSnapshot = getScreenShareDiagnosticSnapshot(
          roomRef.current,
        );
        const screenShareTrackCount =
          Number((screenSnapshot as any).localScreenLiveTrackCount || 0) +
          Number((screenSnapshot as any).remoteScreenLiveTrackCount || 0);

        await supabase.from("room_diagnostics").insert({
          session_id: session?.id || null,
          user_id: authUserId || null,
          event_type: eventType,

          user_agent: String(nav?.userAgent || ""),
          platform: String(nav?.userAgentData?.platform || nav?.platform || ""),
          browser,
          browser_version: browserVersion,
          os,
          device_type: deviceType,

          screen_width: typeof screenWidth === "number" ? screenWidth : null,
          screen_height: typeof screenHeight === "number" ? screenHeight : null,
          viewport_width:
            typeof viewportWidth === "number" ? viewportWidth : null,
          viewport_height:
            typeof viewportHeight === "number" ? viewportHeight : null,
          device_pixel_ratio: Number(win?.devicePixelRatio || 1),

          supports_display_media: supportsScreenShareCapture(),
          screen_share_supported: supportsScreenShareCapture(),
          supports_set_sink_id: canUseSetSinkId(),
          supports_media_devices: !!nav?.mediaDevices,

          screen_share_track_count: Number.isFinite(screenShareTrackCount)
            ? screenShareTrackCount
            : 0,
          livekit_connected: !!connectedRef.current,

          payload: {
            ...payload,
            tabId,
            routeId: routeId || null,
            effectiveSessionParam,
            isMobileQuery,
            isTabletQuery,
            isLgUp,
            connected: !!connectedRef.current,
            roomConnectionState: String((roomRef.current as any)?.state || ""),
            screenShareSnapshot: screenSnapshot,
            hardwareConcurrency: Number(nav?.hardwareConcurrency || 0) || null,
            deviceMemory: Number(nav?.deviceMemory || 0) || null,
            maxTouchPoints: Number(nav?.maxTouchPoints || 0) || null,
            language: String(nav?.language || ""),
            languages: Array.isArray(nav?.languages) ? nav.languages : [],
          },
        });
      } catch (e) {
        console.warn("[room-diagnostics] insert failed:", e);
      }
    },
    [
      session?.id,
      authUserId,
      isMobileQuery,
      isTabletQuery,
      isLgUp,
      tabId,
      routeId,
      effectiveSessionParam,
    ],
  );

  const roomJoinDiagnosticKeyRef = useRef("");

  useEffect(() => {
    if (!connected) return;
    if (!session?.id) return;
    if (!authUserId) return;

    const key = `${session.id}:${authUserId}:${tabId}:room_join`;
    if (roomJoinDiagnosticKeyRef.current === key) return;
    roomJoinDiagnosticKeyRef.current = key;

    void logRoomDiagnostic("room_join", {
      roomName: session?.id ? safeRoomName(session.id) : null,
      isHost,
      isModerator: isSelfModerator,
      lkServerUrl,
      screenShareSupported: supportsScreenShareCapture(),
    });
  }, [
    connected,
    session?.id,
    authUserId,
    tabId,
    logRoomDiagnostic,
    isHost,
    isSelfModerator,
    lkServerUrl,
  ]);

  const connectInFlightRef = useRef(false);
  const connectAttemptIdRef = useRef(0);

  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenShareOn, setScreenShareOn] = useState(false);
  const connectionDiagnosticWriteTimesRef = useRef<Record<string, number>>({});

  const writeConnectionDiagnostic = useCallback(
    async (eventType: string, payload: Record<string, unknown> = {}) => {
      const now = Date.now();
      const lastWriteAt =
        connectionDiagnosticWriteTimesRef.current[eventType] || 0;
      if (now - lastWriteAt < CONNECTION_DIAGNOSTICS_DEDUP_MS) return;
      connectionDiagnosticWriteTimesRef.current[eventType] = now;

      const network = getNetworkDiagnosticSnapshot();
      const { browser, browserVersion, os } = getBrowserDetails();
      const deviceType = inferDeviceTypeFromRuntime({
        isMobileQuery,
        isTabletQuery,
      });
      const roomAny: any = roomRef.current;

      const hiddenForMs = pageHiddenAtRef.current
        ? Date.now() - pageHiddenAtRef.current
        : null;

      const localEntry = {
        at: new Date().toISOString(),
        attempt_id: roomLifecycleAttemptIdRef.current,
        event_type: eventType,
        session_id: session?.id || null,
        user_id: authUserId || null,
        route:
          typeof window !== "undefined"
            ? `${window.location.pathname}${window.location.search}`
            : "",
        user_agent:
          typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "",
        platform:
          typeof navigator !== "undefined"
            ? String(
              (
                navigator as Navigator & {
                  userAgentData?: { platform?: string };
                }
              ).userAgentData?.platform ||
              navigator.platform ||
              "",
            )
            : "",
        visibility_state:
          typeof document !== "undefined"
            ? document.visibilityState
            : "unknown",
        network_online: network.online,
        room_state: String(roomAny?.state || ""),
        livekit_connected: !!connectedRef.current,
        hidden_for_ms: hiddenForMs,
        payload,
      };

      pushConnectionDiagnosticToLocalBuffer(localEntry);
      if (roomDebugEnabled) {
        console.info("[ROOM-LIFECYCLE]", localEntry);
      }

      const isCriticalEvent =
        CONNECTION_DIAGNOSTICS_CRITICAL_EVENTS.has(eventType);
      if (
        !isCriticalEvent &&
        Math.random() >= CONNECTION_DIAGNOSTICS_REMOTE_SAMPLE_RATE
      ) {
        return;
      }

      try {
        const { error } = await supabase
          .from(CONNECTION_DIAGNOSTICS_TABLE)
          .insert({
            session_id: session?.id || null,
            user_id: authUserId || null,
            event_type: eventType,

            visibility_state:
              typeof document !== "undefined"
                ? document.visibilityState
                : "unknown",
            network_online: network.online,

            room_state: String(roomAny?.state || ""),
            livekit_connected: !!connectedRef.current,

            browser,
            browser_version: browserVersion,
            os,
            device_type: deviceType,

            effective_connection_type: network.effectiveType || null,
            connection_type: network.connectionType || null,
            downlink: network.downlink,
            rtt: network.rtt,
            save_data: network.saveData,

            hidden_for_ms: hiddenForMs,
            disconnect_reason:
              eventType === "livekit.disconnected"
                ? String(payload.reason ?? "") || null
                : null,
            remote_participants: roomAny?.remoteParticipants?.size ?? null,
            mic_on: micOn,
            cam_on: camOn,
            sample_rate: isCriticalEvent
              ? 1
              : CONNECTION_DIAGNOSTICS_REMOTE_SAMPLE_RATE,
            details: {
              attempt_id: roomLifecycleAttemptIdRef.current,
              tab_id: tabId,
              is_mobile_layout: isMobileQuery,
              is_tablet_layout: isTabletQuery,
              returning_from_background: returningFromBackgroundRef.current,
              explicit_leave_requested: explicitLeaveRequestedRef.current,
              join_requested: joinRequestedRef.current,
            },
          });
        if (error) throw error;
      } catch (e) {
        console.warn("[connection-diagnostics] insert failed:", e);
      }
    },
    [
      session?.id,
      authUserId,
      isMobileQuery,
      isTabletQuery,
      tabId,
      micOn,
      camOn,
      roomDebugEnabled,
    ],
  );

  useEffect(() => {
    roomLifecycleDiagnosticRef.current = (eventType, payload = {}) => {
      void writeConnectionDiagnostic(eventType, payload);
    };
  }, [writeConnectionDiagnostic]);

  const copyRoomLifecycleDiagnostics = useCallback(async () => {
    const diagnostics = {
      copied_at: new Date().toISOString(),
      attempt_id: roomLifecycleAttemptIdRef.current,
      route: `${location.pathname}${location.search}`,
      entries: readConnectionDiagnosticLocalBuffer(),
    };
    await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
  }, [location.pathname, location.search]);

  const bindLocalCameraEndedListener = useCallback(
    (mediaTrack: MediaStreamTrack, context: string) => {
      localCameraEndedCleanupRef.current?.();

      const onEnded = () => {
        localCameraEndedCleanupRef.current = null;
        if (cameraStopExpectedRef.current) return;

        setCamOn(false);
        const message =
          "The camera stopped unexpectedly. Close other camera apps if needed, then select Camera on to reconnect it.";
        setDeviceError(message);
        setMediaWarning(message);
        scheduleRebuildTiles();

        void logRoomDiagnostic("camera_track_ended", {
          context,
          readyState: mediaTrack.readyState,
        });
        void writeConnectionDiagnostic("camera.track_ended", { context });
      };

      mediaTrack.addEventListener("ended", onEnded, { once: true });
      localCameraEndedCleanupRef.current = () => {
        mediaTrack.removeEventListener("ended", onEnded);
      };
    },
    [logRoomDiagnostic, writeConnectionDiagnostic],
  );

  const releaseLocalCameraForRetry = useCallback(
    async (localParticipant: any, settleMs: number) => {
      const publication = findLocalCameraPublication(localParticipant);
      const mediaTrack = getCameraMediaTrackFromPublication(publication);

      cameraStopExpectedRef.current = true;
      localCameraEndedCleanupRef.current?.();
      localCameraEndedCleanupRef.current = null;

      try {
        await localParticipant.setCameraEnabled(false);
      } catch {
        try {
          mediaTrack?.stop();
        } catch { }
      }

      if (mediaTrack?.readyState === "live") {
        const releaseStartedAt = Date.now();
        while (
          mediaTrack.readyState === "live" &&
          Date.now() - releaseStartedAt < 900
        ) {
          await delay(75);
        }
      }

      await delay(settleMs);
      cameraStopExpectedRef.current = false;
    },
    [],
  );

  const enableLocalCameraWithRecovery = useCallback(
    async (
      localParticipant: any,
      args: {
        context: "join" | "toggle";
        requestedDeviceId?: string;
      },
    ) => {
      const baseOptions = {
        resolution: {
          width: lowPowerMobileMode ? 320 : capturePreset.width,
          height: lowPowerMobileMode ? 180 : capturePreset.height,
        },
        frameRate: lowPowerMobileMode ? 8 : capturePreset.fps,
      } as any;
      const requestedDeviceId = String(args.requestedDeviceId || "").trim();
      const attempts = [
        {
          name: "selected",
          options: {
            ...baseOptions,
            deviceId:
              lowPowerMobileMode || isSafariLike()
                ? undefined
                : requestedDeviceId || undefined,
          },
          settleMs: 0,
        },
        {
          name: "default_constrained",
          options: baseOptions,
          settleMs: 350,
        },
        {
          name: "default_unconstrained",
          options: undefined,
          settleMs: 700,
        },
      ];

      let lastError: unknown = null;

      for (let index = 0; index < attempts.length; index += 1) {
        const attempt = attempts[index];

        if (index > 0) {
          await releaseLocalCameraForRetry(
            localParticipant,
            attempt.settleMs,
          );
        } else {
          const stalePublication = findLocalCameraPublication(localParticipant);
          const staleMediaTrack =
            getCameraMediaTrackFromPublication(stalePublication);
          if (
            stalePublication?.track &&
            staleMediaTrack?.readyState !== "live"
          ) {
            await releaseLocalCameraForRetry(localParticipant, 250);
          }
        }

        try {
          await localParticipant.setCameraEnabled(true, attempt.options);

          const liveCamera = await waitForLocalCameraTrackLive(
            localParticipant,
            3200,
          );
          if (!liveCamera) {
            throw new Error("camera_track_did_not_become_live");
          }

          bindLocalCameraEndedListener(liveCamera.mediaTrack, args.context);

          // A live MediaStreamTrack is sufficient to keep the camera enabled.
          // Frame readiness is also observed because WebKit can expose a live
          // track before the first decoded frame, but a slow frame must not turn
          // a valid privacy-shutter/virtual camera back off.
          void waitForMediaTrackRenderableFrame(
            liveCamera.mediaTrack,
            2400,
          ).then((renderable) => {
            if (renderable) return;
            void writeConnectionDiagnostic("camera.frame_delayed", {
              context: args.context,
              attempt: attempt.name,
              readyState: liveCamera.mediaTrack.readyState,
            });
          });

          void writeConnectionDiagnostic("camera.started", {
            context: args.context,
            attempt: attempt.name,
          });

          return {
            ...liveCamera,
            attemptName: attempt.name,
          };
        } catch (error) {
          lastError = error;
          const diagnostic = getMediaErrorDiagnostic(error);
          console.warn(
            `[camera-${args.context}] ${attempt.name} failed:`,
            error,
          );

          void logRoomDiagnostic("camera_start_attempt_failed", {
            context: args.context,
            attempt: attempt.name,
            ...diagnostic,
          });
          void writeConnectionDiagnostic(
            `camera.start_failed.${attempt.name}`,
            {
              context: args.context,
              ...diagnostic,
            },
          );
        }
      }

      cameraStopExpectedRef.current = false;
      throw lastError || new Error("camera_enable_failed");
    },
    [
      bindLocalCameraEndedListener,
      capturePreset.fps,
      capturePreset.height,
      capturePreset.width,
      logRoomDiagnostic,
      lowPowerMobileMode,
      releaseLocalCameraForRetry,
      writeConnectionDiagnostic,
    ],
  );

  useEffect(() => {
    const write = (
      eventType: string,
      payload: Record<string, unknown> = {},
    ) => {
      void writeConnectionDiagnostic(eventType, payload);
    };

    const onVisibilityChange = () => {
      write(`document.visibilitychange:${document.visibilityState}`);
    };
    const onPageHide = (event: PageTransitionEvent) => {
      write("window.pagehide", { persisted: event.persisted });
    };
    const onPageShow = (event: PageTransitionEvent) => {
      write("window.pageshow", { persisted: event.persisted });
    };
    const onFreeze = () => write("document.freeze");
    const onResume = () => write("document.resume");
    const onOnline = () => write("window.online");
    const onOffline = () => write("window.offline");
    const onFocus = () => write("window.focus");
    const onBlur = () => write("window.blur");

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("freeze", onFreeze);
    document.addEventListener("resume", onResume);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("freeze", onFreeze);
      document.removeEventListener("resume", onResume);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, [writeConnectionDiagnostic]);

  useEffect(() => {
    roomLifecycleDiagnosticRef.current("react.room_mounted");
    return () => {
      roomLifecycleDiagnosticRef.current("react.room_unmounted", {
        explicit_leave_requested: explicitLeaveRequestedRef.current,
      });
    };
  }, []);

  useEffect(() => {
    roomLifecycleDiagnosticRef.current("router.location_changed", {
      pathname: location.pathname,
      search: location.search,
    });
  }, [location.pathname, location.search]);

  const manualScreenShareRef = useRef<{
    mediaTrack: MediaStreamTrack;
    stream?: MediaStream | null;
    publication?: LocalTrackPublication | null;
  } | null>(null);
  const [remoteAudioRecoveryTick, setRemoteAudioRecoveryTick] = useState(0);
  const [pipMode, setPipMode] = useState<PiPMode>("gallery");

  function getSettingsPreviewTrack(): LocalVideoTrack | null {
    if (prejoinPreparedVideoTrackRef.current) {
      return prejoinPreparedVideoTrackRef.current;
    }

    try {
      const r = roomRef.current;
      if (!r) return null;

      const pubs = Array.from(
        r.localParticipant.videoTrackPublications.values(),
      );
      const camPub = pubs.find((p: any) => p?.source === Track.Source.Camera);

      return (camPub?.track as LocalVideoTrack | null) || null;
    } catch {
      return null;
    }
  }

  const captureLocalVideoFrame = async (): Promise<string> => {
    try {
      const track = getSettingsPreviewTrack();
      if (!track) return "";

      const video = document.createElement("video");
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.style.position = "fixed";
      video.style.left = "-99999px";
      video.style.top = "-99999px";
      video.style.width = "1px";
      video.style.height = "1px";
      video.style.opacity = "0";
      video.setAttribute("playsinline", "true");
      video.setAttribute("muted", "true");

      document.body.appendChild(video);

      try {
        const attached = (track as any)?.attach?.(video) || video;
        const targetVideo =
          attached instanceof HTMLVideoElement ? attached : video;

        try {
          await targetVideo.play();
        } catch { }

        if (!targetVideo.videoWidth || !targetVideo.videoHeight) {
          await delay(120);
        }

        const width = targetVideo.videoWidth || 640;
        const height = targetVideo.videoHeight || 360;
        if (!width || !height) return "";

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) return "";

        ctx.drawImage(targetVideo, 0, 0, width, height);
        return canvas.toDataURL("image/jpeg", 0.78);
      } finally {
        try {
          (track as any)?.detach?.(video);
        } catch { }

        try {
          video.remove();
        } catch { }
      }
    } catch (e) {
      console.warn("captureLocalVideoFrame failed:", e);
      return "";
    }
  };

  const [tiles, setTiles] = useState<TileModel[]>([]);
  const [screenShareTiles, setScreenShareTiles] = useState<TileModel[]>([]);

  const sessionOwnerId = useMemo(
    () =>
      String(session?.host_id || session?.host_profile?.id || "")
        .trim()
        .toLowerCase(),
    [session?.host_id, session?.host_profile?.id],
  );

  const sessionOwnerIsPresent = useMemo(() => {
    if (!sessionOwnerId) return false;
    if (
      connected &&
      String(authUserId || "").trim().toLowerCase() === sessionOwnerId
    ) {
      return true;
    }

    return tiles.some((tile) => {
      const participantId = String(
        tile.participantUserId ||
        extractBaseUserIdFromIdentity(String(tile.participantIdentity || "")),
      )
        .trim()
        .toLowerCase();
      return participantId === sessionOwnerId;
    });
  }, [authUserId, connected, sessionOwnerId, tiles]);

  const loadActiveRoomHostLease = useCallback(async () => {
    if (!isInfiniteRoom || !sessionId) {
      setActiveRoomHostLease(null);
      return;
    }

    const { data, error } = await supabase
      .from("infinite_room_host_leases")
      .select(
        "session_id,user_id,claimed_at,heartbeat_at,expires_at,active_host_profile:profiles!infinite_room_host_leases_user_id_fkey(id,full_name,avatar_url,bio)",
      )
      .eq("session_id", sessionId)
      .maybeSingle();

    if (error) {
      // A deployment can briefly run before its migration is applied. Do not
      // break the room for that case; the action remains unavailable.
      console.warn("active room host lease unavailable", error);
      setActiveRoomHostLease(null);
      return;
    }

    const rawProfile = (data as any)?.active_host_profile;
    const profile = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile;
    setActiveRoomHostLease(
      data
        ? ({
            ...(data as any),
            active_host_profile: profile || null,
          } as InfiniteRoomHostLease)
        : null,
    );
  }, [isInfiniteRoom, sessionId]);

  useEffect(() => {
    const tick = window.setInterval(
      () => setActiveRoomHostClock(Date.now()),
      15_000,
    );
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!isInfiniteRoom || !sessionId) {
      setActiveRoomHostLease(null);
      return;
    }

    void loadActiveRoomHostLease();
    const channel = supabase
      .channel(`infinite-room-host-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "infinite_room_host_leases",
          filter: `session_id=eq.${sessionId}`,
        },
        () => void loadActiveRoomHostLease(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isInfiniteRoom, loadActiveRoomHostLease, sessionId]);

  useEffect(() => {
    if (
      !connected ||
      !isInfiniteRoom ||
      !sessionId ||
      !authUserId ||
      !isTemporaryRoomHost
    ) {
      return;
    }

    const heartbeat = async () => {
      const { data, error } = await supabase.rpc(
        "heartbeat_infinite_room_host",
        { p_session_id: sessionId },
      );
      if (error || data === false) {
        setActiveRoomHostLease(null);
        if (error) console.warn("active host heartbeat failed", error);
        return;
      }
      setActiveRoomHostClock(Date.now());
      void loadActiveRoomHostLease();
    };

    void heartbeat();
    const heartbeatTimer = window.setInterval(heartbeat, 30_000);
    return () => window.clearInterval(heartbeatTimer);
  }, [
    authUserId,
    connected,
    isInfiniteRoom,
    isTemporaryRoomHost,
    loadActiveRoomHostLease,
    sessionId,
  ]);

  useEffect(() => {
    if (!sessionOwnerIsPresent || !isTemporaryRoomHost || !sessionId) return;
    void supabase
      .rpc("release_infinite_room_host", { p_session_id: sessionId })
      .then(() => loadActiveRoomHostLease());
  }, [
    isTemporaryRoomHost,
    loadActiveRoomHostLease,
    sessionId,
    sessionOwnerIsPresent,
  ]);

  const claimActiveRoomHost = useCallback(async () => {
    if (!sessionId || activeRoomHostBusy) return;
    setActiveRoomHostBusy(true);
    setActiveRoomHostError("");
    try {
      const { error } = await supabase.rpc("claim_infinite_room_host", {
        p_session_id: sessionId,
      });
      if (error) throw error;
      await loadActiveRoomHostLease();
      return true;
    } catch (error: any) {
      const message = String(error?.message || error || "");
      setActiveRoomHostError(
        message.includes("session_owner_present")
          ? "The session owner is already in the room."
          : message.includes("active_host_already_claimed")
            ? "Someone else has already stepped in as host."
            : "Could not step in as host. Please try again.",
      );
      await loadActiveRoomHostLease();
      return false;
    } finally {
      setActiveRoomHostBusy(false);
    }
  }, [activeRoomHostBusy, loadActiveRoomHostLease, sessionId]);

  const reservedHostAutoClaimRef = useRef("");
  useEffect(() => {
    if (
      !isInfiniteRoom ||
      !sessionId ||
      !authUserId ||
      sessionOwnerIsPresent ||
      hasValidActiveRoomHostLease
    ) {
      return;
    }

    let cancelled = false;
    const tryReservedHostClaim = async () => {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from("session_bookings")
        .select("id")
        .eq("session_id", sessionId)
        .eq("user_id", authUserId)
        .eq("booking_role", "host")
        .lte("booked_start_time", nowIso)
        .gt("booked_end_time", nowIso)
        .limit(1)
        .maybeSingle();

      if (cancelled || error || !data?.id) return;
      const claimKey = `${sessionId}:${data.id}`;
      if (reservedHostAutoClaimRef.current === claimKey) return;
      const claimed = await claimActiveRoomHost();
      if (claimed) reservedHostAutoClaimRef.current = claimKey;
    };

    void tryReservedHostClaim();
    const timer = window.setInterval(() => void tryReservedHostClaim(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    authUserId,
    claimActiveRoomHost,
    hasValidActiveRoomHostLease,
    isInfiniteRoom,
    sessionId,
    sessionOwnerIsPresent,
  ]);

  const releaseActiveRoomHost = useCallback(async () => {
    if (!sessionId || activeRoomHostBusy) return;
    setActiveRoomHostBusy(true);
    setActiveRoomHostError("");
    try {
      const { error } = await supabase.rpc("release_infinite_room_host", {
        p_session_id: sessionId,
      });
      if (error) throw error;
      await loadActiveRoomHostLease();
    } catch (error) {
      console.warn("active host release failed", error);
      setActiveRoomHostError("Could not step down. Please try again.");
    } finally {
      setActiveRoomHostBusy(false);
    }
  }, [activeRoomHostBusy, loadActiveRoomHostLease, sessionId]);

  const activeOperationalHostProfile = useMemo<HostProfile | null>(() => {
    if (sessionOwnerIsPresent) return session?.host_profile || null;
    if (!hasValidActiveRoomHostLease) return null;
    const leaseUserId = String(activeRoomHostLease?.user_id || "").toLowerCase();
    return (
      activeRoomHostLease?.active_host_profile ||
      profilesById[leaseUserId] || {
        id: leaseUserId,
        full_name: isTemporaryRoomHost ? "You" : "Participant",
      }
    );
  }, [
    activeRoomHostLease,
    hasValidActiveRoomHostLease,
    isTemporaryRoomHost,
    profilesById,
    session?.host_profile,
    sessionOwnerIsPresent,
  ]);

  const activeOperationalHostUserId = sessionOwnerIsPresent
    ? sessionOwnerId
    : hasValidActiveRoomHostLease
      ? String(activeRoomHostLease?.user_id || "").toLowerCase()
      : "";

  useEffect(() => {
    const allowedSenderIds = new Set<string>();
    if (sessionOwnerId) allowedSenderIds.add(sessionOwnerId);
    for (const moderatorUserId of moderatorUserIds) {
      const normalizedId = String(moderatorUserId || "").trim().toLowerCase();
      if (normalizedId) allowedSenderIds.add(normalizedId);
    }
    if (hasValidActiveRoomHostLease) {
      const activeHostId = String(activeRoomHostLease?.user_id || "")
        .trim()
        .toLowerCase();
      if (activeHostId) allowedSenderIds.add(activeHostId);
    }
    participantControlSenderIdsRef.current = allowedSenderIds;
  }, [
    activeRoomHostLease?.user_id,
    hasValidActiveRoomHostLease,
    moderatorUserIds,
    sessionOwnerId,
  ]);

  // DMs follow the person who is actively hosting the room. When an infinite
  // room has no owner present, a participant who steps in as host must get the
  // same participant picker and direct-chat behavior as the session owner.
  // Keep the owner as the fallback peer while nobody has claimed the room.
  const chatHostUserId = activeOperationalHostUserId || sessionOwnerId;
  const canSelectHostDmPeer =
    !!chatHostUserId &&
    chatHostUserId === String(authUserId || "").trim().toLowerCase();

  useEffect(() => {
    const shouldShowMobileRestore = () => {
      if (roomIsActuallyConnected()) return false;
      return joinRequestedRef.current || returningFromBackgroundRef.current;
    };

    const markHidden = () => {
      pageHiddenAtRef.current = Date.now();
      returningFromBackgroundRef.current = true;

      writeMobileRoomLease(sessionId, authUserId, {
        audioEnabled: micOn,
        videoEnabled: camOn,
      });

      try {
        void attendanceHeartbeat();
      } catch {
        // ignore
      }

      // Do not attach the published camera track to another hidden <video> or
      // capture a fallback frame here. Browsers can suspend that play/capture
      // operation halfway through when the tab becomes hidden, which stalls the
      // processed outgoing track for everyone else. Leave the existing LiveKit
      // publication untouched and let WebRTC keep it alive where the OS permits.
    };

    const markVisible = () => {
      if (!pageHiddenAtRef.current && !returningFromBackgroundRef.current)
        return;

      if (roomIsActuallyConnected()) {
        closeMobileRestoreState();
        setMediaWarning("");
        void attendanceHeartbeat();
        startAttendanceHeartbeat();
        void ensureRoomAudioPlaybackUnlocked("mobile-visible").catch(() => { });
        scheduleRebuildTiles();
        window.setTimeout(() => scheduleRebuildTiles(), 120);
        window.setTimeout(() => scheduleRebuildTiles(), 420);
        pageHiddenAtRef.current = null;
        returningFromBackgroundRef.current = false;
        return;
      }

      if (roomIsRecovering()) {
        void attendanceHeartbeat();
        startAttendanceHeartbeat();
        openMobileRestoreState("restoring");
        setMediaWarning(
          "Restoring your connection… Your browser or network may briefly pause the room.",
        );
        scheduleRebuildTiles();
        window.setTimeout(() => scheduleRebuildTiles(), 120);
        return;
      }

      if (shouldShowMobileRestore()) {
        openMobileRestoreState("needs_action");
        scheduleRebuildTiles();
        window.setTimeout(() => scheduleRebuildTiles(), 120);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        markHidden();
        return;
      }

      if (document.visibilityState === "visible") {
        markVisible();
      }
    };

    const onPageShow = () => markVisible();

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
      clearMobileRestoreEscalationTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lowPowerMobileMode, sessionId, authUserId, micOn, camOn]);

  const [adminBusyKey, setAdminBusyKey] = useState<string>("");

  const liveHostChatOptions = useMemo(() => {
    const me = String(authUserId || "")
      .trim()
      .toLowerCase();

    return tiles
      .filter((tile) => {
        const uid = String(tile.participantUserId || "")
          .trim()
          .toLowerCase();
        if (!uid) return false;
        if (!looksLikeUuid(uid)) return false;
        if (uid === me) return false;
        return true;
      })
      .map((tile) => {
        const uid = String(tile.participantUserId || "")
          .trim()
          .toLowerCase();
        const profile = profilesById?.[uid];
        const label =
          String(profile?.full_name || "").trim() ||
          String(tile.metadataDisplayName || "").trim() ||
          String(tile.label || "").trim() ||
          "Participant";

        return {
          userId: uid,
          label,
        };
      })
      .filter(
        (item, index, arr) =>
          arr.findIndex((x) => x.userId === item.userId) === index,
      )
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [tiles, authUserId, profilesById]);

  useEffect(() => {
    const me = String(authUserId || "")
      .trim()
      .toLowerCase();

    if (!chatHostUserId || !me) {
      setSelectedHostChatPeerId(null);
      return;
    }

    if (!canSelectHostDmPeer) {
      setSelectedHostChatPeerId(chatHostUserId);
      return;
    }

    if (!liveHostChatOptions.length) {
      setSelectedHostChatPeerId(null);
      return;
    }

    setSelectedHostChatPeerId((prev) => {
      if (prev && liveHostChatOptions.some((x) => x.userId === prev))
        return prev;
      return liveHostChatOptions[0]?.userId || null;
    });
  }, [
    authUserId,
    canSelectHostDmPeer,
    chatHostUserId,
    liveHostChatOptions,
  ]);

  // hide / pin
  const [hiddenTileIds, setHiddenTileIds] = useState<Record<string, boolean>>(
    {},
  );
  const [pinnedTileId, setPinnedTileId] = useState<string | null>(null);

  // per participant volume
  const [volumePctByParticipantKey, setVolumePctByParticipantKey] = useState<
    Record<string, number>
  >({});
  const volumePctByParticipantKeyRef = useRef<Record<string, number>>({});

  const [defaultRemoteVolumePct, setDefaultRemoteVolumePct] = useState<number>(
    () => {
      try {
        const raw = Number(
          localStorage.getItem("mysession_lk_default_remote_volume_pct") ||
          "100",
        );
        if (!Number.isFinite(raw)) return 100;
        return Math.max(0, Math.min(300, Math.round(raw)));
      } catch {
        return 125;
      }
    },
  );

  useEffect(() => {
    try {
      localStorage.setItem(
        "mysession_lk_default_remote_volume_pct",
        String(defaultRemoteVolumePct),
      );
    } catch { }
  }, [defaultRemoteVolumePct]);

  // chat unread
  const [unreadChat, setUnreadChat] = useState<number>(0);
  const [unreadGeneralChat, setUnreadGeneralChat] = useState<number>(0);
  const [unreadDirectChatByPeerId, setUnreadDirectChatByPeerId] = useState<
    Record<string, number>
  >({});
  const generalChatVisibleRef = useRef<boolean>(false);
  const directChatVisibleRef = useRef<boolean>(false);
  const selectedHostChatPeerIdRef = useRef<string | null>(null);
  const lastGeneralChatReadAtRef = useRef<number>(0);
  const lastDirectChatReadAtByPeerRef = useRef<Record<string, number>>({});

  // reactions
  const [floatingReactions, setFloatingReactions] = useState<
    FloatingReaction[]
  >([]);
  const reactionIdRef = useRef<number>(0);
  const reactionsChannelRef = useRef<any>(null);
  const reactionSendHistoryRef = useRef<number[]>([]);
  const reactionReceiveHistoryRef = useRef<number[]>([]);
  const reactionReceiveByUserRef = useRef<Map<string, number[]>>(new Map());
  const reactionExpiryTimersRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    return () => {
      for (const timer of reactionExpiryTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      reactionExpiryTimersRef.current.clear();
      reactionSendHistoryRef.current = [];
      reactionReceiveHistoryRef.current = [];
      reactionReceiveByUserRef.current.clear();
    };
  }, []);

  // edit name modal
  const pipWindowRef = useRef<Window | null>(null);
  const [pipMountEl, setPipMountEl] = useState<HTMLElement | null>(null);
  const [pipOpen, setPipOpen] = useState(false);

  const videoWrapRef = useRef<HTMLDivElement | null>(null);
  const mobilePiPCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mobilePiPStageRef = useRef<MobilePiPVideoElement | null>(null);
  const mobilePiPAppleStageRef = useRef<MobilePiPVideoElement | null>(null);
  const [mobilePipOpen, setMobilePipOpen] = useState(false);
  const [mobilePiPHintVisible, setMobilePiPHintVisible] = useState(false);
  const [mobilePiPVideoElement, setMobilePiPVideoElement] =
    useState<MobilePiPVideoElement | null>(null);
  const mobilePiPRuntime = useMemo(
    () => isTabletOrMobilePiPRuntime(),
    [],
  );

  const prepareMobilePiPCollage = useMobilePiPCollage(
    videoWrapRef,
    mobilePiPCanvasRef,
    mobilePiPStageRef,
    connected && mobilePiPRuntime,
  );
  const prepareAppleMobilePiPPosterLoop = useAppleMobilePiPPosterLoop(
    videoWrapRef,
    mobilePiPCanvasRef,
    mobilePiPAppleStageRef,
    connected && mobilePiPRuntime,
  );


  const preparePreferredMobilePiPVideo = useCallback(async () => {
    const root = videoWrapRef.current;
    const nativeVideo = getPreferredMobilePiPSourceVideo(root);
    const roomTiles = getMobilePiPRoomTiles(root);
    const needsAvatarFallback = roomTiles.some(
      (tile) => !tile.video || !isMobilePiPCameraTrackActive(tile.video),
    );

    // iOS/iPadOS suspends canvas painting and JS timers after the tab becomes
    // hidden. A canvas.captureStream() gallery therefore remains "live" but
    // produces black PiP frames. Native LiveKit video tracks keep decoding in
    // Safari's media pipeline, so always prefer one of them on Apple mobile
    // devices. Other mobile browsers can continue using the collage.
    if (
      isAppleMobilePiPRuntime() &&
      nativeVideo &&
      supportsWebKitVideoPiP(nativeVideo)
    ) {
      configureMobilePiPVideo(nativeVideo);
      return nativeVideo;
    }
    // Only use the generated Apple stage when the room has no live camera
    // track at all. It is an avatar fallback, not a replacement for live video.
    if (isAppleMobilePiPRuntime()) {
      const posterLoop = await prepareAppleMobilePiPPosterLoop();
      if (posterLoop && isMobilePiPStageReady(posterLoop)) {
        return posterLoop;
      }
    }

    // keep every participant visible as video or avatar. If Safari rejects a
    // canvas MediaStream, fall back to its native playing LiveKit video.
    if (needsAvatarFallback) {
      const collageVideo = await prepareMobilePiPCollage();
      if (collageVideo && isMobilePiPStageReady(collageVideo)) {
        return collageVideo;
      }
    }

    if (nativeVideo && supportsWebKitVideoPiP(nativeVideo)) {
      configureMobilePiPVideo(nativeVideo);
      return nativeVideo;
    }

    const collageVideo = await prepareMobilePiPCollage();
    if (collageVideo && isMobilePiPStageReady(collageVideo)) {
      return collageVideo;
    }

    if (nativeVideo) configureMobilePiPVideo(nativeVideo);
    return nativeVideo;
  }, [prepareAppleMobilePiPPosterLoop, prepareMobilePiPCollage]);

  const persistMobilePiPRetention = useCallback(
    (active: boolean): void => {
      writeMobileRoomLease(sessionId, authUserId, {
        audioEnabled: micOn,
        videoEnabled: camOn,
        pictureInPictureActive: active,
      });
    },
    [authUserId, camOn, micOn, sessionId],
  );

  const handleMobilePiPOpened = useCallback(
    (video: MobilePiPVideoElement): void => {
      persistMobilePiPRetention(true);
      setMobilePiPVideoElement(video);
      setMobilePipOpen(true);
    },
    [persistMobilePiPRetention],
  );

  useEffect(() => {
    if (!connected || !mobilePipOpen) return;

    persistMobilePiPRetention(true);
    const timer = window.setInterval(
      () => persistMobilePiPRetention(true),
      30_000,
    );

    return () => window.clearInterval(timer);
  }, [connected, mobilePipOpen, persistMobilePiPRetention]);

  useMobileBrowserInitiatedPiP(
    connected && mobilePiPRuntime,
    preparePreferredMobilePiPVideo,
    mobilePiPStageRef,
    handleMobilePiPOpened,
  );

  const pictureInPictureOpen = pipOpen || mobilePipOpen;

  useEffect(() => {
    if (!connected || !mobilePiPRuntime) {
      setMobilePiPHintVisible(false);
      return;
    }

    if (pictureInPictureOpen) {
      setMobilePiPHintVisible(false);
      try {
        localStorage.setItem(MOBILE_PIP_HINT_DISMISSED_KEY, "1");
      } catch { }
      return;
    }

    try {
      if (localStorage.getItem(MOBILE_PIP_HINT_DISMISSED_KEY) === "1") {
        setMobilePiPHintVisible(false);
        return;
      }
    } catch { }

    const timer = window.setTimeout(() => setMobilePiPHintVisible(true), 1_400);
    return () => window.clearTimeout(timer);
  }, [connected, mobilePiPRuntime, pictureInPictureOpen]);

  useEffect(() => {
    if (!connected || !mobilePiPRuntime) {
      setMobilePipOpen(false);
      return;
    }

    const stage = mobilePiPVideoElement ?? mobilePiPStageRef.current;
    if (!stage) return;

    const handleEnter = (): void => {
      persistMobilePiPRetention(true);
      setMobilePiPVideoElement(stage);
      setMobilePipOpen(true);
    };
    const handleLeave = (): void => {
      persistMobilePiPRetention(false);
      setMobilePipOpen(false);
      setMobilePiPVideoElement(null);
    };
    const handleWebKitModeChange = (): void => {
      const active =
        stage.webkitPresentationMode === "picture-in-picture";
      persistMobilePiPRetention(active);
      setMobilePipOpen(active);
      if (!active) setMobilePiPVideoElement(null);
    };

    stage.addEventListener("enterpictureinpicture", handleEnter);
    stage.addEventListener("leavepictureinpicture", handleLeave);
    stage.addEventListener(
      "webkitpresentationmodechanged",
      handleWebKitModeChange,
    );

    return () => {
      stage.removeEventListener("enterpictureinpicture", handleEnter);
      stage.removeEventListener("leavepictureinpicture", handleLeave);
      stage.removeEventListener(
        "webkitpresentationmodechanged",
        handleWebKitModeChange,
      );
    };
  }, [
    connected,
    mobilePiPRuntime,
    mobilePiPVideoElement,
    persistMobilePiPRetention,
  ]);

  const documentPipSupported =
    typeof window !== "undefined" &&
    typeof (window as WindowWithDocumentPiP).documentPictureInPicture !==
    "undefined";

  const pipSupported = typeof window !== "undefined";

  useEffect(() => {
    setOpenTileAdminMenuId((prev) =>
      prev && tiles.some((t) => t.id === prev) ? prev : null,
    );
  }, [tiles]);

  const participantsCount = useMemo(() => {
    const r = roomRef.current;
    if (!r) return 0;
    return 1 + r.remoteParticipants.size;
  }, [roomState, tiles]);

  const micToggleHook = useTrackToggle({
    source: Track.Source.Microphone,
    room: roomState || undefined,
    captureOptions: {
      deviceId:
        selectedAudioInputId || prejoinRef.current.audioInputId || undefined,
      echoCancellation: echoCancellationEnabled,
      noiseSuppression: noiseSuppressionEnabled,
      autoGainControl: autoGainControlEnabled,
    } as any,
    onDeviceError: (error) => {
      console.error("mic toggle device error:", error);
      setMediaWarning(
        normalizeMediaWarningMessage(
          (error as any)?.message || error || "microphone_toggle_failed",
        ),
      );
    },
  });

  const volumeStorageKey = useMemo(() => {
    return session?.id ? `mysession_lk_volume:${session.id}` : "";
  }, [session?.id]);

  useEffect(() => {
    if (!volumeStorageKey) return;
    try {
      const raw = localStorage.getItem(volumeStorageKey);
      if (!raw) {
        setVolumePctByParticipantKey({});
        volumePctByParticipantKeyRef.current = {};
        return;
      }
      const parsed = JSON.parse(raw);
      const nextVolumes =
        parsed && typeof parsed === "object"
          ? (parsed as Record<string, number>)
          : {};
      volumePctByParticipantKeyRef.current = nextVolumes;
      setVolumePctByParticipantKey(nextVolumes);
    } catch {
      volumePctByParticipantKeyRef.current = {};
      setVolumePctByParticipantKey({});
    }
  }, [volumeStorageKey]);

  useEffect(() => {
    if (!volumeStorageKey) return;
    try {
      localStorage.setItem(
        volumeStorageKey,
        JSON.stringify(volumePctByParticipantKey),
      );
    } catch { }
  }, [volumeStorageKey, volumePctByParticipantKey]);

  const resetAllParticipantVolumesToDefault = useCallback(() => {
    volumePctByParticipantKeyRef.current = {};
    setVolumePctByParticipantKey({});
  }, []);

  const applyDefaultRemoteVolumePreset = useCallback((pct: number) => {
    setDefaultRemoteVolumePct(clamp(Math.round(pct), 0, 300));
  }, []);

  const roomNameForApi = useMemo(() => {
    if (!session) return "";
    return safeRoomName(`session-${session.id}`);
  }, [session]);

  const showSystemNotice = (next: Omit<RoomSystemNotice, "open">) => {
    setSystemNotice({
      open: true,
      kind: next.kind,
      presentation: next.presentation,
      title: next.title,
      body: next.body,
      actionLabel: next.actionLabel,
      action: next.action,
    });
  };

  const closeSystemNotice = () => {
    setSystemNotice((prev) => ({ ...prev, open: false }));
  };

  const updateRoomPolicies = useCallback(async (next: RoomPolicies) => {
    if (!isHost || !session?.id) return;

    const previousSchedule = session.schedule;
    const previousCameraRequired = session.camera_required;
    const previousPublicChatDisabled = session.public_chat_disabled;
    const nextSchedule = withRoomPolicies(previousSchedule, next);
    setSession((previous) =>
      previous
        ? {
            ...previous,
            schedule: nextSchedule,
            camera_required: next.cameraRequired,
            public_chat_disabled: next.publicChatDisabled,
          }
        : previous,
    );

    const { error } = await supabase
      .from("sessions")
      .update({
        schedule: nextSchedule,
        camera_required: next.cameraRequired,
        public_chat_disabled: next.publicChatDisabled,
      })
      .eq("id", session.id);

    if (error) {
      setSession((previous) =>
        previous
          ? {
              ...previous,
              schedule: previousSchedule,
              camera_required: previousCameraRequired,
              public_chat_disabled: previousPublicChatDisabled,
            }
          : previous,
      );
      showSystemNotice({
        kind: "error",
        title: "Room policy was not saved",
        body: error.message || "Please try again.",
      });
      return;
    }

    showSystemNotice({
      kind: "info",
      title: "Room policy updated",
      body: "The new setting is now active for everyone in the room.",
    });
  }, [isHost, session?.id, session?.schedule]);

  const handleKickedOut = async (payload?: KickBroadcastPayload | null) => {
    if (kickRedirecting) return;

    setKickRedirecting(true);
    kickedBySignalRef.current = true;

    const byName = String(payload?.kickedByName || "").trim();
    const body = byName
      ? `You were disconnected by ${byName}.`
      : "You were disconnected by a moderator.";

    await disconnectRoom({ skipNavigate: true, preserveKickNotice: true });

    setSystemNotice({
      open: true,
      kind: "kick",
      title: "You were disconnected",
      body,
    });
  };

  useEffect(() => {
    if (!session?.id) return;
    if (!authUserId) return;

    const channelName = makeKickBroadcastChannelName(session.id);

    const ch = supabase
      .channel(channelName, {
        config: { broadcast: { self: true } },
      })
      .on(
        "broadcast",
        { event: "participant_kicked" },
        async (payload: any) => {
          const p = (payload?.payload || payload || {}) as KickBroadcastPayload;

          const matched = matchesKickPayload({
            payload: p,
            localIdentity: livekitIdentityRef.current,
            authUserId: String(authUserId || ""),
            baseUserId: String(baseUserIdRef.current || ""),
          });

          if (!matched) return;
          await handleKickedOut(p);
        },
      )
      .subscribe();

    kickEventChannelRef.current = ch;

    return () => {
      if (kickEventChannelRef.current === ch)
        kickEventChannelRef.current = null;
      safeRemoveRealtimeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, authUserId, kickRedirecting]);

  useEffect(() => {
    const stateNotice = (window.history.state as any)?.usr?.livekitNotice;
    if (!stateNotice) return;
    if (stateNotice.kind !== "kick") return;

    showSystemNotice({
      kind: "kick",
      title: String(stateNotice.title || "Disconnected from room"),
      body: String(stateNotice.body || "You were removed from this room."),
    });

    try {
      const current = window.history.state || {};
      const nextUsr = { ...(current.usr || {}) };
      delete nextUsr.livekitNotice;
      window.history.replaceState({ ...current, usr: nextUsr }, "");
    } catch { }
  }, []);

  // pull profiles for anyone we see in room
  useEffect(() => {
    const ids = uniqStrings(
      tiles
        .map((t) => String(t.participantUserId || "").toLowerCase())
        .filter((x) => looksLikeUuid(x)),
    );
    if (!ids.length) return;
    const missing = ids.filter((id) => !profilesById[id]);
    if (!missing.length) return;

    (async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url, bio")
          .in("id", missing);

        const rows = Array.isArray(data) ? data : [];
        const patch: Record<string, HostProfile> = {};

        for (const r of rows as any[]) {
          const pid = String(r?.id || "").toLowerCase();
          if (!pid) continue;
          const avatar = await resolveAvatarUrlFromProfilesField(
            String(r?.avatar_url || ""),
          );
          patch[pid] = {
            id: pid,
            full_name: String(r?.full_name || "").trim(),
            avatar_url: avatar || null,
            bio: r?.bio ?? null,
          };
        }

        if (Object.keys(patch).length) {
          setProfilesById((prev) => {
            const next = { ...prev, ...patch };
            profilesByIdRef.current = next;
            return next;
          });

          // Rebuild immediately from profilesByIdRef. Waiting for an unrelated
          // microphone event is what previously left some tiles labelled User.
          scheduleRebuildTiles();
          window.setTimeout(() => scheduleRebuildTiles(), 80);
        }
      } catch (e) {
        console.warn("profiles fetch failed", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles.map((t) => `${t.participantUserId || ""}`).join("|")]);

  // RAF-scheduled rebuild
  const rebuildRafRef = useRef<number | null>(null);
  const scheduleRebuildTiles = () => {
    if (rebuildRafRef.current) return;
    rebuildRafRef.current = window.requestAnimationFrame(() => {
      rebuildRafRef.current = null;
      rebuildTiles();
    });
  };

  const applyVolumeToRemoteParticipant = (tileId: string, pct: number) => {
    const r = roomRef.current;
    if (!r) return;
    const participant = Array.from(r.remoteParticipants.values()).find(
      (rp) => rp.sid === tileId,
    );
    if (!participant) return;

    try {
      // Tile refreshes must not restore audio while local deafen is active.
      const vol = selfDeafenedRef.current ? 0 : clamp(pct, 0, 300) / 100;
      // LiveKit remembers this value for current and future audio tracks.
      participant.setVolume(vol, Track.Source.Microphone);
      participant.setVolume(vol, Track.Source.ScreenShareAudio);
    } catch { }
  };

  const setParticipantVolumePct = (tile: TileModel, pct: number) => {
    const v = clamp(Math.round(pct), 0, 300);
    const key = getParticipantVolumeKey(tile);

    const nextVolumes = { ...volumePctByParticipantKeyRef.current, [key]: v };
    // Long-lived LiveKit callbacks must see this value before React rerenders.
    volumePctByParticipantKeyRef.current = nextVolumes;
    setVolumePctByParticipantKey(nextVolumes);
    applyVolumeToRemoteParticipant(tile.id, v);
  };

  const getLocalCameraPublication = () => {
    const r = roomRef.current;
    if (!r) return null;
    const lp = r.localParticipant;
    const pub = Array.from(lp.videoTrackPublications.values()).find(
      (p: LocalTrackPublication) => p.source === Track.Source.Camera,
    );
    return pub || null;
  };

  const getLocalCameraTrack = (): LocalVideoTrack | null => {
    const pub = getLocalCameraPublication();
    return (pub?.track as any) || null;
  };

  const getLocalMicPublication = () => {
    const r = roomRef.current;
    if (!r) return null;
    const lp = r.localParticipant;
    const pub = Array.from(lp.audioTrackPublications.values()).find(
      (p: any) => p.source === Track.Source.Microphone,
    );
    return pub || null;
  };

  const rebuildTiles = () => {
    const room = roomRef.current;
    if (!room) return;

    const currentProfilesById = profilesByIdRef.current;
    const next: TileModel[] = [];
    const lp = room.localParticipant;

    const localCamPub = Array.from(lp.videoTrackPublications.values()).find(
      (p) => p.source === Track.Source.Camera,
    ) as any;
    const localMicPub = Array.from(lp.audioTrackPublications.values()).find(
      (p) => p.source === Track.Source.Microphone,
    ) as any;

    const localCamTrackRaw = (localCamPub?.track as any) || undefined;
    const localAudioTrackRaw =
      localMicPub?.track instanceof LocalAudioTrack
        ? localMicPub.track
        : undefined;

    const localIdentity = String(
      lp.identity || livekitIdentityRef.current || "",
    );
    const localUserId =
      authUserId && looksLikeUuid(authUserId)
        ? String(authUserId).toLowerCase()
        : extractBaseUserIdFromIdentity(localIdentity);

    const localMicMuted = localMicPub ? !!(localMicPub as any).isMuted : true;

    const localCamPubExists = !!localCamPub;
    const localCamPubHasTrack = !!localCamPub?.track;
    const localCamPubMuted = localCamPub ? !!localCamPub.isMuted : true;

    const localCamActuallyVisible =
      localCamPubExists && localCamPubHasTrack && !localCamPubMuted;

    const localCamTrack = localCamActuallyVisible
      ? localCamTrackRaw
      : undefined;

    setMicOn((prev) => {
      const nextOn = !localMicMuted;
      return prev === nextOn ? prev : nextOn;
    });
    setCamOn((prev) => {
      const nextOn =
        localCamPubExists && localCamPubHasTrack && !localCamPubMuted;
      return prev === nextOn ? prev : nextOn;
    });

    const localParticipantMetadataDisplayName =
      getDisplayNameFromParticipantMetadata((lp as any)?.metadata);

    const localParticipantStatus = getStatusFromMetadata((lp as any)?.metadata);

    const effectiveLocalLabel =
      String(
        localRoomDisplayNameOverrideRef.current ||
        localParticipantMetadataDisplayName ||
        displayName ||
        prejoinRef.current.displayName ||
        userName ||
        "You",
      ).trim() || "You";

    next.push({
      id: "local",
      kind: "camera",
      label: effectiveLocalLabel,
      metadataDisplayName: localParticipantMetadataDisplayName || undefined,
      status: localParticipantStatus,
      isLocal: true,
      videoTrack: localCamTrack,
      audioTrack: localAudioTrackRaw,
      isSpeaking: !localMicMuted && !!lp.isSpeaking,
      participantIdentity: localIdentity || undefined,
      participantUserId: localUserId || undefined,
      micMuted: localMicMuted,
      camPubExists: localCamPubExists,
      camPubHasTrack: localCamPubHasTrack,
      camPubMuted: localCamPubMuted,
    });
    room.remoteParticipants.forEach((rp: RemoteParticipant) => {
      const allVideoPubs = Array.from(
        rp.videoTrackPublications.values(),
      ) as RemoteTrackPublication[];
      const allAudioPubs = Array.from(
        rp.audioTrackPublications.values(),
      ) as RemoteTrackPublication[];

      const camPub = allVideoPubs.find(
        (p: any) => p.source === Track.Source.Camera,
      ) as any;
      const micPub = allAudioPubs.find(
        (p: any) => p.source === Track.Source.Microphone,
      ) as any;

      const remoteCamPubExists = !!camPub;
      const remoteCamPubHasTrack = !!camPub?.track;
      const remoteCamPubMuted = camPub ? !!camPub.isMuted : true;

      const remoteCamActuallyVisible =
        remoteCamPubExists && remoteCamPubHasTrack && !remoteCamPubMuted;

      const vt = remoteCamActuallyVisible
        ? (camPub?.track as any) || undefined
        : undefined;
      const remoteAudioTrack =
        micPub?.track instanceof RemoteAudioTrack ? micPub.track : undefined;

      const exactIdentity = String(rp.identity || "");
      const baseUserId = extractBaseUserIdFromIdentity(exactIdentity);
      const prof = looksLikeUuid(baseUserId)
        ? currentProfilesById[String(baseUserId).toLowerCase()]
        : undefined;

      const nameFromProfile = String(prof?.full_name || "").trim();
      const nm =
        (nameFromProfile || rp.name || rp.identity || "Guest").trim() ||
        "Guest";

      const tileId = rp.sid;
      const remoteMicMuted = micPub ? !!(micPub as any).isMuted : true;

      const participantMetadataDisplayName =
        getDisplayNameFromParticipantMetadata((rp as any)?.metadata);

      const participantStatus = getStatusFromMetadata((rp as any)?.metadata);

      const effectiveRemoteLabel =
        participantMetadataDisplayName ||
        String(nm || "").trim() ||
        String((rp as any)?.name || "").trim() ||
        "Participant";

      next.push({
        id: tileId,
        kind: "camera",
        label: effectiveRemoteLabel,
        metadataDisplayName: participantMetadataDisplayName || undefined,
        status: participantStatus,
        isLocal: false,
        videoTrack: vt,
        audioTrack: remoteAudioTrack,
        isSpeaking: !remoteMicMuted && !!rp.isSpeaking,
        participantIdentity: exactIdentity || undefined,
        participantUserId: baseUserId || undefined,
        micTrackSid: micPub?.trackSid,
        camTrackSid: camPub?.trackSid,
        micMuted: remoteMicMuted,
        camPubExists: remoteCamPubExists,
        camPubHasTrack: remoteCamPubHasTrack,
        camPubMuted: remoteCamPubMuted,
        remoteMicPubSid: micPub?.trackSid ? String(micPub.trackSid) : undefined,
      });

      const volumeKey = getParticipantVolumeKey({
        id: tileId,
        participantUserId: baseUserId || undefined,
        participantIdentity: exactIdentity || undefined,
      });

      const pct = Number(
        volumePctByParticipantKeyRef.current[volumeKey] ?? 100,
      );
      if (Number.isFinite(pct)) {
        applyVolumeToRemoteParticipant(tileId, pct);
      }
    });

    setTiles((prev) => (areTileListsEqual(prev, next) ? prev : next));

    requestRemoteScreenShareSubscriptions(room);

    const nextScreenSharesRaw = buildScreenShareTiles({
      room,
      authUserId,
      displayName,
      userName,
      profilesById: currentProfilesById,
    }) as TileModel[];

    const nextScreenShares =
      filterRenderableScreenShareTiles(nextScreenSharesRaw);

    setScreenShareTiles((prev) =>
      areTileListsEqual(prev, nextScreenShares) ? prev : nextScreenShares,
    );
    setScreenShareOn(hasLocalLiveScreenShare(room));
  };

  const disconnectRoom = async (opts?: {
    skipNavigate?: boolean;
    preserveKickNotice?: boolean;
    preserveAttendance?: boolean;
    preserveTabPresence?: boolean;
    preserveJoinRequested?: boolean;
  }) => {
    try {
      const r = roomRef.current;
      roomRef.current = null;
      setRoomState(null);

      if (r) {
        r.removeAllListeners();
        await r.disconnect();
      }
    } catch (e) {
      console.warn("disconnect error:", e);
    } finally {
      setConnected(false);
      setMicOn(false);
      setCamOn(false);
      setScreenShareOn(false);
      setTiles([]);
      setScreenShareTiles([]);
      setFxStatusText("");
      setFxError("");
      setFxApplying(false);
      setOpenTileAdminMenuId(null);
      if (!opts?.preserveJoinRequested) {
        setJoinRequested(false);
      }
      connectInFlightRef.current = false;

      if (!opts?.preserveKickNotice) {
        setSystemNotice((prev) => ({ ...prev, open: false }));
      }

      if (!opts?.preserveAttendance) {
        await leaveAttendanceOnce({ keepalive: false });
      }
      if (!opts?.preserveTabPresence) {
        releaseTabPresence();
      }
      await closePictureInPicture().catch(() => { });
    }
  };

  useEffect(() => {
    if (!sessionId || !sessionCloseInfo.closed) return;

    clearMobileRoomLease(sessionId, authUserId);
    setPrejoinOpen(false);
    setJoinRequested(false);
    setTokenError("");
    setClientError("");
    setMediaWarning("");

    if (autoClosedSessionIdRef.current === sessionId) return;
    autoClosedSessionIdRef.current = sessionId;

    const shouldDisconnect =
      !!roomRef.current ||
      connectedRef.current ||
      joinRequestedRef.current ||
      connectInFlightRef.current;

    if (!shouldDisconnect) return;

    explicitLeaveRequestedRef.current = true;

    void disconnectRoom({
      skipNavigate: true,
      preserveKickNotice: true,
    }).catch((e) => {
      console.warn("[session-close] auto disconnect failed:", e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, sessionCloseInfo.closed, authUserId]);

  const syncLiveAudioInput = async (deviceId: string) => {
    const useId = pickExistingDeviceId(
      String(deviceId || ""),
      devices.audioInputs,
    );

    setSelectedAudioInputId(useId);
    setPrejoin((prev) => ({ ...prev, audioInputId: useId }));
    prejoinRef.current = { ...prejoinRef.current, audioInputId: useId };

    const r = roomRef.current;
    if (!r) return;

    try {
      if (!micOn) return;

      await r.localParticipant.setMicrophoneEnabled(true, {
        deviceId: useId || undefined,
        echoCancellation: prejoinRef.current.echoCancellation,
        noiseSuppression: prejoinRef.current.noiseSuppression,
        autoGainControl: prejoinRef.current.autoGainControl,
      } as any);

      scheduleRebuildTiles();
    } catch (e) {
      console.error("syncLiveAudioInput failed:", e);
      setClientError(
        String((e as any)?.message || e || "audio_input_switch_failed"),
      );
    }
  };

  const syncLiveVideoInput = async (deviceId: string) => {
    const useId = pickExistingDeviceId(
      String(deviceId || ""),
      devices.videoInputs,
    );

    setSelectedVideoInputId(useId);
    setPrejoin((prev) => ({ ...prev, videoInputId: useId }));
    prejoinRef.current = { ...prejoinRef.current, videoInputId: useId };

    const r = roomRef.current;

    try {
      if (!r) {
        if (prejoinOpen && prejoinRef.current.videoEnabled) {
          await initPrejoinPreview({
            forceTrack: true,
          });
        }
        return;
      }

      if (!camOn) return;

      const existingPub: any = getLocalCameraPublication();
      if (existingPub?.track) {
        try {
          await existingPub.track.stop?.();
        } catch { }
        try {
          await r.localParticipant.unpublishTrack(existingPub.track, true);
        } catch { }
      }

      const nextTrack = await createLocalVideoTrack({
        deviceId: useId || undefined,
        resolution: {
          width: isChromeOS ? 640 : capturePreset.width,
          height: isChromeOS ? 360 : capturePreset.height,
        },
        frameRate: isChromeOS ? 15 : capturePreset.fps,
      } as any);

      if (!shouldDisableBackgroundFx && videoFxMode !== "off") {
        try {
          await safeApplyProcessor(
            nextTrack,
            videoFxMode,
            blurStrength,
            bgImageUrl,
          );
        } catch (e) {
          console.warn("syncLiveVideoInput fx apply failed:", e);
        }
      }

      await r.localParticipant.publishTrack(nextTrack, {
        source: Track.Source.Camera,
      } as any);
      scheduleRebuildTiles();
    } catch (e) {
      console.error("syncLiveVideoInput failed:", e);
      setMediaWarning(
        normalizeMediaWarningMessage(
          (e as any)?.message || e || "video_input_switch_failed",
        ),
      );
    }
  };

  const syncLiveAudioProcessing = async (next: {
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
  }) => {
    const r = roomRef.current;
    if (!r) return;
    if (!micOn) return;

    try {
      await r.localParticipant.setMicrophoneEnabled(true, {
        deviceId:
          selectedAudioInputId || prejoinRef.current.audioInputId || undefined,
        echoCancellation: next.echoCancellation,
        noiseSuppression: next.noiseSuppression,
        autoGainControl: next.autoGainControl,
      } as any);
      scheduleRebuildTiles();
    } catch (e) {
      console.error("syncLiveAudioProcessing failed:", e);
      setMediaWarning(
        normalizeMediaWarningMessage(
          (e as any)?.message || e || "audio_processing_failed",
        ),
      );
    }
  };

  const connectRoom = async (opts: {
    forceReconnect?: boolean;
    preserveAttendance?: boolean;
    preserveTabPresence?: boolean;
    preserveJoinRequested?: boolean;
    tokenOverride?: string;
    serverUrlOverride?: string;
  } = {}) => {
    const connectToken = String(opts.tokenOverride || lkToken || "").trim();
    const connectServerUrl = String(
      opts.serverUrlOverride || lkServerUrl || "",
    ).trim();
    if (!connectServerUrl || !connectToken) return;
    if (connectInFlightRef.current) return;

    const existingRoom: any = roomRef.current as any;
    const existingState = String(existingRoom?.state || "").toLowerCase();

    // Important for mobile/tablet tab switching:
    // returning to the tab can re-trigger joinRequested/effects while the original
    // LiveKit room is still connected. Do NOT disconnect/reconnect in that case,
    // because that causes the visible local video tile reload.
    if (existingRoom && existingState === "connected" && !opts.forceReconnect) {
      setConnected(true);
      setPrejoinOpen(false);
      setMobileMediaRestoreOpen(false);
      setMediaWarning("");
      scheduleRebuildTiles();
      window.setTimeout(() => scheduleRebuildTiles(), 120);
      return;
    }

    if (
      existingRoom &&
      !opts.forceReconnect &&
      (existingState === "connecting" ||
        existingState === "reconnecting" ||
        existingState === "signalreconnecting")
    ) {
      openMobileRestoreState("restoring");
      return;
    }

    if (paywallRuntimeBlocked && !!authUserId) {
      setPaywallModalOpen(true);
      return;
    }

    connectInFlightRef.current = true;
    const attemptId = connectAttemptIdRef.current + 1;
    connectAttemptIdRef.current = attemptId;

    let connectedToRoom = false;

    setClientError("");
    setFxError("");
    setMediaWarning("");

    if (roomRef.current) {
      await disconnectRoom({
        // This cleanup is part of the same join/reconnect attempt. Releasing the
        // tab slot, writing an attendance leave, and clearing join state here only
        // adds network work and immediately undoes the gate acquired by Join.
        preserveAttendance: opts.preserveAttendance ?? true,
        preserveTabPresence: opts.preserveTabPresence ?? true,
        preserveJoinRequested: opts.preserveJoinRequested ?? true,
      });
      connectInFlightRef.current = true;
    }

    try {
      const pj = prejoinRef.current;

      const r =
        prewarmedRoomRef.current ||
        new Room({
          adaptiveStream: false,
          dynacast: true,
          disconnectOnPageLeave: false,
          reconnectPolicy: createMobileReconnectPolicy(),
          publishDefaults: {
            simulcast: !lowPowerMobileMode,
            videoCodec: "vp8",
          } as any,
        });
      prewarmedRoomRef.current = null;

      roomRef.current = r;
      setRoomState(r);

      const refresh = () => scheduleRebuildTiles();

      r.on(RoomEvent.Connected, () => {
        captureProductEvent("room_connected", { recovered: false });
        void writeConnectionDiagnostic("livekit.connected", {
          roomState: String((r as any)?.state || ""),
        });

        setConnected(true);
        writeMobileRoomLease(sessionId, authUserId, {
          audioEnabled: prejoinRef.current.audioEnabled,
          videoEnabled: prejoinRef.current.videoEnabled,
        });
        if (returningFromBackgroundRef.current || mobileMediaRestoreOpen) {
          closeMobileRestoreState();
          returningFromBackgroundRef.current = false;
          pageHiddenAtRef.current = null;
          setMediaWarning("");
        }
        refresh();
      });

      r.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (roomRef.current && roomRef.current !== r) {
          void writeConnectionDiagnostic("livekit.stale_disconnected_ignored", {
            reason: getDisconnectReasonLabel(reason),
          });
          return;
        }

        const reasonLabel = getDisconnectReasonLabel(reason);
        const terminalDisconnect =
          explicitLeaveRequestedRef.current ||
          kickedBySignalRef.current ||
          isTerminalRoomDisconnect(reason);

        captureProductEvent("room_disconnected", {
          terminal: terminalDisconnect,
          reason_code: Number.isFinite(Number(reason)) ? Number(reason) : null,
        });

        void writeConnectionDiagnostic("livekit.disconnected", {
          reason: reasonLabel,
          reason_code: Number.isFinite(Number(reason)) ? Number(reason) : null,
          terminal: terminalDisconnect,
          roomState: String((r as any)?.state || ""),
        });

        setConnected(false);
        setTiles([]);
        setScreenShareTiles([]);
        setOpenTileAdminMenuId(null);

        if (!terminalDisconnect) {
          // A final LiveKit Disconnected event can arrive after Safari has already
          // made the page visible again. Treat network/OS disconnects as recoverable
          // regardless of the current visibility state; they are not user intent.
          returningFromBackgroundRef.current = true;
          writeMobileRoomLease(sessionId, authUserId, {
            audioEnabled: prejoinRef.current.audioEnabled,
            videoEnabled: prejoinRef.current.videoEnabled,
          });
          void attendanceHeartbeat();
          startAttendanceHeartbeat();
          openMobileRestoreState(
            document.visibilityState === "visible" ? "restoring" : "needs_action",
          );
          setMediaWarning("Restoring your connection…");

          if (document.visibilityState === "visible") {
            if (unexpectedDisconnectRecoveryTimerRef.current) {
              window.clearTimeout(unexpectedDisconnectRecoveryTimerRef.current);
            }
            unexpectedDisconnectRecoveryTimerRef.current = window.setTimeout(() => {
              unexpectedDisconnectRecoveryTimerRef.current = null;
              window.dispatchEvent(new Event(ROOM_RECOVERY_REQUEST_EVENT));
            }, 300);
          }
          return;
        }

        void trackWeeklyUsageOnLeave();
        void leaveAttendanceOnce({ keepalive: false });

        if (!kickedBySignalRef.current && !kickRedirecting) {
          showSystemNotice({
            kind: "info",
            title: "Disconnected",
            body: "This room connection was closed.",
          });
        }

        releaseTabPresence();
      });

      const handleLiveKitReconnecting = (eventType: string) => {
        captureProductEvent("room_reconnecting", {
          signal_only: eventType === "livekit.signal_reconnecting",
        });
        void writeConnectionDiagnostic(eventType, {
          roomState: String((r as any)?.state || ""),
        });

        if (
          !explicitLeaveRequestedRef.current &&
          !kickedBySignalRef.current
        ) {
          openMobileRestoreState("restoring");
          setMediaWarning("Restoring your connection…");
        }
      };

      r.on(RoomEvent.Reconnecting, () => {
        handleLiveKitReconnecting("livekit.reconnecting");
      });
      r.on(RoomEvent.SignalReconnecting, () => {
        handleLiveKitReconnecting("livekit.signal_reconnecting");
      });

      r.on(RoomEvent.Reconnected, () => {
        captureProductEvent("room_connected", { recovered: true });
        void writeConnectionDiagnostic("livekit.reconnected", {
          roomState: String((r as any)?.state || ""),
        });

        if (unexpectedDisconnectRecoveryTimerRef.current) {
          window.clearTimeout(unexpectedDisconnectRecoveryTimerRef.current);
          unexpectedDisconnectRecoveryTimerRef.current = null;
        }
        setConnected(true);
        void attendanceHeartbeat();
        startAttendanceHeartbeat();
        closeMobileRestoreState();
        returningFromBackgroundRef.current = false;
        pageHiddenAtRef.current = null;
        setMediaWarning("");
        refresh();
      });
      r.on(RoomEvent.ParticipantConnected, () => {
        if (joinSoundEnabledRef.current) {
          playOneShotFromCandidates(JOIN_SOUND_CANDIDATES, 0.8);
        }
        refresh();
      });
      r.on(RoomEvent.ParticipantDisconnected, () => {
        if (leaveSoundEnabledRef.current) {
          playOneShotFromCandidates(LEAVE_SOUND_CANDIDATES, 0.8);
        }
        refresh();
      });
      const refreshRemoteAudioState = () => {
        if (selfDeafenedRef.current) {
          applySelfDeafenToRoom(r, true);
        }
        refresh();
      };
      r.on(RoomEvent.TrackSubscribed, refreshRemoteAudioState);
      r.on(RoomEvent.TrackUnsubscribed, refreshRemoteAudioState);
      r.on(RoomEvent.TrackMuted as any, refreshRemoteAudioState as any);
      r.on(RoomEvent.TrackUnmuted as any, refreshRemoteAudioState as any);
      r.on(RoomEvent.TrackPublished as any, refreshRemoteAudioState as any);
      r.on(RoomEvent.TrackUnpublished as any, refresh as any);
      r.on(RoomEvent.TrackSubscriptionFailed as any, refresh as any);
      r.on(RoomEvent.ActiveSpeakersChanged, refresh);
      r.on(RoomEvent.LocalTrackPublished as any, refresh as any);
      r.on(RoomEvent.LocalTrackUnpublished as any, refresh as any);
      r.on(
        RoomEvent.DataReceived,
        ((payload: Uint8Array, sender?: RemoteParticipant, _kind?: unknown, topic?: string) => {
          if (topic !== PARTICIPANT_CONTROL_TOPIC || !sender) return;

          const senderIdentity = String(sender.identity || "").trim();
          const senderUserId = extractBaseUserIdFromIdentity(senderIdentity)
            .trim()
            .toLowerCase();
          const senderHasRoomAdminGrant =
            (sender as any)?.permissions?.roomAdmin === true;

          // Sender identity comes from LiveKit itself, not from the packet. The
          // allow-list also covers a temporary infinite-room host whose token was
          // issued before they stepped in and therefore has no roomAdmin grant.
          if (
            !senderHasRoomAdminGrant &&
            !participantControlSenderIdsRef.current.has(senderUserId)
          ) {
            return;
          }

          try {
            const message = JSON.parse(new TextDecoder().decode(payload)) as {
              action?: string;
              issuedAt?: number;
            };
            const issuedAt = Number(message?.issuedAt || 0);
            if (!issuedAt || Math.abs(Date.now() - issuedAt) > 15_000) return;

            if (message.action === "mute_microphone") {
              void r.localParticipant.setMicrophoneEnabled(false);
            } else if (message.action === "turn_off_camera") {
              void r.localParticipant.setCameraEnabled(false);
            }
          } catch {
            // Ignore unrelated or malformed data packets.
          }
        }) as any,
      );

      // Limit only the signalling connection itself. The previous watchdog kept
      // running while camera/microphone permissions and tracks were prepared, so
      // a slow permission prompt could disconnect an already connected room.
      await withTimeout(
        r.connect(connectServerUrl, connectToken, { autoSubscribe: true }),
        ROOM_CONNECT_TIMEOUT_MS,
        "Connecting to LiveKit timed out. Please try again.",
      );

      if (connectAttemptIdRef.current !== attemptId) {
        throw new Error("LiveKit connection attempt was superseded.");
      }
      connectedToRoom = true;

      if (USAGE_TRACKING_ENABLED && !opts.preserveAttendance) {
        sessionJoinStartedAtRef.current = Date.now();
        usageTrackedRef.current = false;

        void incrementWeeklyUsage({
          userId: String(authUserId || "").trim(),
          addSessions: 1,
        })
          .then(() => {
            console.log("[usage] weekly session counted:", {
              userId: authUserId,
              sessionId: session?.id,
            });
          })
          .catch((e) => {
            console.error("[usage] incrementWeeklyUsage sessions failed:", e);
          });
      }

      await r.localParticipant.setCameraEnabled(false);
      setCamOn(false);

      await r.localParticipant.setMicrophoneEnabled(false);
      setMicOn(false);

      if (pendingRoomAudioUnlockRef.current) {
        try {
          await ensureRoomAudioPlaybackUnlocked("connect");
        } catch (e) {
          console.warn("post-connect room audio unlock failed:", e);
        } finally {
          pendingRoomAudioUnlockRef.current = false;
        }
      }

      kickedBySignalRef.current = false;

      leaveOnceRef.current = false;
      leavePromiseRef.current = null;
      if (attendanceActiveRef.current) {
        void attendanceHeartbeat();
        startAttendanceHeartbeat();
      } else {
        void attendanceJoin()
          .then(() => startAttendanceHeartbeat())
          .catch((e) => console.warn("attendance join failed:", e));
      }

      const shouldAutoStartCameraOnJoin = !!pj.videoEnabled;

      // Camera from prejoin. Important: weak laptops / Firefox should still TRY camera.
      // Heavy FX can fail separately, but camera failure must not break room join.
      if (shouldAutoStartCameraOnJoin) {
        try {
          const fxAllowed = videoFxMode !== "off" && !shouldDisableBackgroundFx;
          let prepared = prejoinPreparedVideoTrackRef.current;

          if (!prepared) {
            prepared = await createPrejoinPreparedVideoTrack({ force: true });

            if (prepared && fxAllowed) {
              try {
                await safeApplyProcessor(
                  prepared,
                  videoFxMode,
                  blurStrength,
                  bgImageUrl,
                );
              } catch (e) {
                console.warn("apply fx before publish failed:", e);
              }
            }
          }

          let cameraPublished = false;

          if (prepared) {
            const preparedMediaTrack = (prepared as any)?.mediaStreamTrack as
              | MediaStreamTrack
              | undefined;

            if (preparedMediaTrack?.readyState !== "ended") {
              try {
                await r.localParticipant.publishTrack(prepared, {
                  source: Track.Source.Camera,
                } as any);
                const liveCamera = await waitForLocalCameraTrackLive(
                  r.localParticipant,
                  3200,
                );
                if (!liveCamera) {
                  throw new Error("prepared_camera_track_did_not_become_live");
                }
                prejoinPreparedVideoTrackRef.current = null;
                bindLocalCameraEndedListener(liveCamera.mediaTrack, "join");
                cameraPublished = true;
              } catch (publishError) {
                console.warn(
                  "[join] prepared camera publish failed; retrying default camera:",
                  publishError,
                );
                await cleanupPrejoinPreparedVideoTrack().catch(() => { });
              }
            }
          }

          if (!cameraPublished) {
            const requestedCameraId = String(
              pj.videoInputId || selectedVideoInputId || "",
            ).trim();

            const cameraResult = await enableLocalCameraWithRecovery(
              r.localParticipant,
              {
                context: "join",
                requestedDeviceId: requestedCameraId,
              },
            );

            if (
              requestedCameraId &&
              cameraResult.attemptName !== "selected"
            ) {
              setSelectedVideoInputId("");
              prejoinRef.current = {
                ...prejoinRef.current,
                videoInputId: "",
              };
            }
          }

          // On lease-based refresh/rejoin the room connects before the fallback
          // camera track is necessarily published. Re-apply the persisted FX to
          // the confirmed live publication so blur/background cannot disappear.
          if (fxAllowed) {
            const liveCamera = await waitForLocalCameraTrackLive(
              r.localParticipant,
              4200,
            );
            const publishedTrack = liveCamera?.publication?.track as
              | LocalVideoTrack
              | undefined;
            if (publishedTrack) {
              try {
                await safeApplyProcessor(
                  publishedTrack,
                  videoFxMode,
                  blurStrength,
                  bgImageUrl,
                );
              } catch (fxRestoreError) {
                console.warn("[join] persisted video fx restore failed:", fxRestoreError);
              }
            }
          }

          setCamOn(true);

          setDeviceError("");
        } catch (e: any) {
          console.warn("[join] camera enable failed:", e);
          captureProductEvent("camera_permission_failed", {
            error_name: String(e?.name || "camera_enable_failed"),
          });
          setCamOn(false);

          const msg = normalizeMediaWarningMessage(
            e?.message || e?.name || e || "camera_enable_failed",
          );

          setDeviceError(msg);
          setMediaWarning(
            `${msg} You joined the room, but your camera is off. Check the browser's site settings, allow Camera, close other apps using it, then try Camera on again.`,
          );
        }
      } else {
        try {
          await r.localParticipant.setCameraEnabled(false);
        } catch { }
        setCamOn(false);
      }

      // Microphone from prejoin. Failure should not kick user out of the room.
      if (pj.audioEnabled) {
        try {
          await r.localParticipant.setMicrophoneEnabled(true, {
            deviceId: pj.audioInputId || selectedAudioInputId || undefined,
            echoCancellation: !!pj.echoCancellation,
            noiseSuppression: !!pj.noiseSuppression,
            autoGainControl: !!pj.autoGainControl,
          } as any);
          setMicOn(true);
        } catch (e: any) {
          console.warn("[join] microphone enable failed:", e);
          setMicOn(false);

          const msg = normalizeMediaWarningMessage(
            e?.message || e?.name || e || "microphone_enable_failed",
          );

          setDeviceError(msg);
          setMediaWarning(
            `${msg} You joined the room, but your microphone is off. In Firefox, click the lock icon near the address bar, allow Microphone, then choose the microphone and try again.`,
          );
        }
      }

      refresh();

      setSelectedAudioOutputId(pj.audioOutputId || "default");
      setSelectedAudioInputId(pj.audioInputId || selectedAudioInputId || "");
      setSelectedVideoInputId(pj.videoInputId || selectedVideoInputId || "");

      setEchoCancellationEnabled(!!pj.echoCancellation);
      setNoiseSuppressionEnabled(!!pj.noiseSuppression);
      setAutoGainControlEnabled(!!pj.autoGainControl);

      setPrejoinOpen(false);
      setPrejoinPreviewVersion((v) => v + 1);
    } catch (e: any) {
      console.error("LiveKit connect failed:", e);

      const msg = String(e?.message || e || "connect_failed");

      if (!connectedToRoom) {
        setClientError(msg);
        await disconnectRoom({
          preserveAttendance: opts.preserveAttendance,
          preserveTabPresence: opts.preserveTabPresence,
          preserveJoinRequested: opts.preserveJoinRequested,
        });

        if (!opts.preserveJoinRequested) {
          setJoinRequested(false);
          setPrejoinOpen(true);
        }
      } else {
        setMediaWarning(normalizeMediaWarningMessage(msg));
        console.warn(
          "Media step failed after room connect, keeping user in room",
        );
      }
    } finally {
      if (connectAttemptIdRef.current === attemptId) {
        connectInFlightRef.current = false;
      }
    }
  };

  useEffect(() => {
    if (!joinRequested) return;
    if (!lkToken) return;
    if (!lkServerUrl) return;
    connectRoom().catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinRequested, lkToken, lkServerUrl]);

  useEffect(() => {
    return () => {
      roomLifecycleDiagnosticRef.current("react.room_cleanup_started", {
        explicit_leave_requested: explicitLeaveRequestedRef.current,
        visibility_state:
          typeof document !== "undefined"
            ? document.visibilityState
            : "unknown",
      });
      if (unexpectedDisconnectRecoveryTimerRef.current) {
        window.clearTimeout(unexpectedDisconnectRecoveryTimerRef.current);
        unexpectedDisconnectRecoveryTimerRef.current = null;
      }
      const retention = mobileRoomRetentionRef.current;
      const preserveBackgroundSession =
        retention.enabled &&
        !explicitLeaveRequestedRef.current &&
        typeof document !== "undefined" &&
        document.visibilityState !== "visible" &&
        !!readMobileRoomLease(retention.sessionId, retention.userId);

      if (rebuildRafRef.current) {
        try {
          cancelAnimationFrame(rebuildRafRef.current);
        } catch { }
      }
      disconnectRoom({
        preserveAttendance: preserveBackgroundSession,
        preserveTabPresence: preserveBackgroundSession,
        preserveJoinRequested: preserveBackgroundSession,
      }).catch(() => { });
      localCameraEndedCleanupRef.current?.();
      localCameraEndedCleanupRef.current = null;
      cleanupPrejoinPreparedVideoTrack().catch(() => { });
      if (uploadedBgUrlRef.current) {
        try {
          URL.revokeObjectURL(uploadedBgUrlRef.current);
        } catch { }
      }
      stopWelcomeLoop();
      if (!preserveBackgroundSession) {
        releaseTabPresence();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // toggle mic
  const toggleMic = async () => {
    const room = roomRef.current || roomState;

    if (!room?.localParticipant) {
      console.warn("[mic-toggle] skipped: room/localParticipant is not ready");
      setMediaWarning(
        "Microphone is not ready yet. Please wait a moment and try again.",
      );
      return;
    }

    const lp = room.localParticipant;

    const currentlyEnabled = (() => {
      try {
        const pubs = Array.from(lp.audioTrackPublications?.values?.() || []);
        const micPub = pubs.find(
          (p: any) => p?.source === Track.Source.Microphone,
        );
        return !!micPub && !micPub.isMuted && !!micPub.track;
      } catch {
        return !!micOn;
      }
    })();

    const nextEnabled = !currentlyEnabled;

    const selectedMicId = String(
      selectedAudioInputId || prejoinRef.current.audioInputId || "",
    ).trim();

    const micConstraintsWithSelectedDevice = {
      deviceId: selectedMicId || undefined,
      echoCancellation: echoCancellationEnabled,
      noiseSuppression: noiseSuppressionEnabled,
      autoGainControl: autoGainControlEnabled,
    } as any;

    const micConstraintsWithDefaultDevice = {
      echoCancellation: echoCancellationEnabled,
      noiseSuppression: noiseSuppressionEnabled,
      autoGainControl: autoGainControlEnabled,
    } as any;

    const finishMicToggleSuccess = async (usedFallbackDefaultMic = false) => {
      setMicOn(nextEnabled);

      if (nextEnabled) {
        setDeviceError("");

        if (usedFallbackDefaultMic) {
          setSelectedAudioInputId("");
          setPrejoin((prev) => ({
            ...prev,
            audioInputId: "",
            audioEnabled: true,
          }));
          prejoinRef.current = {
            ...prejoinRef.current,
            audioInputId: "",
            audioEnabled: true,
          };

          setMediaWarning(
            "Your selected microphone did not start, so MySession switched to the default microphone. If this is not the right mic, open Settings and choose another microphone.",
          );
        } else {
          setMediaWarning("");
        }
      } else {
        setMediaWarning("");
      }

      await ensureRoomAudioPlaybackUnlocked("toggle-mic");

      window.setTimeout(() => {
        ensureRoomAudioPlaybackUnlocked("toggle-mic-delayed").catch(() => { });
      }, 180);

      scheduleRebuildTiles();

      window.setTimeout(() => {
        scheduleRebuildTiles();
      }, 120);

      window.setTimeout(() => {
        scheduleRebuildTiles();
      }, 420);

      setRemoteAudioRecoveryTick((v) => v + 1);
    };

    console.log("[mic-toggle] click", {
      currentlyEnabled,
      nextEnabled,
      selectedAudioInputId,
      prejoinAudioInputId: prejoinRef.current.audioInputId,
      selectedMicId,
      echoCancellationEnabled,
      noiseSuppressionEnabled,
      autoGainControlEnabled,
      browser: navigator.userAgent,
    });

    try {
      setMediaWarning("");

      await lp.setMicrophoneEnabled(
        nextEnabled,
        micConstraintsWithSelectedDevice,
      );

      await finishMicToggleSuccess(false);

      console.log("[mic-toggle] ok", {
        nextEnabled,
        usedFallbackDefaultMic: false,
        selectedMicId,
      });
    } catch (firstError: any) {
      console.error("[mic-toggle] first attempt failed:", firstError);

      // Self-healing unmute:
      // If a user is trying to unmute and the selected/exact microphone fails,
      // try again with the browser default microphone. This helps Firefox,
      // stale deviceId, Bluetooth/headset disconnects, and wrong-device cases.
      if (nextEnabled && selectedMicId) {
        try {
          console.warn("[mic-toggle] retrying with default microphone", {
            failedSelectedMicId: selectedMicId,
            firstError,
          });

          try {
            await lp.setMicrophoneEnabled(false);
          } catch { }

          await delay(120);

          await lp.setMicrophoneEnabled(true, micConstraintsWithDefaultDevice);

          await finishMicToggleSuccess(true);

          console.log("[mic-toggle] ok after default microphone fallback", {
            failedSelectedMicId: selectedMicId,
          });

          return;
        } catch (fallbackError: any) {
          console.error(
            "[mic-toggle] default microphone fallback failed:",
            fallbackError,
          );

          setMicOn(currentlyEnabled);

          const firstMsg = normalizeMediaWarningMessage(
            firstError?.message ||
            firstError?.name ||
            firstError ||
            "microphone_toggle_failed",
          );
          const fallbackMsg = normalizeMediaWarningMessage(
            fallbackError?.message ||
            fallbackError?.name ||
            fallbackError ||
            "default_microphone_failed",
          );

          const combinedMsg =
            firstMsg === fallbackMsg
              ? firstMsg
              : `${firstMsg} Default microphone also failed: ${fallbackMsg}`;

          setDeviceError(combinedMsg);
          setMediaWarning(
            `${combinedMsg} Check the browser lock icon, allow Microphone, close Zoom/Discord/Meet/OBS, then open Settings and choose Default microphone.`,
          );

          scheduleRebuildTiles();

          window.setTimeout(() => {
            scheduleRebuildTiles();
          }, 180);

          return;
        }
      }

      setMicOn(currentlyEnabled);

      const msg = normalizeMediaWarningMessage(
        firstError?.message ||
        firstError?.name ||
        firstError ||
        "microphone_toggle_failed",
      );

      setDeviceError(msg);
      setMediaWarning(
        `${msg} Check the browser lock icon, allow Microphone, close Zoom/Discord/Meet/OBS, then open Settings and choose Default microphone.`,
      );

      scheduleRebuildTiles();

      window.setTimeout(() => {
        scheduleRebuildTiles();
      }, 180);
    }
  };

  const unmuteMicForAiCheckin = async () => {
    if (micOn) return;
    await toggleMic();
  };

  const muteMicAfterAiCheckin = async () => {
    if (!micOn) return;
    await toggleMic();
  };

  // Toggle camera with a deterministic default-device fallback. Safari can
  // invalidate a previously enumerated deviceId after permission changes, and
  // useTrackToggle otherwise keeps retrying that stale id on every click.
  const toggleCam = async (force?: boolean) => {
    const room = roomRef.current || roomState;
    if (!room?.localParticipant) {
      setMediaWarning(
        "Camera is not ready yet. Please wait a moment and try again.",
      );
      return;
    }

    const lp = room.localParticipant;
    const currentPublication = findLocalCameraPublication(lp);
    const currentMediaTrack =
      getCameraMediaTrackFromPublication(currentPublication);
    const currentlyEnabled =
      !!currentPublication?.track &&
      !currentPublication.isMuted &&
      currentMediaTrack?.readyState === "live";
    const nextEnabled = typeof force === "boolean" ? force : !currentlyEnabled;
    const requestedCameraId = String(
      selectedVideoInputId || prejoinRef.current.videoInputId || "",
    ).trim();

    if (typeof force === "boolean" && force === currentlyEnabled) {
      setCamOn(currentlyEnabled);
      return;
    }

    try {
      setMediaWarning("");

      if (!nextEnabled) {
        cameraStopExpectedRef.current = true;
        localCameraEndedCleanupRef.current?.();
        localCameraEndedCleanupRef.current = null;
        try {
          await lp.setCameraEnabled(false);
        } finally {
          cameraStopExpectedRef.current = false;
        }
      } else {
        const cameraResult = await enableLocalCameraWithRecovery(lp, {
          context: "toggle",
          requestedDeviceId: requestedCameraId,
        });

        if (
          requestedCameraId &&
          cameraResult.attemptName !== "selected"
        ) {
          setSelectedVideoInputId("");
          setPrejoin((prev) => ({ ...prev, videoInputId: "" }));
          prejoinRef.current = {
            ...prejoinRef.current,
            videoInputId: "",
          };
        }
      }

      setCamOn(nextEnabled);
      setDeviceError("");

      await ensureRoomAudioPlaybackUnlocked("toggle-cam");

      window.setTimeout(() => {
        ensureRoomAudioPlaybackUnlocked("toggle-cam-delayed").catch(() => { });
      }, 180);

      scheduleRebuildTiles();

      window.setTimeout(() => {
        scheduleRebuildTiles();
      }, 120);
    } catch (e: any) {
      console.error("toggleCam error:", e);

      const msg = normalizeMediaWarningMessage(
        e?.message || e?.name || e || "camera_toggle_failed",
      );

      setMediaWarning(
        `${msg} Check the browser's site settings, allow Camera, close other apps using it, and try again.`,
      );

      const actualPublication = findLocalCameraPublication(lp);
      const actualMediaTrack =
        getCameraMediaTrackFromPublication(actualPublication);
      const actuallyEnabled =
        !!actualPublication?.track &&
        !actualPublication.isMuted &&
        actualMediaTrack?.readyState === "live";

      setCamOn(actuallyEnabled);
      setDeviceError(msg);
      void logRoomDiagnostic("camera_toggle_failed", {
        ...getMediaErrorDiagnostic(e),
        requestedDevice: !!requestedCameraId,
      });
      scheduleRebuildTiles();
    }
  };

  useEffect(() => {
    if (cameraPolicyTimerRef.current !== null) {
      window.clearTimeout(cameraPolicyTimerRef.current);
      cameraPolicyTimerRef.current = null;
    }

    if (
      !connected ||
      !roomPolicies.cameraRequired ||
      isHost ||
      isSelfModerator ||
      camOn ||
      kickRedirecting
    ) {
      return;
    }

    let cancelled = false;
    const schedule = (callback: () => void, delayMs: number) => {
      cameraPolicyTimerRef.current = window.setTimeout(() => {
        cameraPolicyTimerRef.current = null;
        if (!cancelled) callback();
      }, delayMs);
    };

    const disconnectForCameraPolicy = () => {
      void (async () => {
        kickedBySignalRef.current = true;
        setKickRedirecting(true);
        await disconnectRoom({
          skipNavigate: true,
          preserveKickNotice: true,
        });
        setSystemNotice({
          open: true,
          kind: "kick",
          title: "Camera required",
          body: "The host enabled cameras-only mode, so you were disconnected from the room.",
        });
      })();
    };

    const showReminder = (reminder: 1 | 2) => {
      showSystemNotice({
        kind: "info",
        presentation: "camera-reminder",
        title: "Please turn on your camera",
        body:
          reminder === 1
            ? "This room requires cameras. Please turn yours on within two minutes of joining to stay in the room."
            : "Your camera is still off. This is the final reminder; turn it on within 30 seconds to stay in the room.",
        actionLabel: "Turn camera on",
        action: () => {
          void toggleCam(true);
        },
      });
    };

    schedule(() => {
      showReminder(1);
      schedule(() => {
        showReminder(2);
        schedule(disconnectForCameraPolicy, 30_000);
      }, 70_000);
    }, 20_000);

    return () => {
      cancelled = true;
      if (cameraPolicyTimerRef.current !== null) {
        window.clearTimeout(cameraPolicyTimerRef.current);
        cameraPolicyTimerRef.current = null;
      }
    };
  }, [
    camOn,
    connected,
    isHost,
    isSelfModerator,
    kickRedirecting,
    roomPolicies.cameraRequired,
  ]);

  voiceUiCommandHandlerRef.current = async (command: VoiceUiCommand) => {
    const room = roomRef.current || roomState;

    const microphoneIsEnabled = (() => {
      try {
        const publications = Array.from(
          room?.localParticipant?.audioTrackPublications?.values?.() || [],
        );
        const publication = publications.find(
          (item: unknown) =>
            (item as { source?: unknown })?.source === Track.Source.Microphone,
        );
        const microphonePublication = publication as {
          isMuted?: boolean;
          track?: unknown;
        } | undefined;
        return !!microphonePublication &&
          !microphonePublication.isMuted &&
          !!microphonePublication.track;
      } catch {
        return micOn;
      }
    })();

    const screenShareIsEnabled = (() => {
      try {
        return !!room && hasLocalLiveScreenShare(room);
      } catch {
        return screenShareOn;
      }
    })();

    const refreshStatusBadges = () => {
      scheduleRebuildTiles();
      window.setTimeout(() => scheduleRebuildTiles(), 80);
      window.setTimeout(() => scheduleRebuildTiles(), 220);
    };

    const numericVoiceValue = (prefix: string) =>
      Number(command.slice(prefix.length));
    const dispatchVoiceMessageSend = () => {
      window.dispatchEvent(new Event("mysession:voice-message-send"));
      const pipWindow = pipWindowRef.current;
      if (pipWindow && !pipWindow.closed && pipWindow !== window) {
        const PiPEvent = (pipWindow as unknown as { Event: typeof Event }).Event;
        pipWindow.dispatchEvent(new PiPEvent("mysession:voice-message-send"));
      }
    };

    const voiceTextPrefix = [
      "message_send_text_",
      "task_text_",
      "message_text_",
      "dictate_",
    ].find(
      (prefix) => command.startsWith(prefix),
    );
    if (voiceTextPrefix) {
      const text = decodeURIComponent(command.slice(voiceTextPrefix.length)).trim();
      if (!text) return;
      if (voiceTextPrefix === "task_text_") {
        try {
          sessionStorage.setItem("mysession:voice-task-draft", text);
        } catch { }
        setRightTab("tasks");
        setRightPanelOpen(true);
        window.setTimeout(() => window.dispatchEvent(new CustomEvent("mysession:voice-task-text", { detail: { text } })), 120);
        setVoiceUiLastCommand(`Task text: ${text}`);
        return;
      }
      if (
        voiceTextPrefix === "message_text_" ||
        voiceTextPrefix === "message_send_text_"
      ) {
        const preview = voiceTextPrefix === "message_send_text_";
        if (pipOpen && pipMode === "chat") setPipMode("gallery");
        try {
          sessionStorage.setItem("mysession:voice-message-draft", text);
          sessionStorage.setItem(
            "mysession:voice-message-preview",
            String(preview),
          );
        } catch { }
        setRightTab("chat");
        setRightPanelOpen(true);
        window.setTimeout(
          () => window.dispatchEvent(
            new CustomEvent("mysession:voice-message-text", {
              detail: { text, preview },
            }),
          ),
          120,
        );
        if (preview) {
          setVoiceUiLastCommand("Message preview ready — say Confirm");
        } else {
          setVoiceUiLastCommand(`Message text: ${text}`);
        }
        return;
      }
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(
          active instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(active, `${active.value}${active.value ? " " : ""}${text}`);
        active.dispatchEvent(new Event("input", { bubbles: true }));
        setVoiceUiLastCommand(`Typed: ${text}`);
      } else {
        try {
          sessionStorage.setItem("mysession:voice-message-draft", text);
        } catch { }
        setRightTab("chat");
        setRightPanelOpen(true);
        window.setTimeout(() => window.dispatchEvent(new CustomEvent("mysession:voice-message-text", { detail: { text } })), 120);
        setVoiceUiLastCommand(`Message text: ${text}`);
      }
      return;
    }

    if (command.startsWith("layout_columns_")) {
      const value = numericVoiceValue("layout_columns_");
      setVideoTileLayoutColumns(value);
      setVoiceUiLastCommand(`Layout columns ${value}`);
      return;
    }
    if (command.startsWith("layout_rows_")) {
      const value = numericVoiceValue("layout_rows_");
      setVideoTileLayoutRows(value);
      setVoiceUiLastCommand(`Layout rows ${value}`);
      return;
    }
    if (command.startsWith("stage_volume_")) {
      const value = numericVoiceValue("stage_volume_");
      setRoomSoundsVolume(value);
      setVoiceUiLastCommand(`Stage volume ${value}`);
      return;
    }
    if (command.startsWith("participant_volume_")) {
      const value = numericVoiceValue("participant_volume_");
      setDefaultRemoteVolumePct(value);
      setVoiceUiLastCommand(`Participant volume ${value}`);
      return;
    }
    for (const [prefix, key] of [
      ["brightness_", "brightness"],
      ["contrast_", "contrast"],
      ["saturation_", "saturation"],
    ] as const) {
      if (!command.startsWith(prefix)) continue;
      const value = numericVoiceValue(prefix);
      setColorCorrectionEnabled(true);
      setColorCorrection((current) => ({ ...current, [key]: value }));
      setVoiceUiLastCommand(`${key[0].toUpperCase()}${key.slice(1)} ${value}`);
      return;
    }

    if (command.startsWith("click_control_")) {
      const requestedLabel = decodeURIComponent(
        command.slice("click_control_".length),
      ).trim();
      const normalizedRequestedLabel = normalizeVoiceUiTranscript(requestedLabel);
      const pipDocument = pipWindowRef.current?.document || null;
      const documents = [document, pipDocument].filter(
        (item, index, all): item is Document => !!item && all.indexOf(item) === index,
      );
      const controls = documents.flatMap((ownerDocument) =>
        Array.from(
          ownerDocument.querySelectorAll<HTMLElement>(
            'button, [role="button"], input[type="button"], input[type="submit"]',
          ),
        ),
      ).filter((control) => {
        const disabled = (control as HTMLButtonElement | HTMLInputElement).disabled === true;
        if (disabled || control.getAttribute("aria-disabled") === "true") return false;
        return control.getClientRects().length > 0;
      });
      const labelForControl = (control: HTMLElement) =>
        normalizeVoiceUiTranscript(
          [
            control.getAttribute("aria-label"),
            control.getAttribute("title"),
            control.tagName === "INPUT" ? (control as HTMLInputElement).value : "",
            control.textContent,
          ]
            .filter(Boolean)
            .join(" "),
        );
      const target =
        controls.find((control) => labelForControl(control) === normalizedRequestedLabel) ||
        controls.find((control) => labelForControl(control).startsWith(normalizedRequestedLabel)) ||
        controls.find((control) => labelForControl(control).includes(normalizedRequestedLabel));

      if (!target) {
        setVoiceUiLastCommand(`Button ${requestedLabel} not found`);
        return;
      }

      target.click();
      setVoiceUiLastCommand(`${requestedLabel} clicked`);
      return;
    }

    const participantPrefix = [
      "participant_pin_",
      "participant_unpin_",
      "participant_report_",
      "participant_manage_",
    ].find((prefix) => command.startsWith(prefix));
    if (participantPrefix) {
      const requestedName = decodeURIComponent(command.slice(participantPrefix.length));
      const normalizedName = requestedName.toLowerCase().trim();
      const candidates = [...layoutTilesForRender, ...tilesForRender];
      const target = candidates.find((tile, index) => {
        if (candidates.findIndex((item) => item.id === tile.id) !== index) return false;
        const names = [tile.label, tile.metadataDisplayName]
          .map((value) => String(value || "").toLowerCase().trim())
          .filter(Boolean);
        return names.some((name) => name === normalizedName || name.startsWith(normalizedName));
      });
      if (!target) {
        setVoiceUiLastCommand(`Participant ${requestedName} not found`);
        return;
      }
      if (participantPrefix === "participant_pin_") {
        if (pinnedTileId !== target.id) togglePin(target.id);
        setVoiceUiLastCommand(`${target.label} pinned`);
        return;
      }
      if (participantPrefix === "participant_unpin_") {
        if (pinnedTileId === target.id) togglePin(target.id);
        setVoiceUiLastCommand(`${target.label} unpinned`);
        return;
      }
      if (participantPrefix === "participant_report_") {
        setReportTarget(target);
        setReportReason("");
        setReportError("");
        setReportModalOpen(true);
        setVoiceUiLastCommand(`Report ${target.label}`);
        return;
      }
      setOpenTileAdminMenuId(target.id);
      setTileMenuAnchor({
        tileId: target.id,
        x: Math.round(window.innerWidth / 2 + 176),
        y: Math.round(window.innerHeight / 2 - 220),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        portalDocument: document,
      });
      setVoiceUiLastCommand(`Manage ${target.label}`);
      return;
    }

    if (command.startsWith("custom_background_")) {
      if (shouldDisableBackgroundFx) {
        setVoiceUiLastCommand("Backgrounds unavailable on this device");
        return;
      }
      const slotId = command.slice("custom_background_".length) as CustomBackgroundSlotId;
      const slot = customBackgroundSlotsRef.current.find((item) => item.id === slotId);
      if (!slot?.dataUrl) {
        setVoiceUiLastCommand("Custom background slot is empty");
        return;
      }
      openVoiceFxPopup();
      setBgImageUrl(slot.dataUrl);
      await applyVideoFx("bg", slot.dataUrl);
      setVoiceUiLastCommand(`${slot.label} applied`);
      return;
    }

    if (command.startsWith("blur_strength_")) {
      if (shouldDisableBackgroundFx) {
        setVoiceUiLastCommand("Blur unavailable on this device");
        return;
      }
      const requestedStrength = Number(command.slice("blur_strength_".length));
      const nextStrength = Math.max(4, Math.min(30, requestedStrength || 12));
      setBlurStrength(nextStrength);
      openVoiceFxPopup();
      await applyVideoFx("blur", undefined, nextStrength);
      setVoiceUiLastCommand(`Blur strength ${nextStrength}`);
      return;
    }

    switch (command) {
      case "camera_on":
        await toggleCam(true);
        setVoiceUiLastCommand("Cam-on");
        break;
      case "camera_off":
        await toggleCam(false);
        setVoiceUiLastCommand("Cam-off");
        break;
      case "microphone_on":
        if (!microphoneIsEnabled) await toggleMic();
        setVoiceUiLastCommand("Unmuted");
        break;
      case "microphone_off":
        if (microphoneIsEnabled) await toggleMic();
        setVoiceUiLastCommand("Muted");
        break;
      case "tasks_open":
        setRightTab("tasks");
        setRightPanelOpen(true);
        setVoiceUiLastCommand("Tasks opened");
        break;
      case "tasks_close":
        if (rightTab === "tasks") setRightPanelOpen(false);
        setVoiceUiLastCommand("Tasks closed");
        break;
      case "chat_open":
        if (pipOpen && pipMode === "chat") setPipMode("gallery");
        setRightTab("chat");
        setRightPanelOpen(true);
        setVoiceUiLastCommand("Chat opened");
        break;
      case "chat_close":
        if (rightTab === "chat") setRightPanelOpen(false);
        setVoiceUiLastCommand("Chat closed");
        break;
      case "chat_general":
        if (pipOpen && pipMode === "chat") setPipMode("gallery");
        setChatViewMode("general");
        setRightTab("chat");
        setRightPanelOpen(true);
        setVoiceUiLastCommand("All chat opened");
        break;
      case "chat_direct":
        if (pipOpen && pipMode === "chat") setPipMode("gallery");
        setChatViewMode("host");
        setRightTab("chat");
        setRightPanelOpen(true);
        setVoiceUiLastCommand("Direct messages opened");
        break;
      case "theme_light":
        setTheme("light");
        setVoiceUiLastCommand("Light mode");
        break;
      case "theme_dark":
        setTheme("dark");
        setVoiceUiLastCommand("Dark mode");
        break;
      case "participants_open":
        setRightTab("participants");
        setRightPanelOpen(true);
        setVoiceUiLastCommand("Participants opened");
        break;
      case "participants_close":
        if (rightTab === "participants") setRightPanelOpen(false);
        setVoiceUiLastCommand("Participants closed");
        break;
      case "settings_open":
        setSettingsOpen(true);
        setSettingsPreviewVersion((version) => version + 1);
        setVoiceUiLastCommand("Settings opened");
        break;
      case "settings_close":
        setSettingsOpen(false);
        setVoiceUiLastCommand("Settings closed");
        break;
      case "color_correction_on":
        if (!isLgUp) {
          setVoiceUiLastCommand("Color correction is unavailable on this device");
          break;
        }
        setColorCorrectionEnabled(true);
        setVoiceUiLastCommand("Color correction enabled");
        break;
      case "color_correction_off":
        setColorCorrectionEnabled(false);
        setVoiceUiLastCommand("Color correction disabled");
        break;
      case "color_correction_reset":
        if (!isLgUp) {
          setVoiceUiLastCommand("Color correction is unavailable on this device");
          break;
        }
        setColorCorrectionEnabled(true);
        setColorCorrection(DEFAULT_COLOR_CORRECTION);
        setVoiceUiLastCommand("Color correction reset");
        break;
      case "echo_cancellation_on":
      case "echo_cancellation_off": {
        const enabled = command === "echo_cancellation_on";
        setEchoCancellationEnabled(enabled);
        setPrejoin((current) => ({ ...current, echoCancellation: enabled }));
        await syncLiveAudioProcessing({
          echoCancellation: enabled,
          noiseSuppression: noiseSuppressionEnabled,
          autoGainControl: autoGainControlEnabled,
        });
        setVoiceUiLastCommand(`Echo cancellation ${enabled ? "enabled" : "disabled"}`);
        break;
      }
      case "noise_suppression_on":
      case "noise_suppression_off": {
        const enabled = command === "noise_suppression_on";
        setNoiseSuppressionEnabled(enabled);
        setPrejoin((current) => ({ ...current, noiseSuppression: enabled }));
        await syncLiveAudioProcessing({
          echoCancellation: echoCancellationEnabled,
          noiseSuppression: enabled,
          autoGainControl: autoGainControlEnabled,
        });
        setVoiceUiLastCommand(`Noise suppression ${enabled ? "enabled" : "disabled"}`);
        break;
      }
      case "auto_gain_on":
      case "auto_gain_off": {
        const enabled = command === "auto_gain_on";
        setAutoGainControlEnabled(enabled);
        setPrejoin((current) => ({ ...current, autoGainControl: enabled }));
        await syncLiveAudioProcessing({
          echoCancellation: echoCancellationEnabled,
          noiseSuppression: noiseSuppressionEnabled,
          autoGainControl: enabled,
        });
        setVoiceUiLastCommand(`Auto gain ${enabled ? "enabled" : "disabled"}`);
        break;
      }
      case "join_sound_on":
      case "join_sound_off": {
        const enabled = command === "join_sound_on";
        setJoinSoundEnabled(enabled);
        setVoiceUiLastCommand(`Join sound ${enabled ? "enabled" : "disabled"}`);
        break;
      }
      case "leave_sound_on":
      case "leave_sound_off": {
        const enabled = command === "leave_sound_on";
        setLeaveSoundEnabled(enabled);
        setVoiceUiLastCommand(`Leave sound ${enabled ? "enabled" : "disabled"}`);
        break;
      }
      case "stage_sounds_on":
      case "stage_sounds_off": {
        const enabled = command === "stage_sounds_on";
        setStageSoundsEnabled(enabled);
        setVoiceUiLastCommand(`Stage sounds ${enabled ? "enabled" : "disabled"}`);
        break;
      }
      case "background_change":
        if (shouldDisableBackgroundFx) {
          setVoiceUiLastCommand("Backgrounds unavailable on this device");
          break;
        }
        openVoiceFxPopup();
        setVoiceUiLastCommand("Choose a background");
        break;
      case "effects_off":
        await applyVideoFx("off");
        closeVoiceFxPopup();
        setVoiceUiLastCommand("Video effects off");
        break;
      case "background_reset":
        if (uploadedBgUrlRef.current) {
          URL.revokeObjectURL(uploadedBgUrlRef.current);
          uploadedBgUrlRef.current = null;
        }
        setBgImageUrl(DEFAULT_BG_DATA_URL);
        openVoiceFxPopup();
        await applyVideoFx("bg", DEFAULT_BG_DATA_URL);
        setVoiceUiLastCommand("Default background applied");
        break;
      case "mirror_on":
        setPreviewMirrored(true);
        setVoiceUiLastCommand("Camera mirrored");
        break;
      case "mirror_off":
        setPreviewMirrored(false);
        setVoiceUiLastCommand("Camera unmirrored");
        break;
      case "panels_close_all":
        setRightPanelOpen(false);
        setRightTab(null);
        setSettingsOpen(false);
        setBugReportOpen(false);
        setAiHostInputOpen(false);
        setSelectedUser(null);
        closeVoiceFxPopup();
        closeTileMenu();
        setVoiceUiLastCommand("All panels closed");
        break;
      case "voice_restart":
        window.dispatchEvent(new Event("mysession:voice-ui-restart"));
        setVoiceUiLastCommand("Voice control restarted");
        break;
      case "task_timers_on":
      case "task_timers_off": {
        const enabled = command === "task_timers_on";
        const storageKey = `${TASK_TIMER_ENABLED_STORAGE_PREFIX}:${String(authUserId || "anonymous")}`;
        try {
          localStorage.setItem(storageKey, String(enabled));
          window.dispatchEvent(
            new CustomEvent(TASK_TIMER_VISIBILITY_EVENT, {
              detail: { enabled, userId: authUserId || "" },
            }),
          );
        } catch { }
        setVoiceUiLastCommand(enabled ? "Task timers shown" : "Task timers hidden");
        break;
      }
      case "mobile_layout_switcher_on":
        updateShowMobileLayoutSwitcher(true);
        setVoiceUiLastCommand("Layout switcher shown");
        break;
      case "mobile_layout_switcher_off":
        updateShowMobileLayoutSwitcher(false);
        setVoiceUiLastCommand("Layout switcher hidden");
        break;
      case "task_add":
      case "task_complete":
        setRightTab("tasks");
        setRightPanelOpen(true);
        window.dispatchEvent(new CustomEvent("mysession:voice-task-action", {
          detail: { action: command === "task_add" ? "add" : "complete" },
        }));
        if (command === "task_add") {
          window.setTimeout(() => {
            const input = document.querySelector<HTMLInputElement>('input[placeholder="Add a task"]');
            input?.focus();
          }, 180);
        }
        setVoiceUiLastCommand(command === "task_add" ? "Tasks opened — add a task" : "Tasks opened — choose a task");
        break;
      case "message_compose":
        if (pipOpen && pipMode === "chat") setPipMode("gallery");
        setRightTab("chat");
        setRightPanelOpen(true);
        window.dispatchEvent(new Event("mysession:voice-compose-message"));
        window.setTimeout(() => {
          const textareas = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea"));
          textareas.find((item) => item.offsetParent !== null)?.focus();
        }, 180);
        setVoiceUiLastCommand("Chat opened — compose a message");
        break;
      case "message_send":
        dispatchVoiceMessageSend();
        setVoiceUiLastCommand("Send message requested");
        break;
      case "message_confirm":
        dispatchVoiceMessageSend();
        setVoiceUiLastCommand("Message confirmed");
        break;
      case "message_cancel":
        window.dispatchEvent(new Event("mysession:voice-message-cancel"));
        if (pipWindowRef.current && !pipWindowRef.current.closed) {
          const PiPEvent = (
            pipWindowRef.current as unknown as { Event: typeof Event }
          ).Event;
          pipWindowRef.current.dispatchEvent(
            new PiPEvent("mysession:voice-message-cancel"),
          );
        }
        setVoiceUiLastCommand("Message cancelled");
        break;
      case "blur_apply":
        if (shouldDisableBackgroundFx) {
          setVoiceUiLastCommand("Blur unavailable on this device");
          break;
        }
        openVoiceFxPopup();
        await applyVideoFx("blur");
        setVoiceUiLastCommand("Blur applied");
        break;
      case "background_upload":
        if (shouldDisableBackgroundFx) {
          setVoiceUiLastCommand("Backgrounds unavailable on this device");
          break;
        }
        openVoiceFxPopup();
        setVoiceFxUploadRequested(true);
        setVoiceUiLastCommand("Click Upload Image to choose a file");
        try {
          voiceFxUploadInputRef.current?.showPicker();
        } catch {
          // Try the classic synthetic click as a compatibility fallback.
          // Browsers may still require a physical user gesture.
          voiceFxUploadInputRef.current?.click();
        }
        window.setTimeout(() => voiceFxUploadButtonRef.current?.focus(), 220);
        break;
      case "background_ocean":
      case "background_forest":
      case "background_violet":
      case "background_sunset": {
        if (shouldDisableBackgroundFx) {
          setVoiceUiLastCommand("Backgrounds unavailable on this device");
          break;
        }
        const presetId = command.replace("background_", "");
        const preset = FX_BG_PRESETS.find((item) => item.id === presetId);
        if (!preset) break;
        openVoiceFxPopup();
        setBgImageUrl(preset.url);
        await applyVideoFx("bg", preset.url);
        setVoiceUiLastCommand(`${preset.label} background applied`);
        break;
      }
      case "status_afk":
        await setMyStatus("afk");
        refreshStatusBadges();
        setVoiceUiLastCommand("AFK badge set");
        break;
      case "status_skip":
        await setMyStatus("skip");
        refreshStatusBadges();
        setVoiceUiLastCommand("Skip me badge set");
        break;
      case "status_skip_deafened":
        await setMyStatus("skip_deafened");
        refreshStatusBadges();
        setVoiceUiLastCommand("Skip me muted set");
        break;
      case "status_call":
        await setMyStatus("call");
        refreshStatusBadges();
        setVoiceUiLastCommand("On a call badge set");
        break;
      case "status_break":
        await setMyStatus("break");
        refreshStatusBadges();
        setVoiceUiLastCommand("Taking a break badge set");
        break;
      case "status_eating":
        await setMyStatus("eating");
        refreshStatusBadges();
        setVoiceUiLastCommand("Eating badge set");
        break;
      case "status_private":
        await setMyStatus("private");
        refreshStatusBadges();
        setVoiceUiLastCommand("Private badge set");
        break;
      case "status_clear":
        await setMyStatus(null);
        refreshStatusBadges();
        setVoiceUiLastCommand("Status cleared");
        break;
      case "screen_share_on":
        if (!screenShareIsEnabled) await toggleScreenShare();
        setVoiceUiLastCommand("Screen sharing started");
        break;
      case "screen_share_off":
        if (screenShareIsEnabled) await toggleScreenShare();
        setVoiceUiLastCommand("Screen sharing stopped");
        break;
      case "pip_open":
        if (!pictureInPictureOpen && pipSupported) await togglePictureInPicture();
        setVoiceUiLastCommand("Picture in Picture opened");
        break;
      case "pip_close":
        if (pictureInPictureOpen) await closePictureInPicture();
        setVoiceUiLastCommand("Picture in Picture closed");
        break;
      case "accountability_open":
        setMainViewMode("accountability");
        setVoiceUiLastCommand("Accountability wall opened");
        break;
      case "accountability_close":
        setMainViewMode("video");
        setVoiceUiLastCommand("Video view opened");
        break;
      case "layout_auto":
        setVideoTileLayoutPreset("auto");
        setVoiceUiLastCommand("Automatic layout");
        break;
      case "layout_one":
        setVideoTileLayoutPreset("one");
        setVoiceUiLastCommand("One-column layout");
        break;
      case "layout_two":
        setVideoTileLayoutPreset("two");
        setVoiceUiLastCommand("Two-column layout");
        break;
      case "layout_three":
        setVideoTileLayoutPreset("three");
        setVoiceUiLastCommand("Three-column layout");
        break;
      case "layout_four":
        setVideoTileLayoutPreset("four");
        setVoiceUiLastCommand("Four-column layout");
        break;
      case "ai_host_open":
        if (aiHostedEnabled) setAiHostInputOpen(true);
        setVoiceUiLastCommand("AI Host opened");
        break;
      case "ai_host_close":
        setAiHostInputOpen(false);
        setVoiceUiLastCommand("AI Host closed");
        break;
      case "bug_report_open":
        setBugReportOpen(true);
        setVoiceUiLastCommand("Bug report opened");
        break;
      case "bug_report_close":
        setBugReportOpen(false);
        setVoiceUiLastCommand("Bug report closed");
        break;
      case "host_profile_open":
        if (session?.host_profile) {
          setSelectedUser(session.host_profile as HostProfile);
        }
        setVoiceUiLastCommand("Host profile opened");
        break;
      case "profile_close":
        setSelectedUser(null);
        setVoiceUiLastCommand("Profile closed");
        break;
      case "timeline_open":
        if (isHost) openTimelineEditor();
        setVoiceUiLastCommand("Timeline opened");
        break;
      case "timeline_close":
        setTimelineEditorOpen(false);
        setVoiceUiLastCommand("Timeline closed");
        break;
      case "timeline_save":
        if (!isHost) {
          setVoiceUiLastCommand("Only the host can save the timeline");
        } else if (!timelineEditorOpen) {
          setVoiceUiLastCommand("Timeline editor is not open");
        } else {
          await saveTimelineEditor();
          setVoiceUiLastCommand("Timeline saved");
        }
        break;
      case "edit_name_open":
        openEditName();
        setVoiceUiLastCommand("Name editor opened");
        break;
      case "edit_name_close":
        setEditNameOpen(false);
        setVoiceUiLastCommand("Name editor closed");
        break;
      case "edit_name_save":
        if (editNameOpen) {
          await saveEditName();
          setVoiceUiLastCommand("Name saved");
        } else {
          setVoiceUiLastCommand("Name editor is not open");
        }
        break;
      case "modal_close":
        if (systemNotice.open && systemNotice.kind !== "kick") closeSystemNotice();
        else if (editNameOpen) setEditNameOpen(false);
        else if (reportModalOpen) setReportModalOpen(false);
        else if (timelineEditorOpen) setTimelineEditorOpen(false);
        else if (bugReportOpen) setBugReportOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        else if (mobileMediaRestoreOpen) setMobileMediaRestoreOpen(false);
        else if (paywallModalOpen) setPaywallModalOpen(false);
        else if (selectedUser) setSelectedUser(null);
        else if (aiHostInputOpen) setAiHostInputOpen(false);
        else if (voiceUiHelpOpen) setVoiceUiHelpOpen(false);
        else if (voiceFxPopupMounted || voiceFxPopupVisible) closeVoiceFxPopup();
        else if (rightPanelOpen) setRightPanelOpen(false);
        setVoiceUiLastCommand("Modal closed");
        break;
      case "audio_resume":
        await ensureRoomAudioPlaybackUnlocked("voice-ui");
        setAudioResumeNonce((value) => value + 1);
        setVoiceUiLastCommand("Room audio enabled");
        break;
      case "mobile_media_restore":
        await restoreMobileMediaFromBackground();
        setVoiceUiLastCommand("Camera and microphone restored");
        break;
      case "leave_room":
        setVoiceUiLastCommand("Leaving room");
        await leave();
        break;
      case "reaction_fire":
        sendReaction("fire");
        setVoiceUiLastCommand("Fire reaction sent");
        break;
      case "reaction_laugh":
        sendReaction("laugh");
        setVoiceUiLastCommand("Laugh reaction sent");
        break;
      case "reaction_thumbs_up":
        sendReaction("thumbsUp");
        setVoiceUiLastCommand("Thumbs up sent");
        break;
      case "reaction_thumbs_down":
        sendReaction("thumbsDown");
        setVoiceUiLastCommand("Thumbs down sent");
        break;
      case "reaction_heart":
        sendReaction("heart");
        setVoiceUiLastCommand("Heart reaction sent");
        break;
      case "reaction_clap":
        sendReaction("clap");
        setVoiceUiLastCommand("Clap reaction sent");
        break;
      case "reaction_ok":
        sendReaction("ok");
        setVoiceUiLastCommand("OK reaction sent");
        break;
      case "reaction_wave":
        sendReaction("wave");
        setVoiceUiLastCommand("Wave reaction sent");
        break;
      case "reaction_celebrate":
        sendReaction("celebrate");
        setVoiceUiLastCommand("Celebration sent");
        break;
      case "reaction_clover":
        sendReaction("clover");
        setVoiceUiLastCommand("Good luck sent");
        break;
    }
  };

  useEffect(() => {
    voiceUiShouldListenRef.current = connected && voiceUiActive;

    if (voiceUiRestartTimerRef.current != null) {
      window.clearTimeout(voiceUiRestartTimerRef.current);
      voiceUiRestartTimerRef.current = null;
    }

    if (!connected || !voiceUiActive) {
      try {
        voiceUiRecognitionRef.current?.abort();
      } catch {
        // Recognition may already be stopped.
      }
      voiceUiRecognitionRef.current = null;
      setVoiceUiStatus("idle");
      if (!connected) {
        setVoiceUiLastCommand("");
        setVoiceUiLastHeard("");
        setVoiceUiHelpOpen(false);
      }
      return;
    }

    const SpeechRecognitionConstructor = getSpeechRecognitionConstructor();
    if (!SpeechRecognitionConstructor) {
      setVoiceUiStatus("unsupported");
      return;
    }

    let disposed = false;

    const scheduleRestart = (delayMs = 450) => {
      if (disposed || !voiceUiShouldListenRef.current) return;
      if (voiceUiSuspendedRef.current) return;
      if (voiceUiRestartTimerRef.current != null) return;

      voiceUiRestartTimerRef.current = window.setTimeout(() => {
        voiceUiRestartTimerRef.current = null;
        startRecognition();
      }, delayMs);
    };

    const startRecognition = () => {
      if (disposed || !voiceUiShouldListenRef.current) return;
      if (voiceUiSuspendedRef.current) return;

      if (document.visibilityState !== "visible") {
        scheduleRestart(1_000);
        return;
      }

      if (voiceUiRecognitionRef.current) return;

      const recognition =
        new SpeechRecognitionConstructor() as SpeechRecognitionLike;
      recognition.lang = "en-US";
      // Short utterance sessions finalize much more reliably while WebRTC is
      // also using the microphone. onend immediately starts the next session.
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 3;
      let sessionWatchdogId: number | null = null;

      const clearSessionWatchdog = () => {
        if (sessionWatchdogId == null) return;
        window.clearTimeout(sessionWatchdogId);
        sessionWatchdogId = null;
      };

      const finishSessionAndRestart = (delayMs = 220) => {
        clearSessionWatchdog();
        if (voiceUiRecognitionRef.current === recognition) {
          voiceUiRecognitionRef.current = null;
        }

        try {
          recognition.abort();
        } catch {
          // Recognition may already be finalizing.
        }

        if (!voiceUiSuspendedRef.current) {
          setVoiceUiStatus("starting");
        }
        scheduleRestart(delayMs);
      };

      recognition.onstart = () => {
        if (disposed) return;
        setVoiceUiStatus("listening");

        clearSessionWatchdog();
        sessionWatchdogId = window.setTimeout(() => {
          clearSessionWatchdog();
          if (voiceUiRecognitionRef.current !== recognition) return;
          console.warn("[voice-ui] recognition session watchdog restart");
          finishSessionAndRestart(250);
        }, 12_000);
      };

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        const results = event.results;
        if (!results) return;

        for (
          let index = Number(event?.resultIndex || 0);
          index < Number(results.length || 0);
          index += 1
        ) {
          const result = results[index];
          if (!result) continue;

          const alternativesCount = Math.max(
            1,
            Math.min(3, Number(result.length || 1)),
          );
          let matchedCommand: VoiceUiCommand | null = null;
          let matchedTranscript = "";

          for (
            let alternativeIndex = 0;
            alternativeIndex < alternativesCount;
            alternativeIndex += 1
          ) {
            const transcript = String(
              result?.[alternativeIndex]?.transcript || "",
            ).trim();
            if (!transcript) continue;

            const normalizedTranscript = normalizeVoiceUiTranscript(transcript);
            const isDictationPhrase = /^(?:type|dictate|add task|create task|write message|compose message|type message|send message)(?: |$)/.test(
              normalizedTranscript,
            );
            const shouldWaitForFinal =
              isDictationPhrase ||
              VOICE_UI_AMBIGUOUS_INTERIM_PHRASES.has(normalizedTranscript);
            if (shouldWaitForFinal && result.isFinal === false) {
              // Dictation and ambiguous prefixes must wait for the final
              // transcript. For example, executing "good" immediately would
              // steal "good luck" from the clover reaction.
              continue;
            }

            matchedCommand =
              parseVoiceUiCommand(transcript) ||
              matchCustomBackgroundVoiceCommand(transcript);
            if (matchedCommand) {
              matchedTranscript = transcript;
              break;
            }
          }

          if (!matchedCommand) continue;

          // Do not expose arbitrary room speech in the local indicator.
          // Only acknowledged English commands and explicit dictation appear.
          setVoiceUiLastHeard(matchedTranscript);
          setVoiceUiLastCommand("");

          const now = Date.now();
          const previous = voiceUiLastExecutionRef.current;
          if (
            previous.command === matchedCommand &&
            now - previous.at < 2_500
          ) {
            continue;
          }

          voiceUiLastExecutionRef.current = {
            command: matchedCommand,
            at: now,
          };
          voiceUiCommandHandlerRef.current(matchedCommand).catch((error) => {
            console.warn("[voice-ui] command failed", matchedCommand, error);
          });

          // Chrome does not always emit onend when stop() is called from
          // onresult. Release the instance and schedule the next one ourselves.
          finishSessionAndRestart(220);
          break;
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorLike) => {
        const code = String(event?.error || "").trim();
        console.warn("[voice-ui] recognition error", code || event);

        if (code === "not-allowed" || code === "service-not-allowed") {
          clearSessionWatchdog();
          voiceUiShouldListenRef.current = false;
          setVoiceUiStatus("blocked");
          return;
        }

        if (!voiceUiSuspendedRef.current) {
          setVoiceUiStatus("starting");
        }
      };

      recognition.onend = () => {
        clearSessionWatchdog();
        if (voiceUiRecognitionRef.current === recognition) {
          voiceUiRecognitionRef.current = null;
        }
        scheduleRestart(180);
      };

      voiceUiRecognitionRef.current = recognition;
      setVoiceUiStatus("starting");

      try {
        recognition.start();
      } catch (error) {
        console.warn("[voice-ui] could not start recognition", error);
        voiceUiRecognitionRef.current = null;
        scheduleRestart(900);
      }
    };

    const pauseVoiceUi = () => {
      voiceUiSuspendedRef.current = true;
      if (voiceUiRestartTimerRef.current != null) {
        window.clearTimeout(voiceUiRestartTimerRef.current);
        voiceUiRestartTimerRef.current = null;
      }
      try {
        voiceUiRecognitionRef.current?.abort();
      } catch {
        // Recognition may already be stopped.
      }
      voiceUiRecognitionRef.current = null;
      setVoiceUiStatus("idle");
    };

    const resumeVoiceUi = () => {
      voiceUiSuspendedRef.current = false;
      if (voiceUiShouldListenRef.current) scheduleRestart(250);
    };

    const restartVoiceUi = () => {
      voiceUiShouldListenRef.current = true;
      voiceUiSuspendedRef.current = false;

      if (voiceUiRestartTimerRef.current != null) {
        window.clearTimeout(voiceUiRestartTimerRef.current);
        voiceUiRestartTimerRef.current = null;
      }

      const current = voiceUiRecognitionRef.current;
      voiceUiRecognitionRef.current = null;
      if (current) {
        try {
          current.abort();
        } catch {
          // Recognition may already be stopped.
        }
        scheduleRestart(180);
        return;
      }

      // When permission/start was blocked, this path runs synchronously from
      // the user's click on the badge and satisfies Chrome's gesture policy.
      startRecognition();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        resumeVoiceUi();
      } else {
        pauseVoiceUi();
      }
    };

    window.addEventListener("mysession:voice-ui-pause", pauseVoiceUi);
    window.addEventListener("mysession:voice-ui-resume", resumeVoiceUi);
    window.addEventListener("mysession:voice-ui-restart", restartVoiceUi);
    document.addEventListener("visibilitychange", onVisibilityChange);
    startRecognition();

    return () => {
      disposed = true;
      voiceUiShouldListenRef.current = false;
      voiceUiSuspendedRef.current = false;
      window.removeEventListener("mysession:voice-ui-pause", pauseVoiceUi);
      window.removeEventListener("mysession:voice-ui-resume", resumeVoiceUi);
      window.removeEventListener("mysession:voice-ui-restart", restartVoiceUi);
      document.removeEventListener("visibilitychange", onVisibilityChange);

      if (voiceUiRestartTimerRef.current != null) {
        window.clearTimeout(voiceUiRestartTimerRef.current);
        voiceUiRestartTimerRef.current = null;
      }

      try {
        voiceUiRecognitionRef.current?.abort();
      } catch {
        // Recognition may already be stopped.
      }
      voiceUiRecognitionRef.current = null;
    };
  }, [connected, voiceUiActive]);

  const createRoomScreenshot = async () => {
    const root = videoWrapRef.current;
    if (!root) throw new Error("Video container is not ready");

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1280, root.clientWidth || 1280)}" height="${Math.max(720, root.clientHeight || 720)}">
        <rect width="100%" height="100%" fill="#2B2B2B" />
        <text x="50%" y="46%" dominant-baseline="middle" text-anchor="middle" fill="#F8FAFC" font-size="34" font-family="Arial, sans-serif">
          Room screenshot placeholder
        </text>
        <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#94A3B8" font-size="18" font-family="Arial, sans-serif">
          Browser-safe fallback. Replace with html-to-image or captureStream later.
        </text>
      </svg>
    `.trim();

    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    try {
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.href = url;
      a.download = `mysession-room-${stamp}.svg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showSystemNotice({
        kind: "info",
        title: "Screenshot downloaded",
        body: "A room snapshot placeholder file was downloaded. Next step: swap this with real DOM capture.",
      });
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 1200);
    }
  };

  const copyStylesToPiPWindow = (pipWindow: Window) => {
    Array.from(document.styleSheets).forEach((styleSheet) => {
      try {
        const cssRules = Array.from((styleSheet as CSSStyleSheet).cssRules)
          .map((rule) => rule.cssText)
          .join("\n");

        const style = pipWindow.document.createElement("style");
        style.textContent = cssRules;
        pipWindow.document.head.appendChild(style);
      } catch {
        const href = (styleSheet as CSSStyleSheet).href;
        if (!href) return;

        const link = pipWindow.document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        pipWindow.document.head.appendChild(link);
      }
    });
  };

  const closeDesktopPictureInPicture = useCallback(async () => {
    const pipWindow = pipWindowRef.current;

    pipWindowRef.current = null;
    setPipMountEl(null);
    setPipOpen(false);

    try {
      pipWindow?.close();
    } catch { }
  }, []);

  const closeMobilePictureInPicture = useCallback(async () => {
    const stage = mobilePiPVideoElement ?? mobilePiPStageRef.current;
    const pipDocument = document as MobileVideoPiPDocument;

    try {
      if (
        stage &&
        pipDocument.pictureInPictureElement === stage &&
        typeof pipDocument.exitPictureInPicture === "function"
      ) {
        await pipDocument.exitPictureInPicture();
      } else if (
        stage?.webkitPresentationMode === "picture-in-picture" &&
        stage.webkitSetPresentationMode
      ) {
        stage.webkitSetPresentationMode("inline");
      }
    } catch { }

    persistMobilePiPRetention(false);
    setMobilePipOpen(false);
    setMobilePiPVideoElement(null);
  }, [mobilePiPVideoElement, persistMobilePiPRetention]);

  const closePictureInPicture = useCallback(async () => {
    if (mobilePipOpen) {
      await closeMobilePictureInPicture();
    }
    if (pipOpen) {
      await closeDesktopPictureInPicture();
    }
  }, [
    closeDesktopPictureInPicture,
    closeMobilePictureInPicture,
    mobilePipOpen,
    pipOpen,
  ]);

  const openDesktopPictureInPicture = useCallback(async () => {
    setPipMode("gallery");

    if (!pipSupported) {
      alert("Document Picture-in-Picture is not supported in this browser.");
      return;
    }

    if (!connected) {
      alert("Join the room first.");
      return;
    }

    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      try {
        pipWindowRef.current.focus();
      } catch { }
      return;
    }

    const pipApi = (window as WindowWithDocumentPiP).documentPictureInPicture;

    let pipWindow: Window | null = null;

    if (pipApi) {
      pipWindow = await pipApi.requestWindow({
        width: 560,
        height: 420,
        preferInitialWindowPlacement: true,
      } as any);
    } else {
      pipWindow = window.open(
        "",
        "mysession-livekit-pip",
        "popup=yes,width=560,height=420,resizable=yes,scrollbars=no",
      );

      if (!pipWindow) {
        alert("Pop-up blocked. Allow pop-ups for this site.");
        return;
      }
    }

    copyStylesToPiPWindow(pipWindow);

    pipWindow.document.title = `${String(session?.title || "Session")} · PiP`;
    pipWindow.document.body.innerHTML = "";
    pipWindow.document.documentElement.setAttribute("data-theme", theme);
    pipWindow.document.body.className =
      theme === "dark"
        ? "m-0 bg-[#1B1B1B] text-white overflow-hidden"
        : "m-0 bg-[#F3F3F3] text-[#2B2B2B] overflow-hidden";

    const mount = pipWindow.document.createElement("div");
    mount.id = "mysession-livekit-pip-root";
    mount.style.width = "100vw";
    mount.style.height = "100vh";
    mount.style.overflow = "hidden";
    pipWindow.document.body.appendChild(mount);

    pipWindow.addEventListener(
      "pagehide",
      () => {
        pipWindowRef.current = null;
        setPipMountEl(null);
        setPipOpen(false);
      },
      { once: true },
    );

    pipWindowRef.current = pipWindow;
    setPipMountEl(mount);
    setPipOpen(true);
  }, [connected, pipSupported, session?.title, theme]);

  const openMobilePictureInPicture = useCallback(async () => {
    if (!connected) {
      alert("Join the room first.");
      return;
    }

    const stage = await preparePreferredMobilePiPVideo();
    if (!stage || !isMobilePiPStageReady(stage)) {
      throw new Error(
        "Picture-in-Picture is waiting for a playing participant video. Try again after video appears.",
      );
    }

    const opened = await enterMobileVideoPictureInPicture(stage, {
      requireReady: true,
    });

    if (!opened) {
      throw new Error(
        "Picture-in-Picture was blocked by the mobile browser.",
      );
    }

    handleMobilePiPOpened(stage);
  }, [
    connected,
    handleMobilePiPOpened,
    preparePreferredMobilePiPVideo,
  ]);

  const openPictureInPicture = useCallback(async () => {
    if (mobilePiPRuntime) {
      await openMobilePictureInPicture();
      return;
    }

    await openDesktopPictureInPicture();
  }, [
    mobilePiPRuntime,
    openDesktopPictureInPicture,
    openMobilePictureInPicture,
  ]);

  const openParticipantPictureInPicture = useCallback(
    async (_tileId: string, tileElement: HTMLElement) => {
      const video = tileElement.querySelector<HTMLVideoElement>("video") as
        | MobilePiPVideoElement
        | null;

      if (!video) {
        showSystemNotice({
          kind: "info",
          title: "Picture-in-Picture unavailable",
          body: "Turn this participant's camera on before opening their video in Picture-in-Picture.",
        });
        return;
      }

      video.disablePictureInPicture = false;
      video.removeAttribute("disablepictureinpicture");

      try {
        // Close the custom gallery PiP first. The selected participant then
        // opens in the browser's native single-video Picture-in-Picture.
        if (pipWindowRef.current && !pipWindowRef.current.closed) {
          void closeDesktopPictureInPicture();
        }

        if (supportsWebKitVideoPiP(video)) {
          video.webkitSetPresentationMode?.("picture-in-picture");
          return;
        }

        const pipDocument = document as MobileVideoPiPDocument;
        const currentVideo = pipDocument.pictureInPictureElement;

        if (currentVideo === video) return;

        if (currentVideo && typeof pipDocument.exitPictureInPicture === "function") {
          await pipDocument.exitPictureInPicture();
        }

        if (
          pipDocument.pictureInPictureEnabled !== false &&
          typeof video.requestPictureInPicture === "function"
        ) {
          await video.requestPictureInPicture();
          return;
        }

        throw new Error("Native video Picture-in-Picture is not supported");
      } catch (error) {
        console.warn("[participant-pip] Unable to open selected video", error);
        showSystemNotice({
          kind: "info",
          title: "Picture-in-Picture unavailable",
          body: "This browser could not open the selected participant video in Picture-in-Picture.",
        });
      }
    },
    [closeDesktopPictureInPicture],
  );
  const togglePictureInPicture = useCallback(async () => {
    if (pictureInPictureOpen) {
      await closePictureInPicture();
      return;
    }

    await openPictureInPicture();
  }, [
    closePictureInPicture,
    openPictureInPicture,
    pictureInPictureOpen,
  ]);

  const openTasksFromPictureInPicture = useCallback(() => {
    closePictureInPicture().catch(() => { });

    // Open the normal Tasks tab just long enough to ensure the component is mounted,
    // then ask TasksPanel to open itself in its pinned/PiP overlay format.
    setRightTab("tasks");
    setRightPanelOpen(true);

    window.setTimeout(() => {
      try {
        window.dispatchEvent(
          new CustomEvent("mysession:tasks-open-pinned"),
        );
      } catch {
        // ignore
      }
    }, 120);
  }, [closePictureInPicture]);

  useEffect(() => {
    const pipWindow = pipWindowRef.current;
    if (!pipWindow || !pipMountEl) return;

    try {
      pipWindow.document.documentElement.setAttribute("data-theme", theme);
      pipWindow.document.body.className =
        theme === "dark"
          ? "m-0 bg-[#1B1B1B] text-white overflow-hidden"
          : "m-0 bg-[#F3F3F3] text-[#2B2B2B] overflow-hidden";
    } catch { }
  }, [theme, pipMountEl]);

  useEffect(() => {
    if (connected) return;
    if (!pictureInPictureOpen) return;

    closePictureInPicture().catch(() => { });
  }, [connected, pictureInPictureOpen, closePictureInPicture]);

  const restoreMobileMediaFromBackground = async (
    forceReconnectNow = false,
  ) => {
    if (mobileMediaRestoreBusyRef.current) return;
    mobileMediaRestoreBusyRef.current = true;

    try {
      setMobileMediaRestoreBusy(true);
      roomLifecycleDiagnosticRef.current(
        "livekit.controlled_reconnect_started",
      );
      closeMobileRestoreState();
      openMobileRestoreState("restoring");
      setClientError("");
      setTokenError("");
      setMediaWarning("Restoring your room…");

      await loadBrowserDevices({ preserveSelection: true }).catch(() => { });
      await attendanceHeartbeat().catch(() => { });

      if (roomIsActuallyConnected()) {
        roomLifecycleDiagnosticRef.current(
          "livekit.controlled_reconnect_succeeded",
          { reused_existing_room: true },
        );
        await ensureRoomAudioPlaybackUnlocked("mobile-restore").catch(() => { });
        scheduleRebuildTiles();
        window.setTimeout(() => scheduleRebuildTiles(), 120);
        window.setTimeout(() => scheduleRebuildTiles(), 360);
        closeMobileRestoreState();
        returningFromBackgroundRef.current = false;
        pageHiddenAtRef.current = null;
        return;
      }

      // LiveKit's native reconnect preserves tracks and is faster than tearing
      // the room down. Automatic recovery must not interrupt it. The explicit
      // Rejoin button can still force a fresh connection when the user asks.
      if (roomIsRecovering() && !forceReconnectNow) {
        openMobileRestoreState("restoring");
        setMediaWarning("Restoring your connection…");
        return;
      }

      setPrejoinOpen(false);
      setJoinRequested(true);

      // A token cached before the browser was suspended may no longer be usable.
      // Go straight to a fresh token instead of spending a full connection cycle
      // retrying a stale JWT first.
      for (let attempt = 0; attempt < 2 && !roomIsActuallyConnected(); attempt += 1) {
        if (document.visibilityState !== "visible") return;

        setLkToken("");
        lkTokenRef.current = "";
        setPrejoinOpen(false);
        setJoinRequested(true);

        const refreshed = await requestToken().catch((e) => {
          console.warn("mobile restore token refresh failed:", e);
          setTokenError(
            String((e as any)?.message || e || "restore_token_failed"),
          );
          return undefined;
        });

        if (refreshed?.token && refreshed?.url) {
          await connectRoom({
            forceReconnect: true,
            preserveAttendance: true,
            preserveTabPresence: true,
            preserveJoinRequested: true,
            tokenOverride: refreshed.token,
            serverUrlOverride: refreshed.url,
          });
        }

        if (!roomIsActuallyConnected() && attempt === 0) {
          await delay(900);
        }
      }

      await ensureRoomAudioPlaybackUnlocked(
        "mobile-restore-after-reconnect",
      ).catch(() => { });
      scheduleRebuildTiles();
      window.setTimeout(() => scheduleRebuildTiles(), 160);

      if (roomIsActuallyConnected()) {
        roomLifecycleDiagnosticRef.current(
          "livekit.controlled_reconnect_succeeded",
        );
        writeMobileRoomLease(sessionId, authUserId, {
          audioEnabled: prejoinRef.current.audioEnabled,
          videoEnabled: prejoinRef.current.videoEnabled,
        });
        closeMobileRestoreState();
        returningFromBackgroundRef.current = false;
        pageHiddenAtRef.current = null;
        setMediaWarning("");
      } else {
        roomLifecycleDiagnosticRef.current(
          "livekit.controlled_reconnect_failed",
          { reason: "room_not_connected_after_retry" },
        );
        const offerManualRejoin =
          mobileRecoveryAttemptRef.current >=
          ROOM_AUTO_RECOVERY_MANUAL_THRESHOLD;
        setMobileRestoreMode(offerManualRejoin ? "needs_action" : "restoring");
        setMobileMediaRestoreOpen(true);
        setMediaWarning(
          offerManualRejoin
            ? "Automatic reconnect is taking longer than expected. You can use Rejoin room to retry now."
            : "Still reconnecting automatically…",
        );
      }
    } catch (error) {
      roomLifecycleDiagnosticRef.current(
        "livekit.controlled_reconnect_failed",
        { message: String((error as any)?.message || error || "") },
      );
      const offerManualRejoin =
        mobileRecoveryAttemptRef.current >=
        ROOM_AUTO_RECOVERY_MANUAL_THRESHOLD;
      setMobileRestoreMode(offerManualRejoin ? "needs_action" : "restoring");
      setMobileMediaRestoreOpen(true);
      setMediaWarning(
        offerManualRejoin
          ? "Automatic reconnect failed. Use Rejoin room to try again."
          : "Still reconnecting automatically…",
      );
    } finally {
      mobileMediaRestoreBusyRef.current = false;
      setMobileMediaRestoreBusy(false);
    }
  };

  useEffect(() => {
    const clearRecoveryRetry = () => {
      if (!mobileRecoveryRetryTimerRef.current) return;
      window.clearTimeout(mobileRecoveryRetryTimerRef.current);
      mobileRecoveryRetryTimerRef.current = null;
    };

    const scheduleRecoveryRetry = () => {
      if (mobileRecoveryRetryTimerRef.current) return;
      if (mobileAutoRestoreInFlightRef.current) return;
      if (document.visibilityState !== "visible") return;
      if (roomIsActuallyConnected()) return;
      if (!readMobileRoomLease(sessionId, authUserId)) return;

      const retryDelays = [1_500, 3_000, 7_000, 15_000, 30_000];
      const attempt = mobileRecoveryAttemptRef.current;
      const retryDelay = retryDelays[Math.min(attempt, retryDelays.length - 1)];
      mobileRecoveryAttemptRef.current = attempt + 1;

      mobileRecoveryRetryTimerRef.current = window.setTimeout(() => {
        mobileRecoveryRetryTimerRef.current = null;
        restoreFromLease(false);
      }, retryDelay);
    };

    const restoreFromLease = (resetBackoff = true) => {
      if (document.visibilityState !== "visible") return;

      const lease = readMobileRoomLease(sessionId, authUserId);
      if (!lease) return;

      if (resetBackoff) {
        clearRecoveryRetry();
        mobileRecoveryAttemptRef.current = 0;
      }

      if (roomIsActuallyConnected()) {
        clearRecoveryRetry();
        mobileRecoveryAttemptRef.current = 0;
        writeMobileRoomLease(sessionId, authUserId, {
          audioEnabled: lease.audioEnabled,
          videoEnabled: lease.videoEnabled,
        });
        void attendanceHeartbeat();
        startAttendanceHeartbeat();
        closeMobileRestoreState();
        returningFromBackgroundRef.current = false;
        pageHiddenAtRef.current = null;
        return;
      }

      if (connectInFlightRef.current || tokenRequestInFlightRef.current) {
        scheduleRecoveryRetry();
        return;
      }

      if (roomIsRecovering()) {
        openMobileRestoreState("restoring");
        scheduleRecoveryRetry();
        return;
      }

      if (mobileAutoRestoreInFlightRef.current) return;

      const restoredPrejoin = {
        ...prejoinRef.current,
        audioEnabled: lease.audioEnabled,
        videoEnabled: lease.videoEnabled,
      };
      prejoinRef.current = restoredPrejoin;
      setPrejoin(restoredPrejoin);
      joinFlowStartedRef.current = true;
      setPrejoinOpen(false);
      setJoinRequested(true);

      mobileAutoRestoreInFlightRef.current = true;
      void restoreMobileMediaFromBackground().finally(() => {
        mobileAutoRestoreInFlightRef.current = false;
        if (roomIsActuallyConnected()) {
          clearRecoveryRetry();
          mobileRecoveryAttemptRef.current = 0;
          return;
        }
        scheduleRecoveryRetry();
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clearRecoveryRetry();
        return;
      }
      restoreFromLease(true);
    };
    const onResumeSignal = () => restoreFromLease(true);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onResumeSignal);
    window.addEventListener("online", onResumeSignal);
    window.addEventListener("focus", onResumeSignal);
    document.addEventListener("resume", onResumeSignal);
    window.addEventListener(ROOM_RECOVERY_REQUEST_EVENT, onResumeSignal);
    scheduleRecoveryRetry();

    return () => {
      clearRecoveryRetry();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onResumeSignal);
      window.removeEventListener("online", onResumeSignal);
      window.removeEventListener("focus", onResumeSignal);
      document.removeEventListener("resume", onResumeSignal);
      window.removeEventListener(ROOM_RECOVERY_REQUEST_EVENT, onResumeSignal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, authUserId]);

  const scheduleScreenShareRebuildBurst = () => {
    scheduleRebuildTiles();
    window.setTimeout(() => scheduleRebuildTiles(), 80);
    window.setTimeout(() => scheduleRebuildTiles(), 220);
    window.setTimeout(() => scheduleRebuildTiles(), 520);
    window.setTimeout(() => scheduleRebuildTiles(), 1100);
    window.setTimeout(() => scheduleRebuildTiles(), 1800);
  };

  const stopLocalScreenShare = async (reason = "stop") => {
    const r = roomRef.current;
    const lp: any = r?.localParticipant;
    const manual = manualScreenShareRef.current;
    manualScreenShareRef.current = null;

    try {
      if (manual?.mediaTrack && lp?.unpublishTrack) {
        await lp.unpublishTrack(manual.mediaTrack, true);
      }
    } catch {
      // ignore manual unpublish failure; LiveKit cleanup below is the fallback
    }

    try {
      manual?.stream
        ?.getTracks?.()
        .forEach((track: MediaStreamTrack) => track.stop());
    } catch {
      // ignore cleanup failure
    }

    try {
      if (lp?.setScreenShareEnabled) {
        await lp.setScreenShareEnabled(false);
      }
    } catch {
      // ignore fallback cleanup failure
    }

    setScreenShareOn(false);
    if (reason === "display_media_track_ended") {
      setMediaWarning(
        "Screen sharing was stopped by your browser. Your room connection is still active; click Share screen to resume.",
      );
    }
    scheduleScreenShareRebuildBurst();
    void logRoomDiagnostic("screen_share_local_stop_cleanup", {
      reason,
      snapshot: getScreenShareDiagnosticSnapshot(roomRef.current),
    });
  };

  const publishManualTabletScreenShare = async (r: Room) => {
    const lp: any = r.localParticipant;
    const captured = await captureDisplayMediaForTablet();
    const firstFrameReady = await waitForMediaTrackRenderableFrame(
      captured.mediaTrack,
      2600,
    );

    if (!firstFrameReady) {
      try {
        captured.stream
          ?.getTracks?.()
          .forEach((track: MediaStreamTrack) => track.stop());
      } catch {
        // ignore cleanup failure
      }
      throw new Error("display_media_video_track_not_renderable");
    }

    const publication = (await lp.publishTrack(captured.mediaTrack, {
      source: Track.Source.ScreenShare,
      name: "screen_share",
      simulcast: false,
    } as any)) as LocalTrackPublication;

    manualScreenShareRef.current = {
      mediaTrack: captured.mediaTrack,
      stream: captured.stream,
      publication,
    };

    try {
      captured.mediaTrack.addEventListener(
        "ended",
        () => {
          void stopLocalScreenShare("display_media_track_ended");
        },
        { once: true },
      );
    } catch {
      // ignore listener failure
    }

    return publication;
  };

  const toggleScreenShare = async () => {
    const r = roomRef.current;
    if (!r?.localParticipant) {
      setMediaWarning(
        "Screen sharing is not ready yet. Please wait a moment and try again.",
      );
      return;
    }

    const lp: any = r.localParticipant;

    try {
      const next = !hasLocalLiveScreenShare(r);

      if (!next) {
        void logRoomDiagnostic(
          "screen_share_stop_attempt",
          getScreenShareDiagnosticSnapshot(r) as any,
        );
        await stopLocalScreenShare("user_toggle_off");
        void logRoomDiagnostic(
          "screen_share_stopped",
          getScreenShareDiagnosticSnapshot(r) as any,
        );
        return;
      }

      const preferManualTabletPath = shouldPreferManualTabletScreenShare({
        isMobileQuery,
        isTabletQuery,
      });

      void logRoomDiagnostic("screen_share_start_attempt", {
        supported: supportsScreenShareCapture(),
        preferManualTabletPath,
        before: getScreenShareDiagnosticSnapshot(r),
      });

      if (!supportsScreenShareCapture()) {
        setScreenShareOn(false);
        setMediaWarning(
          "Screen sharing is not supported by this tablet browser. Try Chrome on the tablet, desktop Chrome/Edge, or update the browser and allow screen recording/sharing permissions.",
        );
        scheduleScreenShareRebuildBurst();
        void logRoomDiagnostic("screen_share_unsupported", {
          supported: false,
          snapshot: getScreenShareDiagnosticSnapshot(r),
        });
        return;
      }

      setMediaWarning("");

      if (preferManualTabletPath) {
        try {
          await publishManualTabletScreenShare(r);
          scheduleScreenShareRebuildBurst();
        } catch (manualError: any) {
          console.warn(
            "manual tablet screen share failed, falling back to LiveKit toggle:",
            manualError,
          );
          void logRoomDiagnostic("screen_share_manual_tablet_failed", {
            name: String(manualError?.name || ""),
            message: String(manualError?.message || manualError || ""),
            snapshot: getScreenShareDiagnosticSnapshot(r),
          });

          const manualMessage = String(
            manualError?.message || manualError || "",
          ).toLowerCase();
          const manualName = String(manualError?.name || "").toLowerCase();
          const userCancelled =
            manualName.includes("notallowed") ||
            manualName.includes("abort") ||
            manualMessage.includes("permission") ||
            manualMessage.includes("cancel");

          if (userCancelled) {
            throw manualError;
          }

          await lp.setScreenShareEnabled(true, {
            audio: false,
            video: true,
          } as any);
        }
      } else {
        await lp.setScreenShareEnabled(true, {
          audio: false,
          video: true,
        } as any);
      }

      scheduleScreenShareRebuildBurst();

      const liveTrackReady = await waitForLocalScreenShareTrack(r, 2600);
      const renderableTrackReady = await waitForLocalRenderableScreenShareTrack(
        r,
        preferManualTabletPath ? 4200 : 3200,
      );
      const afterStartSnapshot = getScreenShareDiagnosticSnapshot(r);

      if (!liveTrackReady || !renderableTrackReady) {
        await stopLocalScreenShare(
          "screen_share_track_missing_or_not_renderable",
        );

        setScreenShareOn(false);
        setMediaWarning(
          "Screen sharing started, but the tablet browser did not send a visible screen video. Please try Chrome on the tablet, close other tabs/apps, or use desktop Chrome/Edge for screen sharing.",
        );
        scheduleScreenShareRebuildBurst();
        void logRoomDiagnostic("screen_share_track_missing", {
          liveTrackReady,
          renderableTrackReady,
          preferManualTabletPath,
          afterStart: afterStartSnapshot,
          afterCleanup: getScreenShareDiagnosticSnapshot(r),
        });
        return;
      }

      setScreenShareOn(true);
      scheduleScreenShareRebuildBurst();
      void logRoomDiagnostic("screen_share_started", {
        preferManualTabletPath,
        afterStart: afterStartSnapshot,
      });
    } catch (e: any) {
      console.error("toggleScreenShare error:", e);

      await stopLocalScreenShare("screen_share_failed_cleanup");

      setScreenShareOn(false);
      setMediaWarning(getScreenShareErrorMessage(e));
      scheduleScreenShareRebuildBurst();
      void logRoomDiagnostic("screen_share_failed", {
        name: String(e?.name || ""),
        message: String(e?.message || e || ""),
        snapshot: getScreenShareDiagnosticSnapshot(roomRef.current),
      });
    }
  };

  const leave = async () => {
    if (explicitLeaveRequestedRef.current) return;

    captureProductEvent("leave_clicked", { connected });
    roomLifecycleDiagnosticRef.current("explicit_leave.clicked");
    explicitLeaveRequestedRef.current = true;
    clearMobileRoomLease(sessionId, authUserId);

    const startedAt = sessionJoinStartedAtRef.current;
    const minutesSpent =
      startedAt && Number.isFinite(startedAt)
        ? Math.max(1, Math.round((Date.now() - startedAt) / 60000))
        : 0;

    const params = new URLSearchParams();

    params.set("postSession", "1");

    if (session?.id) params.set("sessionId", String(session.id));
    if (session?.title) params.set("sessionTitle", String(session.title));
    if (session?.host_id) params.set("hostId", String(session.host_id));
    if (session?.host_profile?.full_name) {
      params.set("hostName", String(session.host_profile.full_name));
    }
    if (minutesSpent > 0) params.set("minutes", String(minutesSpent));

    const destination = `/sessions?${params.toString()}`;

    // Do not let network cleanup strand the user on an already-cleared room.
    // Attendance has a keepalive fallback on pagehide, and a temporary host
    // lease expires automatically if its explicit release cannot finish.
    const cleanupPromise = (async () => {
      if (isTemporaryRoomHost && sessionId) {
        try {
          await supabase.rpc("release_infinite_room_host", {
            p_session_id: sessionId,
          });
        } catch {
          // The lease expires automatically if the network is already gone.
        }
      }

      await disconnectRoom();
    })().catch((error) => {
      console.warn("leave cleanup failed:", error);
    });

    await Promise.race([
      cleanupPromise,
      new Promise<void>((resolve) => window.setTimeout(resolve, 1200)),
    ]);

    window.location.replace(destination);
  };

  // admin endpoint
  const callAdmin = async (body: Record<string, unknown>) => {
    const token = await getFreshAccessToken();
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(adminEndpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...body,
          sessionId: session?.id,
          isHost,
          isModerator: !isHost && isSelfModerator,
        }),
      });
    } finally {
      window.clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Admin endpoint error: ${res.status} ${t || ""}`.trim());
    }

    return res.json().catch(() => ({}));
  };

  const sendRealtimeParticipantControl = (
    participantIdentity: string,
    action: "mute_microphone" | "turn_off_camera",
  ) => {
    const room = roomRef.current;
    if (!room || !participantIdentity) return;

    const payload = new TextEncoder().encode(
      JSON.stringify({ action, issuedAt: Date.now() }),
    );
    void room.localParticipant
      .publishData(payload, {
        reliable: true,
        topic: PARTICIPANT_CONTROL_TOPIC,
        destinationIdentities: [participantIdentity],
      })
      .catch((error) => {
        // The server-side admin action below remains the authoritative fallback.
        console.warn("fast participant control signal failed", error);
      });
  };

  const optimisticMute = (tileId: string) => {
    setTiles((prev) =>
      prev.map((t) => {
        if (t.id !== tileId) return t;
        return { ...t, micMuted: true };
      }),
    );
  };

  const optimisticCameraOff = (tileId: string) => {
    setTiles((prev) =>
      prev.map((t) => {
        if (t.id !== tileId) return t;
        return {
          ...t,
          camPubMuted: true,
          camPubHasTrack: false,
        };
      }),
    );
  };

  const adminMuteRemoteTrack = async (
    tileId: string,
    participantIdentity: string,
    trackSid: string,
  ) => {
    const roomName = roomNameForApi;
    if (!roomName) return;

    const busyKey = `${participantIdentity}:${trackSid}:mute`;
    setAdminBusyKey(busyKey);
    closeTileMenu();

    sendRealtimeParticipantControl(participantIdentity, "mute_microphone");
    optimisticMute(tileId);
    setAdminBusyKey("");

    void callAdmin({
      action: "mute_microphone",
      trackKind: "microphone",
      roomName,
      participantIdentity,
      trackSid,
    })
      .then(() => {
        window.setTimeout(() => scheduleRebuildTiles(), 350);
        window.setTimeout(() => scheduleRebuildTiles(), 900);
      })
      .catch((e: any) => {
        console.error("mute mic failed:", e);
        showSystemNotice({
          kind: "error",
          title: "Mic mute failed",
          body: String(e?.message || e || "mute_failed"),
        });
        window.setTimeout(() => scheduleRebuildTiles(), 350);
      });
    return;
  };

  const adminTurnOffRemoteCamera = async (
    tileId: string,
    participantIdentity: string,
    trackSid: string,
  ) => {
    const roomName = roomNameForApi;
    if (!roomName) return;

    const busyKey = `${participantIdentity}:${trackSid}:camera-off`;
    setAdminBusyKey(busyKey);
    closeTileMenu();

    sendRealtimeParticipantControl(participantIdentity, "turn_off_camera");
    optimisticCameraOff(tileId);
    setAdminBusyKey("");

    void callAdmin({
      action: "turn_off_camera",
      trackKind: "camera",
      roomName,
      participantIdentity,
      trackSid,
    })
      .then(() => {
        window.setTimeout(() => scheduleRebuildTiles(), 350);
        window.setTimeout(() => scheduleRebuildTiles(), 900);
      })
      .catch((e: any) => {
        console.error("turn camera off failed:", e);
        showSystemNotice({
          kind: "error",
          title: "Camera action failed",
          body: String(e?.message || e || "camera_off_failed"),
        });
        window.setTimeout(() => scheduleRebuildTiles(), 350);
      });

    return;
  };

  const adminKickParticipant = async (
    participantIdentity: string,
    targetUserId?: string,
    targetLabel?: string,
  ) => {
    const roomName = roomNameForApi;
    if (!roomName) return;

    const busyKey = `${participantIdentity}:kick`;
    setAdminBusyKey(busyKey);

    try {
      const kickedByName =
        (displayName || userName || "Moderator").trim() || "Moderator";

      const channel = kickEventChannelRef.current;
      if (channel) {
        const payload: KickBroadcastPayload = {
          type: "participant_kicked",
          targetIdentity: participantIdentity,
          targetUserId: targetUserId || null,
          kickedByUserId: authUserId || null,
          kickedByName,
          roomName,
          sessionId: session?.id || null,
          at: Date.now(),
        };

        channel
          .send({
            type: "broadcast",
            event: "participant_kicked",
            payload,
          })
          .catch((e: unknown) => {
            console.warn("kick broadcast failed:", e);
          });
      }

      try {
        await callAdmin({
          action: "remove_participant",
          roomName,
          participantIdentity,
        });
      } catch (e: any) {
        const msg = String(e?.message || e || "");
        if (!/participant not found/i.test(msg)) {
          throw e;
        }
      }

      showSystemNotice({
        kind: "info",
        title: "Participant removed",
        body: targetLabel
          ? `${targetLabel} was removed from the room.`
          : "Participant was removed from the room.",
      });

      scheduleRebuildTiles();
      window.setTimeout(() => scheduleRebuildTiles(), 80);
      window.setTimeout(() => scheduleRebuildTiles(), 220);
    } catch (e: any) {
      console.error("kick failed:", e);
      showSystemNotice({
        kind: "error",
        title: "Kick failed",
        body: String(e?.message || e || "kick_failed"),
      });
    } finally {
      setAdminBusyKey("");
    }
  };

  // FX apply in-room
  const applyVideoFx = async (
    mode: FxMode,
    backgroundUrl?: string,
    blurStrengthOverride?: number,
  ) => {
    const r = roomRef.current;
    if (!r) return;

    setFxError("");
    setFxApplying(true);
    setFxStatusText("");

    try {
      const tr = getLocalCameraTrack();
      if (!tr) throw new Error("Camera track is not ready");
      await safeApplyProcessor(
        tr,
        mode,
        blurStrengthOverride ?? blurStrength,
        backgroundUrl || bgImageUrl,
      );

      setVideoFxMode(mode);
      setFxStatusText(
        mode === "off"
          ? "FX disabled"
          : mode === "blur"
            ? `Blur applied (strength ${blurStrengthOverride ?? blurStrength})`
            : "Virtual background applied",
      );
      await delay(40);
    } catch (e: any) {
      console.error("applyVideoFx failed:", e);
      setFxError(String(e?.message || e || "video_fx_failed"));
    } finally {
      setFxApplying(false);
    }
  };

  useEffect(() => {
    if (!connected) return;
    if (videoFxMode !== "blur") return;
    if (fxApplying) return;

    const t = window.setTimeout(() => {
      applyVideoFx("blur").catch(() => { });
    }, 240);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blurStrength]);

  useEffect(() => {
    if (!connected) return;
    if (videoFxMode !== "bg") return;
    if (fxApplying) return;

    const t = window.setTimeout(() => {
      applyVideoFx("bg").catch(() => { });
    }, 240);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgImageUrl]);

  useEffect(() => {
    if (!connected) return;

    const timer = window.setTimeout(() => {
      const track = getLocalCameraTrack();
      if (!track) return;

      safeApplyProcessor(
        track,
        videoFxMode,
        blurStrength,
        bgImageUrl,
        effectiveColorCorrection,
      ).catch((error) => {
        console.error("apply published color correction failed:", error);
        setFxError(
          String(error?.message || error || "color_correction_failed"),
        );
      });
    }, 120);

    return () => window.clearTimeout(timer);
    // Apply slider changes to the outgoing LiveKit track. Primitive values are
    // listed explicitly so unrelated room renders never restart the processor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    connected,
    videoFxMode,
    blurStrength,
    bgImageUrl,
    colorCorrection.brightness,
    colorCorrection.contrast,
    colorCorrection.saturation,
    colorCorrection.warmth,
    colorCorrectionEnabled,
  ]);

  // chat unread
  const hostUserIdForChat = useMemo(() => {
    return String(session?.host_id || "")
      .trim()
      .toLowerCase();
  }, [session?.host_id]);

  const directUnreadTotal = useMemo(() => {
    return Object.values(unreadDirectChatByPeerId).reduce(
      (sum, n) => sum + clampUnreadCount(Number(n || 0)),
      0,
    );
  }, [unreadDirectChatByPeerId]);

  useEffect(() => {
    setUnreadChat(clampUnreadCount(unreadGeneralChat + directUnreadTotal));
  }, [unreadGeneralChat, directUnreadTotal]);

  useEffect(() => {
    selectedHostChatPeerIdRef.current = selectedHostChatPeerId;
  }, [selectedHostChatPeerId]);

  useEffect(() => {
    generalChatVisibleRef.current =
      rightPanelOpen && rightTab === "chat" && chatViewMode === "general";
    directChatVisibleRef.current =
      rightPanelOpen && rightTab === "chat" && chatViewMode === "host";
  }, [rightPanelOpen, rightTab, chatViewMode]);

  const chatGeneralReadKey = useMemo(() => {
    return session?.id
      ? `mysession_chat_general_last_read_at:${session.id}`
      : "";
  }, [session?.id]);

  const chatDirectReadKey = useMemo(() => {
    return session?.id
      ? `mysession_chat_direct_last_read_at:${session.id}:${authUserId || "guest"}`
      : "";
  }, [session?.id, authUserId]);

  const persistDirectReadMap = (next: Record<string, number>) => {
    lastDirectChatReadAtByPeerRef.current = next;
    try {
      if (chatDirectReadKey)
        localStorage.setItem(chatDirectReadKey, JSON.stringify(next));
    } catch { }
  };

  const markGeneralChatRead = (atMs?: number) => {
    if (!session?.id) return;

    const now = Number.isFinite(atMs as any) ? Number(atMs) : Date.now();
    lastGeneralChatReadAtRef.current = Math.max(
      lastGeneralChatReadAtRef.current || 0,
      now,
    );
    setUnreadGeneralChat(0);

    try {
      if (chatGeneralReadKey)
        localStorage.setItem(
          chatGeneralReadKey,
          String(lastGeneralChatReadAtRef.current),
        );
    } catch { }
  };

  const markDirectChatRead = (peerIdRaw?: string | null, atMs?: number) => {
    if (!session?.id) return;

    const peerId = String(peerIdRaw || selectedHostChatPeerIdRef.current || "")
      .trim()
      .toLowerCase();
    if (!peerId) return;

    const now = Number.isFinite(atMs as any) ? Number(atMs) : Date.now();
    const next = {
      ...(lastDirectChatReadAtByPeerRef.current || {}),
      [peerId]: Math.max(
        lastDirectChatReadAtByPeerRef.current?.[peerId] || 0,
        now,
      ),
    };

    persistDirectReadMap(next);

    setUnreadDirectChatByPeerId((prev) => {
      if (!prev[peerId]) return prev;
      const copy = { ...prev };
      delete copy[peerId];
      return copy;
    });
  };

  const addDirectUnread = (peerIdRaw: string, count = 1) => {
    const peerId = String(peerIdRaw || "")
      .trim()
      .toLowerCase();
    if (!peerId) return;

    setUnreadDirectChatByPeerId((prev) => ({
      ...prev,
      [peerId]: clampUnreadCount((prev[peerId] || 0) + count),
    }));
  };

  const handleIncomingChatUnreadRow = (row: ChatUnreadMessageRow) => {
    if (!row || !authUserId) return;

    const senderId = getChatRowSenderId(row);
    if (!senderId) return;
    if (
      senderId ===
      String(authUserId || "")
        .trim()
        .toLowerCase()
    )
      return;

    const msgMs = getChatRowCreatedMs(row);
    const isDirect = isChatRowDirectMessage(row, authUserId, hostUserIdForChat);

    if (!isDirect) {
      if (generalChatVisibleRef.current) {
        markGeneralChatRead(msgMs);
        return;
      }

      if (msgMs > (lastGeneralChatReadAtRef.current || 0)) {
        setUnreadGeneralChat((prev) => clampUnreadCount(prev + 1));
      }
      return;
    }

    const peerId = getChatRowDirectPeerId(row, authUserId, hostUserIdForChat);
    if (!peerId) return;

    const selectedPeer = String(selectedHostChatPeerIdRef.current || "")
      .trim()
      .toLowerCase();

    if (
      directChatVisibleRef.current &&
      selectedPeer &&
      selectedPeer === peerId
    ) {
      markDirectChatRead(peerId, msgMs);
      return;
    }

    const lastRead = Number(
      lastDirectChatReadAtByPeerRef.current?.[peerId] || 0,
    );
    if (msgMs > lastRead) {
      addDirectUnread(peerId, 1);
    }
  };

  useEffect(() => {
    if (rightPanelOpen && rightTab === "chat" && chatViewMode === "general") {
      markGeneralChatRead();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightPanelOpen, rightTab, chatViewMode, session?.id]);

  useEffect(() => {
    if (
      rightPanelOpen &&
      rightTab === "chat" &&
      chatViewMode === "host" &&
      selectedHostChatPeerId
    ) {
      markDirectChatRead(selectedHostChatPeerId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rightPanelOpen,
    rightTab,
    chatViewMode,
    selectedHostChatPeerId,
    session?.id,
  ]);

  useEffect(() => {
    if (!session?.id) return;
    if (!authUserId) return;

    let cancelled = false;

    (async () => {
      let generalLastRead = 0;
      let directLastReadMap: Record<string, number> = {};

      try {
        const raw = localStorage.getItem(chatGeneralReadKey);
        generalLastRead = raw ? Number(raw) : 0;
        if (!Number.isFinite(generalLastRead)) generalLastRead = 0;
      } catch {
        generalLastRead = 0;
      }

      try {
        const raw = localStorage.getItem(chatDirectReadKey);
        const parsed = raw ? JSON.parse(raw) : {};
        directLastReadMap =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, number>)
            : {};
      } catch {
        directLastReadMap = {};
      }

      lastGeneralChatReadAtRef.current = generalLastRead;
      lastDirectChatReadAtByPeerRef.current = directLastReadMap;

      try {
        const sinceMs = Math.max(
          0,
          generalLastRead || 0,
          ...Object.values(directLastReadMap)
            .map((n) => Number(n || 0))
            .filter((n) => Number.isFinite(n)),
        );

        const sinceIso =
          sinceMs > 0
            ? new Date(sinceMs).toISOString()
            : "1970-01-01T00:00:00.000Z";

        const { data, error } = await supabase
          .from(CHAT_MSG_TABLE)
          .select("*")
          .eq("session_id", session.id)
          .neq("user_id", authUserId)
          .gt("created_at", sinceIso)
          .order("created_at", { ascending: true })
          .limit(250);

        if (error) throw error;
        if (cancelled) return;

        let nextGeneral = 0;
        const nextDirect: Record<string, number> = {};

        for (const row of (data || []) as ChatUnreadMessageRow[]) {
          const msgMs = getChatRowCreatedMs(row);
          const isDirect = isChatRowDirectMessage(
            row,
            authUserId,
            hostUserIdForChat,
          );

          if (!isDirect) {
            if (msgMs > generalLastRead) nextGeneral += 1;
            continue;
          }

          const peerId = getChatRowDirectPeerId(
            row,
            authUserId,
            hostUserIdForChat,
          );
          if (!peerId) continue;

          const lastPeerRead = Number(directLastReadMap[peerId] || 0);
          if (msgMs > lastPeerRead) {
            nextDirect[peerId] = clampUnreadCount(
              (nextDirect[peerId] || 0) + 1,
            );
          }
        }

        setUnreadGeneralChat(clampUnreadCount(nextGeneral));
        setUnreadDirectChatByPeerId(nextDirect);
      } catch (e) {
        console.warn("[chat-unread] initial load failed:", e);
        if (!cancelled) {
          setUnreadGeneralChat(0);
          setUnreadDirectChatByPeerId({});
        }
      }
    })();

    const ch = supabase
      .channel(`chat-unread:${session.id}:${authUserId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: CHAT_MSG_TABLE,
          filter: `session_id=eq.${session.id}`,
        },
        (payload: any) => {
          const row = payload?.new as ChatUnreadMessageRow;
          handleIncomingChatUnreadRow(row);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      safeRemoveRealtimeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session?.id,
    authUserId,
    chatGeneralReadKey,
    chatDirectReadKey,
    hostUserIdForChat,
  ]);

  // reactions broadcast
  const pushFloatingReaction = (
    type: ReactionType,
    fromUserId: string,
    fromName: string,
  ) => {
    if (!type || !REACTION_EMOJI[type]) return;

    const id2 = reactionIdRef.current + 1;
    reactionIdRef.current = id2;

    setFloatingReactions((prev) => {
      const next = [...prev, { id: id2, type, fromUserId, fromName }];
      return next.length > 12 ? next.slice(-12) : next;
    });

    const timer = window.setTimeout(() => {
      reactionExpiryTimersRef.current.delete(id2);
      setFloatingReactions((prev) => prev.filter((r) => r.id !== id2));
    }, REACTION_TTL_MS);
    reactionExpiryTimersRef.current.set(id2, timer);
  };

  useEffect(() => {
    if (!session?.id) return;
    if (!authUserId) return;

    const ch = supabase
      .channel(`reactions:${session.id}`, {
        config: { broadcast: { self: false } },
      })
      .on("broadcast", { event: "reaction" }, (payload: any) => {
        const p = payload?.payload || payload;
        const t = String(p?.type || "") as ReactionType;
        const fromUserId = String(p?.fromUserId || "");
        const fromName = String(p?.fromName || "User");

        if (!t || !REACTION_EMOJI[t]) return;
        if (fromUserId && fromUserId === authUserId) return;

        const now = Date.now();
        const cutoff = now - REACTION_RATE_WINDOW_MS;
        const recentTotal = reactionReceiveHistoryRef.current.filter(
          (timestamp) => timestamp > cutoff,
        );
        if (recentTotal.length >= REACTION_RECEIVE_MAX_TOTAL_WINDOW) {
          reactionReceiveHistoryRef.current = recentTotal;
          return;
        }

        const senderKey = fromUserId || "anonymous";
        const recentFromSender = (
          reactionReceiveByUserRef.current.get(senderKey) || []
        ).filter((timestamp) => timestamp > cutoff);
        if (
          recentFromSender.length >= REACTION_RECEIVE_MAX_PER_USER_WINDOW
        ) {
          reactionReceiveByUserRef.current.set(senderKey, recentFromSender);
          return;
        }

        recentTotal.push(now);
        recentFromSender.push(now);
        reactionReceiveHistoryRef.current = recentTotal;
        reactionReceiveByUserRef.current.set(senderKey, recentFromSender);
        pushFloatingReaction(t, fromUserId, fromName);
      })
      .subscribe();

    reactionsChannelRef.current = ch;

    return () => {
      reactionsChannelRef.current = null;
      reactionSendHistoryRef.current = [];
      reactionReceiveHistoryRef.current = [];
      reactionReceiveByUserRef.current.clear();
      safeRemoveRealtimeChannel(ch);
    };
  }, [session?.id, authUserId]);

  const sendReaction = (type: ReactionType): boolean => {
    try {
      if (!session?.id || !authUserId) return false;
      if (!type || !REACTION_EMOJI[type]) return false;

      const now = Date.now();
      const cutoff = now - REACTION_RATE_WINDOW_MS;
      const recent = reactionSendHistoryRef.current.filter(
        (timestamp) => timestamp > cutoff,
      );
      const previous = recent[recent.length - 1] || 0;

      // Reaction spam should degrade into ignored clicks, never into a flood of
      // Realtime packets/state updates that can starve LiveKit heartbeats.
      if (
        recent.length >= REACTION_SEND_MAX_PER_WINDOW ||
        now - previous < REACTION_SEND_MIN_INTERVAL_MS
      ) {
        reactionSendHistoryRef.current = recent;
        return false;
      }

      const ch = reactionsChannelRef.current;
      if (!ch) return false;
      if (ch.state && ch.state !== "joined") return false;

      recent.push(now);
      reactionSendHistoryRef.current = recent;
      pushFloatingReaction(type, authUserId, displayName || userName || "You");

      void Promise.resolve(
        ch.send({
          type: "broadcast",
          event: "reaction",
          payload: {
            type,
            fromUserId: authUserId,
            fromName: displayName || userName || "User",
            at: now,
          },
        }),
      ).catch(() => {
        // Reactions are best-effort UI decoration. A rejected broadcast must
        // never escape into the room lifecycle or disconnect media.
      });
      return true;
    } catch {
      return false;
    }
  };

  // edit name
  const openEditName = () => {
    const current = String(
      localRoomDisplayNameOverrideRef.current ||
      displayName ||
      prejoinRef.current.displayName ||
      userName ||
      "",
    ).trim();

    setEditNameValue(current);
    setEditNameOpen(true);
  };

  const saveEditName = async () => {
    const nm = String(editNameValue || "").trim();
    if (!nm) return;

    try {
      // 1) сразу обновляем локальный UI
      applyRoomDisplayNameLocally(nm);

      // 2) сразу перестраиваем тайлы локально
      scheduleRebuildTiles();

      const r = roomRef.current;
      const lp: any = r?.localParticipant as any;

      if (lp) {
        const prevMeta = parseParticipantMetadata(lp.metadata) || {};

        const nextMeta = {
          ...prevMeta,
          displayName: nm,
        };

        if (typeof lp.setMetadata === "function") {
          await lp.setMetadata(JSON.stringify(nextMeta));
        }

        if (typeof lp.setName === "function") {
          try {
            await lp.setName(nm);
          } catch (e) {
            console.warn("localParticipant.setName failed", e);
          }
        }
      }

      // 3) ещё несколько перестроений после sync
      scheduleRebuildTiles();
      window.setTimeout(() => scheduleRebuildTiles(), 60);
      window.setTimeout(() => scheduleRebuildTiles(), 180);

      setEditNameOpen(false);
    } catch (e) {
      console.error("saveEditName failed:", e);
    }
  };

  // report participant
  const openReportParticipantModal = (t: TileModel) => {
    setReportTarget(t);
    setReportReason("");
    setReportError("");
    setReportModalOpen(true);
  };

  const submitParticipantReport = async () => {
    if (!reportTarget) return;

    const reason = String(reportReason || "").trim();
    if (!reason) {
      setReportError("Please describe the problem.");
      return;
    }

    setReportBusy(true);
    setReportError("");

    try {
      const reportedParticipantId =
        String(
          reportTarget.participantUserId ||
          reportTarget.participantIdentity ||
          reportTarget.id ||
          "",
        ).trim() || null;

      const accessToken = await getFreshAccessToken();
      if (!accessToken) throw new Error("Please sign in before submitting a report.");

      const response = await fetch("/api/push/send-host-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: "participant_report",
          sessionId: session?.id || "",
          reportedParticipantId,
          reason,
        }),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(String(result?.details || result?.error || "report_failed"));
      }

      setReportModalOpen(false);
      setReportTarget(null);
      setReportReason("");

      showSystemNotice({
        kind: "info",
        title: "Report submitted",
        body: `Your report about ${reportTarget.label || "this participant"} has been saved.`,
      });
    } catch (e: any) {
      console.error("report failed:", e);
      setReportError(String(e?.message || e || "report_failed"));
    } finally {
      setReportBusy(false);
    }
  };

  // tiles with hide/pin
  const tilesBaseForUi = useMemo(() => {
    if (!devClones) return tiles;

    const local = tiles.find((t) => t.isLocal) || tiles[0];
    if (!local) return tiles;

    const clones: TileModel[] = [];
    for (let i = 0; i < devClones; i++) {
      clones.push({
        ...local,
        id: `dev-clone-${i + 1}`,
        isLocal: false,
        label: `${local.label || "You"} (clone #${i + 1})`,
        participantIdentity: `${String(local.participantIdentity || "local")}--clone${i + 1}`,
        participantUserId: local.participantUserId,
      });
    }

    return [local, ...clones, ...tiles.filter((t) => t !== local)];
  }, [tiles, devClones]);

  const hiddenTiles = useMemo(() => {
    return tilesBaseForUi.filter((t) => !!hiddenTileIds[t.id]);
  }, [tilesBaseForUi, hiddenTileIds]);

  const tilesForRender = useMemo(() => {
    const list = tilesBaseForUi.filter((t) => !hiddenTileIds[t.id]);

    const pinned = pinnedTileId
      ? list.find((t) => t.id === pinnedTileId) || null
      : null;

    if (!pinned) return list;

    const rest = list.filter((t) => t.id !== pinned.id);
    return [pinned, ...rest];
  }, [tilesBaseForUi, hiddenTileIds, pinnedTileId]);

  // sizing
  const {
    ref: videoSizerRef,
    width: videoWrapW,
    height: videoWrapH,
  } = useElementSize<HTMLDivElement>();
  const fallbackW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const fallbackH = typeof window !== "undefined" ? window.innerHeight : 800;
  const effectiveW = videoWrapW || fallbackW;
  const effectiveH = videoWrapH || fallbackH;

  const roomReadyText = connected
    ? ""
    : prejoinOpen
      ? ""
      : joinRequested
        ? "Joining room…"
        : "";
  const lastErr = tokenError || clientError;

  // hide/pin helpers
  const toggleHide = (tileId: string) => {
    setHiddenTileIds((prev) => {
      const next = { ...prev };
      if (next[tileId]) delete next[tileId];
      else next[tileId] = true;
      return next;
    });
    setOpenTileAdminMenuId(null);
  };

  const togglePin = (tileId: string) => {
    setPinnedTileId((prev) => (prev === tileId ? null : tileId));
    setOpenTileAdminMenuId(null);
  };

  const getBadgeForTile = (t: TileModel): string | null => {
    if (t.isLocal) {
      if (
        isHost ||
        (isTemporaryRoomHost && !sessionOwnerIsPresent)
      )
        return "Host";
      if (isSuperAdmin) return "Admin";
      if (isSelfModerator) return "Moderator";
      return null;
    }

    const pid = (
      t.participantUserId ||
      extractBaseUserIdFromIdentity(String(t.participantIdentity || ""))
    ).toLowerCase();

    if (pid && pid === activeOperationalHostUserId) return "Host";
    if (pid && looksLikeUuid(pid) && moderatorUserIds.includes(pid))
      return "Moderator";
    return null;
  };

  const getAvatarForTile = (t: TileModel): string => {
    if (t.isLocal) return localAvatarUrl || "";
    const pid = String(t.participantUserId || "").toLowerCase();
    const p = looksLikeUuid(pid) ? profilesById[pid] : undefined;
    return String(p?.avatar_url || "") || "";
  };

  const isTileCamOff = (t: TileModel) => {
    if (t.kind === "screen") {
      return !t.videoTrack;
    }

    const exists = !!t.camPubExists;
    const hasTrack = !!t.camPubHasTrack;
    const muted = t.camPubMuted !== false;
    return !exists || !hasTrack || muted;
  };

  const renderAvatarFallback = (t: TileModel) => {
    const avatar = getAvatarForTile(t);
    const name = t.label || "User";
    const initials = getInitials(name);

    return (
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none">
        <div
          className={[
            "w-[78px] h-[78px] rounded-full overflow-hidden flex items-center justify-center shadow-2xl border",
            isLight ? "border-[#CFCFCF]" : "border-[#2B2B2B]",
          ].join(" ")}
        >
          {avatar ? (
            <img
              src={avatar}
              alt={name}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
              onError={(e) => {
                try {
                  (e.currentTarget as any).style.display = "none";
                } catch { }
              }}
            />
          ) : (
            <div
              className={`text-xl font-bold ${isLight ? "text-black/70" : "text-white/85"}`}
            >
              {initials}
            </div>
          )}
        </div>

        <div
          className={`mt-3 px-3 py-1.5 rounded-xl border backdrop-blur ${isLight ? "border-[#CFCFCF] text-black/85" : "border-[#2B2B2B] text-white/90"}`}
        >
          <div className="text-[13px] font-semibold max-w-[260px] truncate text-center">
            {name}
          </div>
        </div>
      </div>
    );
  };

  const handleToggleTileMenu = useCallback(
    (tileId: string, anchorEl: HTMLElement | null) => {
      if (!anchorEl) return;
      if (openTileAdminMenuId === tileId) {
        closeTileMenu();
        return;
      }
      openTileMenuAt(tileId, anchorEl);
    },
    [closeTileMenu, openTileAdminMenuId, openTileMenuAt],
  );

  const handleOpenTileContextMenu = useCallback(
    (
      tileId: string,
      tileElement: HTMLElement,
      point: { x: number; y: number },
    ) => {
      openTileMenuAt(tileId, tileElement, point);
    },
    [openTileMenuAt],
  );
  const handleOpenTileProfile = useCallback(
    (tileId: string) => {
      const tile = tilesForRender.find((candidate) => candidate.id === tileId);
      if (!tile?.participantUserId && !tile?.participantIdentity) return;

      const profile =
        profilesById[String(tile.participantUserId || "").toLowerCase()] ||
        profilesById[String(tile.participantIdentity || "").toLowerCase()] ||
        null;
      if (profile) setSelectedUser(profile);
    },
    [profilesById, tilesForRender],
  );
  const renderTile = (t: TileModel) => {
    const isMenuOpen = openTileAdminMenuId === t.id;

    const canAdminTarget =
      isSelfModerator && !t.isLocal && !!t.participantIdentity;
    const pidBase = String(
      t.participantUserId ||
      extractBaseUserIdFromIdentity(String(t.participantIdentity || "")),
    ).toLowerCase();
    const canRoleManageTarget =
      isHost && !!pidBase && looksLikeUuid(pidBase) && !t.isLocal;
    const isTargetModerator = !!pidBase && moderatorUserIds.includes(pidBase);
    const roleBusy =
      roleBusyKey === `mod:${pidBase}:grant` ||
      roleBusyKey === `mod:${pidBase}:revoke`;

    const hasMicTrack = !!t.micTrackSid && !!t.participantIdentity;
    const hasCamTrack = !!t.camTrackSid && !!t.participantIdentity;

    const muteMicDisabled = !canAdminTarget || !hasMicTrack || !!t.micMuted;
    const turnCameraOffDisabled =
      !canAdminTarget || !hasCamTrack || isTileCamOff(t);
    const kickDisabled = !canAdminTarget || !t.participantIdentity;

    const isHidden = !!hiddenTileIds[t.id];
    const isPinned = pinnedTileId === t.id;

    const isFeaturedTile = featuredTile?.id === t.id;
    const shouldForceMenuVisible =
      isMenuOpen || isPinned || isFeaturedTile || tileCount <= 1;
    const showLocalEditButton = t.isLocal && t.kind !== "screen";

    const busyMuteMic =
      !!t.participantIdentity &&
      !!t.micTrackSid &&
      adminBusyKey === `${t.participantIdentity}:${t.micTrackSid}:mute`;

    const busyCameraOff =
      !!t.participantIdentity &&
      !!t.camTrackSid &&
      adminBusyKey === `${t.participantIdentity}:${t.camTrackSid}:camera-off`;

    const busyKick =
      !!t.participantIdentity &&
      adminBusyKey === `${t.participantIdentity}:kick`;

    const camOff = isTileCamOff(t);
    const nameText = t.label || "User";
    const micMuted = !!t.micMuted;
    const tileAvatarUrl = getAvatarForTile(t);
    const participantProfileKey = String(
      t.participantUserId || "",
    ).toLowerCase();

    const participantProfile: HostProfile | null =
      !t.isLocal && participantProfileKey
        ? profilesById[participantProfileKey] || null
        : null;

    const volumeKey = getParticipantVolumeKey(t);
    const volPct = !t.isLocal
      ? Number(volumePctByParticipantKey[volumeKey] ?? 100)
      : 100;

    const namePlateBaseCls = [
      "group/name inline-flex items-center rounded-2xl border backdrop-blur shadow-sm",
      "px-3 py-2",
      isLight
        ? "bg-[#FAFAFA] border-[#CFCFCF] text-black/85"
        : "bg-[#242424] border-[#2B2B2B] text-white/90",
    ].join(" ");

    const micBadgeWrapCls = isLight
      ? micMuted
        ? "bg-black/8"
        : "bg-[#81DB86]/12"
      : micMuted
        ? "bg-[#242424]"
        : "bg-emerald-400/18";

    const nameTextCls =
      "truncate max-w-[220px] font-inter text-[14px] font-semibold";

    return (
      <div
        className="relative group w-full min-w-0 min-h-0"
        style={{ aspectRatio: "16 / 9" }}
      >
        <div
          className="absolute inset-0"
        >
          <VideoTile
            tileId={t.id}
            label={nameText}
            status={t.status || null}
            videoTrack={t.videoTrack}
            audioTrack={t.audioTrack}
            isLocal={t.isLocal}
            theme={theme}
            showBadge={getBadgeForTile(t)}
            hostActions={undefined}
            avatarUrl={tileAvatarUrl}
            micMuted={micMuted}
            mirrorVideo={t.isLocal ? previewMirrored : false}
            cameraFramingMode={cameraFramingMode}
            isSpeaking={!!t.isSpeaking}
            currentIntention={getCurrentIntentionForTile(t)}
            onToggleMenu={handleToggleTileMenu}
            showMenuButton={
              !!(t.isLocal || t.kind === "screen" || !!t.participantIdentity)
            }
            onOpenProfile={handleOpenTileProfile}
            onOpenContextMenu={handleOpenTileContextMenu}
          />
        </div>

        {showLocalEditButton && (
          <div className="absolute top-2 left-2 z-30">
            <button
              type="button"
              title="Edit name"
              aria-label="Edit name"
              onClick={(e) => {
                e.stopPropagation();
                openEditName();
              }}
              className={[
                "w-9 h-9 rounded-xl flex items-center justify-center transition shadow-sm",
                shouldForceMenuVisible
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100",
                isLight
                  ? "bg-[#F1F1F1]/90 border border-[#CFCFCF] text-black/75 hover:bg-[#F3F3F3]"
                  : "bg-[#1B1B1B]/95 border border-[#2B2B2B] text-white/90 hover:bg-[#242424]",
              ].join(" ")}
            >
              <span className="text-[15px] leading-none">✎</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderPiPTile = (t: TileModel) => {
    const tileIdentity = String(t.participantIdentity || "");
    const participantProfile =
      profilesById[String(t.participantUserId || "").toLowerCase()] || null;

    const participantProfileName = String(
      participantProfile?.full_name || "",
    ).trim();
    const tileAvatarUrl = String(participantProfile?.avatar_url || "").trim();

    const nameText = t.isLocal
      ? localRoomDisplayNameOverrideRef.current ||
      t.metadataDisplayName ||
      displayName ||
      prejoinRef.current.displayName ||
      userName ||
      "You"
      : t.metadataDisplayName ||
      participantProfileName ||
      t.label ||
      "Participant";

    const micMuted = !!t.micMuted;

    return (
      <div className="relative h-full w-full min-h-0 min-w-0">
        <VideoTile
          tileId={t.id}
          label={nameText}
          videoTrack={t.videoTrack}
          audioTrack={t.audioTrack}
          isLocal={t.isLocal}
          theme={theme}
          showBadge={getBadgeForTile(t)}
          hostActions={undefined}
          avatarUrl={tileAvatarUrl}
          micMuted={micMuted}
          mirrorVideo={t.isLocal ? previewMirrored : false}
          cameraFramingMode={cameraFramingMode}
          isSpeaking={!!t.isSpeaking}
          currentIntention={getCurrentIntentionForTile(t)}
          density="compact"
          onToggleMenu={handleToggleTileMenu}
          showMenuButton={
            !!(t.isLocal || t.kind === "screen" || !!t.participantIdentity)
          }
          onOpenProfile={handleOpenTileProfile}
          onOpenContextMenu={handleOpenTileContextMenu}
        />
      </div>
    );
  };

  const screenShareTilesForRender = useMemo(() => {
    return screenShareTiles.filter((t) => !hiddenTileIds[t.id]);
  }, [screenShareTiles, hiddenTileIds]);

  const allTilesForRender = useMemo(() => {
    // Multiple participants can share screens at the same time.
    // Treat every screen share as its own normal tile by default.
    // Camera tiles are still managed by tilesForRender; screen-share tiles are separate.
    const screenIds = new Set(screenShareTilesForRender.map((t) => t.id));
    const cameraTiles = tilesForRender.filter((t) => !screenIds.has(t.id));
    return [...screenShareTilesForRender, ...cameraTiles];
  }, [screenShareTilesForRender, tilesForRender]);

  const activeScreenShareTile = useMemo(() => {
    if (!screenShareTilesForRender.length) return null;

    if (pinnedScreenShareTileId) {
      const selected = screenShareTilesForRender.find(
        (t) => t.id === pinnedScreenShareTileId,
      );
      if (selected) return selected;
    }

    return screenShareTilesForRender[0] || null;
  }, [screenShareTilesForRender, pinnedScreenShareTileId]);

  useEffect(() => {
    if (!screenShareTilesForRender.length) {
      // Keep the next screen share unpinned by default.
      // Screen share should behave like a normal video tile unless someone explicitly pins it.
      setScreenSharePinned(false);
      setPinnedScreenShareTileId(null);
      return;
    }

    if (
      pinnedScreenShareTileId &&
      !screenShareTilesForRender.some((t) => t.id === pinnedScreenShareTileId)
    ) {
      setPinnedScreenShareTileId(null);
      setScreenSharePinned(false);
    }
  }, [screenShareTilesForRender, pinnedScreenShareTileId]);

  const layoutTilesForRender = useMemo(() => {
    if (screenSharePinned && activeScreenShareTile) {
      const withoutDup = allTilesForRender.filter(
        (t) => t.id !== activeScreenShareTile.id,
      );
      return [activeScreenShareTile, ...withoutDup];
    }

    return allTilesForRender;
  }, [allTilesForRender, activeScreenShareTile, screenSharePinned]);

  const [tileTasksByUserId, setTileTasksByUserId] = useState<Record<string, string>>({});

  const tileTaskUserIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tile of allTilesForRender) {
      const userId = getTilePersonKey(tile);
      if (userId) ids.add(userId);
    }
    return Array.from(ids).sort();
  }, [allTilesForRender]);

  const tileTaskUserIdsKey = tileTaskUserIds.join("|");

  const loadTileTasks = useCallback(async () => {
    const sid = String(session?.id || "").trim();
    if (!sid) {
      setTileTasksByUserId({});
      return;
    }

    try {
      const { data, error } = await supabase
        .from("intentions")
        .select("id,text,user_id,session_id,created_at,completed")
        .eq("session_id", sid)
        .eq("completed", false)
        .order("created_at", { ascending: false })
        .limit(160);

      if (error || !Array.isArray(data)) {
        setTileTasksByUserId({});
        return;
      }

      // Legacy/session tasks remain a fallback for tasks created directly on
      // the accountability wall. Panel tasks below are authoritative because
      // their sort_order is the order the user actually sees in Tasks.
      const next: Record<string, string> = {};
      for (const row of data as any[]) {
        const userId = String(row?.user_id || "").trim().toLowerCase();
        const text = String(row?.text || "").trim();
        if (!userId || !text || next[userId]) continue;
        next[userId] = text;
      }

      const participantUserIds = tileTaskUserIdsKey
        ? tileTaskUserIdsKey.split("|").filter(Boolean)
        : [];

      if (participantUserIds.length) {
        let panelResult: any = await supabase
          .from("panel_intentions")
          .select("id,text,user_id,created_at,completed,visibility,sort_order")
          .in("user_id", participantUserIds)
          .or("visibility.eq.public,visibility.is.null")
          .order("sort_order", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(500);

        if (
          panelResult.error &&
          /sort_order|column/i.test(String(panelResult.error.message || ""))
        ) {
          panelResult = await supabase
            .from("panel_intentions")
            .select("id,text,user_id,created_at,completed,visibility")
            .in("user_id", participantUserIds)
            .or("visibility.eq.public,visibility.is.null")
            .order("created_at", { ascending: false })
            .limit(500);
        }

        if (!panelResult.error && Array.isArray(panelResult.data)) {
          const panelUsers = new Set<string>();

          for (const row of panelResult.data as any[]) {
            const userId = String(row?.user_id || "").trim().toLowerCase();
            if (userId) panelUsers.add(userId);
          }

          // If public panel rows exist for a participant, never let an older
          // session intention override their current ordered panel state.
          for (const userId of panelUsers) delete next[userId];

          for (const row of panelResult.data as any[]) {
            const userId = String(row?.user_id || "").trim().toLowerCase();
            const text = String(row?.text || "").trim();
            const visibility = String(row?.visibility || "public").toLowerCase();
            if (
              !userId ||
              !text ||
              next[userId] ||
              Boolean(row?.completed) ||
              visibility === "private" ||
              visibility === "self" ||
              visibility === "hidden"
            ) {
              continue;
            }
            next[userId] = text;
          }
        }
      }

      setTileTasksByUserId(next);
    } catch {
      setTileTasksByUserId({});
    }
  }, [session?.id, tileTaskUserIdsKey]);

  useEffect(() => {
    void loadTileTasks();
  }, [loadTileTasks]);

  useEffect(() => {
    const sid = String(session?.id || "").trim();
    if (!sid) return;

    const ch = supabase
      .channel(`tile-intentions:${sid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "intentions", filter: `session_id=eq.${sid}` },
        () => void loadTileTasks(),
      )
      .subscribe();

    const panelChannel = supabase
      .channel(`tile-panel-intentions:${sid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "panel_intentions" },
        () => void loadTileTasks(),
      )
      .subscribe();

    const refreshFromTaskOrder = () => void loadTileTasks();
    window.addEventListener("mysession:task-order-synced", refreshFromTaskOrder);
    window.addEventListener(TASKS_SYNC_EVENT, refreshFromTaskOrder);

    return () => {
      safeRemoveRealtimeChannel(ch);
      safeRemoveRealtimeChannel(panelChannel);
      window.removeEventListener("mysession:task-order-synced", refreshFromTaskOrder);
      window.removeEventListener(TASKS_SYNC_EVENT, refreshFromTaskOrder);
    };
  }, [session?.id, loadTileTasks]);

  const getCurrentIntentionForTile = useCallback(
    (tile: TileModel) => {
      const userId = getTilePersonKey(tile);
      return tileTasksByUserId[userId] || "";
    },
    [tileTasksByUserId],
  );

  const pinnedParticipantTile = useMemo(() => {
    if (!pinnedTileId) return null;
    return layoutTilesForRender.find((t) => t.id === pinnedTileId) || null;
  }, [pinnedTileId, layoutTilesForRender]);

  const featuredTile = useMemo(() => {
    if (activeScreenShareTile && screenSharePinned) {
      return activeScreenShareTile;
    }

    if (pinnedParticipantTile) {
      return pinnedParticipantTile;
    }

    return null;
  }, [activeScreenShareTile, screenSharePinned, pinnedParticipantTile]);

  const sidebarTiles = useMemo(() => {
    if (activeScreenShareTile && screenSharePinned) {
      return layoutTilesForRender.filter(
        (t) => t.id !== activeScreenShareTile.id,
      );
    }

    if (pinnedParticipantTile) {
      return layoutTilesForRender.filter(
        (t) => t.id !== pinnedParticipantTile.id,
      );
    }

    return layoutTilesForRender;
  }, [
    activeScreenShareTile,
    screenSharePinned,
    pinnedParticipantTile,
    layoutTilesForRender,
  ]);

  // Layout
  const tileCount = layoutTilesForRender.length;

  const aiHostedEnabled = !!session?.ai_hosted;

  const currentStageForAiHost = stages[currentStage] || null;

  const paddingBottomPx = 12;

  const isVeryNarrow = effectiveW < 430;
  const isNarrowForColumns = effectiveW < 520;
  const isCompact = effectiveW < 900;

  const useVeryNarrowMode =
    isVeryNarrow || (isMobileQuery && isNarrowForColumns);
  const useMobileOrTabletGallery = isMobileQuery || isTabletQuery;
  const stackTwoOnThisViewport =
    tileCount === 2 &&
    !useVeryNarrowMode &&
    (isTabletQuery || (isMobileQuery && effectiveW < 640) || isCompact);

  const useFeaturedLayout =
    !!featuredTile &&
    !useMobileOrTabletGallery &&
    !useVeryNarrowMode &&
    effectiveW >=
      (!useOverlayRightPanel && rightPanelOpen ? 980 : 900);

  const showMobileLayoutControls = useMobileOrTabletGallery && tileCount >= 3;

  const mobileLayoutIconTheme = isLight ? "light" : "dark";

  const mobileLayoutBtnBase = isLight
    ? "border-[#CFCFCF] bg-[#F1F1F1]/90 text-black/75 hover:bg-[#F3F3F3]"
    : "border-[#2B2B2B] bg-[#1B1B1B] text-white/80 hover:bg-[#242424]";

  const mobileLayoutBtnActive = isLight
    ? "border-[#5286F6]/50 bg-[#1B1B1B] text-white shadow"
    : "border-emerald-400/50 bg-[#1B1B1B] text-white shadow";

  const MobileLayoutButton = ({
    mode,
    icon,
    label,
    title,
  }: {
    mode: MobileVideoLayoutMode;
    icon: string;
    label: string;
    title: string;
  }) => {
    const active = mobileVideoLayoutMode === mode;

    return (
      <button
        type="button"
        onClick={() => setVideoTileLayoutPreset(mode)}
        className={[
          "h-9 min-w-9 rounded-xl border px-2 text-[11px] font-semibold transition inline-flex items-center justify-center gap-1.5",
          active ? mobileLayoutBtnActive : mobileLayoutBtnBase,
        ].join(" ")}
        title={title}
        aria-label={title}
      >
        <img
          src={`/icons/${icon}-${mobileLayoutIconTheme}.svg`}
          alt=""
          className="h-4 w-4 shrink-0"
          draggable={false}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
        <span>{label}</span>
      </button>
    );
  };

  const videoLayout = mainViewMode === "accountability" ? (
    <AccountabilityWall
      sessionId={session?.id || null}
      tiles={layoutTilesForRender}
      profilesById={profilesById}
      authUserId={authUserId || null}
      theme={theme}
      isLight={isLight}
      onOpenTasks={() => openRightTab("tasks")}
      onSwitchBackToVideo={() => setMainViewMode("video")}
    />
  ) : useFeaturedLayout ? (
    <div
      className="h-full w-full min-w-0 min-h-0 grid gap-2 sm:gap-3 p-2 sm:p-3 overflow-hidden"
      style={{
        gridTemplateColumns:
          !useOverlayRightPanel && rightPanelOpen
            ? "minmax(0, 1fr) clamp(12rem, 20vw, 16rem)"
            : "minmax(0, 1fr) clamp(14rem, 24vw, 20rem)",
      }}
    >
      <div className="min-w-0 min-h-0 flex items-center justify-center overflow-hidden">
        <div className="w-full min-w-0 min-h-0">
          {featuredTile ? renderTile(featuredTile) : null}
        </div>
      </div>

      <div className="min-w-0 min-h-0 overflow-y-auto overflow-x-hidden pr-1 flex flex-col gap-3">
        {sidebarTiles.length === 0 ? (
          <div
            className={`min-h-[160px] rounded-2xl border flex items-center justify-center ${isLight
              ? "border-[#CFCFCF] bg-[#E6E6E6] text-black/50"
              : "border-[#2B2B2B] bg-[#242424] text-white/55"
              }`}
          >
            No other participants
          </div>
        ) : (
          sidebarTiles.map((t) => (
            <div key={`sidebar-${t.id}`}>{renderTile(t)}</div>
          ))
        )}
      </div>
    </div>
  ) : (
    <>
      {!tileCount && connected ? (
        <div
          className={`h-full w-full flex items-center justify-center px-4 ${isLight ? "text-black/60" : "text-white/60"}`}
        >
          <div
            className={`min-h-[240px] w-full max-w-[680px] rounded-2xl border flex items-center justify-center ${isLight ? "border-[#CFCFCF] bg-[#E6E6E6]" : "border-[#2B2B2B] bg-[#242424]"}`}
          >
            No participants yet
          </div>
        </div>
      ) : tileCount ? (
        useMobileOrTabletGallery ? (
          <div className="h-full w-full min-w-0 min-h-0 overflow-hidden">
            {tileCount <= 2 ? (
              <MobileFillLayoutSizing<TileModel>
                items={layoutTilesForRender}
                containerWidth={effectiveW}
                containerHeight={effectiveH}
                paddingBottomPx={paddingBottomPx}
                mobileMode={mobileVideoLayoutMode}
                layoutPreset={videoTileLayoutPreset}
                customColumns={videoTileLayoutColumns}
                customRows={videoTileLayoutRows}
                renderItem={(t) => renderTile(t)}
              />
            ) : (
              <MobileStackLayoutSizing<TileModel>
                items={layoutTilesForRender}
                containerWidth={effectiveW}
                containerHeight={effectiveH}
                paddingBottomPx={paddingBottomPx}
                mode={mobileVideoLayoutMode}
                layoutPreset={videoTileLayoutPreset}
                customColumns={videoTileLayoutColumns}
                customRows={videoTileLayoutRows}
                renderItem={(t) => renderTile(t)}
              />
            )}
          </div>
        ) : tileCount <= 2 ? (
          <div className="h-full w-full min-w-0 min-h-0 overflow-hidden">
            <P2PLayoutSizing<TileModel>
              items={layoutTilesForRender}
              containerWidth={effectiveW}
              containerHeight={effectiveH}
              stack={stackTwoOnThisViewport}
              renderItem={(t) => renderTile(t)}
            />
          </div>
        ) : (
          <div className="h-full w-full min-w-0 min-h-0 overflow-hidden">
            <GridLayoutSizing<TileModel>
              items={layoutTilesForRender}
              containerWidth={effectiveW}
              containerHeight={effectiveH}
              rightPanelOpen={rightPanelOpen}
              mobileOrTablet={useMobileOrTabletGallery}
              forceThreeAsTwoPlusOne={
                !useOverlayRightPanel && rightPanelOpen && effectiveW < 1500
              }
              layoutPreset={videoTileLayoutPreset}
              customColumns={videoTileLayoutColumns}
              customRows={videoTileLayoutRows}
              renderItem={(t) => renderTile(t)}
            />
          </div>
        )
      ) : null}
    </>
  );

  const videoContent = (
    <div className="w-full h-full min-w-0 min-h-0 relative overflow-hidden">
      {mainViewMode !== "accountability" && showMobileLayoutControls && showMobileLayoutSwitcher ? (
        <div className="absolute right-2 top-2 z-20 flex items-center gap-1.5 rounded-2xl p-1 backdrop-blur-xl pointer-events-auto">
          <MobileLayoutButton
            mode="one"
            icon="layout-one-column"
            label="1"
            title="One-column video layout"
          />
          <MobileLayoutButton
            mode="two"
            icon="layout-two-columns"
            label="2"
            title="Two-column video layout"
          />
          <MobileLayoutButton
            mode="strip"
            icon="layout-one-line"
            label="One line"
            title="Horizontal-scroll one-line video layout"
          />
          <button
            type="button"
            onClick={() => updateShowMobileLayoutSwitcher(false)}
            className={[
              "w-7 h-7 rounded-xl flex items-center justify-center text-[13px] font-bold transition",
              isLight
                ? "bg-[#242424]0 hover:bg-[#F3F3F3] text-black/60 border border-[#CFCFCF]"
                : "bg-[#242424] hover:bg-[#424242] text-white/70 border border-[#2B2B2B]",
            ].join(" ")}
            title="Hide layout switcher"
          >
            ×
          </button>
        </div>
      ) : null}
      {roomReadyText ? (
        <div
          className={`absolute inset-0 flex items-center justify-center z-10 ${isLight ? "text-black/60" : "text-white/70"}`}
        >
          <div
            className={`px-4 py-2 rounded-xl ${isLight ? "bg-[#FAFAFA]" : "bg-[#242424]"}`}
          >
            {roomReadyText}
          </div>
        </div>
      ) : null}

      {hiddenTiles.length > 0 && (
        <div className="absolute top-3 left-3 z-30 max-w-[80%]">
          <div
            className={[
              "inline-flex items-center gap-2 px-3 py-2 rounded-2xl border backdrop-blur shadow",
              isLight
                ? "bg-[#242424]0 border-[#CFCFCF] text-black/75"
                : "bg-[#242424] border-[#2B2B2B] text-white/85",
            ].join(" ")}
          >
            <span className="text-[12px] font-semibold">Hidden:</span>
            <div className="flex flex-wrap gap-2">
              {hiddenTiles.slice(0, 8).map((t) => (
                <button
                  key={`unhide-${t.id}`}
                  type="button"
                  onClick={() => toggleHide(t.id)}
                  className={[
                    "px-2 py-1 rounded-xl text-[12px] font-semibold border transition",
                    isLight
                      ? "bg-[#E6E6E6] border-[#CFCFCF] hover:bg-[#DCDCDC] text-black/70"
                      : "bg-[#242424] border-[#2B2B2B] hover:bg-[#303030] text-white/85",
                  ].join(" ")}
                  title="Unhide participant"
                >
                  {String(t.label || "User").slice(0, 18)} ✕
                </button>
              ))}
              {hiddenTiles.length > 8 ? (
                <span
                  className={`text-[12px] opacity-70 ${isLight ? "text-black/60" : "text-white/70"}`}
                >
                  +{hiddenTiles.length - 8}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {videoLayout}

      {floatingReactions.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex items-end justify-center">
          <div className="relative flex flex-col items-center gap-2">
            {floatingReactions.slice(-3).map((r, idx) => (
              <div
                key={r.id}
                className={[
                  "ms-reaction-float select-none",
                  "px-4 py-3 rounded-3xl shadow-2xl border backdrop-blur",
                  "flex flex-col items-center justify-center",
                  isLight
                    ? "bg-[#F1F1F1]/90 border-[#CFCFCF] text-black/80"
                    : "bg-[#242424] border-[#2B2B2B] text-white/90",
                ].join(" ")}
                style={{ animationDelay: `${idx * 0.05}s` }}
              >
                <div className="text-[44px] leading-none">
                  {REACTION_EMOJI[r.type]}
                </div>
                <div className="mt-1 text-[12px] leading-tight opacity-80 max-w-[260px] truncate">
                  {r.fromName}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const pipGalleryTiles = useMemo(() => {
    if (activeScreenShareTile && screenSharePinned) {
      const withoutDup = layoutTilesForRender.filter(
        (t) => t.id !== activeScreenShareTile.id,
      );
      return [activeScreenShareTile, ...withoutDup].slice(0, 9);
    }

    if (pinnedParticipantTile) {
      const withoutDup = layoutTilesForRender.filter(
        (t) => t.id !== pinnedParticipantTile.id,
      );
      return [pinnedParticipantTile, ...withoutDup].slice(0, 9);
    }

    return layoutTilesForRender.slice(0, 9);
  }, [
    activeScreenShareTile,
    screenSharePinned,
    pinnedParticipantTile,
    layoutTilesForRender,
  ]);

  const pipGalleryColumns = useMemo(() => {
    const count = pipGalleryTiles.length;

    if (count <= 1) return 1;
    if (count === 2) return 2;
    if (count === 3) return 2;
    if (count === 4) return 2;
    if (count <= 6) return 3;
    return 3;
  }, [pipGalleryTiles.length]);

  const pipChatDocument = pipMountEl?.ownerDocument || null;
  const pipChatWindow = pipChatDocument?.defaultView || null;
  const pipChatReady = Boolean(
    pipMountEl?.isConnected &&
    pipChatDocument?.body &&
    pipChatWindow &&
    !pipChatWindow.closed,
  );

  const pipChatPanel = session?.id && pipChatReady ? (
    <div
      className="h-full min-h-0 w-full overflow-hidden bg-[#F3F1F1] text-[#1F1F1F]"
      data-theme="light"
      style={{ colorScheme: "light" }}
    >
      <ChatPanel
        key={`pip-chat-${session.id}`}
        sessionId={sessionId}
        theme="light"
        showHeader={false}
        onClose={() => setPipMode("gallery")}
        hostUserIdOverride={chatHostUserId || null}
        hostProfileOverride={
          activeOperationalHostProfile || session?.host_profile || null
        }
        externalMode="general"
        generalChatDisabled={roomPolicies.publicChatDisabled}
        renderDocument={pipChatDocument}
        renderWindow={pipChatWindow}
      />
    </div>
  ) : null;

  const pipPortal = pipMountEl
    ? createPortal(
      <LiveKitPiPPortal
        isLight={isLight}
        theme={theme}
        sessionTitle={String(session?.title || "Session")}
        participantsCount={participantsCount}
        remainingTime={remainingTime}
        pipMode={pipMode}
        pipGalleryTiles={pipGalleryTiles}
        pipGalleryColumns={pipGalleryColumns}
        renderTile={renderPiPTile}
        micOn={micOn}
        camOn={camOn}
        screenShareOn={screenShareOn}
        onToggleMic={() => {
          toggleMic().catch(() => { });
        }}
        onToggleCam={() => {
          toggleCam().catch(() => { });
        }}
        onToggleScreenShare={() => {
          toggleScreenShare().catch(() => { });
        }}
        onSendReaction={sendReaction}
        onSetPipMode={(mode) => {
          // Keep one ChatPanel instance per room. Transfer chat to PiP before
          // mounting it there so realtime channels and portals cannot collide.
          if (mode === "chat" && rightPanelOpen && rightTab === "chat") {
            setRightPanelOpen(false);
            setRightTab(null);
          }
          setPipMode(mode);
        }}
        onOpenTasksPanel={openTasksFromPictureInPicture}
        chatPanel={pipChatPanel}
      />,
      pipMountEl,
    )
    : null;

  // UI colors
  const pageBg = isLight
    ? "bg-[#F3F1F1] text-[#1F1F1F]"
    : "bg-[#1B1B1B] text-white";
  const panelBg = "bg-[#F3F1F1] border border-[#D8D0D0]";
  const bottomBarBg = isLight
    ? "bg-[#F3F1F1] border border-[#D8D0D0]"
    : "bg-[#1B1B1B] border border-[#252525]";
  const voiceUiStatusLabel =
    !voiceUiEnabled
      ? "Voice UI off"
      : voiceUiMode === "hotkey" && !voiceUiHotkeyPressed
        ? `Press ${voiceUiHotkey}, then speak`
      : voiceUiStatus === "listening"
      ? "Voice UI listening"
      : voiceUiStatus === "starting"
        ? "Voice UI starting"
        : voiceUiStatus === "blocked"
          ? "Voice UI needs microphone permission"
          : voiceUiStatus === "unsupported"
            ? "Voice UI is not supported"
            : "Voice UI paused";
  const voiceUiStatusDot =
    !voiceUiEnabled
      ? "bg-zinc-500"
      : voiceUiMode === "hotkey" && !voiceUiHotkeyPressed
        ? "bg-indigo-400"
      : voiceUiStatus === "listening"
      ? "bg-emerald-400"
      : voiceUiStatus === "starting"
        ? "bg-amber-400"
        : voiceUiStatus === "blocked"
          ? "bg-red-400"
          : "bg-zinc-400";

  const ctlBtnBase = isLight
    ? "bg-[#E7E7E7] hover:bg-[#DCDCDC] text-black/75"
    : "bg-[#242424] hover:bg-[#2E2E2E] text-white/90";

  // participants list search
  const [participantsSearch, setParticipantsSearch] = useState("");

  const participantsForPanel = useMemo(() => {
    const q = participantsSearch.trim().toLowerCase();
    const base = tilesBaseForUi;
    if (!q) return base;
    return base.filter((t) => (t.label || "").toLowerCase().includes(q));
  }, [tilesBaseForUi, participantsSearch]);

  const ChatPanelAny = ChatPanel as any;

  const RightPanelBody = (
    <div
      className={`rounded-2xl shadow-lg overflow-hidden min-h-0 h-full flex flex-col ${panelBg} ${theme === "dark" ? "dark" : ""}`}
      data-theme={theme}
      style={{ colorScheme: theme }}
    >
      {rightTab === "participants" && (
        <div className="h-full min-h-0 flex flex-col">
          <div
            className={`${roomPanelHeaderClass} border-b flex items-center justify-between border-[#D8D0D0] bg-[#F3F1F1]`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="text-black/85 font-inter font-semibold truncate"
              >
                Participants
              </span>
              <span
                className="text-black/50 text-sm"
              >
                ({participantsCount})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={openEditName}
                className={`px-3 h-9 rounded-xl text-[12px] font-semibold border transition ${true
                  ? "bg-[#1B1B1B] border-[#1B1B1B] hover:bg-[#242424] text-white"
                  : "bg-[#1B1B1B] border-[#1B1B1B] hover:bg-[#242424] text-white"
                  }`}
                title="Edit my name"
              >
                Edit my name
              </button>

              <button
                onClick={() => openRightTab(null)}
                className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${true
                  ? "bg-[#E6E6E6] hover:bg-[#DCDCDC] text-black/60"
                  : "bg-[#E6E6E6] hover:bg-[#DCDCDC] text-black/60"
                  }`}
                title="Close"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="p-4">
            <div
              className={`rounded-xl px-3 py-2 ${true
                ? "bg-[#E6E6E6] border border-[#CFCFCF]"
                : "bg-[#E6E6E6] border border-[#CFCFCF]"
                }`}
            >
              <input
                value={participantsSearch}
                onChange={(e) => setParticipantsSearch(e.target.value)}
                placeholder="Search participants..."
                className={`w-full bg-transparent outline-none text-[13px] placeholder:opacity-60 ${true
                  ? "text-black/80 placeholder:text-black/40"
                  : "text-black/80 placeholder:text-black/40"
                  }`}
              />
            </div>

            {rolesError ? (
              <div
                className={`mt-2 text-[12px] ${"text-red-600"}`}
              >
                {rolesError}
              </div>
            ) : null}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
            <div className="flex flex-col gap-2">
              {participantsForPanel.map((p) => {
                const isHidden = !!hiddenTileIds[p.id];
                const isPinned = pinnedTileId === p.id;

                const avatar = getAvatarForTile(p);
                const initials = getInitials(p.label);
                const pidBase = String(p.participantUserId || "").toLowerCase();
                const isActiveOperationalHost = p.isLocal
                  ? isHost ||
                    (isTemporaryRoomHost && !sessionOwnerIsPresent)
                  : !!pidBase && pidBase === activeOperationalHostUserId;
                const isMod =
                  !p.isLocal && looksLikeUuid(pidBase)
                    ? moderatorUserIds.includes(pidBase)
                    : p.isLocal
                      ? isSelfModerator && !isActiveOperationalHost
                      : false;

                const roleText =
                  p.kind === "screen"
                    ? p.isLocal
                      ? "Your screen"
                      : "Screen share"
                    : p.isLocal
                      ? isActiveOperationalHost
                        ? "Host"
                        : isSuperAdmin
                          ? "Admin"
                          : isMod
                          ? "Moderator"
                          : "You"
                      : isActiveOperationalHost
                        ? "Host"
                        : isMod
                          ? "Moderator"
                          : "Participant";

                return (
                  <div
                    key={p.id}
                    className={`px-3 py-2 rounded-xl transition ${true ? "hover:bg-[#E8E8E8]" : "hover:bg-[#E8E8E8]"
                      }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border text-[14px] font-semibold ${p.isLocal
                            ? "border-[#81DB86]/70 bg-[#81DB86]/20 text-[#245F2A] ring-2 ring-[#81DB86]/20"
                            : "border-[#C9D8CB] bg-[#E5EEE6] text-[#356B3A]"
                            }`}
                        >
                          <span aria-hidden="true">
                            {p.kind === "screen" ? "🖥️" : initials}
                          </span>
                          {avatar ? (
                            <img
                              src={avatar}
                              alt={p.label}
                              className="absolute inset-0 h-full w-full object-cover"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                try {
                                  e.currentTarget.remove();
                                } catch { }
                              }}
                            />
                          ) : null}
                        </div>

                        <div className="min-w-0">
                          <div
                            className={`text-[13px] font-medium truncate ${true ? "text-black/85" : "text-black/85"
                              }`}
                          >
                            <div className="min-w-0 flex items-center gap-2">
                              <span className="truncate">{p.label}</span>

                              {isPinned ? (
                                <span className="inline-flex shrink-0 items-center rounded-full bg-[#2F2F2F] px-1.5 py-[2px] text-[9px] font-medium leading-none text-white">
                                  Pinned
                                </span>
                              ) : null}

                              {isHidden ? (
                                <span className="inline-flex shrink-0 items-center rounded-full border border-black/15 bg-black/[0.04] px-1.5 py-[2px] text-[9px] font-medium leading-none text-[#2F2F2F]">
                                  Hidden
                                </span>
                              ) : null}

                            </div>
                          </div>
                          <div className="truncate text-[11px] text-black/55">
                            {roleText}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {p.kind === "screen" && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                const isThisPinnedScreen =
                                  screenSharePinned &&
                                  activeScreenShareTile?.id === p.id;
                                setPinnedScreenShareTileId(
                                  isThisPinnedScreen ? null : p.id,
                                );
                                setScreenSharePinned(!isThisPinnedScreen);
                              }}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#2F2F2F] transition-colors hover:bg-black/[0.06]"
                              title={
                                screenSharePinned &&
                                  activeScreenShareTile?.id === p.id
                                  ? "Unpin shared screen"
                                  : "Pin shared screen"
                              }
                              aria-label={
                                screenSharePinned &&
                                  activeScreenShareTile?.id === p.id
                                  ? "Unpin shared screen"
                                  : "Pin shared screen"
                              }
                            >
                              <img
                                src={
                                  screenSharePinned && activeScreenShareTile?.id === p.id
                                    ? "/icons/participant-unpin.svg"
                                    : "/icons/participant-pin.svg"
                                }
                                alt=""
                                aria-hidden="true"
                                className="h-4 w-4"
                              />
                            </button>
                          </>
                        )}

                        {p.kind !== "screen" && (
                          <>
                            <button
                              onClick={() => togglePin(p.id)}
                              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-black/[0.06] ${isPinned ? "text-[#2F2F2F]" : "text-black/55 hover:text-[#2F2F2F]"}`}
                              title={isPinned ? "Unpin" : "Pin"}
                              aria-label={isPinned ? `Unpin ${p.label}` : `Pin ${p.label}`}
                              type="button"
                            >
                              <img
                                src={
                                  isPinned
                                    ? "/icons/participant-unpin.svg"
                                    : "/icons/participant-pin.svg"
                                }
                                alt=""
                                aria-hidden="true"
                                className="h-4 w-4"
                              />
                            </button>

                            <button
                              onClick={() => toggleHide(p.id)}
                              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-black/[0.06]"
                              title={isHidden ? "Unhide" : "Hide"}
                              aria-label={isHidden ? `Show ${p.label}` : `Hide ${p.label}`}
                              type="button"
                            >
                              <img
                                src={isHidden ? "/icons/participant-show.svg" : "/icons/participant-hide.svg"}
                                alt=""
                                aria-hidden="true"
                                className="h-[17px] w-[17px]"
                              />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            className={`p-4 border-t ${true ? "border-[#CFCFCF]" : "border-[#CFCFCF]"}`}
          >
            <button
              onClick={() => {
                try {
                  const url = window.location.href;
                  void navigator.clipboard.writeText(url);
                  alert("Invite link copied ✅");
                } catch {
                  alert("Could not copy link");
                }
              }}
              className={`w-full h-12 rounded-xl font-semibold flex items-center justify-center gap-2 ${isLight
                ? "bg-[#1B1B1B] hover:bg-[#242424] text-white"
                : "bg-[#1B1B1B] hover:bg-[#242424] text-white"
                }`}
            >
              <span className="text-lg">⎘</span>
              <span>Copy invite link</span>
            </button>
          </div>
        </div>
      )}

      {rightPanelOpen && rightTab === "chat" && (
        <div className="ms-chat-panel-scrollbars flex flex-col h-full">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[#D8D0D0] bg-[#F3F1F1] min-h-[52px]">
            <div className="flex items-center gap-2 shrink-0 mr-1">
              <img
                src="/icons/chat-light.svg"
                alt="Chat"
                className="w-4 h-4 shrink-0"
                draggable={false}
              />
              <span
                className={
                  "text-[13px] font-semibold shrink-0 text-black/85"
                }
              >
                Chat
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setChatViewMode("general")}
                className={
                  "relative h-8 px-3 rounded-full text-xs font-medium transition border shrink-0 " +
                  (chatViewMode === "general"
                    ? "bg-[#1B1B1B] border-[#1B1B1B] text-white"
                    : "bg-transparent border-[#CFCFCF] text-black/65 hover:bg-[#E8E8E8]")
                }
              >
                <span className="inline-flex items-center gap-1.5">
                  <span>All</span>
                  {unreadGeneralChat > 0 ? (
                    <span
                      className={
                        "inline-flex min-w-[16px] h-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none " +
                        (chatViewMode === "general"
                          ? "bg-[#F65252] text-white"
                          : "bg-[#F65252] text-white")
                      }
                      title={`${unreadGeneralChat} new chat message${unreadGeneralChat === 1 ? "" : "s"}`}
                    >
                      {unreadGeneralChat > 9 ? "9+" : unreadGeneralChat}
                    </span>
                  ) : null}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setChatViewMode("host")}
                className={
                  "relative h-8 px-3 rounded-full text-xs font-medium transition border shrink-0 " +
                  (chatViewMode === "host"
                    ? "bg-[#1B1B1B] border-[#1B1B1B] text-white"
                    : "bg-transparent border-[#CFCFCF] text-black/65 hover:bg-[#E8E8E8]")
                }
              >
                <span className="inline-flex items-center gap-1.5">
                  <span>DMs</span>
                  {directUnreadTotal > 0 ? (
                    <span
                      className="inline-flex min-w-[16px] h-4 items-center justify-center rounded-full bg-[#F65252] px-1 text-[10px] font-bold leading-none text-white"
                      title={`${directUnreadTotal} new DM${directUnreadTotal === 1 ? "" : "s"}`}
                    >
                      {directUnreadTotal > 9 ? "9+" : directUnreadTotal}
                    </span>
                  ) : null}
                </span>
              </button>
            </div>

            <div className="flex-1 min-w-0" />

            {canSelectHostDmPeer && chatViewMode === "host" && (
                <div ref={hostDmDropdownRef} className="relative shrink-0">
                  <style>
                    {`
                      @keyframes mysessionHostDmDropdownIn {
                        from {
                          opacity: 0;
                          transform: translateY(-4px) scale(0.98);
                        }
                        to {
                          opacity: 1;
                          transform: translateY(0) scale(1);
                        }
                      }
                    `}
                  </style>

                  <button
                    type="button"
                    onClick={() => setHostDmDropdownOpen((v) => !v)}
                    className={
                      "flex h-8 w-[136px] min-w-0 max-w-[136px] items-center justify-between gap-2 rounded-full border px-3 text-xs font-normal outline-none transition sm:w-[148px] sm:max-w-[148px] xl:w-[160px] xl:max-w-[160px] " +
                      (isLight
                        ? "border-[#D8D0D0] bg-[#F7F5F5] text-black/80 hover:border-[#C9C1C1] hover:bg-white"
                        : "border-[#2B2B2B] bg-[#242424] text-white/85 hover:border-[#3A3A3A] hover:bg-[#2A2A2A]")
                    }
                    aria-haspopup="listbox"
                    aria-expanded={hostDmDropdownOpen}
                    title="Choose participant for DMs"
                  >
                    <span className="min-w-0 truncate">
                      {selectedHostChatPeerId
                        ? liveHostChatOptions.find(
                          (item) => item.userId === selectedHostChatPeerId,
                        )?.label || "Choose DM"
                        : liveHostChatOptions.length
                          ? "Choose DM"
                          : "No one live"}
                    </span>

                    <span
                      className={
                        "shrink-0 transition-transform duration-200 " +
                        (hostDmDropdownOpen ? "rotate-180" : "rotate-0") +
                        " " +
                        (isLight ? "text-black/50" : "text-white/55")
                      }
                      aria-hidden="true"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <path
                          d="M7 10L12 15L17 10"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  </button>

                  {hostDmDropdownOpen ? (
                    <div
                      role="listbox"
                      className={
                        "absolute right-0 top-[calc(100%+6px)] z-[90] w-[190px] origin-top-right overflow-hidden rounded-2xl border p-1 shadow-[0_10px_24px_rgba(0,0,0,0.12)] sm:w-[204px] " +
                        (isLight
                          ? "border-[#D8D0D0]/80 bg-[#F7F5F5] text-black"
                          : "border-[#2B2B2B] bg-[#242424] text-white")
                      }
                      style={{
                        borderWidth: 1,
                        animation:
                          "mysessionHostDmDropdownIn 140ms ease-out both",
                      }}
                    >
                      <button
                        type="button"
                        role="option"
                        aria-selected={!selectedHostChatPeerId}
                        onClick={() => {
                          setSelectedHostChatPeerId(null);
                          setHostDmDropdownOpen(false);
                        }}
                        className={
                          "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-normal transition " +
                          (!selectedHostChatPeerId
                            ? isLight
                              ? "bg-white text-black shadow-[0_1px_4px_rgba(0,0,0,0.04)]"
                              : "bg-[#1B1B1B] text-white"
                            : isLight
                              ? "text-black/70 hover:bg-white"
                              : "text-white/70 hover:bg-[#2E2E2E]")
                        }
                      >
                        <span className="min-w-0 truncate">
                          {liveHostChatOptions.length ? "Choose DM" : "No one live"}
                        </span>
                      </button>

                      {liveHostChatOptions.map((item) => {
                        const dmUnread = clampUnreadCount(
                          unreadDirectChatByPeerId[item.userId] || 0,
                        );
                        const selected = selectedHostChatPeerId === item.userId;

                        return (
                          <button
                            key={item.userId}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onClick={() => {
                              setSelectedHostChatPeerId(item.userId);
                              setHostDmDropdownOpen(false);
                            }}
                            className={
                              "mt-1 flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs font-normal transition " +
                              (selected
                                ? isLight
                                  ? "bg-white text-black shadow-[0_1px_4px_rgba(0,0,0,0.04)]"
                                  : "bg-[#1B1B1B] text-white"
                                : isLight
                                  ? "text-black/70 hover:bg-white"
                                  : "text-white/70 hover:bg-[#2E2E2E]")
                            }
                            title={item.label}
                          >
                            <span className="min-w-0 truncate">{item.label}</span>

                            {dmUnread > 0 ? (
                              <span className="shrink-0 rounded-full bg-[#F65252] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                                {dmUnread > 9 ? "9+" : dmUnread}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              )}

            {canSelectHostDmPeer &&
              chatViewMode === "host" &&
              liveHostChatOptions.some(
                (item) =>
                  clampUnreadCount(unreadDirectChatByPeerId[item.userId] || 0) >
                  0,
              ) ? (
              <div className="hidden xl:flex items-center gap-1.5 shrink-0 max-w-[360px] overflow-x-auto pr-1">
                {liveHostChatOptions
                  .filter(
                    (item) =>
                      clampUnreadCount(
                        unreadDirectChatByPeerId[item.userId] || 0,
                      ) > 0,
                  )
                  .slice(0, 4)
                  .map((item) => {
                    const dmUnread = clampUnreadCount(
                      unreadDirectChatByPeerId[item.userId] || 0,
                    );

                    return (
                      <button
                        key={item.userId}
                        type="button"
                        onClick={() => {
                          setChatViewMode("host");
                          setSelectedHostChatPeerId(item.userId);
                        }}
                        className={
                          "h-8 max-w-[115px] rounded-full border px-2.5 text-[11px] font-semibold transition flex items-center gap-1.5 shrink-0 " +
                          (isLight
                            ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                            : "border-red-500/25 bg-red-500/10 text-red-200 hover:bg-red-500/15")
                        }
                        title={`${item.label}: ${dmUnread} new DM${dmUnread === 1 ? "" : "s"}`}
                      >
                        <span className="h-2 w-2 rounded-full bg-[#F65252] shrink-0" />
                        <span className="truncate">{item.label}</span>
                        <span className="shrink-0">
                          {dmUnread > 9 ? "9+" : dmUnread}
                        </span>
                      </button>
                    );
                  })}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => {
                setRightPanelOpen(false);
                setRightTab(null);
              }}
              className={
                "w-8 h-8 rounded-xl flex items-center justify-center transition shrink-0 " +
                "bg-[#E6E6E6] hover:bg-[#DCDCDC] text-black/60"
              }
              title="Close chat"
            >
              ✕
            </button>
          </div>

          <ChatPanel
            sessionId={sessionId}
            theme={theme}
            showHeader={false}
            onClose={() => {
              setRightPanelOpen(false);
              setRightTab(null);
            }}
            hostUserIdOverride={chatHostUserId || null}
            hostProfileOverride={
              activeOperationalHostProfile || session?.host_profile || null
            }
            externalMode={chatViewMode}
            externalDirectPeerUserId={selectedHostChatPeerId}
            onDirectPeerIdsChange={setHostChatPeerIds}
            generalChatDisabled={roomPolicies.publicChatDisabled}
          />
        </div>
      )}

      {rightTab === "music" && (
        <RoomSoundscapePanel
          listeningMode={soundscapeListeningMode}
          activeId={
            soundscapeListeningMode === "room"
              ? activeSoundscapeId
              : personalSoundscapeId
          }
          playing={
            soundscapeListeningMode === "room"
              ? soundscapePlaying
              : personalSoundscapePlaying
          }
          currentTime={
            soundscapeListeningMode === "room"
              ? soundscapePosition
              : personalSoundscapePosition
          }
          duration={
            soundscapeListeningMode === "room"
              ? soundscapeDuration
              : personalSoundscapeDuration
          }
          volume={
            soundscapeListeningMode === "room"
              ? roomSoundscapeVolume
              : soundscapeVolume
          }
          personalMuted={
            soundscapeListeningMode === "room"
              ? soundscapeMuted
              : personalSoundscapeMuted
          }
          canControl={
            soundscapeListeningMode === "room"
              ? canControlRoomSoundtrack
              : connected
          }
          canUpload={
            soundscapeListeningMode === "room" && canUploadRoomSoundtrack
          }
          customTrackLabel={
            soundscapeListeningMode === "room" ? customSoundscapeLabel : null
          }
          busy={soundscapeBusy}
          uploading={soundscapeUploading}
          error={soundscapeError}
          onListeningModeChange={setSoundscapeListeningMode}
          onSelect={(id) => {
            if (soundscapeListeningMode === "personal") {
              void selectPersonalSoundtrack(id);
              return;
            }
            void selectRoomSoundtrack(id).catch(() => { });
          }}
          onSeek={(position) => {
            if (soundscapeListeningMode === "personal") {
              seekPersonalSoundtrack(position);
              return;
            }
            void seekRoomSoundtrack(position).catch(() => { });
          }}
          onVolumeChange={(volume) => {
            if (soundscapeListeningMode === "room") {
              adjustRoomSoundtrackVolume(volume);
              return;
            }
            setSoundscapeVolume(volume);
          }}
          onUpload={(file) => {
            void uploadRoomSoundtrack(file);
          }}
          onToggleMute={() => {
            if (soundscapeListeningMode === "personal") {
              setPersonalSoundscapeMuted((current) => !current);
              return;
            }
            setSoundscapeMuted((current) => !current);
          }}
          onStop={() => {
            if (soundscapeListeningMode === "personal") {
              void togglePersonalSoundtrack().catch(() => { });
              return;
            }
            if (soundscapePlaying) {
              void pauseRoomSoundtrack().catch(() => { });
              return;
            }
            const state = soundscapeStateRef.current;
            if (!state) return;
            if (state.trackId === "custom" && !canUploadRoomSoundtrack) return;
            void (async () => {
              await playSoundscapeLocally(
                state.trackId,
                state.position,
                state.trackUrl,
              );
              const next: RoomSoundtrackState = {
                ...state,
                playing: true,
                updatedAt: Date.now(),
              };
              soundscapeStateRef.current = next;
              await publishSoundtrackPacket({ type: "soundtrack_state", state: next });
            })().catch(() => { });
          }}
          onClose={() => openRightTab(null)}
        />
      )}

      {rightTab === "tasks" && (
        <div className="ms-tasks-panel-scrollbars h-full min-h-0 flex flex-col">
          <div className="px-5 py-4 border-b border-[#D8D0D0] bg-[#F3F1F1] flex items-center justify-between">
            <div
              className="text-black/85 font-inter font-semibold"
            >
              Tasks
            </div>
            <button
              onClick={() => openRightTab(null)}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition bg-[#E6E6E6] hover:bg-[#DCDCDC] text-black/60"
              title="Close"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden p-4">
            <div
              className="h-full min-h-0 overflow-hidden rounded-xl bg-[#F3F1F1] border border-[#D8D0D0]"
            >
              <div className="h-full min-h-0 overflow-y-auto [&>*]:min-h-0">
                <div
                  data-theme="light"
                  style={{ colorScheme: "light" }}
                  className="h-full min-h-0"
                >
                  {session?.id ? (
                    <TasksPanel
                      key={`tasks-${session.id}`}
                      theme="light"
                      sessionId={session.id}
                      oneOnOneMode={isOneOnOneRoom}
                      timerText={remainingTime || "--:--"}
                      pictureInPictureSupported={connected && pipSupported}
                      pictureInPictureOpen={pictureInPictureOpen}
                      onOpenPictureInPicture={() => {
                        togglePictureInPicture().catch((e) => {
                          console.error(
                            "open Picture-in-Picture from tasks failed",
                            e,
                          );
                          alert(
                            String(
                              (e as any)?.message || e || "pip_open_failed",
                            ),
                          );
                        });
                      }}
                      accountabilityWallOpen={mainViewMode === "accountability"}
                      onToggleAccountabilityWall={() => {
                        setMainViewMode((v) =>
                          v === "accountability" ? "video" : "accountability",
                        );
                      }}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
  if (loading) {
    return (
      <div className={`flex h-screen items-center justify-center ${pageBg}`}>
        Loading session...
      </div>
    );
  }

  if (authUserId && entitlementCheckedForUserId !== authUserId) {
    return (
      <div className={`flex h-screen items-center justify-center ${pageBg}`}>
        Checking your access...
      </div>
    );
  }

  // Do not hard-block the room on auth checking.
  // Logged-out users should see the in-room auth modal instead of a redirect/back screen.

  const handleBookFromJoinGate = async () => {
    const sessionId = String(session?.id || "").trim();
    if (!sessionId) return;

    if (!authUserId) {
      setMediaWarning(
        "Sign in in this room first, then you can book this session.",
      );
      return;
    }

    if (joinGateBooked || joinGateBookingBusy) return;

    setJoinGateBookingBusy(true);

    try {
      const { error } = await supabase.from("session_bookings").insert({
        session_id: sessionId,
        user_id: authUserId,
      });

      if (error) {
        const msg = String(error.message || "").toLowerCase();
        if (
          msg.includes("duplicate") ||
          msg.includes("unique") ||
          msg.includes("already")
        ) {
          setJoinGateBooked(true);
        } else {
          throw error;
        }
      } else {
        setJoinGateBooked(true);
      }

      setSession((prev: any) => {
        if (!prev || !authUserId) return prev;

        const existing = Array.isArray(prev.session_bookings)
          ? prev.session_bookings
          : [];
        const alreadyThere = existing.some(
          (b: any) => String(b?.user_id || "") === String(authUserId),
        );
        if (alreadyThere) return prev;

        return {
          ...prev,
          session_bookings: [
            ...existing,
            { session_id: sessionId, user_id: authUserId },
          ],
        };
      });
    } catch (e) {
      console.error("LiveKit join gate booking error:", e);
    } finally {
      setJoinGateBookingBusy(false);
    }
  };

  const handleBookClosedSessionRecommendation = async (
    recommendation: ClosedSessionRecommendation,
  ) => {
    if (closedSessionBookingBusyId) return;

    if (!authUserId) {
      navigate(`/room-livekit/${recommendation.id}`);
      return;
    }

    if (closedSessionBookedIds.has(recommendation.id)) return;

    setClosedSessionBookingBusyId(recommendation.id);

    try {
      const { error } = await supabase.from("session_bookings").insert({
        session_id: recommendation.id,
        user_id: authUserId,
      });

      if (error) {
        const message = String(error.message || "").toLowerCase();
        const alreadyBooked =
          message.includes("duplicate") ||
          message.includes("unique") ||
          message.includes("already");

        if (!alreadyBooked) throw error;
      }

      setClosedSessionBookedIds((current) => {
        const next = new Set(current);
        next.add(recommendation.id);
        return next;
      });
      setClosedSessionRecommendations((current) =>
        current.map((row) =>
          row.id === recommendation.id
            ? {
                ...row,
                isBooked: true,
                bookedCount: Math.min(
                  row.maxParticipants,
                  row.bookedCount + 1,
                ),
              }
            : row,
        ),
      );
    } catch (error) {
      console.error("Closed session recommendation booking failed:", error);
    } finally {
      setClosedSessionBookingBusyId("");
    }
  };

  if (sessionCloseInfo.closed) {
    const endedHostName = String(
      session?.host_profile?.full_name || "Session host",
    );
    const endedHostAvatarUrl = session?.host_profile?.avatar_url || null;
    const showingSameHostSessions = closedSessionRecommendations.some(
      (recommendation) => recommendation.sameHost,
    );
    const closedPanel = isLight
      ? "border-[#D8D0D0] bg-white text-[#1B1B1B]"
      : "border-[#303030] bg-[#242424] text-white";
    const closedInset = isLight
      ? "border-[#DEDADA] bg-[#F5F3F3]"
      : "border-[#343434] bg-[#1D1D1D]";
    const closedMuted = isLight ? "text-black/55" : "text-white/55";

    return (
      <>
        <div
          className={`min-h-[100dvh] w-full overflow-y-auto px-4 py-6 sm:px-6 sm:py-10 ${pageBg}`}
        >
          <div
            className={`mx-auto my-auto w-full max-w-[980px] overflow-hidden rounded-[30px] border shadow-[0_18px_55px_rgba(0,0,0,0.18)] ${closedPanel}`}
          >
            <div
              className={`flex items-center justify-between gap-4 border-b px-5 py-4 sm:px-7 ${
                isLight ? "border-[#D8D0D0]" : "border-[#343434]"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[#81DB86]/15 text-[#81DB86]">
                  <Clock3 size={20} />
                </div>
                <div>
                  <div className="text-[14px] font-bold">Session complete</div>
                  <div className={`mt-0.5 text-[11px] ${closedMuted}`}>
                    Keep the momentum going with another room
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => navigate("/sessions", { replace: true })}
                className={`hidden h-10 items-center gap-2 rounded-full border px-4 text-[12px] font-semibold transition sm:inline-flex ${
                  isLight
                    ? "border-black/10 bg-black/[0.03] hover:bg-black/[0.07]"
                    : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08]"
                }`}
              >
                Browse all sessions <ArrowRight size={14} />
              </button>
            </div>

            <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <main
                className={`p-6 sm:p-8 lg:border-r ${
                  isLight ? "lg:border-[#D8D0D0]" : "lg:border-[#343434]"
                }`}
              >
                <div className="inline-flex items-center gap-2 rounded-full border border-[#81DB86]/25 bg-[#81DB86]/10 px-3 py-1.5 text-[11px] font-semibold text-[#81DB86]">
                  <Check size={13} /> Finished
                </div>

                <h1 className="mt-5 text-[30px] font-bold leading-[1.08] tracking-[-0.04em] sm:text-[38px]">
                  This focus session has ended.
                </h1>

                <p className={`mt-3 max-w-[520px] text-[14px] leading-6 ${closedMuted}`}>
                  The room closed after its final stage, but your next session can
                  start right here. Choose another time below or browse the full
                  schedule.
                </p>

                <div className={`mt-6 rounded-[22px] border p-4 ${closedInset}`}>
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] opacity-50">
                    Just finished
                  </div>
                  <div className="mt-2 text-[18px] font-bold leading-tight">
                    {String(session?.title || "Focus session")}
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      {endedHostAvatarUrl ? (
                        <img
                          src={endedHostAvatarUrl}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#81DB86] text-[13px] font-bold text-black">
                          {endedHostName.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className={`text-[10px] ${closedMuted}`}>Hosted by</div>
                        <div className="truncate text-[12px] font-semibold">
                          {endedHostName}
                        </div>
                      </div>
                    </div>

                    <div className={`shrink-0 text-right text-[11px] ${closedMuted}`}>
                      Ended
                      <div className="mt-0.5 font-semibold">
                        {sessionCloseInfo.endMs
                          ? formatLocalDateTime(sessionCloseInfo.endMs)
                          : "recently"}
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => navigate("/sessions", { replace: true })}
                  className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-[#81DB86] px-5 text-[13px] font-bold text-black transition hover:bg-[#72CF78]"
                >
                  View all sessions <ArrowRight size={15} />
                </button>
              </main>

              <aside className={`p-6 sm:p-8 ${isLight ? "bg-[#F3F1F1]" : "bg-[#202020]"}`}>
                <div>
                  <div className="text-[18px] font-bold tracking-[-0.02em]">
                    {showingSameHostSessions
                      ? `Next with ${endedHostName}`
                      : "Upcoming sessions"}
                  </div>
                  <div className={`mt-1 text-[12px] ${closedMuted}`}>
                    {showingSameHostSessions
                      ? "More upcoming focus time with the same host."
                      : "The nearest available sessions from the community."}
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  {closedSessionRecommendationsLoading ? (
                    [0, 1].map((index) => (
                      <div
                        key={index}
                        className={`h-[154px] animate-pulse rounded-[22px] border ${closedInset}`}
                      />
                    ))
                  ) : closedSessionRecommendations.length ? (
                    closedSessionRecommendations.map((recommendation) => {
                      const isBooked = closedSessionBookedIds.has(recommendation.id);
                      const bookingBusy =
                        closedSessionBookingBusyId === recommendation.id;
                      const isFull =
                        recommendation.bookedCount >= recommendation.maxParticipants;

                      return (
                        <article
                          key={recommendation.id}
                          className={`rounded-[22px] border p-4 transition hover:-translate-y-0.5 hover:shadow-lg ${closedPanel}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="line-clamp-2 text-[15px] font-bold leading-[1.25]">
                                {recommendation.title}
                              </div>
                              <div className={`mt-2 flex items-center gap-2 text-[11px] ${closedMuted}`}>
                                <CalendarClock size={13} />
                                {formatLocalDateTime(recommendation.startMs)}
                              </div>
                            </div>

                            {recommendation.hostAvatarUrl ? (
                              <img
                                src={recommendation.hostAvatarUrl}
                                alt=""
                                className="h-9 w-9 shrink-0 rounded-full object-cover"
                              />
                            ) : (
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#81DB86] text-[12px] font-bold text-black">
                                {recommendation.hostName.slice(0, 1).toUpperCase()}
                              </div>
                            )}
                          </div>

                          <div className={`mt-3 flex items-center justify-between gap-3 text-[11px] ${closedMuted}`}>
                            <span className="truncate">{recommendation.hostName}</span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              <Users size={13} />
                              {recommendation.bookedCount}/{recommendation.maxParticipants}
                            </span>
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => navigate(`/room-livekit/${recommendation.id}`)}
                              className="h-10 rounded-xl bg-[#81DB86] px-3 text-[12px] font-bold text-black transition hover:bg-[#72CF78]"
                            >
                              Join
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleBookClosedSessionRecommendation(recommendation)
                              }
                              disabled={bookingBusy || isBooked || isFull}
                              className={`flex h-10 items-center justify-center gap-1.5 rounded-xl border px-3 text-[12px] font-semibold transition disabled:cursor-default ${
                                isBooked
                                  ? "border-[#81DB86]/40 bg-[#81DB86]/10 text-[#81DB86]"
                                  : isLight
                                    ? "border-black/10 bg-black/[0.03] hover:bg-black/[0.07] disabled:opacity-45"
                                    : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-45"
                              }`}
                            >
                              {isBooked ? <Check size={14} /> : <CalendarClock size={14} />}
                              {isBooked
                                ? "Booked"
                                : bookingBusy
                                  ? "Booking…"
                                  : isFull
                                    ? "Full"
                                    : "Book"}
                            </button>
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <div className={`rounded-[22px] border p-5 ${closedInset}`}>
                      <div className="text-[14px] font-semibold">
                        No upcoming sessions yet
                      </div>
                      <div className={`mt-1 text-[12px] leading-5 ${closedMuted}`}>
                        The schedule changes throughout the day. Browse all sessions
                        to find an open room.
                      </div>
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </div>
        </div>

        {pipPortal}
      </>
    );
  }

  if (paywallRuntimeBlocked) {
    return (
      <>
        <div className={`flex h-screen items-center justify-center ${pageBg}`}>
          <div className="w-full max-w-[520px] rounded-[28px] border border-[#CFCFCF] bg-[#F3F3F3] p-8 shadow-sm">
            <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-[#1B1B1B]">
              Upgrade to continue
            </h1>

            <p className="mt-3 text-[15px] leading-7 text-black/65">
              You’ve used your 15 free sessions. Upgrade to Pro to keep joining
              sessions without limits.
            </p>

            <div className="mt-6">
              <button
                type="button"
                onClick={() => navigate("/pricing")}
                className="inline-flex rounded-2xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
              >
                Upgrade plan
              </button>
            </div>
          </div>
        </div>

        <PaywallModal
          open={paywallModalOpen}
          onClose={() => setPaywallModalOpen(false)}
          title="Upgrade to join this session"
          description="You’ve used your 15 free sessions. Upgrade to Pro to keep using MySession without limits."
        />
      </>
    );
  }

  if (joinBlocked && !!authUserId) {
    return (
      <JoinGateModal
        open={true}
        theme={theme}
        sessionTitle={String(session?.title || "Session")}
        hostName={String(session?.host_profile?.full_name || "Session host")}
        hostAvatarUrl={session?.host_profile?.avatar_url || null}
        bookedCount={
          Array.isArray(session?.session_bookings)
            ? session.session_bookings.length
            : 0
        }
        maxParticipants={maxParticipants}
        joinEarlyWindowMinutes={JOIN_EARLY_WINDOW_MINUTES}
        startMs={joinGateInfo.startMs}
        allowMs={joinGateInfo.allowMs}
        msUntilAllowed={joinGateInfo.msUntilAllowed}
        otherHostSessions={joinGateOtherSessions}
        otherHostSessionsLoading={joinGateOtherSessionsLoading}
        onOpenOtherSession={(otherSessionId) =>
          navigate(`/room-livekit/${otherSessionId}`)
        }
        bookingCtaLabel="Book my place"
        bookingBusy={joinGateBookingBusy}
        bookingDone={joinGateBooked}
        onBook={handleBookFromJoinGate}
        onBack={() => navigate("/sessions", { replace: true })}
        onReload={() => window.location.reload()}
      />
    );
  }

  if (!session) {
    const showAuth = !authUserId && authGateStatus !== "authed";

    return (
      <>
        <div
          className={`min-h-screen w-full flex items-center justify-center px-4 ${pageBg}`}
        >
          <div
            className={`w-full max-w-[560px] rounded-[28px] border p-6 text-center shadow-2xl ${isLight
              ? "border-[#CFCFCF] bg-[#F3F3F3] text-black"
              : "border-[#2B2B2B] bg-[#242424] text-white"
              }`}
          >
            <div className="text-[22px] font-bold">
              {showAuth ? "Sign in to open this session" : "Session not found"}
            </div>

            <div
              className={`mt-3 text-[14px] leading-6 ${isLight ? "text-black/60" : "text-white/60"}`}
            >
              {showAuth
                ? "This room link is ready. Sign in here and MySession will bring you back to the room automatically."
                : sessionLoadError ||
                "We could not load this session. It may have been deleted or the link may be wrong."}
            </div>

            {!showAuth ? (
              <button
                type="button"
                onClick={() => navigate("/sessions", { replace: true })}
                className={`mt-6 h-11 rounded-full px-5 text-[14px] font-semibold transition ${isLight
                  ? "bg-black text-white hover:bg-black/85"
                  : "bg-[#F3F3F3] text-black hover:bg-[#F1F1F1]/90"
                  }`}
              >
                Back to sessions
              </button>
            ) : null}
          </div>
        </div>

        <ActiveBanModal
          open={!!activeBan}
          ban={activeBan}
          onBackToSessions={() => navigate("/sessions", { replace: true })}
        />

        <RoomAuthModal
          open={showAuth}
          theme={theme}
          sessionTitle="this session"
          redirectPath={`${location.pathname}${location.search}`}
          onEmailAuthSuccess={refreshRoomAuth}
        />

        {pipPortal}
      </>
    );
  }

  const onJoinGate = () => {
    captureProductEvent("prejoin_opened", { action: "join_confirmed" });
    if (sessionCloseInfo.closed) {
      setPrejoinOpen(false);
      setJoinRequested(false);
      setMediaWarning("This session is no longer accessible.");
      return;
    }

    if (activeBan) {
      setPrejoinOpen(false);
      setJoinRequested(false);
      setMediaWarning(
        "You are banned from MySession and cannot join this room.",
      );
      return;
    }

    if (!authUserId) {
      setPrejoinOpen(false);
      setJoinRequested(false);
      setMediaWarning("Sign in in this room first, then you can join.");
      return;
    }

    joinFlowStartedRef.current = true;
    connectingFromPrejoinRef.current = true;
    if (paywallRuntimeBlocked) {
      setPaywallModalOpen(true);
      joinFlowStartedRef.current = false;
      connectingFromPrejoinRef.current = false;
      return;
    }
    if (shouldDisableBackgroundFx && videoFxMode !== "off") {
      setVideoFxMode("off");
      setFxStatusText("FX disabled automatically on mobile/tablet device");
    }
    const pj = prejoinRef.current;
    const nm =
      (pj.displayName || displayName || userName || "User").trim() || "User";

    const baseUser = safeIdentity(
      (authUserId && looksLikeUuid(authUserId)
        ? authUserId
        : authUserId || nm) as any,
    );

    if (session?.id && !tabPresenceAcquiredRef.current) {
      const g = tryAcquireTabGate(session.id, baseUser);
      if (!g.ok) {
        const msg = `Too many tabs open for this room (${g.count}/${g.max}). Close another tab and try again.`;
        setTokenError(msg);
        try {
          alert(msg);
        } catch { }
        setPrejoinOpen(true);
        setJoinRequested(false);
        return;
      }
    }

    setDisplayName(nm);
    setSelectedAudioOutputId(pj.audioOutputId || "default");
    setSelectedAudioInputId(pj.audioInputId || "");
    setSelectedVideoInputId(pj.videoInputId || "");
    setEchoCancellationEnabled(!!pj.echoCancellation);
    setNoiseSuppressionEnabled(!!pj.noiseSuppression);
    setAutoGainControlEnabled(!!pj.autoGainControl);

    setPrejoinOpen(false);
    setTokenError("");
    setClientError("");
    setDeviceError("");

    pendingRoomAudioUnlockRef.current = true;

    setJoinRequested(true);
  };

  return (
    <>
      <style>{`
        @keyframes msReactionFloatUp {
          0%   { opacity: 0; transform: translate3d(0, 14px, 0) scale(0.92); }
          12%  { opacity: 1; transform: translate3d(0, 0px, 0) scale(1); }
          78%  { opacity: 1; transform: translate3d(0, -30px, 0) scale(1); }
          100% { opacity: 0; transform: translate3d(0, -60px, 0) scale(1); }
        }
        .ms-reaction-float {
          animation: msReactionFloatUp 2.15s ease-out forwards;
          will-change: transform, opacity;
        }
        @media (prefers-reduced-motion: reduce) {
          .ms-reaction-float { animation: none; }
        }

        .ms-room-page,
        .ms-room-page *,
        .ms-video-stage,
        .ms-video-stage * {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .ms-room-page::-webkit-scrollbar,
        .ms-room-page *::-webkit-scrollbar,
        .ms-video-stage::-webkit-scrollbar,
        .ms-video-stage *::-webkit-scrollbar {
          width: 0 !important;
          height: 0 !important;
          display: none !important;
        }


        .ms-room-page .ms-chat-panel-scrollbars .custom-scrollbar,
        .ms-room-page .ms-tasks-panel-scrollbars .custom-scrollbar,
        .ms-room-page .ms-room-settings-scrollbar,
        .ms-room-page .ms-voice-ui-scrollbar {
          scrollbar-width: thin !important;
          scrollbar-color: #B8C0BB transparent !important;
          -ms-overflow-style: auto !important;
        }
        .ms-room-page .ms-chat-panel-scrollbars .custom-scrollbar::-webkit-scrollbar,
        .ms-room-page .ms-tasks-panel-scrollbars .custom-scrollbar::-webkit-scrollbar,
        .ms-room-page .ms-room-settings-scrollbar::-webkit-scrollbar,
        .ms-room-page .ms-voice-ui-scrollbar::-webkit-scrollbar {
          width: 6px !important;
          height: 6px !important;
          display: block !important;
        }
        .ms-room-page .ms-chat-panel-scrollbars .custom-scrollbar::-webkit-scrollbar-track,
        .ms-room-page .ms-tasks-panel-scrollbars .custom-scrollbar::-webkit-scrollbar-track,
        .ms-room-page .ms-room-settings-scrollbar::-webkit-scrollbar-track,
        .ms-room-page .ms-voice-ui-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .ms-room-page .ms-chat-panel-scrollbars .custom-scrollbar::-webkit-scrollbar-thumb,
        .ms-room-page .ms-tasks-panel-scrollbars .custom-scrollbar::-webkit-scrollbar-thumb,
        .ms-room-page .ms-room-settings-scrollbar::-webkit-scrollbar-thumb,
        .ms-room-page .ms-voice-ui-scrollbar::-webkit-scrollbar-thumb {
          min-height: 32px;
          border-radius: 999px;
          background: #B8C0BB;
        }
        .ms-room-page .ms-chat-panel-scrollbars .custom-scrollbar::-webkit-scrollbar-thumb:hover,
        .ms-room-page .ms-tasks-panel-scrollbars .custom-scrollbar::-webkit-scrollbar-thumb:hover,
        .ms-room-page .ms-room-settings-scrollbar::-webkit-scrollbar-thumb:hover,
        .ms-room-page .ms-voice-ui-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #8F9993;
        }

        @media (max-width: 1023px) {
          .ms-desktop-only-fx {
            display: none !important;
          }
        }
      `}</style>

      <RoomAuthModal
        open={!authUserId && authGateStatus !== "authed"}
        theme={theme}
        sessionTitle={String(session?.title || "Session")}
        redirectPath={`${location.pathname}${location.search}`}
        onEmailAuthSuccess={refreshRoomAuth}
      />

      <PreJoinModal
        open={prejoinOpen && !!authUserId && !activeBan}
        theme={theme}
        devices={devices}
        value={prejoin}
        onChange={(next) => {
          setPrejoin(next);
          prejoinRef.current = next;
          setEchoCancellationEnabled(next.echoCancellation);
          setNoiseSuppressionEnabled(next.noiseSuppression);
          setAutoGainControlEnabled(next.autoGainControl);
          saveAudioProcessingPreferences({
            echoCancellation: next.echoCancellation,
            noiseSuppression: next.noiseSuppression,
            autoGainControl: next.autoGainControl,
          });
        }}
        deviceError={deviceError}
        hideBackgroundFx={shouldDisableBackgroundFx}
        onRefreshDevices={() => loadBrowserDevices().catch(() => { })}
        onCancel={() => {
          // Cancel is an explicit route exit. Clear join state synchronously and
          // use a document navigation so async media cleanup cannot leave the
          // room route mounted without its modal (the previous white screen).
          joinFlowStartedRef.current = false;
          connectingFromPrejoinRef.current = false;
          setJoinRequested(false);
          setPrejoinOpen(false);
          releaseTabPresence();
          void cleanupPrejoinPreparedVideoTrack().catch(() => { });
          window.location.replace("/sessions");
        }}
        onJoin={onJoinGate}
        onPrepareAudioGesture={() => {
          pendingRoomAudioUnlockRef.current = true;
        }}
        onTestSpeaker={() => {
          try {
            const a = new Audio("/sounds/joined.mp3");
            a.volume = 0.9;
            a.play().catch(() => { });
          } catch { }
        }}
        previewVideoTrack={prejoinPreparedVideoTrackRef.current}
        previewVersion={prejoinPreviewVersion}
        videoFxMode={videoFxMode}
        blurStrength={blurStrength}
        bgImageUrl={bgImageUrl}
        fxApplying={fxApplying}
        fxError={fxError}
        fxStatusText={fxStatusText}
        fxBgPresets={FX_BG_PRESETS}
        onApplyVideoFx={applyPrejoinVideoFx}
        onBlurStrengthChange={setBlurStrength}
        onSetBgImageUrl={setBgImageUrl}
        onUploadBg={(file: File) => {
          try {
            if (uploadedBgUrlRef.current) {
              URL.revokeObjectURL(uploadedBgUrlRef.current);
              uploadedBgUrlRef.current = null;
            }
            const url = URL.createObjectURL(file);
            uploadedBgUrlRef.current = url;
            setBgImageUrl(url);
            return url;
          } catch (e) {
            console.error("upload bg failed", e);
            setFxError("Failed to load selected image");
          }
        }}
        onResetBg={() => {
          if (uploadedBgUrlRef.current) {
            try {
              URL.revokeObjectURL(uploadedBgUrlRef.current);
            } catch { }
            uploadedBgUrlRef.current = null;
          }
          setBgImageUrl(DEFAULT_BG_DATA_URL);
        }}
      />

      {aiHostedEnabled && session?.id && authUserId ? (
        <AIHostedRoomController
          sessionId={session.id}
          currentUserId={authUserId}
          currentUserName={displayName || userName || "there"}
          tiles={layoutTilesForRender}
          currentStage={currentStageForAiHost}
          chatTable={CHAT_MSG_TABLE}
          theme={theme}
          isOpen={aiHostInputOpen}
          onClose={() => setAiHostInputOpen(false)}
          localMicMuted={!micOn}
          onUnmuteLocalMic={unmuteMicForAiCheckin}
          onMuteLocalMic={muteMicAfterAiCheckin}
        />
      ) : null}

      <div className={`ms-room-page h-[100dvh] overflow-hidden ${pageBg}`}>
        <input
          ref={voiceFxUploadInputRef}
          type="file"
          accept="image/*"
          className="fixed h-px w-px opacity-0 pointer-events-none"
          tabIndex={-1}
          aria-hidden="true"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (!file) {
              customBgUploadSlotRef.current = null;
              return;
            }
            setVoiceFxUploadRequested(false);
            const customSlotId = customBgUploadSlotRef.current;
            customBgUploadSlotRef.current = null;
            if (customSlotId) {
              if (file.size > CUSTOM_BACKGROUND_MAX_FILE_BYTES) {
                setFxError("Custom backgrounds must be 8 MB or smaller");
                return;
              }
              try {
                const dataUrl = await readImageFileAsDataUrl(file);
                setCustomBackgroundSlots((current) =>
                  current.map((slot) =>
                    slot.id === customSlotId ? { ...slot, dataUrl } : slot,
                  ),
                );
                setBgImageUrl(dataUrl);
                await applyVideoFx("bg", dataUrl);
                setVoiceUiLastCommand("Custom background saved and applied");
              } catch (error) {
                console.error("custom background upload failed", error);
                setFxError("Failed to save selected background");
              }
              return;
            }
            try {
              if (uploadedBgUrlRef.current) URL.revokeObjectURL(uploadedBgUrlRef.current);
              const url = URL.createObjectURL(file);
              uploadedBgUrlRef.current = url;
              setBgImageUrl(url);
              await applyVideoFx("bg", url);
              setVoiceUiLastCommand("Uploaded background applied");
              closeVoiceFxPopup();
            } catch (error) {
              console.error("voice background upload failed", error);
              setFxError("Failed to load selected image");
            }
          }}
        />
        {voiceFxPopupMounted ? (
          <div
            className={`fixed inset-0 z-[120] flex items-center justify-center p-4 transition-opacity duration-200 ease-out ${voiceFxPopupVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
            role="dialog"
            aria-modal="true"
            aria-label="Choose a video background"
          >
            <button
              type="button"
              className={`absolute inset-0 cursor-default transition-colors duration-200 ${isLight ? "bg-black/35" : "bg-black/65"}`}
              aria-label="Close background chooser"
              onClick={closeVoiceFxPopup}
            />
            <div
              className={`relative max-h-[min(760px,calc(100dvh-2rem))] w-full max-w-[680px] overflow-y-auto rounded-3xl border p-4 shadow-2xl transition-[opacity,transform] duration-200 ease-out ${voiceFxPopupVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-[0.97] opacity-0"} ${isLight ? "border-black/10 bg-[#F8F8F8] text-black" : "border-white/10 bg-[#1B1B1B] text-white"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[16px] font-bold">Change background</div>
                  <div className={`mt-1 text-[11px] ${isLight ? "text-black/55" : "text-white/55"}`}>
                    Choose a preset, upload an image, or apply blur.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeVoiceFxPopup}
                  className={`flex h-8 w-8 items-center justify-center rounded-xl ${isLight ? "bg-black/5 hover:bg-black/10" : "bg-white/5 hover:bg-white/10"}`}
                  aria-label="Close background chooser"
                >
                  ✕
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {FX_BG_PRESETS.map((preset) => {
                  const selected = videoFxMode === "bg" && bgImageUrl === preset.url;
                  return (
                    <button
                      type="button"
                      key={preset.id}
                      disabled={fxApplying}
                      onClick={async () => {
                        setBgImageUrl(preset.url);
                        await applyVideoFx("bg", preset.url);
                        setVoiceUiLastCommand(`${preset.label} background applied`);
                      }}
                      className={`overflow-hidden rounded-2xl border text-left transition hover:-translate-y-0.5 disabled:opacity-50 ${selected ? "border-[#81DB86] ring-2 ring-[#81DB86]/30" : isLight ? "border-black/10 bg-white" : "border-white/10 bg-white/[0.04]"}`}
                    >
                      <img src={preset.url} alt="" className="aspect-video w-full object-cover" />
                      <span className="block px-2 py-2 text-[11px] font-semibold">{preset.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-[12px] font-semibold">My backgrounds</div>
                    <div className={`mt-0.5 text-[10px] ${isLight ? "text-black/50" : "text-white/50"}`}>
                      Three saved slots with fixed English voice commands.
                    </div>
                  </div>
                  <span className={`text-[9px] ${isLight ? "text-black/40" : "text-white/40"}`}>8 MB each</span>
                </div>

                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {customBackgroundSlots.map((slot) => {
                    const selected =
                      !!slot.dataUrl && videoFxMode === "bg" && bgImageUrl === slot.dataUrl;
                    return (
                      <div
                        key={slot.id}
                        className={`overflow-hidden rounded-2xl border transition ${selected ? "border-[#81DB86] ring-2 ring-[#81DB86]/25" : isLight ? "border-black/10 bg-white" : "border-white/10 bg-white/[0.04]"}`}
                      >
                        <button
                          type="button"
                          disabled={!slot.dataUrl || fxApplying}
                          onClick={async () => {
                            if (!slot.dataUrl) return;
                            setBgImageUrl(slot.dataUrl);
                            await applyVideoFx("bg", slot.dataUrl);
                            setVoiceUiLastCommand(`${slot.label} applied`);
                          }}
                          className={`relative block aspect-video w-full overflow-hidden text-left transition disabled:cursor-default ${slot.dataUrl ? "hover:brightness-105" : isLight ? "bg-black/[0.04]" : "bg-white/[0.04]"}`}
                        >
                          {slot.dataUrl ? (
                            <img src={slot.dataUrl} alt={`${slot.label} preview`} className="h-full w-full object-cover" />
                          ) : (
                            <span className={`absolute inset-0 flex items-center justify-center text-[10px] ${isLight ? "text-black/35" : "text-white/35"}`}>
                              Empty slot
                            </span>
                          )}
                          {selected ? (
                            <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#81DB86] text-[11px] text-black">✓</span>
                          ) : null}
                        </button>

                        <div className="p-2">
                          <div
                            className={`flex h-8 w-full items-center rounded-lg px-2 text-[10px] font-semibold ${isLight ? "bg-black/[0.04] text-black/65" : "bg-white/[0.06] text-white/65"}`}
                            title="Either command applies this background"
                          >
                            {slot.command} / bg {slot.command}
                          </div>
                          <div className="mt-2 flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                customBgUploadSlotRef.current = slot.id;
                                setVoiceFxUploadRequested(false);
                                try {
                                  voiceFxUploadInputRef.current?.showPicker();
                                } catch {
                                  voiceFxUploadInputRef.current?.click();
                                }
                              }}
                              className={`h-7 flex-1 rounded-lg text-[10px] font-semibold transition ${isLight ? "bg-[#2F2F2F] text-white hover:bg-black" : "bg-white text-black hover:bg-white/85"}`}
                            >
                              {slot.dataUrl ? "Replace" : "Upload"}
                            </button>
                            {slot.dataUrl ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setCustomBackgroundSlots((current) =>
                                    current.map((item) =>
                                      item.id === slot.id ? { ...item, dataUrl: "" } : item,
                                    ),
                                  );
                                  if (bgImageUrl === slot.dataUrl) {
                                    setBgImageUrl(DEFAULT_BG_DATA_URL);
                                    void applyVideoFx("bg", DEFAULT_BG_DATA_URL);
                                  }
                                }}
                                className={`h-7 rounded-lg px-2 text-[10px] transition ${isLight ? "bg-black/[0.05] hover:bg-black/10" : "bg-white/[0.07] hover:bg-white/10"}`}
                                aria-label={`Clear ${slot.label}`}
                              >
                                Clear
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={fxApplying}
                  onClick={async () => {
                    await applyVideoFx("blur");
                    setVoiceUiLastCommand("Blur applied");
                    closeVoiceFxPopup();
                  }}
                  className={`h-10 rounded-xl text-[12px] font-semibold transition disabled:opacity-50 ${videoFxMode === "blur" ? "bg-[#81DB86] text-black" : isLight ? "bg-black text-white hover:bg-black/80" : "bg-white text-black hover:bg-white/85"}`}
                >
                  {fxApplying ? "Applying…" : "Apply Blur"}
                </button>
                <button
                  ref={voiceFxUploadButtonRef}
                  type="button"
                  onClick={() => {
                    setVoiceFxUploadRequested(false);
                    try {
                      voiceFxUploadInputRef.current?.showPicker();
                    } catch {
                      voiceFxUploadInputRef.current?.click();
                    }
                  }}
                  className={`flex h-10 cursor-pointer items-center justify-center rounded-xl text-[12px] font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#81DB86]/40 ${voiceFxUploadRequested ? "animate-pulse bg-[#81DB86] text-black ring-4 ring-[#81DB86]/30" : isLight ? "border border-black/10 bg-white hover:bg-black/5" : "border border-white/10 bg-white/[0.05] hover:bg-white/10"}`}
                >
                  Upload Image
                </button>
              </div>

              {voiceFxUploadRequested ? (
                <div className={`mt-2 rounded-xl px-3 py-2 text-center text-[11px] font-medium ${isLight ? "bg-amber-50 text-amber-900" : "bg-amber-400/10 text-amber-100"}`}>
                  Your browser requires one click to open files. Press the highlighted Upload Image button.
                </div>
              ) : null}

              {videoFxMode === "blur" ? (
                <div className={`mt-3 rounded-2xl border p-3 ${isLight ? "border-black/10 bg-white" : "border-white/10 bg-white/[0.04]"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[12px] font-semibold">Blur strength</div>
                      <div className={`mt-0.5 text-[10px] ${isLight ? "text-black/50" : "text-white/50"}`}>
                        Say “Blur strength 18” or choose it here.
                      </div>
                    </div>
                    <span className={`min-w-10 rounded-lg px-2 py-1 text-center text-[12px] font-bold ${isLight ? "bg-black/5" : "bg-white/10"}`}>
                      {blurStrength}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={4}
                    max={30}
                    step={1}
                    value={blurStrength}
                    aria-label="Blur strength"
                    className="mt-3 w-full accent-[#81DB86]"
                    onChange={(event) => setBlurStrength(Number(event.target.value))}
                    onPointerUp={(event) => {
                      const value = Number((event.currentTarget as HTMLInputElement).value);
                      void applyVideoFx("blur", undefined, value);
                    }}
                    onKeyUp={(event) => {
                      const value = Number(event.currentTarget.value);
                      void applyVideoFx("blur", undefined, value);
                    }}
                  />
                  <div className={`mt-1 flex justify-between text-[9px] ${isLight ? "text-black/40" : "text-white/40"}`}>
                    <span>Soft · 4</span>
                    <span>Strong · 30</span>
                  </div>
                </div>
              ) : null}

              <div className={`mt-3 text-center text-[10px] ${isLight ? "text-black/45" : "text-white/45"}`}>
                Voice: use a preset command, “Apply Blur”, or the phrase assigned to a custom slot
              </div>
            </div>
          </div>
        ) : null}
        {connected && voiceUiEnabled ? (
          <>
            <button
              type="button"
              onClick={() => setVoiceUiHelpOpen((open) => !open)}
              className="pointer-events-auto fixed left-4 top-[112px] z-[92] flex max-w-[min(520px,calc(100vw-2rem))] cursor-pointer items-center gap-2 rounded-full border border-[#3A3A3A] bg-[#242424]/95 px-3 py-1.5 text-[11px] font-medium text-white/75 shadow-lg backdrop-blur transition duration-200 hover:scale-[1.01] hover:border-[#4A4A4A] hover:bg-[#2B2B2B] hover:text-white"
              aria-live="polite"
              aria-expanded={voiceUiHelpOpen}
              aria-haspopup="dialog"
              aria-label="Show available room voice commands"
              title="Show available voice commands"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${voiceUiStatusDot}`} />
              <span className="truncate">
                {voiceUiStatusLabel}
                {voiceUiLastCommand ? ` · ${voiceUiLastCommand}` : ""}
                {!voiceUiLastCommand && voiceUiLastHeard
                  ? ` · Heard: ${voiceUiLastHeard}`
                  : ""}
              </span>
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={`shrink-0 opacity-60 transition-transform duration-200 ease-out ${voiceUiHelpOpen ? "rotate-180" : "rotate-0"}`}
              />
            </button>

            {voiceUiHelpOpen ? (
              <>
                <button
                  type="button"
                  aria-label="Close voice commands"
                  className="fixed inset-0 z-[90] cursor-default bg-transparent"
                  onClick={() => setVoiceUiHelpOpen(false)}
                />
                <div
                  role="dialog"
                  aria-modal="false"
                  aria-label="Available voice commands"
                  className={`ms-voice-ui-scrollbar custom-scrollbar fixed left-4 top-[152px] z-[91] max-h-[calc(100dvh-172px)] w-[min(520px,calc(100vw-2rem))] overflow-y-auto rounded-2xl border p-3 shadow-2xl ${isLight
                    ? "border-black/10 bg-[#F8F8F8] text-black"
                    : "border-white/10 bg-[#1B1B1B] text-white"
                    }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[14px] font-bold">Voice commands</div>
                      <div className={`mt-1 text-[11px] ${isLight ? "text-black/55" : "text-white/55"}`}>
                        {voiceUiMode === "hotkey" ? `Press ${voiceUiHotkey}, then say a command.` : "Say a short English command, then pause."}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setVoiceUiHelpOpen(false)}
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[14px] ${isLight ? "bg-black/5 hover:bg-black/10" : "bg-white/5 hover:bg-white/10"}`}
                      aria-label="Close voice commands"
                    >
                      ✕
                    </button>
                  </div>

                  <div className={`mt-3 flex items-center justify-between gap-3 rounded-2xl border px-3 py-2 ${isLight ? "border-black/10 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
                    <div className="min-w-0 text-[11px]">
                      <div className="flex items-center gap-2 font-semibold">
                        <span className={`h-2 w-2 rounded-full ${voiceUiStatusDot}`} />
                        {voiceUiStatusLabel}
                      </div>
                      {voiceUiLastHeard ? (
                        <div className={`mt-1 truncate ${isLight ? "text-black/50" : "text-white/50"}`}>
                          Last heard: {voiceUiLastHeard}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (!voiceUiEnabled) {
                          setVoiceUiMode("always");
                        } else {
                          window.dispatchEvent(new Event("mysession:voice-ui-restart"));
                        }
                      }}
                      className={`h-8 shrink-0 rounded-xl px-3 text-[11px] font-semibold ${isLight ? "bg-black text-white hover:bg-black/80" : "bg-white text-black hover:bg-white/85"}`}
                    >
                      {voiceUiEnabled ? "Restart listener" : "Enable listener"}
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {VOICE_UI_COMMAND_GROUPS.map((group) => (
                      <section key={group.title}>
                        <div className={`text-[10px] font-bold uppercase tracking-[0.07em] ${isLight ? "text-black/45" : "text-white/45"}`}>
                          {group.title}
                        </div>
                        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                          {VOICE_UI_COMMAND_DEFINITIONS
                            .filter((definition) => definition.group === group.id)
                            .map((definition) => (
                              <div
                                key={definition.command}
                                className={`rounded-xl border px-2 py-1.5 ${isLight ? "border-black/[0.08] bg-white" : "border-white/[0.08] bg-white/[0.03]"}`}
                              >
                                <div className="text-[10px] font-semibold leading-4">{getVoiceUiCommandHint(definition)}</div>
                              </div>
                            ))}
                        </div>
                      </section>
                    ))}
                  </div>

                  <div className={`mt-4 rounded-2xl px-3 py-2 text-[10px] leading-4 ${isLight ? "bg-amber-50 text-amber-900/70" : "bg-amber-400/10 text-amber-100/65"}`}>
                    Common alternatives such as video/camera, mic/sound, show/open, hide/close and turn on/off are accepted. “Leave room” exits immediately. Participant moderation commands open the matching management menu so you can confirm the action.
                  </div>
                </div>
              </>
            ) : null}
          </>
        ) : null}
        <div className="h-full w-full px-2 sm:px-3 pt-2 pb-[calc(80px+env(safe-area-inset-bottom))] sm:pb-[calc(90px+env(safe-area-inset-bottom))] flex flex-col gap-2 min-h-0">
          <RoomTopBar
            theme={theme}
            sessionTitle={String(session?.title || "Session")}
            canEditTimeline={canEditRoomTimeline}
            onEditTimeline={canEditRoomTimeline ? openTimelineEditor : undefined}
            participantsCount={participantsCount}
            maxParticipants={maxParticipants}
            isSilentRoom={isSilentRoom}
            stages={stages as any}
            stagebarStartTime={stagebarStartTime}
            stagebarCycleSeconds={stagebarCycleSeconds}
            remainingTime={remainingTime}
            currentStage={(stages[currentStage] as any) || null}
            hostProfile={session?.host_profile || null}
            isInfiniteRoom={isInfiniteRoom}
            activeRoomHostProfile={activeOperationalHostProfile}
            isCurrentUserActiveRoomHost={
              isTemporaryRoomHost && !sessionOwnerIsPresent
            }
            canStepInAsHost={
              connected &&
              isInfiniteRoom &&
              !!authUserId &&
              !sessionOwnerIsPresent &&
              !hasValidActiveRoomHostLease
            }
            activeRoomHostBusy={activeRoomHostBusy}
            activeRoomHostError={activeRoomHostError}
            onStepInAsHost={claimActiveRoomHost}
            onStepDownAsHost={releaseActiveRoomHost}
            onHoverStage={setHoveredStage as any}
            onToggleTheme={() =>
              setTheme((t) => (t === "dark" ? "light" : "dark"))
            }
            onOpenHostProfile={() =>
              setSelectedUser((session?.host_profile as any) || null)
            }
          />

          <div
            className="relative grid grid-rows-1 gap-2 sm:gap-3 flex-1 min-h-0 h-full"
            style={{
              gridTemplateColumns: isLgUp
                ? roomGridTemplateColumns
                : "minmax(0, 1fr)",
            }}
          >
            <div
              ref={(el) => {
                videoWrapRef.current = el;
                videoSizerRef(el);
              }}
              className={`ms-video-stage relative rounded-2xl overflow-hidden min-h-0 h-full ${isLight
                ? "bg-[#F3F1F1] border border-[#D8D0D0]"
                : "bg-[#1B1B1B] border border-[#252525]"
                }`}
            >
              {pipOpen && pipMode === "gallery" ? (
                <div
                  className={`flex h-full w-full items-center justify-center px-6 text-center ${
                    isLight ? "text-black/50" : "text-white/50"
                  }`}
                >
                  <div>
                    <div className="text-[14px] font-semibold">Video is playing in Picture-in-Picture</div>
                    <div className="mt-1 text-[12px]">Close Picture-in-Picture to restore the room gallery here.</div>
                  </div>
                </div>
              ) : (
                videoContent
              )}

              {mobileMediaRestoreOpen && (
                <div className="absolute inset-0 z-[55] flex items-center justify-center p-4">
                  <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />

                  {frozenLocalVideoFrame ? (
                    <img
                      src={frozenLocalVideoFrame}
                      alt="Frozen local video preview"
                      className="absolute inset-0 h-full w-full object-cover opacity-70 blur-[1px] scale-[1.02]"
                      draggable={false}
                    />
                  ) : null}

                  <div
                    className={[
                      "relative w-full max-w-[420px] rounded-[28px] border px-5 py-5 text-center shadow-2xl",
                      isLight
                        ? "border-[#CFCFCF] bg-[#F1F1F1]/95 text-black"
                        : "border-[#2B2B2B] bg-[#1B1B1B] text-white",
                    ].join(" ")}
                  >
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#81DB86]/15 text-[24px]">
                      🟢
                    </div>

                    <div className="mt-3 text-[20px] font-bold leading-tight">
                      {mobileRestoreMode === "restoring"
                        ? "Restoring your connection…"
                        : "Rejoin the room"}
                    </div>

                    <div
                      className={`mt-2 text-[13px] leading-5 ${isLight ? "text-black/60" : "text-white/65"}`}
                    >
                      {mobileRestoreMode === "restoring"
                        ? "Your browser or network paused the room. Please wait a few seconds while MySession reconnects."
                        : "The room connection was interrupted. Rejoin to continue with your camera and microphone."}
                    </div>

                    {frozenLocalVideoFrame ? (
                      <div
                        className={`mt-3 text-[11px] ${isLight ? "text-black/55" : "text-white/55"}`}
                      >
                        Showing your last video frame while media restores.
                      </div>
                    ) : null}

                    {mobileRestoreMode === "needs_action" ? (
                      <button
                        type="button"
                        disabled={mobileMediaRestoreBusy}
                        onClick={() => void restoreMobileMediaFromBackground(true)}
                        className={[
                          "mt-4 h-11 w-full rounded-2xl text-[14px] font-semibold transition disabled:opacity-60",
                          isLight
                            ? "bg-black text-white hover:bg-black/85"
                            : "bg-[#F3F3F3] text-black hover:bg-[#F1F1F1]/90",
                        ].join(" ")}
                      >
                        {mobileMediaRestoreBusy ? "Rejoining…" : "Rejoin room"}
                      </button>
                    ) : null}

                    <button
                      type="button"
                      disabled={mobileMediaRestoreBusy}
                      onClick={() => {
                        setMobileMediaRestoreOpen(false);
                        returningFromBackgroundRef.current = false;
                        pageHiddenAtRef.current = null;
                        scheduleRebuildTiles();
                      }}
                      className={`mt-2 h-9 w-full rounded-2xl text-[12px] font-semibold transition disabled:opacity-60 ${isLight
                        ? "border border-[#CFCFCF] bg-black/[0.03] text-black/65 hover:bg-black/[0.06]"
                        : "border border-[#2B2B2B] bg-[#252525] text-white/70 hover:bg-[#424242]"
                        }`}
                    >
                      I can see/hear everything
                    </button>

                    <button
                      type="button"
                      disabled={mobileMediaRestoreBusy}
                      onClick={() => window.location.reload()}
                      className={`mt-2 h-9 w-full rounded-2xl text-[12px] font-semibold transition disabled:opacity-60 ${isLight
                        ? "text-black/65 hover:bg-black/[0.05]"
                        : "text-white/65 hover:bg-white/[0.06]"
                        }`}
                    >
                      Refresh page
                    </button>
                    {roomDebugEnabled ? (
                      <button
                        type="button"
                        disabled={mobileMediaRestoreBusy}
                        onClick={() => {
                          void copyRoomLifecycleDiagnostics()
                            .then(() => setMediaWarning("Diagnostics copied."))
                            .catch(() =>
                              setMediaWarning("Could not copy diagnostics."),
                            );
                        }}
                        className={`mt-2 h-9 w-full rounded-2xl text-[12px] font-semibold transition disabled:opacity-60 ${isLight
                          ? "bg-black/[0.03] text-black/65 hover:bg-black/[0.06]"
                          : "bg-[#252525] text-white/70 hover:bg-[#424242]"
                          }`}
                      >
                        Copy diagnostics
                      </button>
                    ) : null}
                  </div>
                </div>
              )}

              {lastErr && (
                <div className="absolute top-4 left-4 text-xs bg-[#F65252] text-white px-3 py-2 rounded-lg shadow z-30 max-w-[80%] break-words">
                  {lastErr}
                </div>
              )}
              {mediaWarning && connected && (
                <div
                  className={`rounded-2xl border px-3 py-2 text-sm ${isLight
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-200"
                    }`}
                >
                  <div className="break-words">
                    Joined the room, but a device step failed: {mediaWarning}
                  </div>
                </div>
              )}
            </div>

            {rightPanelOpen && !useOverlayRightPanel && (
              <div className="min-h-0 h-full overflow-hidden">
                {RightPanelBody}
              </div>
            )}

            {rightPanelOpen && useOverlayRightPanel && (
              <div className="absolute inset-0 z-40 min-h-0">
                <div
                  className="absolute inset-0 bg-black/40"
                  onClick={() => openRightTab(null)}
                />
                <div className="absolute inset-0 min-h-0">
                  {RightPanelBody}
                </div>
              </div>
            )}
          </div>
        </div>

        {roomState ? (
          <>
            <RoomAudioRenderer
              room={roomState}
              muted={selfDeafened}
            />
            <div className="fixed bottom-[5.25rem] left-1/2 z-[80] -translate-x-1/2">
              <StartAudio
                room={roomState}
                label="Click to enable audio"
                className={
                  isLight
                    ? "rounded-xl border border-[#CFCFCF] bg-[#F3F3F3] px-3 py-2 text-sm font-medium text-black shadow-lg"
                    : "rounded-xl border border-[#2B2B2B] bg-[#1B1B1B] px-3 py-2 text-sm font-medium text-white shadow-lg"
                }
              />
              {remoteAudioBlocked && (
                <div className="fixed bottom-[9.5rem] left-1/2 z-[81] -translate-x-1/2 px-2">
                  <div
                    className={
                      isLight
                        ? "max-w-[92vw] rounded-2xl border border-amber-200 bg-[#F3F3F3] px-4 py-3 text-sm text-black shadow-xl"
                        : "max-w-[92vw] rounded-2xl border border-amber-500/30 bg-[#1B1B1B] px-4 py-3 text-sm text-white shadow-xl"
                    }
                  >
                    <div className="font-medium">Room audio needs a tap</div>
                    <div
                      className={`mt-1 text-xs ${isLight ? "text-black/65" : "text-white/70"}`}
                    >
                      After microphone changes on some Android devices, room
                      audio may need to be resumed manually.
                    </div>

                    {remoteAudioBlockedReason ? (
                      <div
                        className={`mt-2 text-[11px] break-words ${isLight ? "text-black/55" : "text-white/55"}`}
                      >
                        {remoteAudioBlockedReason}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      disabled={audioResumeBusy}
                      onClick={async () => {
                        try {
                          setAudioResumeBusy(true);
                          await ensureRoomAudioPlaybackUnlocked(
                            "manual-notice",
                          );
                        } finally {
                          setAudioResumeBusy(false);
                        }
                      }}
                      className={
                        isLight
                          ? "mt-3 rounded-xl border border-[#CFCFCF] bg-black px-3 py-2 text-sm font-medium text-white"
                          : "mt-3 rounded-xl border border-[#2B2B2B] bg-[#F3F3F3] px-3 py-2 text-sm font-medium text-black"
                      }
                    >
                      {audioResumeBusy
                        ? "Enabling audio..."
                        : "Enable room audio"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : null}

        {mobilePiPHintVisible && connected && mobilePiPRuntime ? (
          <div className="fixed inset-x-3 bottom-[5.65rem] z-[90] flex justify-center sm:inset-x-auto sm:right-4 sm:w-[390px]">
            <div
              className={`w-full rounded-2xl px-3 py-3 shadow-lg ${
                isLight
                  ? "bg-[#2F2F2F] text-white"
                  : "bg-[#F3F3F3] text-[#2F2F2F]"
              }`}
              role="status"
            >
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                    isLight ? "bg-white/10" : "bg-black/[0.06]"
                  }`}
                >
                  <Icon
                    name="pip"
                    theme={isLight ? "light" : "dark"}
                    className="h-[18px] w-[18px]"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold leading-5">
                    Switching apps or tabs?
                  </div>
                  <div
                    className={`mt-0.5 text-[11px] leading-[1.45] ${
                      isLight ? "text-white/70" : "text-black/60"
                    }`}
                  >
                    Open Picture-in-Picture first to stay connected to the room.
                  </div>
                </div>

                <button
                  type="button"
                  aria-label="Dismiss Picture-in-Picture tip"
                  onClick={() => {
                    setMobilePiPHintVisible(false);
                    try {
                      localStorage.setItem(MOBILE_PIP_HINT_DISMISSED_KEY, "1");
                    } catch { }
                  }}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-lg leading-none transition ${
                    isLight ? "hover:bg-white/10" : "hover:bg-black/[0.06]"
                  }`}
                >
                  ×
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  setMobilePiPHintVisible(false);
                  try {
                    localStorage.setItem(MOBILE_PIP_HINT_DISMISSED_KEY, "1");
                  } catch { }
                  togglePictureInPicture().catch((error) => {
                    console.error("togglePictureInPicture failed", error);
                    alert(String((error as any)?.message || error || "pip_toggle_failed"));
                  });
                }}
                className={`mt-2.5 h-9 w-full rounded-xl text-[12px] font-semibold transition ${
                  isLight
                    ? "bg-white text-[#2F2F2F] hover:bg-white/90"
                    : "bg-[#2F2F2F] text-white hover:bg-[#383838]"
                }`}
              >
                Open Picture-in-Picture
              </button>
            </div>
          </div>
        ) : null}

        <LiveKitBottomBar
          theme={theme}
          isLight={isLight}
          bottomBarBg={bottomBarBg}
          ctlBtnBase={ctlBtnBase}
          connected={connected}
          micOn={micOn}
          camOn={camOn}
          screenShareOn={screenShareOn}
          voiceUiMode={voiceUiMode}
          unreadChat={unreadChat}
          activePanel={rightPanelOpen ? rightTab : null}
          showPiP={pipSupported}
          pipActive={pictureInPictureOpen}
          onTogglePiP={() => {
            togglePictureInPicture().catch((e) => {
              console.error("togglePictureInPicture failed", e);
              alert(String((e as any)?.message || e || "pip_toggle_failed"));
            });
          }}
          onToggleMic={() => toggleMic().catch(() => { })}
          onToggleCam={() => toggleCam().catch(() => { })}
          audioInputs={devices.audioInputs}
          videoInputs={devices.videoInputs}
          selectedAudioInputId={selectedAudioInputId}
          selectedVideoInputId={selectedVideoInputId}
          onChangeAudioInput={async (deviceId) => {
            setSelectedAudioInputId(deviceId);
            setPrejoin((prev) => ({ ...prev, audioInputId: deviceId }));
            prejoinRef.current = { ...prejoinRef.current, audioInputId: deviceId };
            await syncLiveAudioInput(deviceId);
          }}
          onChangeVideoInput={async (deviceId) => {
            setSelectedVideoInputId(deviceId);
            setPrejoin((prev) => ({ ...prev, videoInputId: deviceId }));
            prejoinRef.current = { ...prejoinRef.current, videoInputId: deviceId };
            await syncLiveVideoInput(deviceId);
          }}
          videoFxMode={videoFxMode}
          blurStrength={blurStrength}
          onBlurStrengthChange={setBlurStrength}
          backgroundPresets={FX_BG_PRESETS}
          selectedBackgroundUrl={bgImageUrl}
          backgroundFxDisabled={shouldDisableBackgroundFx}
          onApplyVideoFx={async (mode, backgroundUrl, nextBlurStrength) => {
            if (backgroundUrl) setBgImageUrl(backgroundUrl);
            await applyVideoFx(mode, backgroundUrl, nextBlurStrength);
          }}
          onUploadBackground={async (file) => {
            if (file.size > CUSTOM_BACKGROUND_MAX_FILE_BYTES) {
              setFxError("Custom backgrounds must be 8 MB or smaller");
              return;
            }
            try {
              if (uploadedBgUrlRef.current) URL.revokeObjectURL(uploadedBgUrlRef.current);
              const url = URL.createObjectURL(file);
              uploadedBgUrlRef.current = url;
              setBgImageUrl(url);
              await applyVideoFx("bg", url);
            } catch (error) {
              console.error("bottom bar background upload failed", error);
              setFxError("Failed to load selected image");
            }
          }}
          onToggleScreenShare={() => toggleScreenShare().catch(() => { })}
          onToggleVoiceUi={() => {
            setVoiceUiMode((current) => current === "off" ? "always" : current === "always" ? "hotkey" : "off");
            setVoiceUiHotkeyPressed(false);
            setVoiceUiHelpOpen(false);
            setVoiceUiLastCommand("");
            setVoiceUiLastHeard("");
          }}
          onLeave={() => leave().catch(() => { })}
          onOpenParticipants={() => openRightTab("participants")}
          onOpenChat={() => {
            // Move chat out of PiP before mounting the normal room drawer.
            if (pipOpen && pipMode === "chat") setPipMode("gallery");
            openRightTab("chat");
          }}
          onOpenTasks={() => openRightTab("tasks")}
          onOpenSettings={() => {
            setSettingsOpen(true);
            setSettingsPreviewVersion((v) => v + 1);
          }}
          soundscapeActive={
            soundscapeListeningMode === "room"
              ? activeSoundscapeId !== null && soundscapePlaying
              : personalSoundscapeId !== null && personalSoundscapePlaying
          }
          soundscapeMuted={
            soundscapeListeningMode === "room"
              ? soundscapeMuted
              : personalSoundscapeMuted
          }
          onToggleSoundscapeMute={() => {
            if (soundscapeListeningMode === "personal") {
              setPersonalSoundscapeMuted((current) => !current);
              return;
            }
            setSoundscapeMuted((current) => !current);
          }}
          onOpenSoundscapes={
            connected ? () => openRightTab("music") : undefined
          }
          onOpenBugReport={() => setBugReportOpen(true)}
          onSendReaction={sendReaction}
          showAIHost={aiHostedEnabled}
          aiHostOpen={aiHostInputOpen}
          onOpenAIHost={() => setAiHostInputOpen(true)}
        />

        <BugReportModal
          open={bugReportOpen}
          theme={theme}
          isLight={isLight}
          onClose={() => setBugReportOpen(false)}
          sessionId={session?.id || null}
          roomName={session?.title || session?.id || null}
          userId={authUserId || null}
        />

        <RoomSettingsModalLiveKit
          open={settingsOpen}
          theme={theme}
          hideBackgroundFx={shouldDisableBackgroundFx}
          showHostRoomPolicies={isHost}
          cameraRequired={roomPolicies.cameraRequired}
          publicChatDisabled={roomPolicies.publicChatDisabled}
          onChangeCameraRequired={(value) => {
            void updateRoomPolicies({
              ...roomPolicies,
              cameraRequired: value,
            });
          }}
          onChangePublicChatDisabled={(value) => {
            void updateRoomPolicies({
              ...roomPolicies,
              publicChatDisabled: value,
            });
          }}
          mode={videoFxMode}
          blurStrength={blurStrength}
          onBlurStrengthChange={setBlurStrength}
          bgImageUrl={bgImageUrl}
          onSetBgImageUrl={setBgImageUrl}
          onApplyMode={async (m) => {
            await applyVideoFx(m);
          }}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsPreviewVersion((v) => v + 1);
          }}
          fxError={fxError}
          fxApplying={fxApplying}
          fxStatusText={fxStatusText}
          previewTrack={
            prejoinPreparedVideoTrackRef.current ||
            (() => {
              try {
                const pubs = Array.from(
                  roomState?.localParticipant?.videoTrackPublications?.values?.() ||
                  [],
                );
                const camPub = pubs.find(
                  (p: any) => p?.source === Track.Source.Camera,
                );
                return (camPub?.track as LocalVideoTrack | null) || null;
              } catch {
                return null;
              }
            })()
          }
          previewVideoFilterCss={localVideoFilterCss}
          previewMirrored={previewMirrored}
          onTogglePreviewMirrored={setPreviewMirrored}
          cameraFramingMode={cameraFramingMode}
          onChangeCameraFramingMode={setCameraFramingMode}
          onUploadBg={(file) => {
            try {
              if (uploadedBgUrlRef.current) {
                URL.revokeObjectURL(uploadedBgUrlRef.current);
                uploadedBgUrlRef.current = null;
              }
              const url = URL.createObjectURL(file);
              uploadedBgUrlRef.current = url;
              setBgImageUrl(url);
            } catch (e) {
              console.error("upload bg failed", e);
              setFxError("Failed to load selected image");
            }
          }}
          onResetBg={() => {
            if (uploadedBgUrlRef.current) {
              try {
                URL.revokeObjectURL(uploadedBgUrlRef.current);
              } catch { }
              uploadedBgUrlRef.current = null;
            }
            setBgImageUrl(DEFAULT_BG_DATA_URL);
          }}
          videoTileLayoutPreset={videoTileLayoutPreset}
          videoTileLayoutColumns={videoTileLayoutColumns}
          videoTileLayoutRows={videoTileLayoutRows}
          onChangeVideoTileLayoutPreset={setVideoTileLayoutPreset}
          onChangeVideoTileLayoutColumns={setVideoTileLayoutColumns}
          onChangeVideoTileLayoutRows={setVideoTileLayoutRows}
          devices={devices}
          selectedAudioInputId={selectedAudioInputId}
          selectedVideoInputId={selectedVideoInputId}
          selectedAudioOutputId={selectedAudioOutputId}
          onChangeAudioInput={async (deviceId: string) => {
            setSelectedAudioInputId(deviceId);
            setPrejoin((prev) => ({ ...prev, audioInputId: deviceId }));
            await syncLiveAudioInput(deviceId);
          }}
          onChangeVideoInput={async (deviceId: string) => {
            setSelectedVideoInputId(deviceId);
            setPrejoin((prev) => ({ ...prev, videoInputId: deviceId }));
            await syncLiveVideoInput(deviceId);
          }}
          onChangeAudioOutput={(deviceId: string) => {
            const nextId = audioOutputSupported
              ? deviceId || "default"
              : "default";
            setSelectedAudioOutputId(nextId);
            setPrejoin((prev) => ({ ...prev, audioOutputId: nextId }));
            prejoinRef.current = {
              ...prejoinRef.current,
              audioOutputId: nextId,
            };
          }}
          echoCancellationEnabled={echoCancellationEnabled}
          noiseSuppressionEnabled={noiseSuppressionEnabled}
          autoGainControlEnabled={autoGainControlEnabled}
          onChangeEchoCancellation={async (v: boolean) => {
            setEchoCancellationEnabled(v);
            setPrejoin((prev) => ({ ...prev, echoCancellation: v }));
            await syncLiveAudioProcessing({
              echoCancellation: v,
              noiseSuppression: noiseSuppressionEnabled,
              autoGainControl: autoGainControlEnabled,
            });
          }}
          onChangeNoiseSuppression={async (v: boolean) => {
            setNoiseSuppressionEnabled(v);
            setPrejoin((prev) => ({ ...prev, noiseSuppression: v }));
            await syncLiveAudioProcessing({
              echoCancellation: echoCancellationEnabled,
              noiseSuppression: v,
              autoGainControl: autoGainControlEnabled,
            });
          }}
          onChangeAutoGainControl={async (v: boolean) => {
            setAutoGainControlEnabled(v);
            setPrejoin((prev) => ({ ...prev, autoGainControl: v }));
            await syncLiveAudioProcessing({
              echoCancellation: echoCancellationEnabled,
              noiseSuppression: noiseSuppressionEnabled,
              autoGainControl: v,
            });
          }}
          joinSoundEnabled={joinSoundEnabled}
          onChangeJoinSoundEnabled={setJoinSoundEnabled}
          leaveSoundEnabled={leaveSoundEnabled}
          onChangeLeaveSoundEnabled={setLeaveSoundEnabled}
          stageSoundsEnabled={stageSoundsEnabled}
          onChangeStageSoundsEnabled={setStageSoundsEnabled}
          stageSoundsVolume={roomSoundsVolume}
          onChangeStageSoundsVolume={setRoomSoundsVolume}
          defaultRemoteVolumePct={defaultRemoteVolumePct}
          onDefaultRemoteVolumePctChange={setDefaultRemoteVolumePct}
          onResetAllParticipantVolumes={() =>
            setVolumePctByParticipantKey({})
          }
          colorCorrectionEnabled={isLgUp && colorCorrectionEnabled}
          brightness={colorCorrection.brightness}
          contrast={colorCorrection.contrast}
          saturate={colorCorrection.saturation}
          onToggleColorCorrection={(enabled: boolean) => {
            if (!isLgUp) return;
            setColorCorrectionEnabled(enabled);
          }}
          onChangeBrightness={(v: number) => {
            if (!isLgUp) return;
            setColorCorrection((p) => ({ ...p, brightness: v }));
          }}
          onChangeContrast={(v: number) => {
            if (!isLgUp) return;
            setColorCorrection((p) => ({ ...p, contrast: v }));
          }}
          onChangeSaturate={(v: number) => {
            if (!isLgUp) return;
            setColorCorrection((p) => ({ ...p, saturation: v }));
          }}
          showMobileLayoutSwitcher={showMobileLayoutSwitcher}
          onChangeShowMobileLayoutSwitcher={updateShowMobileLayoutSwitcher}
          voiceUiHotkey={voiceUiHotkey}
          onChangeVoiceUiHotkey={setVoiceUiHotkey}
        />

        {settingsOpen && deviceError ? (
          <div
            className={`fixed left-1/2 top-[88px] z-[91] -translate-x-1/2 rounded-xl px-3 py-2 text-[12px] shadow-lg ${isLight
              ? "bg-red-50 border border-red-200 text-red-700"
              : "bg-red-500/10 border border-red-500/20 text-red-200"
              }`}
          >
            {deviceError}
          </div>
        ) : null}

        {systemNotice.open && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center px-4">
            <div
              className="absolute inset-0 bg-black/55 backdrop-blur-[3px]"
              onClick={
                systemNotice.kind === "kick" ? undefined : closeSystemNotice
              }
            />
            <div
              className={`relative w-full overflow-hidden border shadow-[0_24px_80px_rgba(0,0,0,0.34)] ${systemNotice.presentation === "camera-reminder"
                ? "max-w-[460px] rounded-[26px]"
                : "max-w-[520px] rounded-2xl"
                } ${isLight
                  ? "border-black/[0.08] bg-white text-[#2F2F2F]"
                  : "border-white/[0.09] bg-[#1D1D1D] text-white"
                }`}
            >
              <div className={systemNotice.presentation === "camera-reminder" ? "p-6 pb-5" : "p-5"}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    {systemNotice.presentation === "camera-reminder" ? (
                      <div className="mb-5 flex items-center gap-3">
                        <div
                          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] ${isLight
                            ? "bg-[#EAF3FF] text-[#377FE8]"
                            : "bg-[#377FE8]/15 text-[#72A9FF]"
                            }`}
                        >
                          <Icon name="camera-on" theme={theme} className="h-6 w-6" alt="" />
                        </div>
                        <div>
                          <div className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${isLight ? "text-[#377FE8]" : "text-[#72A9FF]"}`}>
                            Camera required
                          </div>
                          <div className={`mt-0.5 text-[12px] font-normal ${isLight ? "text-black/50" : "text-white/50"}`}>
                            Keep your focus partner present
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className={`${systemNotice.presentation === "camera-reminder"
                      ? "text-[20px] font-medium leading-[1.25]"
                      : "text-[18px] font-semibold"
                      }`}>
                      {systemNotice.title}
                    </div>
                    <div
                      className={`mt-2 text-[14px] font-normal leading-[1.55] ${isLight ? "text-black/60" : "text-white/62"}`}
                    >
                      {systemNotice.body}
                    </div>
                  </div>

                  {systemNotice.kind !== "kick" && (
                    <button
                      type="button"
                      onClick={closeSystemNotice}
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${isLight
                        ? "bg-[#F2F2F2] text-black/55 hover:bg-[#E8E8E8] hover:text-black/75"
                        : "bg-white/[0.07] text-white/60 hover:bg-white/[0.11] hover:text-white/85"
                        }`}
                      title="Close"
                      aria-label="Close"
                    >
                      <X size={17} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              <div
                className={`flex flex-col-reverse gap-2 px-6 py-4 sm:flex-row sm:items-center sm:justify-end ${isLight ? "bg-[#F7F7F7]" : "bg-white/[0.035]"}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    closeSystemNotice();
                    if (systemNotice.kind === "kick") {
                      navigate("/sessions", { replace: true });
                    }
                  }}
                  className={`h-11 rounded-[14px] px-5 text-[13px] font-normal transition ${isLight
                    ? "text-black/55 hover:bg-black/[0.05] hover:text-black/75"
                    : "text-white/55 hover:bg-white/[0.06] hover:text-white/80"
                    }`}
                >
                  {systemNotice.presentation === "camera-reminder" ? "Not now" : "OK"}
                </button>

                {systemNotice.actionLabel && systemNotice.action ? (
                  <button
                    type="button"
                    onClick={() => {
                      const action = systemNotice.action;
                      closeSystemNotice();
                      action?.();
                    }}
                    className={`inline-flex h-11 items-center justify-center gap-2 rounded-[14px] px-5 text-[13px] font-semibold transition ${systemNotice.presentation === "camera-reminder"
                      ? "bg-[#377FE8] text-white hover:bg-[#2F72D5]"
                      : isLight
                        ? "bg-[#2F2F2F] text-white hover:bg-black"
                        : "bg-white text-[#2F2F2F] hover:bg-white/90"
                      }`}
                  >
                    {systemNotice.presentation === "camera-reminder" ? (
                      <Icon name="camera-on" theme="dark" className="h-[17px] w-[17px]" alt="" />
                    ) : null}
                    {systemNotice.actionLabel}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        )}
        <ReportParticipantModalLiveKit
          open={reportModalOpen}
          theme={theme}
          participantName={reportTarget?.label || "Participant"}
          value={reportReason}
          busy={reportBusy}
          error={reportError}
          onChange={setReportReason}
          onClose={() => {
            if (reportBusy) return;
            setReportModalOpen(false);
            setReportTarget(null);
            setReportReason("");
            setReportError("");
          }}
          onSubmit={() => {
            submitParticipantReport().catch(() => { });
          }}
        />

        {editNameOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setEditNameOpen(false)}
            />
            <div
              className={`relative w-[92%] max-w-[480px] rounded-2xl border shadow-2xl p-5 ${isLight
                ? "bg-[#F3F3F3] border-[#CFCFCF]"
                : "bg-[#1B1B1B] border-[#2B2B2B]"
                }`}
            >
              <div
                className={`text-[16px] font-semibold ${isLight ? "text-black/85" : "text-white/90"}`}
              >
                Edit your name
              </div>
              <div
                className={`mt-1 text-[12px] ${isLight ? "text-black/50" : "text-white/50"}`}
              >
                This only changes your name inside the current room.
              </div>

              <input
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
                placeholder="Your name"
                className={`mt-4 w-full rounded-xl px-3 py-2 outline-none border ${isLight
                  ? "bg-[#F3F3F3] border-[#CFCFCF] text-black/85"
                  : "bg-[#1B1B1B] border-[#2B2B2B] text-white/90"
                  }`}
              />

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => setEditNameOpen(false)}
                  className={`px-4 h-10 rounded-xl font-semibold ${isLight
                    ? "bg-[#E6E6E6] hover:bg-[#DCDCDC] text-black/75"
                    : "bg-[#242424] hover:bg-[#303030] text-white/85"
                    }`}
                >
                  Cancel
                </button>
                <button
                  onClick={() => saveEditName().catch(() => { })}
                  className={`px-4 h-10 rounded-xl font-semibold ${isLight
                    ? "bg-[#1B1B1B] hover:bg-[#242424] text-white"
                    : "bg-[#1B1B1B] hover:bg-[#242424] text-white"
                    }`}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {timelineEditorOpen && (
          <RoomTimelineEditor
            open={timelineEditorOpen}
            theme={theme}
            title={sessionTitle}
            blocks={timelineDraftBlocks}
            onChange={setTimelineDraftBlocks}
            onClose={closeTimelineEditor}
            onSave={saveTimelineEditor}
            saving={timelineSaving}
            preserveInfinite={isInfiniteRoom}
            maxBlocks={isFreeFlowRoom ? 9 : undefined}
          />
        )}

        {freeFlowIntroOpen && (
          <div className="fixed inset-0 z-[235] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className={`w-full max-w-[760px] max-h-[min(90vh,760px)] overflow-y-auto rounded-[24px] border p-6 shadow-2xl ${isLight ? "border-[#D8D8D8] bg-white text-[#2F2F2F]" : "border-[#343434] bg-[#1B1B1B] text-white"}`}>
              <div className="text-[20px] font-semibold">Host your Free Flow</div>
              <p className={`mt-2 text-[14px] leading-6 ${isLight ? "text-black/60" : "text-white/60"}`}>
                Start with 2 minutes of goal setting, then choose a suggested structure or build your own timeline. You can use up to 9 blocks.
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {FREE_FLOW_TIMELINE_PRESETS.map((preset) => {
                  const totalMinutes = preset.blocks.reduce((sum, block) => sum + block.minutes, 0);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`group rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 ${isLight ? "border-[#DDDDDD] bg-[#F8F8F8] hover:border-[#AFAFAF] hover:bg-white" : "border-[#353535] bg-[#242424] hover:border-[#565656] hover:bg-[#292929]"}`}
                      onClick={() => {
                        window.localStorage.setItem(`mysession:free-flow-intro:${sessionId}:${authUserId || "host"}`, "seen");
                        setFreeFlowIntroOpen(false);
                        setTimelineDraftBlocks(makeFreeFlowTimelineBlocks(preset.id));
                        setTimelineEditorOpen(true);
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[14px] font-semibold">{preset.name}</div>
                          <div className={`mt-1 text-[12px] leading-5 ${isLight ? "text-black/55" : "text-white/55"}`}>
                            {preset.description}
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${isLight ? "bg-black/[0.06] text-black/60" : "bg-white/[0.08] text-white/60"}`}>
                          {totalMinutes} min
                        </span>
                      </div>
                      <div className={`mt-4 flex h-9 overflow-hidden rounded-xl border p-1 ${isLight ? "border-black/10 bg-white" : "border-white/10 bg-[#181818]"}`}>
                        {preset.blocks.map((block, index) => {
                          const visual = resolveStageVisual({ type: block.kind, title: block.title, minutes: block.minutes });
                          return (
                            <span
                              key={`${preset.id}-${index}`}
                              title={`${block.title} · ${block.minutes} min`}
                              className="min-w-[5px] rounded-[7px] first:rounded-l-lg last:rounded-r-lg"
                              style={{ backgroundColor: visual.color, flex: `${block.minutes} 1 0%` }}
                            />
                          );
                        })}
                      </div>
                      <div className={`mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[10px] ${isLight ? "text-black/45" : "text-white/45"}`}>
                        {preset.blocks.map((block, index) => (
                          <span key={`${preset.id}-label-${index}`}>{block.title} {block.minutes}</span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  className={`h-11 rounded-full px-5 text-[13px] font-medium ${isLight ? "bg-[#EFEFEF] hover:bg-[#E5E5E5]" : "bg-[#2A2A2A] hover:bg-[#333]"}`}
                  onClick={() => {
                    window.localStorage.setItem(`mysession:free-flow-intro:${sessionId}:${authUserId || "host"}`, "seen");
                    setFreeFlowIntroOpen(false);
                    setTimelineDraftBlocks(makeFreeFlowTimelineBlocks("30-10").slice(0, 1));
                    setTimelineEditorOpen(true);
                  }}
                >
                  Build my own
                </button>
              </div>
            </div>
          </div>
        )}
        {selectedUser && (
          <UserProfileModal
            user={selectedUser}
            onClose={() => setSelectedUser(null)}
          />
        )}
      </div>
      {openTileAdminMenuId &&
        tileMenuAnchor &&
        createPortal(
          <div
            className="fixed inset-0 z-[220] pointer-events-none"
            aria-hidden={false}
          >
            <div
              data-lk-admin-menu-surface="true"
              className={`pointer-events-auto fixed w-[min(22rem,calc(100vw-1rem))] max-h-[min(78vh,34rem)] overflow-y-auto overflow-x-hidden rounded-2xl border shadow-2xl ${isLight
                ? "bg-[#F3F3F3] border-[#CFCFCF] text-black/85"
                : "bg-[#1B1B1B] border-[#2B2B2B] text-white/90"
                }`}
              style={{
                left: Math.max(
                  8,
                  Math.min(
                    tileMenuAnchor.x - 352,
                    tileMenuAnchor.viewportWidth - 360,
                  ),
                ),
                top: Math.max(
                  8,
                  Math.min(
                    tileMenuAnchor.y + 8,
                    tileMenuAnchor.viewportHeight - 520,
                  ),
                ),
                fontFamily:
                  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                overscrollBehavior: "contain",
                WebkitOverflowScrolling: "touch",
                touchAction: "pan-y",
                backgroundColor: isLight ? "#F3F3F3" : "#262626",
                opacity: 1,
              }}
              onWheel={(e) => {
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
            >
              {(() => {
                const targetTile =
                  layoutTilesForRender.find(
                    (t) => t.id === openTileAdminMenuId,
                  ) ||
                  tilesForRender.find((t) => t.id === openTileAdminMenuId) ||
                  (featuredTile && featuredTile.id === openTileAdminMenuId
                    ? featuredTile
                    : null) ||
                  null;
                if (!targetTile) return null;

                const targetIdentity = String(
                  targetTile.participantIdentity || "",
                ).trim();
                const targetUserId = String(
                  targetTile.participantUserId ||
                  extractBaseUserIdFromIdentity(targetIdentity),
                )
                  .trim()
                  .toLowerCase();

                const pidBase = looksLikeUuid(targetUserId) ? targetUserId : "";
                const isTargetModerator = !!(
                  pidBase && moderatorUserIds.includes(pidBase)
                );

                const canRoleManageTarget =
                  !targetTile.isLocal &&
                  isHost &&
                  !!pidBase &&
                  pidBase !== String(authUserId || "").toLowerCase();

                const canModerateTarget =
                  !targetTile.isLocal &&
                  !!targetIdentity &&
                  (isHost || isSelfModerator);

                const participantVolumeKey =
                  getParticipantVolumeKey(targetTile);
                const participantVolumePctRaw =
                  volumePctByParticipantKey[participantVolumeKey];
                const participantVolumePct = Number.isFinite(
                  Number(participantVolumePctRaw),
                )
                  ? clamp(Number(participantVolumePctRaw), 0, 300)
                  : 100;

                const roleBusy = !!pidBase
                  ? roleBusyKey ===
                  `mod:${pidBase}:${isTargetModerator ? "revoke" : "grant"}`
                  : false;

                const muteBusyKey = `${targetIdentity}:${String(
                  targetTile.remoteMicPubSid || targetTile.micTrackSid || "",
                )}:mute`;
                const camBusyKey = `${targetIdentity}:${String(targetTile.camTrackSid || "")}:camera-off`;

                const micBusy = adminBusyKey === muteBusyKey;
                const camBusy = adminBusyKey === camBusyKey;
                const kickBusy = adminBusyKey === `${targetIdentity}:kick`;

                const remoteMicTrackSid = String(
                  targetTile.remoteMicPubSid || targetTile.micTrackSid || "",
                ).trim();

                const remoteCamTrackSid = String(
                  targetTile.camTrackSid || "",
                ).trim();

                const isMicAlreadyMuted = !!targetTile.micMuted;
                const isCamAlreadyOff =
                  !!targetTile.camPubMuted ||
                  !targetTile.camPubHasTrack ||
                  !targetTile.camPubExists;

                const canMuteMic =
                  canModerateTarget &&
                  !!remoteMicTrackSid &&
                  !isMicAlreadyMuted;

                const canTurnOffCam =
                  canModerateTarget && !!remoteCamTrackSid && !isCamAlreadyOff;

                const canSeeMuteMicAction =
                  !!remoteMicTrackSid || isMicAlreadyMuted;
                const canSeeTurnOffCamAction =
                  !!remoteCamTrackSid || isCamAlreadyOff;

                const muteMicDisabled =
                  micBusy ||
                  isMicAlreadyMuted ||
                  !canModerateTarget ||
                  !remoteMicTrackSid;

                const turnOffCamDisabled =
                  camBusy ||
                  isCamAlreadyOff ||
                  !canModerateTarget ||
                  !remoteCamTrackSid;

                const participantActionButtonCls = `w-full px-4 py-3 text-left text-[13px] transition ${isLight
                  ? "text-black/85 hover:bg-[#E8E8E8]"
                  : "text-white/90 hover:bg-[#303030]"
                  }`;

                const participantActionButtonDisabledCls = `w-full px-4 py-3 text-left text-[13px] transition disabled:cursor-not-allowed disabled:opacity-50 ${isLight
                  ? "text-black/55 bg-transparent"
                  : "text-white/55 bg-transparent"
                  }`;

                const isPinned = pinnedTileId === targetTile.id;
                const isHidden = !!hiddenTileIds[targetTile.id];

                return (
                  <>
                    {canRoleManageTarget && (
                      <>
                        <div
                          className={
                            isLight
                              ? "border-t border-[#CFCFCF]"
                              : "border-t border-[#2B2B2B]"
                          }
                        />

                        <div
                          className={`px-4 py-2 text-[11px] ${isLight ? "text-black/55" : "text-white/55"}`}
                        >
                          Roles
                        </div>

                        {!isTargetModerator ? (
                          <button
                            type="button"
                            disabled={roleBusy || rolesLoading}
                            onClick={async () => {
                              if (!pidBase) return;
                              await grantModerator(pidBase);
                              closeTileMenu();
                            }}
                            className={`w-full px-4 py-3 text-left text-[13px] transition disabled:opacity-50 ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                          >
                            Make moderator
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={roleBusy || rolesLoading}
                            onClick={async () => {
                              if (!pidBase) return;
                              await revokeModerator(pidBase);
                              closeTileMenu();
                            }}
                            className={`w-full px-4 py-3 text-left text-[13px] transition disabled:opacity-50 ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                          >
                            Remove moderator
                          </button>
                        )}
                      </>
                    )}

                    <>
                      {(canModerateTarget || true) && (
                        <>
                          <div
                            className={
                              isLight
                                ? "border-t border-[#CFCFCF]"
                                : "border-t border-[#2B2B2B]"
                            }
                          />

                          <div
                            className={`px-4 py-2 font-inter text-[12px] font-bold ${isLight ? "text-black/55" : "text-white/55"}`}
                          >
                            Participant actions
                          </div>

                          <button
                            type="button"
                            disabled={!targetTile.videoTrack}
                            onClick={() => {
                              const tileElement = tileMenuAnchor.tileElement;
                              if (!tileElement || !targetTile.videoTrack) return;
                              closeTileMenu();
                              void openParticipantPictureInPicture(
                                targetTile.id,
                                tileElement,
                              );
                            }}
                            className={
                              targetTile.videoTrack
                                ? participantActionButtonCls
                                : participantActionButtonDisabledCls
                            }
                            title={
                              targetTile.videoTrack
                                ? "Open only this participant in Picture-in-Picture"
                                : "Participant camera is off"
                            }
                          >
                            Open in Picture-in-Picture
                          </button>
                          {canSeeMuteMicAction && (
                            <button
                              type="button"
                              disabled={muteMicDisabled}
                              onClick={() => {
                                if (muteMicDisabled) return;
                                if (!targetIdentity || !remoteMicTrackSid)
                                  return;

                                closeTileMenu();
                                void adminMuteRemoteTrack(
                                  targetTile.id,
                                  targetIdentity,
                                  remoteMicTrackSid,
                                );
                              }}
                              className={
                                muteMicDisabled
                                  ? participantActionButtonDisabledCls
                                  : participantActionButtonCls
                              }
                              title={
                                !canModerateTarget
                                  ? "Only host, moderator, or admin can mute participants"
                                  : "Mute Mic"
                              }
                            >
                              Mute Mic
                            </button>
                          )}

                          {canSeeTurnOffCamAction && (
                            <button
                              type="button"
                              disabled={turnOffCamDisabled}
                              onClick={() => {
                                if (turnOffCamDisabled) return;
                                if (!targetIdentity || !remoteCamTrackSid)
                                  return;

                                closeTileMenu();
                                void adminTurnOffRemoteCamera(
                                  targetTile.id,
                                  targetIdentity,
                                  remoteCamTrackSid,
                                );
                              }}
                              className={
                                turnOffCamDisabled
                                  ? participantActionButtonDisabledCls
                                  : participantActionButtonCls
                              }
                              title={
                                !canModerateTarget
                                  ? "Only host, moderator, or admin can control participant camera"
                                  : "Turn camera off"
                              }
                            >
                              Turn camera off
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              togglePin(targetTile.id);
                              closeTileMenu();
                            }}
                            className={`block w-full px-4 py-3 text-left text-[13px] transition ${isLight
                              ? "text-black/85 hover:bg-[#E8E8E8]"
                              : "text-white/90 hover:bg-[#303030]"
                              }`}
                          >
                            {isPinned ? "Unpin participant" : "Pin participant"}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              toggleHide(targetTile.id);
                              closeTileMenu();
                            }}
                            className={`block w-full px-4 py-3 text-left text-[13px] transition ${isLight
                              ? "text-black/85 hover:bg-[#E8E8E8]"
                              : "text-white/90 hover:bg-[#303030]"
                              }`}
                          >
                            {isHidden
                              ? "Unhide participant"
                              : "Hide participant"}
                          </button>

                          {!targetTile.isLocal && (
                            <button
                              type="button"
                              onClick={() => {
                                setReportTarget(targetTile);
                                setReportReason("");
                                setReportError("");
                                setReportModalOpen(true);
                                closeTileMenu();
                              }}
                              className={`block w-full px-4 py-3 text-left text-[13px] transition ${isLight
                                ? "text-black/85 hover:bg-[#E8E8E8]"
                                : "text-white/90 hover:bg-[#303030]"
                                }`}
                            >
                              Report participant
                            </button>
                          )}

                          {canModerateTarget && !targetTile.isLocal && (
                            <button
                              type="button"
                              disabled={kickBusy}
                              onClick={() => {
                                if (!targetIdentity) return;

                                closeTileMenu();
                                void adminKickParticipant(
                                  targetIdentity,
                                  targetUserId || undefined,
                                  targetTile.label || undefined,
                                );
                              }}
                              className={`w-full px-4 py-3 text-left text-[13px] transition disabled:cursor-not-allowed disabled:opacity-50 ${isLight
                                ? "text-red-600 hover:bg-red-50"
                                : "text-red-300 hover:bg-red-500/10"
                                }`}
                            >
                              Kick participant
                            </button>
                          )}
                        </>
                      )}
                    </>

                    {!targetTile.isLocal && targetTile.kind !== "screen" ? (
                      <>
                        <div
                          className={
                            isLight
                              ? "border-t border-[#CFCFCF]"
                              : "border-t border-[#2B2B2B]"
                          }
                        />

                        <div
                          className={`px-4 pb-3 pt-3 ${isLight ? "text-black/85" : "text-white/90"}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="font-inter text-[12px] font-bold">
                                Participant volume
                              </div>
                              <div className={`mt-1 text-[11px] ${isLight ? "text-black/50" : "text-white/50"}`}>
                                Only changes what you hear.
                              </div>
                            </div>
                            <div className={`shrink-0 rounded-xl border px-2 py-1 text-[12px] font-semibold tabular-nums ${isLight ? "border-[#CFCFCF] bg-[#F7F7F7] text-black/75" : "border-[#2B2B2B] bg-[#242424] text-white/80"}`}>
                              {participantVolumePct}%
                            </div>
                          </div>

                          <input
                            type="range"
                            min={0}
                            max={300}
                            step={5}
                            value={participantVolumePct}
                            onChange={(e) => {
                              setParticipantVolumePct(
                                targetTile,
                                Number(e.currentTarget.value),
                              );
                            }}
                            className="mt-3 w-full accent-[#5286F6]"
                            aria-label="Participant volume"
                          />

                          <div className="mt-2 grid grid-cols-6 gap-1.5">
                            {[0, 50, 100, 150, 200, 300].map((pct) => (
                              <button
                                key={pct}
                                type="button"
                                onClick={() => {
                                  setParticipantVolumePct(targetTile, pct);
                                }}
                                className={`rounded-xl border px-2 py-1.5 text-[11px] font-semibold transition ${participantVolumePct === pct
                                  ? isLight
                                    ? "border-black bg-black text-white"
                                    : "border-white bg-white text-black"
                                  : isLight
                                    ? "border-[#CFCFCF] bg-[#F7F7F7] text-black/70 hover:bg-[#E8E8E8]"
                                    : "border-[#2B2B2B] bg-[#242424] text-white/75 hover:bg-[#303030]"
                                  }`}
                              >
                                {pct}%
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : null}

                    <div
                      className={
                        isLight
                          ? "border-t border-[#CFCFCF]"
                          : "border-t border-[#2B2B2B]"
                      }
                    />

                    {targetTile?.kind === "screen" && (
                      <>
                        <div
                          className={
                            isLight
                              ? "border-t border-[#CFCFCF]"
                              : "border-t border-[#2B2B2B]"
                          }
                        />

                        <button
                          type="button"
                          onClick={() => {
                            const isThisPinnedScreen =
                              screenSharePinned &&
                              activeScreenShareTile?.id === targetTile.id;
                            setPinnedScreenShareTileId(
                              isThisPinnedScreen ? null : targetTile.id,
                            );
                            setScreenSharePinned(!isThisPinnedScreen);
                            closeTileMenu();
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight
                            ? "text-black/85 hover:bg-[#E8E8E8]"
                            : "text-white/90 hover:bg-[#303030]"
                            }`}
                        >
                          {screenSharePinned &&
                            activeScreenShareTile?.id === targetTile.id
                            ? "Unpin shared screen"
                            : "Pin shared screen"}
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setSettingsOpen(true);
                        setSettingsPreviewVersion((v) => v + 1);
                        closeTileMenu();
                      }}
                      className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                    >
                      Video room settings
                    </button>

                    {targetTile?.isLocal && targetTile?.kind !== "screen" && (
                      <>
                        <div
                          className={
                            isLight
                              ? "border-t border-[#CFCFCF]"
                              : "border-t border-[#2B2B2B]"
                          }
                        />

                        <div
                          className={`px-4 py-2 font-inter text-[12px] font-bold ${isLight ? "text-black/55" : "text-white/55"}`}
                        >
                          Status
                        </div>

                        <button
                          type="button"
                          onClick={async () => {
                            await setMyStatus(null);
                            closeTileMenu();
                            scheduleRebuildTiles();
                            window.setTimeout(() => scheduleRebuildTiles(), 80);
                            window.setTimeout(
                              () => scheduleRebuildTiles(),
                              220,
                            );
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                        >
                          Clear status
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            await setMyStatus("afk");
                            closeTileMenu();
                            scheduleRebuildTiles();
                            window.setTimeout(() => scheduleRebuildTiles(), 80);
                            window.setTimeout(
                              () => scheduleRebuildTiles(),
                              220,
                            );
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                        >
                          AFK
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            await setMyStatus("break");
                            closeTileMenu();
                            scheduleRebuildTiles();
                            window.setTimeout(() => scheduleRebuildTiles(), 80);
                            window.setTimeout(
                              () => scheduleRebuildTiles(),
                              220,
                            );
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                        >
                          Taking a break
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            await setMyStatus("skip");
                            closeTileMenu();
                            scheduleRebuildTiles();
                            window.setTimeout(() => scheduleRebuildTiles(), 80);
                            window.setTimeout(
                              () => scheduleRebuildTiles(),
                              220,
                            );
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                        >
                          Skip me
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await setMyStatus("skip_deafened");
                            closeTileMenu();
                            scheduleRebuildTiles();
                            window.setTimeout(() => scheduleRebuildTiles(), 80);
                            window.setTimeout(
                              () => scheduleRebuildTiles(),
                              220,
                            );
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                        >
                          <span className="inline-flex items-center gap-2">
                            <span>Skip me</span>
                            <SkipMeMutedStatusIcon theme={theme} className="h-3.5 w-3.5" />
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            await setMyStatus("call");
                            closeTileMenu();
                            scheduleRebuildTiles();
                            window.setTimeout(() => scheduleRebuildTiles(), 80);
                            window.setTimeout(
                              () => scheduleRebuildTiles(),
                              220,
                            );
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                        >
                          On a call
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            await setMyStatus("eating");
                            closeTileMenu();
                            scheduleRebuildTiles();
                            window.setTimeout(() => scheduleRebuildTiles(), 80);
                            window.setTimeout(
                              () => scheduleRebuildTiles(),
                              220,
                            );
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                        >
                          Eating
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            await setMyStatus("private");
                            closeTileMenu();
                            scheduleRebuildTiles();
                            window.setTimeout(() => scheduleRebuildTiles(), 80);
                            window.setTimeout(
                              () => scheduleRebuildTiles(),
                              220,
                            );
                          }}
                          className={`w-full px-4 py-3 text-left text-[13px] transition ${isLight ? "text-black/85 hover:bg-[#E8E8E8]" : "text-white/90 hover:bg-[#303030]"}`}
                        >
                          Private
                        </button>
                      </>
                    )}

                  </>
                );
              })()}
            </div>
          </div>,
          tileMenuAnchor?.portalDocument?.body || document.body,
        )}
      {mobilePiPRuntime ? (
        <>
          <canvas
            ref={mobilePiPCanvasRef}
            width={MOBILE_PIP_CANVAS_WIDTH}
            height={MOBILE_PIP_CANVAS_HEIGHT}
            aria-hidden="true"
            className="fixed left-[-10000px] top-0 h-[540px] w-[960px] pointer-events-none"
          />

          <video
            ref={(node) => {
              mobilePiPStageRef.current =
                node as MobilePiPVideoElement | null;
            }}
            data-mobile-pip-stage="true"
            data-pip-ready="false"
            muted
            autoPlay
            playsInline
            aria-hidden="true"
            className="fixed left-[-10000px] top-0 h-[180px] w-[320px] object-contain pointer-events-none"
          />
          <video
            ref={(node) => {
              mobilePiPAppleStageRef.current =
                node as MobilePiPVideoElement | null;
            }}
            data-mobile-pip-stage="true"
            data-mobile-pip-file-stage="true"
            data-pip-ready="false"
            muted
            loop
            autoPlay
            playsInline
            aria-hidden="true"
            className="fixed left-[-10000px] top-0 h-[180px] w-[320px] object-contain pointer-events-none"
          />
        </>
      ) : null}

      {pipPortal}
    </>
  );
}

export default RoomPageLiveKit;
