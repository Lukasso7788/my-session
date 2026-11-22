import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LiveKitBottomBar } from "../../src/pages/livekit/LiveKitBottomBarLegacy";
import SessionAiPanel from "../../src/components/session-ai/SessionAiPanel";
import FocusShieldPanel from "../../src/components/focusshield/FocusShieldPanel";
import "../../src/index.css";

const noop = () => {};

export function SessionPanelsHarness() {
  const [panel, setPanel] = useState<"ai" | "focus">("ai");
  const [shieldOn, setShieldOn] = useState(false);

  useEffect(() => {
    const onShield = (event: Event) => {
      const detail = (event as CustomEvent<{ active?: boolean }>).detail;
      setShieldOn(Boolean(detail?.active));
    };
    window.addEventListener("mysession:focus-shield", onShield);
    return () => window.removeEventListener("mysession:focus-shield", onShield);
  }, []);

  return (
    <main className="min-h-screen bg-[#1B1B1B] text-white">
      <div className="mx-auto grid max-w-[1100px] grid-cols-1 gap-4 p-4 pb-28 md:grid-cols-[1fr_380px]">
        <section className="hidden rounded-2xl border border-white/10 p-6 md:block">
          <h1 className="text-xl font-semibold">Session</h1>
          <p className="mt-2 text-sm text-white/60">AI and Focus Shield open from the bottom controls.</p>
        </section>
        <section className="h-[720px] overflow-hidden rounded-2xl border border-[#D8D0D0] bg-[#F3F1F1] text-[#1F1F1F]" data-panel-theme="light">
          {panel === "ai" ? (
            <SessionAiPanel
              theme="light"
              sessionId="session-1"
              currentUserId="user-1"
              currentUserName="Ada Lovelace"
              onClose={() => setPanel("ai")}
            />
          ) : (
            <FocusShieldPanel theme="light" userId="user-1" onClose={() => setPanel("focus")} />
          )}
        </section>
      </div>
      <LiveKitBottomBar
        theme="light"
        isLight
        bottomBarBg="bg-[#F3F1F1] border-t border-[#D8D0D0]"
        ctlBtnBase="bg-white text-[#2F2F2F] hover:bg-[#EFEFEF]"
        connected
        micOn
        camOn={false}
        screenShareOn={false}
        onToggleMic={noop}
        onToggleCam={noop}
        onToggleScreenShare={noop}
        onLeave={noop}
        onOpenParticipants={noop}
        onOpenChat={noop}
        onOpenTasks={noop}
        onOpenSettings={noop}
        onSendReaction={noop}
        onOpenAi={() => setPanel("ai")}
        onOpenFocusShield={() => setPanel("focus")}
        focusShieldActive={shieldOn}
        activePanel={panel}
        audioInputs={[]}
        videoInputs={[]}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<SessionPanelsHarness />);
