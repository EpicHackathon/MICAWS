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
  segments = [], isRecording = false,
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

  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [showMap, setShowMap] = useState(true);
  // Dev helper: show the sample hackathon meeting instead of the live one.
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
  const selected = nodes.find(node => node.id === selectedNodeId);
  const parent = selected && nodes.find(node => node.id === selected.parentId);
  const children = selected ? nodes.filter(node => node.parentId === selected.id) : [];

  return (
    <section aria-label="Meeting results">
      <h2>Topics ({nodes.length})</h2>
      <button type="button" onClick={() => setShowMap(current => !current)}
        aria-controls="topic-view">
        {showMap ? 'Show topic list' : 'Show mind map'}
      </button>{' '}
      <button type="button" onClick={() => { onEditingChange?.(false); setShowSample(current => !current); setSelectedNodeId(null); }}>
        {showSample ? 'Back to live meeting' : 'Load sample meeting'}
      </button>
      <div className="meeting-layout" ref={layoutRef}>
        <div className="meeting-map-area">
            {!nodes.length ? <p>No topics yet. Send a sample batch or enter test text below.</p> : (
                showMap ? (
                    <div className="mindmap-frame">
                        <MindMap nodes={nodes} edges={edges} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} live={!showSample} onEdit={onEdit}
                          onEditingChange={showSample ? undefined : onEditingChange}
                          pendingCount={showSample ? 0 : pendingCount} />
                    </div>
                ) : (
                    <ul className="topic-list">
                        {nodes.map(node => (
                            <li key={node.id}>
                                <button type="button" onClick={() => setSelectedNodeId(node.id)} aria-pressed={selectedNodeId === node.id}>
                                    {node.label} ({node.importance}/5)
                                </button>
                            </li>
                        ))}
                    </ul>
                )
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
      {selected && (
        <section aria-label="Node details" aria-live="polite" className="node-details-panel">
          <button type="button" onClick={() => setSelectedNodeId(null)}>Close node details</button>
          <h3>{selected.label}</h3>
          <p>Importance {selected.importance}/5</p>
          <p>{selected.summary}</p>
          <p>Parent {parent ? (
            <button type="button" onClick={() => setSelectedNodeId(parent.id)}>{parent.label}</button>
          ) : '— main idea'}</p>
          <h4>Direct children</h4>
          {children.length ? <ul>{children.map(child => (
            <li key={child.id}><button type="button" onClick={() => setSelectedNodeId(child.id)}>
              {child.label}
            </button></li>
          ))}</ul> : <p>No direct children.</p>}
          <p>Tasks are recorded for the whole meeting. The current data format does not link tasks to individual topics.</p>
        </section>
      )}
      <h2>Meeting action items ({actionItems.length})</h2>
      {actionItems.length ? <ul>{actionItems.map(item => <li key={item.id}>{item.text}</li>)}</ul>
        : <p>No action items yet.</p>}
      <details>
        <summary>Connections ({edges.length})</summary>
        <ul>{edges.map(edge => (
          <li key={edge.id}>{nodes.find(node => node.id === edge.source)?.label} → {nodes.find(node => node.id === edge.target)?.label}</li>
        ))}</ul>
      </details>
      <details><summary>Meeting state JSON</summary>
        <pre style={{ overflowX: 'auto' }}>{JSON.stringify(state, null, 2)}</pre>
      </details>
    </section>
  );
}
