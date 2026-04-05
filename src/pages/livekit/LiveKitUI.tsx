import React, { useEffect, useState } from "react";
import {
    Icon as BaseIcon,
    ParticipantsSmartIcon,
    type RoomTheme,
} from "../../components/VideoControls";

type IconProps = {
    name: string;
    theme: RoomTheme;
    className?: string;
    alt?: string;
};

function PipAssetIcon(props: {
    theme: RoomTheme;
    className?: string;
    alt?: string;
}) {
    const { theme, className, alt } = props;

    const sources =
        theme === "light"
            ? [
                "/icons/pip-dark.svg",
                "/icons/pip-dark.png",
                "/icons/pip-dark.webp",
            ]
            : [
                "/icons/pip-light.svg",
                "/icons/pip-light.png",
                "/icons/pip-light.webp",
            ];

    const [sourceIndex, setSourceIndex] = useState(0);

    useEffect(() => {
        setSourceIndex(0);
    }, [theme]);

    return (
        <img
            src={sources[Math.min(sourceIndex, sources.length - 1)]}
            alt={alt || "Picture in Picture"}
            className={className}
            draggable={false}
            onError={() => {
                setSourceIndex((prev) => Math.min(prev + 1, sources.length - 1));
            }}
        />
    );
}

export function Icon(props: IconProps) {
    const { name, theme, className, alt } = props;

    if (name === "pip" || name === "pip-on") {
        return <PipAssetIcon theme={theme} className={className} alt={alt} />;
    }

    return (
        <BaseIcon
            name={name as any}
            theme={theme}
            className={className}
            alt={alt}
        />
    );
}

export { ParticipantsSmartIcon };
export type { RoomTheme };

export type ReactionType =
    | "fire"
    | "laugh"
    | "thumbsUp"
    | "thumbsDown"
    | "heart"
    | "clap"
    | "ok"
    | "wave"
    | "celebrate";

export const reactionEmoji: Record<ReactionType, string> = {
    fire: "🔥",
    laugh: "😂",
    thumbsUp: "👍",
    thumbsDown: "👎",
    heart: "❤️",
    clap: "👏",
    ok: "👌",
    wave: "👋",
    celebrate: "🎉",
};