import { avatarTone, initials } from "../lib/communityDisplay";

export default function CommunityAvatar({
  userId,
  name,
  url,
  size,
}: {
  userId: string;
  name: string;
  url: string | null;
  size: number;
}) {
  const style = { width: size, height: size };
  if (url) {
    return <img src={url} style={style} className="shrink-0 rounded-full object-cover" alt="" loading="lazy" />;
  }
  const tone = avatarTone(userId);
  return (
    <span
      style={{ ...style, backgroundColor: tone.background, color: tone.color, fontSize: Math.round(size * 0.34) }}
      className="flex shrink-0 items-center justify-center rounded-full font-semibold"
    >
      {initials(name)}
    </span>
  );
}
