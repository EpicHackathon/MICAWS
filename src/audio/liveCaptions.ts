import type { TranscriptionSegment, WordSpan } from '../services/transcribeAudio.js';

export const CAPTION_OVERLAP_SECONDS = 3;
const STABILITY_SECONDS = 1.5;
type CaptionWord = WordSpan & { aligned: boolean };

const midpoint = (word: WordSpan) => (word.start + word.end) / 2;
const token = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, '');
const compact = (text: string) => text.replace(/\s+/gu, '');

function captionWords(segment: TranscriptionSegment): CaptionWord[] {
  if (segment.words?.length && compact(segment.words.map(word => word.text).join('')) === compact(segment.text)) {
    return segment.words.map(word => ({ ...word, aligned: true }));
  }
  const words = segment.text.trim().split(/\s+/u).filter(Boolean);
  const step = (segment.end - segment.start) / words.length;
  return words.map((text, i) => ({
    text, start: segment.start + step * i, end: segment.start + step * (i + 1), aligned: false,
  }));
}

export class LiveCaptions {
  private committedThrough = -Infinity;
  private recent: CaptionWord[] = [];
  private draft: CaptionWord[] = [];

  update(segments: TranscriptionSegment[], endSeconds: number) {
    const words = segments.flatMap(captionWords)
      .filter(word => midpoint(word) <= endSeconds)
      .sort((a, b) => midpoint(a) - midpoint(b));
    // Match only a narrow band around the boundary so deliberate repeated words
    // farther along the recording are retained.
    if (words.length) this.draft = words.filter(word => midpoint(word) > this.committedThrough
      && !this.recent.some(previous => token(previous.text) === token(word.text)
        && Math.abs(midpoint(previous) - midpoint(word)) <= 0.25
        && previous.start < word.end && word.start < previous.end));
    return this.commit(endSeconds - STABILITY_SECONDS);
  }

  finish() {
    return this.commit(Infinity).final;
  }

  private commit(through: number) {
    const finalized = this.draft.filter(word => midpoint(word) <= through);
    this.draft = this.draft.filter(word => midpoint(word) > through);
    this.committedThrough = Math.max(this.committedThrough, through);
    this.recent = [...this.recent, ...finalized].filter(word => midpoint(word) >= through - 0.5);
    const final: TranscriptionSegment[] = finalized.length ? [{
      start: finalized[0].start,
      end: Math.max(...finalized.map(word => word.end)),
      speaker: null,
      text: finalized.map(word => word.text).join(' '),
      words: finalized.filter(word => word.aligned).map(({ start, end, text }) => ({ start, end, text })),
    }] : [];
    return { final, draft: this.draft.map(word => word.text).join(' ') };
  }
}
