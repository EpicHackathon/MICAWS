import type { TranscriptionSegment, WordSpan } from '../services/transcribeAudio.js';
import type { MicrophoneStatus } from '../services/microphoneSession.js';
import { useEffect, useRef, useState } from 'react';
import { MicrophoneSession } from '../services/microphoneSession.js';
import { RecordingArchive } from '../audio/recordingArchive.js';

export function useMicrophone(onTranscript: (segments: TranscriptionSegment[], endSeconds: number) => void, { language = 'auto', workletUrl, captionMode = false }: { language?: string; workletUrl: string; captionMode?: boolean }) {
  const [status, setStatus] = useState<MicrophoneStatus>('idle');
  const [draftCaption, setDraftCaption] = useState('');
  const [wordSpans, setWordSpans] = useState<WordSpan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<MicrophoneSession | null>(null);
  const archive = useRef(new RecordingArchive());
  const recordingUrl = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [recording, setRecording] = useState<{ url: string; duration: number } | null>(null);
  const [recordingEnd, setRecordingEnd] = useState(0);
  const callback = useRef(onTranscript);
  callback.current = onTranscript;

  function cancel() {
    const session = active.current;
    active.current = null;
    session?.cancel();
  }

  useEffect(() => () => {
    cancel();
    if (recordingUrl.current) URL.revokeObjectURL(recordingUrl.current);
    recordingUrl.current = null;
  }, []);

  function publishRecording() {
    if (!archive.current.frames || typeof URL.createObjectURL !== 'function') return;
    const previousUrl = recordingUrl.current;
    const url = URL.createObjectURL(archive.current.toBlob());
    recordingUrl.current = url;
    setRecording({ url, duration: archive.current.duration });
    if (previousUrl) URL.revokeObjectURL(previousUrl);
  }

  async function start(startSeconds = 0) {
    if (active.current) return;
    if (archive.current.full) {
      setError('Recording storage is full. Download the recording and reset before recording more.');
      return;
    }
    setError(null);
    const session = new MicrophoneSession({
      workletUrl,
      onDraftCaption: captionMode ? text => {
        if (active.current === session) setDraftCaption(text);
      } : undefined,
      startSeconds: Math.max(startSeconds, archive.current.duration), language,
      onAudioChunk: (samples, sampleRate, start) => {
        if (active.current !== session) return false;
        try {
          archive.current.append(samples, sampleRate, start);
          setRecordingEnd(archive.current.duration);
          if (archive.current.full) {
            setError('Recording stopped at the storage limit. Download the recording before resetting.');
            return false;
          }
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
          return false;
        }
        return true;
      },
      onCaptureDone: () => { if (active.current === session) publishRecording(); },
      onTranscript: (transcript, endSeconds) => {
        if (active.current !== session) return;
        const aligned = transcript.flatMap(segment => segment.words ?? []);
        if (aligned.length) setWordSpans(current => [...current, ...aligned]);
        callback.current(transcript, endSeconds);
      },
      onStatus: nextStatus => {
        if (active.current !== session) return;
        setStatus(nextStatus);
        if (nextStatus === 'idle') active.current = null;
      },
      onError: message => {
        if (active.current === session) setError(message);
      },
    });
    active.current = session;
    await session.start();
  }

  function reset() {
    cancel();
    if (recordingUrl.current) URL.revokeObjectURL(recordingUrl.current);
    recordingUrl.current = null;
    archive.current = new RecordingArchive();
    setRecording(null);
    setRecordingEnd(0);
    setDraftCaption('');
    setWordSpans([]);
    setStatus('idle');
    setError(null);
  }

  return {
    start, stop: () => active.current?.stop(), retry: () => active.current?.retry(),
    reset, status, error, draftCaption, wordSpans, recording, recordingEnd, hasRecording: recordingEnd > 0, audioRef,
    seek: (time: number) => {
      if (!recording || !audioRef.current || time < 0 || time > recording.duration) return;
      audioRef.current.currentTime = time;
      void audioRef.current.play()?.catch(() => {});
    },
  };
}
