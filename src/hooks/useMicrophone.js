import { useEffect, useRef, useState } from 'react';
import { MicrophoneSession } from '../services/microphoneSession.js';

export function useMicrophone(onTranscript) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const active = useRef(null);
  const callback = useRef(onTranscript);
  callback.current = onTranscript;

  function cancel() {
    const session = active.current;
    active.current = null;
    session?.cancel();
  }

  useEffect(() => cancel, []);

  async function start(startSeconds = 0) {
    if (active.current) return;
    setError(null);
    const session = new MicrophoneSession({
      startSeconds,
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
    setStatus('idle');
    setError(null);
  }

  return {
    start, stop: () => active.current?.stop(), retry: () => active.current?.retry(),
    reset, status, error,
  };
}
