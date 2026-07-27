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
  icon: string;
  artwork: string;
  durationSeconds: number;
}> = [
  {
    id: "ambient",
    label: "Ambient focus",
    description: "Calm instrumental focus music",
    file: "/sounds/room-music/ambient-focus.mp3",
    icon: "/icons/music-ambient-focus.svg",
    artwork: "/images/room-music/ambient-focus.svg",
    durationSeconds: 154,
  },
  {
    id: "flow-relax",
    label: "Flow relax",
    description: "Warm, relaxed chillout for steady work",
    file: "/sounds/room-music/flow-relax.mp3",
    icon: "/icons/music-flow-relax.svg",
    artwork: "/images/room-music/flow-relax.svg",
    durationSeconds: 114,
  },
  {
    id: "rain",
    label: "Gentle rain",
    description: "Even rainfall without thunder",
    file: "/sounds/room-music/gentle-rain.mp3",
    icon: "/icons/music-gentle-rain.svg",
    artwork: "/images/room-music/gentle-rain.svg",
    durationSeconds: 15,
  },
  {
    id: "forest",
    label: "Quiet forest",
    description: "A calm European forest atmosphere",
    file: "/sounds/room-music/quiet-forest.mp3",
    icon: "/icons/music-quiet-forest.svg",
    artwork: "/images/room-music/quiet-forest.svg",
    durationSeconds: 161,
  },
  {
    id: "fireplace",
    label: "Fireplace",
    description: "A low fire with natural crackle",
    file: "/sounds/room-music/fireplace.mp3",
    icon: "/icons/music-fireplace.svg",
    artwork: "/images/room-music/campfire.svg",
    durationSeconds: 30,
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
  private standbyAudio: HTMLAudioElement | null = null;
  private activeId: RoomSoundscapeId | null = null;
  private activeUrl = "";
  private requestedVolume = 0.35;
  private muted = false;
  private playing = false;
  private loopTimer: number | null = null;
  private fadeTimer: number | null = null;
  private playbackGeneration = 0;

  private clearLoopTimers() {
    if (this.loopTimer != null) window.clearTimeout(this.loopTimer);
    if (this.fadeTimer != null) window.clearInterval(this.fadeTimer);
    this.loopTimer = null;
    this.fadeTimer = null;
  }

  private makeAudio(url: string) {
    const audio = new Audio(url);
    audio.loop = false;
    audio.preload = "auto";
    audio.muted = this.muted;
    audio.volume = 0;
    return audio;
  }

  private crossfadeSeconds(duration: number) {
    if (!Number.isFinite(duration) || duration <= 0) return 1.5;
    return Math.max(0.8, Math.min(2.5, duration * 0.08));
  }

  private sourceDuration() {
    const value = Number(this.audio?.duration || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  private scheduleSeamlessLoop() {
    this.clearLoopTimers();
    const audio = this.audio;
    if (!this.playing || !audio || !this.standbyAudio) return;
    const sourceDuration = this.sourceDuration();
    if (!sourceDuration) return;
    const fadeSeconds = this.crossfadeSeconds(sourceDuration);
    const delaySeconds = Math.max(
      0.02,
      sourceDuration - audio.currentTime - fadeSeconds,
    );
    const generation = this.playbackGeneration;
    this.loopTimer = window.setTimeout(() => {
      this.loopTimer = null;
      void this.startSeamlessCrossfade(generation, fadeSeconds);
    }, delaySeconds * 1000);
  }

  private async startSeamlessCrossfade(
    generation: number,
    fadeSeconds: number,
  ) {
    const outgoing = this.audio;
    const incoming = this.standbyAudio;
    if (
      !this.playing ||
      generation !== this.playbackGeneration ||
      !outgoing ||
      !incoming
    ) {
      return;
    }

    try {
      incoming.pause();
      incoming.currentTime = 0;
      incoming.muted = this.muted;
      incoming.volume = 0;
      await incoming.play();
    } catch {
      // A second media element can occasionally be blocked on restrictive
      // browsers. Fall back to their native loop rather than stopping audio.
      outgoing.loop = true;
      return;
    }

    if (!this.playing || generation !== this.playbackGeneration) {
      incoming.pause();
      return;
    }

    const startedAt = performance.now();
    this.fadeTimer = window.setInterval(() => {
      if (
        !this.playing ||
        generation !== this.playbackGeneration ||
        !this.audio ||
        !this.standbyAudio
      ) {
        this.clearLoopTimers();
        return;
      }
      const progress = Math.max(
        0,
        Math.min(1, (performance.now() - startedAt) / (fadeSeconds * 1000)),
      );
      // Equal-power curves keep perceived loudness stable during the overlap.
      outgoing.volume = this.requestedVolume * Math.cos(progress * Math.PI * 0.5);
      incoming.volume = this.requestedVolume * Math.sin(progress * Math.PI * 0.5);
      if (progress < 1) return;

      this.clearLoopTimers();
      outgoing.pause();
      outgoing.loop = false;
      try {
        outgoing.currentTime = 0;
      } catch {
        // The inactive element will be reset again before its next use.
      }
      outgoing.volume = 0;
      incoming.volume = this.requestedVolume;
      this.audio = incoming;
      this.standbyAudio = outgoing;
      this.scheduleSeamlessLoop();
    }, 40);
  }

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
    const resolvedUrl = new URL(url, window.location.href).href;

    if (!audio || this.activeId !== id || this.activeUrl !== resolvedUrl) {
      this.clearLoopTimers();
      this.playbackGeneration += 1;
      const previous = [this.audio, this.standbyAudio];
      audio = this.makeAudio(url);
      const standby = this.makeAudio(url);
      await Promise.all([waitForAudioMetadata(audio), waitForAudioMetadata(standby)]);
      for (const item of previous) {
        item?.pause();
        item?.removeAttribute("src");
        item?.load();
      }
      this.audio = audio;
      this.standbyAudio = standby;
      this.activeId = id;
      this.activeUrl = resolvedUrl;
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
    this.playing = true;
    this.scheduleSeamlessLoop();
  }

  pause() {
    this.playing = false;
    this.playbackGeneration += 1;
    this.clearLoopTimers();
    this.audio?.pause();
    this.standbyAudio?.pause();
    return this.currentTime();
  }

  stop() {
    if (!this.audio) return;
    this.playing = false;
    this.playbackGeneration += 1;
    this.clearLoopTimers();
    this.audio.pause();
    this.standbyAudio?.pause();
    try {
      this.audio.currentTime = 0;
      if (this.standbyAudio) this.standbyAudio.currentTime = 0;
    } catch {
      // Seeking can fail while a file is still loading.
    }
  }

  setVolume(volume: number) {
    this.requestedVolume = Math.max(0, Math.min(1, volume));
    if (this.audio) this.audio.volume = this.requestedVolume;
    if (this.standbyAudio && this.standbyAudio.paused) {
      this.standbyAudio.volume = 0;
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.audio) this.audio.muted = muted;
    if (this.standbyAudio) this.standbyAudio.muted = muted;
  }

  currentTime() {
    return Math.max(0, Number(this.audio?.currentTime || 0));
  }

  duration() {
    const sourceDuration = this.sourceDuration();
    return sourceDuration > 0
      ? Math.max(0.1, sourceDuration - this.crossfadeSeconds(sourceDuration))
      : 0;
  }

  seek(positionSeconds: number) {
    if (!this.audio) return 0;
    this.playbackGeneration += 1;
    this.clearLoopTimers();
    this.standbyAudio?.pause();
    if (this.standbyAudio) this.standbyAudio.volume = 0;
    const duration = this.duration();
    const next = Math.max(
      0,
      Math.min(duration > 0 ? duration : Number.MAX_SAFE_INTEGER, Number(positionSeconds || 0)),
    );
    try {
      this.audio.currentTime = next;
    } catch {
      // Browsers may reject a seek while metadata is still loading.
    }
    if (this.playing) this.scheduleSeamlessLoop();
    return this.currentTime();
  }

  destroy() {
    const elements = [this.audio, this.standbyAudio];
    this.clearLoopTimers();
    this.playing = false;
    this.playbackGeneration += 1;
    this.audio = null;
    this.standbyAudio = null;
    this.activeId = null;
    this.activeUrl = "";
    for (const audio of elements) {
      if (!audio) continue;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
  }
}
