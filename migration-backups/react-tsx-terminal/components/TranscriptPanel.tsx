import React, { useEffect, useRef } from 'react';
import { formatTime } from '../shared/formatTime.js';

// Live transcript in the side panel. Scrolls on its own and follows the newest line,
// unless you've scrolled up to reread something (then it leaves you where you are).
export default function TranscriptPanel({ segments = [], isRecording = false, onSeek, translations = [], translationLanguage }) {
  const scroller = useRef(null);
  const stickToBottom = useRef(true);

  function handleScroll() {
    const el = scroller.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [segments.length]);

  return (
    // Labelled "Transcript" only once something has been said (an empty panel isn't a transcript yet).
    <section className="transcript-panel" aria-label={segments.length ? 'Transcript' : 'Transcript (empty)'}>
      <header className="transcript-head">
        <h3>Transcript</h3>
        <span className="transcript-count">
          {isRecording && <span className="transcript-live" aria-hidden="true" />}
          {segments.length} line{segments.length === 1 ? '' : 's'}
        </span>
      </header>
      <div className="transcript-scroll" ref={scroller} onScroll={handleScroll} tabIndex={0}>
        {segments.length === 0 ? (
          <p className="transcript-empty">Nothing said yet. Press Start Recording to begin.</p>
        ) : (
          segments.map((segment, index) => (
            <p key={index} className="transcript-line">
              {onSeek ? <button type="button" className="transcript-time" aria-label={`Play recording at ${formatTime(segment.time)}`} onClick={() => onSeek(segment.time)}>{formatTime(segment.time)}</button>
                : <span className="transcript-time">{formatTime(segment.time)}</span>}{' '}
              {segment.speaker && <strong className="transcript-speaker">{segment.speaker}: </strong>}
              {segment.text}
              {translations[index] && <span className="transcript-translation" lang={translationLanguage} style={{ display: 'block' }}>Translation: {translations[index]}</span>}
            </p>
          ))
        )}
      </div>
    </section>
  );
}
