import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { RoomSettingsModalLiveKit } from "../../src/pages/livekit/RoomSettingsModalLiveKit";
import type { CameraFramingMode } from "../../src/pages/livekit/VideoTileLiveKit";
import "../../src/index.css";

const initial = {
  sidePanelTheme: "light" as "light" | "dark", mode: "off" as "off" | "blur" | "bg", blurStrength: 12, bgImageUrl: "",
  defaultRemoteVolumePct: 100, previewMirrored: true, cameraFramingMode: "fill" as CameraFramingMode,
  videoTileLayoutPreset: "auto" as "auto" | "one" | "two" | "three" | "four" | "five" | "six" | "strip",
  sendVideoQuality: "auto" as "auto" | "high" | "medium" | "low", receiveVideoQuality: "auto" as "auto" | "high" | "medium" | "low",
  videoTileLayoutColumns: 0, videoTileLayoutRows: 0, showMobileLayoutSwitcher: true, voiceUiHotkey: "Alt+V",
  cameraRequired: false, screenShareRequired: false, cameraOrScreenShareRequired: false, publicChatDisabled: false, mediaRequirementsApplyToStaff: false,
  selectedAudioInputId: "mic-1", selectedVideoInputId: "cam-1", selectedAudioOutputId: "default",
  echoCancellationEnabled: true, noiseSuppressionEnabled: true, autoGainControlEnabled: true,
  joinSoundEnabled: true, leaveSoundEnabled: true, stageSoundsEnabled: true, stageSoundsVolume: 100,
  colorCorrectionEnabled: false, brightness: 100, contrast: 100, saturate: 100,
};
function device(deviceId: string, label: string, kind: MediaDeviceKind): MediaDeviceInfo {
  return { deviceId, label, kind, groupId: "fixture", toJSON: () => ({ deviceId, label, kind }) };
}
function Preview() {
  const [open, setOpen] = useState(true);
  const [settings, setSettings] = useState(initial);
  const [previewCounts, setPreviewCounts] = useState({ attached: 0, detached: 0 });
  const previewTrack = useMemo(() => ({
    attach: () => { setPreviewCounts((current) => ({ ...current, attached: current.attached + 1 })); return document.createElement("video"); },
    detach: () => { setPreviewCounts((current) => ({ ...current, detached: current.detached + 1 })); },
  }), []);
  const change = <K extends keyof typeof initial>(key: K) => (value: (typeof initial)[K]) => setSettings((current) => ({ ...current, [key]: value }));
  const theme = new URLSearchParams(window.location.search).get("theme") === "light" ? "light" : "dark";
  return <main style={{ minHeight: "100vh", background: theme === "light" ? "#f3f1f1" : "#1b1b1b", color: theme === "light" ? "black" : "white", padding: 24 }}>
    <button onClick={() => setOpen(true)}>Open settings</button>
    <output aria-label="Settings fixture state" style={{ display: "block", overflowWrap: "anywhere" }}>{JSON.stringify({ ...settings, previewCounts, open })}</output>
    <RoomSettingsModalLiveKit {...settings} open={open} theme={theme} onClose={() => setOpen(false)} showHostRoomPolicies previewTrack={previewTrack}
      fxApplying={false} fxError="" fxStatusText="Preview only — no live media or server changes"
      devices={{ audioInputs: [device("mic-1", "Webcam microphone with a long device name", "audioinput"), device("mic-2", "Headset microphone", "audioinput")], videoInputs: [device("cam-1", "OBS Virtual Camera", "videoinput"), device("cam-2", "USB Camera", "videoinput")], audioOutputs: [device("sp-1", "Headphones", "audiooutput")] }}
      onChangeSidePanelTheme={change("sidePanelTheme")} onBlurStrengthChange={change("blurStrength")} onSetBgImageUrl={change("bgImageUrl")}
      onDefaultRemoteVolumePctChange={change("defaultRemoteVolumePct")} onResetAllParticipantVolumes={() => {}}
      onApplyMode={(mode, url) => setSettings((current) => ({ ...current, mode, bgImageUrl: url || current.bgImageUrl }))}
      onTogglePreviewMirrored={change("previewMirrored")} onChangeCameraFramingMode={change("cameraFramingMode")}
      onUploadBg={() => {}} onResetBg={() => change("bgImageUrl")("")}
      onChangeSendVideoQuality={change("sendVideoQuality")} onChangeReceiveVideoQuality={change("receiveVideoQuality")}
      onChangeVideoTileLayoutPreset={change("videoTileLayoutPreset")} onChangeVideoTileLayoutColumns={change("videoTileLayoutColumns")} onChangeVideoTileLayoutRows={change("videoTileLayoutRows")}
      onChangeShowMobileLayoutSwitcher={change("showMobileLayoutSwitcher")} onChangeVoiceUiHotkey={change("voiceUiHotkey")}
      onChangeCameraRequired={change("cameraRequired")} onChangeScreenShareRequired={change("screenShareRequired")} onChangeCameraOrScreenShareRequired={change("cameraOrScreenShareRequired")}
      onChangePublicChatDisabled={change("publicChatDisabled")}
      onChangeAudioInput={change("selectedAudioInputId")} onChangeVideoInput={change("selectedVideoInputId")} onChangeAudioOutput={change("selectedAudioOutputId")}
      onChangeEchoCancellation={change("echoCancellationEnabled")} onChangeNoiseSuppression={change("noiseSuppressionEnabled")} onChangeAutoGainControl={change("autoGainControlEnabled")}
      onChangeJoinSoundEnabled={change("joinSoundEnabled")} onChangeLeaveSoundEnabled={change("leaveSoundEnabled")} onChangeStageSoundsEnabled={change("stageSoundsEnabled")}
      onChangeStageSoundsVolume={change("stageSoundsVolume")} onToggleColorCorrection={change("colorCorrectionEnabled")}
      onChangeBrightness={change("brightness")} onChangeContrast={change("contrast")} onChangeSaturate={change("saturate")} />
  </main>;
}
const root = createRoot(document.getElementById("root")!);
root.render(<Preview />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
