import type { TranscriptionSegment } from './transcribeAudio.js';
export type MicrophoneStatus = 'idle' | 'starting' | 'recording' | 'transcribing';
type AudioQueueItem = { audio: Blob; chunkId: string; startSeconds: number; endSeconds: number; language: string };
type WorkletMessage = { type: 'stopped' } | { type: 'chunk'; samples: Float32Array; sampleRate: number; startSample: number };
type MicrophoneSessionOptions = {
  onTranscript: (segments: TranscriptionSegment[], endSeconds: number) => void;
  onStatus: (status: MicrophoneStatus) => void;
  onError: (message: string | null) => void;
  onAudioChunk?: (samples: Float32Array, rate: number, start: number) => boolean | void;
  onCaptureDone?: () => void; workletUrl: string; language?: string; startSeconds?: number; retryDelays?: number[];
};
import { encodeWav } from '../audio/encodeWav.js';
import { transcribeAudio } from './transcribeAudio.js';

// Failed transcription retries by itself: wait 1s, then 2s, 4s... (then every 30s) until it works.
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000];

export class MicrophoneSession {
  retryDelays: number[]; failures: number;
  onTranscript: (segments: TranscriptionSegment[], endSeconds: number) => void;
  onStatus: (status: MicrophoneStatus) => void;
  onError: (message: string | null) => void;
  onAudioChunk?: (samples: Float32Array, rate: number, start: number) => boolean | void;
  onCaptureDone?: () => void;
  workletUrl: string;
  language: string; startSeconds: number; id: string; controller: AbortController;
  queue: AudioQueueItem[]; cancelled: boolean; stopping: boolean; captureDone: boolean;
  processing: boolean; failed: boolean;
  context?: AudioContext; stream?: MediaStream; source?: MediaStreamAudioSourceNode; node?: AudioWorkletNode;
  retryTimer?: ReturnType<typeof setTimeout>; stopTimer?: ReturnType<typeof setTimeout>;
  constructor({ onTranscript, onStatus, onError, onAudioChunk, onCaptureDone, workletUrl, language = 'auto', startSeconds = 0, retryDelays = RETRY_DELAYS_MS }: MicrophoneSessionOptions) {
    this.retryDelays = retryDelays;
    this.failures = 0;   // failures in a row (resets after a chunk works)
    this.onTranscript = onTranscript;
    this.onStatus = onStatus;
    this.onError = onError;
    this.onAudioChunk = onAudioChunk;
    this.onCaptureDone = onCaptureDone;
    this.workletUrl = workletUrl;
    this.language = language;
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
      await this.context.audioWorklet.addModule(this.workletUrl);
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
        if (!this.cancelled && !this.stopping && this.context?.state !== 'running') {
          this.onError('Audio capture was interrupted. Processing the audio already captured.');
          this.stop();
        }
      };
      this.onStatus('recording');
    } catch (cause) {
      if (this.cancelled) return;
      this.release();
      this.onError((cause instanceof Error ? cause.message : String(cause)) || 'Could not access the microphone.');
      this.onStatus('idle');
    }
  }

  receive(data: WorkletMessage) {
    if (this.cancelled || this.captureDone) return;
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
        language: this.language,
      });
      if (this.onAudioChunk?.(data.samples, data.sampleRate, startSeconds) === false) this.stop();
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
        this.failures = 0;
        this.onTranscript(transcript, chunk.endSeconds);
      }
    } catch (cause) {
      if (!this.cancelled) {
        // Keep the audio and keep recording; try the same chunk again by itself after a pause.
        this.failed = true;
        const delay = this.retryDelays[Math.min(this.failures, this.retryDelays.length - 1)];
        this.failures += 1;
        this.onError(`${cause instanceof Error ? cause.message : String(cause)} Audio is retained; retrying automatically in ${Math.round(delay / 1000)}s.`);
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => this.retry(), delay);
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
    // A suspended or failed worklet may never acknowledge the final flush.
    this.stopTimer = setTimeout(() => {
      if (this.cancelled || this.captureDone) return;
      this.captureDone = true;
      this.release();
      this.onError('The final audio chunk could not be recovered. Earlier audio is retained and still being transcribed.');
      void this.drain();
    }, 5000);
    this.node.port.postMessage('stop');
    this.stream?.getTracks().forEach(track => track.stop());
  }

  // Runs by itself after a failure (see RETRY_DELAYS_MS); calling it directly retries right away.
  retry() {
    clearTimeout(this.retryTimer);
    if (!this.failed || this.cancelled) return;
    this.failed = false;
    this.onError(null);
    void this.drain();
  }

  release() {
    clearTimeout(this.stopTimer);
    if (this.context) this.context.onstatechange = null;
    this.stream?.getTracks().forEach(track => track.stop());
    this.source?.disconnect();
    this.node?.disconnect();
    this.node?.port.close();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    if (this.captureDone && !this.cancelled) this.onCaptureDone?.();
  }

  cancel() {
    this.cancelled = true;
    clearTimeout(this.retryTimer);
    this.controller.abort();
    this.queue = [];
    this.release();
  }
}
