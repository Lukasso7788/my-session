import React from "react";

import LegacyVideoTile, {
    SkipMeMutedStatusIcon,
    VideoTile as LegacyVideoTileNamed,
} from "./VideoTileLiveKitLegacy";

export { SkipMeMutedStatusIcon };
export type {
    CameraFramingMode,
    VideoTileTaskItem,
} from "./VideoTileLiveKitLegacy";

type VideoTileProps = React.ComponentProps<typeof LegacyVideoTileNamed>;

const ROOM_SETTINGS_LABEL = "Video room settings";
const BACKGROUND_SETTINGS_LABEL = "Background settings";

function openBackgroundSettingsFromRoomMenu(doc: Document) {
    // The bottom-bar camera arrow is already the single entry point for both
    // private preview (camera off) and live background controls (camera on).
    const cameraArrow = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Choose camera and background"]',
    );

    // Close the participant menu before opening the camera/background surface.
    // RoomPageLiveKit already treats Escape as the canonical menu-close action.
    try {
        doc.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "Escape",
                code: "Escape",
                bubbles: true,
            }),
        );
    } catch { }

    window.setTimeout(() => cameraArrow?.click(), 0);
}

function decorateLocalTileMenu(doc: Document) {
    let observer: MutationObserver | null = null;
    let timeoutId: number | null = null;

    const decorate = () => {
        const buttons = Array.from(
            doc.querySelectorAll<HTMLButtonElement>("button"),
        );
        const settingsButton = buttons.find(
            (button) =>
                button.textContent?.trim() === ROOM_SETTINGS_LABEL &&
                button.getClientRects().length > 0,
        );

        if (!settingsButton) return false;
        if (settingsButton.dataset.mysessionBackgroundSettings === "true") {
            return true;
        }

        settingsButton.dataset.mysessionBackgroundSettings = "true";
        settingsButton.textContent = BACKGROUND_SETTINGS_LABEL;
        settingsButton.setAttribute("aria-label", BACKGROUND_SETTINGS_LABEL);
        settingsButton.title = BACKGROUND_SETTINGS_LABEL;

        settingsButton.addEventListener(
            "click",
            (event) => {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                openBackgroundSettingsFromRoomMenu(doc);
            },
            { capture: true, once: true },
        );

        return true;
    };

    if (decorate()) return;

    const MutationObserverCtor =
        doc.defaultView?.MutationObserver || window.MutationObserver;
    observer = new MutationObserverCtor(() => {
        if (!decorate()) return;
        observer?.disconnect();
        observer = null;
        if (timeoutId !== null) {
            window.clearTimeout(timeoutId);
            timeoutId = null;
        }
    });
    observer.observe(doc.body, { childList: true, subtree: true });

    timeoutId = window.setTimeout(() => {
        observer?.disconnect();
        observer = null;
        timeoutId = null;
    }, 800);
}

function VideoTileWithCameraPreviewMenu(props: VideoTileProps) {
    const onToggleMenu: VideoTileProps["onToggleMenu"] = props.isLocal
        ? (tileId, anchorEl) => {
            props.onToggleMenu?.(tileId, anchorEl);
            const doc = anchorEl?.ownerDocument || document;
            decorateLocalTileMenu(doc);
        }
        : props.onToggleMenu;

    return <LegacyVideoTile {...props} onToggleMenu={onToggleMenu} />;
}

export const VideoTile = React.memo(VideoTileWithCameraPreviewMenu);
export default VideoTile;
