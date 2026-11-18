import { encodeWav } from './encodeWav.js';

export const ARCHIVE_RATE = 16000;
export const MAX_RECORDING_BYTES = 64 * 1024 * 1024;
const BYTES_PER_SECOND = ARCHIVE_RATE * 2;

// PCM blobs can be composed without decoding/copying all earlier recording chunks.
export class RecordingArchive {
  constructor(maxBytes = MAX_RECORDING_BYTES) {
    this.maxBytes = maxBytes;
    this.parts = [];
    this.frames = 0;
  }
  get duration() { return this.frames / ARCHIVE_RATE; }
  get full() { return this.frames * 2 >= this.maxBytes - BYTES_PER_SECOND * 10; }
  append(samples, sampleRate, startSeconds) {
    if (!Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Invalid recording timing.');
    const start = Math.round(startSeconds * ARCHIVE_RATE);
    const length = Math.round(samples.length * ARCHIVE_RATE / sampleRate);
    // Tolerate sub-sample rounding only; replayed/overlapping chunks must never duplicate audio.
    if (start < this.frames - 1) throw new Error('Recording audio overlaps an earlier chunk.');
    const gap = Math.max(0, start - this.frames);
    if ((this.frames + gap + length) * 2 > this.maxBytes) throw new Error('Recording storage is full. Download the recording and reset before recording more.');
    if (gap) this.parts.push(new Blob([new Uint8Array(gap * 2)]));
    const normalized = new Float32Array(length);
    for (let index = 0; index < length; index++) {
      const position = index * sampleRate / ARCHIVE_RATE;
      const left = Math.floor(position);
      const fraction = position - left;
      normalized[index] = (samples[left] || 0) * (1 - fraction) + (samples[Math.min(left + 1, samples.length - 1)] || 0) * fraction;
    }
    this.parts.push(encodeWav(normalized, ARCHIVE_RATE).slice(44));
    this.frames += gap + length;
  }
  toBlob() {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) {
      for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    }
    view.setUint32(4, 36 + this.frames * 2, true);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, ARCHIVE_RATE, true);
    view.setUint32(28, BYTES_PER_SECOND, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(40, this.frames * 2, true);
    return new Blob([header, ...this.parts], { type: 'audio/wav' });
  }
}
