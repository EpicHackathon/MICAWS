import React, { useState } from 'react';
import MindMap from './MindMap.jsx';
import { mockMeeting } from '../shared/mockMeeting.js';

export default function MeetingView({ state: liveState }) {
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [showMap, setShowMap] = useState(true);
  // Dev helper: show the sample hackathon meeting instead of the live one.
  const [showSample, setShowSample] = useState(false);
  const state = showSample ? mockMeeting : liveState;
  const { nodes, edges, actionItems } = state;
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
      <button type="button" onClick={() => { setShowSample(current => !current); setSelectedNodeId(null); }}>
        {showSample ? 'Back to live meeting' : 'Load sample meeting'}
      </button>
      <div className="main-content-layout">
        <div className="main-content-area">
            {!nodes.length ? <p>No topics yet. Send a sample batch or enter test text below.</p> : (
                showMap ? (
                    <div className="mindmap-frame">
                        <MindMap nodes={nodes} edges={edges} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} />
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
        <aside className="transcript-sidebar">
             {/* Placeholder for Transcript/Live Output Stream */}
             <h3>Transcript Stream</h3>
             {/* This area will now be constrained by the sidebar layout and should contain the transcript component. */}
             <div className="live-transcript-box" style={{ minHeight: '100%' }}>
                <!-- Actual transcript rendering logic goes here -->
                <p>Live Transcript Feed...</p>
             </div>
        </aside>
    </div>
        {!nodes.length ? <p>No topics yet. Send a sample batch or enter test text below.</p> :
          showMap ? (
            <div className="mindmap-frame">
              <MindMap nodes={nodes} edges={edges} selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId} />
            </div>
          ) : (
            <ul>
              {nodes.map(node => (
                <li key={node.id}>
                  <button type="button" onClick={() => setSelectedNodeId(node.id)}
                    aria-pressed={selectedNodeId === node.id}>
                    {node.label} ({node.importance}/5)
                  </button>
                </li>
              ))}
            </ul>
          )}
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
