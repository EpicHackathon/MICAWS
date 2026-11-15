import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { processTranscript } from '../services/processTranscript.js';
import { emptyMeetingState } from '../shared/meetingSchema.js';

export function useMeetingProcessor(segments, isRecording, intervalMs = 10_000) {
  const [state, setState] = useState(emptyMeetingState);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  // editsDuringRequest: hand edits made while the AI is working; replayed on its answer.
  const meeting = useRef({ state: emptyMeetingState, cursor: 0, request: null, editsDuringRequest: [] });
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
    current.editsDuringRequest = [];
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
      // The AI answered based on the map from before any edits made meanwhile: replay them.
      let merged = next;
      for (const edit of current.editsDuringRequest) {
        try { merged = edit(merged); } catch { /* edit no longer applies (e.g. topic changed) */ }
      }
      current.editsDuringRequest = [];
      current.cursor = end;
      current.state = merged;
      setState(merged);
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

  // Apply a hand edit (move / rename / delete) from the mind map.
  // `edit` is a function state -> new state (see src/shared/mapEdits.js); it may throw to refuse.
  // The edited map becomes what the AI builds on next time, so edits are kept.
  const applyEdit = useCallback(edit => {
    const current = meeting.current;
    const next = edit(current.state);   // throws -> caller shows the message
    current.state = next;
    if (current.request) current.editsDuringRequest.push(edit);
    setState(next);
  }, []);

  const invalidate = useCallback(() => {
    const old = meeting.current;
    meeting.current = { state: emptyMeetingState, cursor: 0, request: null, editsDuringRequest: [] };
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

  return { state, isProcessing, error, processPending, reset, applyEdit };
}
