import React, { useEffect, useRef } from 'react';

// Live transcript in the side panel. Scrolls on its own and follows the newest line,
// unless you've scrolled up to reread something (then it leaves you where you are).
export default function TranscriptPanel({ segments = [], isRecording = false }) {
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
          <p className="transcript-empty">Nothing said yet. Start recording, send a sample batch, or type test text below.</p>
        ) : (
          segments.map((segment, index) => (
            <p key={index} className="transcript-line">
              <span className="transcript-time">{Number(segment.time).toFixed(1)}s</span>{' '}
              {segment.speaker && <strong className="transcript-speaker">{segment.speaker}: </strong>}
              {segment.text}
            </p>
          ))
        )}
      </div>
    </section>
  );
}
