import type { BackgroundOptions, TrackTransformerDestroyOptions, VideoTransformerInitOptions } from '@livekit/track-processors';
import type { ImageSegmenter } from '@mediapipe/tasks-vision';

/** Android GPUs may lack float textures required by LiveKit's mask compositor. */
export class AndroidCanvasBackgroundTransformer {
  private segmenter?: ImageSegmenter;
  private options: BackgroundOptions;
  private image?: HTMLImageElement;
  private imagePath?: string;
  private output?: OffscreenCanvas;
  private person?: OffscreenCanvas;
  private mask?: OffscreenCanvas;
  constructor(options: BackgroundOptions) { this.options = options; }

  async init(_options: VideoTransformerInitOptions) {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm');
    this.segmenter = await ImageSegmenter.createFromOptions(files, {
      baseOptions: { delegate: 'CPU', modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite' },
      runningMode: 'VIDEO', outputCategoryMask: true, outputConfidenceMasks: false,
    });
    await this.update(this.options);
  }
  async restart(options: VideoTransformerInitOptions) { await this.destroy(); await this.init(options); }
  async destroy(_options?: TrackTransformerDestroyOptions) {
    this.segmenter?.close(); this.segmenter = undefined;
    this.output = this.person = this.mask = undefined;
    this.image = undefined; this.imagePath = undefined;
  }
  async update(options: BackgroundOptions) {
    this.options = { ...this.options, ...options };
    const path = this.options.imagePath;
    if (!path) { this.image = undefined; this.imagePath = undefined; return; }
    if (path === this.imagePath) return;
    const image = new Image(); image.crossOrigin = 'anonymous';
    await new Promise<void>((resolve,reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not load background image')); image.src = path; });
    this.image = image; this.imagePath = path;
  }
  async transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>) {
    if (!this.segmenter) { frame.close(); throw new Error('Android background is not initialized'); }
    const width = frame.displayWidth, height = frame.displayHeight;
    this.output ??= new OffscreenCanvas(width,height);
    this.person ??= new OffscreenCanvas(width,height);
    for (const canvas of [this.output,this.person]) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    }
    const output = this.output.getContext('2d')!;
    const person = this.person.getContext('2d')!;
    try {
      // Read CPU bytes directly. Never convert masks to unsupported GPU float textures.
      this.segmenter.segmentForVideo(frame, performance.now(), result => {
        try {
          const category = result.categoryMask;
          if (!category) throw new Error('Person segmentation mask unavailable');
          this.mask ??= new OffscreenCanvas(category.width,category.height);
          if (this.mask.width !== category.width) this.mask.width = category.width;
          if (this.mask.height !== category.height) this.mask.height = category.height;
          const bytes = category.getAsUint8Array();
          const pixels = new Uint8ClampedArray(bytes.length * 4);
          for (let i=0;i<bytes.length;i++) {
            pixels[i*4] = pixels[i*4+1] = pixels[i*4+2] = 255;
            pixels[i*4+3] = bytes[i] > 0 ? 255 : 0;
          }
          this.mask.getContext('2d')!.putImageData(new ImageData(pixels,category.width,category.height),0,0);
          person.clearRect(0,0,width,height);
          person.globalCompositeOperation = 'source-over';
          person.drawImage(frame,0,0,width,height);
          person.globalCompositeOperation = 'destination-in';
          person.drawImage(this.mask,0,0,width,height);
          person.globalCompositeOperation = 'source-over';
          output.clearRect(0,0,width,height);
          if (this.image) {
            const scale = Math.max(width/this.image.naturalWidth,height/this.image.naturalHeight);
            const w=this.image.naturalWidth*scale,h=this.image.naturalHeight*scale;
            output.drawImage(this.image,(width-w)/2,(height-h)/2,w,h);
          } else {
            output.save(); output.filter = `blur(${this.options.blurRadius ?? 12}px)`;
            output.drawImage(frame,-20,-20,width+40,height+40); output.restore();
          }
          output.drawImage(this.person!,0,0,width,height);
          controller.enqueue(new VideoFrame(this.output!,{timestamp:frame.timestamp}));
        } finally { result.close(); }
      });
    } finally { frame.close(); }
  }
}
