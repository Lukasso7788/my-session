import React from "react";

export type RoomTheme = "light" | "dark";

/**
 * Делаем string, а не узкий union, чтобы не ломаться,
 * если LiveKitBottomBar или другие части шлют свои ключи реакций.
 */
export type ReactionType = string;

export const reactionEmoji: Record<string, string> = {
    like: "👍",
    thumbsUp: "👍",
    heart: "❤️",
    love: "❤️",
    clap: "👏",
    celebrate: "🎉",
    party: "🎉",
    fire: "🔥",
    wow: "😮",
    laugh: "😂",
    rocket: "🚀",
    check: "✅",
};

type IconProps = React.SVGProps<SVGSVGElement> & {
    name: string;
    theme?: RoomTheme;
    alt?: string;
};

function baseIconProps(props: IconProps) {
    const {
        className,
        alt,
        name,
        theme: _theme,
        ...rest
    } = props;

    return {
        className,
        viewBox: "0 0 24 24",
        fill: "none",
        xmlns: "http://www.w3.org/2000/svg",
        "aria-label": alt || name,
        role: "img" as const,
        ...rest,
    };
}

export function Icon(props: IconProps) {
    const p = baseIconProps(props);
    const stroke = {
        stroke: "currentColor",
        strokeWidth: 1.9,
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
    };

    switch (props.name) {
        case "mic-on":
            return (
                <svg {...p}>
                    <path {...stroke} d="M12 4a3 3 0 0 1 3 3v4a3 3 0 1 1-6 0V7a3 3 0 0 1 3-3Z" />
                    <path {...stroke} d="M6.5 10.5A5.5 5.5 0 0 0 12 16a5.5 5.5 0 0 0 5.5-5.5" />
                    <path {...stroke} d="M12 16v4" />
                    <path {...stroke} d="M9 20h6" />
                </svg>
            );

        case "mic-off":
            return (
                <svg {...p}>
                    <path {...stroke} d="M12 4a3 3 0 0 1 3 3v2.5" />
                    <path {...stroke} d="M9 9.5V7a3 3 0 0 1 3-3" />
                    <path {...stroke} d="M6.5 10.5A5.5 5.5 0 0 0 12 16a5.4 5.4 0 0 0 3.35-1.14" />
                    <path {...stroke} d="M12 16v4" />
                    <path {...stroke} d="M9 20h6" />
                    <path {...stroke} d="M4 4l16 16" />
                </svg>
            );

        case "cam-on":
            return (
                <svg {...p}>
                    <rect {...stroke} x="3.5" y="6.5" width="13" height="11" rx="2.5" />
                    <path {...stroke} d="M16.5 10l4-2v8l-4-2" />
                </svg>
            );

        case "cam-off":
            return (
                <svg {...p}>
                    <rect {...stroke} x="3.5" y="6.5" width="13" height="11" rx="2.5" />
                    <path {...stroke} d="M16.5 10l4-2v8l-4-2" />
                    <path {...stroke} d="M4 4l16 16" />
                </svg>
            );

        case "screen":
        case "screen-on":
            return (
                <svg {...p}>
                    <rect {...stroke} x="3.5" y="4.5" width="17" height="11" rx="2.5" />
                    <path {...stroke} d="M9 19.5h6" />
                    <path {...stroke} d="M12 15.5v4" />
                </svg>
            );

        case "screen-off":
            return (
                <svg {...p}>
                    <rect {...stroke} x="3.5" y="4.5" width="17" height="11" rx="2.5" />
                    <path {...stroke} d="M9 19.5h6" />
                    <path {...stroke} d="M12 15.5v4" />
                    <path {...stroke} d="M4 4l16 16" />
                </svg>
            );

        case "participants":
        case "users":
            return (
                <svg {...p}>
                    <path {...stroke} d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                    <path {...stroke} d="M17 12a2.5 2.5 0 1 0 0-5" />
                    <path {...stroke} d="M4.5 18a4.5 4.5 0 0 1 9 0" />
                    <path {...stroke} d="M14.5 18a3.5 3.5 0 0 1 5 0" />
                </svg>
            );

        case "chat":
            return (
                <svg {...p}>
                    <path {...stroke} d="M5.5 6.5h13a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H11l-4.5 3v-3H5.5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z" />
                </svg>
            );

        case "settings":
            return (
                <svg {...p}>
                    <path {...stroke} d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
                    <path
                        {...stroke}
                        d="M19 12a7.2 7.2 0 0 0-.1-1.1l2-1.55-2-3.46-2.38.78a7.97 7.97 0 0 0-1.9-1.1L14.25 3h-4.5l-.36 2.66a7.97 7.97 0 0 0-1.9 1.1l-2.38-.78-2 3.46 2 1.55A7.2 7.2 0 0 0 5 12c0 .37.03.74.1 1.1l-2 1.55 2 3.46 2.38-.78c.58.46 1.22.83 1.9 1.1L9.75 21h4.5l.36-2.66c.68-.27 1.32-.64 1.9-1.1l2.38.78 2-3.46-2-1.55c.07-.36.1-.73.1-1.1Z"
                    />
                </svg>
            );

        case "leave":
        case "logout":
            return (
                <svg {...p}>
                    <path {...stroke} d="M9 5.5H6.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2H9" />
                    <path {...stroke} d="M13 8.5l4 3.5-4 3.5" />
                    <path {...stroke} d="M17 12H8.5" />
                </svg>
            );

        case "reaction":
        case "emoji":
            return (
                <svg {...p}>
                    <circle {...stroke} cx="12" cy="12" r="8.5" />
                    <path {...stroke} d="M9 10h.01" />
                    <path {...stroke} d="M15 10h.01" />
                    <path {...stroke} d="M8.5 14a4.2 4.2 0 0 0 7 0" />
                </svg>
            );

        case "timer":
            return (
                <svg {...p}>
                    <circle {...stroke} cx="12" cy="13" r="7.5" />
                    <path {...stroke} d="M12 9.5V13l2.5 1.5" />
                    <path {...stroke} d="M9.5 3.5h5" />
                </svg>
            );

        case "theme-sun":
            return (
                <svg {...p}>
                    <circle {...stroke} cx="12" cy="12" r="4" />
                    <path {...stroke} d="M12 2.5v2.2" />
                    <path {...stroke} d="M12 19.3v2.2" />
                    <path {...stroke} d="M21.5 12h-2.2" />
                    <path {...stroke} d="M4.7 12H2.5" />
                    <path {...stroke} d="M18.7 5.3l-1.55 1.55" />
                    <path {...stroke} d="M6.85 17.15L5.3 18.7" />
                    <path {...stroke} d="M18.7 18.7l-1.55-1.55" />
                    <path {...stroke} d="M6.85 6.85L5.3 5.3" />
                </svg>
            );

        case "theme-moon":
            return (
                <svg {...p}>
                    <path
                        {...stroke}
                        d="M19 14.5A7.5 7.5 0 1 1 11 5a6 6 0 0 0 8 9.5Z"
                    />
                </svg>
            );

        case "pip":
        case "pip-on":
            return (
                <svg {...p}>
                    <rect {...stroke} x="3.5" y="5" width="17" height="14" rx="2.5" />
                    <rect {...stroke} x="12.5" y="11" width="5" height="4.5" rx="1" />
                </svg>
            );

        case "pip-off":
            return (
                <svg {...p}>
                    <rect {...stroke} x="3.5" y="5" width="17" height="14" rx="2.5" />
                    <rect {...stroke} x="12.5" y="11" width="5" height="4.5" rx="1" />
                    <path {...stroke} d="M4 4l16 16" />
                </svg>
            );

        case "close":
            return (
                <svg {...p}>
                    <path {...stroke} d="M6 6l12 12" />
                    <path {...stroke} d="M18 6L6 18" />
                </svg>
            );

        case "more":
            return (
                <svg {...p}>
                    <circle cx="6" cy="12" r="1.6" fill="currentColor" />
                    <circle cx="12" cy="12" r="1.6" fill="currentColor" />
                    <circle cx="18" cy="12" r="1.6" fill="currentColor" />
                </svg>
            );

        case "pin":
            return (
                <svg {...p}>
                    <path {...stroke} d="M9 4.5h6" />
                    <path {...stroke} d="M10 4.5v5l-2 2v1h8v-1l-2-2v-5" />
                    <path {...stroke} d="M12 12.5v7" />
                </svg>
            );

        case "hide":
            return (
                <svg {...p}>
                    <path {...stroke} d="M2.5 12s3.5-5.5 9.5-5.5S21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z" />
                    <circle {...stroke} cx="12" cy="12" r="2.8" />
                    <path {...stroke} d="M4 4l16 16" />
                </svg>
            );

        default:
            return (
                <svg {...p}>
                    <circle {...stroke} cx="12" cy="12" r="8.5" />
                </svg>
            );
    }
}

export function ParticipantsSmartIcon(
    props: Omit<IconProps, "name">
) {
    return <Icon {...props} name="participants" />;
}