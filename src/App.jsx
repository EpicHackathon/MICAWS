import React, { useState } from 'react';
import { useMeetingProcessor } from './hooks/useMeetingProcessor.js';
import MeetingView from './components/MeetingView.jsx';
import ManualInput from './components/ManualInput.jsx';
import { demoBatches } from './shared/demo.js';

/**
 * MeetingResults component displays the derived state (Nodes, Edges, Actions) 
 * and controls for processing segments. It is now purely a display layer.
 */
export function MeetingResults({ segments, isRecording, clearTranscript, onManualSegment, children }) {
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
        <button onClick={processPending} disabled={isProcessing}>Process pending / retry</button>
        <button onClick={resetMeeting}>Reset session</button>
      </div>

      {error && <p role="alert" style={{ color: 'red', border: '1px solid red', padding: '10px' }}>Error: {error}</p>}
      
      <MeetingView key={'view-' + viewVersion} state={state} />
      <ManualInput key={'input-' + viewVersion} disabled={isRecording || isProcessing || !onManualSegment} onSubmit={onManualSegment} />
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
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState(null);

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
        // In a real app, you'd send 'buffer' data (or a chunk buffer) to an endpoint and await structured JSON output.
        const simulatedSegment = { 
            time: Date.now() / 1000, // Current time as timestamp
            speaker: ['Alice', 'Bob', 'Charlie'][Math.floor(Math.random() * 3)], // Random Speaker Diarization Simulation
            text: `[Simulated Whisper chunk] Processed audio buffer data at ${new Date().toLocaleTimeString()}. This represents a successful diarized transcription segment.` 
        };
        processLiveSegment(simulatedSegment);

      }, 500); // Check for new chunks every 500ms (adjust based on desired latency)

    } catch (err) {
        console.error("Error accessing microphone:", err);
        setError(`Failed to access the microphone. Please ensure you grant permission in your browser and a mic is connected. (${err.name})`);
        setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (!isRecording) return;
    console.log("🛑 Microphone recording stopped.");
    clearInterval(window.processorInterval); // Stop the interval timer
    
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
  }

  return (
    <main className="app-container">
      <h1 className="text-3xl font-bold" style={{ color: isRecording ? 'red' : '#333' }}>Meeting Processor Dashboard</h1>
      <p>Status: {isRecording ? '🔴 LIVE RECORDING IN PROGRESS...' : '🟢 Ready. Click Start to begin session capture.'}</p>
      
      {/* CONTROL PANEL */}
      <div className="control-panel">
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