import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import RoomTopBar from "../../src/components/RoomTopBar";
import RoomJoiningTip from "../../src/components/RoomJoiningTip";
import { LiveKitBottomBar } from "../../src/pages/livekit/LiveKitBottomBarLegacy";
import "../../src/index.css";
import "../../src/pages/livekit/room-chrome-motion.css";

// Dev-only preview of the room entrance: the real top bar and bottom bar with
// fixture data, fake video tiles and a fake chat panel. "Replay join" runs the
// same sequence as the room: when prejoin closes the chrome slides in while
// the joining tip shows, and the tiles appear once "connected". No LiveKit,
// camera or network.

const noop = () => {};
const people = ["Maya", "Pramish", "Alex", "You"];
const stages = [
  { name: "Focus", duration: 50, color: "#5286F6", type: "focus" },
  { name: "Break", duration: 10, color: "#52B788", type: "break" },
];

function Preview() {
  const [theme, setTheme] = useState<"light" | "dark">(new URLSearchParams(window.location.search).get("theme") === "light" ? "light" : "dark");
  const [run, setRun] = useState(0);
  const [connected, setConnected] = useState(false);
  const [chromeIn, setChromeIn] = useState(false);
  const isLight = theme === "light";

  useEffect(() => {
    setConnected(false);
    setChromeIn(false);
    // 400ms stands in for prejoin; Join closes it and the chrome enters at once.
    const reveal = window.setTimeout(() => setChromeIn(true), 400);
    const connect = window.setTimeout(() => setConnected(true), 400 + 2200);
    return () => { window.clearTimeout(connect); window.clearTimeout(reveal); };
  }, [run]);

  const tile = isLight ? "bg-white border border-[#D8D0D0]" : "bg-[#242424] border border-[#2B2B2B]";
  const avatar = isLight ? "bg-[#E7E7E7] text-[#2F2F2F]" : "bg-[#2F2F2F] text-white";
  const panel = isLight ? "bg-[#F3F1F1] border border-[#D8D0D0]" : "bg-[#1B1B1B] border border-[#2B2B2B]";
  const bubble = isLight ? "bg-white" : "bg-[#242424]";

  return (
    <div className={`ms-room-page h-[100dvh] overflow-hidden ${isLight ? "bg-[#F3F1F1] text-[#1F1F1F]" : "bg-[#1B1B1B] text-white"}`} data-room-chrome={chromeIn ? "in" : "pending"}>
      <div className="fixed left-3 top-3 z-[200] flex gap-2">
        <button type="button" onClick={() => setRun((n) => n + 1)} className="h-8 rounded-lg bg-[#5286F6] px-3 text-[12px] font-semibold text-white">Replay join</button>
        <button type="button" onClick={() => setTheme(isLight ? "dark" : "light")} className={`h-8 rounded-lg px-3 text-[12px] font-semibold ${isLight ? "bg-[#2F2F2F] text-white" : "bg-white text-[#2F2F2F]"}`}>{isLight ? "Dark" : "Light"}</button>
      </div>

      <div className="relative isolate flex h-full w-full min-h-0 flex-col gap-2 px-2 pb-[calc(68px+env(safe-area-inset-bottom))] pt-2 sm:px-3 sm:pb-[calc(72px+env(safe-area-inset-bottom))]">
        <RoomTopBar theme={theme} sessionTitle="Deep work · 24/7 room" participantsCount={4} maxParticipants={16}
          isSilentRoom={false} stages={stages} stagebarStartTime={new Date(Date.now() - 12 * 60_000).toISOString()}
          remainingTime="38:12" currentStage={stages[0]} onToggleTheme={() => setTheme(isLight ? "dark" : "light")} />

        <div className="relative z-0 grid min-h-0 flex-1 gap-3" style={{ gridTemplateColumns: "minmax(0, 1fr) 340px" }}>
          <div className="relative min-h-0">
            {connected ? (
              <div key={run} className="grid h-full gap-2" style={{ gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" }}>
                {people.map((name) => (
                  <div key={name} className={`relative flex items-center justify-center rounded-2xl ${tile}`}>
                    <div className={`flex h-16 w-16 items-center justify-center rounded-full text-xl font-semibold ${avatar}`}>{name[0]}</div>
                    <span className={`absolute bottom-2 left-2 rounded-lg px-2 py-1 text-[11px] font-medium ${avatar}`}>{name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <RoomJoiningTip key={run} theme={theme} status="Connecting to room..." />
              </div>
            )}
          </div>
          <div className="ms-room-side min-h-0">
            <div className={`flex h-full flex-col gap-2 rounded-2xl p-3 ${panel}`}>
              <div className="text-[13px] font-semibold">Chat</div>
              {["Morning all 👋", "Starting on the report", "Same, 50 min focus"].map((text) => (
                <div key={text} className={`w-fit max-w-[85%] rounded-2xl px-3 py-2 text-[12px] ${bubble}`}>{text}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <LiveKitBottomBar theme={theme} isLight={isLight} bottomBarBg={isLight ? "bg-[#F3F1F1]" : "bg-[#1B1B1B]"}
        ctlBtnBase={isLight ? "bg-[#E7E7E7] hover:bg-[#DCDCDC] text-black/75" : "bg-[#242424] hover:bg-[#2E2E2E] text-white/90"}
        connected={connected} micOn camOn screenShareOn={false}
        onToggleMic={noop} onToggleCam={noop} onToggleScreenShare={noop} onLeave={noop}
        onOpenParticipants={noop} onOpenChat={noop} onOpenTasks={noop} onOpenSettings={noop} onSendReaction={noop}
        audioInputs={[]} videoInputs={[]} selectedAudioInputId="" selectedVideoInputId=""
        onChangeAudioInput={noop} onChangeVideoInput={noop} videoFxMode="off" blurStrength={10}
        onBlurStrengthChange={noop} backgroundPresets={[]} customBackgroundSlots={[]} onApplyVideoFx={noop}
        activePanel="chat" />
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<Preview />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
