/**
 * The microphone's live loudness, so the screen can show "I can hear you" the
 * instant you start talking, before any word is recognised. Opens its own audio
 * stream (the speech recogniser's stream is not exposed); nothing is recorded
 * or sent anywhere, it only reads the level.
 */
export class MicMeter {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Float32Array | null = null;
  private smoothed = 0;

  async start(): Promise<void> {
    if (this.stream) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      this.ctx = new AudioContext();
      const source = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      source.connect(this.analyser);
      this.data = new Float32Array(this.analyser.fftSize);
    } catch {
      // No meter is fine: the words still appear as they are recognised.
      this.stop();
    }
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.data = null;
    this.smoothed = 0;
  }

  /** 0 (silence) to 1 (loud speech), fast attack, slow release. Call once per frame. */
  level(): number {
    if (!this.analyser || !this.data) return 0;
    this.analyser.getFloatTimeDomainData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) sum += this.data[i]! * this.data[i]!;
    const rms = Math.sqrt(sum / this.data.length);
    // Speech at a laptop mic sits around 0.02-0.15 RMS; map that onto 0..1.
    const target = Math.min(1, Math.max(0, (Math.log10(rms + 1e-6) + 2.4) / 1.6));
    this.smoothed += (target - this.smoothed) * (target > this.smoothed ? 0.6 : 0.12);
    return this.smoothed;
  }
}
