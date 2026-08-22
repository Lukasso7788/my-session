type VoiceCommandIconProps = {
  active: boolean;
  className?: string;
  size?: number;
};

export default function VoiceCommandIcon({
  active,
  className = "",
  size = 18,
}: VoiceCommandIconProps) {
  const source = active
    ? "/icons/voice-command-filled.svg"
    : "/icons/voice-command-outline.svg";

  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        backgroundColor: "currentColor",
        display: "inline-block",
        flexShrink: 0,
        height: size,
        mask: `url("${source}") center / contain no-repeat`,
        WebkitMask: `url("${source}") center / contain no-repeat`,
        width: size,
      }}
    />
  );
}
