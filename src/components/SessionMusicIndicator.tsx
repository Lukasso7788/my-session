/** Live shared-room audio only; personal soundtrack playback is not shown. */
export default function SessionMusicIndicator({ color }: { color: string }) {
  return (
    <span
      role="img"
      aria-label="Music playing in this session"
      title="Music playing in this session"
      className="ms-session-music relative inline-flex h-[25px] w-[29px] shrink-0 items-center justify-center"
    >
      <img className="ms-session-music-disc h-[22px] w-[22px]" src="/icons/session-music-disc.svg" alt="" aria-hidden="true" />
      <span className="ms-session-music-note ms-session-music-note--one" style={{ backgroundColor: color }} aria-hidden="true" />
      <span className="ms-session-music-note ms-session-music-note--two" style={{ backgroundColor: color }} aria-hidden="true" />
    </span>
  );
}
