export class MicLevelMeter {
  private context?: AudioContext;
  private analyser?: AnalyserNode;
  private source?: MediaStreamAudioSourceNode;
  private raf?: number;
  private data?: Uint8Array<ArrayBuffer>;

  constructor(
    private readonly track: MediaStreamTrack,
    private readonly onLevel: (level: number) => void
  ) {}

  start(): void {
    if (this.context) return;
    this.context = new AudioContext();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.72;
    this.data = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.source = this.context.createMediaStreamSource(new MediaStream([this.track]));
    this.source.connect(this.analyser);
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = undefined;
    this.source?.disconnect();
    this.source = undefined;
    this.analyser = undefined;
    void this.context?.close();
    this.context = undefined;
    this.onLevel(0);
  }

  private readonly tick = (): void => {
    if (!this.analyser || !this.data) return;
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (const sample of this.data) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / this.data.length);
    this.onLevel(Math.min(1, rms * 5.5));
    this.raf = requestAnimationFrame(this.tick);
  };
}
