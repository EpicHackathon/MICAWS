import React, { useState } from 'react';
import { useMeetingProcessor } from './hooks/useMeetingProcessor.js';
import { demoBatches } from './shared/demo.js';
import MindMap from './components/MindMap.jsx';
export function MeetingResults({ segments, isRecording, clearTranscript, children }) {
  const processor = useMeetingProcessor(segments, isRecording);
  const { state: { nodes, edges, actionItems }, error, isProcessing, processPending, reset } = processor;
  function resetMeeting() {
    reset();
    clearTranscript();
  }
  return (
    <>
      {children?.({ isProcessing })}
      <button onClick={processPending} disabled={isProcessing}>Process pending / retry</button>{' '}
      <button onClick={resetMeeting}>Reset meeting</button>
      {isProcessing && <p role="status">Processing transcript…</p>}
      {error && <p role="alert">{error}</p>}
      <h2>Topics</h2>
      <ul>{nodes.map(node => <li key={node.id}><strong>{node.label}</strong> ({node.importance}/5) — {node.summary}</li>)}</ul>
      <h2>Mind map</h2>
      <MindMap nodes={nodes} edges={edges} />
      <h2>Connections</h2>
      <ul>{edges.map(edge => <li key={edge.id}>{nodes.find(node => node.id === edge.source)?.label} → {nodes.find(node => node.id === edge.target)?.label}</li>)}</ul>
      <h2>Action items</h2>
      <ul>{actionItems.map(item => <li key={item.id}>{item.text}</li>)}</ul>
      <details><summary>Meeting state JSON</summary><pre>{JSON.stringify(processor.state, null, 2)}</pre></details>
    </>
  );
}

export default function App() {
  const [segments, setSegments] = useState([]);
  const [batch, setBatch] = useState(0);
  function addBatch() {
    setSegments(current => [...current, ...demoBatches[batch]]);
    setBatch(batch + 1);
  }
  function clearTranscript() {
    setSegments([]);
    setBatch(0);
  }
  return (
    <main style={{ maxWidth: '48rem', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui' }}>
      <h1>Meeting processor demo</h1>
      <p>Send three sample transcript batches. Each batch updates the same meeting state.</p>
      <MeetingResults segments={segments} isRecording={false} clearTranscript={clearTranscript}>
        {({ isProcessing }) => (
          <><button disabled={isProcessing || batch >= demoBatches.length} onClick={addBatch}>
            {batch < demoBatches.length ? `Send sample batch ${batch + 1}` : 'All sample batches sent'}
          </button>{' '}</>
        )}
      </MeetingResults>
    </main>
  );
}

