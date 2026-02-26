// src/components/VideoControls.tsx
import React, { useEffect, useRef, useState } from "react";

export type RoomTheme = "dark" | "light";

export type ReactionType = "fire" | "laugh" | "clap" | "heart" | "thumbsUp" | "thumbsDown" | "OK" | "bye";

export const REACTION_EMOJI: Record<ReactionType, string> = {
  fire: "🔥",
  laugh: "😂",
  clap: "👏",
  heart: "❤️",
  thumbsUp: "👍",
  thumbsDown: "👎",
  OK: "👌",
  bye: "👋",
};

export function Icon({
  name,
  theme,
  className = "w-5 h-5",
  alt = "",
}: {
  name:
  | "mic-on"
  | "mic-off"
  | "camera-on"
  | "camera-off"
  | "screen-share"
  | "leave"
  | "chat"
  | "intentions"
  | "tile-view"
  | "reaction"
  | "theme-sun"
  | "theme-moon"
  | "timer";
  theme: RoomTheme;
  className?: string;
  alt?: string;
}) {
  const themedSrc = `/icons/${name}-${theme}.svg`;
  const fallbackSrc = `/icons/${name}.svg`;
  const [src, setSrc] = useState(themedSrc);

  useEffect(() => {
    setSrc(themedSrc);
  }, [themedSrc]);

  return (
    <img
      src={src}
      onError={() => {
        if (src !== fallbackSrc) setSrc(fallbackSrc);
      }}
      className={className}
      alt={alt}
      draggable={false}
    />
  );
}

function UsersInlineIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M16 11a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 16 11Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.5 11.5a3 3 0 1 0-3-3 3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.5 20c0-3 2.5-5.5 5.5-5.5S21.5 17 21.5 20"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M1.5 20c0-2.2 1.6-4.1 3.7-4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ParticipantsSmartIcon({
  theme,
  className = "w-4 h-4",
}: {
  theme: RoomTheme;
  className?: string;
}) {
  const candidates = [
    `/icons/participants-${theme}.svg`,
    `/icons/participants.svg`,
    `/icons/users-${theme}.svg`,
    `/icons/users.svg`,
  ];
  const [idx, setIdx] = useState(0);
  const [inline, setInline] = useState(false);

  useEffect(() => {
    setIdx(0);
    setInline(false);
  }, [theme]);

  if (inline) return <UsersInlineIcon className={className} />;

  const src = candidates[idx] || candidates[candidates.length - 1];
  return (
    <img
      src={src}
      onError={() => {
        if (idx < candidates.length - 1) setIdx((x) => x + 1);
        else setInline(true);
      }}
      className={className}
      alt=""
      draggable={false}
    />
  );
}

type RightPanelTab = "participants" | "chat" | "intentions" | null;

export default function VideoControls(props: {
  theme: RoomTheme;

  tile: boolean;
  mutedAudio: boolean;
  mutedVideo: boolean;
  isScreenSharing: boolean;

  unreadChat?: number;

  onOpenTab: (tab: RightPanelTab) => void;

  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onToggleTile: () => void;

  onReloadRoom?: () => void;

  onSendReaction: (type: ReactionType) => void;

  onLeave: () => void;
}) {
  const {
    theme,
    tile,
    mutedAudio,
    mutedVideo,
    isScreenSharing,
    unreadChat = 0,
    onOpenTab,
    onToggleAudio,
    onToggleVideo,
    onToggleScreenShare,
    onToggleTile,
    onReloadRoom,
    onSendReaction,
    onLeave,
  } = props;

  const isLight = theme === "light";

  const bottomBarBg = isLight
    ? "bg-white/85 border border-black/10"
    : "bg-[#07101E]/85 border border-white/10";

  const ctlBtnBase = isLight ? "bg-black/5 hover:bg-black/10" : "bg-[#111827] hover:bg-[#1f2937]";

  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showReactionsMenu, setShowReactionsMenu] = useState(false);

  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const reactionsMenuRef = useRef<HTMLDivElement | null>(null);

  // click outside ⋯ menu
  useEffect(() => {
    if (!showMoreMenu) return;

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!moreMenuRef.current || !t) return;
      if (!moreMenuRef.current.contains(t)) setShowMoreMenu(false);
    };

    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showMoreMenu]);

  // click outside reactions
  useEffect(() => {
    if (!showReactionsMenu) return;

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!reactionsMenuRef.current || !t) return;
      if (!reactionsMenuRef.current.contains(t)) setShowReactionsMenu(false);
    };

    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showReactionsMenu]);

  // Escape closes menus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowMoreMenu(false);
        setShowReactionsMenu(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const safeCloseMenus = () => {
    setShowMoreMenu(false);
    setShowReactionsMenu(false);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50">
      <div className="w-full px-2 sm:px-3 pb-[calc(8px+env(safe-area-inset-bottom))]">
        <div
          className={`h-[64px] sm:h-[74px] rounded-2xl shadow-2xl backdrop-blur grid grid-cols-[auto,1fr,auto] items-center px-2 sm:px-4 ${bottomBarBg}`}
        >
          {/* left group */}
          <div className="flex items-center gap-2" ref={moreMenuRef}>
            <div className="md:hidden relative">
              <button
                onClick={() => setShowMoreMenu((v) => !v)}
                className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                title="Menu"
              >
                <span className={isLight ? "text-black/70" : "text-white/85"}>⋯</span>
              </button>

              {showMoreMenu && (
                <div className="absolute bottom-[76px] sm:bottom-[86px] left-0">
                  <div
                    className={`w-[240px] rounded-2xl shadow-2xl overflow-hidden ${isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10"
                      }`}
                  >
                    <button
                      onClick={() => {
                        onOpenTab("participants");
                        safeCloseMenus();
                      }}
                      className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"
                        }`}
                    >
                      <ParticipantsSmartIcon theme={theme} className="w-4 h-4 opacity-90" />
                      <span>Participants</span>
                    </button>

                    <button
                      onClick={() => {
                        onOpenTab("chat");
                        safeCloseMenus();
                      }}
                      className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"
                        }`}
                    >
                      <Icon name="chat" theme={theme} className="w-4 h-4 opacity-90" />
                      <span className="flex items-center gap-2">
                        <span>Chat</span>
                        {unreadChat > 0 && (
                          <span
                            className={`px-2 py-[2px] rounded-full text-[11px] font-semibold ${isLight ? "bg-red-600 text-white" : "bg-red-600 text-white"
                              }`}
                          >
                            {unreadChat > 99 ? "99+" : unreadChat}
                          </span>
                        )}
                      </span>
                    </button>

                    <button
                      onClick={() => {
                        onOpenTab("intentions");
                        safeCloseMenus();
                      }}
                      className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"
                        }`}
                    >
                      <Icon name="intentions" theme={theme} className="w-4 h-4 opacity-90" />
                      <span>Intentions</span>
                    </button>

                    <div className={isLight ? "h-px bg-black/10" : "h-px bg-white/10"} />

                    <button
                      onClick={() => {
                        onToggleTile();
                        safeCloseMenus();
                      }}
                      className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"
                        }`}
                    >
                      <Icon name="tile-view" theme={theme} className="w-4 h-4 opacity-90" />
                      <span>{tile ? "Disable tile view" : "Enable tile view"}</span>
                    </button>

                    {!!onReloadRoom && (
                      <button
                        onClick={() => {
                          onReloadRoom();
                          safeCloseMenus();
                        }}
                        className={`w-full px-4 py-3 text-left text-[13px] transition flex items-center gap-2 ${isLight ? "text-black/75 hover:bg-black/5" : "text-white/85 hover:bg-white/5"
                          }`}
                      >
                        <span className="opacity-80">⟳</span>
                        <span>Reload room</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="hidden md:flex items-center gap-2">
              <button
                onClick={() => onOpenTab("participants")}
                className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                title="Participants"
              >
                <ParticipantsSmartIcon theme={theme} className="w-5 h-5 opacity-90" />
              </button>

              <button
                onClick={() => onOpenTab("chat")}
                className={`relative w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                title="Chat"
              >
                <Icon name="chat" theme={theme} className="w-5 h-5" />
                {unreadChat > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[11px] font-semibold flex items-center justify-center">
                    {unreadChat > 99 ? "99+" : unreadChat}
                  </span>
                )}
              </button>

              <button
                onClick={() => onOpenTab("intentions")}
                className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                title="Intentions"
              >
                <Icon name="intentions" theme={theme} className="w-5 h-5" />
              </button>

              <button
                onClick={onToggleTile}
                className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                title="Tile view"
              >
                <Icon name="tile-view" theme={theme} className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* center media */}
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            <button
              onClick={onToggleAudio}
              className={
                "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition " +
                (mutedAudio ? "bg-red-600 hover:bg-red-700" : ctlBtnBase)
              }
              title="Toggle mic"
            >
              <Icon name={mutedAudio ? "mic-off" : "mic-on"} theme={mutedAudio ? "dark" : theme} className="w-5 h-5" />
            </button>

            <button
              onClick={onToggleVideo}
              className={
                "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition " +
                (mutedVideo ? "bg-red-600 hover:bg-red-700" : ctlBtnBase)
              }
              title="Toggle camera"
            >
              <Icon name={mutedVideo ? "camera-off" : "camera-on"} theme={theme} className="w-5 h-5" />
            </button>

            <button
              onClick={onToggleScreenShare}
              className={
                "w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition " +
                (isScreenSharing ? "bg-blue-600 hover:bg-blue-700" : ctlBtnBase)
              }
              title="Share screen"
            >
              <Icon name="screen-share" theme={theme} className="w-5 h-5" />
            </button>

            <div className="relative" ref={reactionsMenuRef}>
              <button
                onClick={() => setShowReactionsMenu((v) => !v)}
                className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center transition ${ctlBtnBase}`}
                title="Reactions"
              >
                <Icon name="reaction" theme={theme} className="w-5 h-5" />
              </button>

              {showReactionsMenu && (
                <div
                  className={`absolute bottom-[54px] sm:bottom-[58px] left-1/2 -translate-x-1/2 rounded-2xl px-3 py-2 flex gap-2 text-xl shadow-xl ${isLight ? "bg-white border border-black/10" : "bg-[#020617] border border-white/10"
                    }`}
                >
                  {(Object.keys(REACTION_EMOJI) as ReactionType[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        onSendReaction(t);
                        safeCloseMenus();
                      }}
                      className="hover:scale-[1.06] transition"
                      title={t}
                    >
                      {REACTION_EMOJI[t]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* right actions */}
          <div className="flex items-center justify-end gap-2 sm:gap-3">
            <button
              onClick={onLeave}
              className={`hidden sm:flex h-11 px-6 rounded-2xl font-semibold items-center justify-center gap-2 ${isLight ? "bg-red-600 hover:bg-red-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"
                }`}
              title="Leave"
            >
              <Icon name="leave" theme={theme} className="w-5 h-5" />
              <span className="text-[14px]">Leave</span>
            </button>

            <button
              onClick={onLeave}
              className="sm:hidden w-10 h-10 rounded-2xl bg-red-600 hover:bg-red-700 text-white flex items-center justify-center"
              title="Leave"
            >
              <Icon name="leave" theme={theme} className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
