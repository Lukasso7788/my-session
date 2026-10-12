import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PreJoinModal } from "../../src/pages/livekit/PreJoinModalLiveKit";
import "../../src/index.css";

function fixtureDevice(deviceId: string, label: string, kind: MediaDeviceKind): MediaDeviceInfo {
  return { deviceId, label, kind, groupId: "fixture", toJSON: () => ({ deviceId, label, kind }) };
}
function Preview() {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState({ displayName: "Preview user", audioInputId: "mic-usb", videoInputId: "camera-obs", audioOutputId: "default", audioEnabled: false, videoEnabled: true, echoCancellation: true, noiseSuppression: true, autoGainControl: true });
  const [mode, setMode] = useState<"off" | "blur" | "bg">("off");
  const [background, setBackground] = useState("");
  const [blur, setBlur] = useState(12);
  const theme = new URLSearchParams(window.location.search).get("theme") === "light" ? "light" : "dark";
  return <main style={{ minHeight: "100vh", padding: 24, background: theme === "light" ? "#F3F1F1" : "#1B1B1B", color: theme === "light" ? "#20242D" : "white" }}>
    <button onClick={() => setOpen(true)}>Reopen pre-join</button>
    <output aria-label="Fixture state" style={{ display: "block", overflowWrap: "anywhere" }}>{JSON.stringify({ value, mode, background, blur, open })}</output>
    <PreJoinModal open={open} theme={theme} value={value} onChange={setValue}
      devices={{ audioInputs: [fixtureDevice("mic-usb", "Microphone (Webcam) — a very long device name to test truncation", "audioinput"), fixtureDevice("mic-headset", "Headset microphone", "audioinput")], videoInputs: [fixtureDevice("camera-obs", "OBS Virtual Camera", "videoinput"), fixtureDevice("camera-usb", "USB Camera", "videoinput")], audioOutputs: Array.from({ length: 12 }, (_, i) => fixtureDevice(`speaker-${i}`, `Speaker ${i + 1}`, "audiooutput")) }}
      onJoin={() => setOpen(false)} onCancel={() => setOpen(false)} onRefreshDevices={() => {}}
      videoFxMode={mode} blurStrength={blur} bgImageUrl={background} fxApplying={false} fxError="" fxStatusText=""
      fxBgPresets={[{ id: "room", label: "Room illustration", url: "/icons/prejoin-room-check.svg" }]}
      customBackgroundSlots={[{ id: "slot-1", label: "Custom 1", dataUrl: "/icons/prejoin-background-image.svg" }]}
      onApplyVideoFx={(next, url) => { setMode(next); if (url) setBackground(url); }} onUploadCustomBackground={() => {}}
      onClearCustomBackground={() => {}} onBlurStrengthChange={setBlur} onSetBgImageUrl={setBackground} onResetBg={() => setMode("off")} />
  </main>;
}
const root = createRoot(document.getElementById("root")!);
root.render(<Preview />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
