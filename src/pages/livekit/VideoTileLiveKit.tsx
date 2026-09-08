import React from "react";
import { ChevronUp } from "lucide-react";

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

function VideoTileWithCameraPreview(props: VideoTileProps) {
    const openCameraPreview = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();

        const cameraArrow = document.querySelector<HTMLButtonElement>(
            'button[aria-label="Choose camera and background"]',
        );
        cameraArrow?.click();
    };

    return (
        <div className="relative h-full w-full min-h-0 min-w-0">
            <LegacyVideoTile {...props} />

            {props.isLocal ? (
                <button
                    type="button"
                    onClick={openCameraPreview}
                    className={`absolute right-[3rem] top-[0.55rem] z-[30] flex h-[2.1rem] w-[2.1rem] items-center justify-center rounded-full border shadow-sm backdrop-blur-md transition hover:scale-[1.04] ${
                        props.theme === "light"
                            ? "border-black/10 bg-white/78 text-[#2F2F2F] hover:bg-white"
                            : "border-white/15 bg-black/35 text-white hover:bg-black/50"
                    }`}
                    aria-label="Preview camera and background"
                    title="Preview camera & background"
                >
                    <ChevronUp size={16} strokeWidth={2.3} />
                </button>
            ) : null}
        </div>
    );
}

export const VideoTile = React.memo(VideoTileWithCameraPreview);
export default VideoTile;
