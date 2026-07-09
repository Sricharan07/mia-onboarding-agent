declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;

class MiaPcmCaptureProcessor extends AudioWorkletProcessor {
  private buffer = new Float32Array(4096);
  private offset = 0;

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    outputs[0]?.[0]?.fill(0);
    if (!input) return true;

    let sourceOffset = 0;
    while (sourceOffset < input.length) {
      const count = Math.min(input.length - sourceOffset, this.buffer.length - this.offset);
      this.buffer.set(input.subarray(sourceOffset, sourceOffset + count), this.offset);
      this.offset += count;
      sourceOffset += count;
      if (this.offset === this.buffer.length) {
        const completed = this.buffer;
        this.port.postMessage(completed.buffer, [completed.buffer]);
        this.buffer = new Float32Array(4096);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("mia-pcm-capture", MiaPcmCaptureProcessor);
