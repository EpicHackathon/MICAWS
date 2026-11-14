import { encodeWav } from '../audio/encodeWav.js';
import { transcribeAudio } from './transcribeAudio.js';

export class MicrophoneSession {
  constructor({ onTranscript, onStatus, onError, startSeconds = 0 }) {
    this.onTranscript = onTranscript;
    this.onStatus = onStatus;
    this.onError = onError;
    this.startSeconds = startSeconds;
    this.id = crypto.randomUUID();
    this.controller = new AbortController();
    this.queue = [];
    this.cancelled = false;
    this.stopping = false;
    this.captureDone = false;
    this.processing = false;
    this.failed = false;
  }

  async start() {
    this.onStatus('starting');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !globalThis.AudioWorkletNode
          || !globalThis.AudioContext) {
        throw new Error('Microphone recording requires a supported browser on localhost or HTTPS.');
      }
      this.context = new AudioContext();
      // Resume directly from the button click, before waiting for microphone permission.
      await this.context.resume();
      if (this.cancelled) return;
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.cancelled) { this.release(); return; }
      await this.context.audioWorklet.addModule(new URL('../audio/chunk-processor.js', import.meta.url));
      if (this.cancelled) return;
      this.source = this.context.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.context, 'microphone-chunks', {
        channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1],
      });
      this.node.port.onmessage = ({ data }) => this.receive(data);
      this.node.onprocessorerror = () => {
        if (this.cancelled) return;
        this.onError('Audio capture failed; the unfinished chunk could not be saved. Earlier chunks are still being processed.');
        this.captureDone = true;
        this.stopping = true;
        this.release();
        this.onStatus('transcribing');
        void this.drain();
      };
      this.source.connect(this.node);
      this.node.connect(this.context.destination);
      this.stream.getAudioTracks().forEach(track => {
        track.onended = () => this.stop();
      });
      this.context.onstatechange = () => {
        if (!this.cancelled && !this.stopping && this.context.state !== 'running') {
          this.onError('Audio capture was interrupted. Processing the audio already captured.');
          this.stop();
        }
      };
      this.onStatus('recording');
    } catch (cause) {
      if (this.cancelled) return;
      this.release();
      this.onError(cause.message || 'Could not access the microphone.');
      this.onStatus('idle');
    }
  }

  receive(data) {
    if (this.cancelled) return;
    if (data.type === 'stopped') {
      this.captureDone = true;
      this.release();
    } else if (data.type === 'chunk') {
      const startSeconds = this.startSeconds + data.startSample / data.sampleRate;
      this.queue.push({
        audio: encodeWav(data.samples, data.sampleRate),
        chunkId: `${this.id}-${data.startSample}`,
        startSeconds,
        endSeconds: startSeconds + data.samples.length / data.sampleRate,
      });
      // Bound memory if inference cannot keep up with capture.
      if (this.queue.length >= 12 && !this.stopping) {
        this.onError('Transcription is falling behind. Recording stopped so the remaining audio can finish processing.');
        this.stop();
      }
    }
    void this.drain();
  }

  async drain() {
    if (this.processing || this.failed || this.cancelled) return;
    this.processing = true;
    try {
      while (this.queue.length && !this.cancelled) {
        const chunk = this.queue[0];
        const transcript = await transcribeAudio(chunk.audio, this.controller.signal, chunk);
        if (this.cancelled) return;
        this.queue.shift();
        this.onTranscript(transcript, chunk.endSeconds);
      }
    } catch (cause) {
      if (!this.cancelled) {
        this.failed = true;
        this.stop();
        this.onStatus('transcribing');
        this.onError(`${cause.message} Audio is retained. Click Process pending / retry to try again, or Reset session to discard it.`);
      }
    } finally {
      this.processing = false;
      if (!this.cancelled && !this.failed && this.captureDone && !this.queue.length) {
        this.onStatus('idle');
      }
    }
  }

  stop() {
    if (this.stopping || this.cancelled || !this.node) return;
    this.stopping = true;
    this.onStatus('transcribing');
    this.node.port.postMessage('stop');
    this.stream.getTracks().forEach(track => track.stop());
  }

  retry() {
    if (!this.failed || this.cancelled) return;
    this.failed = false;
    this.onError(null);
    void this.drain();
  }

  release() {
    if (this.context) this.context.onstatechange = null;
    this.stream?.getTracks().forEach(track => track.stop());
    this.source?.disconnect();
    this.node?.disconnect();
    this.node?.port.close();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
  }

  cancel() {
    this.cancelled = true;
    this.controller.abort();
    this.queue = [];
    this.release();
  }
}
