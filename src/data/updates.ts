import type { UpdateItem } from "../components/UpdateCard";

export const UPDATES: UpdateItem[] = [
    {
        date: "2025-12-23",
        title: "Room: device switching is stable",
        tag: "Room",
        bullets: [
            "Improved local track replacement flow (no UI break).",
            "Added safer guards around mute/unmute states.",
            "Prepared pipeline for background effects (blocked by lib build).",
        ],
    },
    {
        date: "2025-12-22",
        title: "Sessions list polishing",
        tag: "UI",
        bullets: [
            "Cleaner session cards and actions.",
            "Better spacing + consistent pills/buttons style.",
        ],
    },
    {
        date: "2025-12-20",
        title: "Stage timer + sounds",
        tag: "Core",
        bullets: [
            "Intro/Focus/Break/Outro schedule support.",
            "Audio unlock logic for Chrome autoplay restrictions.",
        ],
    },
];
