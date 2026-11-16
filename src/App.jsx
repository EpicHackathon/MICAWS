import { useMicrophone } from './hooks/useMicrophone.js';
import React, { useState, useRef, useEffect } from 'react';
import { useMeetingProcessor } from './hooks/useMeetingProcessor.js';
import { useMeetingSummary } from './hooks/useMeetingSummary.js';
import MeetingView from './components/MeetingView.jsx';
import MicIcon from './components/MicIcon.jsx';
import StopIcon from './components/StopIcon.jsx';
import ManualInput from './components/ManualInput.jsx';
import { demoBatches } from './shared/demo.js';
import MeetingMaterials from './components/MeetingMaterials.jsx';
import RecordingPlayer from './components/RecordingPlayer.jsx';
import { useTranslations } from './hooks/useTranslations.js';

const languages = ['English', 'Spanish', 'French', 'German', 'Portuguese', 'Chinese', 'Japanese', 'Korean', 'Hindi', 'Arabic'];

/**
 * MeetingResults component displays the derived state (Nodes, Edges, Actions) 
 * and controls for processing segments. It is now purely a display layer.
 */
export function MeetingResults({ segments, isRecording, clearTranscript, onManualSegment, captureBusy, devMode = false, children, onSeek, translations, translationLanguage }) {
  // The hook handles state updates based on incoming segments
  const [viewVersion, setViewVersion] = useState(0);
  // True while someone edits the live mind map: AI map updates wait, recording continues.
  const [editingMap, setEditingMap] = useState(false);
  const [materials, setMaterials] = useState([]);
  const [outputLanguage, setOutputLanguage] = useState('English');
  const processor = useMeetingProcessor(segments, isRecording, undefined, { paused: editingMap, materials, outputLanguage });
  // Failed transcription / AI updates retry by themselves (no retry button needed).
  const { state, error, isProcessing, reset } = processor;
  // End-of-meeting summary: written once recording has stopped and the mind map has caught up.
  const summaryReady = !isRecording && !captureBusy && !isProcessing && !editingMap && processor.pendingCount === 0;
  const meetingSummary = useMeetingSummary(segments, state, summaryReady, processor.context);

  function resetMeeting() {
    if (clearTranscript() !== false) {
      reset();
      meetingSummary.reset();
      setMaterials([]);
      setViewVersion(current => current + 1);
    }
  }

  return (
    <>
      {children?.({ isProcessing }) || null}
      <div className="control-actions">
        <button className="btn-ghost" onClick={resetMeeting}>Reset session</button>
      </div>

      {error && <p role="alert" className="error-message">Error: {error}</p>}
      <label>Map and summary language <select value={outputLanguage} onChange={event => setOutputLanguage(event.target.value)}>{languages.map(language => <option key={language}>{language}</option>)}</select></label>
      <MeetingMaterials key={'materials-' + viewVersion} materials={materials} onChange={setMaterials}/>

      <MeetingView
        key={'view-' + viewVersion}
        state={state}
        onEdit={processor.applyEdit}
        onEditingChange={setEditingMap}
        pendingCount={processor.pendingCount}
        segments={segments}
        isRecording={isRecording}
        devMode={devMode}
        summary={meetingSummary.summary}
        onRegenerateSummary={meetingSummary.regenerate}
        onSeek={onSeek} translations={translations} translationLanguage={translationLanguage}
      />
      <ManualInput key={'input-' + viewVersion} disabled={!onManualSegment} onSubmit={onManualSegment} />
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
  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [translationLanguage, setTranslationLanguage] = useState('');
  const translation = useTranslations(segments, translationLanguage);
  const nextStart = useRef(0);
  // Marena's color theme switcher (neutral / warm / cool), applied to <body>.
  const [theme, setTheme] = useState('neutral');
  // Dev/backup tools (test text, sample batches, sample meeting) only show when the
  // web address ends in ?dev, e.g. http://localhost:5173/?dev
  const [devMode] = useState(() => new URLSearchParams(window.location.search).has('dev'));
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
  }, { language: sourceLanguage });
  const isRecording = microphone.status === 'recording';
  const busy = microphone.status !== 'idle';
  const startRecording = () => microphone.start(Math.max(nextStart.current, segments.at(-1)?.time ?? 0));
  const stopRecording = microphone.stop;
  useEffect(() => {
    if (!microphone.hasRecording && !busy) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [microphone.hasRecording, busy]);

  function clearSession() {
    if (!window.confirm('Reset this meeting? This discards the transcript, attached materials, unsaved recording and pending audio. Download the recording first if you need it.')) return false;
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
        <p className="app-status" role="status">
          Status: {{ idle: 'Ready to record.', starting: 'Waiting for microphone permission…', recording: 'Live recording in progress…', transcribing: 'Finishing pending transcription…' }[microphone.status]}
        </p>
        <div className="theme-switch" role="group" aria-label="Color theme">
          <button type="button" data-active={theme === 'neutral'} onClick={() => setTheme('neutral')}>Neutral</button>
          <button type="button" data-active={theme === 'warm'} onClick={() => setTheme('warm')}>Warm</button>
          <button type="button" data-active={theme === 'cool'} onClick={() => setTheme('cool')}>Cool</button>
          <button type="button" data-active={theme === 'dark'} onClick={() => setTheme('dark')}>Dark</button>
        </div>
      </header>

      {/* CONTROL PANEL */}
      <div className="control-panel">
        <label>Speech language <select disabled={busy} value={sourceLanguage} onChange={event => setSourceLanguage(event.target.value)}>
          {Object.entries({ auto: 'Detect automatically', en: 'English', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', hi: 'Hindi', ar: 'Arabic' }).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select></label>
        <label>Translate transcript <select value={translationLanguage} onChange={event => setTranslationLanguage(event.target.value)}><option value="">Original only</option>{languages.map(language => <option key={language}>{language}</option>)}</select></label>
        <button className="btn-primary" onClick={startRecording} disabled={busy}>
          <MicIcon />Start Recording
        </button>
        <button className="btn-secondary" onClick={stopRecording} disabled={!isRecording}>
          <StopIcon />Stop & Process Stream
        </button>
      </div>

      {microphone.status === 'starting' && <p role="status">Waiting for microphone permission…</p>}
      {microphone.status === 'transcribing' && <p role="status">Finishing pending transcription…</p>}
      {microphone.error && <p role="alert">{microphone.error}</p>}
      <RecordingPlayer recording={microphone.recording} audioRef={microphone.audioRef}/>
      {translation.busy && <p role="status">Translating transcript… Original text remains available.</p>}
      {translation.error && <p role="alert">{translation.error} <button onClick={translation.retry}>Retry translation</button></p>}
      {/* The transcript now lives in the side panel next to the mind map (MeetingView). */}

      {/* The results component now consumes the recording state */}
      <MeetingResults 
        segments={segments} 
        isRecording={isRecording} 
        clearTranscript={clearSession}
        captureBusy={busy}
        devMode={devMode}
        onSeek={microphone.hasRecording ? microphone.seek : undefined}
        translations={translation.texts} translationLanguage={translationLanguage}
        onManualSegment={segment => setSegments(current => [...current, { ...segment, time: nextStart.current }])}
      >
        {({ isProcessing }) => (
          <>
            {devMode && <button
              disabled={busy || isProcessing || sampleBatch >= demoBatches.length}
              className="btn-ghost"
              onClick={() => {
                setSegments(current => [...current, ...demoBatches[sampleBatch]]);
                setSampleBatch(current => current + 1);
              }}
            >
              {sampleBatch < demoBatches.length ? `Send sample batch ${sampleBatch + 1}` : 'All sample batches sent'}
            </button>}
            <p className={isProcessing ? 'processing-status' : 'idle-status'}>
                {isProcessing ? '🧠 AI processing current segments...' : `Awaiting input. Segments captured: ${segments.length}`}
            </p>
          </>
        )}
      </MeetingResults>

    </main>
  );
}
