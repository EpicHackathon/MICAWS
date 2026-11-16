import { useCallback, useEffect, useRef, useState } from 'react';
import { summarizeMeeting } from '../services/summarizeMeeting.js';

const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) return reject(signal.reason);
  const cancel = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
  signal.addEventListener('abort', cancel, { once: true });
});

// The complete input identifies a summary: manual edits and document changes count too.
export function useMeetingSummary(segments, state, ready, context = {}) {
  const [summary, setSummary] = useState({ status: 'idle', data: null, error: null });
  const [revision, setRevision] = useState(0);
  const request = useRef(null);
  const completed = useRef(null);
  const inputKey = JSON.stringify({ segments, state, ...context });
  useEffect(() => {
    if (!ready) return;
    if (!state.nodes.length) { setSummary({ status: 'idle', data: null, error: null }); return; }
    if (completed.current === inputKey) return;
    const controller = new AbortController();
    request.current = controller;
    const input = JSON.parse(inputKey);
    const { segments: snapshotSegments, state: snapshotState, ...snapshotContext } = input;
    setSummary(current => ({ ...current, status: 'loading', error: null }));
    void (async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const data = await summarizeMeeting(snapshotSegments, snapshotState, { signal: controller.signal, context: snapshotContext });
          if (controller.signal.aborted) return;
          completed.current = inputKey;
          setSummary({ status: 'done', data, error: null });
          return;
        } catch (cause) {
          if (controller.signal.aborted) return;
          if (attempt === 3) { setSummary(current => ({ ...current, status: 'error', error: cause.message })); return; }
          try { await wait(cause.status === 429 ? 60000 : 1000 * 2 ** attempt, controller.signal); } catch { return; }
        }
      }
    })();
    return () => { controller.abort(); if (request.current === controller) request.current = null; };
  }, [ready, inputKey, revision]);
  const regenerate = useCallback(() => { completed.current = null; setRevision(value => value + 1); }, []);
  const reset = useCallback(() => {
    request.current?.abort(); completed.current = null;
    setSummary({ status: 'idle', data: null, error: null });
  }, []);
  return { summary, reset, regenerate };
}
