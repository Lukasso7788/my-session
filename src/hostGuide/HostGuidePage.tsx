import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { GUIDE_ME, GUIDE_PEOPLE, GUIDE_SESSION_ID, type GuidePerson } from "./people";
import { demoTables } from "./demoClient";
import type { GuideVisitor } from "./visitor";
import { STATUS_GUIDE, STATUS_RULE, StatusBadge } from "./statuses";
import RoomTopBar from "../components/RoomTopBar";
import TasksPanel from "../components/TasksPanel";
import { VideoTile } from "../pages/livekit/VideoTileLiveKit";
import { LiveKitBottomBar } from "../pages/livekit/LiveKitBottomBar";
import { GridLayoutSizing } from "../pages/livekit/sizing";

// The /host-guide page (entry: src/hostGuide/main.tsx): a compact, visual
// guide whose walkthrough plays a session in the real room UI (the room's own
// top bar, video tiles, task panel and bottom bar) with fixture data from the
// in-memory demo client. The signed-in visitor plays the host.
// Page styles live in the CSS string below.

type FormatId = "silent" | "bookends" | "verbal";
type Voice = "talk" | "chat" | "quiet";

const C = { welcome: "#80DF86", intentions: "#ADD3FF", focus: "#5286F6", checkin: "#ADD3FF", recap: "#A78BFA", ink: "#2F2F2F" };

const FORMATS: Record<FormatId, { name: string; short: string; best: string; start: Voice; checkins: Voice; end: Voice }> = {
  verbal: { name: "Fully verbal", short: "Talk at start, every check-in and end.", best: "Regular groups, buddies", start: "talk", checkins: "talk", end: "talk" },
  bookends: { name: "Verbal start & end", short: "Talk at start and end. Quiet breaks.", best: "Most sessions", start: "talk", checkins: "chat", end: "talk" },
  silent: { name: "Silent", short: "No talking. Chat only.", best: "Deep work, shy groups, first-time hosts", start: "chat", checkins: "quiet", end: "chat" },
};

const VOICE_LABEL: Record<Voice, string> = { talk: "Talk", chat: "Chat", quiet: "Quiet" };
const VOICE_ICON: Record<Voice, string> = { talk: "🎙", chat: "💬", quiet: "🤫" };

type RoomStage = { name: string; duration: number; color: string; type: string };

function stagesFor(format: FormatId): RoomStage[] {
  if (format === "silent") {
    return [
      { name: "Focus", duration: 50, color: C.focus, type: "focus" },
      { name: "Break", duration: 10, color: C.checkin, type: "break" },
      { name: "Focus", duration: 50, color: C.focus, type: "focus" },
    ];
  }
  return [
    { name: "Welcome", duration: 3, color: C.welcome, type: "intro" },
    { name: "Intentions", duration: 5, color: C.intentions, type: "intentions" },
    { name: "Focus", duration: 50, color: C.focus, type: "focus" },
    { name: format === "verbal" ? "Check-in & break" : "Break", duration: 10, color: C.checkin, type: "break" },
    { name: "Focus", duration: 50, color: C.focus, type: "focus" },
    { name: "Recap", duration: 5, color: C.recap, type: "outro" },
  ];
}

type Host = { name: string; avatar?: string };

// The visitor plays the host: their first name and photo on the host tile.
function peopleWithHost(host: Host): GuidePerson[] {
  return GUIDE_PEOPLE.map((p, i) => (i === 0 ? { ...p, name: host.name, avatar: host.avatar || '' } : p));
}

type Scene = {
  key: string;
  label: string;
  color: string;
  caption: string;
  /** Index into stagesFor(format); -1 = before the session starts. */
  stage: number;
  minutesIn: number;
  speaking?: number[];
  says?: string; // what the speaker says, shown under the room
  /** People whose task appears in the task panel during this scene. */
  adds?: number[];
  done?: boolean;
};

function scenesFor(format: FormatId): Scene[] {
  const f = FORMATS[format];
  const silent = format === "silent";
  const s = (name: string) => stagesFor(format).findIndex((st) => st.name === name);
  const focus1 = s("Focus");
  const brk = silent ? 1 : 3;
  const lastFocus = silent ? 2 : 4;

  const scenes: Scene[] = [];
  // Spoken parts go host question -> answer, addressing people by name; each
  // person's task lands in the task panel right after they say it.
  if (f.start === "talk") {
    scenes.push({ key: "open", label: "Before", color: "#BDBDBD", stage: -1, minutesIn: 0, adds: [3], caption: "Open the room 5 minutes early. People can add their task before the start." });
    scenes.push({ key: "welcome", label: "Welcome", color: C.welcome, stage: 0, minutesIn: 1, speaking: [0], says: "Hi Maya, hi Jo, hi Alex! Welcome, everyone. Goals first, then 50 minutes of focus with mics off, a break, another 50, and a recap.", caption: "Greet people by name and say the plan in one breath." });
    scenes.push({ key: "intentions-you", label: "Intentions", color: C.intentions, stage: 1, minutesIn: 1, speaking: [0], adds: [0], says: "I'll go first: finishing the onboarding email. Maya, how about you?", caption: "You go first, so everyone hears how short an answer is. Then pass it on by name." });
    scenes.push({ key: "intentions-maya", label: "Intentions", color: C.intentions, stage: 1, minutesIn: 2, speaking: [1], adds: [1], says: "Drafting the Q4 roadmap intro.", caption: "One sentence each. Their task shows up in the task panel." });
    scenes.push({ key: "intentions-ask-alex", label: "Intentions", color: C.intentions, stage: 1, minutesIn: 3, speaking: [0], says: "Nice. Alex, how about you?", caption: "Keep passing it on by name." });
    scenes.push({ key: "intentions-alex", label: "Intentions", color: C.intentions, stage: 1, minutesIn: 4, speaking: [2], adds: [2], says: "Outlining the body doubling guide.", caption: "Jo shows \"Skip me\", so you skip him without a word. That's the round." });
    scenes.push({ key: "music", label: "Music", color: C.focus, stage: 1, minutesIn: 5, speaking: [0], says: MUSIC_LINE, caption: "Playing music? Say how to mute it before you press play. Mute sits next to Music, bottom right." });
  } else {
    scenes.push({ key: "open", label: "Before", color: "#BDBDBD", stage: -1, minutesIn: 0, caption: "Open the room 5 minutes early. Nobody will talk today." });
    scenes.push({ key: "welcome", label: "Start", color: C.welcome, stage: focus1, minutesIn: 0, adds: [0], caption: "Start on time. Add your own task first: it shows the room what you're doing." });
    scenes.push({ key: "goals", label: "Tasks", color: C.intentions, stage: focus1, minutesIn: 1, adds: [1, 2, 3], caption: "Everyone adds their task in silence. They appear in the task panel and on the tiles." });
    scenes.push({ key: "music", label: "Music", color: C.focus, stage: focus1, minutesIn: 2, caption: "Playing music? Post in chat first that Mute, next to Music in the bottom right, turns it off for them." });
  }
  scenes.push({ key: "focus", label: "Focus", color: C.focus, stage: focus1, minutesIn: 12, caption: "Mics off, cameras on. Protect the quiet; mute a stray mic from its tile." });
  if (f.checkins === "talk") {
    scenes.push({ key: "checkin-ask-alex", label: "Check-in", color: C.checkin, stage: brk, minutesIn: 0, speaking: [0], says: "Quick check-in before the break. Alex, how did that block go?", caption: "Quick round by name: how did it go, anything blocking?" });
    scenes.push({ key: "checkin-alex", label: "Check-in", color: C.checkin, stage: brk, minutesIn: 1, speaking: [2], says: "Halfway there, stuck on the second section.", caption: "About 20 seconds each." });
    scenes.push({ key: "checkin-ask-maya", label: "Check-in", color: C.checkin, stage: brk, minutesIn: 1, speaking: [0], says: "Maya, how about you?", caption: "Keep it moving, then call a real break." });
    scenes.push({ key: "checkin-maya", label: "Check-in", color: C.checkin, stage: brk, minutesIn: 2, speaking: [1], says: "Pretty good, the intro is almost done.", caption: "Then everyone mutes and takes the break." });
  } else {
    scenes.push({ key: "break", label: "Break", color: C.checkin, stage: brk, minutesIn: 1, caption: "A quiet break. Stretch, water, step away. No spoken round." });
  }
  if (f.end === "talk") {
    scenes.push({ key: "recap-ask-maya", label: "Recap", color: C.recap, stage: s("Recap"), minutesIn: 1, speaking: [0], says: "Let's wrap up. Maya, how did it go? What did you get done?", done: true, caption: "Go around once more: what got done, what's next." });
    scenes.push({ key: "recap-maya", label: "Recap", color: C.recap, stage: s("Recap"), minutesIn: 2, speaking: [1], says: "I finished the intro draft! Next step is getting feedback.", done: true, caption: "Celebrate progress, not perfection." });
    scenes.push({ key: "recap-bye", label: "Recap", color: C.recap, stage: s("Recap"), minutesIn: 4, speaking: [0], says: "Love it. Thanks, everyone, great session. See you tomorrow!", done: true, caption: "Thank people and invite them to the next session." });
  } else {
    scenes.push({ key: "end", label: "End", color: C.recap, stage: lastFocus, minutesIn: 49, done: true, caption: "Tasks get ticked off. Thank everyone and point to the next session." });
  }
  return scenes;
}

// Also in host-guide-tts.mjs (recorded) and the "Music in the room" copy line.
const MUSIC_LINE = "I'm putting on some music. If it bothers you or you don't need it, use the Mute button next to Music in the bottom right corner. You can turn it back on there too.";

const SCENE_MS = 4500;
const TASK_REVEAL_MS = 1500; // without sound, a spoken task appears this long into the scene
const TASK_STAGGER_MS = 900; // silent tasks appear one after another
const ROOM_W = 1280;
const ROOM_H = 720;
const noop = () => {};

const taskId = (i: number) => `0000000${i}-6a1d-4c2b-9e3f-00000000000${i}`;

// Feeds the room's task panel: Anna's own tasks and the team's published tasks,
// then asks the panel to reload, as a real task change in the room would.
function setTasks(visible: number[], done: boolean) {
  const now = Date.now();
  const tables = demoTables;
  tables.panel_intentions = visible.includes(0)
    ? [{
      id: taskId(0), user_id: GUIDE_ME, text: GUIDE_PEOPLE[0].task, focus_plan_item_id: null, completed: done,
      created_at: new Date(now - 60_000).toISOString(), updated_at: new Date(now - 60_000).toISOString(), visibility: "public", sort_order: 0,
    }]
    : [];
  tables.intentions = visible.filter((i) => i !== 0).map((i, order) => ({
    id: taskId(i), text: GUIDE_PEOPLE[i].task, user_id: GUIDE_PEOPLE[i].id, session_id: GUIDE_SESSION_ID,
    created_at: new Date(now - (10 - order) * 60_000).toISOString(), completed: done,
    profiles: { full_name: GUIDE_PEOPLE[i].name, avatar_url: GUIDE_PEOPLE[i].avatar },
  }));
  window.dispatchEvent(new CustomEvent("mysession:tasks-synced", { detail: { sessionId: GUIDE_SESSION_ID } }));
}

function RoomScene({ format, scene, visible, people, musicOn }: { format: FormatId; scene: Scene; visible: number[]; people: GuidePerson[]; musicOn: boolean }) {
  const stages = useMemo(() => stagesFor(format), [format]);
  const current = scene.stage >= 0 ? stages[scene.stage] : stages[0];
  const offset = stages.slice(0, Math.max(0, scene.stage)).reduce((sum, st) => sum + st.duration, 0);
  const start = scene.stage < 0
    ? new Date(Date.now() + 5 * 60_000).toISOString()
    : new Date(Date.now() - (offset + scene.minutesIn) * 60_000).toISOString();
  const left = scene.stage < 0 ? 5 : Math.max(0, current.duration - scene.minutesIn);
  // The room feeds the same countdown to the top bar and the task panel timer.
  const remaining = scene.stage < 0 ? `Starts in ${left}:00` : `${String(left).padStart(2, "0")}:00`;
  const visibleKey = visible.join(",");
  const done = !!scene.done;

  useEffect(() => {
    setTasks(visible, done);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, done]);

  // The video stage's layout size (offset sizes ignore the guide's scale transform).
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const update = () => setStageSize({ width: node.offsetWidth, height: node.offsetHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Mirrors RoomPageLiveKit: top bar, then the video stage and the side panel
  // (grid gap-3, 360px panel at 1280px), tiles laid out by GridLayoutSizing.
  return (
    <div className={`ms-room-page relative h-full w-full overflow-hidden bg-[#1B1B1B] text-white ${scene.key === "music" ? "hg-music-scene" : ""}`} data-room-chrome="in">
      <div className="relative isolate h-full w-full px-3 pt-2 flex flex-col gap-2 min-h-0" style={{ paddingBottom: 72 }}>
        <RoomTopBar
          theme="dark"
          sessionTitle="50/10 Deep Work"
          participantsCount={GUIDE_PEOPLE.length}
          maxParticipants={12}
          isSilentRoom={false}
          stages={stages}
          stagebarStartTime={start}
          remainingTime={remaining}
          currentStage={current}
          hostProfile={{ id: people[0].id, full_name: people[0].name, avatar_url: people[0].avatar || null }}
          isInfiniteRoom={false}
          canEditTimeline
          onEditTimeline={noop}
          onOpenHostProfile={noop}
          onToggleTheme={noop}
        />
        <div className="relative isolate z-0 grid grid-rows-1 gap-2 sm:gap-3 flex-1 min-h-0 h-full" style={{ gridTemplateColumns: "minmax(0, 1fr) 360px" /* room width at 1280px */ }}>
          <div ref={stageRef} className="ms-video-stage relative rounded-2xl overflow-hidden min-h-0 h-full bg-[#1B1B1B] border border-[#252525]">
            <div className="w-full h-full min-w-0 min-h-0 relative overflow-hidden">
              <div className="h-full w-full min-w-0 min-h-0 overflow-hidden">
                {stageSize.width > 0 ? (
                  <GridLayoutSizing<GuidePerson>
                    items={people}
                    containerWidth={stageSize.width}
                    containerHeight={stageSize.height}
                    rightPanelOpen
                    mobileOrTablet={false}
                    renderItem={(p) => {
                      const i = people.indexOf(p);
                      const speaking = !!scene.speaking?.includes(i);
                      const hasTask = visible.includes(i);
                      return (
                        <div className="relative group w-full min-w-0 min-h-0" style={{ aspectRatio: "16 / 9" }}>
                          <div className="absolute inset-0">
                            <VideoTile
                              tileId={`guide-${p.id}`}
                              label={p.name}
                              status={p.status || null}
                              isLocal={i === 0}
                              theme="dark"
                              showBadge={i === 0 ? "Host (you)" : null}
                              avatarUrl={p.avatar || undefined}
                              micMuted={!speaking}
                              isSpeaking={speaking}
                              currentIntention={hasTask && !done ? p.task : null}
                              taskList={hasTask && done ? [{ text: p.task, completed: true }] : []}
                              showTaskOverlay
                              showBottomShade
                              participantTimeZone={p.tz}
                              showMenuButton
                              onToggleMenu={noop}
                              onOpenProfile={noop}
                            />
                          </div>
                        </div>
                      );
                    }}
                  />
                ) : null}
              </div>
            </div>
          </div>
          {/* Same markup as the room's light Tasks side panel (RoomPageLiveKit, rightTab === "tasks"). */}
          <div className="ms-room-side hg-tasks min-h-0 h-full overflow-hidden">
            <div className="ms-room-side-panel rounded-2xl shadow-lg overflow-hidden min-h-0 h-full flex flex-col bg-[#F3F1F1] border border-[#D8D0D0]">
              <div data-side-panel-section="tasks" className="ms-tasks-panel-scrollbars h-full min-h-0 flex flex-col">
                <div className="flex min-h-[44px] items-center justify-between border-b px-3 py-1.5 border-[#D8D0D0] bg-[#F3F1F1]">
                  <div className="flex min-w-0 items-center gap-2">
                    <img src="/icons/tasks-light.svg" alt="" className="h-4 w-4 shrink-0" draggable={false} />
                    <div className="font-inter text-[12px] font-semibold text-black/85">Tasks</div>
                  </div>
                  <button className="flex h-8 w-8 items-center justify-center rounded-[10px] transition bg-[#E6E6E6] text-black/60 hover:bg-[#DCDCDC]" title="Close">✕</button>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden p-3">
                  <div className="h-full min-h-0 overflow-hidden rounded-xl border bg-[#F3F1F1] border-[#D8D0D0]">
                    <div className="h-full min-h-0 overflow-y-auto [&>*]:min-h-0">
                      <div data-theme="light" style={{ colorScheme: "light" }} className="h-full min-h-0">
                        <TasksPanel sessionId={GUIDE_SESSION_ID} currentUserId={GUIDE_ME} theme="light" timerText={remaining} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <LiveKitBottomBar
        theme="dark"
        isLight={false}
        bottomBarBg="bg-[#1B1B1B]"
        ctlBtnBase="bg-[#242424] hover:bg-[#2E2E2E] text-white/90"
        connected
        micOn={!!scene.speaking?.includes(0)}
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
        audioInputs={[]}
        videoInputs={[]}
        selectedAudioInputId=""
        selectedVideoInputId=""
        onChangeAudioInput={noop}
        onChangeVideoInput={noop}
        videoFxMode="off"
        blurStrength={10}
        onBlurStrengthChange={noop}
        backgroundPresets={[]}
        customBackgroundSlots={[]}
        onApplyVideoFx={noop}
        activePanel="tasks"
        voiceUiMode="off"
        onToggleVoiceUi={noop}
        showPiP
        pipActive={false}
        onTogglePiP={noop}
        cameraMirrored
        onToggleCameraMirrored={noop}
        onOpenBugReport={noop}
        showAIHost={false}
        soundscapeActive={musicOn}
        onOpenSoundscapes={noop}
        onToggleSoundscapeMute={noop}
      />
    </div>
  );
}

// Recorded AI voices (generated once with OpenAI TTS by scripts/host-guide-tts.mjs):
// "Speaker|text" -> mp3 file in public/host-guide/audio/.
const AUDIO_BASE = "/host-guide/audio/";
function useVoiceManifest() {
  const [manifest, setManifest] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    fetch(`${AUDIO_BASE}manifest.json`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setManifest(data && typeof data === "object" ? data : {}))
      .catch(() => setManifest({}));
  }, []);
  return manifest;
}

// Player icons. Volume icons are the design-kit volume.svg / volume-up.svg, recolored via currentColor.
const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M5 3.5v13a1 1 0 0 0 1.52.85l10.5-6.5a1 1 0 0 0 0-1.7L6.52 2.65A1 1 0 0 0 5 3.5z" /></svg>
);
const PauseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true"><rect fill="currentColor" x="4" y="3" width="4.5" height="14" rx="1.2" /><rect fill="currentColor" x="11.5" y="3" width="4.5" height="14" rx="1.2" /></svg>
);
const VolumeOffIcon = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><g fill="currentColor" fillRule="evenodd" clipRule="evenodd"><path d="m9.38268 3.07615c.37368.15478.61732.51942.61732.92388v11.99997c0 .4045-.24364.7691-.61732.9239-.37367.1548-.80379.0692-1.08979-.2168l-3.7071-3.7071h-2.58579c-.55228 0-1-.4477-1-1v-3.99997c0-.55229.44772-1 1-1h2.58579l3.7071-3.70711c.286-.286.71612-.37155 1.08979-.21677z" /><path d="m12.2929 7.29289c.3905-.39052 1.0237-.39052 1.4142 0l1.2929 1.2929 1.2929-1.2929c.3905-.39052 1.0237-.39052 1.4142 0 .3905.39053.3905 1.02369 0 1.41422l-1.2929 1.29289 1.2929 1.2929c.3905.3905.3905 1.0237 0 1.4142s-1.0237.3905-1.4142 0l-1.2929-1.2929-1.2929 1.2929c-.3905.3905-1.0237.3905-1.4142 0s-.3905-1.0237 0-1.4142l1.2929-1.2929-1.2929-1.29289c-.3905-.39053-.3905-1.02369 0-1.41422z" /></g></svg>
);
const VolumeUpIcon = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="m9.383 3.07602c.18269.07574.33881.20395.44863.36842.10983.16447.16837.35781.16837.55558v11.99998c-.00004.1978-.05871.3911-.1686.5555-.10988.1644-.26605.2925-.44875.3682s-.38373.0955-.57768.0569-.37212-.1338-.51197-.2736l-3.707-3.707h-2.586c-.26522 0-.51957-.1053-.70711-.2929-.18753-.1875-.29289-.4419-.29289-.7071v-3.99998c0-.26522.10536-.51957.29289-.70711.18754-.18754.44189-.29289.70711-.29289h2.586l3.707-3.707c.13985-.13994.31805-.23524.51208-.27387.19402-.03863.39515-.01884.57792.05687zm5.274-.147c.1875-.18747.4418-.29279.707-.29279s.5195.10532.707.29279c.9298.92765 1.6672 2.02985 2.1699 3.24331.5026 1.21345.7606 2.51425.7591 3.82767.0015 1.3135-.2565 2.6143-.7591 3.8277-.5027 1.2135-1.2401 2.3157-2.1699 3.2433-.1886.1822-.4412.283-.7034.2807s-.513-.1075-.6984-.2929-.2906-.4362-.2929-.6984.0985-.5148.2807-.7034c.7441-.7419 1.3342-1.6237 1.7363-2.5945.4022-.9709.6083-2.0117.6067-3.0625 0-2.20998-.894-4.20798-2.343-5.65698-.1875-.18753-.2928-.44184-.2928-.707 0-.26517.1053-.51948.2928-.707zm-2.829 2.828c.0929-.09298.2032-.16674.3246-.21706.1214-.05033.2515-.07623.3829-.07623s.2615.0259.3829.07623c.1214.05032.2317.12408.3246.21706.5579.55666 1.0003 1.21806 1.3018 1.94621.3015.72814.4562 1.50868.4552 2.29677.001.7881-.1537 1.5686-.4553 2.2968-.3015.7281-.7439 1.3895-1.3017 1.9462-.1876.1877-.4421.2931-.7075.2931s-.5199-.1054-.7075-.2931c-.1876-.1876-.2931-.4421-.2931-.7075 0-.2653.1055-.5198.2931-.7075.3722-.3708.6673-.8116.8685-1.2969.2011-.4854.3043-1.0057.3035-1.5311.0008-.52537-.1023-1.04572-.3035-1.53107-.2011-.48536-.4963-.92612-.8685-1.29691-.093-.09288-.1667-.20316-.2171-.32456-.0503-.1214-.0762-.25153-.0762-.38294 0-.13142.0259-.26155.0762-.38294.0504-.1214.1241-.23169.2171-.32456z" /></svg>
);

function Walkthrough({ format, host }: { format: FormatId; host: Host }) {
  const scenes = useMemo(() => scenesFor(format), [format]);
  const people = useMemo(() => peopleWithHost(host), [host]);
  const [index, setIndex] = useState(0);
  // Starts paused behind a big Play button; ?play=1 autoplays, ?scene=N opens a step.
  const [playing, setPlaying] = useState(new URLSearchParams(location.search).get("play") === "1");
  const [started, setStarted] = useState(() => {
    const params = new URLSearchParams(location.search);
    return params.get("play") === "1" || params.has("scene");
  });
  const [tick, setTick] = useState(0); // restarts the progress animation
  const [scale, setScale] = useState(0.4);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef(0);

  useLayoutEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const update = () => setScale(node.clientWidth / ROOM_W);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const start = Number(new URLSearchParams(location.search).get("scene") || 0);
    setIndex(Math.min(start, scenes.length - 1));
    setTick((t) => t + 1);
  }, [format, scenes.length]);
  // Voices: with sound on, the speaker's recorded line plays and the scene
  // waits for it to finish before moving on.
  const [soundOn, setSoundOn] = useState(true); // voices are on by default
  const [voiceMs, setVoiceMs] = useState<number | null>(null);
  const manifest = useVoiceManifest();
  const hasRecordings = !!manifest && Object.keys(manifest).length > 0;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const s = scenes[index];
  const speakerIndex = s.speaking?.length ? s.speaking[0] : -1;
  // Recordings are keyed by the original speaker names; the bubble shows who is talking.
  const speaker = speakerIndex >= 0 ? GUIDE_PEOPLE[speakerIndex].name : null;
  const speakerShown = speakerIndex >= 0 ? people[speakerIndex].name : null;

  // How many of this scene's tasks have appeared so far.
  const [revealed, setRevealed] = useState(0);
  const voiceFile = speaker && s.says ? manifest?.[`${speaker}|${s.says}`] : undefined;
  const waitsForVoice = started && soundOn && !!voiceFile;

  useEffect(() => {
    setVoiceMs(null);
    audioRef.current?.pause();
    if (!waitsForVoice) return;
    const audio = new Audio(`${AUDIO_BASE}${voiceFile}`);
    audioRef.current = audio;
    const startedAt = Date.now();
    setVoiceMs(15_000); // hold the scene while the line plays (safety cap)
    audio.onended = () => {
      setRevealed(s.adds?.length || 0); // the task lands once they've said it
      setVoiceMs(Math.max(1600, Date.now() - startedAt + 1300));
    };
    audio.onerror = () => { setVoiceMs(null); setRevealed(s.adds?.length || 0); };
    // Autoplay blocked or file missing: show the tasks anyway.
    void audio.play().catch(() => { setVoiceMs(null); setRevealed(s.adds?.length || 0); });
    return () => audio.pause();
  }, [waitsForVoice, voiceFile, s.key, format]);

  useEffect(() => {
    setRevealed(0);
    const adds = s.adds || [];
    if (!adds.length || waitsForVoice) return;
    const timers = adds.map((_, i) =>
      window.setTimeout(() => setRevealed(i + 1), (s.says ? TASK_REVEAL_MS : 500) + i * TASK_STAGGER_MS),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [s.key, format, waitsForVoice]);

  // Music plays from the "music" scene on, so Music + Mute show in the bottom bar.
  const musicOn = scenes.slice(0, index + 1).some((scene) => scene.key === "music");
  const visible = useMemo(() => {
    const earlier = scenes.slice(0, index).flatMap((scene) => scene.adds || []);
    return [...earlier, ...(s.adds || []).slice(0, revealed)];
  }, [scenes, index, s.adds, revealed]);

  useEffect(() => {
    if (!playing) return;
    const wait = voiceMs != null ? Math.max(SCENE_MS, voiceMs) : SCENE_MS;
    timer.current = window.setTimeout(() => {
      setIndex((i) => (i + 1) % scenes.length);
      setTick((t) => t + 1);
    }, wait);
    return () => window.clearTimeout(timer.current);
  }, [playing, index, scenes.length, tick, voiceMs]);

  useEffect(() => () => audioRef.current?.pause(), []);

  const go = (i: number) => { setIndex(i); setTick((t) => t + 1); };

  // Consecutive scenes with the same label make one host step (Welcome, Intentions, ...).
  const steps = useMemo(() => {
    const list: { label: string; first: number; count: number }[] = [];
    scenes.forEach((scene, i) => {
      const last = list[list.length - 1];
      if (last && last.label === scene.label) last.count += 1;
      else list.push({ label: scene.label, first: i, count: 1 });
    });
    return list;
  }, [scenes]);
  const stepIndex = steps.findIndex((step) => index >= step.first && index < step.first + step.count);

  // First play from the big button also turns the voices on.
  const start = () => {
    setStarted(true);
    setPlaying(true);
    if (hasRecordings) setSoundOn(true);
    setTick((t) => t + 1);
  };

  return (
    <div className="hg-video">
      {/* The real room, scaled down to fit the card. */}
      <div ref={frameRef} className="hg-frame" style={{ height: ROOM_H * scale }}>
        <div style={{ position: "absolute", top: 0, left: 0, width: ROOM_W, height: ROOM_H, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          <RoomScene format={format} scene={s} visible={visible} people={people} musicOn={musicOn} />
        </div>
        {speaker && s.says && started ? (
          <div key={`${format}-${s.key}-says`} className={`hg-says ${s.key === "music" ? "left" : ""}`}><b>{speakerShown}{speakerIndex === 0 ? " (you)" : ""}:</b> “{s.says}”</div>
        ) : null}
        {!started ? (
          <button className="hg-start" onClick={start}>
            <span className="hg-start-icon">▶</span>
            <span>Watch the walkthrough{hasRecordings ? " with voices" : ""}</span>
          </button>
        ) : null}
      </div>

      {/* Player controls: one panel under the room, separate from it. */}
      <div className="hg-player">
        <div key={`${format}-${s.key}-cap`} className="hg-caption-text">
          <span className="hg-stepno">Step {stepIndex + 1} of {steps.length} · {s.label}</span>
          {s.caption}
        </div>
        <div className="hg-player-row">
          <button
            className={`hg-play ${playing ? "on" : ""}`}
            onClick={() => (started ? setPlaying((p) => !p) : start())}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
            {playing ? "Pause" : "Play"}
          </button>
          <ol className="hg-steps">
            {steps.map((step, i) => {
              const state = i < stepIndex ? "done" : i === stepIndex ? "now" : "";
              const fill = i < stepIndex ? 1 : i === stepIndex ? (index - step.first + 1) / step.count : 0;
              return (
                <li key={step.label + i}>
                  <button className={`hg-stepbtn ${state}`} onClick={() => { setStarted(true); go(step.first); }}>
                    <span className="hg-steplabel">
                      <span className="hg-stepnum">{i < stepIndex ? "✓" : i + 1}</span>
                      {step.label}
                    </span>
                    <span className="hg-steptrack"><span style={{ width: `${fill * 100}%` }} /></span>
                  </button>
                </li>
              );
            })}
          </ol>
          <button
            className={`hg-sound ${soundOn ? "on" : ""}`}
            onClick={() => {
              const next = !soundOn;
              setSoundOn(next);
              if (!next) audioRef.current?.pause();
            }}
            aria-pressed={soundOn}
            disabled={!hasRecordings}
            title={!hasRecordings ? "Voice recordings are not generated yet" : soundOn ? "Turn voices off" : "Turn voices on"}
          >
            {soundOn ? <VolumeUpIcon /> : <VolumeOffIcon />}
            {soundOn ? "Voices on" : "Voices off"}
          </button>
        </div>
        {hasRecordings ? <p className="hg-ai-note">Voices in this walkthrough are AI-generated.</p> : null}
      </div>
    </div>
  );
}

const STEPS = [
  { icon: "⏰", t: "Open early", d: "5 min before. Check mic, camera, set your task." },
  { icon: "👋", t: "Welcome", d: "Names, then the plan in one breath." },
  { icon: "🎯", t: "Intentions", d: "You first. One sentence each. Respect \"Skip me\"." },
  { icon: "🤫", t: "Focus", d: "Mics off, cameras on. Keep it quiet." },
  { icon: "☕", t: "Check-in & break", d: "Quick round (verbal) or a chat note (quiet)." },
  { icon: "🎉", t: "Recap", d: "Done, next step, thank you, see you next time." },
];

const LINES = [
  ["Welcome", "Hi everyone! Goals first, then 50 minutes of focus with mics off, a break, another 50, and a recap."],
  ["Intentions", "What are you working on, and what would \"done\" look like?"],
  ["Check-in", "Quick check-in: how did that block go, anything in your way?"],
  ["Break", "Break time, 10 minutes. Stretch and hydrate, back at :00."],
  ["Recap", "What did you get done, and what's the very next step?"],
];

const TROUBLE = [
  ["🕐", "Late joiner", "Wave, don't stop. They share their goal at the end of the round."],
  ["🗣", "Talking in focus", "Friendly chat note. Still going: mute their mic from the tile."],
  ["🔊", "Noise or echo", "Mute that mic from the tile menu."],
  ["🚫", "Inappropriate", "Camera off or remove from the tile menu, then report."],
  ["🪑", "Nobody came", "Run it anyway or wait 5 min. Rooms that focus attract people."],
  ["🏃", "You must leave", "Say so in chat. The timer keeps running for everyone."],
];

const CHECKLIST = ["Format in the description", "In the room 5 min early", "Task set on your tile", "Start on time", "You go first, one sentence", "Warn before music", "Mics off in focus", "Hands off anyone with a status", "Thank and invite back"];

function CopyLine({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="hg-line"
      onClick={() => { void navigator.clipboard?.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1300); }}
    >
      <span className="hg-line-label">{label}</span>
      <span className="hg-line-text">“{text}”</span>
      <span className="hg-line-copy">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

export default function HostGuide({ visitor }: { visitor: GuideVisitor }) {
  const [format, setFormat] = useState<FormatId>((new URLSearchParams(location.search).get("format") as FormatId) || "verbal");
  // The signed-in visitor plays the host in the walkthrough.
  const host = useMemo<Host>(() => ({ name: visitor.name, avatar: visitor.avatar || undefined }), [visitor.name, visitor.avatar]);
  return (
    <div className="hg">
      <style>{CSS}</style>
      <header className="hg-header"><a href="/">MySession</a></header>
      <main className="hg-main">
        <section className="hg-hero">
          <div className="hg-hero-text">
            <div>
              <p className="hg-kicker">Host guide</p>
              <h1>Host a focus session in 6 steps</h1>
            </div>
            <p className="hg-lead">You keep time, set the tone and make people welcome. No teaching, no coaching. Pick a format and watch how it runs in the room.</p>
          </div>
          <div>
            <div className="hg-formats" role="tablist">
              {(Object.keys(FORMATS) as FormatId[]).map((id) => (
                <button key={id} role="tab" aria-selected={format === id} className={format === id ? "on" : ""} onClick={() => setFormat(id)}>
                  <b>{FORMATS[id].name}</b>
                  <span>{FORMATS[id].short}</span>
                </button>
              ))}
            </div>
          </div>
          <Walkthrough format={format} host={host} />
        </section>

        <section className="hg-card">
          <h2>Formats at a glance</h2>
          <div className="hg-table">
            <div className="hg-row head"><span /><span>Start</span><span>Check-ins</span><span>Breaks</span><span>End</span><span>Best for</span></div>
            {(Object.keys(FORMATS) as FormatId[]).map((id) => {
              const f = FORMATS[id];
              const cell = (v: Voice) => <span className={`hg-voice ${v}`}>{VOICE_ICON[v]} {VOICE_LABEL[v]}</span>;
              return (
                <button key={id} className={`hg-row ${format === id ? "on" : ""}`} onClick={() => setFormat(id)}>
                  <b>{f.name}</b>{cell(f.start)}{cell(f.checkins)}{cell(f.checkins === "talk" ? "chat" : f.checkins === "quiet" ? "quiet" : "chat")}{cell(f.end)}<span className="hg-best">{f.best}</span>
                </button>
              );
            })}
          </div>
          <p className="hg-note">Focus blocks are always quiet, in every format.</p>
        </section>

        <section className="hg-card">
          <h2>The flow</h2>
          <div className="hg-steps">
            {STEPS.map((step, i) => (
              <div key={step.t} className="hg-step">
                <div className="hg-step-top"><span className="hg-step-icon">{step.icon}</span><span className="hg-step-n">{i + 1}</span></div>
                <b>{step.t}</b>
                <p>{step.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="hg-card">
          <h2>Statuses in the room</h2>
          <p className="hg-rule">{STATUS_RULE}</p>
          <div className="hg-statuses">
            {STATUS_GUIDE.map((st) => (
              <div key={st.key} className="hg-st">
                <div className="hg-st-badge"><StatusBadge status={st} /></div>
                <div>
                  <b>{st.meaning}</b>
                  <p>{st.host}</p>
                  {st.exception ? <p className="hg-exception">{st.exception}</p> : null}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="hg-card">
          <h2>Music in the room</h2>
          <div className="hg-music">
            <div className="hg-music-ways">
              <p>As the host you can play any music for the whole room:</p>
              <ul>
                <li><b>Playlist.</b> Pick a focus track in the Music panel.</li>
                <li><b>Your own file.</b> Upload a room track, up to 30 MB.</li>
                <li><b>Any tab.</b> "Share music from tab" plays a Chrome tab with YouTube, Spotify Web or anything else. Only its audio goes to the room.</li>
                <li><b>Volume.</b> The slider in the Music panel sets the room volume for everyone.</li>
              </ul>
            </div>
            <div className="hg-music-say">
              <span className="hg-music-label">Say this before you press play</span>
              <CopyLine label="Music" text={MUSIC_LINE} />
              <p>Everyone can mute the music just for themselves with <b>Mute</b> next to Music in the bottom right, or <b>Mute for me</b> in the Music panel. In the <b>For me</b> tab they can play their own track that nobody else hears.</p>
            </div>
          </div>
        </section>

        <div className="hg-two">
          <section className="hg-card">
            <h2>Lines you can use</h2>
            <div className="hg-lines">{LINES.map(([l, t]) => <CopyLine key={l} label={l} text={t} />)}</div>
          </section>
          <section className="hg-card">
            <h2>If something goes off plan</h2>
            <div className="hg-trouble">
              {TROUBLE.map(([icon, q, a]) => (
                <div key={q} className="hg-tr"><span>{icon}</span><div><b>{q}</b><p>{a}</p></div></div>
              ))}
            </div>
          </section>
        </div>

        <section className="hg-card dark">
          <div className="hg-check-head">
            <h2>Host checklist</h2>
            <a className="hg-cta" href="/sessions">Host a session</a>
          </div>
          <div className="hg-checklist">{CHECKLIST.map((c) => <span key={c}>✓ {c}</span>)}</div>
          <p className="hg-tools">Room tools: mute a mic · turn a camera off · remove and report (tile menu) · statuses (Skip me, On a call, Eating, Break, AFK) · room music · tasks on tiles · double-click the timeline to edit it.</p>
        </section>
      </main>
    </div>
  );
}

const CSS = `
.hg { min-height: 100vh; background: #fff; color: #2F2F2F; font-family: Inter, system-ui, sans-serif; }
.hg button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; text-align: left; }
.hg-header { height: 64px; display: grid; place-items: center; font-size: 26px; font-weight: 800; border-bottom: 1px solid #EEE; }
.hg-header a { color: inherit; text-decoration: none; }
.hg-ai-note { margin: -4px 0 0; font-size: 11.5px; color: #8A8A8A; }
.hg-main { max-width: 1080px; margin: 0 auto; padding: 36px 20px 72px; display: grid; gap: 16px; }
.hg-hero { display: grid; grid-template-columns: 1fr; gap: 20px; margin-bottom: 8px; }
.hg-hero-text { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 28px; align-items: end; }
.hg-formats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.hg-kicker { font-size: 13px; font-weight: 600; color: #6B6B6B; margin: 0; }
.hg h1 { font-size: 38px; font-weight: 700; line-height: 1.1; letter-spacing: -0.03em; margin: 8px 0 0; }
.hg-lead { font-size: 15.5px; line-height: 1.6; color: #555; margin: 12px 0 18px; }
.hg-formats { display: grid; gap: 8px; }
.hg-formats button { display: grid; gap: 2px; padding: 11px 14px; border-radius: 14px; border: 1px solid #EAEAEA; transition: background 150ms, border-color 150ms; }
.hg-formats button:hover { border-color: #BDBDBD; }
.hg-formats button.on { background: #2F2F2F; color: #fff; border-color: #2F2F2F; }
.hg-formats b { font-size: 14px; } .hg-formats span { font-size: 12.5px; opacity: .7; }

/* Walkthrough "video" */
.hg-video { display: flex; flex-direction: column; gap: 14px; }
.hg-steps { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 6px; margin: 12px 0 0; padding: 0; list-style: none; }
.hg-stepbtn { width: 100%; display: flex; flex-direction: column; gap: 7px; text-align: left; padding: 0 !important; background: none !important; cursor: pointer; color: #A3A3A3 !important; }
.hg-stepbtn:hover { color: #2F2F2F !important; }
.hg-stepbtn.done { color: #6B6B6B !important; }
.hg-stepbtn.now { color: #2F2F2F !important; font-weight: 600; }
.hg-steplabel { display: flex; align-items: center; gap: 6px; font-size: 12.5px; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hg-stepnum { flex: none; width: 18px; height: 18px; border-radius: 99px; display: grid; place-items: center; font-size: 10.5px; font-weight: 700; background: #F0F0F0; color: #8A8A8A; }
.hg-stepbtn.done .hg-stepnum { background: #E4E4E4; color: #4A4A4A; }
.hg-stepbtn.now .hg-stepnum { background: #2F2F2F; color: #fff; }
.hg-steptrack { display: block; height: 4px; border-radius: 99px; background: #EDEDED; overflow: hidden; }
.hg-steptrack > span { display: block; height: 100%; border-radius: 99px; background: #2F2F2F; transition: width 500ms ease; }
.hg-bar span { display: block; height: 100%; width: 0; border-radius: 99px; }
.hg-bar span.done { width: 100%; }
.hg-bar span.run { animation: hg-fill linear forwards; }
.hg-bar span.hold { width: 50%; }
@keyframes hg-fill { from { width: 0 } to { width: 100% } }
.hg-stage { position: relative; border-radius: 16px; background: #2A2A2A; padding: 10px; aspect-ratio: 16 / 10; display: flex; flex-direction: column; gap: 8px; animation: hg-in 400ms ease both; }
@keyframes hg-in { from { opacity: 0; transform: scale(.985) } to { opacity: 1; transform: none } }
.hg-room-top { display: flex; justify-content: space-between; align-items: center; }
.hg-chip { font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 99px; }
.hg-timer { font-size: 12px; font-variant-numeric: tabular-nums; color: #CFCFCF; background: rgba(255,255,255,.08); padding: 4px 9px; border-radius: 99px; }
.hg-tiles { flex: 1; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 8px; min-height: 0; }
.hg-tile { position: relative; border-radius: 12px; background: #333; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding-top: 18px; transition: opacity 400ms, box-shadow 300ms; min-height: 0; }
.hg-tile.speaking { box-shadow: 0 0 0 2px #5286F6, 0 0 0 6px rgba(82,134,246,.2); }
.hg-tile.dim { opacity: .55; }
.hg-avatar { width: 34px; height: 34px; border-radius: 99px; display: grid; place-items: center; font-weight: 700; font-size: 14px; color: #fff; }
.hg-name { font-size: 11px; font-weight: 600; display: flex; gap: 4px; align-items: center; }
.hg-mic { font-size: 10px; opacity: .8; } .hg-mic.live { animation: hg-pulse 900ms ease-in-out infinite; }
@keyframes hg-pulse { 50% { transform: scale(1.25) } }
.hg-task { font-size: 10px; color: #BDBDBD; }
.hg-status { position: absolute; top: 6px; right: 6px; font-size: 9px; font-weight: 700; background: #6B4FD6; color: #fff; padding: 2px 6px; border-radius: 99px; }
.hg-bubble { position: absolute; left: 50%; top: 8px; transform: translateX(-50%); max-width: 92%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 10.5px; color: #2F2F2F; background: #fff; padding: 4px 9px; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,.25); opacity: 0; animation: hg-pop 350ms ease forwards; }
@keyframes hg-pop { from { opacity: 0; transform: translate(-50%, 6px) } to { opacity: 1; transform: translate(-50%, 0) } }
.hg-chat { font-size: 11.5px; background: rgba(255,255,255,.1); border-radius: 10px; padding: 7px 10px; animation: hg-pop2 400ms ease both; }
.hg-chat b { color: #ADD3FF; margin-right: 6px; }
@keyframes hg-pop2 { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
.hg-frame { position: relative; width: 100%; border-radius: 22px; overflow: hidden; background: #1B1B1B; box-shadow: 0 20px 50px rgba(0,0,0,.18); }
.hg-start { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; background: rgba(20,20,20,.45) !important; backdrop-filter: blur(2px); color: #fff !important; font-size: 17px !important; font-weight: 600; cursor: pointer; }
.hg-start-icon { width: 84px; height: 84px; border-radius: 99px; background: #fff; color: #2F2F2F; display: grid; place-items: center; font-size: 30px; padding-left: 6px; box-shadow: 0 10px 40px rgba(0,0,0,.35); transition: transform 200ms; animation: hg-breathe 2.4s ease-in-out infinite; }
.hg-start:hover .hg-start-icon { transform: scale(1.08); }
@keyframes hg-breathe { 50% { box-shadow: 0 0 0 14px rgba(255,255,255,.18), 0 10px 40px rgba(0,0,0,.35); } }
.hg-player { display: flex; flex-direction: column; gap: 14px; padding: 16px 18px; border: 1px solid #E6E6E6; border-radius: 20px; background: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.06); color: #2F2F2F; }
.hg-player-row { display: flex; align-items: center; gap: 18px; padding-top: 14px; border-top: 1px solid #F0F0F0; }
.hg-player-row .hg-steps { flex: 1; min-width: 0; margin: 0; grid-template-columns: none; grid-auto-columns: minmax(0, 1fr); }
.hg-player-row .hg-steps > li { min-width: 0; }
.hg-video, .hg-hero > div { min-width: 0; }
.hg-says { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); max-width: 80%; font-size: 13px; line-height: 1.4; background: rgba(255,255,255,.95); color: #2F2F2F; padding: 7px 12px; border-radius: 12px; box-shadow: 0 6px 20px rgba(0,0,0,.35); animation: hg-pop2 400ms ease both; }
.hg-says b { margin-right: 4px; }
.hg-says.left { left: 16px; transform: none; max-width: 62%; } /* keeps Music + Mute (bottom right) visible */
.hg-sound { flex: none; display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 132px; height: 40px; font-size: 13.5px !important; font-weight: 600; color: #6B6B6B !important; background: #F3F3F3 !important; border-radius: 99px; transition: background 150ms, color 150ms; }
.hg-sound:hover:not(:disabled) { background: #EAEAEA !important; color: #2F2F2F !important; }
.hg-sound.on { color: #2F2F2F !important; }
.hg-sound.on { background: #ADD3FF !important; }
.hg-sound:disabled { opacity: .5; cursor: default; }
.hg-music-scene button[aria-label="Mute music"] { animation: hg-ring 1.4s ease-in-out infinite; }
@keyframes hg-ring { 0%, 100% { box-shadow: 0 0 0 0 rgba(173,211,255,0); } 50% { box-shadow: 0 0 0 4px rgba(173,211,255,.9); } }
.hg-tasks .flex.flex-col.gap-0\\.5 > div, .hg-tasks [draggable] { animation: hg-task-in 700ms cubic-bezier(.2,.8,.2,1) both; }
@keyframes hg-task-in { 0% { opacity: 0; transform: translateX(28px) scale(.97); box-shadow: 0 0 0 0 rgba(82,134,246,0); } 55% { opacity: 1; transform: none; box-shadow: 0 0 0 3px rgba(82,134,246,.55); } 100% { box-shadow: 0 0 0 0 rgba(82,134,246,0); } }
.hg-play { flex: none; display: inline-flex; align-items: center; justify-content: center; gap: 9px; width: 108px; height: 40px; border-radius: 99px; background: #2F2F2F !important; color: #fff !important; font-size: 14px !important; font-weight: 600; transition: transform 150ms, background 150ms; }

.hg-play:hover { transform: scale(1.03); }
.hg-play.on { background: #F3F3F3 !important; color: #2F2F2F !important; }
.hg-caption-text { font-size: 14px; line-height: 1.45; color: #4A4A4A; min-height: 42px; animation: hg-pop2 350ms ease both; }
.hg-stepno { display: block; font-size: 13px; font-weight: 600; color: #2F2F2F; margin-bottom: 1px; }
@media (max-width: 640px) { .hg-player-row { flex-wrap: wrap; gap: 12px; } .hg-player-row .hg-steps { order: 3; flex-basis: 100%; } .hg-sound { margin-left: auto; } }

.hg-card { border: 1px solid #EEE; border-radius: 22px; padding: 20px; }
.hg-card h2 { font-size: 19px; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 12px; }
.hg-card.dark { background: #2F2F2F; color: #fff; border-color: #2F2F2F; }
.hg-table { display: grid; gap: 4px; }
.hg-row { display: grid !important; grid-template-columns: 1.3fr repeat(4, .9fr) 1.6fr; gap: 8px; align-items: center; padding: 9px 12px !important; border-radius: 12px; font-size: 13px; }
.hg-row.head { font-size: 11.5px; font-weight: 600; color: #8A8A8A; padding-top: 0 !important; padding-bottom: 2px !important; }
button.hg-row:hover { background: #F7F7F7 !important; }
button.hg-row.on { background: #F1F1F1 !important; }
.hg-voice { font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 99px; width: fit-content; }
.hg-voice.talk { background: #E8F7EA; color: #2F8F35; } .hg-voice.chat { background: #EEF3FE; color: #3F6FD8; } .hg-voice.quiet { background: #F1F1F1; color: #6B6B6B; }
.hg-best { font-size: 12px; color: #6B6B6B; }
.hg-note { font-size: 12px; color: #8A8A8A; margin: 10px 0 0 12px; }
.hg-steps { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
.hg-step { background: #F7F7F7; border-radius: 16px; padding: 12px; }
.hg-step-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.hg-step-icon { font-size: 20px; } .hg-step-n { font-size: 11px; font-weight: 700; color: #A3A3A3; }
.hg-step b { font-size: 13.5px; } .hg-step p { font-size: 12px; line-height: 1.45; color: #6B6B6B; margin: 4px 0 0; }
.hg-two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.hg-rule { margin: -4px 0 12px; font-size: 14px; color: #4A4A4A; }
.hg-statuses { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.hg-st { display: flex; gap: 12px; align-items: flex-start; background: #F7F7F7; border-radius: 12px; padding: 12px; }
.hg-st-badge { flex: none; width: 92px; height: 34px; display: flex; align-items: center; justify-content: center; border-radius: 10px; background: #1B1B1B; }
.hg-st b { display: block; font-size: 13px; line-height: 1.4; }
.hg-st p { margin: 3px 0 0; font-size: 12.5px; line-height: 1.45; color: #5A5A5A; }
.hg-st p.hg-exception { color: #2F2F2F; font-weight: 600; }
.hg-music { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.hg-music p { margin: 0 0 8px; font-size: 13px; line-height: 1.5; color: #4A4A4A; }
.hg-music ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.hg-music li { background: #F7F7F7; border-radius: 12px; padding: 9px 12px; font-size: 12.5px; line-height: 1.45; color: #4A4A4A; }
.hg-music li b { color: #2F2F2F; }
.hg-music-say { display: flex; flex-direction: column; gap: 8px; }
.hg-music-label { font-size: 13px; font-weight: 600; }
.hg-music-say p { margin: 0; }
@media (max-width: 760px) { .hg-statuses, .hg-music { grid-template-columns: 1fr; } }
.hg-lines { display: grid; gap: 6px; }
.hg-line { display: grid !important; grid-template-columns: 74px 1fr auto; gap: 10px; align-items: start; padding: 9px 12px !important; border-radius: 12px; background: #F7F7F7 !important; font-size: 12.5px; line-height: 1.45; transition: background 150ms; }
.hg-line:hover { background: #F0F0F0 !important; }
.hg-line-label { font-weight: 600; color: #8A8A8A; } .hg-line-copy { font-size: 11.5px; font-weight: 600; color: #A3A3A3; }
.hg-trouble { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.hg-tr { display: flex; gap: 9px; background: #F7F7F7; border-radius: 12px; padding: 10px; }
.hg-tr > span { font-size: 16px; } .hg-tr b { font-size: 13px; } .hg-tr p { font-size: 12px; line-height: 1.4; color: #6B6B6B; margin: 2px 0 0; }
.hg-check-head { display: flex; justify-content: space-between; align-items: center; }
.hg-check-head h2 { margin: 0; }
.hg-cta { background: #fff !important; color: #2F2F2F !important; padding: 10px 18px !important; border-radius: 99px; font-weight: 600; font-size: 13.5px; text-decoration: none; }
.hg-checklist { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
.hg-checklist span { font-size: 12.5px; background: rgba(255,255,255,.1); padding: 6px 11px; border-radius: 99px; }
.hg-tools { font-size: 12.5px; color: rgba(255,255,255,.7); margin: 14px 0 0; }
@media (max-width: 860px) {
  .hg-hero, .hg-two { grid-template-columns: 1fr; }
  .hg-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hg-row { grid-template-columns: 1.2fr repeat(4, 1fr) !important; } .hg-best, .hg-row.head > span:last-child { display: none; }
  .hg-trouble { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .hg-main { padding: 24px 16px 56px; }
  .hg-hero-text { grid-template-columns: 1fr; gap: 4px; }
  .hg h1 { font-size: 30px; }
  .hg-lead { margin: 6px 0 4px; }
  .hg-formats { grid-template-columns: 1fr; }
  .hg-card { padding: 16px; }
  .hg-line { grid-template-columns: 1fr auto; }
  .hg-line-label { grid-column: 1 / -1; }
  .hg-check-head { flex-wrap: wrap; gap: 10px; }
}
@media (prefers-reduced-motion: reduce) { .hg * { animation-duration: 1ms !important; } }
`;
