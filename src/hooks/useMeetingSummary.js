import { useCallback, useEffect, useRef, useState } from 'react';
import { summarizeMeeting } from '../services/summarizeMeeting.js';

const RETRY_DELAYS_MS = [1000, 2000, 4000];   // a failed summary tries again by itself, 3 times
const wait = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});

// End-of-meeting summary. `ready` = recording has stopped and the mind map has caught up.
// Each time it becomes ready with new transcript lines, the summary is (re)written.
// summary.status: 'idle' | 'loading' | 'done' | 'error'
export function useMeetingSummary(segments, state, ready) {
  const [summary, setSummary] = useState({ status: 'idle', data: null, error: null });
  const summarizedCount = useRef(0);   // how many transcript lines the current summary covers
  const request = useRef(null);
  const latest = useRef({ segments, state });
  latest.current = { segments, state };

  useEffect(() => {
    const count = segments.length;
    if (!ready || !count || !state.nodes.length || count === summarizedCount.current) return;
    summarizedCount.current = count;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setSummary(current => ({ ...current, status: 'loading', error: null }));
    (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const data = await summarizeMeeting(latest.current.segments, latest.current.state, { signal: controller.signal });
          if (!controller.signal.aborted) {
            request.current = null;
            setSummary({ status: 'done', data, error: null });
          }
          return;
        } catch (cause) {
          if (controller.signal.aborted) return;
          if (attempt >= RETRY_DELAYS_MS.length) {
            request.current = null;
            summarizedCount.current = 0;   // let the next stop try again
            setSummary(current => ({ ...current, status: 'error', error: cause.message }));
            return;
          }
          try { await wait(RETRY_DELAYS_MS[attempt], controller.signal); } catch { return; }
        }
      }
    })();
  }, [ready, segments.length, state]);

  // Recording again (or the map is busy): stop a summary still loading; it's redone at the next stop.
  useEffect(() => {
    if (ready || !request.current) return;
    request.current.abort();
    request.current = null;
    summarizedCount.current = 0;
    setSummary(current => ({ ...current, status: current.data ? 'done' : 'idle' }));
  }, [ready]);
  useEffect(() => () => request.current?.abort(), []);

  const reset = useCallback(() => {
    request.current?.abort();
    request.current = null;
    summarizedCount.current = 0;
    setSummary({ status: 'idle', data: null, error: null });
  }, []);

  return { summary, reset };
}
