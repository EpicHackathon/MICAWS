import React, { useState, useEffect } from 'react';
import { useMeetingProcessor } from './hooks/useMeetingProcessor.js';
import MeetingView from './components/MeetingView.jsx';
import ManualInput from './components/ManualInput.jsx';
import { demoBatches } from './shared/demo.js';

/**
 * MeetingResults component displays the derived state (Nodes, Edges, Actions)
 * and controls for processing segments. It is now purely a display layer.
 */
export function MeetingResults({ segments, isRecording, clearTranscript, onManualSegment, children }) {
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
        <button className="btn-ghost" onClick={processPending} disabled={isProcessing}>
          Process pending / retry
        </button>
        <button className="btn-ghost" onClick={resetMeeting}>Reset session</button>
      </div>

      {error && <p role="alert" className="error-message">Error: {error}</p>}
      <MeetingView key={'view-' + viewVersion} state={state} />
      <ManualInput key={'input-' + viewVersion} disabled={isRecording || isProcessing || !onManualSegment} onSubmit={onManualSegment} />
    </>
  );
}

/**
 * Main App component handles the recording controls and pipes data into MeetingResults.
 */
export default function App() {
  const [segments, setSegments] = useState([]);
  const [sampleBatch, setSampleBatch] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState(null);
  const [theme, setTheme] = useState('neutral');

  // Apply theme to <body> so CSS variables switch between neutral / warm / cool.
  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  // --- CORE CONTROL HANDLERS (Mocked/WebAudio Skeleton) ---
  const startRecording = async () => {
    if (isRecording) return;

    // 1. Microphone Availability Check
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError("Browser does not support microphone access required for live recording.");
        setIsRecording(false);
        return;
    }

    try {
      // Request permission and get the stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Initialize Audio Context and Graph Nodes
      window.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = window.audioContext.createMediaStreamSource(stream);

      // Connect stream to an Analyser Node for real-time data inspection
      source.connect(window.audioContext.destination);
      window.analyser = window.audioContext.createAnalyser();
      source.connect(window.analyser);

      console.log("✅ Microphone access granted and AudioContext started.");

      // Set up interval to process audio chunks (Simulates Whisper chunk processing)
      window.processorInterval = setInterval(() => {
        if (!isRecording) return;
        const bufferSize = 1024;
        const buffer = new Float32Array(bufferSize);
        window.analyser.getFloatTimeDomainData(buffer);

        // *** SIMULATION POINT: This entire block represents the integration with your Whisper Backend/API ***
        // In a real app, you'd send 'buffer' data
      }, 200);

      setIsRecording(true);
    } catch (err) {
      console.error("❌ Microphone error:", err);
      setError("Could not access the microphone. Please check permissions and try again.");
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (!isRecording) return;
    console.log("🛑 Microphone recording stopped.");
    clearInterval(window.processorInterval);

    // Cleanup Web Audio Context resources
    if (window.audioContext) window.audioContext.close();
    window.audioContext = null;
    window.analyser = null;

    setIsRecording(false);
  };

  /**
   * This function simulates receiving diarized, finalized segments from the Whisper pipeline/stream handler.
   * This is the core ingestion point for all live data.
   */
  const processLiveSegment = (segment) => {
    // CRITICAL STEP: Data validation and structure enforcement happens here before setting state.
    if (!segment || !segment.text) return;

    setSegments(current => [...current, segment]);
    console.log("✅ Segment received:", segment);
  };

  /**
   * Clears state and resets the session.
   */
  const clearSession = () => {
    if (window.confirm("Are you sure you want to reset the entire meeting transcript?")) {
        setSegments([]);
        setSampleBatch(0);
        setIsRecording(false);
        setError(null);
        // Cleanup audio context resources on manual reset too
        if (window.audioContext) window.audioContext.close();
        return true;
    }
    return false;
  };

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
          Status: {isRecording ? '🔴 Live recording in progress...' : '🟢 Ready. Click Start to begin session capture.'}
        </p>
        <div className="theme-switch" role="group" aria-label="Color theme">
          <button type="button" data-active={theme === 'neutral'} onClick={() => setTheme('neutral')}>Neutral</button>
          <button type="button" data-active={theme === 'warm'} onClick={() => setTheme('warm')}>Warm</button>
          <button type="button" data-active={theme === 'cool'} onClick={() => setTheme('cool')}>Cool</button>
        </div>
      </header>

      {/* CONTROL PANEL */}
      <div className="control-panel">
        <button className="btn-primary" onClick={startRecording} disabled={isRecording}>
          🎤 Start Recording (Mock)
        </button>
        <button className="btn-secondary" onClick={stopRecording} disabled={!isRecording}>
          🛑 Stop & Process Stream
        </button>
      </div>

      {/* The results component now consumes the recording state */}
      <MeetingResults
        segments={segments}
        isRecording={isRecording}
        clearTranscript={clearSession}
        onManualSegment={segment => setSegments(current => [...current, segment])}
      >
        {({ isProcessing }) => (
          <>
            <button
              disabled={isRecording || isProcessing || sampleBatch >= demoBatches.length}
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
