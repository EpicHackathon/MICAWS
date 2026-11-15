import React, { useRef, useState } from 'react';
import MindMap from './MindMap.jsx';
import TranscriptPanel from './TranscriptPanel.jsx';
import { mockMeeting } from '../shared/mockMeeting.js';
import './meetingLayout.css';

const MIN_TRANSCRIPT = 220;
const MAX_TRANSCRIPT = 640;
const readSavedWidth = () => {
  try { return Number(localStorage.getItem('micaws.transcriptWidth')) || 320; } catch { return 320; }
};

export default function MeetingView({
  state: liveState, onEdit: onLiveEdit, onEditingChange, pendingCount = 0,
  segments = [], isRecording = false, devMode = false, summary = { status: 'idle' },
}) {
  // Transcript side panel: width (drag the handle) and hide/show.
  const layoutRef = useRef(null);
  const [transcriptWidth, setTranscriptWidth] = useState(readSavedWidth);
  const [transcriptHidden, setTranscriptHidden] = useState(false);
  const [resizing, setResizing] = useState(false);
  function changeWidth(width) {
    const layoutWidth = layoutRef.current?.getBoundingClientRect().width || 1200;
    // never let the transcript take more than half the row: the map keeps most of the space
    const clamped = Math.round(Math.min(Math.max(width, MIN_TRANSCRIPT), MAX_TRANSCRIPT, layoutWidth / 2));
    setTranscriptWidth(clamped);
    try { localStorage.setItem('micaws.transcriptWidth', String(clamped)); } catch { /* storage off: fine */ }
  }
  function startResize(event) {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture?.(event.pointerId);
    setResizing(true);
    const right = layoutRef.current.getBoundingClientRect().right;
    const move = moveEvent => changeWidth(right - moveEvent.clientX - 7);
    const stop = () => {
      setResizing(false);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  // Dev helper (only with ?dev in the web address): show the sample hackathon meeting instead of the live one.
  const [showSample, setShowSample] = useState(false);
  // The sample gets its own editable copy so people can practice moving/editing.
  const [sampleState, setSampleState] = useState(mockMeeting);
  const state = showSample ? sampleState : liveState;
  // Hand edits from the map: the sample edits its copy; the live meeting goes through
  // the meeting processor so the AI keeps the edits on its next update.
  const onEdit = showSample
    ? edit => setSampleState(edit(sampleState))   // run now so a refused edit throws to the map
    : onLiveEdit;
  const { nodes = [], edges = [], actionItems = [] } = state || {};

  return (
    // data-topic-count: lets the tests see how many topics there are (no visible heading anymore)
    <section aria-label="Meeting results" data-topic-count={nodes.length}>
      {devMode && (
        <button type="button" onClick={() => { onEditingChange?.(false); setShowSample(current => !current); }}>
          {showSample ? 'Back to live meeting' : 'Load sample meeting'}
        </button>
      )}
      <div className="meeting-layout" ref={layoutRef}>
        <div className="meeting-map-area">
            {!nodes.length ? (
                // empty map box (same size as the map) with the message centered inside
                <div className="mindmap-frame mindmap-empty">
                    <p>No topics yet. Press Start Recording and the mind map will grow as people talk.</p>
                </div>
            ) : (
                <div className="mindmap-frame">
                    <MindMap nodes={nodes} edges={edges} live={!showSample} onEdit={onEdit}
                      onEditingChange={showSample ? undefined : onEditingChange}
                      pendingCount={showSample ? 0 : pendingCount} />
                </div>
            )}
        </div>
        {!transcriptHidden && (
          <div
            className={'transcript-resizer' + (resizing ? ' dragging' : '')}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize transcript"
            aria-valuemin={MIN_TRANSCRIPT}
            aria-valuemax={MAX_TRANSCRIPT}
            aria-valuenow={transcriptWidth}
            tabIndex={0}
            onPointerDown={startResize}
            onKeyDown={event => {
              if (event.key === 'ArrowLeft') { event.preventDefault(); changeWidth(transcriptWidth + 20); }
              if (event.key === 'ArrowRight') { event.preventDefault(); changeWidth(transcriptWidth - 20); }
            }}
          />
        )}
        <aside
          className={'transcript-side' + (transcriptHidden ? ' collapsed' : '')}
          style={{ width: transcriptHidden ? undefined : transcriptWidth }}
        >
          <button type="button" className="transcript-toggle" onClick={() => setTranscriptHidden(current => !current)}>
            {transcriptHidden ? 'Show transcript' : 'Hide transcript'}
          </button>
          {!transcriptHidden && <TranscriptPanel segments={segments} isRecording={isRecording} />}
        </aside>
      </div>
      {/* End-of-meeting summary (appears after you stop recording, when the map has caught up) */}
      {!showSample && summary.status !== 'idle' && (
        <section aria-label="Meeting summary" className="meeting-summary" aria-live="polite">
          <h2>Meeting summary</h2>
          {summary.status === 'loading' && !summary.data && <p className="summary-status">Writing the summary…</p>}
          {summary.status === 'loading' && summary.data && <p className="summary-status">Updating the summary…</p>}
          {summary.status === 'error' && (
            <p className="summary-status">The summary couldn't be written ({summary.error}). It will try again the next time you stop recording.</p>
          )}
          {summary.data && (
            <>
              <p className="summary-overview">{summary.data.overview}</p>
              {summary.data.keyPoints.length > 0 && (
                <ul className="summary-points">{summary.data.keyPoints.map((point, index) => <li key={index}>{point}</li>)}</ul>
              )}
              {summary.data.nextTime?.length > 0 && (
                <>
                  <h3 className="summary-next-title">For next time</h3>
                  <ul className="summary-points summary-next">{summary.data.nextTime.map((point, index) => <li key={index}>{point}</li>)}</ul>
                </>
              )}
            </>
          )}
        </section>
      )}
      <h2>Meeting action items ({actionItems.length})</h2>
      {actionItems.length ? <ul className="action-items">{actionItems.map(item => <li key={item.id}>{item.text}</li>)}</ul>
        : <p>No action items yet.</p>}
      <details>
        <summary>Connections ({edges.length})</summary>
        <ul>{edges.map(edge => (
          <li key={edge.id}>{nodes.find(node => node.id === edge.source)?.label} → {nodes.find(node => node.id === edge.target)?.label}</li>
        ))}</ul>
      </details>
    </section>
  );
}
