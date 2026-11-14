import React, { useState } from 'react';
import { useMeetingProcessor } from './hooks/useMeetingProcessor.js';
import MindMap from './components/MindMap.jsx';
import { mockMeeting } from './shared/mockMeeting.js';
import { demoBatches } from './shared/demo.js';

/**
 * MeetingResults component displays the derived state (Nodes, Edges, Actions) 
 * and controls for processing segments. It is now purely a display layer.
 */
export function MeetingResults({ segments, isRecording, clearTranscript, children }) {
  // The hook handles state updates based on incoming segments
  const processor = useMeetingProcessor(segments, isRecording);
  const { state: { nodes, edges, actionItems }, error, isProcessing, processPending, reset } = processor;

  function resetMeeting() {
    if (clearTranscript() !== false) reset();
  }

  return (
    <>
      {children?.({ isProcessing }) || null}
      <div style={{ marginTop: '10px' }}>
        <button onClick={processPending} disabled={isProcessing}>Process pending / retry</button>
        <button onClick={resetMeeting}>Reset session</button>
      </div>

      {error && <p role="alert" style={{ color: 'red', border: '1px solid red', padding: '10px' }}>Error: {error}</p>}
      
      <h2 style={{marginTop: '30px'}}>Topics ({nodes.length})</h2>
      <ul style={{listStyleType: 'none', padding: 0}}>
        {nodes.map(node => <li key={node.id} style={{marginBottom: '5px'}}><strong style={{fontSize: '1.1em'}}>{node.label}</strong> ({node.importance}/5) — {node.summary}</li>)}
      </ul>

      <h2 style={{marginTop: '30px'}}>Mind Map</h2>
      {/* MindMap component visualization */}
      <div style={{height: '400px', border: '1px solid #eee'}}>
         <MindMap nodes={mockMeeting.nodes} edges={mockMeeting.edges} />
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
         
      </div>

      {/* The results component now consumes the recording state */}
      <MeetingResults 
        segments={segments} 
        isRecording={isRecording} 
        clearTranscript={clearSession}
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

      {/* DEBUGGING/MOCK INPUT FOR TESTING */}
      <div style={{marginTop: '40px', borderTop: '1px dashed #ccc', paddingTop: '20px'}}>
        <h3 style={{fontSize:'1.3em'}}>🛠️ Dev Tools (Test Input)</h3>
        <p>Click this button repeatedly to simulate incoming, diarized audio chunks.</p>
         <button onClick={simulateSegment} disabled={!isRecording}>Simulate Segment Chunk</button>
      </div>

    </main>
  );
}

