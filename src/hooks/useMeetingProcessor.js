import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { processTranscript } from '../services/processTranscript.js';
import { emptyMeetingState } from '../shared/meetingSchema.js';

export function useMeetingProcessor(segments, isRecording, intervalMs = 10_000) {
  const [state, setState] = useState(emptyMeetingState);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const meeting = useRef({ state: emptyMeetingState, cursor: 0, request: null });
  const latest = useRef({ segments, isRecording });

  useLayoutEffect(() => {
    latest.current = { segments, isRecording };
  }, [segments, isRecording]);

  const processPending = useCallback(async function drain() {
    const current = meeting.current;
    const end = latest.current.segments.length;
    if (current.request || end <= current.cursor) return;

    const controller = new AbortController();
    current.request = controller;
    setIsProcessing(true);
    setError(null);
    let succeeded = false;
    try {
      const next = await processTranscript(
        latest.current.segments.slice(current.cursor, end),
        current.state,
        { signal: controller.signal },
      );
      if (meeting.current !== current) return;
      current.cursor = end;
      current.state = next;
      setState(next);
      succeeded = true;
    } catch (cause) {
      if (meeting.current === current) setError(cause.message || 'Processing failed.');
    } finally {
      if (meeting.current === current) {
        current.request = null;
        setIsProcessing(false);
      }
    }

    // Process speech that arrived while the previous map update was running.
    if (succeeded && meeting.current === current
        && latest.current.segments.length > end) await drain();
  }, []);

  useEffect(() => {
    if (isRecording) {
      const timer = setInterval(processPending, intervalMs);
      return () => clearInterval(timer);
    }
  }, [isRecording, intervalMs, processPending]);

  useEffect(() => {
    void processPending();
  }, [isRecording, segments.length, processPending]);

  const invalidate = useCallback(() => {
    const old = meeting.current;
    meeting.current = { state: emptyMeetingState, cursor: 0, request: null };
    old.request?.abort();
  }, []);

  // Layout cleanup also covers development Strict Mode's effect replay.
  useLayoutEffect(() => invalidate, [invalidate]);

  const reset = useCallback(() => {
    invalidate();
    setState(emptyMeetingState);
    setError(null);
    setIsProcessing(false);
  }, [invalidate]);

  return { state, isProcessing, error, processPending, reset };
}
