export type RoomSoundscapeId =
  | "ambient"
  | "flow-relax"
  | "rain"
  | "forest"
  | "fireplace"
  | "custom";

export const ROOM_SOUNDSCAPE_OPTIONS: Array<{
  id: RoomSoundscapeId;
  label: string;
  description: string;
  file: string;
  emoji: string;
}> = [
  {
    id: "ambient",
    label: "Ambient focus",
    description: "Calm instrumental focus music",
    file: "/sounds/room-music/ambient-focus.mp3",
    emoji: "◌",
  },
  {
    id: "flow-relax",
    label: "Flow relax",
    description: "Warm, relaxed chillout for steady work",
    file: "/sounds/room-music/flow-relax.mp3",
    emoji: "◎",
  },
  {
    id: "rain",
    label: "Gentle rain",
    description: "Even rainfall without thunder",
    file: "/sounds/room-music/gentle-rain.mp3",
    emoji: "☂",
  },
  {
    id: "forest",
    label: "Quiet forest",
    description: "A calm European forest atmosphere",
    file: "/sounds/room-music/quiet-forest.mp3",
    emoji: "♧",
  },
  {
    id: "fireplace",
    label: "Fireplace",
    description: "A low fire with natural crackle",
    file: "/sounds/room-music/fireplace.mp3",
    emoji: "♨",
  },
];

const SOUND_URL_BY_ID = new Map(
  ROOM_SOUNDSCAPE_OPTIONS.map((option) => [option.id, option.file]),
);

function waitForAudioMetadata(audio: HTMLAudioElement) {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("The soundtrack took too long to load."));
    }, 12_000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      audio.removeEventListener("loadedmetadata", onReady);
      audio.removeEventListener("error", onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("This soundtrack file is not available yet."));
    };
    audio.addEventListener("loadedmetadata", onReady, { once: true });
    audio.addEventListener("error", onError, { once: true });
  });
}

export class RoomSoundscapeEngine {
  private audio: HTMLAudioElement | null = null;
  private activeId: RoomSoundscapeId | null = null;
  private requestedVolume = 0.35;
  private muted = false;

  async play(
    id: RoomSoundscapeId,
    volume: number,
    positionSeconds = 0,
    customUrl?: string,
  ) {
    const url = id === "custom" ? String(customUrl || "").trim() : SOUND_URL_BY_ID.get(id);
    if (!url) throw new Error("Unknown room soundtrack.");

    this.requestedVolume = Math.max(0, Math.min(1, volume));
    let audio = this.audio;

    if (!audio || this.activeId !== id || audio.src !== new URL(url, window.location.href).href) {
      const previous = audio;
      audio = new Audio(url);
      audio.loop = true;
      audio.preload = "auto";
      audio.volume = this.requestedVolume;
      audio.muted = this.muted;
      await waitForAudioMetadata(audio);
      previous?.pause();
      this.audio = audio;
      this.activeId = id;
    }

    const duration = Number(audio.duration || 0);
    const requestedPosition = Math.max(0, Number(positionSeconds || 0));
    const normalizedPosition =
      Number.isFinite(duration) && duration > 0
        ? requestedPosition % duration
        : requestedPosition;

    if (Math.abs(audio.currentTime - normalizedPosition) > 1.25) {
      try {
        audio.currentTime = normalizedPosition;
      } catch {
        // Some browsers reject seeks until enough data has buffered.
      }
    }

    audio.volume = this.requestedVolume;
    audio.muted = this.muted;
    await audio.play();
  }

  pause() {
    this.audio?.pause();
    return this.currentTime();
  }

  stop() {
    if (!this.audio) return;
    this.audio.pause();
    try {
      this.audio.currentTime = 0;
    } catch {
      // Seeking can fail while a file is still loading.
    }
  }

  setVolume(volume: number) {
    this.requestedVolume = Math.max(0, Math.min(1, volume));
    if (this.audio) this.audio.volume = this.requestedVolume;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.audio) this.audio.muted = muted;
  }

  currentTime() {
    return Math.max(0, Number(this.audio?.currentTime || 0));
  }

  destroy() {
    const audio = this.audio;
    this.audio = null;
    this.activeId = null;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
}
