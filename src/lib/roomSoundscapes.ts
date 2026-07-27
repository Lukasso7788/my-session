export type RoomSoundscapeId = "ambient" | "rain" | "forest" | "fireplace";

export const ROOM_SOUNDSCAPE_OPTIONS: Array<{
  id: RoomSoundscapeId;
  label: string;
  description: string;
  emoji: string;
}> = [
  {
    id: "ambient",
    label: "Ambient focus",
    description: "A soft, steady sound bed",
    emoji: "◌",
  },
  {
    id: "rain",
    label: "Gentle rain",
    description: "Even rainfall without thunder",
    emoji: "☂",
  },
  {
    id: "forest",
    label: "Quiet forest",
    description: "Warm air, leaves and distant birds",
    emoji: "♧",
  },
  {
    id: "fireplace",
    label: "Fireplace",
    description: "Low fire with subtle crackle",
    emoji: "♨",
  },
];

type StoppableNode = AudioScheduledSourceNode | AudioNode;

function createNoiseBuffer(context: AudioContext, seconds = 4) {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const channel = buffer.getChannelData(0);
  let brown = 0;

  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    brown = (brown + 0.018 * white) / 1.018;
    channel[i] = brown * 3.2;
  }

  return buffer;
}

function safeStop(node: StoppableNode) {
  try {
    if ("stop" in node && typeof node.stop === "function") node.stop();
  } catch {
    // A source may already have stopped.
  }
  try {
    node.disconnect();
  } catch {
    // It may already be disconnected.
  }
}

export class RoomSoundscapeEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private sources: StoppableNode[] = [];
  private timers: number[] = [];
  private requestedVolume = 0.35;

  private async ensureContext() {
    if (!this.context || this.context.state === "closed") {
      const Context = window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Context) throw new Error("Web Audio is unavailable in this browser");

      this.context = new Context();
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.context.destination);
    }

    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  async play(id: RoomSoundscapeId, volume: number) {
    const context = await this.ensureContext();
    this.clearSources();
    this.requestedVolume = Math.max(0, Math.min(1, volume));

    if (id === "ambient") this.buildAmbient(context);
    if (id === "rain") this.buildRain(context);
    if (id === "forest") this.buildForest(context);
    if (id === "fireplace") this.buildFireplace(context);

    const now = context.currentTime;
    this.master?.gain.cancelScheduledValues(now);
    this.master?.gain.setValueAtTime(0.0001, now);
    this.master?.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, this.requestedVolume),
      now + 0.65,
    );
  }

  setVolume(volume: number) {
    this.requestedVolume = Math.max(0, Math.min(1, volume));
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.requestedVolume, now, 0.08);
  }

  stop() {
    if (!this.context || !this.master) {
      this.clearSources();
      return;
    }

    const context = this.context;
    const sources = [...this.sources];
    this.sources = [];
    this.clearTimers();
    const now = context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(0.0001, now, 0.08);
    window.setTimeout(() => sources.forEach(safeStop), 450);
  }

  async destroy() {
    this.clearSources();
    const context = this.context;
    this.context = null;
    this.master = null;
    if (context && context.state !== "closed") {
      try {
        await context.close();
      } catch {
        // Best-effort cleanup during room teardown.
      }
    }
  }

  private connect(source: AudioNode, destination?: AudioNode) {
    source.connect(destination || this.master!);
    this.sources.push(source);
  }

  private loopNoise(context: AudioContext, gainValue: number) {
    const source = context.createBufferSource();
    source.buffer = createNoiseBuffer(context);
    source.loop = true;
    const gain = context.createGain();
    gain.gain.value = gainValue;
    source.connect(gain);
    this.connect(gain);
    this.sources.push(source);
    source.start();
    return { source, gain };
  }

  private buildAmbient(context: AudioContext) {
    const frequencies = [110, 164.81, 220];
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = index === 0 ? "sine" : "triangle";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = index === 1 ? -7 : index === 2 ? 5 : 0;
      const gain = context.createGain();
      gain.gain.value = index === 0 ? 0.095 : 0.035;
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 520;
      oscillator.connect(gain).connect(filter);
      this.connect(filter);
      this.sources.push(oscillator, gain);
      oscillator.start();
    });
    const { gain } = this.loopNoise(context, 0.018);
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 260;
    gain.disconnect();
    gain.connect(filter);
    filter.connect(this.master!);
    this.sources.push(filter);
  }

  private buildRain(context: AudioContext) {
    const { gain } = this.loopNoise(context, 0.3);
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 650;
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 7800;
    gain.disconnect();
    gain.connect(highpass).connect(lowpass).connect(this.master!);
    this.sources.push(highpass, lowpass);
  }

  private buildForest(context: AudioContext) {
    const { gain } = this.loopNoise(context, 0.075);
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 720;
    filter.Q.value = 0.45;
    gain.disconnect();
    gain.connect(filter).connect(this.master!);
    this.sources.push(filter);

    const chirp = () => {
      if (!this.context || this.context !== context || !this.master) return;
      const oscillator = context.createOscillator();
      const chirpGain = context.createGain();
      const start = context.currentTime;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(1850 + Math.random() * 600, start);
      oscillator.frequency.exponentialRampToValueAtTime(
        2600 + Math.random() * 700,
        start + 0.11,
      );
      chirpGain.gain.setValueAtTime(0.0001, start);
      chirpGain.gain.exponentialRampToValueAtTime(0.018, start + 0.018);
      chirpGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      oscillator.connect(chirpGain).connect(this.master);
      oscillator.start(start);
      oscillator.stop(start + 0.22);
    };
    this.timers.push(window.setInterval(chirp, 4200));
  }

  private buildFireplace(context: AudioContext) {
    const { gain } = this.loopNoise(context, 0.16);
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1050;
    gain.disconnect();
    gain.connect(filter).connect(this.master!);
    this.sources.push(filter);

    const crackle = () => {
      if (!this.context || this.context !== context || !this.master) return;
      const source = context.createBufferSource();
      const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.06), context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 4);
      }
      source.buffer = buffer;
      const crackleGain = context.createGain();
      crackleGain.gain.value = 0.06 + Math.random() * 0.08;
      const crackleFilter = context.createBiquadFilter();
      crackleFilter.type = "bandpass";
      crackleFilter.frequency.value = 900 + Math.random() * 1900;
      source.connect(crackleGain).connect(crackleFilter).connect(this.master);
      source.start();
    };
    this.timers.push(window.setInterval(crackle, 520));
  }

  private clearTimers() {
    this.timers.forEach((timer) => window.clearInterval(timer));
    this.timers = [];
  }

  private clearSources() {
    this.clearTimers();
    this.sources.forEach(safeStop);
    this.sources = [];
  }
}
