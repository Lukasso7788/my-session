/** Quiet card badge: three bars animate only while shared room audio is live. */
export default function SessionMusicIndicator() {
  return (
    <span
      role="img"
      aria-label="Music playing in this session"
      title="Music playing in this session"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#CBE8D0] bg-[#F0FBF1] text-[#2E9E59]"
    >
      <span aria-hidden="true" className="flex h-[15px] items-center gap-[2px]">
        <span className="ms-session-music-bar ms-session-music-bar--one" />
        <span className="ms-session-music-bar ms-session-music-bar--two" />
        <span className="ms-session-music-bar ms-session-music-bar--three" />
      </span>
    </span>
  );
}
