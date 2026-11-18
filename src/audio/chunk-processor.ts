// AudioWorklet globals are not included in TypeScript's DOM library.
declare const sampleRate: number;
declare abstract class AudioWorkletProcessor { readonly port: MessagePort; constructor(); }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class ChunkProcessor extends AudioWorkletProcessor {
  buffer: Float32Array;
  length: number;
  startSample: number;
  stopped: boolean;
  constructor() {
    super();
    this.buffer = new Float32Array(sampleRate * 10);
    this.length = 0;
    this.startSample = 0;
    this.stopped = false;
    this.port.onmessage = ({ data }) => {
      if (data === 'stop' && !this.stopped) {
        this.stopped = true;
        this.flush();
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  flush() {
    if (!this.length) return;
    const samples = this.buffer.slice(0, this.length);
    this.port.postMessage({
      type: 'chunk', samples, startSample: this.startSample, sampleRate,
    }, [samples.buffer]);
    this.startSample += this.length;
    this.length = 0;
  }

  process(inputs: Float32Array[][]) {
    if (this.stopped) return false;
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    let offset = 0;
    while (offset < samples.length) {
      const count = Math.min(samples.length - offset, this.buffer.length - this.length);
      this.buffer.set(samples.subarray(offset, offset + count), this.length);
      this.length += count;
      offset += count;
      if (this.length === this.buffer.length) this.flush();
    }
    // Leave the output silent so the microphone never plays through the speakers.
    return true;
  }
}

registerProcessor('microphone-chunks', ChunkProcessor);
