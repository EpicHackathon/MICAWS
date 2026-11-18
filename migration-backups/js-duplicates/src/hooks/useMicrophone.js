import { useEffect, useRef, useState } from 'react';
import { MicrophoneSession } from '../services/microphoneSession.js';
import { RecordingArchive } from '../audio/recordingArchive.js';

export function useMicrophone(onTranscript, { language = 'auto' } = {}) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const active = useRef(null);
  const archive = useRef(new RecordingArchive());
  const recordingUrl = useRef(null);
  const audioRef = useRef(null);
  const [recording, setRecording] = useState(null);
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
          setError(cause.message);
          return false;
        }
        return true;
      },
      onCaptureDone: () => { if (active.current === session) publishRecording(); },
      onTranscript: (transcript, endSeconds) => {
        if (active.current === session) callback.current(transcript, endSeconds);
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
    setStatus('idle');
    setError(null);
  }

  return {
    start, stop: () => active.current?.stop(), retry: () => active.current?.retry(),
    reset, status, error, recording, recordingEnd, hasRecording: recordingEnd > 0, audioRef,
    seek: time => {
      if (!recording || !audioRef.current || time < 0 || time > recording.duration) return;
      audioRef.current.currentTime = time;
      void audioRef.current.play()?.catch(() => {});
    },
  };
}
