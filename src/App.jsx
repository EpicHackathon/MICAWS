import { useMicrophone } from './hooks/useMicrophone.js';
import React, { useState, useRef, useEffect } from 'react';
import { useMeetingProcessor } from './hooks/useMeetingProcessor.js';
import MeetingView from './components/MeetingView.jsx';
import MicIcon from './components/MicIcon.jsx';
import StopIcon from './components/StopIcon.jsx';
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
      <div className="control-actions">
        <button className="btn-ghost" onClick={() => { retryTranscription?.(); void processPending(); }} disabled={isProcessing}>
          Process pending / retry
        </button>
        <button className="btn-ghost" onClick={resetMeeting}>Reset session</button>
      </div>

      {error && <p role="alert" className="error-message">Error: {error}</p>}

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
  // Marena's color theme switcher (neutral / warm / cool), applied to <body>.
  const [theme, setTheme] = useState('neutral');
  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);
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
      <header className="app-header">
        <div className="app-title-row">
          <h1 className="app-title">Meeting Processor Dashboard</h1>
          {isRecording && (
            <span className="recording-badge">
              <span className="activity-indicator" aria-hidden="true"></span>
              Live recording
            </span>
          )}
        </div>
        <p className="app-status">
          Status: {{ idle: 'Ready to record.', starting: 'Waiting for microphone permission…', recording: 'Live recording in progress…', transcribing: 'Finishing pending transcription…' }[microphone.status]}
        </p>
        <div className="theme-switch" role="group" aria-label="Color theme">
          <button type="button" data-active={theme === 'neutral'} onClick={() => setTheme('neutral')}>Neutral</button>
          <button type="button" data-active={theme === 'warm'} onClick={() => setTheme('warm')}>Warm</button>
          <button type="button" data-active={theme === 'cool'} onClick={() => setTheme('cool')}>Cool</button>
        </div>
      </header>

      {/* CONTROL PANEL */}
      <div className="control-panel">
        <button className="btn-primary" onClick={startRecording} disabled={busy}>
          <MicIcon />Start Recording
        </button>
        <button className="btn-secondary" onClick={stopRecording} disabled={!isRecording}>
          <StopIcon color="#ffffff" />Stop & Process Stream
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
              className="btn-ghost"
              onClick={() => {
                setSegments(current => [...current, ...demoBatches[sampleBatch]]);
                setSampleBatch(current => current + 1);
              }}
            >
              {sampleBatch < demoBatches.length ? `Send sample batch ${sampleBatch + 1}` : 'All sample batches sent'}
            </button>
            <p className={isProcessing ? 'processing-status' : 'idle-status'}>
                {isProcessing ? '🧠 AI processing current segments...' : `Awaiting input. Segments captured: ${segments.length}`}
            </p>
          </>
        )}
      </MeetingResults>

    </main>
  );
}