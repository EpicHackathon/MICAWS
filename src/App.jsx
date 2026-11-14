import { useMicrophone } from './hooks/useMicrophone.js';
import React, { useState, useRef } from 'react';
import { useMeetingProcessor } from './hooks/useMeetingProcessor.js';
import MeetingView from './components/MeetingView.jsx';
import ManualInput from './components/ManualInput.jsx';
import { demoBatches } from './shared/demo.js';

/**
 * MeetingResults component displays the derived state (Nodes, Edges, Actions) 
 * and controls for processing segments. It is now purely a display layer.
 */
export function MeetingResults({ segments, isRecording, clearTranscript, onManualSegment, retryTranscription, captureBusy, children }) {
  // The hook handles state updates based on incoming segments
  const [viewVersion, setViewVersion] = useState(0);
  const processor = useMeetingProcessor(segments, isRecording);
  const { state, error, isProcessing, processPending, reset } = processor;

  function resetMeeting() {
    if (clearTranscript() !== false) {
      reset();
      setViewVersion(current => current + 1);
    }
  }

  return (
    <>
      {children?.({ isProcessing }) || null}
      <div style={{ marginTop: '10px' }}>
        <button onClick={() => { retryTranscription?.(); void processPending(); }} disabled={isProcessing}>Process pending / retry</button>
        <button onClick={resetMeeting}>Reset session</button>
      </div>

      {error && <p role="alert" style={{ color: 'red', border: '1px solid red', padding: '10px' }}>Error: {error}</p>}
      
      <MeetingView key={'view-' + viewVersion} state={state} />
      <ManualInput key={'input-' + viewVersion} disabled={captureBusy || isRecording || isProcessing || !onManualSegment} onSubmit={onManualSegment} />
    </>
  );
}

/**
 * Main App component handles the recording controls and pipes data into MeetingResults.
 */
export default function App() {
  // State for the live streaming session
  const [segments, setSegments] = useState([]);
  const [sampleBatch, setSampleBatch] = useState(0);
  const nextStart = useRef(0);
  const microphone = useMicrophone((transcript, endSeconds) => {
    nextStart.current = Math.max(nextStart.current, endSeconds);
    setSegments(current => [...current, ...transcript.map(segment => ({
      time: segment.start,
      speaker: segment.speaker,
      text: segment.text,
    }))]);
  });
  const isRecording = microphone.status === 'recording';
  const busy = microphone.status !== 'idle';
  const startRecording = () => microphone.start(Math.max(nextStart.current, segments.at(-1)?.time ?? 0));
  const stopRecording = microphone.stop;

  function clearSession() {
    if (!window.confirm('Are you sure you want to reset the entire meeting transcript?')) return false;
    microphone.reset();
    nextStart.current = 0;
    setSegments([]);
    setSampleBatch(0);
    return true;
  }

  return (
    <main className="app-container">
      <h1 className="text-3xl font-bold" style={{ color: isRecording ? 'red' : '#333' }}>Meeting Processor Dashboard</h1>
      <p>Status: {isRecording ? '🔴 LIVE RECORDING IN PROGRESS...' : '🟢 Ready. Click Start to begin session capture.'}</p>
      
      {/* CONTROL PANEL */}
      <div className="control-panel">
        <button 
          onClick={startRecording} 
          disabled={busy}
          style={{ padding: '10px 20px', fontSize: '1em', backgroundColor: isRecording ? '#ccc' : 'green', color: 'white', cursor: 'pointer' }}
        >
          🎤 Start Recording
        </button>
        <button 
          onClick={stopRecording} 
          disabled={!isRecording}
          style={{ padding: '10px 20px', fontSize: '1em', backgroundColor: '#ffc107', color: 'black', cursor: 'pointer' }}
        >
          🛑 Stop & Process Stream
        </button>
         
      </div>

      {microphone.status === 'starting' && <p role="status">Waiting for microphone permission…</p>}
      {microphone.status === 'transcribing' && <p role="status">Finishing pending transcription…</p>}
      {microphone.error && <p role="alert">{microphone.error}</p>}
      {segments.length > 0 && (
        <section aria-label="Transcript">
          <h2>Transcript</h2>
          {segments.map((segment, index) => (
            <p key={index}><strong>{segment.time.toFixed(1)}s</strong> {segment.speaker && `${segment.speaker}: `}{segment.text}</p>
          ))}
        </section>
      )}

      {/* The results component now consumes the recording state */}
      <MeetingResults 
        segments={segments} 
        isRecording={isRecording} 
        clearTranscript={clearSession}
        retryTranscription={microphone.retry}
        captureBusy={busy}
        onManualSegment={segment => setSegments(current => [...current, segment])}
      >
        {({ isProcessing }) => (
          <>
            <button
              disabled={busy || isProcessing || sampleBatch >= demoBatches.length}
              onClick={() => {
                setSegments(current => [...current, ...demoBatches[sampleBatch]]);
                setSampleBatch(current => current + 1);
              }}
            >
              {sampleBatch < demoBatches.length ? `Send sample batch ${sampleBatch + 1}` : 'All sample batches sent'}
            </button>
            <p style={{ color: isProcessing ? 'blue' : 'gray', fontWeight: 'bold' }}>
                {isProcessing ? "🧠 AI processing current segments..." : `Awaiting input. Segments captured: ${segments.length}`}
            </p>
          </>
        )}
      </MeetingResults>

    </main>
  );
}