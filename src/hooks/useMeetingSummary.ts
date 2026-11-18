import type { MeetingState } from '../shared/meetingSchema.js';
import type { MeetingSummary } from '../shared/summarySchema.js';

type TranscriptSegment = {
  text: string;
};

type SummaryStatus = 'idle' | 'loading' | 'done' | 'error';

type SummaryState = {
  status: SummaryStatus;
  data: MeetingSummary | null;
  error: string | null;
};

type SummaryContext = Record<string, unknown>;

import { useCallback, useEffect, useRef, useState } from 'react';
import { summarizeMeeting } from '../services/summarizeMeeting.js';

const wait = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal.aborted) return reject(signal.reason);
  const cancel = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
  signal.addEventListener('abort', cancel, { once: true });
});

// The complete input identifies a summary: manual edits and document changes count too.
export function useMeetingSummary(
  segments: TranscriptSegment[],
  state: MeetingState,
  ready: boolean,
  context: SummaryContext = {},
) {
  const [summary, setSummary] = useState<SummaryState>({ status: 'idle', data: null, error: null });
  const [revision, setRevision] = useState(0);
  const request = useRef<AbortController | null>(null);
  const completed = useRef<string | null>(null);
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
          if (attempt === 3) { setSummary(current => ({ ...current, status: 'error', error: cause instanceof Error ? cause.message : String(cause) })); return; }
          try { await wait((typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 429) ? 60000 : 1000 * 2 ** attempt, controller.signal); } catch { return; }
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
