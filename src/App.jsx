import React, { useState } from 'react';
import { useMeetingProcessor } from './hooks/useMeetingProcessor.js';
import MindMap from './components/MindMap.jsx';

/**
 * MeetingResults component displays the derived state (Nodes, Edges, Actions) 
 * and controls for processing segments. It is now purely a display layer.
 */
export function MeetingResults({ segments, isRecording, clearTranscript, children }) {
  // The hook handles state updates based on incoming segments
  const processor = useMeetingProcessor(segments, isRecording);
  const { state: { nodes, edges, actionItems }, error, isProcessing, processPending, reset } = processor;

  function resetMeeting() {
    reset();
    clearTranscript();
  }

  return (
    <>
      {children?.({ isProcessing })}
      <div style={{ marginTop: '10px' }}>
        <button onClick={processPending} disabled={isProcessing}>Process pending / retry</button>
        <button onClick={resetMeeting}>Reset session</button>
      </div >

      {error && <p role="alert" style={{ color: 'red', border: '1px solid red', padding: '10px' }}>Error: {error}</p>}
      
      <h2 style={{marginTop: '30px'}}>Topics ({nodes.length})</h2>
      <ul style={{listStyleType: 'none', padding: 0}}>
        {nodes.map(node => <li key={node.id} style={{marginBottom: '5px'}}><strong style={{fontSize: '1.1em'}}>{node.label}</strong> ({node.importance}/5) — {node.summary}</li>)}
      </ul>

      <h2 style={{marginTop: '30px'}}>Mind Map</h2>
      {/* MindMap component visualization */}
      <div style={{height: '400px', border: '1px solid #eee' }}>
        <MindMap nodes={nodes} edges={edges} />
      </div>

      <h2 style={{marginTop: '30px'}}>Connections ({edges.length})</h2>
      <ul style={{listStyleType: 'none', padding: 0}}>
        {edges.map(edge => <li key={edge.id}>🔗 {nodes.find(node => node.id === edge.source)?.label || '(Unknown)'} → {nodes.find(node => node.id === edge.target)?.label || '(Unknown)'}</li>)}
      </ul>

      <h2 style={{marginTop: '30px'}}>Action items ({actionItems.length})</h2>
      <ul style={{listStyleType: 'disc', paddingLeft: '20px'}}>
        {actionItems.map(item => <li key={item.id}>{item.text}</li>)}
      </ul>
      <details style={{marginTop: '40px'}}><summary>Meeting state JSON</summary><pre>{JSON.stringify(processor.state, null, 2)}</pre></details>
    </>
  );
}

/**
 * Main App component handles the recording controls and pipes data into MeetingResults.
 */
export default function App() {
  // State for the live streaming session
  const [segments, setSegments] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState(null);

  // --- CORE CONTROL HANDLERS (Mocked) ---
  const startRecording = () => {
    if (isRecording) return;
    console.log("🎤 Microphone recording started.");
    setIsRecording(true);
    setError(null);
    setSegments([]); 
    // *** FUTURE: Initialize Web Audio API and Whisper stream connection here ***
  };

  const stopRecording = () => {
    if (!isRecording) return;
    console.log("🛑 Microphone recording stopped.");
    setIsRecording(false);
    // Trigger final processing on stop, simulating the end of a session chunk
    setSegments(prev => [...prev, { time: Date.now() / 1000, speaker: 'SYSTEM', text: 'Meeting segment finalized.' }]);
  };

  /**
   * This function simulates receiving diarized, finalized segments from the Whisper pipeline/stream handler.
   */
  const processLiveSegment = (segment) => {
    // CRITICAL STEP: Data validation and structure enforcement happens here before setting state.
    if (!segment || !segment.text) return;

    setSegments(current => [...current, segment]);
    console.log("✅ Segment received:", segment);
  };

  /**
   * Placeholder function to simulate a burst of data from the stream (for testing purposes).
   */
  const simulateSegment = () => {
      if (!isRecording) return;
      // Simulate diarization output: Speaker 'Alex' spoke for 2 seconds.
      processLiveSegment({ time: Math.random() * 10, speaker: ['Alice', 'Bob', 'Charlie'][Math.floor(Math.random() * 3)], text: `Simulated speech chunk at ${Date.now()} focusing on the next steps.` });
  }

  /**
   * Clears state and resets the session.
   */
  const clearSession = () => {
    if (window.confirm("Are you sure you want to reset the entire meeting transcript?")) {
        setSegments([]);
        setIsRecording(false);
        setError(null);
    }
  }

  return (
    <main style={{ maxWidth: '800px', margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui' }}>
      <h1 style={{ color: isRecording ? 'red' : '#333' }}>Meeting Processor Dashboard</h1>
      <p>Status: {isRecording ? '🔴 LIVE RECORDING IN PROGRESS...' : '🟢 Ready. Click Start to begin session capture.'}</p>
      
      {/* CONTROL PANEL */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '15px', alignItems: 'center' }}>
        <button 
          onClick={startRecording} 
          disabled={isRecording}
          style={{ padding: '10px 20px', fontSize: '1em', backgroundColor: isRecording ? '#ccc' : 'green', color: 'white', cursor: 'pointer' }}
        >
          🎤 Start Recording (Mock)
        </button>
        <button 
          onClick={stopRecording} 
          disabled={!isRecording}
          style={{ padding: '10px 20px', fontSize: '1em', backgroundColor: '#ffc107', color: 'black', cursor: 'pointer' }}
        >
          🛑 Stop & Process Stream
        </button>
         <button onClick={clearSession} style={{padding: '10px 20px'}}>Reset Session</button>
      </div>

      {/* The results component now consumes the recording state */}
      <MeetingResults 
        segments={segments} 
        isRecording={isRecording} 
        clearTranscript={clearSession}
      >
        {({ isProcessing }) => (
          <>
            <p style={{ color: isProcessing ? 'blue' : 'gray', fontWeight: 'bold' }}>
                {isProcessing ? "🧠 AI processing current segments..." : `Awaiting input. Segments captured: ${segments.length}`}
            </p>
          </>
        )}
      </MeetingResults>

      {/* DEBUGGING/MOCK INPUT FOR TESTING */}
      <div style={{marginTop: '40px', borderTop: '1px dashed #ccc', paddingTop: '20px'}}>
        <h3>[Dev Tools] Mock Input (For testing diarization flow)</h3>
        <p>Click this button repeatedly to simulate incoming, diarized audio chunks.</p>
         <button onClick={simulateSegment} disabled={!isRecording}>Simulate Segment Chunk</button>
      </div>

    </main>
  );
}