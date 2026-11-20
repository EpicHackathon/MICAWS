import React, { useEffect, useMemo, useRef } from 'react';
import type { TranscriptSegment } from './meetingTypes';
import { formatTime } from '../shared/formatTime.js';

// Live transcript in the side panel. Scrolls on its own and follows the newest line,
// unless you've scrolled up to reread something (then it leaves you where you are).
type Props = {
  segments?: TranscriptSegment[];
  draftCaption?: string;
  groupTranscript?: boolean;
  alignedWordCount?: number;
  isRecording?: boolean;
  onSeek?: (seconds: number) => void;
  translations?: string[];
  translationLanguage?: string;
};

const sentenceEnd = /[.!?。！？…]["'’”»」』）)]*$/u;

function transcriptRows(segments: TranscriptSegment[], translations: string[], grouped: boolean) {
  type Row = TranscriptSegment & { translation?: string };
  const rows: Row[] = [];
  for (const [index, segment] of segments.entries()) {
    const row = rows.at(-1);
    const previous = segments[index - 1];
    const translation = translations[index];
    if (grouped && row && row.speaker === segment.speaker
        && segment.time >= previous.time && segment.time - previous.time <= 3
        && segment.time - row.time < 10 && !sentenceEnd.test(row.text.trimEnd())) {
      row.text += ' ' + segment.text;
      if (translation) row.translation = row.translation ? row.translation + ' ' + translation : translation;
    } else {
      rows.push({ ...segment, translation });
    }
  }
  return rows;
}

export default function TranscriptPanel({ segments = [], draftCaption, groupTranscript = false, alignedWordCount = 0, isRecording = false, onSeek, translations = [], translationLanguage }: Props) {
  const rows = useMemo(() => transcriptRows(segments, translations, groupTranscript), [segments, translations, groupTranscript]);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  function handleScroll() {
    const el = scroller.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [rows, draftCaption]);

  return (
    // Labelled "Transcript" only once something has been said (an empty panel isn't a transcript yet).
    <section className="transcript-panel" aria-label={segments.length || draftCaption ? 'Transcript' : 'Transcript (empty)'}>
      <header className="transcript-head">
        <h3>Transcript</h3>
        <span className="transcript-count">
          {isRecording && <span className="transcript-live" aria-hidden="true" />}
          {rows.length} line{rows.length === 1 ? '' : 's'}
          {alignedWordCount > 0 && ` · ${alignedWordCount} aligned words`}
        </span>
      </header>
      <div className="transcript-scroll" ref={scroller} onScroll={handleScroll} tabIndex={0}>
        {segments.length === 0 && !draftCaption ? (
          <p className="transcript-empty">Nothing said yet. Press Start Recording to begin.</p>
        ) : (
          rows.map((segment, index) => (
            <p key={index} className="transcript-line">
              {onSeek ? <button type="button" className="transcript-time" aria-label={`Play recording at ${formatTime(segment.time)}`} onClick={() => onSeek(segment.time)}>{formatTime(segment.time)}</button>
                : <span className="transcript-time">{formatTime(segment.time)}</span>}{' '}
              {segment.speaker && <strong className="transcript-speaker">{segment.speaker}: </strong>}
              {segment.text}
              {segment.translation && <span className="transcript-translation" lang={translationLanguage} style={{ display: 'block' }}>Translation: {segment.translation}</span>}
            </p>
          ))
        )}
        {draftCaption && <p className="transcript-line transcript-draft"><strong>Draft:</strong> {draftCaption}</p>}
      </div>
    </section>
  );
}
