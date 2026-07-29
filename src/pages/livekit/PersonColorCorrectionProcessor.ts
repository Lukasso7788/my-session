import {
  BackgroundTransformer,
  ProcessorWrapper,
  type BackgroundOptions,
  type ProcessorWrapperOptions,
  type TrackTransformerDestroyOptions,
  type VideoTransformerInitOptions,
} from "@livekit/track-processors";

export type PublishedColorCorrection = {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
};

type ColorCorrectionOptions = Record<string, unknown> & {
  correction: PublishedColorCorrection;
};

type PersonBackgroundOptions = Record<string, unknown> &
  BackgroundOptions & {
    correction: PublishedColorCorrection;
  };

const STABLE_SEGMENTATION_FPS = 18;

type BackgroundTransformerInternals = {
  updateMask: (mask: unknown) => void;
  drawFrame: (frame: VideoFrame) => void;
};

export type PersonBackgroundMode =
  | { mode: "background-blur"; blurRadius: number }
  | { mode: "virtual-background"; imagePath: string };

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number(value) || 0));

export function normalizePublishedColorCorrection(
  value: PublishedColorCorrection,
): PublishedColorCorrection {
  return {
    brightness: Math.round(clamp(value?.brightness, 50, 150) || 100),
    contrast: Math.round(clamp(value?.contrast, 50, 150) || 100),
    saturation: Math.round(clamp(value?.saturation, 0, 200)),
    warmth: Math.round(clamp(value?.warmth, -100, 100)),
  };
}

export function isPublishedColorCorrectionIdentity(
  value: PublishedColorCorrection,
) {
  const normalized = normalizePublishedColorCorrection(value);
  return (
    normalized.brightness === 100 &&
    normalized.contrast === 100 &&
    normalized.saturation === 100 &&
    normalized.warmth === 0
  );
}

export function publishedColorCorrectionSignature(
  value: PublishedColorCorrection,
) {
  const normalized = normalizePublishedColorCorrection(value);
  return `${normalized.brightness}:${normalized.contrast}:${normalized.saturation}:${normalized.warmth}`;
}

function buildPublishedFilter(value: PublishedColorCorrection) {
  const normalized = normalizePublishedColorCorrection(value);
  const sepia =
    normalized.warmth > 0
      ? Math.min(
          0.32,
          normalized.warmth / 1000 + normalized.warmth / 500,
        )
      : 0;
  const hueRotate =
    normalized.warmth < 0
      ? Math.round((Math.abs(normalized.warmth) / 100) * 16)
      : 0;

  return [
    `brightness(${normalized.brightness}%)`,
    `contrast(${normalized.contrast}%)`,
    `saturate(${normalized.saturation}%)`,
    `sepia(${sepia})`,
    hueRotate ? `hue-rotate(${hueRotate}deg)` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

class FrameColorCorrectionSurface {
  private canvas?: OffscreenCanvas | HTMLCanvasElement;
  private context?: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

  reset() {
    this.canvas = undefined;
    this.context = undefined;
  }

  makeFrame(frame: VideoFrame, correction: PublishedColorCorrection) {
    const width = Math.max(1, frame.displayWidth || frame.codedWidth);
    const height = Math.max(1, frame.displayHeight || frame.codedHeight);

    if (!this.canvas) {
      this.canvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(width, height)
          : document.createElement("canvas");
      this.context = this.canvas.getContext("2d", {
        alpha: false,
        desynchronized: true,
      } as CanvasRenderingContext2DSettings) as
        | OffscreenCanvasRenderingContext2D
        | CanvasRenderingContext2D
        | undefined;
    }

    if (!this.context || !this.canvas) {
      throw new Error("Color correction canvas is unavailable.");
    }

    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;

    const context = this.context as CanvasRenderingContext2D & {
      filter: string;
    };
    context.save();
    context.filter = buildPublishedFilter(correction);
    context.drawImage(frame, 0, 0, width, height);
    context.restore();

    return new VideoFrame(this.canvas, {
      timestamp: frame.timestamp,
      duration: frame.duration ?? undefined,
    });
  }
}

class ColorCorrectionTransformer {
  transformer?: TransformStream<VideoFrame, VideoFrame>;
  private correction: PublishedColorCorrection;
  private surface = new FrameColorCorrectionSurface();

  constructor(options: ColorCorrectionOptions) {
    this.correction = normalizePublishedColorCorrection(options.correction);
  }

  async init() {
    this.transformer = new TransformStream<VideoFrame, VideoFrame>({
      transform: (frame, controller) => this.transform(frame, controller),
    });
  }

  async restart() {
    this.surface.reset();
    await this.init();
  }

  async destroy() {
    this.surface.reset();
    this.transformer = undefined;
  }

  async update(options: ColorCorrectionOptions) {
    this.correction = normalizePublishedColorCorrection(options.correction);
  }

  async transform(
    frame: VideoFrame,
    controller: TransformStreamDefaultController<VideoFrame>,
  ) {
    if (isPublishedColorCorrectionIdentity(this.correction)) {
      controller.enqueue(frame);
      return;
    }

    try {
      const correctedFrame = this.surface.makeFrame(frame, this.correction);
      frame.close();
      controller.enqueue(correctedFrame);
    } catch (error) {
      console.warn("[color-correction] frame processing failed", error);
      controller.enqueue(frame);
    }
  }
}

/**
 * LiveKit's stock transformer segments every camera frame and writes the
 * canvas dimensions on every pass. On real webcams that makes the binary mask
 * react to tiny frame-to-frame confidence changes and can also reset the
 * drawing surface unnecessarily. Keep rendering at the source frame rate, but
 * refresh the person mask at a steady cadence and reuse it between updates.
 */
class StabilizedBackgroundTransformer extends BackgroundTransformer {
  private lastSegmentationAt = 0;
  private hasUsableMask = false;
  private readonly segmentationIntervalMs = 1000 / STABLE_SEGMENTATION_FPS;

  private updateStableMask(mask: unknown) {
    (this as unknown as BackgroundTransformerInternals).updateMask(mask);
  }

  private drawStableFrame(frame: VideoFrame) {
    (this as unknown as BackgroundTransformerInternals).drawFrame(frame);
  }

  async primeMask(inputElement: HTMLVideoElement) {
    if (
      !this.imageSegmenter ||
      typeof VideoFrame === "undefined" ||
      inputElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      inputElement.videoWidth <= 0 ||
      inputElement.videoHeight <= 0
    ) {
      return false;
    }

    let frame: VideoFrame | null = null;
    try {
      frame = new VideoFrame(inputElement);
      const timestamp = performance.now();

      await new Promise<void>((resolve, reject) => {
        try {
          this.imageSegmenter!.segmentForVideo(frame!, timestamp, (result) => {
            try {
              this.updateStableMask(result.categoryMask);
              this.segmentationResults = result;
              this.lastSegmentationAt = timestamp;
              this.hasUsableMask = true;
            } finally {
              result.close();
              resolve();
            }
          });
        } catch (error) {
          reject(error);
        }
      });

      return true;
    } catch {
      return false;
    } finally {
      frame?.close();
    }
  }

  async restart(options: VideoTransformerInitOptions) {
    this.lastSegmentationAt = 0;
    this.hasUsableMask = false;
    await super.restart(options);
    await this.primeMask(options.inputElement);
  }

  async transform(
    frame: VideoFrame,
    controller: TransformStreamDefaultController<VideoFrame>,
  ) {
    let enqueuedFrame = false;
    let closeInputFrame = true;

    try {
      if (
        !(frame instanceof VideoFrame) ||
        frame.codedWidth === 0 ||
        frame.codedHeight === 0
      ) {
        return;
      }

      let skipProcessing =
        this.isDisabled ?? this.options.backgroundDisabled ?? false;
      if (
        typeof this.options.blurRadius !== "number" &&
        typeof this.options.imagePath !== "string"
      ) {
        skipProcessing = true;
      }

      if (skipProcessing) {
        controller.enqueue(frame);
        enqueuedFrame = true;
        closeInputFrame = false;
        return;
      }

      if (!this.canvas) {
        throw new TypeError("Background canvas is unavailable.");
      }

      // Assigning width/height resets a canvas even when the value is
      // unchanged. Avoid that per-frame reset: it is a major source of flashes
      // on ChromeOS/Safari fallback paths.
      if (this.canvas.width !== frame.displayWidth) {
        this.canvas.width = frame.displayWidth;
      }
      if (this.canvas.height !== frame.displayHeight) {
        this.canvas.height = frame.displayHeight;
      }

      const now = performance.now();
      const shouldRefreshMask =
        !this.lastSegmentationAt ||
        now - this.lastSegmentationAt >= this.segmentationIntervalMs;
      let segmentationPromise = Promise.resolve();

      if (shouldRefreshMask && this.imageSegmenter) {
        this.lastSegmentationAt = now;
        const startedAt = performance.now();
        segmentationPromise = new Promise<void>((resolve, reject) => {
          try {
            this.imageSegmenter!.segmentForVideo(frame, now, (result) => {
              try {
                this.segmentationTimeMs = performance.now() - startedAt;
                this.segmentationResults = result;
                this.updateStableMask(result.categoryMask);
                this.hasUsableMask = true;
              } finally {
                result.close();
                resolve();
              }
            });
          } catch (error) {
            reject(error);
          }
        });
      }

      // The first processed frame waits for a real mask instead of exposing a
      // raw camera frame or a blank background. Later frames keep flowing with
      // the previous stable mask while the next segmentation is calculated.
      if (!this.hasUsableMask) {
        await segmentationPromise;
      }

      const filterStartedAt = performance.now();
      this.drawStableFrame(frame);

      if (this.canvas.width > 0 && this.canvas.height > 0) {
        controller.enqueue(
          new VideoFrame(this.canvas, {
            timestamp: frame.timestamp,
            duration: frame.duration ?? undefined,
          }),
        );
        enqueuedFrame = true;
        this.options.onFrameProcessed?.({
          processingTimeMs:
            (shouldRefreshMask ? this.segmentationTimeMs : 0) +
            (performance.now() - filterStartedAt),
          segmentationTimeMs: shouldRefreshMask ? this.segmentationTimeMs : 0,
          filterTimeMs: performance.now() - filterStartedAt,
        });
      }

      await segmentationPromise;
    } catch (error) {
      console.warn("[stable-background] frame processing failed", error);
      if (!enqueuedFrame) {
        controller.enqueue(frame);
        enqueuedFrame = true;
        closeInputFrame = false;
      }
    } finally {
      if (closeInputFrame) frame.close();
    }
  }
}

class PersonBackgroundTransformer {
  transformer?: TransformStream<VideoFrame, VideoFrame>;
  private correction: PublishedColorCorrection;
  private background: StabilizedBackgroundTransformer;
  private surface = new FrameColorCorrectionSurface();

  constructor(options: PersonBackgroundOptions) {
    const { correction, ...backgroundOptions } = options;
    this.correction = normalizePublishedColorCorrection(correction);
    this.background = new StabilizedBackgroundTransformer(backgroundOptions);
  }

  async init(options: VideoTransformerInitOptions) {
    await this.background.init(options);
    // Warm the mask before the output transformer starts consuming frames, so
    // applying blur/background never publishes a raw placeholder frame.
    await this.background.primeMask(options.inputElement);
    this.transformer = new TransformStream<VideoFrame, VideoFrame>({
      transform: (frame, controller) => this.transform(frame, controller),
    });
  }

  async restart(options: VideoTransformerInitOptions) {
    this.surface.reset();
    await this.background.restart(options);
  }

  async destroy(options?: TrackTransformerDestroyOptions) {
    this.surface.reset();
    await this.background.destroy(options);
    this.transformer = undefined;
  }

  async update(options: Partial<PersonBackgroundOptions>) {
    if (options.correction) {
      this.correction = normalizePublishedColorCorrection(options.correction);
    }

    const backgroundOptions = { ...options };
    delete backgroundOptions.correction;
    if (Object.keys(backgroundOptions).length > 0) {
      await this.background.update(backgroundOptions);
    }
  }

  async transform(
    frame: VideoFrame,
    controller: TransformStreamDefaultController<VideoFrame>,
  ) {
    if (isPublishedColorCorrectionIdentity(this.correction)) {
      await this.background.transform(frame, controller);
      return;
    }

    try {
      // Correct the camera frame before segmentation/compositing. The virtual
      // background is loaded separately by BackgroundTransformer, so it never
      // receives this filter; only the participant pixels do.
      const correctedFrame = this.surface.makeFrame(frame, this.correction);
      frame.close();
      await this.background.transform(correctedFrame, controller);
    } catch (error) {
      console.warn("[person-color-correction] frame processing failed", error);
      await this.background.transform(frame, controller);
    }
  }
}

export class PublishedColorCorrectionProcessor extends ProcessorWrapper<
  ColorCorrectionOptions,
  ColorCorrectionTransformer
> {
  constructor(
    correction: PublishedColorCorrection,
    options: ProcessorWrapperOptions = {},
  ) {
    super(
      new ColorCorrectionTransformer({ correction }),
      "published-color-correction",
      options,
    );
  }

  async setColorCorrection(correction: PublishedColorCorrection) {
    await this.updateTransformerOptions({ correction });
  }
}

export class PersonColorBackgroundProcessor extends ProcessorWrapper<
  PersonBackgroundOptions,
  PersonBackgroundTransformer
> {
  constructor(
    mode: PersonBackgroundMode,
    correction: PublishedColorCorrection,
    options: ProcessorWrapperOptions = {},
  ) {
    const backgroundOptions =
      mode.mode === "background-blur"
        ? { blurRadius: mode.blurRadius }
        : { imagePath: mode.imagePath };
    super(
      new PersonBackgroundTransformer({
        ...backgroundOptions,
        correction,
      }),
      "person-color-background",
      options,
    );
  }

  async setColorCorrection(correction: PublishedColorCorrection) {
    await this.updateTransformerOptions({ correction });
  }

  async switchTo(mode: PersonBackgroundMode) {
    if (mode.mode === "background-blur") {
      await this.updateTransformerOptions({
        imagePath: undefined,
        blurRadius: mode.blurRadius,
        backgroundDisabled: false,
      });
      return;
    }

    await this.updateTransformerOptions({
      imagePath: mode.imagePath,
      blurRadius: undefined,
      backgroundDisabled: false,
    });
  }
}

export function createPublishedColorCorrectionProcessor(
  correction: PublishedColorCorrection,
) {
  return new PublishedColorCorrectionProcessor(correction);
}

export function createPersonColorBackgroundProcessor(args: {
  mode: PersonBackgroundMode;
  correction: PublishedColorCorrection;
}) {
  return new PersonColorBackgroundProcessor(args.mode, args.correction);
}
