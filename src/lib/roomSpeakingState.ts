type SpeakingTile = { id: string; kind?: string; micMuted?: boolean; isSpeaking?: boolean };

/** Speaker events only change flags; preserve media, metadata and unchanged objects. */
export function updateTileSpeakingState<T extends SpeakingTile>(tiles: T[], activeIds: ReadonlySet<string>): T[] {
    let next: T[] | undefined;
    tiles.forEach((tile, index) => {
        if (tile.kind === "screen") return;
        const speaking = !tile.micMuted && activeIds.has(tile.id);
        if (!!tile.isSpeaking === speaking) return;
        next ??= tiles.slice();
        next[index] = { ...tile, isSpeaking: speaking };
    });
    return next || tiles;
}
